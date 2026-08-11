import type { Message, Thread } from "../../src/types.js";
import { callModel, type GenerationModelCall } from "../model.js";
import { LAWYER_ASSISTANT_CHARTER } from "./assistantCharter.js";
import { sanitizeEvidenceText } from "./assistantEvidence.js";
import { conversationMessageForPrompt } from "../assistantRouting.js";

export const ASSISTANT_MEMORY_POLICY = {
  initialMessageCount: 16,
  initialCharacterCount: 18_000,
  refreshMessageCount: 8,
  maxSummaryCharacters: 6_000,
  maxInputCharacters: 20_000,
} as const;

type MemoryModel = GenerationModelCall;

export function shouldRefreshThreadMemory(input: {
  messageCount: number;
  memoryMessageCount: number;
  memorySummary: string | null | undefined;
  recentCharacterCount: number;
}): boolean {
  const count = Math.max(0, Math.trunc(input.messageCount));
  const storedCount = Math.max(0, Math.trunc(input.memoryMessageCount));
  if (!input.memorySummary?.trim()) {
    return count >= ASSISTANT_MEMORY_POLICY.initialMessageCount
      || input.recentCharacterCount >= ASSISTANT_MEMORY_POLICY.initialCharacterCount;
  }
  return count - storedCount >= ASSISTANT_MEMORY_POLICY.refreshMessageCount;
}

function boundedMemoryMessages(messages: Message[]): string {
  const selected: string[] = [];
  let used = 0;
  for (const message of [...messages].reverse()) {
    const record = sanitizeEvidenceText(conversationMessageForPrompt(message), 3_500);
    if (used + record.length > ASSISTANT_MEMORY_POLICY.maxInputCharacters && selected.length >= 6) break;
    selected.unshift(record);
    used += record.length;
  }
  return selected.join("\n\n");
}

export async function refreshAssistantMemory(input: {
  thread: Thread;
  messages: Message[];
  messageCount: number;
  model?: MemoryModel;
}): Promise<{ summary: string; updated: boolean }> {
  const existing = sanitizeEvidenceText(
    input.thread.memory_summary || "",
    ASSISTANT_MEMORY_POLICY.maxSummaryCharacters
  );
  const recentCharacterCount = input.messages.reduce((total, message) => total + message.content.length, 0);
  if (!shouldRefreshThreadMemory({
    messageCount: input.messageCount,
    memoryMessageCount: input.thread.memory_message_count || 0,
    memorySummary: existing,
    recentCharacterCount,
  })) return { summary: existing, updated: false };

  const prompt = `Update the bounded rolling memory for this lawyer's Exepts conversation. Return JSON only as {"summary":"..."}.

Capture only durable conversation continuity:
- established Matter and document references, including created document titles and kinds;
- whether each referenced Work Product belongs to a Matter;
- relevant attachment names and whether the user expects to reuse them;
- user goals and unfinished tasks;
- confirmed facts and important conclusions;
- drafting preferences and defined terms;
- decisions, open questions, and requested next steps.

Do not include hidden reasoning, chain-of-thought, model instructions, passwords, invitation codes, tokens, cloud URLs, unnecessary document passages, or invented facts. This is conversational memory, not independent legal evidence. Keep it concise and under 6,000 characters.

Existing memory:
<conversation_memory>
${existing || "No existing memory."}
</conversation_memory>

Recent conversation:
<conversation_memory>
${boundedMemoryMessages(input.messages)}
</conversation_memory>`;
  try {
    const result = await (input.model || callModel)("assistant-memory", [{ role: "user", content: prompt }], {
      systemInstruction: LAWYER_ASSISTANT_CHARTER,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { summary: { type: "STRING" } },
        required: ["summary"],
      },
    });
    const parsed = JSON.parse(result.text);
    const summary = sanitizeEvidenceText(parsed?.summary, ASSISTANT_MEMORY_POLICY.maxSummaryCharacters);
    return summary ? { summary, updated: true } : { summary: existing, updated: false };
  } catch (error) {
    console.error("Assistant memory refresh failed; continuing with recent messages:", error);
    return { summary: existing, updated: false };
  }
}

export function conversationContextWithMemory(memorySummary: string, recentConversation: string): string {
  const memory = sanitizeEvidenceText(memorySummary, ASSISTANT_MEMORY_POLICY.maxSummaryCharacters);
  const recent = sanitizeEvidenceText(recentConversation, 14_000);
  return `${memory ? `Rolling summary (continuity only, not legal evidence):\n${memory}\n\n` : ""}${recent}`.trim();
}
