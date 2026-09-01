import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createAssistantDeliverable } from "../server/assistant/assistantDeliverables.js";
import { mergeGeneratedTextChunk, generateContentStreamWithClient } from "../server/model.js";
import {
  applyAssistantDraftPreview,
  isAssistantNdjsonResponse,
  parseAssistantNdjsonBuffer,
} from "../src/lib/assistantMessageResponse.js";

const emptyState = {
  rollingMemory: "",
  recentTurns: [],
  recentArtifacts: [],
  recentResearchSources: [],
  latestCreatedArtifact: null,
};

test("generated text chunks accept both deltas and cumulative snapshots", () => {
  assert.equal(mergeGeneratedTextChunk("", "Hello"), "Hello");
  assert.equal(mergeGeneratedTextChunk("Hello", " world"), "Hello world");
  assert.equal(mergeGeneratedTextChunk("Hello", "Hello world"), "Hello world");
});

test("draft stream events are display-only previews and never persist themselves", () => {
  assert.equal(isAssistantNdjsonResponse("application/x-ndjson; charset=utf-8"), true);
  assert.equal(isAssistantNdjsonResponse("application/json"), false);
  assert.equal(applyAssistantDraftPreview("Parties", { type: "draft_delta", text: " agree" }), "Parties agree");
  assert.equal(applyAssistantDraftPreview("Parties agree", { type: "draft_reset" }), "");
  const parsed = parseAssistantNdjsonBuffer('{"type":"draft_delta","text":"A"}\n{"type":"complete"}\npartial');
  assert.deepEqual(parsed.events, [{ type: "draft_delta", text: "A" }, { type: "complete" }]);
  assert.equal(parsed.rest, "partial");
});

test("streaming generation falls back to generateContent and emits one display chunk", async () => {
  const chunks: string[] = [];
  const result = await generateContentStreamWithClient("draft-generation", [{ role: "user", content: "Draft" }], {}, {
    models: {
      generateContent: async () => ({ text: "# Policy\n\nBody." }),
    },
  }, (event) => {
    if (event.text) chunks.push(event.text);
  });
  assert.equal(result.text, "# Policy\n\nBody.");
  assert.deepEqual(chunks, ["# Policy\n\nBody."]);
});

test("document streaming uses the same save path and only forwards display chunks", async () => {
  const chunks: Array<{ text?: string; reset?: boolean }> = [];
  let savedContent = "";
  const result = await createAssistantDeliverable({
    plan: {
      intent: "document_creation",
      depth: "standard",
      needsWorkspace: false,
      needsCurrentPage: false,
      needsWeb: false,
      needsClarification: false,
      deliverable: { kind: "document", documentAction: "create" },
      referencedArtifactIds: [],
      referencedResearchSourceIds: [],
      toolCalls: [],
    },
    thread: { id: "thread_1", title: "Advice", scope: "general", case_id: null } as any,
    currentMatter: null,
    conversationState: emptyState,
    evidence: [],
    webResearch: { performed: false, report: "", citations: [], questions: [] },
    ownership: { userId: "user_1", firmId: "firm_1" },
    account: {
      user: { id: "user_1", email: "lawyer@example.test", name: "Lawyer" },
      firm: { id: "firm_1", name: "Example LLP" },
    } as any,
    instruction: "Create a policy.",
    pageContext: { routeKind: "history", pageTitle: "Assistant" },
    conversationContext: "",
    database: {
      createAssistantDocument: async (_threadId: string, title: string, content: string) => {
        savedContent = content;
        return { id: "assistant_document_new", title };
      },
    } as any,
    streamModel: (async (_task, _messages, _options, onChunk) => {
      onChunk?.({ text: "# Privacy Policy\n\n" });
      onChunk?.({ text: "## Scope\nThis policy applies." });
      return { text: "# Privacy Policy\n\n## Scope\nThis policy applies." };
    }) as any,
    onDraftChunk: (event) => chunks.push(event),
  });
  assert.equal(result.document.kind, "assistantDocument");
  assert.equal(savedContent, "# Privacy Policy\n\n## Scope\nThis policy applies.");
  assert.deepEqual(chunks, [
    { text: "# Privacy Policy\n\n" },
    { text: "## Scope\nThis policy applies." },
  ]);
});

test("document draft streaming leaves the saved Assistant turn and Work Product path unchanged", async () => {
  const [server, assistant, deliverables, hook] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("server/assistant/assistantDeliverables.ts", "utf8"),
    readFile("src/hooks/useVoiceMode.ts", "utf8"),
  ]);
  const route = server.slice(
    server.indexOf('app.post("/api/threads/:id/messages"'),
    server.indexOf('// PUT route for updating a message')
  );
  const voiceRoute = server.slice(
    server.indexOf('app.post("/api/threads/:id/voice/assistant"'),
    server.indexOf('app.post("/api/threads/:id/voice/messages"')
  );
  assert.match(route, /writeAssistantDraftNdjson\(res, \{ type: "draft_delta"/);
  assert.match(route, /writeAssistantDraftNdjson\(res, \{ type: "complete"/);
  assert.doesNotMatch(voiceRoute, /writeAssistantDraftNdjson\(res, \{ type: "draft_delta"/);
  assert.match(voiceRoute, /return res\.json\(/);
  assert.match(route, /completeAssistantResponse/);
  assert.match(voiceRoute, /completeAssistantResponse/);
  assert.match(route, /publicAssistantMessage\(assistantMessage\)/);
  assert.match(deliverables, /cleanGeneratedWorkProductContent\(result\.text\)/);
  assert.match(assistant, /setDraftStream\(null\)/);
  assert.match(assistant, /streamedResponse \? savedAssistantMessage\.content : ""/);
  assert.match(hook, /consumeVoiceAssistantCapabilityResponse/);
  assert.doesNotMatch(hook, /onDraftDelta/);
  assert.doesNotMatch(assistant, /db\.createDraft|createAssistantDocument/);
});

test("voice capability responses stream draft previews and finish with the saved deliverable payload", async () => {
  const { consumeVoiceAssistantCapabilityResponse } = await import("../src/lib/assistantMessageResponse.js");
  const deltas: string[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"type":"draft_delta","text":"# Memo\\n\\n"}\n'));
      controller.enqueue(new TextEncoder().encode('{"type":"draft_delta","text":"Body."}\n'));
      controller.enqueue(new TextEncoder().encode('{"type":"complete","result":"I have created the **Memo**.","capabilityMetadata":{"document":{"id":"doc_1","kind":"assistantDocument","title":"Memo"}}}\n'));
      controller.close();
    },
  });
  const response = new Response(body, {
    status: 201,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
  const data = await consumeVoiceAssistantCapabilityResponse(response, {
    onDraftDelta: (preview) => deltas.push(preview),
  });
  assert.deepEqual(deltas, ["# Memo\n\n", "# Memo\n\nBody."]);
  assert.equal(data.result, "I have created the **Memo**.");
  assert.deepEqual(data.capabilityMetadata?.document, { id: "doc_1", kind: "assistantDocument", title: "Memo" });
});
