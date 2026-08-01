import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { countdownValue } from "../src/components/SiteLockScreen.js";
import {
  SITE_LOCK_DENIED_MESSAGE,
  canAccessPrivateApplication,
  isEmailAllowlisted,
  isProtectedApplicationPath,
  isSiteLocked,
  publicSiteLockStatus,
  readSiteLockPolicy,
} from "../server/siteLock.js";

test("site lock defaults to disabled and preserves normal access", () => {
  const policy = readSiteLockPolicy({});
  assert.equal(isSiteLocked(policy), false);
  assert.equal(canAccessPrivateApplication(undefined, policy), true);
  assert.equal(canAccessPrivateApplication("anyone@example.com", policy), true);
});

test("enabled site lock permits only allowlisted email addresses", () => {
  const policy = readSiteLockPolicy({
    SITE_LOCKED: "true",
    SITE_ALLOWED_EMAILS: "approved@example.com",
  });
  assert.equal(isEmailAllowlisted("approved@example.com", policy), true);
  assert.equal(canAccessPrivateApplication("approved@example.com", policy), true);
  assert.equal(canAccessPrivateApplication("outside@example.com", policy), false);
});

test("allowlist matching trims whitespace and ignores email case", () => {
  const policy = readSiteLockPolicy({
    SITE_LOCKED: " TRUE ",
    SITE_ALLOWED_EMAILS: "  Counsel@Example.COM , teammate@example.com  ",
  });
  assert.equal(canAccessPrivateApplication(" counsel@example.com ", policy), true);
  assert.equal(canAccessPrivateApplication("TEAMMATE@EXAMPLE.COM", policy), true);
});

test("empty or malformed locked allowlists fail closed", () => {
  const empty = readSiteLockPolicy({ SITE_LOCKED: "true", SITE_ALLOWED_EMAILS: "  " });
  const malformed = readSiteLockPolicy({
    SITE_LOCKED: "true",
    SITE_ALLOWED_EMAILS: "approved@example.com,not-an-email",
  });
  assert.equal(canAccessPrivateApplication("approved@example.com", empty), false);
  assert.equal(canAccessPrivateApplication("approved@example.com", malformed), false);
});

test("public status is sanitized and never contains the allowlist", () => {
  const policy = readSiteLockPolicy({
    SITE_LOCKED: "true",
    SITE_REOPENS_AT: "2026-08-15T09:00:00Z",
    SITE_ALLOWED_EMAILS: "private@example.com",
  });
  const status = publicSiteLockStatus(policy);
  assert.deepEqual(status, { locked: true, reopensAt: "2026-08-15T09:00:00.000Z" });
  assert.doesNotMatch(JSON.stringify(status), /private@example\.com|allowedEmails/i);
});

test("invalid or absent countdown configuration is safely omitted", () => {
  assert.equal(
    readSiteLockPolicy({ SITE_LOCKED: "true", SITE_REOPENS_AT: "not-a-date" }).reopensAt,
    null
  );
  assert.equal(
    readSiteLockPolicy({ SITE_LOCKED: "true", SITE_REOPENS_AT: "2026-02-30T09:00:00Z" })
      .reopensAt,
    null
  );
  assert.equal(readSiteLockPolicy({ SITE_LOCKED: "true" }).reopensAt, null);
});

test("countdown values render all four units and remain at zero after expiry", () => {
  const now = Date.parse("2026-08-14T07:58:59Z");
  const target = Date.parse("2026-08-15T09:00:00Z");
  assert.deepEqual(countdownValue(target, now), {
    days: 1,
    hours: 1,
    minutes: 1,
    seconds: 1,
  });
  assert.deepEqual(countdownValue(target, target + 1_000), {
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
});

test("an existing non-allowlisted session is denied while an approved session continues", () => {
  const policy = readSiteLockPolicy({
    SITE_LOCKED: "true",
    SITE_ALLOWED_EMAILS: "approved@example.com",
  });
  const blockedSession = { user: { email: "existing@example.com" } };
  const approvedSession = { user: { email: "APPROVED@EXAMPLE.COM" } };
  assert.equal(canAccessPrivateApplication(blockedSession.user.email, policy), false);
  assert.equal(canAccessPrivateApplication(approvedSession.user.email, policy), true);
});

test("known protected browser routes are identified without locking public entry routes", () => {
  for (const path of [
    "/onboarding",
    "/assistant",
    "/matters/matter_1",
    "/library",
    "/history",
    "/settings",
    "/client/shared-matters",
  ]) {
    assert.equal(isProtectedApplicationPath(path), true, path);
  }
  for (const path of ["/", "/auth", "/api/site-status", "/assets/app.js"]) {
    assert.equal(isProtectedApplicationPath(path), false, path);
  }
});

test("server authentication and session restoration use the centralized policy", async () => {
  const server = await readFile("server.ts", "utf8");
  const googleCallback = server.slice(
    server.indexOf('app.get("/api/auth/google/callback"'),
    server.indexOf('app.post("/api/auth/email/request-code"')
  );
  const requestCode = server.slice(
    server.indexOf('app.post("/api/auth/email/request-code"'),
    server.indexOf('app.post("/api/auth/email/verify-code"')
  );
  const verifyCode = server.slice(
    server.indexOf('app.post("/api/auth/email/verify-code"'),
    server.indexOf('app.post("/api/auth/logout"')
  );
  const sessionGuard = server.slice(
    server.indexOf("const requireAuth"),
    server.indexOf("const requireLawyerAccount")
  );

  assert.ok(
    googleCallback.indexOf("canAccessPrivateApplication") <
      googleCallback.indexOf("db.authenticateGoogle")
  );
  assert.ok(
    requestCode.indexOf("canAccessPrivateApplication") < requestCode.indexOf("db.issueEmailOtp")
  );
  assert.ok(
    verifyCode.indexOf("canAccessPrivateApplication") < verifyCode.indexOf("db.consumeEmailOtp")
  );
  assert.match(sessionGuard, /canAccessPrivateApplication\(account\.user\.email/);
  assert.match(server, /app\.get\("\/api\/site-status"/);
  assert.match(server, /isProtectedApplicationPath\(req\.path\)/);
  assert.equal(SITE_LOCK_DENIED_MESSAGE, "This application is currently available to approved accounts only.");
});

test("frontend waits for public lock status and provides private access without allowlist data", async () => {
  const [app, screen] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/components/SiteLockScreen.tsx", "utf8"),
  ]);
  assert.ok(app.indexOf('fetch("/api/site-status")') < app.indexOf('fetch("/api/auth/me")'));
  assert.match(app, /siteStatus\.locked/);
  assert.match(screen, /Days/);
  assert.match(screen, /Hours/);
  assert.match(screen, /Minutes/);
  assert.match(screen, /Seconds/);
  assert.match(screen, /href="\/auth"/);
  assert.doesNotMatch(`${app}\n${screen}`, /SITE_ALLOWED_EMAILS|allowedEmails/);
});
