import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createAssistantDeliverable } from "../server/assistant/assistantDeliverables.js";
import type { AssistantConversationArtifact } from "../server/assistant/assistantConversationState.js";
import type { AssistantPlan } from "../server/assistant/assistantTypes.js";

const ownership = { userId: "user_1", firmId: "firm_1" };
const account = { user: { id: "user_1", email: "lawyer@example.test", name: "Lawyer" }, firm: { id: "firm_1", name: "Example LLP" } } as any;
const thread = { id: "thread_1", title: "Advice", scope: "general" } as any;
const noWeb = { performed: false, report: "", citations: [], questions: [] };

function plan(sourceArtifactId: string): AssistantPlan {
  return {
    intent: "document_revision", depth: "thorough", needsWorkspace: true,
    needsCurrentPage: false, needsWeb: false, needsClarification: false,
    deliverable: { kind: "document", documentAction: "revise", sourceArtifactId },
    referencedArtifactIds: [sourceArtifactId], referencedResearchSourceIds: [], toolCalls: [],
  };
}

function state(artifact: AssistantConversationArtifact) {
  return { rollingMemory: "", recentTurns: [], recentArtifacts: [artifact], recentResearchSources: [], latestCreatedArtifact: artifact };
}

test("Matter Work Product revision creates a separate child in the same authorized Matter", async () => {
  const artifact: AssistantConversationArtifact = {
    id: "draft_source", kind: "matterWorkProduct", title: "Advice", matterId: "case_1",
    createdByMessageId: "msg_1", createdAt: "2026-08-05T10:00:00.000Z",
  };
  let revisionInput: any;
  const result = await createAssistantDeliverable({
    plan: plan(artifact.id), thread, currentMatter: null, conversationState: state(artifact), sourceArtifact: artifact,
    evidence: [], webResearch: noWeb, ownership, account, instruction: "Make that document firmer.",
    pageContext: { routeKind: "history", pageTitle: "Assistant" }, conversationContext: "",
    database: {
      getCaseById: async () => ({ id: "case_1", name: "Matter" }),
      getDraftById: async () => ({ id: "draft_source", title: "Advice", content: "# Advice\n\nOriginal unchanged." }),
      createAssistantDraftRevision: async (input: any) => {
        revisionInput = input;
        return { id: "draft_revision", title: "Advice â€” Revised" };
      },
    } as any,
    model: (async (_task: string, _messages: unknown, options: Record<string, unknown>) => {
      assert.equal(options.googleSearch, false);
      assert.equal(options.thinkingLevel, "high");
      return { text: "# Advice â€” Revised\n\nFirmer terms." };
    }) as any,
  });
  assert.equal(revisionInput.sourceDraftId, "draft_source");
  assert.equal(revisionInput.caseId, "case_1");
  assert.equal(result.document.id, "draft_revision");
  assert.equal(result.document.matterId, "case_1");
  assert.equal(result.sourceDocument?.id, "draft_source");
});

test("Assistant Document revision creates a distinct private Assistant Document", async () => {
  const artifact: AssistantConversationArtifact = {
    id: "assistant_document_source", kind: "assistantDocument", title: "Private Memo",
    createdByMessageId: "msg_1", createdAt: "2026-08-05T10:00:00.000Z",
  };
  let createdId = "";
  const result = await createAssistantDeliverable({
    plan: plan(artifact.id), thread, currentMatter: null, conversationState: state(artifact), sourceArtifact: artifact,
    evidence: [], webResearch: noWeb, ownership, account, instruction: "Rewrite the memo more concisely.",
    pageContext: { routeKind: "history", pageTitle: "Assistant" }, conversationContext: "",
    database: {
      getAssistantDocumentById: async () => ({ id: artifact.id, title: artifact.title, content: "# Private Memo\n\nOriginal." }),
      createAssistantDocument: async (_threadId: string, _title: string, _content: string) => {
        createdId = "assistant_document_revision";
        return { id: createdId, title: "Private Memo â€” Revised" };
      },
    } as any,
    model: (async () => ({ text: "# Private Memo â€” Revised\n\nConcise." })) as any,
  });
  assert.equal(result.document.id, createdId);
  assert.notEqual(result.document.id, artifact.id);
  assert.equal(result.sourceDocument?.id, artifact.id);
});

test("unknown revision source is rejected before generation", async () => {
  await assert.rejects(() => createAssistantDeliverable({
    plan: plan("unknown"), thread, currentMatter: null,
    conversationState: { rollingMemory: "", recentTurns: [], recentArtifacts: [], recentResearchSources: [], latestCreatedArtifact: null },
    evidence: [], webResearch: noWeb, ownership, account, instruction: "Revise it.",
    pageContext: { routeKind: "history", pageTitle: "Assistant" }, conversationContext: "",
    database: {} as any, model: (async () => ({ text: "Never called" })) as any,
  }), /authorized artifact ledger/);
});

test("database revision insert preserves the original and uses existing revision columns", async () => {
  const database = await readFile(new URL("../server/db.ts", import.meta.url), "utf8");
  const method = database.slice(database.indexOf("createAssistantDraftRevision"), database.indexOf("createManualDraft"));
  assert.match(method, /parent_draft_id, revision_type/);
  assert.match(method, /'Assistant revision'/);
  assert.match(method, /source\.id, 'Duplicate'/);
  assert.doesNotMatch(method, /Client Revision|UPDATE drafts|DELETE FROM/);
});

