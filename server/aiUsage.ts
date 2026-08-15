import { AsyncLocalStorage } from "node:async_hooks";
import type { GenerationModelTaskType } from "./model.js";

export type AiUsageContext = {
  userId: string;
  firmId: string | null;
};

export type GeminiUsageMetadata = {
  promptTokenCount?: number | null;
  cachedContentTokenCount?: number | null;
  candidatesTokenCount?: number | null;
  thoughtsTokenCount?: number | null;
  toolUsePromptTokenCount?: number | null;
  totalTokenCount?: number | null;
};

export type AiUsagePricing = {
  inputRateNanosPerToken: bigint;
  cachedInputRateNanosPerToken: bigint;
  outputRateNanosPerToken: bigint;
};

export type AiUsageEvent = {
  userId: string;
  firmId: string | null;
  provider: "gemini";
  model: string;
  taskType: GenerationModelTaskType;
  promptTokens: bigint;
  cachedTokens: bigint;
  candidateTokens: bigint;
  thinkingTokens: bigint;
  toolUsePromptTokens: bigint;
  totalTokens: bigint;
  inputRateNanosPerToken: bigint | null;
  cachedInputRateNanosPerToken: bigint | null;
  outputRateNanosPerToken: bigint | null;
  costUsdNanos: bigint | null;
  createdAt: Date;
};

export type AiUsageRecorder = (event: AiUsageEvent) => void | Promise<void>;

const usageContextStorage = new AsyncLocalStorage<AiUsageContext>();
let usageRecorder: AiUsageRecorder | null = null;

const GEMINI_FLASH_2027_EFFECTIVE_AT = Date.parse("2027-01-01T00:00:00.000Z");

function nonNegativeTokenCount(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.floor(value));
}

export function geminiPricingForModel(model: string, occurredAt: Date): AiUsagePricing | null {
  if (model === "gemini-3.6-flash") {
    return occurredAt.getTime() >= GEMINI_FLASH_2027_EFFECTIVE_AT
      ? {
          inputRateNanosPerToken: 1_500n,
          cachedInputRateNanosPerToken: 150n,
          outputRateNanosPerToken: 7_500n,
        }
      : {
          inputRateNanosPerToken: 750n,
          cachedInputRateNanosPerToken: 75n,
          outputRateNanosPerToken: 3_750n,
        };
  }
  if (model === "gemini-3.5-flash-lite") {
    return {
      inputRateNanosPerToken: 300n,
      cachedInputRateNanosPerToken: 30n,
      outputRateNanosPerToken: 2_500n,
    };
  }
  return null;
}

export function priceGeminiUsage(input: {
  model: string;
  usageMetadata: GeminiUsageMetadata;
  occurredAt?: Date;
}): Omit<AiUsageEvent, "userId" | "firmId" | "provider" | "taskType" | "model"> {
  const createdAt = input.occurredAt ?? new Date();
  const promptTokens = nonNegativeTokenCount(input.usageMetadata.promptTokenCount);
  const reportedCachedTokens = nonNegativeTokenCount(input.usageMetadata.cachedContentTokenCount);
  const cachedTokens = reportedCachedTokens > promptTokens ? promptTokens : reportedCachedTokens;
  const candidateTokens = nonNegativeTokenCount(input.usageMetadata.candidatesTokenCount);
  const thinkingTokens = nonNegativeTokenCount(input.usageMetadata.thoughtsTokenCount);
  const toolUsePromptTokens = nonNegativeTokenCount(input.usageMetadata.toolUsePromptTokenCount);
  const totalTokens = nonNegativeTokenCount(input.usageMetadata.totalTokenCount);
  const pricing = geminiPricingForModel(input.model, createdAt);
  const normalInputTokens = promptTokens - cachedTokens;
  const billableOutputTokens = candidateTokens + thinkingTokens;
  return {
    promptTokens,
    cachedTokens,
    candidateTokens,
    thinkingTokens,
    toolUsePromptTokens,
    totalTokens,
    inputRateNanosPerToken: pricing?.inputRateNanosPerToken ?? null,
    cachedInputRateNanosPerToken: pricing?.cachedInputRateNanosPerToken ?? null,
    outputRateNanosPerToken: pricing?.outputRateNanosPerToken ?? null,
    costUsdNanos: pricing
      ? normalInputTokens * pricing.inputRateNanosPerToken
        + cachedTokens * pricing.cachedInputRateNanosPerToken
        + billableOutputTokens * pricing.outputRateNanosPerToken
      : null,
    createdAt,
  };
}

export function runWithAiUsageContext<T>(context: AiUsageContext, operation: () => T): T {
  return usageContextStorage.run(context, operation);
}

export function registerAiUsageRecorder(recorder: AiUsageRecorder | null): void {
  usageRecorder = recorder;
}

export function captureGeminiGenerationUsage(input: {
  model: string;
  taskType: GenerationModelTaskType;
  usageMetadata: GeminiUsageMetadata | null | undefined;
  occurredAt?: Date;
}): void {
  const context = usageContextStorage.getStore();
  if (!context || !input.usageMetadata) return;

  const priced = priceGeminiUsage({
    model: input.model,
    usageMetadata: input.usageMetadata,
    occurredAt: input.occurredAt,
  });
  if (priced.costUsdNanos === null) {
    console.warn(`[aiUsage] No configured Gemini price for model ${input.model}; recording an unpriced event.`);
  }
  if (!usageRecorder) {
    console.warn("[aiUsage] Usage recorder is unavailable; generation accounting was skipped.");
    return;
  }

  const event: AiUsageEvent = {
    ...context,
    provider: "gemini",
    model: input.model,
    taskType: input.taskType,
    ...priced,
  };
  try {
    void Promise.resolve(usageRecorder(event)).catch((error) => {
      console.error("[aiUsage] Usage event persistence failed; AI response remains successful.", error);
    });
  } catch (error) {
    console.error("[aiUsage] Usage recorder failed; AI response remains successful.", error);
  }
}
