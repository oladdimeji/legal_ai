import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ASSISTANT_CONVERSATION_STATE_LIMITS,
  buildAssistantConversationState,
} from "../server/assistant/assistantConversationState.js";
import { planAssistantRequest } from "../server/assistant/assistantPlanner.js";
import { conversationMessageForPrompt } from "../server/assistantRouting.js";
import type { Message } from "../src/types.js";

function message(
  id: string,
  role: Message["role"],
  content: string,
  metadata: Message["metadata"] = {},
  createdAt = "2026-08-05T10:00:00.000Z"
): Message {
  return { id, thread_id: "thread_1", role, content, citations: [], steps: null, created_at: createdAt, metadata };
}

test("Assistant conversation state keeps exact bounded turns and newest exact artifact metadata", () => {
  const messages = [
    message("msg_1", "assistant", "Created the first version.", {
      document: { id: "draft_exact", kind: "matterWorkProduct", title: "Employment Advice", matterId: "case_exact" },
    }, "2026-08-05T09:00:00.000Z"),
    message("msg_2", "user", "Please revise it.", {
      attachments: [{ name: "terms.pdf" }],
      pageContext: { routeKind: "matter", pageTitle: "Employment Matter", activeSection: "Work Product", matter: { id: "case_exact", name: "Employment Matter" } },
    }),
    message("msg_3", "assistant", "Created the revised version.", {
      document: { id: "draft_exact", kind: "matterWorkProduct", title: "Employment Advice — Revised", matterId: "case_exact" },
    }, "2026-08-05T11:00:00.000Z"),
  ];
  const state = buildAssistantConversationState({ messages, rollingMemory: "Keep the tone firm." });
  assert.equal(state.recentTurns.length, 3);
  assert.equal(state.recentArtifacts.length, 1);
  assert.equal(state.recentArtifacts[0].id, "draft_exact");
  assert.equal(state.recentArtifacts[0].title, "Employment Advice — Revised");
  assert.equal(state.recentArtifacts[0].matterId, "case_exact");
  assert.equal(state.latestCreatedArtifact?.createdByMessageId, "msg_3");
  assert.deepEqual(state.recentTurns[1].attachmentNames, ["terms.pdf"]);
  assert.match(state.recentTurns[1].pageLabel || "", /Employment Matter/);
  assert.ok(state.recentTurns.reduce((total, turn) => total + turn.content.length, 0) <= ASSISTANT_CONVERSATION_STATE_LIMITS.plannerConversationCharacters);
});

test("artifact-aware prompt formatting includes exact document identity and safe attachment names", () => {
  const formatted = conversationMessageForPrompt(message("msg_doc", "assistant", "Created Employment Advice.", {
    attachments: [{ name: "instructions.docx" }],
    document: { id: "draft_123", kind: "matterWorkProduct", title: "Employment Advice", matterId: "case_123" },
  }));
  assert.match(formatted, /Created document: Matter Work Product "Employment Advice"/);
  assert.match(formatted, /artifact ID draft_123/);
  assert.match(formatted, /Matter case_123/);
  assert.match(formatted, /Attachments: instructions\.docx/);
  assert.doesNotMatch(formatted, /access_token/i);
});

test("planner input contains recent conversation and artifact metadata without document contents", async () => {
  let prompt = "";
  const state = buildAssistantConversationState({
    messages: [message("msg_doc", "assistant", "Created the requested memo.", {
      document: { id: "assistant_document_exact", kind: "assistantDocument", title: "Acquisition Memo" },
    })],
  });
  await planAssistantRequest({
    content: "What assumptions did you use in that document?",
    responseMode: "chat",
    enableWebSearch: false,
    forceThorough: false,
    hasTemporaryFiles: false,
    temporaryFileNames: [],
    pageContext: { routeKind: "history", pageTitle: "Assistant" },
    currentMatterId: null,
    conversationState: state,
  }, (async (_task: unknown, messages: Array<{ content: string }>) => {
    prompt = messages[0].content;
    return { text: JSON.stringify({
      intent: "document_analysis",
      depth: "brief",
      needsWorkspace: false,
      needsCurrentPage: false,
      needsWeb: false,
      needsClarification: false,
      toolCalls: [],
    }) };
  }) as any);
  assert.match(prompt, /assistant_document_exact/);
  assert.match(prompt, /Acquisition Memo/);
  assert.doesNotMatch(prompt, /FULL PRIVATE DOCUMENT CONTENT SENTINEL/);
});

test("route loads and saves conversation state before calling the planner", () => {
  const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const route = server.slice(
    server.indexOf('app.post("/api/threads/:id/messages"'),
    server.indexOf('app.put("/api/messages/:id"', server.indexOf('app.post("/api/threads/:id/messages"'))
  );
  assert.ok(route.indexOf("getRecentMessages") < route.indexOf("addMessage("));
  assert.ok(route.indexOf("addMessage(") < route.indexOf("buildAssistantConversationState"));
  assert.ok(route.indexOf("buildAssistantConversationState") < route.indexOf("planAssistantRequest"));
});
