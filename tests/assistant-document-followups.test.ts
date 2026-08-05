import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveLatestArtifactReference } from "../server/assistant/assistantConversationState.js";

const artifact = {
  id: "draft_exact", kind: "matterWorkProduct" as const, title: "Employment Advice", matterId: "case_1",
  createdByMessageId: "msg_1", createdAt: "2026-08-05T10:00:00.000Z",
};
const conversationState = {
  rollingMemory: "", recentTurns: [], recentArtifacts: [artifact], recentResearchSources: [], latestCreatedArtifact: artifact,
};

test("follow-up and revision language resolves the exact latest artifact without list searching", () => {
  for (const content of [
    "What assumptions did you use in the document you just created?",
    "Make that document firmer.",
    "Rewrite the memo in a more concise style.",
  ]) {
    assert.equal(resolveLatestArtifactReference({
      content, conversationState,
      pageContext: { routeKind: "history", pageTitle: "Assistant" }, currentMatterId: null,
    }).artifact?.id, "draft_exact");
  }
});

test("unified completion metadata retains document and source-document cards without requestMode", async () => {
  const [server, completion] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/assistant/assistantCompletion.ts", import.meta.url), "utf8"),
  ]);
  const route = server.slice(server.indexOf('app.post("/api/threads/:id/messages"'), server.indexOf('// PUT route for updating a message'));
  assert.match(route, /completeAssistantResponse/);
  assert.match(completion, /document: deliverable\.document/);
  assert.match(completion, /sourceDocument: deliverable\.sourceDocument/);
  assert.match(completion, /deliverableKind: input\.plan\.deliverable\.kind/);
  assert.match(completion, /usedWorkspace/);
  assert.match(completion, /usedWeb/);
  assert.doesNotMatch(route, /requestMode|assistantMode|vectorSearch|legacyRequestMode/);
});

test("suggestion generation receives only safe document metadata", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  const suggestionFunction = server.slice(server.indexOf("async function generateFollowUpSuggestions"), server.indexOf("async function suggestMatterOverview"));
  assert.match(suggestionFunction, /Title:/);
  assert.match(suggestionFunction, /Kind:/);
  assert.match(suggestionFunction, /Action:/);
  assert.doesNotMatch(suggestionFunction, /documentContext\.(?:content|text|body)/);
});

