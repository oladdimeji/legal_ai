import assert from "node:assert/strict";
import test from "node:test";
import {
  fallbackAssistantPlan,
  validateAssistantPlan,
} from "../server/assistant/assistantPlanner.js";
import {
  currentPageEvidenceToolCalls,
  exactReferenceToolCalls,
  isExplicitCrossThreadRequest,
} from "../server/assistant/assistantOrchestrator.js";
import { executeAssistantToolPlan } from "../server/assistant/assistantToolExecutor.js";
import type { AssistantPlan, AssistantPlannerInput, AssistantSessionContext } from "../server/assistant/assistantTypes.js";

const conversationState = {
  rollingMemory: "",
  recentTurns: [],
  recentArtifacts: [{
    id: "draft_exact",
    kind: "matterWorkProduct" as const,
    title: "Exact Advice",
    matterId: "case_current",
    createdByMessageId: "msg_1",
    createdAt: "2026-08-05T10:00:00.000Z",
  }],
  recentResearchSources: [{ id: "research_msg_2_1", messageId: "msg_2", name: "agreement.pdf", available: true }],
  latestCreatedArtifact: null,
};

function input(content: string, overrides: Partial<AssistantPlannerInput> = {}): AssistantPlannerInput {
  return {
    content,
    hasTemporaryFiles: false,
    temporaryFileNames: [],
    pageContext: { routeKind: "matter", pageTitle: "Current", activeSection: "Overview", matter: { id: "case_current", name: "Current" } },
    currentMatterId: "case_current",
    conversationState,
    ...overrides,
  };
}

function messagePlan(overrides: Partial<AssistantPlan> = {}): AssistantPlan {
  return {
    intent: "workspace_lookup",
    depth: "standard",
    needsWorkspace: true,
    needsCurrentPage: false,
    needsWeb: false,
    needsClarification: false,
    deliverable: { kind: "message" },
    referencedArtifactIds: [],
    referencedResearchSourceIds: [],
    toolCalls: [],
    ...overrides,
  };
}

test("autonomous fallback separates Matter and Firm Library searches", () => {
  const firmOnly = fallbackAssistantPlan(input("Find a similar precedent in the Firm Library."));
  assert.deepEqual(firmOnly.toolCalls, [{ name: "search_firm_library_documents", arguments: { query: "Find a similar precedent in the Firm Library." } }]);
  const comparison = fallbackAssistantPlan(input("Compare this Matter with similar provisions in the Firm Library."));
  assert.deepEqual(comparison.toolCalls.map((call) => call.name), ["search_matter_documents", "search_firm_library_documents"]);
});

test("autonomous fallback chooses web for current public law and avoids it for private summaries", () => {
  assert.equal(fallbackAssistantPlan(input("Verify the current filing deadline under the latest rule.")).needsWeb, true);
  assert.equal(fallbackAssistantPlan(input("Summarize the attached agreement.", { hasTemporaryFiles: true, temporaryFileNames: ["agreement.pdf"] })).needsWeb, false);
  assert.equal(fallbackAssistantPlan(input("Hello")).needsWeb, false);
});

test("plan validation rejects invented artifacts, research sources, Matter IDs, and unknown fields", () => {
  const valid = {
    ...messagePlan(),
    referencedArtifactIds: ["draft_exact", "draft_exact"],
    referencedResearchSourceIds: ["research_msg_2_1"],
  };
  const validated = validateAssistantPlan(valid, input("Use the exact sources"));
  assert.deepEqual(validated?.referencedArtifactIds, ["draft_exact"]);
  assert.equal(validateAssistantPlan({ ...valid, referencedArtifactIds: ["draft_invented"] }, input("Use it")), null);
  assert.equal(validateAssistantPlan({ ...valid, referencedResearchSourceIds: ["research_invented"] }, input("Use it")), null);
  assert.equal(validateAssistantPlan({ ...valid, toolCalls: [{ name: "get_matter_overview", arguments: { matterId: "case_invented" } }] }, input("Use it")), null);
  assert.equal(validateAssistantPlan({ ...valid, hiddenReason: "secret" }, input("Use it")), null);
});

test("exact artifact kinds become exact authorized retrieval calls", () => {
  const calls = exactReferenceToolCalls({
    plan: messagePlan({ referencedArtifactIds: ["draft_exact", "assistant_exact"] }),
    artifacts: [
      conversationState.recentArtifacts[0],
      { id: "assistant_exact", kind: "assistantDocument", title: "Private Memo", createdByMessageId: "msg_3", createdAt: "2026-08-05T11:00:00.000Z" },
    ],
  });
  assert.deepEqual(calls, [
    { name: "get_work_product", arguments: { matterId: "case_current", workProductId: "draft_exact" } },
    { name: "get_assistant_document", arguments: { documentId: "assistant_exact" } },
  ]);
});

test("current selected page entity produces one exact retrieval call", () => {
  const session = {
    page: { routeKind: "matter", pageTitle: "Current", matter: { id: "case_current", name: "Current" }, selectedItem: { kind: "source", id: "doc_selected", title: "Agreement" } },
    currentMatter: { id: "case_current", name: "Current", clientName: null, clientEmail: null, jurisdiction: null, status: null },
    selectedEntity: { kind: "source", id: "doc_selected", title: "Agreement" },
  } as AssistantSessionContext;
  assert.deepEqual(currentPageEvidenceToolCalls({ plan: messagePlan({ needsCurrentPage: true }), session }), [
    { name: "get_matter_source", arguments: { matterId: "case_current", documentId: "doc_selected" } },
  ]);
});

test("exact Matter Source retrieval authorizes the Matter and passes its ID into the document boundary", async () => {
  const calls: unknown[][] = [];
  const result = await executeAssistantToolPlan({
    plan: messagePlan({ toolCalls: [{ name: "get_matter_source", arguments: { matterId: "case_current", documentId: "doc_selected" } }] }),
    account: { user: { id: "user_1" }, firm: { id: "firm_1" } } as any,
    ownership: { userId: "user_1", firmId: "firm_1" },
    currentMatterId: "case_current",
    request: "Review this Source",
    database: {
      getCaseById: async () => ({ id: "case_current", name: "Current" }),
      getDocumentById: async (...args: unknown[]) => {
        calls.push(args);
        return { id: "doc_selected", title: "Agreement", extracted_text: "Exact full text", uploaded_at: "2026-08-05" };
      },
    } as any,
  });
  assert.deepEqual(calls[0].slice(0, 3), ["doc_selected", { userId: "user_1", firmId: "firm_1" }, "case_current"]);
  assert.match(result.evidence[0].text, /Exact full text/);
  assert.equal(result.evidence[0].matterId, "case_current");
});

test("current-thread references do not qualify as global History requests", () => {
  assert.equal(isExplicitCrossThreadRequest("What did we conclude earlier?"), false);
  assert.equal(isExplicitCrossThreadRequest("What did you say above?"), false);
  assert.equal(isExplicitCrossThreadRequest("Find the conversation where we discussed Atlas."), true);
});

