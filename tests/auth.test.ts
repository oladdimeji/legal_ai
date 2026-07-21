import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  parseCookie,
  sessionCookie,
  verifyPassword,
} from "../server/auth.js";

test("password hashes are salted and verify in constant-format flow", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("correct horse battery staple", first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
});

test("session tokens expose only a distinct hash for storage", () => {
  const { token, tokenHash } = createSessionToken();
  assert.ok(token.length >= 40);
  assert.match(tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(token, tokenHash);
});

test("session cookie is HTTP-only, lax, and secure only in production", () => {
  const development = sessionCookie("secret", false);
  assert.match(development, /HttpOnly/);
  assert.match(development, /SameSite=Lax/);
  assert.doesNotMatch(development, /; Secure/);
  assert.match(sessionCookie("secret", true), /; Secure/);
  assert.match(clearSessionCookie(true), /Max-Age=0/);
  assert.equal(parseCookie(`other=x; ${SESSION_COOKIE_NAME}=secret`, SESSION_COOKIE_NAME), "secret");
});
