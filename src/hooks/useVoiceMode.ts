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
import {
  VOICE_PLAYBACK_DRAIN_SECONDS,
  VOICE_PLAYBACK_PREBUFFER_SECONDS,
  VOICE_PLAYBACK_PROCESSOR_NAME,
  VOICE_PLAYBACK_WORKLET_SOURCE,
} from "../lib/voicePlaybackWorklet";

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

type VoiceAcknowledgementAudio = {
  data: string;
  mimeType: string;
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

const VOICE_DOCUMENT_DELIVERABLE = String.raw`document|email|letter|memo|memorandum|agreement|contract|policy|brief|report|notice|checklist|nda|non-disclosure`;
const VOICE_DOCUMENT_CREATE = new RegExp(
  String.raw`\b(?:draft|prepare|write|compose|create|generate|produce|make)\b[\s\S]{0,120}\b(?:${VOICE_DOCUMENT_DELIVERABLE})\b`
);
const VOICE_DOCUMENT_CONVERT = new RegExp(
  String.raw`\b(?:turn into|turn to|convert into|convert to|return as|provide as|put into|format as|save as)\b[\s\S]{0,100}\b(?:${VOICE_DOCUMENT_DELIVERABLE})\b`
);
const VOICE_DOCUMENT_REVISE = new RegExp(
  String.raw`\b(?:revise|rewrite|update|amend|shorten|expand)\b[\s\S]{0,120}\b(?:it|that|document|draft|memo|letter|agreement|contract|report|policy|brief|email)\b`
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

export function shouldPlayVoiceAcknowledgement(
  functionName: string | undefined,
  turnBoundary: number,
  acknowledgedTurn: number | null
): boolean {
  return functionName === "use_assistant_capabilities" && acknowledgedTurn !== turnBoundary;
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
  hasInFlightAssistantCapability: boolean
): boolean {
  return boundary === "interrupted" || !hasInFlightAssistantCapability;
}

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
  const pendingCapabilityMetadataRef = useRef<VoiceCapabilityMetadata | null>(null);
  const workingCallIdsRef = useRef(new Set<string>());
  const inFlightAssistantCapabilityTurnsRef = useRef(new Map<number, number>());
  const pausedAssistantCapabilityTurnRef = useRef<number | null>(null);
  const turnBoundaryRef = useRef(0);
  const awaitingOpeningTurnRef = useRef(false);
  const acknowledgedTurnRef = useRef<number | null>(null);
  const acknowledgementAudioRef = useRef<VoiceAcknowledgementAudio | null>(null);
  const acknowledgementRequestRef = useRef<Promise<VoiceAcknowledgementAudio | null> | null>(null);
  const suppressLiveDocumentSpeechRef = useRef(false);
  const confirmationPlayIdRef = useRef(0);
  const tokenPrefetchRef = useRef<{
    threadId: string;
    pageContextKey: string;
    fetchedAt: number;
    promise: Promise<VoiceTokenResponse>;
  } | null>(null);
  const startupAudioBufferRef = useRef<string[]>([]);
  const captureLiveRef = useRef(false);
  const assistantCapabilityPromisesRef = useRef(new Map<number, Promise<{
    ok: boolean;
    result: string;
    capabilityMetadata: VoiceCapabilityMetadata | null;
    error?: string;
  }>>());
  const liveDeliverableRef = useRef<VoiceLiveDeliverable | null>(null);
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
      if (
        !playbackActiveRef.current
        && playbackSourcesRef.current.size === 0
        && stateRef.current === "speaking"
      ) {
        updateState("listening");
      }
    }, VOICE_PLAYBACK_SETTLE_MS);
  }, [cancelPlaybackSettle, updateState]);

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
    acknowledgementAudioRef.current = null;
    acknowledgementRequestRef.current = null;
    suppressLiveDocumentSpeechRef.current = false;
    confirmationPlayIdRef.current += 1;
    tokenPrefetchRef.current = null;
    startupAudioBufferRef.current = [];
    captureLiveRef.current = false;
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

  const persistFinalTranscript = useCallback((
    role: "user" | "assistant",
    content: string,
    capabilityMetadata?: VoiceCapabilityMetadata
  ) => {
    const threadId = sessionThreadRef.current;
    const sessionId = sessionIdRef.current;
    const normalized = content.trim();
    if (!threadId || !sessionId || !normalized) return;
    const eventId = `${role}_${++eventSequenceRef.current[role]}`;
    persistQueueRef.current = persistQueueRef.current.then(async () => {
      const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/voice/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content: normalized, sessionId, eventId, ...(capabilityMetadata ? { capabilityMetadata } : {}) }),
      });
      const data = await response.json().catch(() => ({})) as Message & { error?: string };
      if (!response.ok) throw new Error(data.error || "This Voice Mode transcript could not be saved.");
      onTranscriptRef.current(data);
      if (capabilityMetadata?.document) {
        liveDeliverableRef.current = null;
        setLiveDeliverable(null);
      }
      setLiveTranscripts((current) => current[role].trim() === normalized
        ? { ...current, [role]: "" }
        : current);
    }).catch((persistenceError) => {
      console.error("Voice transcript persistence failed.");
      setError(persistenceError instanceof Error ? persistenceError.message : "This Voice Mode transcript could not be saved.");
    });
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
    const { completed, remaining } = finalizeVoiceTranscripts(pending, boundary);
    transcriptRef.current = remaining;
    const capabilityMetadata = boundary === "turnComplete" ? pendingCapabilityMetadataRef.current : null;
    const documentContent = liveDeliverableRef.current?.content;
    const completedTranscripts = boundary === "turnComplete" && capabilityMetadata && documentContent
      ? [
          ...completed.filter((transcript) => transcript.role !== "assistant"),
          { role: "assistant" as const, content: documentContent },
        ]
      : suppressLiveDocumentSpeechRef.current
        ? completed.filter((transcript) => transcript.role !== "assistant")
        : completed;
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

  const scheduleAudio = useCallback((data: string, mimeType?: string) => {
    const context = audioContextRef.current;
    const analyser = assistantAnalyserRef.current;
    if (!context || !analyser || !data) return;
    const playback = playbackWorkletRef.current;
    if (playback) {
      const pcm = base64Pcm16ToInt16(data);
      if (pcm.length === 0) return;
      playbackActiveRef.current = true;
      cancelPlaybackSettle();
      playback.port.postMessage(
        { type: "push", samples: pcm, sampleRate: audioSampleRate(mimeType) },
        [pcm.buffer]
      );
      updateState("speaking");
      return;
    }
    const samples = base64Pcm16ToFloat32(data);
    if (samples.length === 0) return;
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
  }, [cancelPlaybackSettle, schedulePlaybackSettle, updateState]);

  const prefetchAcknowledgement = useCallback((threadId: string, lifecycle: number) => {
    if (acknowledgementAudioRef.current) return Promise.resolve(acknowledgementAudioRef.current);
    if (acknowledgementRequestRef.current) return acknowledgementRequestRef.current;
    const request = fetch(`/api/threads/${encodeURIComponent(threadId)}/voice/acknowledgement`)
      .then(async (response) => {
        if (!response.ok) return null;
        const audio = await response.json().catch(() => null) as VoiceAcknowledgementAudio | null;
        return audio?.data && audio.mimeType ? audio : null;
      })
      .then((audio) => {
        if (audio && lifecycle === lifecycleRef.current && sessionThreadRef.current === threadId) {
          acknowledgementAudioRef.current = audio;
          return audio;
        }
        return null;
      })
      .catch(() => null);
    acknowledgementRequestRef.current = request;
    void request.finally(() => {
      if (acknowledgementRequestRef.current === request) acknowledgementRequestRef.current = null;
    });
    return request;
  }, []);

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

  const handleServerMessage = useCallback((message: LiveServerMessage) => {
    const threadId = sessionThreadRef.current;
    const pageContext = pageContextRef.current;
    const session = sessionRef.current;

    const playDocumentConfirmation = (content: string) => {
      if (!threadId || !content) return;
      const confirmationId = ++confirmationPlayIdRef.current;
      const confirmationLifecycle = lifecycleRef.current;
      void fetch(`/api/threads/${encodeURIComponent(threadId)}/voice/confirmation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content }),
      }).then(async (response) => {
        if (!response.ok) return null;
        const audio = await response.json().catch(() => null) as VoiceAcknowledgementAudio | null;
        return audio?.data && audio.mimeType ? audio : null;
      }).then((audio) => {
        if (
          audio
          && confirmationId === confirmationPlayIdRef.current
          && confirmationLifecycle === lifecycleRef.current
        ) {
          scheduleAudio(audio.data, audio.mimeType);
        }
      }).catch(() => null);
    };

    const playAcknowledgement = (turnBoundary: number) => {
      if (!shouldPlayVoiceAcknowledgement("use_assistant_capabilities", turnBoundary, acknowledgedTurnRef.current)) return;
      acknowledgedTurnRef.current = turnBoundary;
      const acknowledgementAudio = acknowledgementAudioRef.current;
      if (acknowledgementAudio) {
        scheduleAudio(acknowledgementAudio.data, acknowledgementAudio.mimeType);
        return;
      }
      if (!threadId) return;
      const acknowledgementLifecycle = lifecycleRef.current;
      void prefetchAcknowledgement(threadId, acknowledgementLifecycle).then((audio) => {
        if (
          audio
          && acknowledgementLifecycle === lifecycleRef.current
          && turnBoundary === turnBoundaryRef.current
          && acknowledgedTurnRef.current === turnBoundary
        ) {
          scheduleAudio(audio.data, audio.mimeType);
        }
      });
    };

    const ensureAssistantCapability = (request: string, turnBoundary: number) => {
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
      playAcknowledgement(turnBoundary);
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
          const data = await response.json().catch(() => ({})) as {
            result?: string;
            capabilityMetadata?: VoiceCapabilityMetadata;
            error?: string;
          };
          if (response.ok && turnBoundary === turnBoundaryRef.current) {
            pendingCapabilityMetadataRef.current = data.capabilityMetadata || null;
            if (data.capabilityMetadata?.document) {
              const deliverable = {
                content: data.result || "",
                metadata: data.capabilityMetadata,
              };
              liveDeliverableRef.current = deliverable;
              setLiveDeliverable(deliverable);
              suppressLiveDocumentSpeechRef.current = true;
              playDocumentConfirmation(data.result || "");
            }
          }
          return {
            ok: response.ok,
            result: data.result || "",
            capabilityMetadata: data.capabilityMetadata || null,
            error: data.error,
          };
        } catch {
          if (turnBoundary === turnBoundaryRef.current) pendingCapabilityMetadataRef.current = null;
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

    const maybeStartVoiceDocumentCapability = () => {
      if (awaitingOpeningTurnRef.current) return;
      const userTranscript = transcriptRef.current.user.trim();
      if (!looksLikeVoiceDocumentRequest(userTranscript)) return;
      void ensureAssistantCapability(userTranscript, turnBoundaryRef.current);
    };

    if (message.toolCall?.functionCalls?.length) {
      maybeStartVoiceDocumentCapability();
      if (threadId && pageContext && session) {
        void Promise.all(message.toolCall.functionCalls.map(async (call, callIndex) => {
          const isAssistantCapability = call.name === "use_assistant_capabilities";
          const request = isAssistantCapability
            ? voiceAssistantInstruction(
                transcriptRef.current.user,
                typeof call.args?.request === "string" ? call.args.request : ""
              )
            : (typeof call.args?.query === "string" ? call.args.query.trim() : "");
          const turnBoundary = turnBoundaryRef.current;
          if (shouldPlayVoiceAcknowledgement(call.name, turnBoundary, acknowledgedTurnRef.current)) {
            acknowledgedTurnRef.current = turnBoundary;
            const acknowledgementAudio = acknowledgementAudioRef.current;
            if (acknowledgementAudio) {
              scheduleAudio(acknowledgementAudio.data, acknowledgementAudio.mimeType);
            } else {
              const acknowledgementLifecycle = lifecycleRef.current;
              void prefetchAcknowledgement(threadId, acknowledgementLifecycle).then((audio) => {
                if (
                  audio
                  && acknowledgementLifecycle === lifecycleRef.current
                  && turnBoundary === turnBoundaryRef.current
                  && acknowledgedTurnRef.current === turnBoundary
                ) {
                  scheduleAudio(audio.data, audio.mimeType);
                }
              });
            }
          }
          if (isAssistantCapability) {
            const capability = await ensureAssistantCapability(request, turnBoundary);
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name || "lookup_workspace",
                response: capability.ok
                  ? {
                      output: capability.capabilityMetadata?.document
                        ? "The document was saved. Remain silent and wait for the user to speak."
                        : (capability.result || "No authorized result was found."),
                    }
                  : { error: capability.error || "The Assistant capability request failed." },
              }],
            });
            return;
          }
          const workingCallId = call.id || `${call.name || "lookup_workspace"}_${Date.now()}_${callIndex}`;
          workingCallIdsRef.current.add(workingCallId);
          setWorking(true);
          try {
            const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/voice/lookup`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                query: request,
                pageContext,
                ...(typeof call.args?.firmLibraryDocumentTitle === "string"
                  ? { firmLibraryDocumentTitle: call.args.firmLibraryDocumentTitle.trim() }
                  : {}),
              }),
            });
            const data = await response.json().catch(() => ({})) as { evidence?: string; error?: string };
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name || "lookup_workspace",
                response: response.ok
                  ? { output: data.evidence || "No authorized result was found." }
                  : { error: data.error || "The authorized workspace lookup failed." },
              }],
            });
          } catch {
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name || "lookup_workspace",
                response: { error: "The authorized workspace lookup failed." },
              }],
            });
          } finally {
            workingCallIdsRef.current.delete(workingCallId);
            setWorking(workingCallIdsRef.current.size > 0);
          }
        }));
      }
    }
    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) {
      awaitingOpeningTurnRef.current = false;
      liveDeliverableRef.current = null;
      setLiveDeliverable(null);
      suppressLiveDocumentSpeechRef.current = false;
      confirmationPlayIdRef.current += 1;
      clearWorking();
      stopPlayback();
      updateState("listening");
    }
    for (const part of content.interrupted ? [] : content.modelTurn?.parts || []) {
      const inlineData = part.inlineData;
      if (inlineData?.data && inlineData.mimeType?.startsWith("audio/")) {
        if (awaitingOpeningTurnRef.current) continue;
        if (!suppressLiveDocumentSpeechRef.current) {
          scheduleAudio(inlineData.data, inlineData.mimeType);
        }
        maybeStartVoiceDocumentCapability();
      }
    }
    if (content.inputTranscription?.text) {
      awaitingOpeningTurnRef.current = false;
      if (suppressLiveDocumentSpeechRef.current) {
        suppressLiveDocumentSpeechRef.current = false;
        confirmationPlayIdRef.current += 1;
      }
      if (pausedAssistantCapabilityTurnRef.current === turnBoundaryRef.current) {
        pendingCapabilityMetadataRef.current = null;
        pausedAssistantCapabilityTurnRef.current = null;
        turnBoundaryRef.current += 1;
      }
      transcriptRef.current.user = mergeTranscriptChunk(
        transcriptRef.current.user,
        content.inputTranscription.text
      );
      scheduleTranscriptFlush();
    }
    // Any unexpected opening audio is dropped, not transcribed, and never saved.
    if (content.outputTranscription?.text && !awaitingOpeningTurnRef.current) {
      if (!suppressLiveDocumentSpeechRef.current) {
        transcriptRef.current.assistant = mergeTranscriptChunk(
          transcriptRef.current.assistant,
          content.outputTranscription.text
        );
        scheduleTranscriptFlush();
      }
      maybeStartVoiceDocumentCapability();
    }
    if (content.interrupted) finalizeTranscripts("interrupted");
    if (content.turnComplete) {
      awaitingOpeningTurnRef.current = false;
      const hasInFlightAssistantCapability = (inFlightAssistantCapabilityTurnsRef.current.get(turnBoundaryRef.current) || 0) > 0;
      const shouldAdvanceTurnBoundary = shouldAdvanceVoiceTurnBoundary(
        "turnComplete",
        hasInFlightAssistantCapability
      );
      if (shouldAdvanceTurnBoundary) {
        clearWorking();
        finalizeTranscripts("turnComplete");
        if (playbackSourcesRef.current.size === 0) updateState("listening");
      } else {
        pausedAssistantCapabilityTurnRef.current = turnBoundaryRef.current;
        finalizeTranscripts("turnComplete", false);
      }
    }
  }, [clearWorking, finalizeTranscripts, prefetchAcknowledgement, scheduleAudio, scheduleTranscriptFlush, stopPlayback, updateState]);

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
    suppressLiveDocumentSpeechRef.current = false;
    confirmationPlayIdRef.current += 1;
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
      void prefetchAcknowledgement(threadId, lifecycle);
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
  }, [beginAmplitudeUpdates, ensureVoiceToken, fail, handleServerMessage, prefetchAcknowledgement, schedulePlaybackSettle, updateState]);

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
  }, []);

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
