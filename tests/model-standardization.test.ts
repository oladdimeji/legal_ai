import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  buildGenerationConfig,
  EMBEDDING_DIMENSIONALITY,
  embedTextsWithClient,
  MODEL_CONFIGS,
  MODEL_THINKING_LEVELS,
} from "../server/model.js";
import { adaptiveAssistantThinkingLevel } from "../server/assistant/assistantPrompts.js";
import type { AssistantIntent, AssistantPlan } from "../server/assistant/assistantTypes.js";

const expectedModels = {
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

const expectedThinkingLevels = {
  chat: "medium",
  "classify-complexity": "minimal",
  "assistant-planner": "low",
  "assistant-memory": "minimal",
  "draft-generation": "low",
  "matter-intelligence": "medium",
  "client-assistant": "medium",
  "summarize-subquestion": "low",
} as const;

function plan(intent: AssistantIntent, depth: AssistantPlan["depth"] = "standard"): AssistantPlan {
  return {
    intent,
    depth,
    needsWorkspace: false,
    needsCurrentPage: false,
    needsWeb: false,
    needsClarification: false,
    deliverable: { kind: "message" },
    referencedArtifactIds: [],
    referencedResearchSourceIds: [],
    toolCalls: [],
  };
}

async function productionTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
  }));
  return nested.flat();
}

test("confirmed Gemini model assignments and thinking defaults are exact", () => {
  assert.deepEqual(MODEL_CONFIGS, expectedModels);
  assert.deepEqual(MODEL_THINKING_LEVELS, expectedThinkingLevels);
  assert.equal("embedding" in MODEL_THINKING_LEVELS, false);
});

test("generation config uses task defaults and permits explicit thinking overrides", () => {
  assert.deepEqual(buildGenerationConfig("chat", {}), {
    thinkingConfig: { thinkingLevel: "medium" },
  });
  assert.deepEqual(buildGenerationConfig("classify-complexity", { thinkingLevel: "low" }), {
    thinkingConfig: { thinkingLevel: "low" },
  });
  assert.deepEqual(buildGenerationConfig("chat", {
    systemInstruction: "System",
    responseMimeType: "application/json",
    responseSchema: { type: "OBJECT" },
    googleSearch: true,
  }), {
    systemInstruction: "System",
    thinkingConfig: { thinkingLevel: "medium" },
    responseMimeType: "application/json",
    responseSchema: { type: "OBJECT" },
    tools: [{ googleSearch: {} }],
  });
});

test("adaptive Assistant thinking matches intent and depth policy", () => {
  assert.equal(adaptiveAssistantThinkingLevel(plan("product_help")), "low");
  assert.equal(adaptiveAssistantThinkingLevel(plan("general_conversation")), "low");
  assert.equal(adaptiveAssistantThinkingLevel(plan("workspace_lookup")), "medium");
  assert.equal(adaptiveAssistantThinkingLevel(plan("legal_analysis")), "medium");
  assert.equal(adaptiveAssistantThinkingLevel(plan("legal_analysis", "thorough")), "high");
});

test("embedding model and output dimensions remain unchanged", async () => {
  const modelSource = await readFile("server/model.ts", "utf8");
  assert.equal(MODEL_CONFIGS.embedding, "gemini-embedding-2");
  assert.match(modelSource, /model:\s*MODEL_CONFIGS\.embedding/);
  assert.match(modelSource, /outputDimensionality:\s*768/);
});

test("multi-text embedding sends independent ordered contents and validates one 768-vector per input", async () => {
  const inputs = ["first paragraph", "second paragraph", "third paragraph"];
  let request: any;
  const vectors = inputs.map((_, index) => Array.from({ length: 768 }, (_value, dimension) => index * 1000 + dimension));
  const result = await embedTextsWithClient(inputs, {
    models: {
      embedContent: async (value) => {
        request = value;
        return { embeddings: vectors.map((values) => ({ values })) };
      },
    },
  }, { maxAttempts: 1 });
  assert.equal(EMBEDDING_DIMENSIONALITY, 768);
  assert.equal(request.model, "gemini-embedding-2");
  assert.equal(request.config.outputDimensionality, 768);
  assert.deepEqual(request.contents, inputs.map((text) => ({ role: "user", parts: [{ text }] })));
  assert.deepEqual(result, vectors);
});

test("multi-text embedding rejects mismatched and malformed responses safely", async () => {
  const vector = Array(768).fill(0.25);
  await assert.rejects(embedTextsWithClient(["one", "two"], {
    models: { embedContent: async () => ({ embeddings: [{ values: vector }] }) },
  }, { maxAttempts: 1 }), /count mismatch/);
  await assert.rejects(embedTextsWithClient(["one"], {
    models: { embedContent: async () => ({ embeddings: [{ values: [Number.NaN] }] }) },
  }, { maxAttempts: 1 }), /unusable vector/);
});

test("single embedding callers retain the same ordered vector contract", async () => {
  const vector = Array.from({ length: 768 }, (_value, index) => index / 10);
  const result = await embedTextsWithClient(["single paragraph"], {
    models: { embedContent: async () => ({ embedding: { values: vector } }) },
  }, { maxAttempts: 1 });
  assert.deepEqual(result, [vector]);
  const modelSource = await readFile("server/model.ts", "utf8");
  assert.match(modelSource, /const \[embedding\] = await embedTexts\(\[text\]\)/);
});

test("production Gemini generation does not configure deprecated sampling", async () => {
  const files = ["server.ts", ...(await productionTypeScriptFiles("server"))];
  const sources = await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")] as const));

  for (const [file, source] of sources) {
    assert.doesNotMatch(source, /\btemperature\s*:/, `${file} passes temperature`);
    assert.doesNotMatch(source, /config\.temperature\b/, `${file} configures temperature`);
    assert.doesNotMatch(source, /gemini-3\.1-flash-lite/, `${file} uses the retired model`);
    assert.doesNotMatch(source, /\b(?:topP|topK|top_p|top_k)\s*:/, `${file} adds sampling parameters`);
  }
});
