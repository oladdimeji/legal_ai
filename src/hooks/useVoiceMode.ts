import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI } from "@google/genai";
import type { LiveServerMessage, Session } from "@google/genai";
import type { Message } from "../types";
import type { WorkspacePageContext } from "../types";
import {
  analyserLevel,
  audioSampleRate,
  base64Pcm16ToFloat32,
  downsampleAudio,
  float32ToPcm16Base64,
  mergeTranscriptChunk,
} from "../lib/voiceAudio";

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
  if (turns.length > 0) {
    session.sendClientContent({ turns, turnComplete: true });
    return;
  }
  session.sendClientContent({ turnComplete: true });
}

export function shouldPlayVoiceAcknowledgement(
  functionName: string | undefined,
  turnBoundary: number,
  acknowledgedTurn: number | null
): boolean {
  return functionName === "use_assistant_capabilities" && acknowledgedTurn !== turnBoundary;
}

export function shouldAdvanceVoiceTurnBoundary(
  boundary: "turnComplete" | "interrupted",
  assistantTranscript: string,
  hasInFlightAssistantCapability: boolean
): boolean {
  return boundary === "interrupted" || assistantTranscript.trim().length > 0 || !hasInFlightAssistantCapability;
}

export function useVoiceMode({ onTranscript }: UseVoiceModeOptions) {
  const [state, setState] = useState<VoiceModeState>("off");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [liveTranscripts, setLiveTranscripts] = useState<LiveVoiceTranscripts>({ user: "", assistant: "" });
  const stateRef = useRef<VoiceModeState>("off");
  const lifecycleRef = useRef(0);
  const sessionThreadRef = useRef<string | null>(null);
  const sessionIdRef = useRef("");
  const sessionRef = useRef<Session | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const microphoneSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const microphoneAnalyserRef = useRef<AnalyserNode | null>(null);
  const assistantAnalyserRef = useRef<AnalyserNode | null>(null);
  const playbackSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const playbackAtRef = useRef(0);
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
  const acknowledgedTurnRef = useRef<number | null>(null);
  const acknowledgementAudioRef = useRef<VoiceAcknowledgementAudio | null>(null);
  const acknowledgementRequestRef = useRef<Promise<VoiceAcknowledgementAudio | null> | null>(null);
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

  const stopPlayback = useCallback(() => {
    for (const source of playbackSourcesRef.current) {
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    playbackSourcesRef.current.clear();
    playbackAtRef.current = 0;
  }, []);

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
    sessionThreadRef.current = null;
    transcriptRef.current = { user: "", assistant: "" };
    pageContextRef.current = null;
    pendingCapabilityMetadataRef.current = null;
    inFlightAssistantCapabilityTurnsRef.current.clear();
    pausedAssistantCapabilityTurnRef.current = null;
    acknowledgedTurnRef.current = null;
    acknowledgementAudioRef.current = null;
    acknowledgementRequestRef.current = null;
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
    if (advanceTurnBoundary) {
      pendingCapabilityMetadataRef.current = null;
      pausedAssistantCapabilityTurnRef.current = null;
      turnBoundaryRef.current += 1;
    }
    for (const transcript of completed) {
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
    const samples = base64Pcm16ToFloat32(data);
    if (samples.length === 0) return;
    const buffer = context.createBuffer(1, samples.length, audioSampleRate(mimeType));
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    const startAt = Math.max(context.currentTime + 0.015, playbackAtRef.current);
    playbackAtRef.current = startAt + buffer.duration;
    playbackSourcesRef.current.add(source);
    source.onended = () => {
      playbackSourcesRef.current.delete(source);
      source.disconnect();
      if (playbackSourcesRef.current.size === 0 && stateRef.current === "speaking") {
        updateState("listening");
      }
    };
    updateState("speaking");
    source.start(startAt);
  }, [updateState]);

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

  const handleServerMessage = useCallback((message: LiveServerMessage) => {
    if (message.toolCall?.functionCalls?.length) {
      const threadId = sessionThreadRef.current;
      const pageContext = pageContextRef.current;
      const session = sessionRef.current;
      if (threadId && pageContext && session) {
        void Promise.all(message.toolCall.functionCalls.map(async (call, callIndex) => {
          const isAssistantCapability = call.name === "use_assistant_capabilities";
          const request = isAssistantCapability
            ? (typeof call.args?.request === "string" ? call.args.request.trim() : "")
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
          const workingCallId = call.id || `${call.name || "lookup_workspace"}_${Date.now()}_${callIndex}`;
          workingCallIdsRef.current.add(workingCallId);
          if (isAssistantCapability) {
            const inFlightCount = inFlightAssistantCapabilityTurnsRef.current.get(turnBoundary) || 0;
            inFlightAssistantCapabilityTurnsRef.current.set(turnBoundary, inFlightCount + 1);
          }
          setWorking(true);
          try {
            const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/voice/${isAssistantCapability ? "assistant" : "lookup"}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(isAssistantCapability
                ? { request, pageContext }
                : {
                    query: request,
                    pageContext,
                    ...(typeof call.args?.firmLibraryDocumentTitle === "string"
                      ? { firmLibraryDocumentTitle: call.args.firmLibraryDocumentTitle.trim() }
                      : {}),
                  }),
            });
            const data = await response.json().catch(() => ({})) as {
              evidence?: string;
              result?: string;
              capabilityMetadata?: VoiceCapabilityMetadata;
              error?: string;
            };
            if (isAssistantCapability && response.ok && turnBoundary === turnBoundaryRef.current) {
              pendingCapabilityMetadataRef.current = data.capabilityMetadata || null;
            }
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name || "lookup_workspace",
                response: response.ok
                  ? { output: (isAssistantCapability ? data.result : data.evidence) || "No authorized result was found." }
                  : { error: data.error || (isAssistantCapability ? "The Assistant capability request failed." : "The authorized workspace lookup failed.") },
              }],
            });
          } catch {
            if (isAssistantCapability && turnBoundary === turnBoundaryRef.current) {
              pendingCapabilityMetadataRef.current = null;
            }
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name || "lookup_workspace",
                response: { error: isAssistantCapability ? "The Assistant capability request failed." : "The authorized workspace lookup failed." },
              }],
            });
          } finally {
            workingCallIdsRef.current.delete(workingCallId);
            if (isAssistantCapability) {
              const inFlightCount = inFlightAssistantCapabilityTurnsRef.current.get(turnBoundary) || 0;
              if (inFlightCount <= 1) inFlightAssistantCapabilityTurnsRef.current.delete(turnBoundary);
              else inFlightAssistantCapabilityTurnsRef.current.set(turnBoundary, inFlightCount - 1);
            }
            setWorking(workingCallIdsRef.current.size > 0);
          }
        }));
      }
    }
    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) {
      clearWorking();
      stopPlayback();
      updateState("listening");
    }
    for (const part of content.interrupted ? [] : content.modelTurn?.parts || []) {
      const inlineData = part.inlineData;
      if (inlineData?.data && inlineData.mimeType?.startsWith("audio/")) {
        scheduleAudio(inlineData.data, inlineData.mimeType);
      }
    }
    if (content.inputTranscription?.text) {
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
    if (content.outputTranscription?.text) {
      transcriptRef.current.assistant = mergeTranscriptChunk(
        transcriptRef.current.assistant,
        content.outputTranscription.text
      );
      scheduleTranscriptFlush();
    }
    if (content.interrupted) finalizeTranscripts("interrupted");
    if (content.turnComplete) {
      const hasInFlightAssistantCapability = (inFlightAssistantCapabilityTurnsRef.current.get(turnBoundaryRef.current) || 0) > 0;
      const shouldAdvanceTurnBoundary = shouldAdvanceVoiceTurnBoundary(
        "turnComplete",
        transcriptRef.current.assistant,
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

  const start = useCallback(async (threadId: string, pageContext: WorkspacePageContext) => {
    if (stateRef.current === "connecting" || stateRef.current === "listening" || stateRef.current === "speaking") return;
    const lifecycle = ++lifecycleRef.current;
    setError("");
    updateState("connecting");
    sessionThreadRef.current = threadId;
    pageContextRef.current = pageContext;
    sessionIdRef.current = voiceSessionId();
    eventSequenceRef.current = { user: 0, assistant: 0 };
    transcriptRef.current = { user: "", assistant: "" };
    setLiveTranscripts({ user: "", assistant: "" });
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("A microphone is not available in this browser.");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (lifecycle !== lifecycleRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const tokenResponse = await fetch(`/api/threads/${encodeURIComponent(threadId)}/voice/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageContext }),
      });
      const tokenData = await tokenResponse.json().catch(() => ({})) as VoiceTokenResponse;
      if (!tokenResponse.ok || !tokenData.token) throw new Error(tokenData.error || "Voice Mode could not connect. Please try again.");
      if (lifecycle !== lifecycleRef.current) return;

      const context = new AudioContext({ latencyHint: "interactive" });
      audioContextRef.current = context;
      await context.resume();
      const microphoneSource = context.createMediaStreamSource(stream);
      const microphoneAnalyser = context.createAnalyser();
      microphoneAnalyser.fftSize = 256;
      microphoneAnalyser.smoothingTimeConstant = 0.72;
      const assistantAnalyser = context.createAnalyser();
      assistantAnalyser.fftSize = 256;
      assistantAnalyser.smoothingTimeConstant = 0.68;
      assistantAnalyser.connect(context.destination);
      const processor = context.createScriptProcessor(2048, 1, 1);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      microphoneSource.connect(microphoneAnalyser);
      microphoneSource.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
      microphoneSourceRef.current = microphoneSource;
      microphoneAnalyserRef.current = microphoneAnalyser;
      assistantAnalyserRef.current = assistantAnalyser;
      processorRef.current = processor;
      silentGainRef.current = silentGain;

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
      processor.onaudioprocess = (event) => {
        if (sessionRef.current !== session) return;
        const samples = downsampleAudio(event.inputBuffer.getChannelData(0), context.sampleRate);
        session.sendRealtimeInput({
          audio: { data: float32ToPcm16Base64(samples), mimeType: "audio/pcm;rate=16000" },
        });
      };
      beginAmplitudeUpdates();
      updateState("listening");
    } catch (startError) {
      const denied = startError instanceof DOMException && startError.name === "NotAllowedError";
      fail(denied
        ? "Microphone access was denied. Allow microphone access to use Voice Mode."
        : startError instanceof Error ? startError.message : "Voice Mode could not start.");
    }
  }, [beginAmplitudeUpdates, fail, handleServerMessage, prefetchAcknowledgement, updateState]);

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
    active: state === "connecting" || state === "listening" || state === "speaking",
    start,
    stop,
    stopIfThreadChanged,
    updatePageContext,
  };
}
