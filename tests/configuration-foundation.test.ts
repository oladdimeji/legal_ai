import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadServerConfig, toPublicBrowserConfig } from "../server/config.js";
import { queryLegalSources } from "../server/connectors/legalSources.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

test("optional integrations are unavailable without credentials and expose safe status only", () => {
  const config = loadServerConfig({ NODE_ENV: "test" });
  assert.equal(config.integrations.govInfo.status, "not_configured");
  assert.equal(config.integrations.google.status, "not_configured");
  assert.equal(config.integrations.transactionalEmail.status, "not_configured");
  assert.deepEqual(toPublicBrowserConfig(config), {
    integrations: {
      govInfo: { status: "not_configured" },
      google: { status: "not_configured", capabilities: [] },
      transactionalEmail: { status: "not_configured" },
    },
  });
});

test("complete provider credentials activate integrations automatically", () => {
  const config = loadServerConfig({
    NODE_ENV: "test",
    APP_BASE_URL: "https://exepts.example",
    GOVINFO_API_KEY: "gov-key",
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    GOOGLE_OAUTH_REDIRECT_URI: "https://exepts.example/api/auth/google/callback",
    APP_ENCRYPTION_KEY_BASE64: encryptionKey,
    BREVO_API_KEY: "brevo-key",
    BREVO_SENDER_EMAIL: "notices@exepts.example",
    BREVO_SENDER_NAME: "Exepts",
    BREVO_API_BASE_URL: "https://api.brevo.com/v3",
  });
  assert.equal(config.integrations.govInfo.status, "configured");
  assert.deepEqual(config.integrations.google.capabilities, ["account", "drive_export"]);
  assert.equal(config.integrations.transactionalEmail.status, "configured");
});

test("partial optional provider configuration fails with missing variable names but no secrets", () => {
  assert.throws(
    () => loadServerConfig({ NODE_ENV: "test", GOOGLE_CLIENT_ID: "secret-value" }),
    /GOOGLE_CLIENT_SECRET.*GOOGLE_OAUTH_REDIRECT_URI.*APP_ENCRYPTION_KEY_BASE64/,
  );
  assert.throws(
    () => loadServerConfig({
      NODE_ENV: "test",
      BREVO_API_KEY: "secret-value",
      APP_BASE_URL: "https://exepts.example",
    }),
    /BREVO_SENDER_EMAIL.*BREVO_SENDER_NAME.*BREVO_API_BASE_URL/,
  );
  try {
    loadServerConfig({ NODE_ENV: "test", GOOGLE_CLIENT_ID: "secret-value" });
  } catch (error) {
    assert.doesNotMatch(String(error), /secret-value/);
  }
});

test("production startup requires core configuration and validates supplied values", () => {
  assert.throws(() => loadServerConfig({ NODE_ENV: "production" }), /SUPABASE_DB_URL.*GEMINI_API_KEY.*APP_BASE_URL/);
  assert.throws(() => loadServerConfig({ NODE_ENV: "test", PORT: "70000" }), /PORT/);
  assert.throws(() => loadServerConfig({ NODE_ENV: "test", SUPABASE_DB_URL: "https://example.test" }), /postgres/);
  assert.throws(() => loadServerConfig({ NODE_ENV: "test", APP_ENCRYPTION_KEY_BASE64: "bad" }), /32-byte key/);
});

test("unconfigured GovInfo ignores forged browser requests", async () => {
  assert.deepEqual(await queryLegalSources("confidential query", false, true), {
    govInfo: [],
    govInfoStatus: "empty",
  });
});

test("core routes are unconditional and removed product surfaces are absent", async () => {
  const [serverSource, clientRoutes, app, configSource] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/clientRoutes.ts", "utf8"),
    readFile("src/App.tsx", "utf8"),
    readFile("server/config.ts", "utf8"),
  ]);
  const server = `${serverSource}\n${clientRoutes}`;
  for (const route of [
    "/api/team/members",
    "/api/team/invitations",
    "/api/client/dashboard",
    "/api/notifications",
    "/api/cases/:id/archive",
  ]) {
    assert.match(server, new RegExp(route.replace(/[/:]/g, (value) => value === "/" ? "\\/" : value)));
  }
  assert.match(app, /<PublicLandingPage \/>/);
  assert.doesNotMatch(server, /Google Drive import|\/api\/ingestion|\/api\/uploads\/authorize/);
  assert.doesNotMatch(app, /ClientUnavailable|featureFlags/);
  assert.doesNotMatch(configSource, new RegExp(`FEATURE${"_"}`));
  assert.doesNotMatch(configSource, /parseBoolean|features:/);
});
