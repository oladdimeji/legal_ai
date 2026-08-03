import assert from "node:assert/strict";
import test from "node:test";
import {
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  createOAuthState,
  createOtpHash,
  createSessionToken,
  generateOtp,
  normalizeEmail,
  parseCookie,
  safeInternalPath,
  sessionCookie,
  validateOAuthState,
  verifyOtpHash,
} from "../server/auth.js";

test("session tokens expose only a distinct hash for storage", () => {
  const { token, tokenHash } = createSessionToken();
  assert.ok(token.length >= 40);
  assert.match(tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(token, tokenHash);
});

test("session cookie remains HTTP-only, lax, and secure only in production", () => {
  const development = sessionCookie("secret", false);
  assert.match(development, /HttpOnly/);
  assert.match(development, /SameSite=Lax/);
  assert.doesNotMatch(development, /; Secure/);
  assert.match(sessionCookie("secret", true), /; Secure/);
  assert.match(clearSessionCookie(true), /Max-Age=0/);
  assert.equal(parseCookie(`other=x; ${SESSION_COOKIE_NAME}=secret`, SESSION_COOKIE_NAME), "secret");
});

test("email normalization is consistent", () => {
  assert.equal(normalizeEmail("  Counsel@Example.COM "), "counsel@example.com");
});

test("OTP values are six digits, salted, and only verify against the matching hash", () => {
  const code = generateOtp();
  assert.match(code, /^\d{6}$/);
  const first = createOtpHash(code);
  const second = createOtpHash(code);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(verifyOtpHash(code, first.salt, first.hash), true);
  assert.equal(verifyOtpHash("000000" === code ? "000001" : "000000", first.salt, first.hash), false);
});

test("safe internal returns reject external and entry-flow redirects", () => {
  assert.equal(safeInternalPath("/matters/matter_1?tab=work"), "/matters/matter_1?tab=work");
  assert.equal(safeInternalPath("https://attacker.example"), "/matters");
  assert.equal(safeInternalPath("//attacker.example/path"), "/matters");
  assert.equal(safeInternalPath("/\\attacker.example"), "/matters");
  assert.equal(safeInternalPath("/onboarding"), "/matters");
  assert.equal(safeInternalPath("/auth?returnTo=/settings"), "/matters");
});

test("OAuth state is random, bound to its HTTP-only cookie payload, and single-context validated", () => {
  const first = createOAuthState("/settings");
  const second = createOAuthState("/settings");
  assert.notEqual(first.state, second.state);
  assert.deepEqual(validateOAuthState(first.state, first.cookieValue), {
    valid: true,
    returnTo: "/settings",
  });
  assert.equal(validateOAuthState(second.state, first.cookieValue).valid, false);
  assert.equal(validateOAuthState(first.state, null).valid, false);
  assert.equal(OAUTH_STATE_COOKIE_NAME, "exepts_oauth_state");
});
