import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssistantConversationState,
  resolveLatestArtifactReference,
} from "../server/assistant/assistantConversationState.js";
import type { Message } from "../src/types.js";

function artifactMessage(id: string, artifactId: string, title: string, createdAt: string): Message {
  return {
    id,
    thread_id: "thread_1",
    role: "assistant",
    content: `Created ${title}.`,
    citations: [],
    steps: null,
    created_at: createdAt,
    metadata: { document: { id: artifactId, kind: "assistantDocument", title } },
  };
}

test("the document just created resolves to the newest exact metadata artifact", () => {
  const state = buildAssistantConversationState({ messages: [
    artifactMessage("msg_1", "doc_old", "Old Memo", "2026-08-05T09:00:00.000Z"),
    artifactMessage("msg_2", "doc_new", "New Memo", "2026-08-05T10:00:00.000Z"),
  ] });
  const resolved = resolveLatestArtifactReference({
    content: "What assumptions did you use in the document you just created?",
    conversationState: state,
    pageContext: { routeKind: "history", pageTitle: "Assistant" },
    currentMatterId: null,
  });
  assert.equal(resolved.artifact?.id, "doc_new");
  assert.equal(resolved.needsClarification, false);
});

test("a validated planner artifact ID resolves only from the authorized ledger", () => {
  const state = buildAssistantConversationState({ messages: [
    artifactMessage("msg_1", "doc_exact", "Exact Memo", "2026-08-05T09:00:00.000Z"),
  ] });
  const allowed = resolveLatestArtifactReference({
    content: "Use the prior memo.",
    conversationState: state,
    pageContext: { routeKind: "history", pageTitle: "Assistant" },
    currentMatterId: null,
    plannerArtifactId: "doc_exact",
  });
  const invented = resolveLatestArtifactReference({
    content: "Use the prior memo.",
    conversationState: state,
    pageContext: { routeKind: "history", pageTitle: "Assistant" },
    currentMatterId: null,
    plannerArtifactId: "doc_invented",
  });
  assert.equal(allowed.artifact?.id, "doc_exact");
  assert.equal(invented.artifact, null);
});

test("current selected page document takes precedence over conversation artifacts", () => {
  const state = buildAssistantConversationState({ messages: [
    artifactMessage("msg_1", "doc_old", "Old Memo", "2026-08-05T09:00:00.000Z"),
  ] });
  const resolved = resolveLatestArtifactReference({
    content: "Make that document firmer.",
    conversationState: state,
    pageContext: {
      routeKind: "matter",
      pageTitle: "Atlas",
      matter: { id: "case_atlas", name: "Atlas" },
      selectedItem: { kind: "workProduct", id: "draft_selected", title: "Selected Advice" },
    },
    currentMatterId: "case_atlas",
  });
  assert.equal(resolved.artifact?.id, "draft_selected");
  assert.equal(resolved.artifact?.matterId, "case_atlas");
});

test("ambiguous direct revision pronoun asks for clarification", () => {
  const state = buildAssistantConversationState({ messages: [
    artifactMessage("msg_1", "doc_one", "First Memo", "2026-08-05T09:00:00.000Z"),
    artifactMessage("msg_2", "doc_two", "Second Memo", "2026-08-05T10:00:00.000Z"),
  ] });
  const resolved = resolveLatestArtifactReference({
    content: "Revise it to be firmer.",
    conversationState: state,
    pageContext: { routeKind: "history", pageTitle: "Assistant" },
    currentMatterId: null,
  });
  assert.equal(resolved.artifact, null);
  assert.equal(resolved.needsClarification, true);
});
