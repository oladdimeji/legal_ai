import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  captureGeminiGenerationUsage,
  geminiPricingForModel,
  priceGeminiUsage,
  registerAiUsageRecorder,
  runWithAiUsageContext,
  type AiUsageEvent,
} from "../server/aiUsage.js";
import {
  embedTextsWithClient,
  generateContentWithClient,
  runWithTransientModelRetries,
} from "../server/model.js";
import {
  filterAdminRequests,
  formatTrackedAiCost,
} from "../src/components/AdminView.js";
import type { PlatformAccessRequest } from "../src/types.js";

const PRE_2027 = new Date("2026-12-31T23:59:59.999Z");
const FROM_2027 = new Date("2027-01-01T00:00:00.000Z");

test("Gemini pricing uses exact Standard rates and the scheduled 2027 effective date", () => {
  assert.deepEqual(geminiPricingForModel("gemini-3.6-flash", PRE_2027), {
    inputRateNanosPerToken: 750n,
    cachedInputRateNanosPerToken: 75n,
    outputRateNanosPerToken: 3_750n,
  });
  assert.deepEqual(geminiPricingForModel("gemini-3.6-flash", FROM_2027), {
    inputRateNanosPerToken: 1_500n,
    cachedInputRateNanosPerToken: 150n,
    outputRateNanosPerToken: 7_500n,
  });
  assert.deepEqual(geminiPricingForModel("gemini-3.5-flash-lite", FROM_2027), {
    inputRateNanosPerToken: 300n,
    cachedInputRateNanosPerToken: 30n,
    outputRateNanosPerToken: 2_500n,
  });
  assert.equal(geminiPricingForModel("future-gemini", FROM_2027), null);
});

test("usage pricing is exact integer nanos with cached input and one output charge", () => {
  const priced = priceGeminiUsage({
    model: "gemini-3.6-flash",
    occurredAt: PRE_2027,
    usageMetadata: {
      promptTokenCount: 100,
      cachedContentTokenCount: 20,
      candidatesTokenCount: 30,
      thoughtsTokenCount: 10,
      toolUsePromptTokenCount: 7,
      totalTokenCount: 140,
    },
  });
  assert.equal(priced.promptTokens, 100n);
  assert.equal(priced.cachedTokens, 20n);
  assert.equal(priced.candidateTokens, 30n);
  assert.equal(priced.thinkingTokens, 10n);
  assert.equal(priced.toolUsePromptTokens, 7n);
  assert.equal(priced.totalTokens, 140n);
  assert.equal(priced.costUsdNanos, 80n * 750n + 20n * 75n + 40n * 3_750n);
  assert.equal(priced.costUsdNanos, 211_500n);
});

test("unknown models remain explicitly unpriced", () => {
  const priced = priceGeminiUsage({
    model: "future-gemini",
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    occurredAt: FROM_2027,
  });
  assert.equal(priced.inputRateNanosPerToken, null);
  assert.equal(priced.costUsdNanos, null);
});

test("successful authenticated generation captures exactly one cumulative event", async (t) => {
  const events: AiUsageEvent[] = [];
  registerAiUsageRecorder((event) => {
    events.push(event);
  });
  t.after(() => registerAiUsageRecorder(null));
  const client = {
    models: {
      generateContent: async () => ({
        text: "success",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
      }),
    },
  };
  const result = await runWithAiUsageContext(
    { userId: "user-1", firmId: "firm-1" },
    () => generateContentWithClient("chat", [{ role: "user", content: "Hello" }], {}, client)
  );
  assert.equal(result.text, "success");
  assert.equal(events.length, 1);
  assert.equal(events[0].userId, "user-1");
  assert.equal(events[0].firmId, "firm-1");
  assert.equal(events[0].model, "gemini-3.6-flash");
  assert.equal(events[0].taskType, "chat");
});

test("two successful calls create two immutable events whose costs sum cumulatively", () => {
  const events: AiUsageEvent[] = [];
  registerAiUsageRecorder((event) => {
    events.push(event);
  });
  try {
    runWithAiUsageContext({ userId: "user-1", firmId: "firm-1" }, () => {
      captureGeminiGenerationUsage({
        model: "gemini-3.5-flash-lite",
        taskType: "assistant-memory",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
        occurredAt: PRE_2027,
      });
      captureGeminiGenerationUsage({
        model: "gemini-3.5-flash-lite",
        taskType: "assistant-planner",
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 2 },
        occurredAt: PRE_2027,
      });
    });
    assert.equal(events.length, 2);
    assert.equal(events.reduce((sum, event) => sum + (event.costUsdNanos ?? 0n), 0n), 16_500n);
  } finally {
    registerAiUsageRecorder(null);
  }
});

test("missing authentication context and embedding calls never invent generation usage", async (t) => {
  const events: AiUsageEvent[] = [];
  registerAiUsageRecorder((event) => {
    events.push(event);
  });
  t.after(() => registerAiUsageRecorder(null));
  await generateContentWithClient("chat", [{ role: "user", content: "Hello" }], {}, {
    models: { generateContent: async () => ({ text: "unattributed", usageMetadata: { promptTokenCount: 2 } }) },
  });
  await runWithAiUsageContext({ userId: "user-1", firmId: "firm-1" }, () =>
    embedTextsWithClient(["embedding only"], {
      models: { embedContent: async () => ({ embedding: { values: Array(768).fill(0.1) } }) },
    }, { maxAttempts: 1 })
  );
  assert.equal(events.length, 0);
});

test("failed retry attempts do not create duplicate events", async (t) => {
  const events: AiUsageEvent[] = [];
  registerAiUsageRecorder((event) => {
    events.push(event);
  });
  t.after(() => registerAiUsageRecorder(null));
  let attempts = 0;
  const result = await runWithAiUsageContext({ userId: "user-1", firmId: null }, () =>
    runWithTransientModelRetries(() => generateContentWithClient(
      "chat",
      [{ role: "user", content: "Hello" }],
      {},
      {
        models: {
          generateContent: async () => {
            attempts += 1;
            if (attempts === 1) throw Object.assign(new Error("temporarily unavailable"), { status: 503 });
            return { text: "success", usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 } };
          },
        },
      }
    ), { maxAttempts: 2, sleep: async () => undefined, random: () => 0 })
  );
  assert.equal(result.text, "success");
  assert.equal(attempts, 2);
  assert.equal(events.length, 1);
});

test("recorder failure cannot fail an already-successful generation", async (t) => {
  registerAiUsageRecorder(() => {
    throw new Error("database unavailable");
  });
  t.after(() => registerAiUsageRecorder(null));
  const result = await runWithAiUsageContext({ userId: "user-1", firmId: null }, () =>
    generateContentWithClient("chat", [{ role: "user", content: "Hello" }], {}, {
      models: {
        generateContent: async () => ({
          text: "still successful",
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 },
        }),
      },
    })
  );
  assert.equal(result.text, "still successful");
});

test("migration 27 is additive and the database uses INSERT plus one aggregate join", async () => {
  const [migrations, database] = await Promise.all([
    readFile("server/migrations.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
  ]);
  const migration = migrations.slice(migrations.indexOf("version: 27"));
  assert.match(migration, /name: "append_only_ai_usage_ledger"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_usage_events/);
  assert.match(migration, /cost_usd_nanos BIGINT CHECK \(cost_usd_nanos >= 0\)/);
  assert.match(migration, /ai_usage_events_user_created_idx/);
  assert.doesNotMatch(migration, /\bDROP\b|\bTRUNCATE\b|DELETE\s+FROM|ALTER\s+TABLE[\s\S]*RENAME/i);

  const recording = database.slice(
    database.indexOf("public async recordAiUsageEvent"),
    database.indexOf("public async decidePlatformAccessRequest")
  );
  assert.match(recording, /INSERT INTO ai_usage_events/);
  assert.doesNotMatch(recording, /UPDATE ai_usage_events|DELETE FROM ai_usage_events/);
  const listing = database.slice(
    database.indexOf("public async listPlatformAccessRequests"),
    database.indexOf("public async recordAiUsageEvent")
  );
  assert.match(listing, /SUM\(cost_usd_nanos\)/);
  assert.match(listing, /GROUP BY user_id/);
  assert.match(listing, /COALESCE\(usage\.tracked_ai_cost_usd_nanos, 0::bigint\)/);
  assert.equal((listing.match(/await this\.query\(/g) ?? []).length, 1);
});

const ADMIN_REQUESTS: PlatformAccessRequest[] = [
  {
    userId: "2",
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    professionalRole: "Lawyer",
    customProfessionalRole: null,
    workspaceType: "firm",
    firmName: "Analytical Legal",
    practiceAreas: ["Technology"],
    customPracticeArea: null,
    submittedAt: "2026-08-15T10:00:00.000Z",
    status: "approved",
    trackedAiCostUsdNanos: "184700000",
  },
  {
    userId: "1",
    fullName: "Grace Hopper",
    email: "grace@navy.example",
    professionalRole: "Other",
    customProfessionalRole: "General Counsel",
    workspaceType: "independent",
    firmName: null,
    practiceAreas: [],
    customPracticeArea: null,
    submittedAt: "2026-08-14T10:00:00.000Z",
    status: "pending",
    trackedAiCostUsdNanos: "2410000000",
  },
];

test("admin search is local, case-insensitive, ordered, and matches user fields", () => {
  assert.deepEqual(filterAdminRequests(ADMIN_REQUESTS, "  ADA  "), [ADMIN_REQUESTS[0]]);
  assert.deepEqual(filterAdminRequests(ADMIN_REQUESTS, "NAVY.EXAMPLE"), [ADMIN_REQUESTS[1]]);
  assert.deepEqual(filterAdminRequests(ADMIN_REQUESTS, "analytical legal"), [ADMIN_REQUESTS[0]]);
  assert.deepEqual(filterAdminRequests(ADMIN_REQUESTS, "general counsel"), [ADMIN_REQUESTS[1]]);
  assert.equal(filterAdminRequests(ADMIN_REQUESTS, ""), ADMIN_REQUESTS);
  assert.deepEqual(filterAdminRequests(ADMIN_REQUESTS, "no match"), []);
});

test("admin cost formatting keeps small values visible without floating-point accounting", () => {
  assert.equal(formatTrackedAiCost("0"), "$0.0000");
  assert.equal(formatTrackedAiCost("184700000"), "$0.1847");
  assert.equal(formatTrackedAiCost("2410000000"), "$2.41");
});

test("admin UI visibly renders search, its empty state, cost, and existing status actions", async () => {
  const adminView = await readFile("src/components/AdminView.tsx", "utf8");
  assert.match(adminView, /type="search"/);
  assert.match(adminView, /orderedRequests\.map/);
  assert.match(adminView, /No users match your search\./);
  assert.match(adminView, /Tracked AI Cost/);
  assert.match(adminView, /formatTrackedAiCost\(request\.trackedAiCostUsdNanos\)/);
  assert.match(adminView, /Approve/);
  assert.match(adminView, /Deny/);
  assert.match(adminView, /Deactivate/);
  assert.match(adminView, /Activate/);
});
