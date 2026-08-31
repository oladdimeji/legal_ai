import assert from "node:assert/strict";
import test from "node:test";
import {
  deduplicateAssistantToolCalls,
  orchestrateAssistantRetrieval,
} from "../server/assistant/assistantOrchestrator.js";
import { ASSISTANT_TOOL_LIMITS } from "../server/assistant/assistantToolExecutor.js";
import type { AssistantPlan, AssistantSessionContext } from "../server/assistant/assistantTypes.js";

const account = {
  user: { id: "user_1", account_type: "lawyer", name: "Ada", email: "ada@example.com", firm_role: "member", professional_role: "Lawyer", custom_professional_role: null, practice_areas: [], custom_practice_area: null, workspace_type: "firm" },
  firm: { id: "firm_1", name: "Example Firm" },
} as any;

const session: AssistantSessionContext = {
  currentUtcDate: "2026-08-05",
  user: { id: "user_1", name: "Ada", email: "ada@example.com", professionalRole: "Lawyer", customProfessionalRole: null, practiceAreas: [], customPracticeArea: null, workspaceType: "firm", firmRole: "member" },
  firm: { id: "firm_1", name: "Example Firm" },
  page: { routeKind: "matter", pageTitle: "Current", matter: { id: "case_current", name: "Current" } },
  currentMatter: { id: "case_current", name: "Current", clientName: null, clientEmail: null, jurisdiction: "England and Wales", status: "Active" },
  selectedEntity: null,
};

function plan(toolCalls: AssistantPlan["toolCalls"]): AssistantPlan {
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
    toolCalls,
  };
}

test("duplicate initial calls are deterministic and removed before execution", () => {
  const calls = deduplicateAssistantToolCalls([
    { name: "list_firm_library_documents", arguments: {} },
    { name: "list_firm_library_documents", arguments: {} },
    { name: "search_firm_library_documents", arguments: { query: "termination" } },
  ]);
  assert.deepEqual(calls.map((call) => call.name), ["list_firm_library_documents", "search_firm_library_documents"]);
});

test("round two can fetch the exact full Firm Library document identified in round one", async () => {
  let fullDocumentReads = 0;
  const result = await orchestrateAssistantRetrieval({
    request: "Find and review the relevant Firm Library precedent.",
    plan: plan([{ name: "list_firm_library_documents", arguments: {} }]),
    session,
    account,
    ownership: { userId: "user_1", firmId: "firm_1" },
    currentMatterId: "case_current",
    conversationMessages: [],
    artifacts: [],
    database: {
      getDocuments: async () => [{ id: "doc_precedent", title: "Termination Precedent", uploaded_at: "2026-01-01" }],
      getDocumentById: async () => {
        fullDocumentReads += 1;
        return { id: "doc_precedent", title: "Termination Precedent", extracted_text: "Full precedent text", uploaded_at: "2026-01-01" };
      },
    } as any,
    model: (async () => ({ text: JSON.stringify({ toolCalls: [{ name: "get_firm_library_document", arguments: { documentId: "doc_precedent" } }] }) })) as any,
  });
  assert.equal(result.planningRounds, 2);
  assert.equal(result.toolRun.attemptedCalls, 2);
  assert.equal(fullDocumentReads, 1);
  assert.match(JSON.stringify(result.toolRun.evidence), /Full precedent text/);
});

test("a Matter resolved in round one remains authorized in round two", async () => {
  const matterReads: string[] = [];
  const result = await orchestrateAssistantRetrieval({
    request: "Find the Atlas acquisition Matter and open its overview.",
    plan: plan([{ name: "find_matter", arguments: { query: "Atlas acquisition" } }]),
    session,
    account,
    ownership: { userId: "user_1", firmId: "firm_1" },
    currentMatterId: "case_current",
    conversationMessages: [],
    artifacts: [],
    database: {
      getCases: async () => [{ id: "case_atlas", name: "Atlas acquisition", client_name: "Atlas", created_at: "2026-01-01" }],
      getCaseById: async (id: string) => {
        matterReads.push(id);
        return { id, name: "Atlas acquisition", client_name: "Atlas", created_at: "2026-01-01" };
      },
    } as any,
    model: (async () => ({ text: JSON.stringify({ toolCalls: [{ name: "get_matter_overview", arguments: { matterId: "case_atlas" } }] }) })) as any,
  });
  assert.equal(result.planningRounds, 2);
  assert.ok(result.toolRun.resolvedMatterIds.includes("case_atlas"));
  assert.ok(matterReads.includes("case_atlas"));
  assert.ok(result.toolRun.attemptedCalls <= ASSISTANT_TOOL_LIMITS.calls);
});

test("skipWebResearch bypasses public web research even when the plan requests it", async () => {
  let modelCalls = 0;
  const result = await orchestrateAssistantRetrieval({
    request: "Draft an NDA with current Delaware law.",
    plan: {
      ...plan([]),
      intent: "document_creation",
      needsWeb: true,
      deliverable: { kind: "document", documentAction: "create" },
    },
    session,
    account,
    ownership: { userId: "user_1", firmId: "firm_1" },
    currentMatterId: "case_current",
    conversationMessages: [],
    artifacts: [],
    database: {} as any,
    model: (async () => {
      modelCalls += 1;
      return { text: JSON.stringify({ toolCalls: [] }) };
    }) as any,
    skipWebResearch: true,
  });
  assert.equal(modelCalls, 0);
  assert.equal(result.webResearch.performed, false);
  assert.equal(result.webResearch.report, "");
});

test("orchestration never exceeds two planning rounds or eight total tool calls", async () => {
  const calls = Array.from({ length: 12 }, (_, index) => ({ name: "get_account_profile" as const, arguments: { marker: index } }));
  const safeCalls = calls.map(() => ({ name: "get_account_profile" as const, arguments: {} }));
  const result = await orchestrateAssistantRetrieval({
    request: "Show my account.",
    plan: plan(safeCalls),
    session,
    account,
    ownership: { userId: "user_1", firmId: "firm_1" },
    currentMatterId: "case_current",
    conversationMessages: [],
    artifacts: [],
    database: {} as any,
    model: (async () => ({ text: JSON.stringify({ toolCalls: safeCalls }) })) as any,
  });
  assert.ok(result.planningRounds <= ASSISTANT_TOOL_LIMITS.planningRounds);
  assert.ok(result.toolRun.attemptedCalls <= ASSISTANT_TOOL_LIMITS.calls);
});
