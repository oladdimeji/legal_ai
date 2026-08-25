import type { Message } from "../types";

export type AssistantTurnPayload = {
  userMessage: Message;
  assistantMessage: Message;
  assistantIntent?: string;
  deliverableKind?: string;
  document?: unknown;
  error?: string;
};

export type AssistantDraftStreamEvent = {
  type?: string;
  text?: string;
  error?: string;
  userMessage?: Message;
  assistantMessage?: Message;
  assistantIntent?: string;
  deliverableKind?: string;
  document?: unknown;
};

export function isAssistantNdjsonResponse(contentType: string | null): boolean {
  return Boolean(contentType && /ndjson/i.test(contentType));
}

export function applyAssistantDraftPreview(
  current: string,
  event: Pick<AssistantDraftStreamEvent, "type" | "text">
): string {
  if (event.type === "draft_reset") return "";
  if (event.type === "draft_delta" && typeof event.text === "string") return current + event.text;
  return current;
}

export function parseAssistantNdjsonBuffer(buffer: string): {
  events: AssistantDraftStreamEvent[];
  rest: string;
} {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: AssistantDraftStreamEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    events.push(JSON.parse(trimmed) as AssistantDraftStreamEvent);
  }
  return { events, rest };
}

export async function consumeAssistantTurnResponse(
  response: Response,
  options: {
    onDraftDelta?: (preview: string) => void;
    onDraftReset?: () => void;
  } = {}
): Promise<AssistantTurnPayload> {
  const contentType = response.headers.get("content-type");
  if (!isAssistantNdjsonResponse(contentType)) {
    const data = await response.json().catch(() => ({})) as AssistantTurnPayload;
    return data;
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("The Assistant could not stream this draft.");
  const decoder = new TextDecoder();
  let buffer = "";
  let preview = "";
  let complete: AssistantTurnPayload | null = null;

  const applyEvent = (event: AssistantDraftStreamEvent) => {
    if (event.type === "draft_reset") {
      preview = "";
      options.onDraftReset?.();
      return;
    }
    if (event.type === "draft_delta") {
      preview = applyAssistantDraftPreview(preview, event);
      options.onDraftDelta?.(preview);
      return;
    }
    if (event.type === "error") {
      complete = {
        userMessage: undefined as unknown as Message,
        assistantMessage: undefined as unknown as Message,
        error: event.error || "The Assistant could not complete the request. Please try again.",
      };
      return;
    }
    if (event.type === "complete" && event.userMessage && event.assistantMessage) {
      complete = {
        userMessage: event.userMessage,
        assistantMessage: event.assistantMessage,
        assistantIntent: event.assistantIntent,
        deliverableKind: event.deliverableKind,
        ...(event.document ? { document: event.document } : {}),
      };
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      const { events } = parseAssistantNdjsonBuffer(`${buffer}\n`);
      for (const event of events) applyEvent(event);
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseAssistantNdjsonBuffer(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) applyEvent(event);
  }

  if (complete?.error) return complete;
  if (!complete?.userMessage || !complete.assistantMessage) {
    return {
      userMessage: undefined as unknown as Message,
      assistantMessage: undefined as unknown as Message,
      error: "The Assistant could not complete the request. Please try again.",
    };
  }
  return complete;
}
