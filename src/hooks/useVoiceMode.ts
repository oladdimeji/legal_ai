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

type UseVoiceModeOptions = {
  onTranscript: (message: Message) => void;
};

export type LiveVoiceTranscripts = {
  user: string;
  assistant: string;
};

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

export function useVoiceMode({ onTranscript }: UseVoiceModeOptions) {
  const [state, setState] = useState<VoiceModeState>("off");
  const [error, setError] = useState("");
  const [amplitude, setAmplitude] = useState(0);
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
  const transcriptRef = useRef({ user: "", assistant: "" });
  const pageContextRef = useRef<WorkspacePageContext | null>(null);
  const userFinalizedForTurnRef = useRef(false);
  const pendingAssistantTranscriptRef = useRef("");
  const eventSequenceRef = useRef({ user: 0, assistant: 0 });
  const persistQueueRef = useRef(Promise.resolve());
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const updateState = useCallback((next: VoiceModeState) => {
    stateRef.current = next;
    setState(next);
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
    userFinalizedForTurnRef.current = false;
    pendingAssistantTranscriptRef.current = "";
    setLiveTranscripts({ user: "", assistant: "" });
    setAmplitude(0);
    updateState(finalState);
  }, [stopPlayback, updateState]);

  const fail = useCallback((message: string) => {
    setError(message);
    releaseResources("error");
  }, [releaseResources]);

  const persistFinalTranscript = useCallback((role: "user" | "assistant", content: string) => {
    const threadId = sessionThreadRef.current;
    const sessionId = sessionIdRef.current;
    const normalized = content.trim();
    if (!threadId || !sessionId || !normalized) return;
    const eventId = `${role}_${++eventSequenceRef.current[role]}`;
    persistQueueRef.current = persistQueueRef.current.then(async () => {
      const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/voice/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content: normalized, sessionId, eventId }),
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

  const finalizeTranscript = useCallback((role: "user" | "assistant") => {
    const content = transcriptRef.current[role];
    transcriptRef.current[role] = "";
    if (role === "user") {
      if (!content.trim()) return;
      persistFinalTranscript("user", content);
      userFinalizedForTurnRef.current = true;
      if (pendingAssistantTranscriptRef.current) {
        persistFinalTranscript("assistant", pendingAssistantTranscriptRef.current);
        pendingAssistantTranscriptRef.current = "";
        userFinalizedForTurnRef.current = false;
      }
      return;
    }
    if (!content.trim()) return;
    if (!userFinalizedForTurnRef.current) {
      pendingAssistantTranscriptRef.current = mergeTranscriptChunk(
        pendingAssistantTranscriptRef.current,
        content
      );
      return;
    }
    persistFinalTranscript("assistant", content);
    userFinalizedForTurnRef.current = false;
  }, [persistFinalTranscript]);

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

  const handleServerMessage = useCallback((message: LiveServerMessage) => {
    if (message.toolCall?.functionCalls?.length) {
      const threadId = sessionThreadRef.current;
      const pageContext = pageContextRef.current;
      const session = sessionRef.current;
      if (threadId && pageContext && session) {
        void Promise.all(message.toolCall.functionCalls.map(async (call) => {
          const query = typeof call.args?.query === "string" ? call.args.query.trim() : "";
          try {
            const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/voice/lookup`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query, pageContext }),
            });
            const data = await response.json().catch(() => ({})) as { evidence?: string; error?: string };
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name || "lookup_workspace",
                response: response.ok
                  ? { output: data.evidence || "No authorized workspace evidence was found." }
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
          }
        }));
      }
    }
    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) {
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
      transcriptRef.current.user = mergeTranscriptChunk(
        transcriptRef.current.user,
        content.inputTranscription.text
      );
      setLiveTranscripts((current) => ({ ...current, user: transcriptRef.current.user }));
    }
    if (content.outputTranscription?.text) {
      transcriptRef.current.assistant = mergeTranscriptChunk(
        transcriptRef.current.assistant,
        content.outputTranscription.text
      );
      setLiveTranscripts((current) => ({ ...current, assistant: transcriptRef.current.assistant }));
    }
    if (content.inputTranscription?.finished) finalizeTranscript("user");
    if (content.outputTranscription?.finished) finalizeTranscript("assistant");
    if (content.turnComplete) {
      if (playbackSourcesRef.current.size === 0) updateState("listening");
    }
  }, [finalizeTranscript, scheduleAudio, stopPlayback, updateState]);

  const beginAmplitudeUpdates = useCallback(() => {
    const microphoneData = new Uint8Array(256);
    const assistantData = new Uint8Array(256);
    let lastUpdate = 0;
    const frame = (now: number) => {
      const microphoneLevel = analyserLevel(microphoneAnalyserRef.current, microphoneData);
      const assistantLevel = analyserLevel(assistantAnalyserRef.current, assistantData);
      if (now - lastUpdate > 50) {
        setAmplitude(stateRef.current === "speaking" ? assistantLevel : microphoneLevel);
        lastUpdate = now;
      }
      animationFrameRef.current = requestAnimationFrame(frame);
    };
    animationFrameRef.current = requestAnimationFrame(frame);
  }, []);

  const start = useCallback(async (threadId: string, pageContext: WorkspacePageContext) => {
    if (stateRef.current === "connecting" || stateRef.current === "listening" || stateRef.current === "speaking") return;
    const lifecycle = ++lifecycleRef.current;
    setError("");
    updateState("connecting");
    sessionThreadRef.current = threadId;
    pageContextRef.current = pageContext;
    sessionIdRef.current = voiceSessionId();
    eventSequenceRef.current = { user: 0, assistant: 0 };
    userFinalizedForTurnRef.current = false;
    pendingAssistantTranscriptRef.current = "";
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
  }, [beginAmplitudeUpdates, fail, handleServerMessage, updateState]);

  const stop = useCallback(() => {
    setError("");
    releaseResources("off");
  }, [releaseResources]);

  useEffect(() => () => releaseResources("off"), [releaseResources]);

  const stopIfThreadChanged = useCallback((threadId: string | null) => {
    if (sessionThreadRef.current && sessionThreadRef.current !== threadId) stop();
  }, [stop]);

  return {
    state,
    error,
    amplitude,
    liveTranscripts,
    active: state === "connecting" || state === "listening" || state === "speaking",
    start,
    stop,
    stopIfThreadChanged,
  };
}
