import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Message } from "../src/types.js";
import {
  VOICE_MODE_CONFIG,
  boundedVoiceHistory,
  liveConnectConfig,
  voiceCredentialRequest,
  voiceMessageId,
} from "../server/voiceMode.js";
import {
  audioSampleRate,
  downsampleAudio,
  mergeTranscriptChunk,
} from "../src/lib/voiceAudio.js";
import {
  finalizeVoiceTranscripts,
  initializeLiveHistory,
} from "../src/hooks/useVoiceMode.js";

function message(id: string, role: "user" | "assistant", content: string): Message {
  return {
    id,
    thread_id: "thread_voice",
    role,
    content,
    citations: [],
    steps: null,
    created_at: new Date().toISOString(),
  };
}

test("Gemini Live configuration is centralized for native audio, transcription, VAD, and bounded initial history", () => {
  assert.equal(VOICE_MODE_CONFIG.model, "gemini-3.1-flash-live-preview");
  assert.equal(VOICE_MODE_CONFIG.apiVersion, "v1beta");
  const config = liveConnectConfig();
  assert.deepEqual(config.responseModalities, ["AUDIO"]);
  assert.deepEqual(config.inputAudioTranscription, {});
  assert.deepEqual(config.outputAudioTranscription, {});
  assert.equal(config.historyConfig.initialHistoryInClientContent, true);
  assert.equal(config.realtimeInputConfig.automaticActivityDetection.disabled, false);
  assert.equal(config.realtimeInputConfig.automaticActivityDetection.startOfSpeechSensitivity, "START_SENSITIVITY_LOW");
  assert.equal(config.tools[0].functionDeclarations[0].name, "lookup_workspace");
  assert.match(String(config.systemInstruction), /Do not proactively mention or enumerate Voice Mode's capability limitations/);
  assert.match(String(config.systemInstruction), /use lookup_workspace before saying the information is unavailable/);
  assert.match(String(config.systemInstruction), /cannot access an authenticated Exepts page before attempting that lookup/);
  assert.doesNotMatch(String(config.systemInstruction), /Voice Mode is read-only|better handled in the standard Assistant/);
  assert.doesNotMatch(String(config.systemInstruction), /pretend|browser text-to-speech/i);
});

test("ephemeral credential request preserves constrained Live tools without the incompatible additional-field lock", () => {
  const { request } = voiceCredentialRequest(Date.UTC(2026, 7, 10));
  assert.equal(Object.hasOwn(request.config, "lockAdditionalFields"), false);
  assert.equal(request.config.liveConnectConstraints.model, VOICE_MODE_CONFIG.model);
  assert.equal(
    request.config.liveConnectConstraints.config.tools[0].functionDeclarations[0].name,
    "lookup_workspace"
  );
  assert.equal(
    request.config.liveConnectConstraints.config.realtimeInputConfig.automaticActivityDetection.startOfSpeechSensitivity,
    "START_SENSITIVITY_LOW"
  );
});

test("recent text and voice messages seed Live in role order within the character bound", () => {
  const history = boundedVoiceHistory([
    message("1", "user", "Explain clause seven."),
    message("2", "assistant", "It limits liability."),
    message("3", "user", "So what is the main risk?"),
  ]);
  assert.deepEqual(history.map((turn) => turn.role), ["user", "model", "user"]);
  assert.match(history[0].parts[0].text, /clause seven/);
  assert.ok(history.reduce((total, turn) => total + turn.parts[0].text.length, 0) <= VOICE_MODE_CONFIG.historyCharacterLimit);
});

test("empty or malformed Live history completes initialization without sending empty turns", () => {
  for (const history of [[], undefined, null, { turns: [] }]) {
    const calls: unknown[] = [];
    initializeLiveHistory({
      sendClientContent: (params) => { calls.push(params); },
    }, history);
    assert.deepEqual(calls, [{ turnComplete: true }]);
    assert.equal(Object.hasOwn(calls[0] as object, "turns"), false);
  }
});

test("populated Live history is still supplied with turnComplete", () => {
  const history = [
    { role: "user" as const, parts: [{ text: "Explain clause seven." }] },
    { role: "model" as const, parts: [{ text: "It limits liability." }] },
  ];
  const calls: unknown[] = [];
  initializeLiveHistory({
    sendClientContent: (params) => { calls.push(params); },
  }, history);
  assert.deepEqual(calls, [{ turns: history, turnComplete: true }]);
});

test("voice transcript identifiers are deterministic per owned thread, session, role, and final event", () => {
  const input = { threadId: "thread_voice", sessionId: "session_voice_1", eventId: "user_1", role: "user" as const };
  assert.equal(voiceMessageId(input), voiceMessageId(input));
  assert.notEqual(voiceMessageId(input), voiceMessageId({ ...input, role: "assistant" }));
  assert.notEqual(voiceMessageId(input), voiceMessageId({ ...input, threadId: "thread_other" }));
});

test("transcript and PCM helpers avoid repeated revisions and preserve live audio sample contracts", () => {
  assert.equal(mergeTranscriptChunk("This is", "This is final"), "This is final");
  assert.equal(mergeTranscriptChunk("This is final", "final"), "This is final");
  assert.equal(mergeTranscriptChunk("This", "continues"), "This continues");
  assert.equal(downsampleAudio(new Float32Array(480), 48000, 16000).length, 160);
  assert.equal(audioSampleRate("audio/pcm;rate=24000"), 24000);
});

test("server turn completion finalizes user and assistant separately in conversational order", () => {
  const result = finalizeVoiceTranscripts({
    user: " What matters do we currently have? ",
    assistant: " Here are the current matters. ",
  }, "turnComplete");
  assert.deepEqual(result.completed, [
    { role: "user", content: "What matters do we currently have?" },
    { role: "assistant", content: "Here are the current matters." },
  ]);
  assert.deepEqual(result.remaining, { user: "", assistant: "" });
});

test("assistant-only greeting completes independently and cannot merge into the next answer", () => {
  const greeting = finalizeVoiceTranscripts({ user: "", assistant: "How can I help?" }, "turnComplete");
  const answer = finalizeVoiceTranscripts({
    ...greeting.remaining,
    user: mergeTranscriptChunk(greeting.remaining.user, "What matters do we currently have?"),
    assistant: mergeTranscriptChunk(greeting.remaining.assistant, "Here are the current matters."),
  }, "turnComplete");
  assert.deepEqual(greeting.completed, [{ role: "assistant", content: "How can I help?" }]);
  assert.deepEqual(answer.completed, [
    { role: "user", content: "What matters do we currently have?" },
    { role: "assistant", content: "Here are the current matters." },
  ]);
});

test("completed turns reset accumulation so follow-up speech creates new messages", () => {
  const first = finalizeVoiceTranscripts({ user: "First question", assistant: "First answer" }, "turnComplete");
  const second = finalizeVoiceTranscripts({
    user: mergeTranscriptChunk(first.remaining.user, "Follow-up question"),
    assistant: mergeTranscriptChunk(first.remaining.assistant, "Follow-up answer"),
  }, "turnComplete");
  assert.deepEqual(first.completed, [
    { role: "user", content: "First question" },
    { role: "assistant", content: "First answer" },
  ]);
  assert.deepEqual(second.completed, [
    { role: "user", content: "Follow-up question" },
    { role: "assistant", content: "Follow-up answer" },
  ]);
});

test("interruption finalizes only received assistant output and preserves next user accumulation", () => {
  const interrupted = finalizeVoiceTranscripts({
    user: "Next user question",
    assistant: "Partial received answer",
  }, "interrupted");
  assert.deepEqual(interrupted.completed, [
    { role: "assistant", content: "Partial received answer" },
  ]);
  assert.deepEqual(interrupted.remaining, { user: "Next user question", assistant: "" });

  const next = finalizeVoiceTranscripts({
    user: interrupted.remaining.user,
    assistant: mergeTranscriptChunk(interrupted.remaining.assistant, "New answer"),
  }, "turnComplete");
  assert.deepEqual(next.completed, [
    { role: "user", content: "Next user question" },
    { role: "assistant", content: "New answer" },
  ]);
});

test("Voice Mode lifecycle is separate from standard send and releases microphone, audio, animation, and socket resources", async () => {
  const [assistant, hook] = await Promise.all([
    readFile(new URL("../src/components/AssistantView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
  ]);
  const voiceToggle = assistant.slice(assistant.indexOf("const handleVoiceToggle"), assistant.indexOf("const handleSend"));
  assert.doesNotMatch(voiceToggle, /handleSend/);
  assert.match(voiceToggle, /voiceMode\.start\(threadId, pageContext\)/);
  assert.match(voiceToggle, /voiceMode\.stop\(\)/);
  assert.match(hook, /getUserMedia/);
  assert.match(hook, /sendRealtimeInput/);
  assert.match(hook, /audioStreamEnd: true/);
  assert.match(hook, /session\.close\(\)/);
  assert.match(hook, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(hook, /context\.close\(\)/);
  assert.match(hook, /cancelAnimationFrame/);
  assert.match(hook, /content\.interrupted[\s\S]*stopPlayback\(\)/);
  const amplitudeLoop = hook.slice(hook.indexOf("const beginAmplitudeUpdates"), hook.indexOf("const start"));
  assert.doesNotMatch(amplitudeLoop, /stopPlayback|microphoneLevel\s*>/);
  assert.doesNotMatch(hook, /suppressPlaybackRef/);
  assert.match(assistant, /stopIfThreadChanged\(activeThreadId\)/);
});

test("active Voice sessions receive current navigation context without reconnecting", async () => {
  const [assistant, hook] = await Promise.all([
    readFile(new URL("../src/components/AssistantView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
  ]);
  assert.match(hook, /const updatePageContext = useCallback\(\(pageContext: WorkspacePageContext\) => \{\s*pageContextRef\.current = pageContext;\s*\}, \[\]\)/);
  assert.match(assistant, /useEffect\(\(\) => \{\s*voiceMode\.updatePageContext\(pageContext\);\s*\}, \[pageContext, voiceMode\.updatePageContext\]\)/);
  const update = hook.slice(hook.indexOf("const updatePageContext"), hook.indexOf("return {", hook.indexOf("const updatePageContext")));
  assert.doesNotMatch(update, /connect|token|transcript|playback|releaseResources|sessionRef/);
  assert.match(hook, /body: JSON\.stringify\(\{ query, pageContext \}\)/);
});

test("finalized transcripts use a narrow idempotent owned route and never invoke standard generation", async () => {
  const [server, database, hook] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/db.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
  ]);
  const route = server.slice(
    server.indexOf('app.post("/api/threads/:id/voice/messages"'),
    server.indexOf('// Core Legal Search')
  );
  assert.match(route, /ownership\(req\)/);
  assert.match(route, /db\.getThreadById/);
  assert.match(route, /db\.addVoiceMessage/);
  assert.match(route, /interactionMode: "voice"/);
  assert.doesNotMatch(route, /planAssistantRequest|orchestrateAssistantRetrieval|completeAssistantResponse|callModel/);
  const persistence = database.slice(database.indexOf("public async addVoiceMessage"), database.indexOf("public async updateMessage"));
  assert.match(persistence, /t\.user_id = \$6/);
  assert.match(persistence, /c\.firm_id = \$7/);
  assert.match(persistence, /ON CONFLICT \(id\) DO NOTHING/);
  assert.doesNotMatch(hook, /inputTranscription\?\.finished|outputTranscription\?\.finished/);
  assert.match(hook, /content\.turnComplete[\s\S]*finalizeTranscripts\("turnComplete"\)/);
  assert.match(hook, /content\.interrupted[\s\S]*finalizeTranscripts\("interrupted"\)/);
  assert.match(hook, /persistQueueRef/);
  const transcriptPersistence = hook.slice(hook.indexOf("const persistFinalTranscript"), hook.indexOf("const finalizeTranscripts"));
  assert.doesNotMatch(transcriptPersistence, /pageContext|handleSend/);
});

test("ephemeral credential route is authenticated by the established API gate and never exposes the permanent key", async () => {
  const [server, voice] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/voiceMode.ts", import.meta.url), "utf8"),
  ]);
  assert.ok(server.indexOf('app.use(\n    "/api",') < server.indexOf('app.post("/api/threads/:id/voice/token"'));
  const tokenRoute = server.slice(server.indexOf('app.post("/api/threads/:id/voice/token"'), server.indexOf('app.post("/api/threads/:id/voice/messages"'));
  assert.match(tokenRoute, /db\.getThreadById/);
  assert.match(tokenRoute, /validateVoicePageContext\(req\.body\.pageContext, requestOwnership\)/);
  assert.match(tokenRoute, /sessionContextForPrompt/);
  assert.match(tokenRoute, /selectedEvidence/);
  assert.match(tokenRoute, /Cache-Control", "no-store"/);
  assert.doesNotMatch(tokenRoute, /GEMINI_API_KEY/);
  assert.match(voice, /authTokens\.create/);
  assert.match(voice, /uses: 1/);
  assert.match(voice, /liveConnectConstraints/);
  assert.doesNotMatch(voice, /lockAdditionalFields/);
  assert.doesNotMatch(await readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"), /GEMINI_API_KEY|VITE_.*GEMINI/);
});

test("Voice workspace lookup is narrow, read-only, and derives scope from validated page context", async () => {
  const [server, hook] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
  ]);
  const lookupRoute = server.slice(
    server.indexOf('app.post("/api/threads/:id/voice/lookup"'),
    server.indexOf('app.post("/api/threads/:id/voice/messages"')
  );
  assert.match(lookupRoute, /ownership\(req\)/);
  assert.match(lookupRoute, /db\.getThreadById/);
  assert.match(lookupRoute, /validateVoicePageContext\(req\.body\.pageContext, requestOwnership\)/);
  assert.match(lookupRoute, /voiceLookupCalls\(validated\.pageContext, query\)/);
  assert.match(lookupRoute, /currentMatterId: validated\.currentMatter\?\.id \|\| null/);
  assert.match(lookupRoute, /CURRENT AUTHORIZED PAGE:/);
  assert.match(lookupRoute, /pageContextForPrompt\(validated\.pageContext\)/);
  assert.match(lookupRoute, /db\.getHistoryThreads\(requestOwnership\)/);
  assert.doesNotMatch(server, /currentMatterId !== threadMatterId|Voice page context does not match this conversation/);
  assert.doesNotMatch(lookupRoute, /req\.body\.(?:matterId|documentId|scope)|needsWeb: true|\b(?:create|update|delete|share|send|invite)\w*\(/);
  assert.match(hook, /\/voice\/lookup/);
  assert.match(hook, /session\.sendToolResponse/);
  assert.match(hook, /functionResponses:\s*\[\{/);
});

test("Voice workspace lookup is page-first across authenticated workspace sections", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  const calls = server.slice(server.indexOf("function voiceLookupCalls"), server.indexOf("const PROFESSIONAL_ROLES"));
  assert.match(calls, /routeKind === "matters"\) add\(\{ name: "list_matters"/);
  assert.match(calls, /section === "overview"\) add\(\{ name: "get_matter_overview"/);
  assert.match(calls, /section === "sources"\) add\(\{ name: "list_matter_sources"/);
  assert.match(calls, /section === "matter intelligence"\) add\(\{ name: "get_matter_intelligence"/);
  assert.match(calls, /section === "work product"\) add\(\{ name: "list_matter_work_products"/);
  assert.match(calls, /section === "collaboration"\) add\(\{ name: "get_matter_collaboration_summary"/);
  assert.match(calls, /routeKind === "library"[\s\S]*list_firm_library_documents/);
  assert.match(calls, /kind === "source"[\s\S]*get_matter_source[\s\S]*documentId: selected\.id, query/);
  assert.match(calls, /kind === "workProduct"[\s\S]*get_work_product[\s\S]*workProductId: selected\.id, query/);
  assert.match(calls, /kind === "libraryDocument"[\s\S]*get_firm_library_document/);
  assert.match(calls, /kind === "assistantDocument"[\s\S]*get_assistant_document/);
  assert.ok(calls.indexOf("// An explicitly open item") < calls.indexOf("// The validated current route"));
  assert.ok(calls.indexOf("// The validated current route") < calls.indexOf("// Query terms may add evidence"));
});

test("selected Work Product lookup keeps bounded query-relevant access beyond its initial context prefix", async () => {
  const executor = await readFile(new URL("../server/assistant/assistantToolExecutor.ts", import.meta.url), "utf8");
  const relevant = executor.slice(executor.indexOf("function boundedRelevantContent"), executor.indexOf("function conservativeMatterMatches"));
  assert.match(relevant, /content\.slice\(start, start \+ 3_000\)/);
  assert.match(relevant, /lexicalOverlap\(query, text\)/);
  assert.match(relevant, /slice\(0, 4\)/);
  const workProduct = executor.slice(executor.indexOf('case "get_work_product"'), executor.indexOf('case "get_matter_collaboration_summary"'));
  assert.match(workProduct, /boundedRelevantContent\(draft\.content, stringArgument\(call, "query", 4_000\)\)/);
});

test("live Voice transcriptions render as temporary messages and yield to saved messages without standard generation", async () => {
  const [assistant, hook] = await Promise.all([
    readFile(new URL("../src/components/AssistantView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
  ]);
  assert.match(hook, /liveTranscripts/);
  assert.match(hook, /setLiveTranscripts[\s\S]*inputTranscription/);
  assert.match(hook, /setLiveTranscripts[\s\S]*outputTranscription/);
  assert.match(hook, /onTranscriptRef\.current\(data\)[\s\S]*current\[role\]\.trim\(\) === normalized/);
  assert.match(assistant, /const displayMessages = \[\.\.\.messages, \.\.\.liveTranscriptMessages\]/);
  assert.match(assistant, /displayMessages\.length > 0/);
  assert.match(assistant, /displayMessages\.map/);
  assert.match(assistant, /liveVoiceTranscript/);
  assert.doesNotMatch(assistant.slice(assistant.indexOf("const liveTranscriptMessages"), assistant.indexOf("// New docked side editor")), /handleSend|\/messages/);
});
