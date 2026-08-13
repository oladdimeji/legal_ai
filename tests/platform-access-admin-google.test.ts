import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("platform access administration is independently authorized and never trusts Firm Admin", async () => {
  const server = await readFile("server.ts", "utf8");
  const authorization = server.slice(
    server.indexOf("function isAccessReviewAdminAccount"),
    server.indexOf("function accessReviewUrl")
  );
  const routes = server.slice(
    server.indexOf('"/api/access-admin/status"'),
    server.indexOf("const requireClientCollaboration")
  );
  assert.match(authorization, /account_type !== "lawyer"/);
  assert.match(authorization, /!account\.user\.onboarding_completed/);
  assert.match(authorization, /platform_access_status !== "approved"/);
  assert.match(authorization, /accessReviewAdminEmails\(\)\.includes\(normalizeEmail\(account\.user\.email\)\)/);
  assert.doesNotMatch(authorization, /firm_role/);
  assert.match(routes, /requireAuth,[\s\S]*requireAccessReviewAdmin/);
  assert.match(routes, /status[\s\S]*isAccessReviewAdmin/);
  assert.match(server, /const requireAccessReviewAdmin[\s\S]*status\(403\)/);
});

test("pending request discovery uses persisted user access state, not Brevo delivery", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const listing = database.slice(
    database.indexOf("public async listPendingPlatformAccessRequests"),
    database.indexOf("public async decidePlatformAccessRequest")
  );
  assert.match(listing, /u\.account_type = 'lawyer'/);
  assert.match(listing, /u\.onboarding_completed = TRUE/);
  assert.match(listing, /u\.platform_access_status = 'pending'/);
  assert.match(listing, /u\.access_submitted_at IS NOT NULL/);
  assert.match(listing, /ORDER BY u\.access_submitted_at DESC/);
  assert.doesNotMatch(listing, /notification_sent_at|notification_failed_at|access_review_requests/);
});

test("platform decisions lock pending lawyers and atomically invalidate email review links", async () => {
  const [database, server] = await Promise.all([
    readFile("server/db.ts", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  const decision = database.slice(
    database.indexOf("public async decidePlatformAccessRequest"),
    database.indexOf("public async getFirmAdminSettings")
  );
  assert.match(decision, /FROM users WHERE id = \$1 FOR UPDATE/);
  assert.match(decision, /account_type !== "lawyer"/);
  assert.match(decision, /!user\.onboarding_completed/);
  assert.match(decision, /platform_access_status !== "pending"/);
  assert.match(decision, /platform_access_status = \$2, access_reviewed_at = \$3/);
  assert.match(decision, /UPDATE access_review_requests SET invalidated_at = \$2/);
  assert.match(decision, /consumed_at IS NULL AND invalidated_at IS NULL/);
  assert.match(decision, /await client\.query\("COMMIT"\)[\s\S]*changed: true/);

  const route = server.slice(
    server.indexOf('"/api/access-admin/requests/:userId/decision"'),
    server.indexOf("const requireClientCollaboration")
  );
  assert.match(route, /status\(409\)/);
  assert.match(route, /await db\.decidePlatformAccessRequest/);
  assert.match(route, /try \{[\s\S]*sendAccessDecisionEmail/);
  assert.match(route, /Access decision applicant email delivery failed/);
  assert.match(route, /return res\.json\(\{ success: true/);
});

test("approved-lawyer Google authentication is login-only and conflict-safe", async () => {
  const [database, server, authView] = await Promise.all([
    readFile("server/db.ts", "utf8"),
    readFile("server.ts", "utf8"),
    readFile("src/components/AuthView.tsx", "utf8"),
  ]);
  const authentication = database.slice(
    database.indexOf("public async authenticateApprovedLawyerGoogle"),
    database.indexOf("public async submitPublicAccessRequest")
  );
  assert.match(authentication, /WHERE google_sub = \$1 FOR UPDATE/);
  assert.match(authentication, /LOWER\(BTRIM\(email\)\) = \$1 FOR UPDATE/);
  assert.match(authentication, /GOOGLE_ACCOUNT_CONFLICT/);
  assert.match(authentication, /account_type !== "lawyer"/);
  assert.match(authentication, /GOOGLE_LAWYER_ONBOARDING_INCOMPLETE/);
  assert.match(authentication, /GOOGLE_LAWYER_ACCESS_PENDING/);
  assert.match(authentication, /GOOGLE_LAWYER_ACCESS_DENIED/);
  assert.match(authentication, /platform_access_status !== "approved"/);
  assert.match(authentication, /google_sub = COALESCE\(google_sub, \$2\)/);
  assert.match(authentication, /email_verified_at = COALESCE\(email_verified_at, \$3\)/);
  assert.doesNotMatch(authentication, /INSERT INTO users|INSERT INTO firm|name =/);

  const callback = server.slice(
    server.indexOf('app.get("/api/auth/google/callback"'),
    server.indexOf('app.post("/api/access/request"')
  );
  assert.match(callback, /payload\.email_verified !== true/);
  assert.match(callback, /payload\.aud !== clientId/);
  assert.match(callback, /validIssuer/);
  assert.match(callback, /db\.authenticateApprovedLawyerGoogle/);
  assert.match(callback, /await db\.createSession/);
  assert.doesNotMatch(callback, /db\.authenticateGoogle\(/);
  assert.match(callback, /requestedAccountType === "client"/);
  assert.match(authView, /isLawyerMode[\s\S]*Continue with Google/);
  assert.match(authView, /Continue with Email/);
});
