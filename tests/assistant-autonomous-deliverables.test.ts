import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantDeliverable } from "../server/assistant/assistantDeliverables.js";
import { fallbackAssistantPlan } from "../server/assistant/assistantPlanner.js";
import type { AssistantPlan, AssistantPlannerInput } from "../server/assistant/assistantTypes.js";

const emptyState = {
  rollingMemory: "",
  recentTurns: [],
  recentArtifacts: [],
  recentResearchSources: [],
  latestCreatedArtifact: null,
};

function plannerInput(content: string): AssistantPlannerInput {
  return {
    content,
    hasTemporaryFiles: false,
    temporaryFileNames: [],
    pageContext: { routeKind: "history", pageTitle: "Assistant" },
    currentMatterId: null,
    conversationState: emptyState,
  };
}

function documentPlan(kind: "document" | "message_and_document" = "document"): AssistantPlan {
  return {
    intent: "document_creation",
    depth: "standard",
    needsWorkspace: false,
    needsCurrentPage: false,
    needsWeb: false,
    needsClarification: false,
    deliverable: { kind, documentAction: "create" },
    referencedArtifactIds: [],
    referencedResearchSourceIds: [],
    toolCalls: [],
  };
}

const account = {
  user: { id: "user_1", email: "lawyer@example.test", name: "Lawyer" },
  firm: { id: "firm_1", name: "Example LLP" },
} as any;
const thread = { id: "thread_1", title: "Advice", scope: "general", case_id: null } as any;
const ownership = { userId: "user_1", firmId: "firm_1" };
const noWeb = { performed: false, report: "", citations: [], questions: [] };

test("fallback autonomously distinguishes messages, documents, and message-and-document requests", () => {
  assert.deepEqual(fallbackAssistantPlan(plannerInput("Draft a client advice letter.")).deliverable, {
    kind: "document", documentAction: "create",
  });
  assert.deepEqual(fallbackAssistantPlan(plannerInput("Prepare a memo and explain the risks.")).deliverable, {
    kind: "message_and_document", documentAction: "create",
  });
  assert.equal(fallbackAssistantPlan(plannerInput("Explain this clause.")).deliverable.kind, "message");
  assert.equal(fallbackAssistantPlan(plannerInput("Give me a two-sentence clause.")).deliverable.kind, "message");
});

test("document creation uses the canonical drafting prompt and saves to the current Matter only on a Matter page", async () => {
  const calls: string[] = [];
  let prompt = "";
  const result = await createAssistantDeliverable({
    plan: documentPlan(),
    thread,
    currentMatter: { id: "case_1", name: "Employment", description: "Advice", client_name: "Client" } as any,
    conversationState: emptyState,
    evidence: [],
    webResearch: noWeb,
    ownership,
    account,
    instruction: "Draft a client advice letter.",
    pageContext: { routeKind: "matter", pageTitle: "Employment", matter: { id: "case_1", name: "Employment" } },
    conversationContext: "Use a firm tone.",
    database: {
      createDraft: async (...args: unknown[]) => {
        calls.push(`matter:${String(args[1])}`);
        return { id: "draft_new", title: "Client Advice Letter" };
      },
    } as any,
    model: (async (_task: string, messages: Array<{ content: string }>, options: Record<string, unknown>) => {
      prompt = messages[0].content;
      assert.equal(options.googleSearch, false);
      assert.equal(options.thinkingLevel, "minimal");
      return { text: "# Client Advice Letter\n\n## Advice\nProceed carefully." };
    }) as any,
  });
  assert.deepEqual(calls, ["matter:case_1"]);
  assert.equal(result.document.kind, "matterWorkProduct");
  assert.match(prompt, /export-safe|Grounded public research|canonical/i);
});

test("a successful but empty generation is retried once instead of failing the request", async () => {
  const responses = ["   ", "# Privacy Policy\n\n## Scope\nThis policy applies."];
  let attempts = 0;
  const result = await createAssistantDeliverable({
    plan: documentPlan(), thread, currentMatter: null, conversationState: emptyState,
    evidence: [], webResearch: noWeb, ownership, account,
    instruction: "Create a policy.",
    pageContext: { routeKind: "history", pageTitle: "Assistant" }, conversationContext: "",
    database: {
      createAssistantDocument: async () => ({ id: "assistant_document_new", title: "Privacy Policy" }),
    } as any,
    model: (async () => {
      attempts += 1;
      return { text: responses[attempts - 1] };
    }) as any,
  });
  assert.equal(attempts, 2);
  assert.equal(result.document.kind, "assistantDocument");

  let exhausted = 0;
  await assert.rejects(createAssistantDeliverable({
    plan: documentPlan(), thread, currentMatter: null, conversationState: emptyState,
    evidence: [], webResearch: noWeb, ownership, account,
    instruction: "Create a policy.",
    pageContext: { routeKind: "history", pageTitle: "Assistant" }, conversationContext: "",
    database: { createAssistantDocument: async () => ({ id: "unused", title: "Unused" }) } as any,
    model: (async () => {
      exhausted += 1;
      return { text: "" };
    }) as any,
  }), /did not return document content/);
  assert.equal(exhausted, 2);
});

test("general document creation remains a private user-owned Assistant Document", async () => {
  let created = false;
  const result = await createAssistantDeliverable({
    plan: documentPlan(), thread, currentMatter: null, conversationState: emptyState,
    evidence: [], webResearch: noWeb, ownership, account,
    instruction: "Create a policy.",
    pageContext: { routeKind: "history", pageTitle: "Assistant" }, conversationContext: "",
    database: {
      createAssistantDocument: async () => {
        created = true;
        return { id: "assistant_document_new", title: "Privacy Policy" };
      },
    } as any,
    model: (async () => ({ text: "# Privacy Policy\n\n## Scope\nThis policy applies." })) as any,
  });
  assert.equal(created, true);
  assert.equal(result.document.kind, "assistantDocument");
});

