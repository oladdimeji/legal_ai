import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAccessReviewToken,
  hashSessionToken,
  parseAccessReviewToken,
} from "../server/auth.js";
import { migrationManifest } from "../server/migrations.js";
import { parseRoute, safeReturnTo } from "../src/lib/routes.js";

test("controlled access migration is additive, ordered after the existing version 25, and preserves claims", async () => {
  assert.ok(
    migrationManifest.some(
      (migration) => migration.version === 26 && migration.name === "controlled_testing_access_gate"
    )
  );
  const source = await readFile("server/migrations.ts", "utf8");
  const start = source.indexOf('name: "controlled_testing_access_gate"');
  const phase = source.slice(start, source.indexOf("\n  },\n];", start));
  assert.match(phase, /platform_access_status TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(phase, /access_submitted_at TEXT/);
  assert.match(phase, /access_reviewed_at TEXT/);
  assert.match(phase, /CHECK \(platform_access_status IN \('pending', 'approved', 'denied'\)\)/);
  assert.match(phase, /CREATE TABLE IF NOT EXISTS access_review_requests/);
  assert.match(phase, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(phase, /REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(phase, /SET platform_access_status = 'pending'[\s\S]*account_type = 'lawyer'/);
  assert.match(phase, /claimed_by_user_id = u\.id[\s\S]*invitation_status = 'Active'/);
  assert.doesNotMatch(phase, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
  assert.doesNotMatch(phase, /claimed_by_user_id\s*=\s*NULL|token_hash\s*=\s*NULL/);
});

test("review tokens use 32 random bytes, base64url validation, and SHA-256 storage hashes", async () => {
  const first = createAccessReviewToken();
  const second = createAccessReviewToken();
  assert.equal(first.token.length, 43);
  assert.notEqual(first.token, second.token);
  assert.equal(parseAccessReviewToken(first.token), first.token);
  assert.equal(parseAccessReviewToken(`${first.token}!`), null);
  assert.equal(first.tokenHash, hashSessionToken(first.token));
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
  const auth = await readFile("server/auth.ts", "utf8");
  assert.match(auth, /createAccessReviewToken[\s\S]*randomBytes\(32\)\.toString\("base64url"\)/);
});

test("review GET is read-only and only decision POST invokes the transactional mutation", async () => {
  const server = await readFile("server.ts", "utf8");
  const getStart = server.indexOf('app.get("/api/access-reviews/:token"');
  const postStart = server.indexOf('app.post("/api/access-reviews/:token/decision"');
  const getRoute = server.slice(getStart, postStart);
  const postRoute = server.slice(postStart, server.indexOf('app.get("/api/auth/me"', postStart));
  assert.ok(getStart > 0 && postStart > getStart);
  assert.match(getRoute, /getAccessReview/);
  assert.doesNotMatch(getRoute, /decideAccessReview|platform_access_status|decision\s*=/);
  assert.match(postRoute, /decideAccessReview/);
  assert.match(getRoute, /Cache-Control", "no-store/);
  assert.match(postRoute, /Cache-Control", "no-store/);
});

test("review issuance and decisions are locked, expiring, rate-limited, and idempotent", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const issue = database.slice(
    database.indexOf("public async issueAccessReviewRequest"),
    database.indexOf("public async markAccessReviewNotification")
  );
  const decide = database.slice(
    database.indexOf("public async decideAccessReview"),
    database.indexOf("public async getFirmAdminSettings")
  );
  assert.match(issue, /FOR UPDATE OF u/);
  assert.match(issue, /ACCESS_REVIEW_RESEND_COOLDOWN_MS/);
  assert.match(issue, /ACCESS_REVIEW_DAILY_LIMIT/);
  assert.match(issue, /SET invalidated_at = \$2/);
  assert.match(issue, /tokenHash/);
  assert.doesNotMatch(issue, /rawToken/);
  assert.match(decide, /access_review_requests WHERE token_hash = \$1 FOR UPDATE/);
  assert.match(decide, /FROM users WHERE id = \$1 FOR UPDATE/);
  assert.match(decide, /request\.invalidated_at \|\| request\.expires_at <= now/);
  assert.match(decide, /request\.consumed_at && request\.decision/);
  assert.match(decide, /SET consumed_at = \$2, decision = \$3/);
  assert.match(decide, /await client\.query\("COMMIT"\)[\s\S]*changed: true/);
});

test("pending lawyers keep auth and onboarding routes but are blocked at the central product gate", async () => {
  const [server, accessGate] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/AccessGateView.tsx", "utf8"),
  ]);
  const me = server.indexOf('app.get("/api/auth/me"');
  const onboarding = server.indexOf('"/api/onboarding/complete"');
  const resend = server.indexOf('"/api/access/request-review"');
  const product = server.indexOf("requireApprovedPlatformAccess\n  );");
  assert.ok(me > 0 && onboarding > me && resend > onboarding && product > resend);
  assert.match(server, /code: "ACCESS_REVIEW_PENDING"/);
  assert.match(server, /code: "ACCESS_REVIEW_DENIED"/);
  assert.match(accessGate, /Exepts access/);
  assert.match(accessGate, /Your access request is under review/);
  assert.match(server, /function ownership[\s\S]*platform_access_status !== "approved"/);
  assert.match(server, /const requireFirmAdmin[\s\S]*platform_access_status !== "approved"/);
  const sessions = await readFile("server/db.ts", "utf8");
  assert.match(sessions, /getSessionAccount[\s\S]*FROM users u[\s\S]*platform_access_status/);
});

test("onboarding and decisions commit independently of Brevo delivery", async () => {
  const server = await readFile("server.ts", "utf8");
  const onboarding = server.slice(
    server.indexOf('"/api/onboarding/complete"'),
    server.indexOf('"/api/access/request-review"')
  );
  assert.match(onboarding, /await db\.completeOnboarding/);
  assert.match(onboarding, /try \{[\s\S]*issueAndNotifyAccessReview/);
  assert.match(onboarding, /redirectTo: "\/access"/);
  const decision = server.slice(
    server.indexOf('app.post("/api/access-reviews/:token/decision"'),
    server.indexOf('app.get("/api/auth/me"')
  );
  assert.match(decision, /await db\.decideAccessReview/);
  assert.match(decision, /if \(!result\.changed\)/);
  assert.match(decision, /try \{[\s\S]*sendAccessDecisionEmail/);
  assert.doesNotMatch(server, /console\.(?:log|error)\([^\n]*rawToken/);
  assert.match(server, /Your Exepts verification code/);
  assert.match(server, /This code expires in 10 minutes/);
});

test("client access is derived from an active claim and centrally gates product routes", async () => {
  const [database, server, app] = await Promise.all([
    readFile("server/db.ts", "utf8"),
    readFile("server.ts", "utf8"),
    readFile("src/App.tsx", "utf8"),
  ]);
  assert.match(database, /claimed_by_user_id = u\.id[\s\S]*invitation_status = 'Active'[\s\S]*revoked_at IS NULL[\s\S]*token_hash IS NOT NULL[\s\S]*client_access_granted/);
  const claim = database.slice(
    database.indexOf("public async claimClientCollaboration"),
    database.indexOf("public async getClientSharedMatters")
  );
  assert.match(claim, /SET claimed_by_user_id = \$1/);
  assert.match(claim, /platform_access_status = 'approved'/);
  const redeem = server.indexOf('"/api/client/shared-matters/redeem"');
  const listing = server.indexOf('"/api/client/shared-matters"', redeem + 1);
  const gate = server.indexOf("requireClientCollaboration\n  );", listing);
  const details = server.indexOf('"/api/client/shared-matters/:accessId"');
  assert.ok(redeem > 0 && listing > redeem && gate > listing && details > gate);
  assert.match(server, /code: "CLIENT_COLLABORATION_REQUIRED"/);
  assert.match(app, /!account\.user\.client_access_granted[\s\S]*ClientAccessGateView/);
});

test("access routes parse safely and the administrator review route is not a return destination", () => {
  assert.deepEqual(parseRoute("/access"), { kind: "accessGate" });
  assert.deepEqual(parseRoute("/access-review/abc_123-XYZ"), {
    kind: "accessReview",
    token: "abc_123-XYZ",
  });
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://exepts.test" } },
  });
  try {
    assert.equal(safeReturnTo("/access-review/abc_123-XYZ", "/matters"), "/matters");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("access review stays public through the site lock while the applicant gate is protected", async () => {
  const [siteLock, app] = await Promise.all([
    readFile("server/siteLock.ts", "utf8"),
    readFile("src/App.tsx", "utf8"),
  ]);
  assert.match(siteLock, /path === "\/access"/);
  const protectedFunction = siteLock.slice(siteLock.indexOf("isProtectedApplicationPath"));
  assert.doesNotMatch(protectedFunction, /access-review/);
  const reviewRender = app.indexOf('route.kind === "accessReview"');
  const siteLockRender = app.indexOf("!account && siteStatus.locked");
  assert.ok(reviewRender > 0 && siteLockRender > reviewRender);
  assert.match(app, /platform_access_status !== "approved"[\s\S]*navigate\("\/access"/);
});
