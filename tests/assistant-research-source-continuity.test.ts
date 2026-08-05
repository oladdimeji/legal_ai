import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSISTANT_CONVERSATION_STATE_LIMITS,
  buildAssistantConversationState,
  conversationResearchSourceMetadata,
  publicAssistantMessage,
  researchSourceEvidenceForIds,
  resolveConversationResearchSourceReference,
} from "../server/assistant/assistantConversationState.js";
import type { Message } from "../src/types.js";

function userMessage(metadata: Message["metadata"]): Message {
  return {
    id: "msg_sources",
    thread_id: "thread_1",
    role: "user",
    content: "Summarize the attachment.",
    citations: [],
    steps: null,
    created_at: "2026-08-05T10:00:00.000Z",
    metadata,
  };
}

test("research source metadata stores sanitized bounded extracted text internally", () => {
  const metadata = conversationResearchSourceMetadata([
    { filename: "agreement.pdf", text: `Termination\u0000 clause\naccess_token=private-secret ${"x".repeat(40_000)}` },
    { filename: "schedule.docx", text: "Schedule text" },
  ]);
  assert.deepEqual(metadata.attachments, [{ name: "agreement.pdf" }, { name: "schedule.docx" }]);
  assert.equal(metadata.researchSources?.length, 2);
  assert.ok((metadata.researchSources?.[0].text.length || 0) <= ASSISTANT_CONVERSATION_STATE_LIMITS.researchSourceCharacters);
  assert.doesNotMatch(metadata.researchSources?.[0].text || "", /private-secret/);
});

test("public Assistant messages strip stored source text and keep attachment names and document cards", () => {
  const internal = userMessage({
    attachments: [{ name: "agreement.pdf" }],
    researchSources: [{ name: "agreement.pdf", text: "PRIVATE SOURCE TEXT" }],
    document: { id: "doc_1", kind: "assistantDocument", title: "Advice" },
    suggestions: ["Compare the clauses."],
  });
  const publicMessage = publicAssistantMessage(internal);
  assert.deepEqual(publicMessage.metadata?.attachments, [{ name: "agreement.pdf" }]);
  assert.deepEqual(publicMessage.metadata?.researchSources, [{ name: "agreement.pdf", available: true }]);
  assert.deepEqual(publicMessage.metadata?.document, internal.metadata?.document);
  assert.doesNotMatch(JSON.stringify(publicMessage), /PRIVATE SOURCE TEXT/);
});

test("a later follow-up can resolve and reuse an available conversation source", () => {
  const internal = userMessage({
    attachments: [{ name: "agreement.pdf" }],
    researchSources: [{ name: "agreement.pdf", text: "The agreement contains a 30-day termination notice." }],
  });
  const state = buildAssistantConversationState({ messages: [internal] });
  const resolved = resolveConversationResearchSourceReference({
    content: "Compare the termination clause in agreement.pdf with the document.",
    conversationState: state,
  });
  assert.equal(resolved.source?.available, true);
  const evidence = researchSourceEvidenceForIds([internal], [resolved.source!.id]);
  assert.equal(evidence[0].text, "The agreement contains a 30-day termination notice.");
});

test("historical name-only attachments remain visible but are marked unavailable", () => {
  const historical = userMessage({ attachments: [{ name: "legacy.pdf" }] });
  const state = buildAssistantConversationState({ messages: [historical] });
  assert.deepEqual(state.recentResearchSources, [{
    id: "research_msg_sources_1",
    messageId: "msg_sources",
    name: "legacy.pdf",
    available: false,
  }]);
});
