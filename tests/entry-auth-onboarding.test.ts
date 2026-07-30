import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseRoute } from "../src/lib/routes.js";

test("route parser covers public, onboarding, product, Matter, and Client Workspace routes", () => {
  assert.deepEqual(parseRoute("/"), { kind: "landing" });
  assert.deepEqual(parseRoute("/auth"), { kind: "auth" });
  assert.deepEqual(parseRoute("/login"), { kind: "auth" });
  assert.deepEqual(parseRoute("/onboarding"), { kind: "onboarding" });
  assert.deepEqual(parseRoute("/assistant"), { kind: "assistant" });
  assert.deepEqual(parseRoute("/matters"), { kind: "matters" });
  assert.deepEqual(parseRoute("/matters/matter_123"), { kind: "matter", matterId: "matter_123" });
  assert.deepEqual(parseRoute("/library"), { kind: "library" });
  assert.deepEqual(parseRoute("/history"), { kind: "history" });
  assert.deepEqual(parseRoute("/settings"), { kind: "settings" });
  assert.deepEqual(parseRoute("/client/assistant"), { kind: "clientAssistant" });
  assert.deepEqual(parseRoute("/client/shared-matters"), { kind: "clientSharedMatters" });
  assert.deepEqual(parseRoute("/client/portal-token"), { kind: "unknown" });
  assert.deepEqual(parseRoute("/not-a-route"), { kind: "unknown" });
});

test("password entry is removed and both legacy password endpoints are disabled", async () => {
  const [authView, server] = await Promise.all([
    readFile("src/components/AuthView.tsx", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  assert.doesNotMatch(authView, /type="password"|current-password|new-password/);
  assert.match(authView, /Continue with Google/);
  assert.match(authView, /Continue with Email/);
  assert.match(authView, /Verify and Continue/);
  assert.match(server, /app\.post\(\["\/api\/auth\/signup", "\/api\/auth\/login"\]/);
  assert.match(server, /Password authentication is no longer available/);
});

test("migration is additive, migrates existing firm users, and creates OTP enforcement storage", async () => {
  const migration = await readFile("server/migrations.ts", "utf8");
  const phase = migration.slice(migration.indexOf('name: "passwordless_authentication_and_onboarding"'));
  assert.match(
    migration,
    /version: 20,\s*name: "passwordless_authentication_and_onboarding"/
  );
  assert.match(phase, /ALTER TABLE users ALTER COLUMN name DROP NOT NULL/);
  assert.match(phase, /google_sub TEXT/);
  assert.match(phase, /email_verified_at TEXT/);
  assert.match(phase, /onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(phase, /UPDATE users[\s\S]*firm_id IS NOT NULL[\s\S]*onboarding_completed = FALSE/);
  assert.match(phase, /invitation_code TEXT/);
  assert.match(phase, /CREATE TABLE IF NOT EXISTS email_otp_challenges/);
  assert.match(phase, /otp_hash TEXT NOT NULL/);
  assert.doesNotMatch(phase, /DROP TABLE|DROP COLUMN/);
});

test("OTP database flow enforces expiry, attempt limit, single use, cooldown, and request window", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const issue = database.slice(
    database.indexOf("public async issueEmailOtp"),
    database.indexOf("public async consumeEmailOtp")
  );
  const consume = database.slice(
    database.indexOf("public async consumeEmailOtp"),
    database.indexOf("public async authenticateEmail")
  );
  assert.match(issue, /OTP_RESEND_COOLDOWN_MS/);
  assert.match(issue, /OTP_MAX_REQUESTS_PER_WINDOW/);
  assert.match(issue, /SET consumed_at/);
  assert.match(consume, /OTP_MAX_ATTEMPTS/);
  assert.match(consume, /challenge\.expires_at <= now/);
  assert.match(consume, /verifyOtpHash/);
  assert.match(consume, /SET consumed_at = \$2/);
});

test("account linking, incomplete accounts, idempotent personal workspace, and firm-code join are explicit", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const google = database.slice(
    database.indexOf("public async authenticateGoogle"),
    database.indexOf("public async completeOnboarding")
  );
  const onboarding = database.slice(database.indexOf("public async completeOnboarding"));
  assert.match(google, /WHERE google_sub = \$1/);
  assert.match(google, /GOOGLE_ACCOUNT_CONFLICT/);
  assert.match(google, /google_sub = COALESCE\(google_sub/);
  assert.match(google, /onboarding_completed,[\s\S]*FALSE/);
  assert.match(onboarding, /SELECT id, firm_id, onboarding_completed[\s\S]*FOR UPDATE/);
  assert.match(onboarding, /if \(!user\.onboarding_completed\)/);
  assert.match(onboarding, /else if \(!firmId\)/);
  assert.match(onboarding, /'Personal Workspace'/);
  assert.match(onboarding, /UPPER\(BTRIM\(invitation_code\)\) = \$1/);
  assert.match(onboarding, /INVALID_INVITATION_CODE/);
});

test("incomplete sessions can call auth/me but product APIs require completed onboarding", async () => {
  const server = await readFile("server.ts", "utf8");
  const meIndex = server.indexOf('app.get("/api/auth/me"');
  const onboardingIndex = server.indexOf('app.post("/api/onboarding/complete"');
  const portalIndex = server.indexOf('app.get("/api/portal/:token"');
  const productGuardIndex = server.indexOf('app.use("/api", requireAuth, requireCompletedOnboarding)');
  assert.ok(meIndex > 0 && onboardingIndex > meIndex);
  assert.ok(portalIndex > onboardingIndex && productGuardIndex > portalIndex);
  assert.match(server, /Complete onboarding before using the workspace/);
  assert.match(server, /Completed workspace authentication is required/);
});
