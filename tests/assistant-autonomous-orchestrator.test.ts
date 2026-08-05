import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fallbackAssistantPlan } from "../server/assistant/assistantPlanner.js";
import type { AssistantPlannerInput } from "../server/assistant/assistantTypes.js";

function input(content: string): AssistantPlannerInput {
  return {
    content,
    hasTemporaryFiles: false,
    temporaryFileNames: [],
    pageContext: { routeKind: "history", pageTitle: "Assistant" },
    currentMatterId: null,
    conversationState: {
      rollingMemory: "", recentTurns: [], recentArtifacts: [],
      recentResearchSources: [], latestCreatedArtifact: null,
    },
  };
}

test("server fallback autonomously chooses ordinary, web, and document outcomes", () => {
  const ordinary = fallbackAssistantPlan(input("Hello, what can you help me with?"));
  assert.equal(ordinary.deliverable.kind, "message");
  assert.equal(ordinary.needsWeb, false);
  assert.deepEqual(ordinary.toolCalls, []);

  const current = fallbackAssistantPlan(input("Verify the latest applicable filing deadline."));
  assert.equal(current.deliverable.kind, "message");
  assert.equal(current.needsWeb, true);

  const document = fallbackAssistantPlan(input("Analyse the risks and prepare a client advice letter."));
  assert.equal(document.deliverable.kind, "message_and_document");
  assert.equal(document.deliverable.documentAction, "create");
});

test("lawyer endpoint ignores obsolete browser fields and has no direct legacy research branch", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  const route = server.slice(server.indexOf('app.post("/api/threads/:id/messages"'), server.indexOf('// PUT route for updating a message'));
  assert.match(route, /planAssistantRequest/);
  assert.match(route, /orchestrateAssistantRetrieval/);
  assert.match(route, /completeAssistantResponse/);
  assert.doesNotMatch(route, /req\.body\.(?:responseMode|enableWebSearch|forceDeepResearch)|assistantMode|legacyRequestMode|db\.vectorSearch|search_workspace_documents/);
});

test("no production client request classifier remains", async () => {
  const [assistant, routing] = await Promise.all([
    readFile(new URL("../src/components/AssistantView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/assistantRouting.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(assistant, /routeAssistantRequest|responseMode|forceDeepResearch/);
  assert.doesNotMatch(routing, /routeAssistantRequest|assistantRequestRouting/);
  await assert.rejects(readFile(new URL("../src/lib/assistantRequestRouting.ts", import.meta.url), "utf8"));
});

