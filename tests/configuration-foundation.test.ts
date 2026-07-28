import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadServerConfig, toPublicBrowserConfig } from "../server/config.js";
import { CourtListenerAdapter } from "../server/connectors/courtlistener.js";
import { GovInfoAdapter } from "../server/connectors/govinfo.js";
import { queryLegalSources } from "../server/connectors/legalSources.js";

test("all completion-phase feature flags default false independently", () => {
  const config = loadServerConfig({ NODE_ENV: "test" });
  assert.deepEqual(config.features, {
    publicLanding: false,
    asyncIngestion: false,
    govInfo: false,
    courtListener: false,
    googleDrive: false,
    gmailSend: false,
    ocr: false,
    clientAccounts: false,
    firmTeams: false,
    privateStorage: false,
    resourceLifecycle: false,
  });
});

test("missing provider configuration fails only when its feature is enabled", () => {
  assert.doesNotThrow(() =>
    loadServerConfig({
      NODE_ENV: "production",
      GOVINFO_API_KEY: "",
      GOOGLE_CLIENT_SECRET: "",
      APP_ENCRYPTION_KEY_BASE64: "",
    })
  );
  assert.throws(
    () => loadServerConfig({ NODE_ENV: "test", FEATURE_GOVINFO: "true" }),
    /GOVINFO_API_KEY/
  );
  assert.throws(
    () => loadServerConfig({ NODE_ENV: "test", FEATURE_GOOGLE_DRIVE: "true" }),
    /GOOGLE_CLIENT_ID/
  );
});

test("deferred V1 features cannot be enabled while GovInfo can be staged", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  assert.equal(loadServerConfig({
    NODE_ENV: "test",
    FEATURE_GOVINFO: "true",
    GOVINFO_API_KEY: "test-key",
  }).features.govInfo, true);
  for (const flag of ["FEATURE_COURTLISTENER", "FEATURE_GMAIL_SEND", "FEATURE_OCR"]) {
    assert.throws(
      () => loadServerConfig({ NODE_ENV: "test", [flag]: "true", APP_ENCRYPTION_KEY_BASE64: key }),
      /deferred in V1/
    );
  }
});

test("disabled legal adapters never return canned authority", async () => {
  assert.deepEqual(await CourtListenerAdapter.query("employment privilege copyright"), []);
  assert.deepEqual(await GovInfoAdapter.query("FTC fair use constitution"), []);
});

test("forged source selections do not call adapters while server flags are false", async () => {
  let calls = 0;
  const adapter = {
    name: "test",
    async query() {
      calls += 1;
      return [];
    },
  };
  const result = await queryLegalSources(
    "confidential query",
    { courtListener: false, govInfo: false },
    { courtListener: true, govInfo: true },
    { courtListener: adapter, govInfo: adapter }
  );
  assert.deepEqual(result, { courtListener: [], govInfo: [], govInfoStatus: "empty" });
  assert.equal(calls, 0);
});

test("public browser configuration has an explicit allow-list and cannot expose secrets", () => {
  const secret = "server-only-secret-value";
  const config = loadServerConfig({
    NODE_ENV: "test",
    GEMINI_API_KEY: secret,
    SUPABASE_DB_URL: `postgres://user:${secret}@db.example/test`,
    GOOGLE_CLIENT_SECRET: secret,
    GOVINFO_API_KEY: secret,
  });
  const publicConfig = toPublicBrowserConfig(config);
  assert.deepEqual(Object.keys(publicConfig), ["features"]);
  assert.deepEqual(Object.keys(publicConfig.features), [
    "publicLanding",
    "govInfo",
    "courtListener",
    "googleDrive",
    "clientAccounts",
    "firmTeams",
    "privateStorage",
    "resourceLifecycle",
  ]);
  assert.doesNotMatch(JSON.stringify(publicConfig), new RegExp(secret));
});

test("configuration errors do not echo credentials and deferred controls are conditional", async () => {
  const secret = "never-log-or-return-this";
  let message = "";
  try {
    loadServerConfig({
      NODE_ENV: "test",
      FEATURE_GOOGLE_DRIVE: "true",
      GOOGLE_CLIENT_SECRET: secret,
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.ok(message);
  assert.doesNotMatch(message, new RegExp(secret));

  const [assistant, server] = await Promise.all([
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  assert.match(assistant, /featureFlags\.govInfo && <button/);
  assert.match(server, /app\.get\("\/api\/health\/live"/);
  assert.match(server, /app\.get\("\/api\/health\/ready"/);
});
