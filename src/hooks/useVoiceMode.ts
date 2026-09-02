import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI } from "@google/genai";
import type { LiveServerMessage, Session } from "@google/genai";
import type { Message } from "../types";
import type { WorkspacePageContext } from "../types";
import {
  analyserLevel,
  audioSampleRate,
  base64Pcm16ToFloat32,
  base64Pcm16ToInt16,
  createStreamingDownsampler,
  float32ToPcm16Base64,
  mergeTranscriptChunk,
  pcm16BufferToBase64,
} from "../lib/voiceAudio";
import {
  VOICE_CAPTURE_CHUNK_SAMPLES,
  VOICE_CAPTURE_PROCESSOR_NAME,
  VOICE_CAPTURE_TARGET_RATE,
  VOICE_CAPTURE_WORKLET_SOURCE,
} from "../lib/voiceCaptureWorklet";
import { consumeVoiceAssistantCapabilityResponse } from "../lib/assistantMessageResponse";
import {
  VOICE_PLAYBACK_DRAIN_SECONDS,
  VOICE_PLAYBACK_PREBUFFER_SECONDS,
  VOICE_PLAYBACK_PROCESSOR_NAME,
  VOICE_PLAYBACK_WORKLET_SOURCE,
} from "../lib/voicePlaybackWorklet";
import {
  isVoiceDocumentSpokenContent,
  voiceAcknowledgementSpeech as voiceAcknowledgementSpeechFromRequest,
  voiceConfirmationSpeech as voiceConfirmationSpeechFromRequest,
} from "../lib/voiceAcknowledgement.js";
import {
  VOICE_DOC_CONFIRM_FAILSAFE_MS,
  VOICE_DOCUMENT_DRAFTING_TOOL_ACK,
  voiceDocumentAcknowledgementClientPrompt,
  voiceDocumentConfirmationClientPrompt,
  voiceDocumentDraftingFailedClientPrompt,
} from "../lib/voiceDocumentConfirmation.js";

export { voiceAcknowledgementSpeechFromRequest, voiceConfirmationSpeechFromRequest };

// Fallback-only lead used when AudioWorklet playback is unavailable. The worklet
// path uses a ring buffer instead, so a late packet is silence rather than a
// permanent hole in the timeline.
const VOICE_PLAYBACK_LEAD_SECONDS = 0.32;

// A drained queue only ends the speaking state once it stays drained, so a brief
// scheduling gap no longer flips the presence state back and forth.
const VOICE_PLAYBACK_SETTLE_MS = 200;

// Ephemeral Live tokens must start a session within one minute. Prefetch is only
// reused inside this window so a hover cannot hand start() an expired credential.
export const VOICE_TOKEN_PREFETCH_TTL_MS = 50_000;

// 512 samples at 16 kHz is 32 ms, so 62 packets keep about two seconds of speech
// spoken during connecting without flushing an unbounded pre-session queue.
export const VOICE_STARTUP_BUFFER_PACKETS = 62;

export function voicePrefetchStillValid(fetchedAt: number, now = Date.now()): boolean {
  return now - fetchedAt >= 0 && now - fetchedAt < VOICE_TOKEN_PREFETCH_TTL_MS;
}

export function pushVoiceStartupPacket(
  buffer: string[],
  packet: string,
  maxPackets = VOICE_STARTUP_BUFFER_PACKETS
): void {
  buffer.push(packet);
  if (buffer.length > maxPackets) buffer.splice(0, buffer.length - maxPackets);
}

type VoiceCapture =
  | { kind: "worklet"; node: AudioWorkletNode }
  | { kind: "script"; node: ScriptProcessorNode };

async function loadVoiceWorklets(context: AudioContext): Promise<string | null> {
  if (!context.audioWorklet) return null;
  const moduleUrl = URL.createObjectURL(
    new Blob(
      [`${VOICE_CAPTURE_WORKLET_SOURCE}\n${VOICE_PLAYBACK_WORKLET_SOURCE}`],
      { type: "text/javascript" }
    )
  );
  try {
    await context.audioWorklet.addModule(moduleUrl);
    return moduleUrl;
  } catch {
    URL.revokeObjectURL(moduleUrl);
    return null;
  }
}

function createVoiceCapture(context: AudioContext, workletsLoaded: boolean): VoiceCapture {
  if (workletsLoaded) {
    return {
      kind: "worklet",
      node: new AudioWorkletNode(context, VOICE_CAPTURE_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          targetRate: VOICE_CAPTURE_TARGET_RATE,
          chunkSamples: VOICE_CAPTURE_CHUNK_SAMPLES,
        },
      }),
    };
  }
  return { kind: "script", node: context.createScriptProcessor(2048, 1, 1) };
}

export type VoiceModeState = "off" | "connecting" | "listening" | "speaking" | "error";

type VoiceTokenResponse = {
  token: string;
  model: string;
  apiVersion: string;
  expiresAt: string;
  history?: unknown;
  error?: string;
};

type UseVoiceModeOptions = {
  onTranscript: (message: Message) => void;
};

type VoiceCapabilityMetadata = Pick<NonNullable<Message["metadata"]>,
  "document" | "sourceDocument" | "assistantIntent" | "deliverableKind">;

export type LiveVoiceTranscripts = {
  user: string;
  assistant: string;
};

export type CompletedVoiceTranscript = {
  role: "user" | "assistant";
  content: string;
};

export type VoiceLiveDeliverable = {
  content: string;
  metadata: VoiceCapabilityMetadata;
};

const VOICE_DOCUMENT_DELIVERABLE = String.raw`document|email|letter|memo|memorandum|agreement|contract|policy|brief|report|notice|checklist|nda|non-disclosure|statement of work|sow`;
const VOICE_DOCUMENT_CREATE = new RegExp(
  String.raw`\b(?:draft|prepare|write|compose|create|generate|produce|make)\b[\s\S]{0,120}\b(?:${VOICE_DOCUMENT_DELIVERABLE})\b`
);
const VOICE_DOCUMENT_CONVERT = new RegExp(
  String.raw`\b(?:turn into|turn to|convert into|convert to|return as|provide as|put into|format as|save as)\b[\s\S]{0,100}\b(?:${VOICE_DOCUMENT_DELIVERABLE})\b`
);
const VOICE_DOCUMENT_REVISE = new RegExp(
  String.raw`\b(?:revise|rewrite|update|amend|shorten|expand|regenerat(?:e|ing)|redo)\b[\s\S]{0,120}\b(?:it|that|one|document|draft|memo|letter|agreement|contract|report|policy|brief|email|(?:${VOICE_DOCUMENT_DELIVERABLE}))\b`
);

export function looksLikeVoiceDocumentRequest(content: string): boolean {
  const text = content.toLocaleLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/\b(?:do not create a document|don't create a document|chat only|without creating a document|without saving)\b/.test(text)) {
    return false;
  }
  if (/^(?:how (?:should|do|can|would) i|what is the (?:best )?way to)\b/.test(text)) return false;
  if (/^(?:what should (?:the |an )?(?:email|letter|memo|memorandum|report) say)\b/.test(text)) return false;
  return VOICE_DOCUMENT_CREATE.test(text) || VOICE_DOCUMENT_CONVERT.test(text) || VOICE_DOCUMENT_REVISE.test(text);
}

export function voiceAssistantInstruction(userTranscript: string, functionRequest: string): string {
  return userTranscript.trim() || functionRequest.trim();
}

export function finalizeVoiceTranscripts(
  transcripts: LiveVoiceTranscripts,
  boundary: "turnComplete" | "interrupted"
): { completed: CompletedVoiceTranscript[]; remaining: LiveVoiceTranscripts } {
  const user = transcripts.user.trim();
  const assistant = transcripts.assistant.trim();
  if (boundary === "interrupted") {
    return {
      completed: assistant ? [{ role: "assistant", content: assistant }] : [],
      remaining: { user: transcripts.user, assistant: "" },
    };
  }
  return {
    completed: [
      ...(user ? [{ role: "user" as const, content: user }] : []),
      ...(assistant ? [{ role: "assistant" as const, content: assistant }] : []),
    ],
    remaining: { user: "", assistant: "" },
  };
}

function voiceSessionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID().replaceAll("-", "_");
  return `voice_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function initializeLiveHistory(
  session: Pick<Session, "sendClientContent">,
  history: unknown
): void {
  const turns = Array.isArray(history) ? history : [];
  if (turns.length === 0) return;
  session.sendClientContent({ turns, turnComplete: true });
}

export function dispatchVoiceDocumentAcknowledgement(
  session: Pick<Session, "sendClientContent">,
  acknowledgementSpeech: string
): void {
  session.sendClientContent({
    turns: [{
      role: "user",
      parts: [{ text: voiceDocumentAcknowledgementClientPrompt(acknowledgementSpeech) }],
    }],
    turnComplete: true,
  });
}

export function dispatchVoiceDocumentConfirmation(
  session: Pick<Session, "sendClientContent">,
  confirmationSpeech: string
): void {
  session.sendClientContent({
    turns: [{
      role: "user",
      parts: [{ text: voiceDocumentConfirmationClientPrompt(confirmationSpeech) }],
    }],
    turnComplete: true,
  });
}

export function dispatchVoiceDocumentDraftingFailedNotice(
  session: Pick<Session, "sendClientContent">
): void {
  session.sendClientContent({
    turns: [{
      role: "user",
      parts: [{ text: voiceDocumentDraftingFailedClientPrompt() }],
    }],
    turnComplete: true,
  });
}

export const VOICE_DIRECT_ANSWER_TOOL_RESPONSE =
  "This request does not require document creation or revision. Answer the user directly from your knowledge and any conversation context already available. Do not call any function.";

export const VOICE_AWAIT_USER_SPEECH_TOOL_RESPONSE =
  "The user has not spoken yet in this Voice session. Remain completely silent and wait for the user to speak first. Do not call use_assistant_capabilities until the user speaks.";

export function shouldUseVoiceAssistantCapability(request: string): boolean {
  return looksLikeVoiceDocumentRequest(request);
}

export function shouldRouteVoiceAssistantCapability(
  combinedRequest: string,
  explicitToolRequest = ""
): boolean {
  if (shouldUseVoiceAssistantCapability(combinedRequest)) return true;
  const explicit = explicitToolRequest.trim();
  return explicit.length > 0 && shouldUseVoiceAssistantCapability(explicit);
}

export function shouldApplyVoiceDraftUpdate(
  turnBoundary: number,
  currentTurnBoundary: number,
  pausedCapabilityTurn: number | null,
  hasInFlightPromise: boolean
): boolean {
  if (turnBoundary === currentTurnBoundary) return true;
  if (pausedCapabilityTurn === turnBoundary) return true;
  if (hasInFlightPromise) return true;
  return false;
}

export function shouldBeginVoiceDocumentTranscriptSuppression(userTranscript: string): boolean {
  return looksLikeVoiceDocumentRequest(userTranscript);
}

export const shouldBeginVoiceDocumentSpeechSuppression = shouldBeginVoiceDocumentTranscriptSuppression;

export function shouldStartVoiceDocumentDraft(userTranscript: string): boolean {
  return looksLikeVoiceDocumentRequest(userTranscript);
}

export function shouldStartVoiceDocumentDraftOnTurnComplete(input: {
  userTranscript: string;
  turnBoundary: number;
  deliveredTurnBoundaries: ReadonlySet<number>;
  hasInFlightPromise: boolean;
}): boolean {
  if (!shouldStartVoiceDocumentDraft(input.userTranscript)) return false;
  if (input.hasInFlightPromise) return false;
  if (input.deliveredTurnBoundaries.has(input.turnBoundary)) return false;
  return true;
}

export function shouldPlayVoiceAcknowledgement(
  functionName: string | undefined,
  request: string,
  turnBoundary: number,
  acknowledgedTurn: number | null
): boolean {
  return functionName === "use_assistant_capabilities"
    && shouldUseVoiceAssistantCapability(request)
    && acknowledgedTurn !== turnBoundary;
}

/**
 * A completed turn must not retire the boundary that an Assistant capability call
 * was issued against while that call is still running, otherwise the deliverable it
 * returns is attributed to a turn that no longer exists and its document card is
 * dropped. The model frequently speaks a short filler line before the result
 * arrives, so having spoken is not evidence that the turn is finished.
 */
export function shouldAdvanceVoiceTurnBoundary(
  boundary: "turnComplete" | "interrupted",
  hasPendingDocumentDelivery: boolean
): boolean {
  return boundary === "interrupted" || !hasPendingDocumentDelivery;
}

export function isVoiceAssistantPlaybackIdle(input: {
  playbackActive: boolean;
  playbackSourceCount: number;
}): boolean {
  return !input.playbackActive && input.playbackSourceCount === 0;
}

export function shouldClearVoiceDocumentTranscriptSuppression(input: {
  suppressing: boolean;
  inFlightCapabilityCount: number;
  pendingDocumentDelivery: boolean;
  pendingConfirmation: boolean;
  confirmationSpeechActive: boolean;
  pendingConfirmationDispatch?: boolean;
  voiceDocumentTurnActive?: boolean;
}): boolean {
  return input.suppressing
    && input.inFlightCapabilityCount === 0
    && !input.pendingDocumentDelivery
    && !input.pendingConfirmation
    && !input.confirmationSpeechActive
    && !input.pendingConfirmationDispatch
    && !input.voiceDocumentTurnActive;
}

export function shouldFilterAssistantVoiceTranscript(input: {
  suppressDocumentSpeech: boolean;
  pendingConfirmation: boolean;
  confirmationSpeechActive: boolean;
  pendingDocumentDelivery: boolean;
  inFlightCapabilityCount: number;
}): boolean {
  return input.suppressDocumentSpeech;
}

export function shouldDropVoiceAssistantTranscript(
  content: string,
  input: {
    suppressDocumentSpeech: boolean;
    expectedConfirmationSpeech?: string | null;
    expectedAcknowledgementSpeech?: string | null;
  }
): boolean {
  if (shouldFilterAssistantVoiceTranscript({
    suppressDocumentSpeech: input.suppressDocumentSpeech,
    pendingConfirmation: false,
    confirmationSpeechActive: false,
    pendingDocumentDelivery: false,
    inFlightCapabilityCount: 0,
  })) {
    return true;
  }
  return isVoiceDocumentSpokenContent(
    content,
    input.expectedConfirmationSpeech,
    input.expectedAcknowledgementSpeech
  );
}

export function shouldSkipVoiceAssistantPersistence(
  role: "user" | "assistant",
  dropAssistantTranscript: boolean,
  hasDocumentCapability: boolean
): boolean {
  return role === "assistant" && !hasDocumentCapability && dropAssistantTranscript;
}

export function inFlightVoiceCapabilityCount(
  inFlightTurns: Map<number, number> | Iterable<number>
): number {
  let total = 0;
  for (const count of inFlightTurns instanceof Map ? inFlightTurns.values() : inFlightTurns) {
    total += count;
  }
  return total;
}

export function hasPendingVoiceDocumentDelivery(input: {
  inFlightCapabilityCount: number;
  pendingDocumentDelivery: boolean;
  confirmationSpeechActive?: boolean;
}): boolean {
  return input.inFlightCapabilityCount > 0
    || input.pendingDocumentDelivery
    || Boolean(input.confirmationSpeechActive);
}

export function usesVoiceRevisionConfirmation(metadata: {
  assistantIntent?: unknown;
  sourceDocument?: unknown;
}): boolean {
  return metadata.assistantIntent === "document_revision" || Boolean(metadata.sourceDocument);
}

export function shouldHoldVoiceCapture(
  state: VoiceModeState,
  hasInFlightWork: boolean,
  awaitingVoiceFinalize = false
): boolean {
  return state === "speaking" || hasInFlightWork || awaitingVoiceFinalize;
}

export function voiceCaptureAwaitingFinalize(input: {
  hasLiveDeliverable: boolean;
  pausedCapabilityTurn: boolean;
  pendingVoicePersistence?: boolean;
  confirmationPendingOrActive?: boolean;
  documentTurnActive?: boolean;
}): boolean {
  return input.hasLiveDeliverable
    || input.pausedCapabilityTurn
    || Boolean(input.confirmationPendingOrActive)
    || Boolean(input.documentTurnActive)
    || Boolean(input.pendingVoicePersistence);
}

export function canOpenVoiceListenMode(input: {
  playbackActive: boolean;
  playbackSourceCount: number;
  pendingVoicePersistence: number;
  confirmationSpeechActive: boolean;
  documentTurnActive: boolean;
}): boolean {
  return !input.playbackActive
    && input.playbackSourceCount === 0
    && input.pendingVoicePersistence === 0
    && !input.confirmationSpeechActive
    && !input.documentTurnActive;
}

export function shouldRunVoiceDocumentConfirmationFailsafe(input: {
  confirmationSpeechActive: boolean;
  failsafeDeadlineMs: number;
  now?: number;
}): boolean {
  return input.confirmationSpeechActive
    && (input.now ?? Date.now()) >= input.failsafeDeadlineMs;
}

export function shouldWaitForVoiceAckPlaybackBeforeConfirmation(input: {
  playbackIdle: boolean;
  hasPendingConfirmationDispatch: boolean;
}): boolean {
  return input.hasPendingConfirmationDispatch && !input.playbackIdle;
}

export function shouldMarkVoiceConfirmationPlaybackStarted(input: {
  confirmationSpeechActive: boolean;
  confirmationDispatched: boolean;
}): boolean {
  return input.confirmationSpeechActive && input.confirmationDispatched;
}

export function shouldFinishVoiceDocumentConfirmation(input: {
  confirmationSpeechActive: boolean;
  confirmationTurnComplete: boolean;
  confirmationDispatched: boolean;
  confirmationPlaybackStarted: boolean;
  playbackIdle: boolean;
}): boolean {
  return input.confirmationSpeechActive
    && input.confirmationTurnComplete
    && input.confirmationDispatched
    && input.confirmationPlaybackStarted
    && input.playbackIdle;
}

export function shouldFinalizeVoiceDocumentImmediately(
  pausedCapabilityTurn: number | null,
  turnBoundary: number
): boolean {
  return pausedCapabilityTurn === turnBoundary;
}

type VoiceCapabilityResult = {
  ok: boolean;
  result: string;
  capabilityMetadata: VoiceCapabilityMetadata | null;
  error?: string;
};

export function useVoiceMode({ onTranscript }: UseVoiceModeOptions) {
  const [state, setState] = useState<VoiceModeState>("off");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [liveTranscripts, setLiveTranscripts] = useState<LiveVoiceTranscripts>({ user: "", assistant: "" });
  const [liveDeliverable, setLiveDeliverable] = useState<VoiceLiveDeliverable | null>(null);
  const stateRef = useRef<VoiceModeState>("off");
  const lifecycleRef = useRef(0);
  const sessionThreadRef = useRef<string | null>(null);
  const sessionIdRef = useRef("");
  const sessionRef = useRef<Session | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const microphoneSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<AudioNode | null>(null);
  const releaseCaptureRef = useRef<(() => void) | null>(null);
  const playbackSettleTimerRef = useRef<number | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const microphoneAnalyserRef = useRef<AnalyserNode | null>(null);
  const assistantAnalyserRef = useRef<AnalyserNode | null>(null);
  const playbackSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const playbackAtRef = useRef(0);
  const playbackWorkletRef = useRef<AudioWorkletNode | null>(null);
  const playbackActiveRef = useRef(false);
  const workletModuleUrlRef = useRef<string | null>(null);
  const captureDownsamplerRef = useRef<ReturnType<typeof createStreamingDownsampler> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const voiceControlRef = useRef<HTMLElement | null>(null);
  const transcriptFrameRef = useRef<number | null>(null);
  const transcriptRef = useRef({ user: "", assistant: "" });
  const pageContextRef = useRef<WorkspacePageContext | null>(null);
  const eventSequenceRef = useRef({ user: 0, assistant: 0 });
  const persistQueueRef = useRef(Promise.resolve());
  const voicePersistencePendingRef = useRef(0);
  const pendingCapabilityMetadataRef = useRef<VoiceCapabilityMetadata | null>(null);
  const workingCallIdsRef = useRef(new Set<string>());
  const inFlightAssistantCapabilityTurnsRef = useRef(new Map<number, number>());
  const pausedAssistantCapabilityTurnRef = useRef<number | null>(null);
  const turnBoundaryRef = useRef(0);
  const awaitingOpeningTurnRef = useRef(false);
  const acknowledgedTurnRef = useRef<number | null>(null);
  const suppressDocumentTranscriptRef = useRef(false);
  const pendingVoiceConfirmationSpeechRef = useRef<string | null>(null);
  const pendingVoiceAcknowledgementSpeechRef = useRef<string | null>(null);
  const lockedDocumentUserTranscriptRef = useRef<string | null>(null);
  const voiceDocumentTurnActiveRef = useRef(false);
  const voiceDocumentSpokenOnlyRef = useRef(false);
  const confirmationSpeechActiveRef = useRef(false);
  const confirmationPlaybackStartedRef = useRef(false);
  const confirmationTurnCompleteRef = useRef(false);
  const liveTurnCompleteRef = useRef(true);
  const pendingVoiceDocumentDeliveryTurnsRef = useRef(new Set<number>());
  const voiceDocumentDeliveryCompletedTurnsRef = useRef(new Set<number>());
  const completedVoiceCapabilityResultsRef = useRef(new Map<number, VoiceCapabilityResult>());
  const confirmationFailsafeTimerRef = useRef<number | null>(null);
  const pendingVoiceConfirmationDispatchRef = useRef<{
    session: Session;
    confirmationSpeech: string;
    turnBoundary: number;
  } | null>(null);
  const confirmationDispatchedRef = useRef(false);
  const onAssistantPlaybackIdleRef = useRef<() => void>(() => undefined);
  const maybeOpenListenModeRef = useRef<() => void>(() => undefined);
  const tokenPrefetchRef = useRef<{
    threadId: string;
    pageContextKey: string;
    fetchedAt: number;
    promise: Promise<VoiceTokenResponse>;
  } | null>(null);
  const startupAudioBufferRef = useRef<string[]>([]);
  const captureLiveRef = useRef(false);
  const assistantCapabilityPromisesRef = useRef(new Map<number, Promise<VoiceCapabilityResult>>());
  const liveDeliverableRef = useRef<VoiceLiveDeliverable | null>(null);
  const voiceContextRefreshTimerRef = useRef<number | null>(null);
  const voiceContextRefreshKeyRef = useRef("");
  const voiceContextRefreshInFlightRef = useRef(false);
  const refreshVoiceLiveContextRef = useRef<(pageContext: WorkspacePageContext, options?: { immediate?: boolean }) => void>(() => undefined);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const updateState = useCallback((next: VoiceModeState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clearWorking = useCallback(() => {
    workingCallIdsRef.current.clear();
    setWorking(false);
  }, []);

  // The presence indicator is driven straight through CSS so that continuous audio
  // levels never re-render the conversation while the microphone or playback is live.
  const writeVoiceLevel = useCallback((level: number) => {
    voiceControlRef.current?.style.setProperty("--voice-level", level.toFixed(2));
  }, []);

  const attachVoiceControl = useCallback((element: HTMLElement | null) => {
    voiceControlRef.current = element;
    element?.style.setProperty("--voice-level", "0");
  }, []);

  const cancelTranscriptFlush = useCallback(() => {
    if (transcriptFrameRef.current === null) return;
    cancelAnimationFrame(transcriptFrameRef.current);
    transcriptFrameRef.current = null;
  }, []);

  // Live transcription arrives far faster than the display needs to change, so
  // partial chunks are coalesced into one repaint instead of one render each.
  const scheduleTranscriptFlush = useCallback(() => {
    if (transcriptFrameRef.current !== null) return;
    transcriptFrameRef.current = requestAnimationFrame(() => {
      transcriptFrameRef.current = null;
      setLiveTranscripts({ ...transcriptRef.current });
    });
  }, []);

  const cancelPlaybackSettle = useCallback(() => {
    if (playbackSettleTimerRef.current === null) return;
    window.clearTimeout(playbackSettleTimerRef.current);
    playbackSettleTimerRef.current = null;
  }, []);

  const schedulePlaybackSettle = useCallback(() => {
    cancelPlaybackSettle();
    playbackSettleTimerRef.current = window.setTimeout(() => {
      playbackSettleTimerRef.current = null;
      onAssistantPlaybackIdleRef.current();
      if (canOpenVoiceListenMode({
        playbackActive: playbackActiveRef.current,
        playbackSourceCount: playbackSourcesRef.current.size,
        pendingVoicePersistence: voicePersistencePendingRef.current,
        confirmationSpeechActive: confirmationSpeechActiveRef.current,
        documentTurnActive: voiceDocumentTurnActiveRef.current,
      }) && stateRef.current === "speaking") {
        updateState("listening");
      }
    }, VOICE_PLAYBACK_SETTLE_MS);
  }, [cancelPlaybackSettle, updateState]);

  const maybeOpenListenMode = useCallback(() => {
    if (!canOpenVoiceListenMode({
      playbackActive: playbackActiveRef.current,
      playbackSourceCount: playbackSourcesRef.current.size,
      pendingVoicePersistence: voicePersistencePendingRef.current,
      confirmationSpeechActive: confirmationSpeechActiveRef.current,
      documentTurnActive: voiceDocumentTurnActiveRef.current,
    })) {
      return;
    }
    if (stateRef.current === "speaking") {
      updateState("listening");
    }
  }, [updateState]);

  const stopPlayback = useCallback(() => {
    cancelPlaybackSettle();
    playbackActiveRef.current = false;
    try { playbackWorkletRef.current?.port.postMessage({ type: "stop" }); } catch { /* node already released */ }
    for (const source of playbackSourcesRef.current) {
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    playbackSourcesRef.current.clear();
    playbackAtRef.current = 0;
  }, [cancelPlaybackSettle]);

  const releaseResources = useCallback((finalState: VoiceModeState = "off") => {
    lifecycleRef.current += 1;
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    cancelTranscriptFlush();
    stopPlayback();
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      try { session.sendRealtimeInput({ audioStreamEnd: true }); } catch { /* socket may be closed */ }
      try { session.close(); } catch { /* socket may be closed */ }
    }
    releaseCaptureRef.current?.();
    releaseCaptureRef.current = null;
    const playbackNode = playbackWorkletRef.current;
    if (playbackNode) playbackNode.port.onmessage = null;
    playbackNode?.disconnect();
    playbackWorkletRef.current = null;
    playbackActiveRef.current = false;
    captureDownsamplerRef.current = null;
    processorRef.current?.disconnect();
    microphoneSourceRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    microphoneAnalyserRef.current?.disconnect();
    assistantAnalyserRef.current?.disconnect();
    processorRef.current = null;
    microphoneSourceRef.current = null;
    silentGainRef.current = null;
    microphoneAnalyserRef.current = null;
    assistantAnalyserRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
    if (workletModuleUrlRef.current) {
      URL.revokeObjectURL(workletModuleUrlRef.current);
      workletModuleUrlRef.current = null;
    }
    sessionThreadRef.current = null;
    transcriptRef.current = { user: "", assistant: "" };
    pageContextRef.current = null;
    pendingCapabilityMetadataRef.current = null;
    inFlightAssistantCapabilityTurnsRef.current.clear();
    pausedAssistantCapabilityTurnRef.current = null;
    assistantCapabilityPromisesRef.current.clear();
    liveDeliverableRef.current = null;
    setLiveDeliverable(null);
    awaitingOpeningTurnRef.current = false;
    acknowledgedTurnRef.current = null;
    suppressDocumentTranscriptRef.current = false;
    pendingVoiceConfirmationSpeechRef.current = null;
    pendingVoiceAcknowledgementSpeechRef.current = null;
    lockedDocumentUserTranscriptRef.current = null;
    voiceDocumentTurnActiveRef.current = false;
    voiceDocumentSpokenOnlyRef.current = false;
    confirmationSpeechActiveRef.current = false;
    confirmationPlaybackStartedRef.current = false;
    confirmationTurnCompleteRef.current = false;
    liveTurnCompleteRef.current = true;
    pendingVoiceDocumentDeliveryTurnsRef.current.clear();
    voiceDocumentDeliveryCompletedTurnsRef.current.clear();
    completedVoiceCapabilityResultsRef.current.clear();
    pendingVoiceConfirmationDispatchRef.current = null;
    confirmationDispatchedRef.current = false;
    if (confirmationFailsafeTimerRef.current !== null) {
      window.clearTimeout(confirmationFailsafeTimerRef.current);
      confirmationFailsafeTimerRef.current = null;
    }
    tokenPrefetchRef.current = null;
    startupAudioBufferRef.current = [];
    captureLiveRef.current = false;
    if (voiceContextRefreshTimerRef.current) {
      window.clearTimeout(voiceContextRefreshTimerRef.current);
      voiceContextRefreshTimerRef.current = null;
    }
    voiceContextRefreshKeyRef.current = "";
    voiceContextRefreshInFlightRef.current = false;
    clearWorking();
    turnBoundaryRef.current += 1;
    setLiveTranscripts({ user: "", assistant: "" });
    writeVoiceLevel(0);
    updateState(finalState);
  }, [cancelTranscriptFlush, clearWorking, stopPlayback, updateState, writeVoiceLevel]);

  const fail = useCallback((message: string) => {
    setError(message);
    releaseResources("error");
  }, [releaseResources]);

  const retirePersistedVoiceDeliverable = useCallback(() => {
    liveDeliverableRef.current = null;
    setLiveDeliverable(null);
    const pageContext = pageContextRef.current;
    if (pageContext) void refreshVoiceLiveContextRef.current(pageContext, { immediate: true });
  }, []);

  const persistFinalTranscript = useCallback((
    role: "user" | "assistant",
    content: string,
    capabilityMetadata?: VoiceCapabilityMetadata
  ) => {
    const threadId = sessionThreadRef.current;
    const sessionId = sessionIdRef.current;
    const normalized = content.trim();
    if (!threadId || !sessionId || !normalized) return;
    const dropAssistantTranscript = role === "assistant" && shouldDropVoiceAssistantTranscript(normalized, {
      suppressDocumentSpeech: suppressDocumentTranscriptRef.current,
      expectedConfirmationSpeech: pendingVoiceConfirmationSpeechRef.current,
      expectedAcknowledgementSpeech: pendingVoiceAcknowledgementSpeechRef.current,
    });
    if (shouldSkipVoiceAssistantPersistence(role, dropAssistantTranscript, Boolean(capabilityMetadata?.document))) {
      return;
    }
    const eventId = `${role}_${++eventSequenceRef.current[role]}`;
    const optimisticId = `voice_opt_${sessionId}_${eventId}`;
    const voiceStableKey = `voice_${sessionId}_${eventId}`;
    const optimisticMessage: Message = {
      id: optimisticId,
      thread_id: threadId,
      role,
      content: normalized,
      citations: [],
      steps: null,
      created_at: new Date().toISOString(),
      metadata: {
        interactionMode: "voice",
        voiceOptimistic: true,
        voiceStableKey,
        ...(capabilityMetadata || {}),
      },
    };
    onTranscriptRef.current(optimisticMessage);
    setLiveTranscripts((current) => current[role].trim() === normalized
      ? { ...current, [role]: "" }
      : current);
    if (capabilityMetadata?.document) {
      liveDeliverableRef.current = null;
      setLiveDeliverable(null);
    }
    persistQueueRef.current = persistQueueRef.current.then(async () => {
      const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/voice/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content: normalized, sessionId, eventId, ...(capabilityMetadata ? { capabilityMetadata } : {}) }),
      });
      const data = await response.json().catch(() => ({})) as Message & { error?: string };
      if (!response.ok) throw new Error(data.error || "This Voice Mode transcript could not be saved.");
      onTranscriptRef.current({
        ...data,
        metadata: {
          ...data.metadata,
          voiceOptimistic: false,
          voiceStableKey,
        },
      });
      if (capabilityMetadata?.document) {
        const pageContext = pageContextRef.current;
        if (pageContext) void refreshVoiceLiveContextRef.current(pageContext, { immediate: true });
      }
    }).catch((persistenceError) => {
      console.error("Voice transcript persistence failed.");
      setError(persistenceError instanceof Error ? persistenceError.message : "This Voice Mode transcript could not be saved.");
    }).finally(() => {
      voicePersistencePendingRef.current = Math.max(0, voicePersistencePendingRef.current - 1);
      maybeOpenListenModeRef.current();
    });
    voicePersistencePendingRef.current += 1;
  }, []);

  const finalizeTranscripts = useCallback((
    boundary: "turnComplete" | "interrupted",
    advanceTurnBoundary = true
  ) => {
    // Any coalesced partial chunk is applied first so persistence can recognise
    // the finished text and retire the matching live bubble.
    cancelTranscriptFlush();
    const pending = transcriptRef.current;
    setLiveTranscripts({ ...pending });
    const dropAssistantTranscript = (content: string) => shouldDropVoiceAssistantTranscript(content, {
      suppressDocumentSpeech: suppressDocumentTranscriptRef.current,
      expectedConfirmationSpeech: pendingVoiceConfirmationSpeechRef.current,
      expectedAcknowledgementSpeech: pendingVoiceAcknowledgementSpeechRef.current,
    });
    if (voiceDocumentTurnActiveRef.current && boundary === "turnComplete") {
      if (dropAssistantTranscript(pending.assistant)) {
        transcriptRef.current = { ...transcriptRef.current, assistant: "" };
        setLiveTranscripts((current) => ({ ...current, assistant: "" }));
      }
      if (!advanceTurnBoundary) return;
    }
    const { completed, remaining } = finalizeVoiceTranscripts(pending, boundary);
    transcriptRef.current = remaining;
    const capabilityMetadata = boundary === "turnComplete" ? pendingCapabilityMetadataRef.current : null;
    const documentContent = liveDeliverableRef.current?.content;
    const completedTranscripts = boundary === "turnComplete" && capabilityMetadata && documentContent
      ? [
          ...completed.filter((transcript) => transcript.role !== "assistant"),
          { role: "assistant" as const, content: documentContent },
        ]
      : completed.filter((transcript) => transcript.role !== "assistant" || !dropAssistantTranscript(transcript.content));
    if (advanceTurnBoundary) {
      assistantCapabilityPromisesRef.current.delete(turnBoundaryRef.current);
      pendingCapabilityMetadataRef.current = null;
      pausedAssistantCapabilityTurnRef.current = null;
      turnBoundaryRef.current += 1;
    }
    for (const transcript of completedTranscripts) {
      persistFinalTranscript(
        transcript.role,
        transcript.content,
        transcript.role === "assistant" && capabilityMetadata ? capabilityMetadata : undefined
      );
    }
  }, [cancelTranscriptFlush, persistFinalTranscript]);

  const finalizePendingVoiceDocument = useCallback(() => {
    const capabilityMetadata = pendingCapabilityMetadataRef.current;
    const documentContent = liveDeliverableRef.current?.content?.trim();
    if (!capabilityMetadata?.document || !documentContent) return false;

    cancelTranscriptFlush();
    const pendingUser = (lockedDocumentUserTranscriptRef.current || transcriptRef.current.user).trim();
    suppressDocumentTranscriptRef.current = false;
    pendingVoiceConfirmationSpeechRef.current = null;
    pendingVoiceAcknowledgementSpeechRef.current = null;
    lockedDocumentUserTranscriptRef.current = null;
    liveDeliverableRef.current = null;
    setLiveDeliverable(null);
    if (pendingUser) {
      persistFinalTranscript("user", pendingUser);
    }
    persistFinalTranscript("assistant", documentContent, capabilityMetadata);
    transcriptRef.current = { user: "", assistant: "" };
    setLiveTranscripts({ user: "", assistant: "" });
    pendingCapabilityMetadataRef.current = null;
    pausedAssistantCapabilityTurnRef.current = null;
    assistantCapabilityPromisesRef.current.delete(turnBoundaryRef.current);
    completedVoiceCapabilityResultsRef.current.delete(turnBoundaryRef.current);
    turnBoundaryRef.current += 1;
    voiceDocumentTurnActiveRef.current = false;
    voiceDocumentSpokenOnlyRef.current = false;
    return true;
  }, [cancelTranscriptFlush, persistFinalTranscript]);

  const beginVoiceDocumentSpeechSuppression = useCallback(() => {
    voiceDocumentTurnActiveRef.current = true;
    voiceDocumentSpokenOnlyRef.current = true;
    suppressDocumentTranscriptRef.current = true;
    if (transcriptRef.current.assistant.trim()) {
      transcriptRef.current = { ...transcriptRef.current, assistant: "" };
      setLiveTranscripts((current) => ({ ...current, assistant: "" }));
    }
  }, []);

  const maybeEndVoiceDocumentSpeechSuppression = useCallback(() => {
    if (!shouldClearVoiceDocumentTranscriptSuppression({
      suppressing: suppressDocumentTranscriptRef.current,
      inFlightCapabilityCount: inFlightVoiceCapabilityCount(inFlightAssistantCapabilityTurnsRef.current),
      pendingDocumentDelivery: pendingVoiceDocumentDeliveryTurnsRef.current.size > 0,
      pendingConfirmation: false,
      confirmationSpeechActive: confirmationSpeechActiveRef.current,
      pendingConfirmationDispatch: pendingVoiceConfirmationDispatchRef.current !== null,
      voiceDocumentTurnActive: voiceDocumentTurnActiveRef.current,
    })) {
      return;
    }
    if (!isVoiceAssistantPlaybackIdle({
      playbackActive: playbackActiveRef.current,
      playbackSourceCount: playbackSourcesRef.current.size,
    })) {
      return;
    }
    suppressDocumentTranscriptRef.current = false;
  }, []);

  const cancelVoiceDocumentConfirmationFailsafe = useCallback(() => {
    if (confirmationFailsafeTimerRef.current === null) return;
    window.clearTimeout(confirmationFailsafeTimerRef.current);
    confirmationFailsafeTimerRef.current = null;
  }, []);

  const abandonVoiceDocumentConfirmation = useCallback(() => {
    pendingVoiceConfirmationDispatchRef.current = null;
    confirmationDispatchedRef.current = false;
    if (!confirmationSpeechActiveRef.current) return;
    cancelVoiceDocumentConfirmationFailsafe();
    confirmationSpeechActiveRef.current = false;
    confirmationPlaybackStartedRef.current = false;
    confirmationTurnCompleteRef.current = false;
    liveTurnCompleteRef.current = true;
    pendingVoiceConfirmationSpeechRef.current = null;
    pendingVoiceAcknowledgementSpeechRef.current = null;
    lockedDocumentUserTranscriptRef.current = null;
    pendingVoiceDocumentDeliveryTurnsRef.current.delete(turnBoundaryRef.current);
    pausedAssistantCapabilityTurnRef.current = null;
    finalizePendingVoiceDocument();
    voiceDocumentTurnActiveRef.current = false;
    voiceDocumentSpokenOnlyRef.current = false;
    suppressDocumentTranscriptRef.current = false;
    maybeEndVoiceDocumentSpeechSuppression();
    maybeOpenListenModeRef.current();
  }, [cancelVoiceDocumentConfirmationFailsafe, finalizePendingVoiceDocument, maybeEndVoiceDocumentSpeechSuppression]);

  const scheduleVoiceDocumentConfirmationFailsafe = useCallback(() => {
    cancelVoiceDocumentConfirmationFailsafe();
    const failsafeDeadlineMs = Date.now() + VOICE_DOC_CONFIRM_FAILSAFE_MS;
    confirmationFailsafeTimerRef.current = window.setTimeout(() => {
      confirmationFailsafeTimerRef.current = null;
      if (!shouldRunVoiceDocumentConfirmationFailsafe({
        confirmationSpeechActive: confirmationSpeechActiveRef.current,
        failsafeDeadlineMs,
      })) {
        return;
      }
      abandonVoiceDocumentConfirmation();
    }, VOICE_DOC_CONFIRM_FAILSAFE_MS);
  }, [abandonVoiceDocumentConfirmation, cancelVoiceDocumentConfirmationFailsafe]);

  const tryDispatchPendingVoiceDocumentConfirmation = useCallback(() => {
    const pending = pendingVoiceConfirmationDispatchRef.current;
    if (!pending) return false;
    if (sessionRef.current !== pending.session) {
      pendingVoiceConfirmationDispatchRef.current = null;
      return false;
    }
    if (!isVoiceAssistantPlaybackIdle({
      playbackActive: playbackActiveRef.current,
      playbackSourceCount: playbackSourcesRef.current.size,
    })) {
      return false;
    }
    pendingVoiceConfirmationDispatchRef.current = null;
    confirmationSpeechActiveRef.current = true;
    confirmationPlaybackStartedRef.current = false;
    confirmationTurnCompleteRef.current = false;
    confirmationDispatchedRef.current = false;
    liveTurnCompleteRef.current = false;
    const { session, confirmationSpeech } = pending;
    requestAnimationFrame(() => {
      if (sessionRef.current !== session) return;
      confirmationDispatchedRef.current = true;
      dispatchVoiceDocumentConfirmation(session, confirmationSpeech);
      scheduleVoiceDocumentConfirmationFailsafe();
    });
    return true;
  }, [scheduleVoiceDocumentConfirmationFailsafe]);

  const finishVoiceDocumentConfirmation = useCallback(() => {
    if (!shouldFinishVoiceDocumentConfirmation({
      confirmationSpeechActive: confirmationSpeechActiveRef.current,
      confirmationTurnComplete: confirmationTurnCompleteRef.current,
      confirmationDispatched: confirmationDispatchedRef.current,
      confirmationPlaybackStarted: confirmationPlaybackStartedRef.current,
      playbackIdle: isVoiceAssistantPlaybackIdle({
        playbackActive: playbackActiveRef.current,
        playbackSourceCount: playbackSourcesRef.current.size,
      }),
    })) return false;
    cancelVoiceDocumentConfirmationFailsafe();
    confirmationSpeechActiveRef.current = false;
    confirmationPlaybackStartedRef.current = false;
    confirmationTurnCompleteRef.current = false;
    confirmationDispatchedRef.current = false;
    pendingVoiceConfirmationSpeechRef.current = null;
    pendingVoiceDocumentDeliveryTurnsRef.current.delete(turnBoundaryRef.current);
    pausedAssistantCapabilityTurnRef.current = null;
    const finalized = finalizePendingVoiceDocument();
    maybeEndVoiceDocumentSpeechSuppression();
    return finalized;
  }, [cancelVoiceDocumentConfirmationFailsafe, finalizePendingVoiceDocument, maybeEndVoiceDocumentSpeechSuppression]);

  const reconcileVoiceListenMode = useCallback(() => {
    finishVoiceDocumentConfirmation();
    maybeOpenListenMode();
  }, [finishVoiceDocumentConfirmation, maybeOpenListenMode]);

  onAssistantPlaybackIdleRef.current = () => {
    tryDispatchPendingVoiceDocumentConfirmation();
    reconcileVoiceListenMode();
    maybeEndVoiceDocumentSpeechSuppression();
  };
  maybeOpenListenModeRef.current = reconcileVoiceListenMode;

  const scheduleAudio = useCallback((data: string, mimeType?: string): boolean => {
    const context = audioContextRef.current;
    const analyser = assistantAnalyserRef.current;
    if (!context || !analyser || !data) return false;
    const playback = playbackWorkletRef.current;
    if (playback) {
      const pcm = base64Pcm16ToInt16(data);
      if (pcm.length === 0) return false;
      playbackActiveRef.current = true;
      cancelPlaybackSettle();
      playback.port.postMessage(
        { type: "push", samples: pcm, sampleRate: audioSampleRate(mimeType) },
        [pcm.buffer]
      );
      updateState("speaking");
      return true;
    }
    const samples = base64Pcm16ToFloat32(data);
    if (samples.length === 0) return false;
    const buffer = context.createBuffer(1, samples.length, audioSampleRate(mimeType));
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    cancelPlaybackSettle();
    const startAt = Math.max(context.currentTime + VOICE_PLAYBACK_LEAD_SECONDS, playbackAtRef.current);
    playbackAtRef.current = startAt + buffer.duration;
    playbackSourcesRef.current.add(source);
    source.onended = () => {
      playbackSourcesRef.current.delete(source);
      source.disconnect();
      if (playbackSourcesRef.current.size === 0 && !playbackActiveRef.current && stateRef.current === "speaking") {
        schedulePlaybackSettle();
      }
    };
    updateState("speaking");
    source.start(startAt);
    return true;
  }, [cancelPlaybackSettle, schedulePlaybackSettle, updateState]);

  const handleServerMessage = useCallback((message: LiveServerMessage) => {
    const threadId = sessionThreadRef.current;
    const pageContext = pageContextRef.current;
    const session = sessionRef.current;

    const ensureAssistantCapability = (request: string, turnBoundary: number): Promise<VoiceCapabilityResult> => {
      const existing = assistantCapabilityPromisesRef.current.get(turnBoundary);
      if (existing) return existing;
      if (!threadId || !pageContext || !request) {
        return Promise.resolve({
          ok: false,
          result: "",
          capabilityMetadata: null as VoiceCapabilityMetadata | null,
          error: "The Assistant capability request failed.",
        });
      }
      if (shouldUseVoiceAssistantCapability(request)) {
        beginVoiceDocumentSpeechSuppression();
        pendingVoiceConfirmationSpeechRef.current = voiceConfirmationSpeechFromRequest(request);
        pendingVoiceDocumentDeliveryTurnsRef.current.add(turnBoundary);
      }
      const workingCallId = `voice_assistant_${turnBoundary}`;
      workingCallIdsRef.current.add(workingCallId);
      const inFlightCount = inFlightAssistantCapabilityTurnsRef.current.get(turnBoundary) || 0;
      inFlightAssistantCapabilityTurnsRef.current.set(turnBoundary, inFlightCount + 1);
      setWorking(true);
      const promise = (async () => {
        try {
          const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/voice/assistant`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ request, pageContext }),
          });
          const shouldApplyDraft = () => shouldApplyVoiceDraftUpdate(
            turnBoundary,
            turnBoundaryRef.current,
            pausedAssistantCapabilityTurnRef.current,
            assistantCapabilityPromisesRef.current.has(turnBoundary)
          );
          const data = await consumeVoiceAssistantCapabilityResponse(response);
          if (data.error) {
            if (shouldApplyDraft()) {
              pendingCapabilityMetadataRef.current = null;
              liveDeliverableRef.current = null;
              setLiveDeliverable(null);
              suppressDocumentTranscriptRef.current = false;
              pendingVoiceConfirmationSpeechRef.current = null;
              voiceDocumentTurnActiveRef.current = false;
              voiceDocumentSpokenOnlyRef.current = false;
              pendingVoiceDocumentDeliveryTurnsRef.current.delete(turnBoundary);
            }
            return {
              ok: false,
              result: "",
              capabilityMetadata: null,
              error: data.error,
            };
          }
          if (response.ok && data.capabilityMetadata?.document) {
            pendingCapabilityMetadataRef.current = (data.capabilityMetadata || null) as VoiceCapabilityMetadata | null;
            const deliverable = {
              content: data.result || "",
              metadata: data.capabilityMetadata as VoiceCapabilityMetadata,
            };
            liveDeliverableRef.current = deliverable;
            setLiveDeliverable(deliverable);
            beginVoiceDocumentSpeechSuppression();
          } else if (response.ok && shouldApplyDraft()) {
            suppressDocumentTranscriptRef.current = false;
            pendingVoiceConfirmationSpeechRef.current = null;
            voiceDocumentTurnActiveRef.current = false;
            voiceDocumentSpokenOnlyRef.current = false;
            liveDeliverableRef.current = null;
            setLiveDeliverable(null);
          }
          return {
            ok: response.ok,
            result: data.result || "",
            capabilityMetadata: (data.capabilityMetadata || null) as VoiceCapabilityMetadata | null,
            error: data.error,
          };
        } catch {
          if (shouldApplyVoiceDraftUpdate(
            turnBoundary,
            turnBoundaryRef.current,
            pausedAssistantCapabilityTurnRef.current,
            assistantCapabilityPromisesRef.current.has(turnBoundary)
          )) {
            pendingCapabilityMetadataRef.current = null;
            liveDeliverableRef.current = null;
            setLiveDeliverable(null);
            suppressDocumentTranscriptRef.current = false;
            pendingVoiceConfirmationSpeechRef.current = null;
            voiceDocumentTurnActiveRef.current = false;
            voiceDocumentSpokenOnlyRef.current = false;
            pendingVoiceDocumentDeliveryTurnsRef.current.delete(turnBoundary);
          }
          return {
            ok: false,
            result: "",
            capabilityMetadata: null,
            error: "The Assistant capability request failed.",
          };
        } finally {
          workingCallIdsRef.current.delete(workingCallId);
          const currentCount = inFlightAssistantCapabilityTurnsRef.current.get(turnBoundary) || 0;
          if (currentCount <= 1) inFlightAssistantCapabilityTurnsRef.current.delete(turnBoundary);
          else inFlightAssistantCapabilityTurnsRef.current.set(turnBoundary, currentCount - 1);
          setWorking(workingCallIdsRef.current.size > 0);
        }
      })();
      assistantCapabilityPromisesRef.current.set(turnBoundary, promise);
      return promise;
    };

    const deliverVoiceDocumentCapability = (
      activeSession: Session,
      turnBoundary: number,
      capability: VoiceCapabilityResult,
      confirmationSpeech: string
    ) => {
      if (voiceDocumentDeliveryCompletedTurnsRef.current.has(turnBoundary)) return;
      completedVoiceCapabilityResultsRef.current.delete(turnBoundary);
      voiceDocumentDeliveryCompletedTurnsRef.current.add(turnBoundary);
      if (capability.ok && capability.capabilityMetadata?.document) {
        pendingVoiceConfirmationDispatchRef.current = {
          session: activeSession,
          confirmationSpeech,
          turnBoundary,
        };
        tryDispatchPendingVoiceDocumentConfirmation();
        return;
      }
      pendingVoiceDocumentDeliveryTurnsRef.current.delete(turnBoundary);
      pendingVoiceConfirmationSpeechRef.current = null;
      pendingVoiceAcknowledgementSpeechRef.current = null;
      lockedDocumentUserTranscriptRef.current = null;
      pendingCapabilityMetadataRef.current = null;
      liveDeliverableRef.current = null;
      setLiveDeliverable(null);
      voiceDocumentTurnActiveRef.current = false;
      voiceDocumentSpokenOnlyRef.current = false;
      suppressDocumentTranscriptRef.current = false;
      dispatchVoiceDocumentDraftingFailedNotice(activeSession);
    };

    const recordVoiceDocumentCapability = (
      turnBoundary: number,
      capability: VoiceCapabilityResult,
      request: string
    ) => {
      completedVoiceCapabilityResultsRef.current.set(turnBoundary, capability);
      const activeSession = sessionRef.current;
      if (!activeSession || voiceDocumentDeliveryCompletedTurnsRef.current.has(turnBoundary)) return;
      // A proactive draft may finish before Live decides whether to call the tool.
      // Delivery waits for either that tool call or the completed input turn so a
      // confirmation can never interrupt the user's still-open request.
      if (acknowledgedTurnRef.current !== turnBoundary && !liveTurnCompleteRef.current) return;
      deliverVoiceDocumentCapability(
        activeSession,
        turnBoundary,
        capability,
        voiceConfirmationSpeechFromRequest(request)
      );
    };

    const maybeStartVoiceDocumentDraft = () => {
      if (awaitingOpeningTurnRef.current) return;
      const userTranscript = transcriptRef.current.user.trim();
      if (!shouldStartVoiceDocumentDraft(userTranscript)) return;
      const turnBoundary = turnBoundaryRef.current;
      // Mark this input turn open before the fast draft promise can resolve. This
      // preserves parallel drafting without allowing its confirmation to cut into
      // the user's request or Live's decision turn.
      liveTurnCompleteRef.current = false;
      void ensureAssistantCapability(userTranscript, turnBoundary).then((capability) => {
        recordVoiceDocumentCapability(turnBoundary, capability, userTranscript);
      });
    };

    if (message.toolCall?.functionCalls?.length) {
      if (threadId && pageContext && session) {
        void Promise.all(message.toolCall.functionCalls.map(async (call) => {
          if (call.name !== "use_assistant_capabilities") {
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name || "use_assistant_capabilities",
                response: { output: VOICE_DIRECT_ANSWER_TOOL_RESPONSE },
              }],
            });
            return;
          }
          const explicitToolRequest = typeof call.args?.request === "string" ? call.args.request : "";
          const request = voiceAssistantInstruction(
            transcriptRef.current.user,
            explicitToolRequest
          );
          const turnBoundary = turnBoundaryRef.current;
          if (awaitingOpeningTurnRef.current) {
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name || "use_assistant_capabilities",
                response: { output: VOICE_AWAIT_USER_SPEECH_TOOL_RESPONSE },
              }],
            });
            return;
          }
          const isDocumentRequest = shouldUseVoiceAssistantCapability(request);
          const isPrimaryDocumentCall = isDocumentRequest && shouldPlayVoiceAcknowledgement(
            call.name,
            request,
            turnBoundary,
            acknowledgedTurnRef.current
          );
          const confirmationSpeech = isDocumentRequest
            ? voiceConfirmationSpeechFromRequest(request)
            : "";
          if (isDocumentRequest) {
            if (voiceDocumentDeliveryCompletedTurnsRef.current.has(turnBoundary)) {
              session.sendToolResponse({
                functionResponses: [{
                  id: call.id,
                  name: call.name || "use_assistant_capabilities",
                  response: { output: VOICE_DOCUMENT_DRAFTING_TOOL_ACK },
                }],
              });
              return;
            }
            const acknowledgementSpeech = isPrimaryDocumentCall
              ? voiceAcknowledgementSpeechFromRequest(request)
              : "";
            pendingVoiceConfirmationSpeechRef.current = confirmationSpeech;
            pendingVoiceAcknowledgementSpeechRef.current = isPrimaryDocumentCall
              ? acknowledgementSpeech
              : null;
            beginVoiceDocumentSpeechSuppression();
            if (isPrimaryDocumentCall) {
              acknowledgedTurnRef.current = turnBoundary;
              lockedDocumentUserTranscriptRef.current = transcriptRef.current.user.trim();
              requestAnimationFrame(() => {
                if (sessionRef.current !== session) return;
                dispatchVoiceDocumentAcknowledgement(session, acknowledgementSpeech);
              });
            }
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name || "use_assistant_capabilities",
                response: { output: VOICE_DOCUMENT_DRAFTING_TOOL_ACK },
              }],
            });
            void ensureAssistantCapability(request, turnBoundary).then((capability) => {
              const activeSession = sessionRef.current;
              if (!activeSession || activeSession !== session) return;
              completedVoiceCapabilityResultsRef.current.set(turnBoundary, capability);
              if (!isPrimaryDocumentCall) return;
              deliverVoiceDocumentCapability(activeSession, turnBoundary, capability, confirmationSpeech);
            });
            return;
          }
          const capability = await ensureAssistantCapability(request, turnBoundary);
          session.sendToolResponse({
            functionResponses: [{
              id: call.id,
              name: call.name || "use_assistant_capabilities",
              response: capability.ok
                ? { output: capability.result || "Answer the user directly." }
                : { error: capability.error || "The Assistant capability request failed." },
            }],
          });
          pendingVoiceDocumentDeliveryTurnsRef.current.delete(turnBoundary);
        }));
      }
    }
    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) {
      awaitingOpeningTurnRef.current = false;
      const hasInFlightDocument = inFlightAssistantCapabilityTurnsRef.current.size > 0
        || assistantCapabilityPromisesRef.current.size > 0;
      if (!hasInFlightDocument && !confirmationSpeechActiveRef.current) {
        liveDeliverableRef.current = null;
        setLiveDeliverable(null);
        suppressDocumentTranscriptRef.current = false;
        pendingVoiceConfirmationSpeechRef.current = null;
        voiceDocumentTurnActiveRef.current = false;
        voiceDocumentSpokenOnlyRef.current = false;
      }
      clearWorking();
      stopPlayback();
      tryDispatchPendingVoiceDocumentConfirmation();
      if (confirmationSpeechActiveRef.current) {
        cancelVoiceDocumentConfirmationFailsafe();
        confirmationSpeechActiveRef.current = false;
        confirmationPlaybackStartedRef.current = false;
        confirmationTurnCompleteRef.current = false;
        confirmationDispatchedRef.current = false;
        liveTurnCompleteRef.current = true;
        pendingVoiceConfirmationSpeechRef.current = null;
        pendingVoiceDocumentDeliveryTurnsRef.current.delete(turnBoundaryRef.current);
        pausedAssistantCapabilityTurnRef.current = null;
        finalizePendingVoiceDocument();
        maybeEndVoiceDocumentSpeechSuppression();
      }
      maybeOpenListenModeRef.current();
    }
    for (const part of content.interrupted ? [] : content.modelTurn?.parts || []) {
      const inlineData = part.inlineData;
      if (inlineData?.data && inlineData.mimeType?.startsWith("audio/")) {
        if (awaitingOpeningTurnRef.current) continue;
        liveTurnCompleteRef.current = false;
        const scheduled = scheduleAudio(inlineData.data, inlineData.mimeType);
        if (scheduled && shouldMarkVoiceConfirmationPlaybackStarted({
          confirmationSpeechActive: confirmationSpeechActiveRef.current,
          confirmationDispatched: confirmationDispatchedRef.current,
        })) {
          confirmationPlaybackStartedRef.current = true;
        }
      }
    }
    if (content.inputTranscription?.text) {
      awaitingOpeningTurnRef.current = false;
      if (lockedDocumentUserTranscriptRef.current !== null && voiceDocumentTurnActiveRef.current) {
        scheduleTranscriptFlush();
      } else {
        transcriptRef.current.user = mergeTranscriptChunk(
          transcriptRef.current.user,
          content.inputTranscription.text
        );
        const userTranscript = transcriptRef.current.user.trim();
        if (shouldBeginVoiceDocumentTranscriptSuppression(userTranscript)) {
          if (!lockedDocumentUserTranscriptRef.current) {
            lockedDocumentUserTranscriptRef.current = userTranscript;
          }
          beginVoiceDocumentSpeechSuppression();
          maybeStartVoiceDocumentDraft();
        }
        scheduleTranscriptFlush();
      }
    }
    // Spoken-only document audio never enters transcript accumulators.
    if (content.outputTranscription?.text && !awaitingOpeningTurnRef.current) {
      const userTranscript = transcriptRef.current.user.trim();
      if (shouldBeginVoiceDocumentTranscriptSuppression(userTranscript)) {
        if (!lockedDocumentUserTranscriptRef.current) {
          lockedDocumentUserTranscriptRef.current = userTranscript;
        }
        beginVoiceDocumentSpeechSuppression();
      }
      if (voiceDocumentSpokenOnlyRef.current || suppressDocumentTranscriptRef.current) {
        if (transcriptRef.current.assistant.trim()) {
          transcriptRef.current = { ...transcriptRef.current, assistant: "" };
          scheduleTranscriptFlush();
        }
      } else {
        const dropAssistantTranscript = (assistantContent: string) => shouldDropVoiceAssistantTranscript(assistantContent, {
          suppressDocumentSpeech: suppressDocumentTranscriptRef.current,
          expectedConfirmationSpeech: pendingVoiceConfirmationSpeechRef.current,
          expectedAcknowledgementSpeech: pendingVoiceAcknowledgementSpeechRef.current,
        });
        const mergedAssistant = mergeTranscriptChunk(
          transcriptRef.current.assistant,
          content.outputTranscription.text
        );
        if (dropAssistantTranscript(mergedAssistant)) {
          transcriptRef.current = { ...transcriptRef.current, assistant: "" };
        } else {
          transcriptRef.current.assistant = mergedAssistant;
        }
        scheduleTranscriptFlush();
      }
    }
    if (content.interrupted) finalizeTranscripts("interrupted");
    if (content.turnComplete) {
      liveTurnCompleteRef.current = true;
      let finalizedDocumentThisEvent = false;
      if (confirmationSpeechActiveRef.current) {
        confirmationTurnCompleteRef.current = true;
        finalizedDocumentThisEvent = finishVoiceDocumentConfirmation();
      } else {
        finalizedDocumentThisEvent = finishVoiceDocumentConfirmation();
      }
      const turnBoundary = turnBoundaryRef.current;
      const userTranscript = transcriptRef.current.user.trim();
      if (shouldStartVoiceDocumentDraftOnTurnComplete({
        userTranscript,
        turnBoundary,
        deliveredTurnBoundaries: voiceDocumentDeliveryCompletedTurnsRef.current,
        hasInFlightPromise: assistantCapabilityPromisesRef.current.has(turnBoundary),
      })) {
        maybeStartVoiceDocumentDraft();
      }
      const completedCapability = completedVoiceCapabilityResultsRef.current.get(turnBoundary);
      if (
        completedCapability
        && session
        && !voiceDocumentDeliveryCompletedTurnsRef.current.has(turnBoundary)
      ) {
        deliverVoiceDocumentCapability(
          session,
          turnBoundary,
          completedCapability,
          voiceConfirmationSpeechFromRequest(
            lockedDocumentUserTranscriptRef.current || userTranscript
          )
        );
      }
      if (finalizedDocumentThisEvent) {
        clearWorking();
        reconcileVoiceListenMode();
        return;
      }
      if (confirmationSpeechActiveRef.current) {
        clearWorking();
        reconcileVoiceListenMode();
        return;
      }
      const hasPendingDocumentDelivery = hasPendingVoiceDocumentDelivery({
        inFlightCapabilityCount: inFlightAssistantCapabilityTurnsRef.current.get(turnBoundaryRef.current) || 0,
        pendingDocumentDelivery: pendingVoiceDocumentDeliveryTurnsRef.current.has(turnBoundaryRef.current),
        confirmationSpeechActive: confirmationSpeechActiveRef.current,
      });
      const shouldAdvanceTurnBoundary = shouldAdvanceVoiceTurnBoundary(
        "turnComplete",
        hasPendingDocumentDelivery
      );
      if (shouldAdvanceTurnBoundary) {
        clearWorking();
        finalizeTranscripts("turnComplete");
        reconcileVoiceListenMode();
      } else {
        pausedAssistantCapabilityTurnRef.current = turnBoundaryRef.current;
        finalizeTranscripts("turnComplete", false);
      }
    }
  }, [beginVoiceDocumentSpeechSuppression, cancelVoiceDocumentConfirmationFailsafe, clearWorking, finalizePendingVoiceDocument, finalizeTranscripts, finishVoiceDocumentConfirmation, maybeEndVoiceDocumentSpeechSuppression, reconcileVoiceListenMode, scheduleAudio, scheduleTranscriptFlush, scheduleVoiceDocumentConfirmationFailsafe, stopPlayback, tryDispatchPendingVoiceDocumentConfirmation, updateState]);

  const ensureVoiceToken = useCallback((threadId: string, pageContext: WorkspacePageContext) => {
    const pageContextKey = JSON.stringify(pageContext);
    const existing = tokenPrefetchRef.current;
    if (
      existing
      && existing.threadId === threadId
      && existing.pageContextKey === pageContextKey
      && voicePrefetchStillValid(existing.fetchedAt)
    ) {
      return existing.promise;
    }
    const fetchedAt = Date.now();
    const promise = (async () => {
      const tokenResponse = await fetch(`/api/threads/${encodeURIComponent(threadId)}/voice/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageContext }),
      });
      const tokenData = await tokenResponse.json().catch(() => ({})) as VoiceTokenResponse;
      if (!tokenResponse.ok || !tokenData.token) {
        throw new Error(tokenData.error || "Voice Mode could not connect. Please try again.");
      }
      return tokenData;
    })();
    tokenPrefetchRef.current = { threadId, pageContextKey, fetchedAt, promise };
    void promise.catch(() => {
      if (tokenPrefetchRef.current?.promise === promise) tokenPrefetchRef.current = null;
    });
    return promise;
  }, []);

  const prefetchToken = useCallback((threadId: string, pageContext: WorkspacePageContext) => {
    if (!threadId) return;
    void ensureVoiceToken(threadId, pageContext).catch(() => undefined);
  }, [ensureVoiceToken]);

  const beginAmplitudeUpdates = useCallback(() => {
    const microphoneData = new Uint8Array(256);
    const assistantData = new Uint8Array(256);
    let lastUpdate = 0;
    let lastLevel = -1;
    const frame = (now: number) => {
      if (now - lastUpdate > 50) {
        const microphoneLevel = analyserLevel(microphoneAnalyserRef.current, microphoneData);
        const assistantLevel = analyserLevel(assistantAnalyserRef.current, assistantData);
        const level = stateRef.current === "speaking" ? assistantLevel : microphoneLevel;
        if (Math.abs(level - lastLevel) >= 0.02) {
          writeVoiceLevel(level);
          lastLevel = level;
        }
        lastUpdate = now;
      }
      animationFrameRef.current = requestAnimationFrame(frame);
    };
    animationFrameRef.current = requestAnimationFrame(frame);
  }, [writeVoiceLevel]);

  const start = useCallback(async (
    threadIdOrPromise: string | Promise<string | undefined | void>,
    pageContext: WorkspacePageContext
  ) => {
    if (stateRef.current === "connecting" || stateRef.current === "listening" || stateRef.current === "speaking") return;
    const lifecycle = ++lifecycleRef.current;
    setError("");
    updateState("connecting");
    pageContextRef.current = pageContext;
    sessionIdRef.current = voiceSessionId();
    eventSequenceRef.current = { user: 0, assistant: 0 };
    transcriptRef.current = { user: "", assistant: "" };
    awaitingOpeningTurnRef.current = true;
    captureLiveRef.current = false;
    startupAudioBufferRef.current = [];
    liveDeliverableRef.current = null;
    setLiveDeliverable(null);
    setLiveTranscripts({ user: "", assistant: "" });
    suppressDocumentTranscriptRef.current = false;
    pendingVoiceConfirmationSpeechRef.current = null;
    pendingVoiceAcknowledgementSpeechRef.current = null;
    lockedDocumentUserTranscriptRef.current = null;
    voiceDocumentTurnActiveRef.current = false;
    voiceDocumentSpokenOnlyRef.current = false;
    confirmationSpeechActiveRef.current = false;
    confirmationPlaybackStartedRef.current = false;
    confirmationTurnCompleteRef.current = false;
    confirmationDispatchedRef.current = false;
    pendingVoiceConfirmationDispatchRef.current = null;
    liveTurnCompleteRef.current = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("A microphone is not available in this browser.");

      const threadPromise = Promise.resolve(threadIdOrPromise).then((threadId) => {
        if (!threadId) throw new Error("Voice Mode could not start a conversation.");
        if (lifecycle === lifecycleRef.current) sessionThreadRef.current = threadId;
        return threadId;
      });
      const tokenPromise = threadPromise.then((threadId) => ensureVoiceToken(threadId, pageContext));
      const mediaPromise = navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }).then((stream) => {
        if (lifecycle !== lifecycleRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return null;
        }
        streamRef.current = stream;
        return stream;
      });
      const context = new AudioContext();
      audioContextRef.current = context;
      const workletsPromise = context.resume().then(() => loadVoiceWorklets(context)).then((workletModuleUrl) => {
        if (lifecycle !== lifecycleRef.current) {
          if (workletModuleUrl) URL.revokeObjectURL(workletModuleUrl);
          return null;
        }
        workletModuleUrlRef.current = workletModuleUrl;
        return workletModuleUrl;
      });

      const [stream, workletModuleUrl] = await Promise.all([mediaPromise, workletsPromise]);
      if (lifecycle !== lifecycleRef.current) return;
      if (!stream) throw new Error("A microphone is not available in this browser.");

      const microphoneSource = context.createMediaStreamSource(stream);
      const microphoneAnalyser = context.createAnalyser();
      microphoneAnalyser.fftSize = 256;
      microphoneAnalyser.smoothingTimeConstant = 0.72;
      const assistantAnalyser = context.createAnalyser();
      assistantAnalyser.fftSize = 256;
      assistantAnalyser.smoothingTimeConstant = 0.68;
      assistantAnalyser.connect(context.destination);
      if (workletModuleUrl) {
        const playback = new AudioWorkletNode(context, VOICE_PLAYBACK_PROCESSOR_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: {
            prebufferSeconds: VOICE_PLAYBACK_PREBUFFER_SECONDS,
            drainSeconds: VOICE_PLAYBACK_DRAIN_SECONDS,
          },
        });
        playback.port.onmessage = (event: MessageEvent<{ type?: string }>) => {
          if (event.data?.type !== "drained") return;
          playbackActiveRef.current = false;
          schedulePlaybackSettle();
          onAssistantPlaybackIdleRef.current();
        };
        playback.connect(assistantAnalyser);
        playbackWorkletRef.current = playback;
      }
      const capture = createVoiceCapture(context, Boolean(workletModuleUrl));
      if (lifecycle !== lifecycleRef.current) {
        try { capture.node.disconnect(); } catch { /* context already released */ }
        try { playbackWorkletRef.current?.disconnect(); } catch { /* context already released */ }
        playbackWorkletRef.current = null;
        if (workletModuleUrl) URL.revokeObjectURL(workletModuleUrl);
        workletModuleUrlRef.current = null;
        return;
      }
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      microphoneSource.connect(microphoneAnalyser);
      capture.node.connect(silentGain);
      silentGain.connect(context.destination);
      microphoneSourceRef.current = microphoneSource;
      microphoneAnalyserRef.current = microphoneAnalyser;
      assistantAnalyserRef.current = assistantAnalyser;
      processorRef.current = capture.node;
      silentGainRef.current = silentGain;

      const sendOrBufferCapture = (data: string) => {
        const liveSession = sessionRef.current;
        if (captureLiveRef.current && liveSession) {
          // Drop capture instead of buffering it: flushing held speech after
          // playback would replay the barge-in as the next user turn.
          if (shouldHoldVoiceCapture(
            stateRef.current,
            workingCallIdsRef.current.size > 0,
            voiceCaptureAwaitingFinalize({
              hasLiveDeliverable: liveDeliverableRef.current !== null
                && !liveDeliverableRef.current.metadata.document,
              pausedCapabilityTurn: pausedAssistantCapabilityTurnRef.current !== null,
              confirmationPendingOrActive: confirmationSpeechActiveRef.current,
              documentTurnActive: voiceDocumentTurnActiveRef.current,
              pendingVoicePersistence: voicePersistencePendingRef.current > 0,
            })
          )) return;
          liveSession.sendRealtimeInput({
            audio: { data, mimeType: "audio/pcm;rate=16000" },
          });
          return;
        }
        pushVoiceStartupPacket(startupAudioBufferRef.current, data);
      };

      if (capture.kind === "worklet") {
        capture.node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          if (lifecycle !== lifecycleRef.current) return;
          sendOrBufferCapture(pcm16BufferToBase64(event.data));
        };
        releaseCaptureRef.current = () => { capture.node.port.onmessage = null; };
      } else {
        const downsampler = createStreamingDownsampler(context.sampleRate, VOICE_CAPTURE_TARGET_RATE);
        captureDownsamplerRef.current = downsampler;
        capture.node.onaudioprocess = (event) => {
          if (lifecycle !== lifecycleRef.current) return;
          const samples = downsampler.push(event.inputBuffer.getChannelData(0));
          if (samples.length === 0) return;
          sendOrBufferCapture(float32ToPcm16Base64(samples));
        };
        releaseCaptureRef.current = () => { capture.node.onaudioprocess = null; };
      }
      // Handler is already buffering, so connecting the microphone during token/Live
      // setup keeps speech spoken on click instead of dropping it. Packets stay local
      // until the session is live; they are not flushed into Gemini beforehand.
      microphoneSource.connect(capture.node);
      beginAmplitudeUpdates();

      const tokenData = await tokenPromise;
      if (lifecycle !== lifecycleRef.current) return;
      const threadId = sessionThreadRef.current;
      if (!threadId) throw new Error("Voice Mode could not start a conversation.");

      const ai = new GoogleGenAI({
        apiKey: tokenData.token,
        httpOptions: { apiVersion: tokenData.apiVersion },
      });
      const session = await ai.live.connect({
        model: tokenData.model,
        callbacks: {
          onmessage: handleServerMessage,
          onerror: () => fail("Voice Mode lost its connection. You can continue by typing."),
          onclose: () => {
            if (sessionRef.current && stateRef.current !== "off" && stateRef.current !== "error") {
              fail("Voice Mode disconnected. You can continue by typing.");
            }
          },
        },
      });
      if (lifecycle !== lifecycleRef.current) {
        session.close();
        return;
      }
      sessionRef.current = session;
      initializeLiveHistory(session, tokenData.history);
      for (const data of startupAudioBufferRef.current) {
        session.sendRealtimeInput({
          audio: { data, mimeType: "audio/pcm;rate=16000" },
        });
      }
      startupAudioBufferRef.current = [];
      captureLiveRef.current = true;
      tokenPrefetchRef.current = null;
      updateState("listening");
    } catch (startError) {
      if (lifecycle !== lifecycleRef.current) return;
      const denied = startError instanceof DOMException && startError.name === "NotAllowedError";
      fail(denied
        ? "Microphone access was denied. Allow microphone access to use Voice Mode."
        : startError instanceof Error ? startError.message : "Voice Mode could not start.");
    }
  }, [beginAmplitudeUpdates, ensureVoiceToken, fail, handleServerMessage, schedulePlaybackSettle, updateState]);

  const stop = useCallback(() => {
    setError("");
    releaseResources("off");
  }, [releaseResources]);

  useEffect(() => () => releaseResources("off"), [releaseResources]);

  const stopIfThreadChanged = useCallback((threadId: string | null) => {
    if (sessionThreadRef.current && sessionThreadRef.current !== threadId) stop();
  }, [stop]);

  const updatePageContext = useCallback((pageContext: WorkspacePageContext) => {
    pageContextRef.current = pageContext;
    refreshVoiceLiveContextRef.current(pageContext);
  }, []);

  const refreshVoiceLiveContext = useCallback((
    pageContext: WorkspacePageContext,
    options?: { immediate?: boolean }
  ) => {
    const threadId = sessionThreadRef.current;
    const session = sessionRef.current;
    if (!threadId || !session || stateRef.current === "off" || stateRef.current === "error") return;
    const pageContextKey = JSON.stringify(pageContext);
    if (!options?.immediate && pageContextKey === voiceContextRefreshKeyRef.current) return;

    const run = async () => {
      if (voiceContextRefreshInFlightRef.current) return;
      voiceContextRefreshInFlightRef.current = true;
      try {
        const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/voice/context`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageContext }),
        });
        const data = await response.json().catch(() => ({})) as { contextPrompt?: string; error?: string };
        if (!response.ok || !data.contextPrompt || sessionRef.current !== session) return;
        voiceContextRefreshKeyRef.current = pageContextKey;
        session.sendClientContent({
          turns: [{ role: "user", parts: [{ text: data.contextPrompt }] }],
          turnComplete: false,
        });
      } catch {
        // Context refresh is best-effort and must not interrupt Voice Mode.
      } finally {
        voiceContextRefreshInFlightRef.current = false;
      }
    };

    if (options?.immediate) {
      if (voiceContextRefreshTimerRef.current) {
        window.clearTimeout(voiceContextRefreshTimerRef.current);
        voiceContextRefreshTimerRef.current = null;
      }
      void run();
      return;
    }
    if (voiceContextRefreshTimerRef.current) window.clearTimeout(voiceContextRefreshTimerRef.current);
    voiceContextRefreshTimerRef.current = window.setTimeout(() => {
      voiceContextRefreshTimerRef.current = null;
      void run();
    }, 300);
  }, []);
  refreshVoiceLiveContextRef.current = refreshVoiceLiveContext;

  return {
    state,
    error,
    voiceControlRef: attachVoiceControl,
    working,
    liveTranscripts,
    liveDeliverable,
    active: state === "connecting" || state === "listening" || state === "speaking",
    start,
    stop,
    stopIfThreadChanged,
    updatePageContext,
    prefetchToken,
  };
}
