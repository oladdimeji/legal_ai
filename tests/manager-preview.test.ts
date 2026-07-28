import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Request, Response } from "express";
import { loadServerConfig } from "../server/config.js";
import {
  ProgressiveRateLimiter,
  clientSessionCookie,
  createOriginGuard,
  csrfCookie,
  requireClientCsrf,
  safeClientError,
} from "../server/clientSecurity.js";
import {
  BrevoTransactionalEmail,
  renderTransactionalTemplate,
  type EmailDeliveryRecord,
} from "../server/transactionalEmail.js";
import { classifyProtectedRequest, decideAuthorization } from "../server/authorization.js";

test("manager preview flags are independent, safe by default, and deferred uploads fail closed", () => {
  const defaults = loadServerConfig({ NODE_ENV: "test" });
  assert.equal(defaults.features.clientAccounts, false);
  assert.equal(defaults.features.clientDashboard, false);
  assert.equal(defaults.features.clientNotifications, false);
  assert.equal(defaults.features.clientDurableUploads, false);
  assert.equal(defaults.features.transactionalEmail, false);
  assert.throws(
    () => loadServerConfig({
      NODE_ENV: "test",
      APP_BASE_URL: "https://preview.example.test",
      FEATURE_CLIENT_DURABLE_UPLOADS: "true",
    }),
    /deferred/,
  );
  assert.throws(
    () => loadServerConfig({
      NODE_ENV: "test",
      APP_BASE_URL: "https://preview.example.test",
      FEATURE_CLIENT_DASHBOARD: "true",
    }),
    /FEATURE_CLIENT_ACCOUNTS/,
  );
});

test("client session and CSRF cookies have release-safe attributes", () => {
  assert.match(clientSessionCookie("raw-session", true), /HttpOnly/);
  assert.match(clientSessionCookie("raw-session", true), /SameSite=Lax/);
  assert.match(clientSessionCookie("raw-session", true), /Secure/);
  assert.match(clientSessionCookie("raw-session", true), /Path=\//);
  assert.match(csrfCookie("csrf-token", true), /HttpOnly/);
  assert.match(csrfCookie("csrf-token", true), /SameSite=Strict/);
  assert.match(csrfCookie("csrf-token", true), /Path=\/api/);
});

test("Origin and CSRF validation deny forged sensitive writes behaviorally", () => {
  const originGuard = createOriginGuard("https://preview.example.test");
  const response = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { return value; },
  } as unknown as Response;
  let nextCalls = 0;
  const next = () => { nextCalls += 1; };

  originGuard({
    method: "POST",
    headers: { origin: "https://attacker.example.test" },
  } as Request, response, next);
  assert.equal((response as any).statusCode, 403);
  assert.equal(nextCalls, 0);

  (response as any).statusCode = 200;
  requireClientCsrf({
    headers: {
      cookie: "exepts_client_csrf=trusted-token",
      "x-csrf-token": "forged-token",
    },
  } as unknown as Request, response, next);
  assert.equal((response as any).statusCode, 403);

  (response as any).statusCode = 200;
  requireClientCsrf({
    headers: {
      cookie: "exepts_client_csrf=trusted-token",
      "x-csrf-token": "trusted-token",
    },
  } as unknown as Request, response, next);
  assert.equal(nextCalls, 1);
});

test("progressive client throttling delays failures and rate-limits the configured boundary", async () => {
  const limiter = new ProgressiveRateLimiter(2, 2_000, 1, 2);
  assert.equal((await limiter.before("client")).allowed, true);
  limiter.fail("client");
  assert.equal((await limiter.before("client")).allowed, true);
  limiter.fail("client");
  const blocked = await limiter.before("client");
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  limiter.succeed("client");
  assert.equal((await limiter.before("client")).allowed, true);
});

test("Brevo delivery uses escaped templates and records provider metadata without message bodies", async () => {
  const records: EmailDeliveryRecord[] = [];
  let requestBody = "";
  const sender = new BrevoTransactionalEmail({
    apiKey: "test-api-key",
    senderEmail: "preview@example.test",
    senderName: "Exepts Preview",
    apiBaseUrl: "https://brevo.mock/v3",
    fetchImpl: async (_url, init) => {
      requestBody = String(init?.body || "");
      return new Response(JSON.stringify({ messageId: "brevo-message-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  }, {
    async recordEmailDelivery(record) { records.push(record); },
  });
  const result = await sender.send({
    firmId: "firm_preview",
    clientUserId: "client_preview",
    toEmail: "client@example.test",
    toName: "<Client>",
    templateKey: "client_invitation",
    values: {
      recipientName: "<Client>",
      matterName: "<Confidential>",
      lawyerName: "Preview Lawyer",
      actionUrl: "https://preview.example.test/client/invitations/one-time",
    },
  });
  assert.equal(result.status, "sent");
  assert.equal(result.providerMessageId, "brevo-message-1");
  assert.match(requestBody, /&lt;Client&gt;/);
  assert.doesNotMatch(requestBody, /gmail/i);
  assert.equal(records.length, 1);
  assert.equal(records[0].provider, "brevo");
  assert.equal(records[0].attemptCount, 1);
  assert.equal(records[0].providerMessageId, "brevo-message-1");
  assert.equal("body" in records[0], false);
  assert.notEqual(records[0].recipientEmailHash, "client@example.test");

  const reset = renderTransactionalTemplate("password_reset", {
    recipientName: "Client",
    actionUrl: "https://preview.example.test/client/reset-password/one-time",
  });
  assert.match(reset.textContent, /Reset password/);
});

test("migration 019 is additive and stores only token hashes", async () => {
  const source = await readFile("server/migrations.ts", "utf8");
  const migration = source.slice(source.indexOf("version: 19"), source.indexOf("export async function runMigrations"));
  for (const table of [
    "client_users",
    "matter_client_memberships",
    "client_invitations",
    "client_sessions",
    "client_email_verification_tokens",
    "client_password_reset_tokens",
    "client_notifications",
    "notification_preferences",
    "email_delivery_attempts",
    "client_activity_records",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|RENAME)\b/i);
  assert.doesNotMatch(migration, /\btoken\s+TEXT\b/i);
  assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS/);
});

test("client-access authorization requires an assigned Matter for non-admin lawyers", () => {
  const route = classifyProtectedRequest({
    method: "POST",
    path: "/cases/matter_foreign/client-accounts/invitations",
    body: {},
    query: {},
  } as unknown as Request);
  assert.deepEqual(route, {
    action: "matter.client_access.manage",
    matterId: "matter_foreign",
  });
  assert.equal(decideAuthorization({
    principal: {
      userId: "lawyer_preview",
      firmId: "firm_preview",
      role: "lawyer",
      status: "active",
    },
    action: route!.action,
    matterId: route!.matterId || null,
    assigned: false,
  }), false);
});

test("safe client errors log only a bounded code", () => {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { calls.push(args); };
  try {
    safeClientError("invitation_accept_failed");
  } finally {
    console.error = original;
  }
  assert.deepEqual(calls, [[
    "Client account request failed",
    { code: "invitation_accept_failed" },
  ]]);
});
