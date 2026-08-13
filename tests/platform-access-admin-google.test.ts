import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ADMIN_OAUTH_STATE_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_MS,
  adminOAuthStateCookie,
  adminSessionCookie,
  clearAdminSessionCookie,
  createAdminOAuthState,
  createAdminSessionToken,
  validateAdminOAuthState,
  verifyAdminSessionToken,
} from "../server/adminAuth.js";
import { SESSION_COOKIE_NAME } from "../server/auth.js";
import { parseRoute } from "../src/lib/routes.js";

const sessionSecret = "test-only-admin-session-secret-with-32-characters";

test("admin OAuth state is random, exact-match validated, and isolated from lawyer OAuth state", () => {
  const first = createAdminOAuthState();
  const second = createAdminOAuthState();
  assert.notEqual(first, second);
  assert.equal(validateAdminOAuthState(first, first), true);
  assert.equal(validateAdminOAuthState(first, second), false);
  assert.equal(validateAdminOAuthState("invalid", first), false);
  const cookie = adminOAuthStateCookie(first, true);
  assert.match(cookie, new RegExp(`^${ADMIN_OAUTH_STATE_COOKIE_NAME}=`));
  assert.match(cookie, /Path=\/api\/admin\/auth\/google\/callback/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
});

test("signed admin sessions normalize identity and reject tampering or expiry", () => {
  const issuedAt = Date.UTC(2026, 7, 13, 12, 0, 0);
  const token = createAdminSessionToken(" Admin@Example.COM ", sessionSecret, issuedAt);
  assert.deepEqual(verifyAdminSessionToken(token, sessionSecret, issuedAt), {
    email: "admin@example.com",
  });
  assert.equal(verifyAdminSessionToken(`${token}x`, sessionSecret, issuedAt), null);
  assert.equal(verifyAdminSessionToken(token, `${sessionSecret}x`, issuedAt), null);
  assert.equal(verifyAdminSessionToken(token, sessionSecret, issuedAt + ADMIN_SESSION_TTL_MS), null);
});

test("technical-admin cookie is HttpOnly and separate from the ordinary user session", () => {
  assert.notEqual(ADMIN_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME);
  const cookie = adminSessionCookie("signed-value", true);
  assert.match(cookie, new RegExp(`^${ADMIN_SESSION_COOKIE_NAME}=`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(clearAdminSessionCookie(true), /Max-Age=0/);
});

test("standalone /admin routing does not enter the lawyer workspace gate", async () => {
  assert.deepEqual(parseRoute("/admin"), { kind: "admin" });
  const [app, adminView, settings, shell] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/components/AdminView.tsx", "utf8"),
    readFile("src/components/SettingsView.tsx", "utf8"),
    readFile("src/components/LawyerWorkspaceShell.tsx", "utf8"),
  ]);
  assert.match(app, /route\.kind === "admin"[\s\S]*return <AdminView/);
  assert.ok(app.indexOf('route.kind === "admin"') < app.indexOf("if (authLoading || !siteStatus)"));
  assert.doesNotMatch(adminView, /LawyerWorkspaceShell|Matter sidebar|Firm Library/);
  assert.doesNotMatch(shell, /\/admin|Exepts Administration/);
  assert.doesNotMatch(settings, /access-admin|Platform access administration|Access Requests/);
  assert.match(settings, /Firm invitation code/);
  assert.match(settings, /Firm administration/);
});

test("admin Google OAuth verifies Google identity and authorizes only the configured email", async () => {
  const server = await readFile("server.ts", "utf8");
  const callback = server.slice(
    server.indexOf('app.get("/api/admin/auth/google/callback"'),
    server.indexOf('app.get("/api/auth/google"')
  );
  assert.match(server, /app\.get\("\/api\/admin\/auth\/google"/);
  assert.match(callback, /validateAdminOAuthState/);
  assert.match(callback, /client\.verifyIdToken\(\{ idToken: tokens\.id_token, audience: clientId \}\)/);
  assert.match(callback, /payload\.email_verified !== true/);
  assert.match(callback, /payload\.aud !== clientId/);
  assert.match(callback, /validIssuer/);
  assert.match(callback, /normalizeEmail\(payload\.email\)/);
  assert.match(callback, /isAccessReviewAdminEmail\(email\)/);
  assert.match(callback, /createAdminSessionToken\(email, adminSessionSecret\)/);
  assert.match(callback, /redirectUrl\(req, "\/admin"\)/);
  assert.doesNotMatch(callback, /db\.|createSessionToken|sessionCookie\(/);

  const authorization = server.slice(
    server.indexOf("function isAccessReviewAdminEmail"),
    server.indexOf("function adminGoogleRedirectUri")
  );
  assert.match(authorization, /accessReviewAdminEmails\(\)\.includes\(normalizeEmail\(rawEmail\)\)/);
  assert.doesNotMatch(authorization, /account_type|onboarding|platform_access_status|firm_role|firm_id/);
});

test("all access-admin APIs require the dedicated admin session, not lawyer or Firm Admin auth", async () => {
  const server = await readFile("server.ts", "utf8");
  const routes = server.slice(
    server.indexOf("const requireTechnicalAdmin"),
    server.indexOf("const requireClientCollaboration")
  );
  assert.match(routes, /parseCookie\(req\.headers\.cookie, ADMIN_SESSION_COOKIE_NAME\)/);
  assert.match(routes, /verifyAdminSessionToken\(token, process\.env\.ADMIN_SESSION_SECRET\)/);
  assert.match(routes, /isAccessReviewAdminEmail\(identity\.email\)/);
  assert.match(routes, /status\(401\)/);
  assert.match(routes, /status\(403\)/);
  assert.doesNotMatch(routes, /\brequireAuth\b|firm_role|req\.auth|\bSESSION_COOKIE_NAME\b/);
  assert.match(routes, /"\/api\/access-admin\/status",[\s\S]*requireTechnicalAdmin/);
  assert.match(routes, /"\/api\/access-admin\/requests",[\s\S]*requireTechnicalAdmin/);
  assert.match(routes, /"\/api\/access-admin\/requests\/:userId\/decision",[\s\S]*requireTechnicalAdmin/);
  assert.match(routes, /"\/api\/access-admin\/logout"[\s\S]*clearAdminSessionCookie/);
  assert.doesNotMatch(routes, /clearSessionCookie|deleteSession/);
});

test("admin dashboard lists submitted lawyer requests across existing statuses", async () => {
  const [database, adminView] = await Promise.all([
    readFile("server/db.ts", "utf8"),
    readFile("src/components/AdminView.tsx", "utf8"),
  ]);
  const listing = database.slice(
    database.indexOf("public async listPlatformAccessRequests"),
    database.indexOf("public async decidePlatformAccessRequest")
  );
  assert.match(listing, /u\.account_type = 'lawyer'/);
  assert.match(listing, /u\.onboarding_completed = TRUE/);
  assert.match(listing, /u\.platform_access_status IN \('pending', 'approved', 'denied'\)/);
  assert.match(listing, /u\.access_submitted_at IS NOT NULL/);
  assert.match(listing, /ORDER BY u\.access_submitted_at DESC/);
  assert.doesNotMatch(listing, /notification_sent_at|notification_failed_at|access_review_requests/);
  assert.match(adminView, /request\.status === "pending"/);
  assert.match(adminView, /Approve/);
  assert.match(adminView, /Deny/);
  assert.match(adminView, /statusLabel\(request\.status\)/);
  assert.match(adminView, /professionalRole\(request\)/);
  assert.match(adminView, /workspaceLabel\(request\)/);
  assert.match(adminView, /practiceAreas\(request\)/);
});

test("platform decisions retain atomic pending-only semantics and best-effort email", async () => {
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

test("ordinary lawyer Google login remains login-only and separate from admin auth", async () => {
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
  assert.match(authentication, /GOOGLE_LAWYER_ACCESS_PENDING/);
  assert.match(authentication, /GOOGLE_LAWYER_ACCESS_DENIED/);
  assert.doesNotMatch(authentication, /INSERT INTO users|INSERT INTO firm/);

  const callback = server.slice(
    server.indexOf('app.get("/api/auth/google/callback"'),
    server.indexOf('app.post("/api/access/request"')
  );
  assert.match(callback, /db\.authenticateApprovedLawyerGoogle/);
  assert.match(callback, /await db\.createSession/);
  assert.match(callback, /sessionCookie\(token, isProduction\)/);
  assert.doesNotMatch(callback, /createAdminSessionToken|adminSessionCookie/);
  assert.match(authView, /Continue with Google/);
  assert.match(authView, /Continue with Email/);
});
