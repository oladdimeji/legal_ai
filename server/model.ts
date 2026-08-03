import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Unified configuration for models per task type
export const MODEL_CONFIGS = {
  chat: "gemini-3.6-flash",
  "classify-complexity": "gemini-3.1-flash-lite",
  "assistant-planner": "gemini-3.1-flash-lite",
  "assistant-memory": "gemini-3.1-flash-lite",
  "draft-generation": "gemini-3.6-flash",
  "matter-intelligence": "gemini-3.1-flash-lite",
  "client-assistant": "gemini-3.1-flash-lite",
  embedding: "gemini-embedding-2",
  "summarize-subquestion": "gemini-3.1-flash-lite"
};

export type ModelTaskType = keyof typeof MODEL_CONFIGS;

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

/**
 * Sanitizes raw API errors (including JSON string messages returned by the SDK on 429 quota exhaustion)
 * into friendly, clean human-readable error messages.
 */
function sanitizeErrorMessage(err: any): string {
  if (!err) return "An unknown error occurred.";
  const message = err.message || String(err);
  
  // Try to parse as JSON if it looks like JSON
  if (typeof message === "string" && message.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(message);
      if (parsed.error) {
        const apiMsg = parsed.error.message || parsed.error.status;
        const code = parsed.error.code;
        const status = parsed.error.status;
        
        if (status === "RESOURCE_EXHAUSTED" || code === 429) {
          return "The AI service is currently receiving too many requests or has exceeded its quota limits. Please retry your request in a moment.";
        }
        return apiMsg || `API Error (${code || status})`;
      }
    } catch {
      // Not valid JSON, fallback
    }
  }
  
  // Check for common keyword patterns in the raw message
  const lowerMessage = message.toLowerCase();
  if (
    lowerMessage.includes("resource_exhausted") || 
    lowerMessage.includes("429") || 
    lowerMessage.includes("quota exceeded") ||
    lowerMessage.includes("rate limit")
  ) {
    return "The AI service is currently receiving too many requests or has exceeded its quota limits. Please retry your request in a moment.";
  }
  
  return message;
}

/**
 * Helper function to determine if an error is a 429 or RESOURCE_EXHAUSTED rate limit.
 */
function isRateLimitError(err: any): boolean {
  if (!err) return false;
  const message = err.message || String(err);
  
  if (typeof message === "string") {
    if (message.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(message);
        if (parsed.error) {
          const code = parsed.error.code;
          const status = parsed.error.status;
          if (status === "RESOURCE_EXHAUSTED" || code === 429) {
            return true;
          }
        }
      } catch {
        // Ignored
      }
    }
    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes("resource_exhausted") || 
      lowerMessage.includes("429") || 
      lowerMessage.includes("quota exceeded") ||
      lowerMessage.includes("rate limit")
    ) {
      return true;
    }
  }
  return false;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call model through a unified calling layer.
 * A new provider would just be a new branch in the switch statement below.
 */
export async function callModel(
  taskType: ModelTaskType,
  messages: any[],
  options: {
    provider?: Provider;
    systemInstruction?: string;
    temperature?: number;
    responseMimeType?: string;
    responseSchema?: any;
    googleSearch?: boolean;
    textToEmbed?: string; // used when taskType is 'embedding'
  } = {}
) {
  const provider = options.provider || "gemini";

  switch (provider) {
    case "gemini": {
      const maxRetries = 2;
      let attempt = 0;
      let lastError: any = null;

      while (attempt <= maxRetries) {
        try {
          const ai = getAiClient();

          if (taskType === "embedding") {
            const text = options.textToEmbed || (messages && messages[0]?.content) || "";
            if (!text) {
              throw new Error("No text provided for embedding generation");
            }
            
            const response = await ai.models.embedContent({
              model: MODEL_CONFIGS.embedding,
              contents: text,
              config: {
                outputDimensionality: 768,
              },
            }) as any;

            const embeddingValues = response.embeddings?.[0]?.values || response.embedding?.values;
            if (!embeddingValues) {
              throw new Error("Failed to retrieve embedding values from Gemini API response");
            }
            return embeddingValues;
          }

          // Prepare contents for standard text generation
          // Convert standard chat message structures into Gemini parts/contents format
          const contents = messages.map((m) => {
            return {
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            };
          });

          // Construct standard config options
          const config: any = {};
          if (options.systemInstruction) {
            config.systemInstruction = options.systemInstruction;
          }
          if (typeof options.temperature === "number") {
            config.temperature = options.temperature;
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

          const modelName = MODEL_CONFIGS[taskType];

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
        } catch (err: any) {
          lastError = err;
          
          if (isRateLimitError(err) && attempt < maxRetries) {
            attempt++;
            const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 200;
            console.warn(`[callModel] Rate limit (429/RESOURCE_EXHAUSTED) hit. Retrying attempt ${attempt}/${maxRetries} in ${backoffMs.toFixed(0)}ms...`);
            await delay(backoffMs);
            continue;
          }
          
          // Out of retries or non-rate-limit error: sanitize and throw
          const cleanMsg = sanitizeErrorMessage(err);
          throw new Error(cleanMsg);
        }
      }
      
      const cleanMsg = sanitizeErrorMessage(lastError);
      throw new Error(cleanMsg);
    }

    default:
      throw new Error(`Unsupported model provider: ${provider}`);
  }
}
