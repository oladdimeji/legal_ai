import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Unified configuration for models per task type
export const MODEL_CONFIGS = {
  chat: "gemini-3.6-flash",
  "classify-complexity": "gemini-3.5-flash-lite",
  "assistant-planner": "gemini-3.5-flash-lite",
  "assistant-memory": "gemini-3.5-flash-lite",
  "draft-generation": "gemini-3.6-flash",
  "matter-intelligence": "gemini-3.6-flash",
  "client-assistant": "gemini-3.6-flash",
  embedding: "gemini-embedding-2",
  "summarize-subquestion": "gemini-3.5-flash-lite",
} as const;

export type ModelTaskType = keyof typeof MODEL_CONFIGS;
export type ModelThinkingLevel =
  | "minimal"
  | "low"
  | "medium"
  | "high";

export const MODEL_THINKING_LEVELS = {
  chat: "medium",
  "classify-complexity": "minimal",
  "assistant-planner": "low",
  "assistant-memory": "minimal",
  "draft-generation": "medium",
  "matter-intelligence": "medium",
  "client-assistant": "medium",
  "summarize-subquestion": "low",
} as const satisfies Partial<Record<ModelTaskType, ModelThinkingLevel>>;

type CallModelOptions = {
  provider?: Provider;
  systemInstruction?: string;
  thinkingLevel?: ModelThinkingLevel;
  responseMimeType?: string;
  responseSchema?: any;
  googleSearch?: boolean;
  textToEmbed?: string; // used when taskType is 'embedding'
};

export function buildGenerationConfig(
  taskType: Exclude<ModelTaskType, "embedding">,
  options: CallModelOptions
): any {
  const config: any = {};
  if (options.systemInstruction) {
    config.systemInstruction = options.systemInstruction;
  }
  const thinkingLevel = options.thinkingLevel ?? MODEL_THINKING_LEVELS[taskType];
  if (thinkingLevel) {
    config.thinkingConfig = { thinkingLevel };
  }
  if (options.responseMimeType) {
    config.responseMimeType = options.responseMimeType;
  }
  if (options.responseSchema) {
    config.responseSchema = options.responseSchema;
  }
  if (options.googleSearch) {
    config.tools = [{ googleSearch: {} }];
  }
  return config;
}

// Lazy initialization of GoogleGenAI client to prevent startup crash if GEMINI_API_KEY is not defined.
let aiInstance: GoogleGenAI | null = null;

export function getAiClient(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please set it in Settings > Secrets.");
    }
    aiInstance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "exepts",
        },
      },
    });
  }
  return aiInstance;
}

export type Provider = "gemini";

export type ModelErrorKind =
  | "transient_capacity"
  | "transient_network"
  | "authentication"
  | "invalid_request"
  | "content_blocked"
  | "unknown";

export type ModelErrorClassification = {
  kind: ModelErrorKind;
  retryable: boolean;
  statusCode?: number;
  providerStatus?: string;
  retryAfterMs?: number;
};

export type RetryDetails = ModelErrorClassification & {
  attempt: number;
  retryNumber: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
};

export const MAX_MODEL_ATTEMPTS = 4;
export const EMBEDDING_DIMENSIONALITY = 768;
const MODEL_RETRY_DELAYS_MS = [1_500, 3_500, 7_000] as const;
const MAX_RETRY_JITTER_MS = 500;
const MIN_RETRY_AFTER_MS = 1_000;
const MAX_RETRY_AFTER_MS = 15_000;

function asRecord(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === "object" ? value as Record<string, any> : null;
}

function parsedMessageError(message: unknown): Record<string, any> | null {
  if (typeof message !== "string" || !message.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(message);
    return asRecord(parsed?.error) || asRecord(parsed);
  } catch {
    return null;
  }
}

function retryAfterMilliseconds(headers: unknown): number | undefined {
  const record = asRecord(headers);
  const raw = typeof record?.get === "function"
    ? record.get("retry-after")
    : record?.["retry-after"] ?? record?.["Retry-After"];
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;
  const seconds = Number(raw);
  let milliseconds = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(String(raw)) - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return undefined;
  milliseconds = Math.max(MIN_RETRY_AFTER_MS, Math.min(MAX_RETRY_AFTER_MS, milliseconds));
  return Math.round(milliseconds);
}

export function classifyModelError(error: unknown): ModelErrorClassification {
  const root = asRecord(error);
  const nested = asRecord(root?.error);
  const response = asRecord(root?.response);
  const parsed = parsedMessageError(root?.message);
  const values = [
    typeof error === "string" ? error : undefined,
    root?.message, root?.status, root?.statusCode, root?.code,
    nested?.message, nested?.status, nested?.code,
    response?.status, parsed?.message, parsed?.status, parsed?.code,
  ].filter((value) => value !== undefined && value !== null);
  const text = values.map(String).join(" ").toLowerCase();
  const numericCandidates = [root?.status, root?.statusCode, root?.code, nested?.code, response?.status, parsed?.code];
  const statusCode = numericCandidates
    .map((value) => typeof value === "number" ? value : /^\d{3}$/.test(String(value || "")) ? Number(value) : undefined)
    .find((value) => value !== undefined);
  const providerCandidate = [nested?.status, root?.status, root?.code, parsed?.status]
    .find((value) => typeof value === "string" && /^[A-Z][A-Z_]+$/.test(value));
  const providerStatus = typeof providerCandidate === "string" ? providerCandidate : undefined;
  const retryAfterMs = retryAfterMilliseconds(response?.headers || root?.headers);

  if (
    statusCode === 401 || /unauthenticated|authentication fail|invalid api key|missing api key|gemini_api_key|api[_ ]key.*(?:invalid|required|missing)/i.test(text)
  ) return { kind: "authentication", retryable: false, statusCode, providerStatus };
  if (
    /content[_ -]?policy|content blocked|safety block|blocked.*safety|recitation block|finish_reason.*(?:safety|recitation)/i.test(text)
  ) return { kind: "content_blocked", retryable: false, statusCode, providerStatus };
  if (
    statusCode === 400 || statusCode === 403 || statusCode === 404 ||
    /invalid_argument|permission_denied|model not found|unsupported model|invalid request|malformed response schema|missing embedding text|no text provided for embedding|failed to retrieve embedding/i.test(text)
  ) return { kind: "invalid_request", retryable: false, statusCode, providerStatus };

  const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
  const transientProviderStatuses = new Set(["RESOURCE_EXHAUSTED", "UNAVAILABLE", "DEADLINE_EXCEEDED", "INTERNAL"]);
  if (
    (statusCode !== undefined && transientStatuses.has(statusCode)) ||
    (providerStatus !== undefined && transientProviderStatuses.has(providerStatus)) ||
    /high demand|temporarily overloaded|temporarily unavailable|service unavailable|server overloaded|try again later|resource exhausted|resource_exhausted|quota exceeded|rate limit|too many requests|capacity/i.test(text)
  ) return { kind: "transient_capacity", retryable: true, statusCode, providerStatus, retryAfterMs };
  if (
    /econnreset|etimedout|eai_again|econnrefused|und_err_connect_timeout|und_err_socket|fetch failed|socket hang up|network timeout/i.test(text)
  ) return { kind: "transient_network", retryable: true, statusCode, providerStatus, retryAfterMs };
  return { kind: "unknown", retryable: false, statusCode, providerStatus };
}

export function friendlyModelErrorMessage(error: unknown): string {
  const classification = classifyModelError(error);
  if (classification.kind === "transient_capacity") {
    return "The Assistant is temporarily busy and could not complete this request. Please try again in a moment.";
  }
  if (classification.kind === "transient_network") {
    return "The Assistant could not connect to the AI service. Please try again.";
  }
  if (classification.kind === "authentication") {
    return "The Assistant is not configured correctly. Please contact the administrator.";
  }
  return "The Assistant could not complete the request. Please try again.";
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type EmbeddingClient = {
  models: {
    embedContent: (input: {
      model: string;
      contents: Array<{ role: "user"; parts: Array<{ text: string }> }>;
      config: { outputDimensionality: number };
    }) => Promise<unknown>;
  };
};

function embeddingVectors(response: unknown, expectedCount: number): number[][] {
  const record = asRecord(response);
  const embeddings = Array.isArray(record?.embeddings)
    ? record.embeddings
    : expectedCount === 1 && record?.embedding
      ? [record.embedding]
      : [];
  if (embeddings.length !== expectedCount) {
    throw new Error(`Gemini embedding response count mismatch: expected ${expectedCount}, received ${embeddings.length}`);
  }
  return embeddings.map((embedding, index) => {
    const values = asRecord(embedding)?.values;
    if (
      !Array.isArray(values) ||
      values.length !== EMBEDDING_DIMENSIONALITY ||
      values.some((value) => typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new Error(`Gemini embedding response contained an unusable vector at index ${index}`);
    }
    return values;
  });
}

export async function embedTextsWithClient(
  texts: string[],
  client: EmbeddingClient,
  retryOptions: Parameters<typeof runWithTransientModelRetries>[1] = {}
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.some((text) => typeof text !== "string" || !text.trim())) {
    throw new Error("No text provided for embedding generation");
  }
  return runWithTransientModelRetries(async () => {
    const response = await client.models.embedContent({
      model: MODEL_CONFIGS.embedding,
      contents: texts.map((text) => ({ role: "user", parts: [{ text }] })),
      config: { outputDimensionality: 768 },
    });
    return embeddingVectors(response, texts.length);
  }, retryOptions);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  return embedTextsWithClient(texts, getAiClient() as unknown as EmbeddingClient, {
    onRetry: (details) => {
      const status = details.statusCode ? ` status=${details.statusCode}` : "";
      console.warn(
        `[embedTexts] Transient Gemini failure for embedding/${MODEL_CONFIGS.embedding}. ` +
        `Retry ${details.retryNumber} of ${details.maxAttempts - 1} in ${details.delayMs}ms. ` +
        `kind=${details.kind}${status}`
      );
    },
  });
}

export async function runWithTransientModelRetries<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    maxAttempts?: number;
    sleep?: (milliseconds: number) => Promise<void>;
    random?: () => number;
    onRetry?: (details: RetryDetails) => void;
  } = {}
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? MAX_MODEL_ATTEMPTS));
  const sleep = options.sleep ?? delay;
  const random = options.random ?? Math.random;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const classification = classifyModelError(error);
      if (!classification.retryable || attempt >= maxAttempts) throw error;
      const baseDelay = MODEL_RETRY_DELAYS_MS[Math.min(attempt - 1, MODEL_RETRY_DELAYS_MS.length - 1)];
      const delayMs = classification.retryAfterMs
        ?? baseDelay + Math.floor(Math.max(0, Math.min(1, random())) * (MAX_RETRY_JITTER_MS + 1));
      options.onRetry?.({
        ...classification,
        attempt,
        retryNumber: attempt,
        maxAttempts,
        delayMs,
        error,
      });
      await sleep(delayMs);
    }
  }
  throw new Error("Model retry runner exhausted unexpectedly");
}

/**
 * Call model through a unified calling layer.
 * A new provider would just be a new branch in the switch statement below.
 */
export async function callModel(
  taskType: ModelTaskType,
  messages: any[],
  options: CallModelOptions = {}
) {
  const provider = options.provider || "gemini";

  switch (provider) {
    case "gemini": {
      const modelName = MODEL_CONFIGS[taskType];
      try {
        if (taskType === "embedding") {
          const text = options.textToEmbed || (messages && messages[0]?.content) || "";
          const [embedding] = await embedTexts([text]);
          return embedding;
        }
        return await runWithTransientModelRetries(async () => {
          const ai = getAiClient();

          // Prepare contents for standard text generation
          // Convert standard chat message structures into Gemini parts/contents format
          const contents = messages.map((m) => {
            return {
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            };
          });

          const config = buildGenerationConfig(taskType, options);

          const response = await ai.models.generateContent({
            model: modelName,
            contents,
            config,
          });

          // Return both text and any grounding metadata (for inline citations and web links)
          return {
            text: response.text || "",
            groundingMetadata: response.candidates?.[0]?.groundingMetadata || null,
          };
        }, {
          onRetry: (details) => {
            const status = details.statusCode ? ` status=${details.statusCode}` : "";
            console.warn(
              `[callModel] Transient Gemini failure for ${taskType}/${modelName}. ` +
              `Retry ${details.retryNumber} of ${details.maxAttempts - 1} in ${details.delayMs}ms. ` +
              `kind=${details.kind}${status}`
            );
          },
        });
      } catch (error) {
        const safeError = new Error(friendlyModelErrorMessage(error));
        (safeError as Error & { cause?: unknown }).cause = error;
        throw safeError;
      }
    }

    default:
      throw new Error(`Unsupported model provider: ${provider}`);
  }
}
