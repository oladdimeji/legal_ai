import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Message } from "../src/types.js";
import { assistantDocumentConfirmationContent } from "../server/assistant/assistantCompletion.js";
import {
  VOICE_MODE_ACKNOWLEDGEMENT,
  VOICE_MODE_CONFIG,
  VOICE_MODE_DOCUMENT_CONFIRMATION,
  VOICE_MODE_REVISION_CONFIRMATION,
  boundedVoiceHistory,
  liveConnectConfig,
  resolveFirmLibraryTitle,
  voiceCredentialRequest,
  voiceAcknowledgementRequest,
  voiceDocumentConfirmationSpeech,
  voiceMessageId,
} from "../server/voiceMode.js";
import {
  audioSampleRate,
  createStreamingDownsampler,
  downsampleAudio,
  mergeTranscriptChunk,
} from "../src/lib/voiceAudio.js";
import {
  finalizeVoiceTranscripts,
  initializeLiveHistory,
  looksLikeVoiceDocumentRequest,
  pushVoiceStartupPacket,
  shouldPlayVoiceAcknowledgement,
  shouldUseVoiceAssistantCapability,
  shouldAdvanceVoiceTurnBoundary,
  shouldHoldVoiceCapture,
  usesVoiceRevisionConfirmation,
  voiceAssistantInstruction,
  voicePrefetchStillValid,
  VOICE_STARTUP_BUFFER_PACKETS,
  VOICE_TOKEN_PREFETCH_TTL_MS,
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
  assert.deepEqual(
    config.tools[0].functionDeclarations.map((declaration) => declaration.name),
    ["lookup_workspace", "use_assistant_capabilities"]
  );
  assert.match(String(config.systemInstruction), /Do not proactively mention or enumerate Voice Mode's capability limitations/);
  assert.match(String(config.systemInstruction), /Ordinary authorized read-only retrieval is an internal step and does not require separate permission/);
  assert.match(String(config.systemInstruction), /Use lookup_workspace as the fast path for straightforward authorized retrieval/);
  assert.match(String(config.systemInstruction), /Use use_assistant_capabilities only when the user asks you to create, draft, write, prepare, generate, or revise a document/);
  assert.match(String(config.systemInstruction), /answer the user directly without calling any function/);
  assert.match(String(config.systemInstruction), /named Firm Library documents even when they are not currently open/);
  assert.match(String(config.systemInstruction), /Before saying authenticated workspace information is unavailable, use the appropriate function/);
  assert.match(String(config.systemInstruction), /measured conversational pace/);
  assert.match(String(config.systemInstruction), /Never fabricate progress/);
  assert.match(String(config.systemInstruction), /Treat both functions as your own internal actions/);
  assert.match(String(config.systemInstruction), /report it as your own completed work in the first person/);
  assert.match(String(config.systemInstruction), /Never mention function names, tools, capabilities, delegation, or another Assistant/);
  assert.match(String(config.systemInstruction), /call use_assistant_capabilities immediately as your first action in the turn, before producing any spoken audio/);
  assert.match(String(config.systemInstruction), /After that function returns, remain silent/);
  assert.match(String(config.systemInstruction), /Do not speak a confirmation or read the document aloud/);
  assert.doesNotMatch(String(config.systemInstruction), /speak one short confirmation/);
  assert.doesNotMatch(String(config.systemInstruction), /Voice Mode is read-only|better handled in the standard Assistant/);
  assert.doesNotMatch(String(config.systemInstruction), /pretend|browser text-to-speech/i);
  assert.doesNotMatch(String(config.systemInstruction), /you may give one short, natural acknowledgement/i);
});

test("Voice Mode stays silent on open, drops unexpected opening audio, and never saves it", async () => {
  const hook = await readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8");
  const instruction = String(liveConnectConfig().systemInstruction);

  assert.match(instruction, /remain completely silent and wait for the user to speak/);
  assert.match(instruction, /Do not greet, welcome, introduce yourself/);
  assert.match(instruction, /If the user speaks first, answer the user directly/);
  assert.doesNotMatch(instruction, /open with a single short, warm spoken line/);

  assert.match(hook, /const awaitingOpeningTurnRef = useRef\(false\)/);
  assert.match(hook, /awaitingOpeningTurnRef\.current = true/);
  assert.match(hook, /if \(awaitingOpeningTurnRef\.current\) continue;/);
  assert.match(hook, /content\.outputTranscription\?\.text && !awaitingOpeningTurnRef\.current/);
  assert.match(hook, /content\.inputTranscription\?\.text\) \{\s*awaitingOpeningTurnRef\.current = false/);
  assert.match(hook, /content\.interrupted\) \{\s*awaitingOpeningTurnRef\.current = false/);
  assert.match(hook, /content\.turnComplete\) \{\s*awaitingOpeningTurnRef\.current = false/);
});

test("Voice acknowledgement TTS reuses the configured Voice Agent identity and fixed phrase", () => {
  const request = voiceAcknowledgementRequest();
  assert.equal(VOICE_MODE_ACKNOWLEDGEMENT.text, "Absolutely — give me a moment, I’m working on that now.");
  assert.equal(request.model, "gemini-3.1-flash-tts-preview");
  assert.deepEqual(request.config.responseModalities, ["AUDIO"]);
  assert.equal(
    request.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
    VOICE_MODE_CONFIG.voiceName
  );
  assert.equal(VOICE_MODE_CONFIG.voiceName, "Kore");
  assert.equal(VOICE_MODE_DOCUMENT_CONFIRMATION.text, "I have created the document for you.");
  assert.equal(VOICE_MODE_REVISION_CONFIRMATION.text, "I have created a revised version for you.");
  assert.equal(VOICE_MODE_DOCUMENT_CONFIRMATION.model, VOICE_MODE_ACKNOWLEDGEMENT.model);
  assert.equal(VOICE_MODE_REVISION_CONFIRMATION.model, VOICE_MODE_ACKNOWLEDGEMENT.model);
});

test("Voice acknowledgement eligibility is document-capability-only and once per existing turn boundary", () => {
  assert.equal(shouldPlayVoiceAcknowledgement("use_assistant_capabilities", "Draft an NDA.", 7, null), true);
  assert.equal(shouldPlayVoiceAcknowledgement("use_assistant_capabilities", "Draft an NDA.", 7, 6), true);
  assert.equal(shouldPlayVoiceAcknowledgement("use_assistant_capabilities", "Draft an NDA.", 7, 7), false);
  assert.equal(shouldPlayVoiceAcknowledgement("use_assistant_capabilities", "What is the limitation period?", 7, null), false);
  assert.equal(shouldPlayVoiceAcknowledgement("lookup_workspace", "Draft an NDA.", 7, null), false);
  assert.equal(shouldPlayVoiceAcknowledgement(undefined, "Draft an NDA.", 7, null), false);
  assert.equal(shouldUseVoiceAssistantCapability("Revise the agreement."), true);
  assert.equal(shouldUseVoiceAssistantCapability("Research the latest case law."), false);
});

test("Voice capability metadata waits through contentless completion but remains discarded after interruption", async () => {
  const hook = await readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8");
  const capabilityTurnBoundary = 9;
  let currentTurnBoundary = capabilityTurnBoundary;

  assert.equal(shouldAdvanceVoiceTurnBoundary("turnComplete", true), false);
  assert.equal(currentTurnBoundary, capabilityTurnBoundary);
  assert.equal(capabilityTurnBoundary === currentTurnBoundary, true);

  assert.equal(shouldAdvanceVoiceTurnBoundary("interrupted", true), true);
  currentTurnBoundary += 1;
  assert.equal(capabilityTurnBoundary === currentTurnBoundary, false);

  const completion = hook.slice(hook.indexOf("if (content.turnComplete)"), hook.indexOf("  }, [clearWorking", hook.indexOf("if (content.turnComplete)")));
  assert.match(completion, /inFlightAssistantCapabilityTurnsRef/);
  assert.match(completion, /shouldAdvanceVoiceTurnBoundary/);
  assert.match(completion, /finalizeTranscripts\("turnComplete", false\)/);
  assert.match(hook, /pausedAssistantCapabilityTurnRef\.current === turnBoundaryRef\.current[\s\S]*pendingCapabilityMetadataRef\.current = null[\s\S]*turnBoundaryRef\.current \+= 1/);
});

test("a completed turn cannot retire an Assistant capability boundary while its call is still running", async () => {
  const hook = await readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8");

  // The model routinely speaks a short filler line before the deliverable arrives.
  // Treating that as a finished turn orphaned the capability metadata, so the
  // returned document never reached the saved assistant message as a card.
  assert.equal(shouldAdvanceVoiceTurnBoundary("turnComplete", true), false);
  assert.equal(shouldAdvanceVoiceTurnBoundary("turnComplete", false), true);
  assert.equal(shouldAdvanceVoiceTurnBoundary("interrupted", true), true);
  assert.equal(shouldAdvanceVoiceTurnBoundary("interrupted", false), true);

  assert.match(hook, /shouldAdvanceVoiceTurnBoundary\(\s*"turnComplete",\s*hasInFlightAssistantCapability\s*\)/);
  assert.doesNotMatch(hook, /shouldAdvanceVoiceTurnBoundary\([^)]*transcriptRef/);
});

test("spoken document instructions start the Assistant draft path without waiting for Live to finish talking", async () => {
  const [hook, assistant] = await Promise.all([
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AssistantView.tsx", import.meta.url), "utf8"),
  ]);
  const toolHandler = hook.slice(hook.indexOf("const handleServerMessage"), hook.indexOf("const beginAmplitudeUpdates"));

  assert.equal(looksLikeVoiceDocumentRequest("Draft an NDA for the Acme engagement."), true);
  assert.equal(looksLikeVoiceDocumentRequest("Please write a client advice letter."), true);
  assert.equal(looksLikeVoiceDocumentRequest("Revise the agreement to add a termination clause."), true);
  assert.equal(looksLikeVoiceDocumentRequest("How should I draft a memorandum?"), false);
  assert.equal(looksLikeVoiceDocumentRequest("What is the limitation period?"), false);
  assert.equal(voiceAssistantInstruction("Draft an NDA.", "Please create a document"), "Draft an NDA.");
  assert.equal(voiceAssistantInstruction("  ", "Please create a document"), "Please create a document");

  assert.match(toolHandler, /maybeStartVoiceDocumentCapability/);
  assert.match(toolHandler, /looksLikeVoiceDocumentRequest\(userTranscript\)/);
  assert.match(toolHandler, /voiceAssistantInstruction\(/);
  assert.match(toolHandler, /assistantCapabilityPromisesRef\.current\.get\(turnBoundary\)/);
  assert.match(toolHandler, /setLiveDeliverable\(deliverable\)/);
  assert.match(toolHandler, /inlineData\.mimeType\?\.startsWith\("audio\/"\)[\s\S]*maybeStartVoiceDocumentCapability\(\)/);
  assert.match(toolHandler, /outputTranscription\?\.text && !awaitingOpeningTurnRef\.current[\s\S]*maybeStartVoiceDocumentCapability\(\)/);
  assert.match(hook, /liveDeliverable/);
  assert.match(assistant, /voiceMode\.liveDeliverable/);
  assert.match(assistant, /id: "voice-live-deliverable"/);
  assert.doesNotMatch(toolHandler, /persistFinalTranscript|voice\/messages/);
});

test("Voice acknowledgement is cached, isolated, fail-open, prefetched, and cleaned up with shared playback", async () => {
  const [server, hook, voiceMode] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/voiceMode.ts", import.meta.url), "utf8"),
  ]);
  const route = server.slice(
    server.indexOf('app.get("/api/threads/:id/voice/acknowledgement"'),
    server.indexOf('app.get("/api/threads/:id/voice/confirmation"')
  );
  assert.match(route, /db\.getThreadById\(req\.params\.id, ownership\(req\)\)/);
  assert.match(route, /getVoiceAcknowledgementAudio\(\)/);
  assert.match(route, /status\(502\)/);
  assert.doesNotMatch(route, /db\.addMessage|db\.addVoiceMessage|voice\/messages/);
  assert.match(voiceMode, /voiceAcknowledgementAudioCache = new Map/);
  assert.match(voiceMode, /getVoiceAcknowledgementAudioFor/);
  assert.equal((voiceMode.match(/models\.generateContent/g) ?? []).length, 1);

  const prefetch = hook.slice(hook.indexOf("const prefetchAcknowledgement"), hook.indexOf("const prefetchConfirmation"));
  assert.match(prefetch, /voice\/acknowledgement/);
  assert.match(prefetch, /acknowledgementRequestRef\.current/);
  assert.equal((prefetch.match(/\.catch\(\(\) => null\);/g) ?? []).length, 1);
  assert.doesNotMatch(prefetch, /setError|fail\(|transcriptRef|setLiveTranscripts|persistFinalTranscript/);

  const toolHandler = hook.slice(hook.indexOf("const handleServerMessage"), hook.indexOf("const beginAmplitudeUpdates"));
  assert.match(toolHandler, /shouldPlayVoiceAcknowledgement\(call\.name, request, turnBoundary, acknowledgedTurnRef\.current\)/);
  assert.match(toolHandler, /shouldUseVoiceAssistantCapability\(request\)/);
  assert.match(toolHandler, /VOICE_DIRECT_ANSWER_TOOL_RESPONSE/);
  assert.ok(toolHandler.indexOf("scheduleAudio(acknowledgementAudio.data") < toolHandler.indexOf("await fetch("));
  assert.match(toolHandler, /voice\/assistant/);
  assert.match(toolHandler, /voice\/lookup/);
  assert.match(toolHandler, /session\.sendToolResponse/);
  assert.doesNotMatch(toolHandler, /session\.close|live\.connect|persistFinalTranscript|voice\/messages/);

  const start = hook.slice(hook.indexOf("const start"), hook.indexOf("const stop ="));
  assert.match(start, /sessionRef\.current = session;[\s\S]*prefetchAcknowledgement\(threadId, lifecycle\)/);
  assert.match(start, /prefetchConfirmation\(threadId, lifecycle\)/);
  const cleanup = hook.slice(hook.indexOf("const releaseResources"), hook.indexOf("const fail"));
  assert.match(cleanup, /stopPlayback\(\)/);
  assert.match(cleanup, /acknowledgedTurnRef\.current = null/);
  assert.match(cleanup, /acknowledgementAudioRef\.current = null/);
  assert.match(cleanup, /acknowledgementRequestRef\.current = null/);
  assert.match(cleanup, /confirmationAudioRef\.current = null/);
  assert.match(cleanup, /revisionConfirmationAudioRef\.current = null/);
  assert.match(cleanup, /confirmationRequestRef\.current = null/);
  assert.doesNotMatch(hook, /speechSynthesis|SpeechSynthesisUtterance|webkitSpeechRecognition|SpeechRecognition/);
  assert.doesNotMatch(hook, /playbackRate/);
});

test("Voice document completion keeps one card result and speaks a cached confirmation clip", async () => {
  const [server, hook, voiceMode, completion] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/voiceMode.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/assistant/assistantCompletion.ts", import.meta.url), "utf8"),
  ]);
  assert.equal(
    assistantDocumentConfirmationContent("create", "Employment Advice"),
    "I have created the **Employment Advice**."
  );
  assert.equal(
    assistantDocumentConfirmationContent("revise", "Employment Advice"),
    "I have created a revised version of **Employment Advice**."
  );
  assert.equal(
    voiceDocumentConfirmationSpeech("I have created the **Employment Advice**."),
    "I have created the Employment Advice."
  );
  assert.equal(
    voiceDocumentConfirmationSpeech("I have created a revised version of **NDA**."),
    "I have created a revised version of NDA."
  );
  assert.equal(voiceDocumentConfirmationSpeech("Absolutely — give me a moment, I’m working on that now."), null);
  assert.equal(voiceDocumentConfirmationSpeech("Please read this advice aloud."), null);
  assert.match(completion, /assistantDocumentConfirmationContent\(input\.plan\.deliverable\.documentAction, deliverable\.document\.title\)/);
  assert.doesNotMatch(completion, /onDraftTitle/);

  assert.equal(usesVoiceRevisionConfirmation({ assistantIntent: "document_creation" }), false);
  assert.equal(usesVoiceRevisionConfirmation({ assistantIntent: "document_revision" }), true);
  assert.equal(usesVoiceRevisionConfirmation({ sourceDocument: { id: "doc_1" } }), true);

  const confirmationRoute = server.slice(
    server.indexOf('app.get("/api/threads/:id/voice/confirmation"'),
    server.indexOf('app.post("/api/threads/:id/voice/lookup"')
  );
  assert.match(confirmationRoute, /db\.getThreadById\(req\.params\.id, ownership\(req\)\)/);
  assert.match(confirmationRoute, /getVoiceConfirmationAudio\(\)/);
  assert.match(confirmationRoute, /getVoiceRevisionConfirmationAudio\(\)/);
  assert.match(confirmationRoute, /status\(502\)/);
  assert.doesNotMatch(confirmationRoute, /db\.addMessage|db\.addVoiceMessage|voice\/messages|req\.body\.text/);

  const assistantRoute = server.slice(
    server.indexOf('app.post("/api/threads/:id/voice/assistant"'),
    server.indexOf('app.post("/api/threads/:id/voice/messages"')
  );
  assert.doesNotMatch(assistantRoute, /onDraftTitle|prefetchVoiceConfirmationAudio|peekReadyVoiceConfirmationAudio|confirmationAudio/);
  assert.doesNotMatch(assistantRoute, /voice\/confirmation/);

  assert.match(voiceMode, /getVoiceConfirmationAudio\(\)/);
  assert.match(voiceMode, /getVoiceRevisionConfirmationAudio\(\)/);
  assert.match(voiceMode, /warmupVoiceSpeechAudio/);
  assert.match(voiceMode, /getVoiceAcknowledgementAudioFor\(VOICE_MODE_DOCUMENT_CONFIRMATION\)/);
  assert.match(voiceMode, /getVoiceAcknowledgementAudioFor\(VOICE_MODE_REVISION_CONFIRMATION\)/);
  assert.doesNotMatch(voiceMode, /voiceConfirmationAudioCache|peekReadyVoiceConfirmationAudio|prefetchVoiceConfirmationAudio\(/);
  assert.equal((voiceMode.match(/models\.generateContent/g) ?? []).length, 1);
  assert.match(server, /warmupVoiceSpeechAudio\(\)/);

  const toolHandler = hook.slice(hook.indexOf("const handleServerMessage"), hook.indexOf("const beginAmplitudeUpdates"));
  const assistantFetch = toolHandler.slice(
    toolHandler.indexOf('await fetch(`/api/threads/${encodeURIComponent(threadId)}/voice/assistant`'),
    toolHandler.indexOf("session.sendToolResponse")
  );
  assert.match(assistantFetch, /setLiveDeliverable\(deliverable\)/);
  assert.match(assistantFetch, /playDocumentConfirmation\(data\.capabilityMetadata\)/);
  assert.ok(assistantFetch.indexOf("setLiveDeliverable(deliverable)") < assistantFetch.indexOf("playDocumentConfirmation"));
  assert.ok(assistantFetch.indexOf("playDocumentConfirmation") < assistantFetch.indexOf("return {"));
  assert.match(toolHandler, /usesVoiceRevisionConfirmation\(metadata\)/);
  assert.match(toolHandler, /prefetchConfirmation/);
  assert.match(hook, /const prefetchConfirmation/);
  assert.match(hook, /voice\/confirmation/);
  assert.match(toolHandler, /suppressLiveDocumentSpeechRef\.current/);
  assert.match(toolHandler, /if \(!suppressLiveDocumentSpeechRef\.current\) \{\s*scheduleAudio\(inlineData\.data/);
  assert.match(toolHandler, /capability\.capabilityMetadata\?\.document[\s\S]*Remain silent and wait for the user to speak/);
  assert.match(hook, /completed\.filter\(\(transcript\) => transcript\.role !== "assistant"\)/);
  assert.match(hook, /content: documentContent/);
  assert.match(hook, /suppressLiveDocumentSpeechRef\.current[\s\S]*completed\.filter\(\(transcript\) => transcript\.role !== "assistant"\)/);
  assert.match(hook, /content\.interrupted[\s\S]*confirmationPlayIdRef\.current \+= 1/);
  assert.match(hook, /content\.inputTranscription\?\.text[\s\S]*suppressLiveDocumentSpeechRef\.current = false/);
  assert.doesNotMatch(
    hook.slice(hook.indexOf('if (content.turnComplete)'), hook.indexOf("  }, [clearWorking", hook.indexOf('if (content.turnComplete)'))),
    /suppressLiveDocumentSpeechRef\.current = false/
  );
  assert.doesNotMatch(toolHandler, /persistFinalTranscript|voice\/messages/);

  const assistant = await readFile(new URL("../src/components/AssistantView.tsx", import.meta.url), "utf8");
  assert.match(assistant, /confirmationOnly = Boolean\(document && isDocumentConfirmationContent\(m\.content\)\)/);
  assert.match(assistant, /!confirmationOnly && \(/);
  assert.match(assistant, /confirmationOnly \? \([\s\S]*renderMessageTextWithCitations\(m\.content/);
});

test("Voice heavy calls keep the normal working lifecycle without any progress heartbeat", async () => {
  const [server, hook, voiceMode] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/voiceMode.ts", import.meta.url), "utf8"),
  ]);
  const toolHandler = hook.slice(hook.indexOf("const handleServerMessage"), hook.indexOf("const beginAmplitudeUpdates"));
  const cleanup = hook.slice(hook.indexOf("const releaseResources"), hook.indexOf("const fail"));

  assert.match(toolHandler, /workingCallIdsRef\.current\.add\(workingCallId\)/);
  assert.match(toolHandler, /finally \{[\s\S]*workingCallIdsRef\.current\.delete\(workingCallId\)/);
  assert.match(toolHandler, /JSON\.stringify\(\{ request, pageContext \}\)/);
  assert.match(toolHandler, /voice\/lookup/);
  assert.match(toolHandler, /session\.sendToolResponse\(\{[\s\S]*functionResponses/);
  assert.match(toolHandler, /content\.interrupted[\s\S]*clearWorking\(\)/);
  assert.match(toolHandler, /content\.turnComplete[\s\S]*clearWorking\(\)/);
  assert.match(cleanup, /clearWorking\(\)/);
  assert.doesNotMatch(hook, /VOICE_PROGRESS_HEARTBEAT_INTERVAL_MS|shouldPlayVoiceProgressAcknowledgement|heavyWorkingCallIdsRef|progressHeartbeatIntervalRef|progressAcknowledgement|setInterval\(/);
  assert.doesNotMatch(server, /progress-acknowledgement|getVoiceProgressAcknowledgementAudio/);
  assert.doesNotMatch(voiceMode, /VOICE_MODE_PROGRESS_ACKNOWLEDGEMENT|voiceProgressAcknowledgementRequest|getVoiceProgressAcknowledgementAudio|Still on it\./);
});

test("Live tool declarations expose named Firm Library lookup and keep routine reads out of the heavy bridge", () => {
  const declarations = liveConnectConfig().tools[0].functionDeclarations;
  const lookup = declarations.find((declaration) => declaration.name === "lookup_workspace")!;
  const assistant = declarations.find((declaration) => declaration.name === "use_assistant_capabilities")!;
  assert.ok(Object.hasOwn(lookup.parametersJsonSchema.properties, "firmLibraryDocumentTitle"));
  assert.match(lookup.description, /even when that document is not currently open/);
  assert.match(lookup.description, /routine direct document reading/);
  assert.match(assistant.description, /Create or revise a saved document only/);
  assert.match(assistant.description, /Do not use it for lookups, analysis, research, planning/);
});

test("Firm Library title resolution is normalized, deterministic, and refuses ambiguity", () => {
  const documents = [
    { id: "one", title: "Settlement Evaluation Matrix.docx" },
    { id: "two", title: "Employment Handbook.pdf" },
  ];
  assert.deepEqual(resolveFirmLibraryTitle("settlement_evaluation_matrix", documents), {
    status: "resolved",
    document: documents[0],
  });
  assert.equal(resolveFirmLibraryTitle("Settlement Evaluation", documents).status, "resolved");
  const ambiguous = resolveFirmLibraryTitle("Settlement Evaluation Matrix", [
    ...documents,
    { id: "three", title: "Settlement-Evaluation-Matrix.pdf" },
  ]);
  assert.equal(ambiguous.status, "ambiguous");
  if (ambiguous.status === "ambiguous") assert.deepEqual(ambiguous.candidates.map((candidate) => candidate.id), ["one", "three"]);
});

test("ephemeral credential request preserves constrained Live tools without the incompatible additional-field lock", () => {
  const { request } = voiceCredentialRequest(Date.UTC(2026, 7, 10));
  assert.equal(Object.hasOwn(request.config, "lockAdditionalFields"), false);
  assert.equal(request.config.liveConnectConstraints.model, VOICE_MODE_CONFIG.model);
  assert.deepEqual(
    request.config.liveConnectConstraints.config.tools[0].functionDeclarations.map((declaration) => declaration.name),
    ["lookup_workspace", "use_assistant_capabilities"]
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

test("empty or malformed Live history does not send a completed turn that would trigger speech", () => {
  for (const history of [[], undefined, null, { turns: [] }]) {
    const calls: unknown[] = [];
    initializeLiveHistory({
      sendClientContent: (params) => { calls.push(params); },
    }, history);
    assert.deepEqual(calls, []);
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

  const streamed = createStreamingDownsampler(48000, 16000);
  const first = streamed.push(new Float32Array(240));
  const second = streamed.push(new Float32Array(240));
  assert.equal(first.length + second.length, 160);
  assert.equal(createStreamingDownsampler(48000, 16000).push(new Float32Array(480)).length, 160);

  // Leftover samples must carry, otherwise 48 kHz capture silently runs fast.
  const leftover = createStreamingDownsampler(48000, 16000);
  assert.equal(leftover.push(new Float32Array(128)).length, 42);
  assert.equal(leftover.push(new Float32Array(128)).length, 43);
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

test("Voice holds microphone capture while speaking or working and still stops playback on Gemini interruption", async () => {
  assert.equal(shouldHoldVoiceCapture("speaking", false), true);
  assert.equal(shouldHoldVoiceCapture("listening", true), true);
  assert.equal(shouldHoldVoiceCapture("speaking", true), true);
  assert.equal(shouldHoldVoiceCapture("listening", false), false);
  assert.equal(shouldHoldVoiceCapture("connecting", false), false);
  assert.equal(shouldHoldVoiceCapture("off", false), false);

  const hook = await readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8");
  const send = hook.slice(hook.indexOf("const sendOrBufferCapture"), hook.indexOf("if (capture.kind === \"worklet\")"));
  assert.match(send, /shouldHoldVoiceCapture\(stateRef\.current, workingCallIdsRef\.current\.size > 0\)/);
  assert.ok(send.indexOf("shouldHoldVoiceCapture") < send.indexOf("sendRealtimeInput"));
  assert.ok(send.indexOf("if (shouldHoldVoiceCapture") < send.indexOf("sendRealtimeInput"));
  assert.ok(send.indexOf("return;") < send.indexOf("sendRealtimeInput"));
  assert.match(hook, /content\.interrupted[\s\S]*stopPlayback\(\)/);
  assert.match(hook, /content\.interrupted[\s\S]*finalizeTranscripts\("interrupted"\)/);
  assert.match(hook, /content\.interrupted[\s\S]*clearWorking\(\)/);
});

test("Voice playback uses a worklet jitter buffer so late packets cannot punch holes in speech", async () => {
  const [hook, playback, capture] = await Promise.all([
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/voicePlaybackWorklet.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/voiceCaptureWorklet.ts", import.meta.url), "utf8"),
  ]);
  assert.match(playback, /VOICE_PLAYBACK_PROCESSOR_NAME = "exepts-voice-playback"/);
  assert.match(playback, /this.queued < this.prebuffer/);
  assert.match(playback, /output.fill\(0, filled\)/);
  assert.match(playback, /postMessage\(\{ type: "drained" \}\)/);
  assert.match(capture, /Math.floor\(combined.length \/ this.ratio\)/);
  assert.match(capture, /this.leftover = combined.slice\(consumed\)/);
  assert.doesNotMatch(capture, /this.phase \+= this.step/);
  assert.match(hook, /VOICE_PLAYBACK_WORKLET_SOURCE/);
  assert.match(hook, /base64Pcm16ToInt16\(data\)/);
  assert.match(hook, /type: "push", samples: pcm, sampleRate: audioSampleRate\(mimeType\)/);
  assert.match(hook, /playbackWorkletRef.current\?\.port.postMessage\(\{ type: "stop" \}\)/);
  assert.match(hook, /createStreamingDownsampler\(context.sampleRate, VOICE_CAPTURE_TARGET_RATE\)/);
  assert.doesNotMatch(hook, /playbackRate/);
});

test("Voice Mode lifecycle is separate from standard send and releases microphone, audio, animation, and socket resources", async () => {
  const [assistant, hook] = await Promise.all([
    readFile(new URL("../src/components/AssistantView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
  ]);
  const voiceToggle = assistant.slice(assistant.indexOf("const handleVoiceToggle"), assistant.indexOf("const handleSend"));
  assert.doesNotMatch(voiceToggle, /handleSend/);
  assert.match(voiceToggle, /voiceMode\.start\(threadPromise, pageContext\)/);
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
  assert.match(hook, /query: request,\s*pageContext/);
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
    server.indexOf('app.post("/api/threads/:id/voice/assistant"')
  );
  assert.match(lookupRoute, /ownership\(req\)/);
  assert.match(lookupRoute, /db\.getThreadById/);
  assert.match(lookupRoute, /validateVoicePageContext\(req\.body\.pageContext, requestOwnership\)/);
  assert.match(lookupRoute, /voiceLookupCalls\(validated\.pageContext, query\)/);
  assert.match(lookupRoute, /currentMatterId: validated\.currentMatter\?\.id \|\| null/);
  assert.match(lookupRoute, /CURRENT AUTHORIZED PAGE:/);
  assert.match(lookupRoute, /pageContextForPrompt\(validated\.pageContext\)/);
  assert.match(lookupRoute, /db\.getHistoryThreads\(requestOwnership\)/);
  assert.match(lookupRoute, /db\.listFirmLibraryDocumentMetadata\(requestOwnership\)/);
  assert.match(lookupRoute, /resolveFirmLibraryTitle\(firmLibraryDocumentTitle, metadata\)/);
  assert.match(lookupRoute, /db\.getDocumentById\(titleResolution\.document\.id, requestOwnership, null\)/);
  assert.match(lookupRoute, /titleResolution\?\.status === "ambiguous"/);
  assert.doesNotMatch(lookupRoute, /planAssistantRequest|completeAssistantResponse/);
  assert.doesNotMatch(server, /currentMatterId !== threadMatterId|Voice page context does not match this conversation/);
  assert.doesNotMatch(lookupRoute, /req\.body\.(?:matterId|documentId|scope)|needsWeb: true|\b(?:create|update|delete|share|send|invite)\w*\(/);
  assert.match(hook, /voice\/assistant/);
  assert.match(hook, /voice\/lookup/);
  assert.match(hook, /session\.sendToolResponse/);
  assert.match(hook, /functionResponses:\s*\[\{/);
  assert.match(hook, /firmLibraryDocumentTitle: call\.args\.firmLibraryDocumentTitle\.trim\(\)/);
});

test("Voice function HTTP work exposes a ref-counted working state without changing audio behavior", async () => {
  const [assistant, hook, styles] = await Promise.all([
    readFile(new URL("../src/components/AssistantView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
  ]);
  const toolHandler = hook.slice(hook.indexOf("const handleServerMessage"), hook.indexOf("const beginAmplitudeUpdates"));
  assert.match(toolHandler, /workingCallIdsRef\.current\.add/);
  assert.match(toolHandler, /finally[\s\S]*workingCallIdsRef\.current\.delete/);
  assert.match(toolHandler, /setWorking\(workingCallIdsRef\.current\.size > 0\)/);
  assert.match(hook, /clearWorking\(\)[\s\S]*releaseResources/);
  assert.match(toolHandler, /content\.interrupted[\s\S]*clearWorking\(\)/);
  assert.match(assistant, /data-voice-working=\{voiceMode\.working/);
  assert.match(assistant, /Voice Agent working/);
  assert.match(styles, /data-voice-working="true"/);
  assert.doesNotMatch(toolHandler, /playbackRate|createBuffer|silenceDurationMs|prefixPaddingMs|live\.connect/);
});

test("Voice working state drives the existing Assistant activity panel through an independent visual timer", async () => {
  // Sliced with an LF literal below, so a CRLF checkout must be normalized first.
  const assistant = (await readFile(new URL("../src/components/AssistantView.tsx", import.meta.url), "utf8"))
    .replace(/\r\n/g, "\n");
  const voiceEffectStart = assistant.indexOf("  useEffect(() => {\n    if (!voiceMode.working)");
  const voiceEffectEnd = assistant.indexOf(
    "  }, [voiceMode.working, voiceWorkingStageIndex]);",
    voiceEffectStart
  );
  const voiceEffect = assistant.slice(voiceEffectStart, voiceEffectEnd);

  assert.match(assistant, /const VOICE_WORKING_ACTIVITIES = buildAssistantWorkingActivities\(\{\s*hasAttachments: false,?\s*\}\)/);
  assert.match(assistant, /const \[voiceWorkingStageIndex, setVoiceWorkingStageIndex\] = useState\(0\)/);
  assert.match(assistant, /const voiceWorkingActivityTimerRef = useRef<number \| null>\(null\)/);
  assert.match(voiceEffect, /if \(!voiceMode\.working\) \{\s*setVoiceWorkingStageIndex\(0\);\s*return;/);
  assert.match(voiceEffect, /voiceWorkingStageIndex >= VOICE_WORKING_ACTIVITIES\.length - 1/);
  assert.match(voiceEffect, /voiceWorkingActivityTimerRef\.current = window\.setTimeout/);
  assert.match(voiceEffect, /advanceWorkingActivityIndex\(current, VOICE_WORKING_ACTIVITIES\.length\)/);
  assert.match(voiceEffect, /WORKING_ACTIVITY_DELAY_MS/);
  assert.match(voiceEffect, /window\.clearTimeout\(voiceWorkingActivityTimerRef\.current\)/);
  assert.doesNotMatch(voiceEffect, /setLoading|setStreaming|handleSend/);
  assert.match(assistant, /loading && !streaming && draftStream === null \? \([\s\S]*activities=\{workingActivities\}[\s\S]*\) : voiceMode\.working \? \([\s\S]*activities=\{VOICE_WORKING_ACTIVITIES\}[\s\S]*\) : null/);
  assert.match(assistant, /function AssistantWorkingActivityPanel[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*visibleAssistantWorkingActivities\(activities, stageIndex\)/);
  assert.match(assistant, /\[messages, voiceMode\.liveTranscripts, voiceMode\.liveDeliverable, loading, workingStageIndex, voiceMode\.working, voiceWorkingStageIndex, draftStream\]/);
  assert.match(assistant, /componentMountedRef\.current = false;[\s\S]*window\.clearTimeout\(voiceWorkingActivityTimerRef\.current\)/);
});

test("Voice Assistant capability routing reuses the owned Assistant pipeline without reconnecting or duplicating chat messages", async () => {
  const [server, hook] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
  ]);
  const route = server.slice(
    server.indexOf('app.post("/api/threads/:id/voice/assistant"'),
    server.indexOf('app.post("/api/threads/:id/voice/messages"')
  );
  assert.match(route, /ownership\(req\)/);
  assert.match(route, /db\.getThreadById/);
  assert.match(route, /validateVoicePageContext\(req\.body\.pageContext, requestOwnership\)/);
  assert.match(route, /buildAssistantConversationState/);
  assert.match(route, /buildAssistantSessionContext/);
  assert.match(route, /planAssistantRequest/);
  assert.match(route, /orchestrateAssistantRetrieval/);
  assert.match(route, /resolveAssistantClarification/);
  assert.match(route, /completeAssistantResponse/);
  assert.match(route, /syntheticUserMessage/);
  assert.match(route, /const conversationMessages = \[\.\.\.priorHistory, syntheticUserMessage\]/);
  assert.doesNotMatch(route, /db\.addMessage|db\.addVoiceMessage|\/api\/threads\/.*\/messages|GEMINI_API_KEY/);
  assert.doesNotMatch(route, /voice\/confirmation/);
  assert.doesNotMatch(route, /prefetchVoiceConfirmationAudio|peekReadyVoiceConfirmationAudio|onDraftTitle/);
  assert.doesNotMatch(route, /req\.body\.(?:matterId|documentId|userId|workspaceId|scope)/);

  const toolHandler = hook.slice(hook.indexOf("const handleServerMessage"), hook.indexOf("const beginAmplitudeUpdates"));
  assert.match(toolHandler, /call\.name === "use_assistant_capabilities"/);
  assert.match(toolHandler, /voice\/assistant/);
  assert.match(toolHandler, /voice\/lookup/);
  assert.match(toolHandler, /session\.sendToolResponse/);
  assert.doesNotMatch(toolHandler, /session\.close|live\.connect|releaseResources/);
  assert.doesNotMatch(hook, /fetch\([^\n]*\/api\/threads\/[^\n]*\/messages[^\n]*\)[\s\S]*use_assistant_capabilities/);
});

test("full Voice Assistant delegation retains Firm Library discovery, deliverables, and artifact continuity", async () => {
  const [server, tools, conversationState] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/assistant/assistantTools.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/assistant/assistantConversationState.ts", import.meta.url), "utf8"),
  ]);
  const route = server.slice(
    server.indexOf('app.post("/api/threads/:id/voice/assistant"'),
    server.indexOf('app.post("/api/threads/:id/voice/messages"')
  );
  assert.match(tools, /list_firm_library_documents/);
  assert.match(tools, /get_firm_library_document/);
  assert.match(tools, /search_firm_library_documents/);
  assert.match(route, /orchestrateAssistantRetrieval/);
  assert.doesNotMatch(route, /selectedItem\?\.kind === "libraryDocument"|must be open|already selected/i);
  assert.match(route, /completeAssistantResponse/);
  assert.match(route, /completion\.document \? \{ document: completion\.document \}/);
  assert.match(route, /completion\.sourceDocument \? \{ sourceDocument: completion\.sourceDocument \}/);
  assert.match(conversationState, /message\.metadata\?\.document/);
  assert.match(route, /messages: conversationMessages/);
});

test("Voice deliverable metadata is turn-scoped and ownership-validated on finalized assistant persistence", async () => {
  const [server, hook] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
  ]);
  const validation = server.slice(
    server.indexOf("async function validatedVoiceDocumentReference"),
    server.indexOf("function voiceLookupCalls")
  );
  assert.match(validation, /db\.getDraftById\(id, matterId, requestOwnership\)/);
  assert.match(validation, /db\.getAssistantDocumentById\(id, requestOwnership\)/);
  assert.match(validation, /document|sourceDocument|assistantIntent|deliverableKind/);

  const messagesRoute = server.slice(
    server.indexOf('app.post("/api/threads/:id/voice/messages"'),
    server.indexOf("// Core Legal Search")
  );
  assert.match(messagesRoute, /validatedVoiceCapabilityMetadata/);
  assert.match(messagesRoute, /interactionMode: "voice"[\s\S]*\.\.\.capabilityMetadata/);
  assert.match(messagesRoute, /role === "user" && req\.body\.capabilityMetadata/);
  assert.doesNotMatch(messagesRoute, /planAssistantRequest|orchestrateAssistantRetrieval|completeAssistantResponse|callModel/);

  assert.match(hook, /pendingCapabilityMetadataRef/);
  assert.match(hook, /boundary === "turnComplete" \? pendingCapabilityMetadataRef\.current : null/);
  assert.match(hook, /pendingCapabilityMetadataRef\.current = null/);
  assert.match(hook, /transcript\.role === "assistant" && capabilityMetadata/);
  assert.match(hook, /turnBoundary === turnBoundaryRef\.current/);
  assert.match(hook, /turnBoundaryRef\.current \+= 1/);
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

test("Voice start overlaps microphone, token, and audio setup and buffers click-time speech", async () => {
  const [assistant, hook] = await Promise.all([
    readFile(new URL("../src/components/AssistantView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useVoiceMode.ts", import.meta.url), "utf8"),
  ]);
  const start = hook.slice(hook.indexOf("const start = useCallback"), hook.indexOf("const stop ="));
  assert.match(start, /Promise\.all\(\[mediaPromise, workletsPromise\]\)/);
  assert.match(start, /ensureVoiceToken\(threadId, pageContext\)/);
  assert.match(start, /pushVoiceStartupPacket\(startupAudioBufferRef\.current, data\)/);
  assert.match(start, /captureLiveRef\.current = true/);
  assert.match(start, /microphoneSource\.connect\(capture\.node\)[\s\S]*const tokenData = await tokenPromise/);
  assert.ok(start.indexOf("microphoneSource.connect(capture.node)") < start.indexOf("ai.live.connect"));
  assert.match(assistant, /onPointerEnter/);
  assert.match(assistant, /voiceMode\.prefetchToken\(threadId, pageContext\)/);
  assert.match(assistant, /handleStartNewThread\(pageContext, conversationVersionRef\.current\)/);
  assert.equal(VOICE_STARTUP_BUFFER_PACKETS, 62);
  assert.equal(VOICE_TOKEN_PREFETCH_TTL_MS, 50_000);
  assert.equal(voicePrefetchStillValid(0, 49_999), true);
  assert.equal(voicePrefetchStillValid(0, 50_000), false);
  const packets: string[] = [];
  for (let index = 0; index < 70; index += 1) pushVoiceStartupPacket(packets, `p${index}`, 62);
  assert.equal(packets.length, 62);
  assert.equal(packets[0], "p8");
  assert.equal(packets[61], "p69");
});
