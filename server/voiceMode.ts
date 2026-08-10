import { createHash } from "node:crypto";
import { Modality, StartSensitivity, EndSensitivity, ThinkingLevel } from "@google/genai";
import type { Message } from "../src/types.js";
import { getAiClient } from "./model.js";

export const VOICE_MODE_CONFIG = {
  model: "gemini-3.1-flash-live-preview",
  apiVersion: "v1beta",
  voiceName: "Kore",
  sessionMinutes: 30,
  newSessionMinutes: 1,
  historyMessageLimit: 12,
  historyCharacterLimit: 6000,
} as const;

export const VOICE_MODE_SYSTEM_INSTRUCTION = `You are Exepts in Voice Mode, a fast conversational legal and productivity assistant.
Speak naturally and concisely by default. Use contractions where appropriate, a professional conversational rhythm, and brief acknowledgements when useful. Do not narrate markdown, headings, internal reasoning, or processing. Avoid written-style preambles and long lists. Ask a natural follow-up question only when genuinely needed.
Use only the recent conversation supplied to this live session. Do not retrieve Matter, workspace, document, research, or tool information. Never imply that deep research, document generation, retrieval, or a tool action occurred. If a request needs the full research or tool-heavy Exepts workflow, say briefly that it is better handled in the standard Assistant. Do not provide definitive legal advice or invent facts.`;

export type VoiceHistoryTurn = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

export function boundedVoiceHistory(messages: Message[]): VoiceHistoryTurn[] {
  const selected: Message[] = [];
  let characters = 0;
  for (const message of messages.slice(-VOICE_MODE_CONFIG.historyMessageLimit).reverse()) {
    const content = message.content.trim();
    if (!content) continue;
    const remaining = VOICE_MODE_CONFIG.historyCharacterLimit - characters;
    if (remaining <= 0) break;
    const bounded = content.slice(Math.max(0, content.length - remaining));
    selected.unshift({ ...message, content: bounded });
    characters += bounded.length;
  }
  return selected.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
}

export function voiceMessageId(input: {
  threadId: string;
  sessionId: string;
  eventId: string;
  role: "user" | "assistant";
}): string {
  const digest = createHash("sha256")
    .update(`${input.threadId}\0${input.sessionId}\0${input.eventId}\0${input.role}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `msg_voice_${digest}`;
}

export function liveConnectConfig() {
  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_MODE_CONFIG.voiceName } },
      languageCode: "en-US",
    },
    systemInstruction: VOICE_MODE_SYSTEM_INSTRUCTION,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    historyConfig: { initialHistoryInClientContent: true },
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
        endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
        prefixPaddingMs: 120,
        silenceDurationMs: 500,
      },
    },
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
  };
}

export async function createVoiceModeCredential(): Promise<{
  token: string;
  model: string;
  apiVersion: string;
  expiresAt: string;
}> {
  const now = Date.now();
  const expiresAt = new Date(now + VOICE_MODE_CONFIG.sessionMinutes * 60_000).toISOString();
  const newSessionExpireTime = new Date(now + VOICE_MODE_CONFIG.newSessionMinutes * 60_000).toISOString();
  const result = await getAiClient().authTokens.create({
    config: {
      uses: 1,
      expireTime: expiresAt,
      newSessionExpireTime,
      httpOptions: { apiVersion: VOICE_MODE_CONFIG.apiVersion },
      liveConnectConstraints: {
        model: VOICE_MODE_CONFIG.model,
        config: liveConnectConfig(),
      },
      lockAdditionalFields: [],
    },
  });
  if (!result.name) throw new Error("Gemini did not return a Live credential.");
  return {
    token: result.name,
    model: VOICE_MODE_CONFIG.model,
    apiVersion: VOICE_MODE_CONFIG.apiVersion,
    expiresAt,
  };
}
