import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Message } from "../src/types.js";
import {
  VOICE_MODE_CONFIG,
  boundedVoiceHistory,
  liveConnectConfig,
  voiceMessageId,
} from "../server/voiceMode.js";
import {
  audioSampleRate,
  downsampleAudio,
  mergeTranscriptChunk,
} from "../src/lib/voiceAudio.js";
import { initializeLiveHistory } from "../src/hooks/useVoiceMode.js";

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
  assert.match(String(config.systemInstruction), /standard Assistant/);
  assert.doesNotMatch(String(config.systemInstruction), /pretend|browser text-to-speech/i);
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

test("Voice Mode lifecycle is separate from standard send and releases microphone, audio, animation, and socket resources", async () => {
  const [assistant, hook] = await Promise.all([
    readFile(new URL("../src/components/AssistantView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
  ]);
  const voiceToggle = assistant.slice(assistant.indexOf("const handleVoiceToggle"), assistant.indexOf("const handleSend"));
  assert.doesNotMatch(voiceToggle, /handleSend/);
  assert.match(voiceToggle, /voiceMode\.start\(threadId\)/);
  assert.match(voiceToggle, /voiceMode\.stop\(\)/);
  assert.match(hook, /getUserMedia/);
  assert.match(hook, /sendRealtimeInput/);
  assert.match(hook, /audioStreamEnd: true/);
  assert.match(hook, /session\.close\(\)/);
  assert.match(hook, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(hook, /context\.close\(\)/);
  assert.match(hook, /cancelAnimationFrame/);
  assert.match(hook, /content\.interrupted[\s\S]*stopPlayback\(\)/);
  assert.match(assistant, /stopIfThreadChanged\(activeThreadId\)/);
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
  assert.match(hook, /inputTranscription\?\.finished/);
  assert.match(hook, /outputTranscription\?\.finished/);
  assert.match(hook, /persistQueueRef/);
  assert.doesNotMatch(hook, /\/messages`,[\s\S]*pageContext|handleSend/);
});

test("ephemeral credential route is authenticated by the established API gate and never exposes the permanent key", async () => {
  const [server, voice] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/voiceMode.ts", import.meta.url), "utf8"),
  ]);
  assert.ok(server.indexOf('app.use(\n    "/api",') < server.indexOf('app.post("/api/threads/:id/voice/token"'));
  const tokenRoute = server.slice(server.indexOf('app.post("/api/threads/:id/voice/token"'), server.indexOf('app.post("/api/threads/:id/voice/messages"'));
  assert.match(tokenRoute, /db\.getThreadById/);
  assert.match(tokenRoute, /Cache-Control", "no-store"/);
  assert.doesNotMatch(tokenRoute, /GEMINI_API_KEY/);
  assert.match(voice, /authTokens\.create/);
  assert.match(voice, /uses: 1/);
  assert.match(voice, /liveConnectConstraints/);
  assert.doesNotMatch(await readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"), /GEMINI_API_KEY|VITE_.*GEMINI/);
});
