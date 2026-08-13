import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isValidEmail, normalizeEmail } from "./auth.js";

export const ADMIN_SESSION_COOKIE_NAME = "exepts_admin_session";
export const ADMIN_OAUTH_STATE_COOKIE_NAME = "exepts_admin_oauth_state";
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface AdminIdentity {
  email: string;
}

interface AdminSessionPayload {
  version: 1;
  email: string;
  issuedAt: number;
  expiresAt: number;
}

export function isValidAdminSessionSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= 32;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

export function createAdminSessionToken(
  rawEmail: string,
  secret: string,
  now = Date.now()
): string {
  if (!isValidAdminSessionSecret(secret)) throw new Error("ADMIN_SESSION_NOT_CONFIGURED");
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) throw new Error("ADMIN_SESSION_IDENTITY_INVALID");
  const payload: AdminSessionPayload = {
    version: 1,
    email,
    issuedAt: now,
    expiresAt: now + ADMIN_SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyAdminSessionToken(
  token: string | null,
  secret: string | undefined,
  now = Date.now()
): AdminIdentity | null {
  if (!token || token.length > 2048 || !isValidAdminSessionSecret(secret)) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const actual = Buffer.from(parts[1], "base64url");
  const expected = Buffer.from(signature(parts[0], secret), "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8")
    ) as Partial<AdminSessionPayload>;
    const email = typeof payload.email === "string" ? normalizeEmail(payload.email) : "";
    if (
      payload.version !== 1 ||
      !isValidEmail(email) ||
      email !== payload.email ||
      !Number.isSafeInteger(payload.issuedAt) ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.issuedAt! > now + 5 * 60 * 1000 ||
      payload.expiresAt! <= now ||
      payload.expiresAt! - payload.issuedAt! !== ADMIN_SESSION_TTL_MS
    ) {
      return null;
    }
    return { email };
  } catch {
    return null;
  }
}

export function createAdminOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function validateAdminOAuthState(
  suppliedState: unknown,
  cookieValue: string | null
): boolean {
  if (
    typeof suppliedState !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(suppliedState) ||
    !cookieValue ||
    !/^[A-Za-z0-9_-]{43}$/.test(cookieValue)
  ) {
    return false;
  }
  const supplied = Buffer.from(suppliedState);
  const expected = Buffer.from(cookieValue);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function adminSessionCookie(token: string, isProduction: boolean): string {
  return [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`,
    ...(isProduction ? ["Secure"] : []),
  ].join("; ");
}

export function clearAdminSessionCookie(isProduction: boolean): string {
  return [
    `${ADMIN_SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(isProduction ? ["Secure"] : []),
  ].join("; ");
}

export function adminOAuthStateCookie(value: string, isProduction: boolean): string {
  return [
    `${ADMIN_OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/api/admin/auth/google/callback",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600",
    ...(isProduction ? ["Secure"] : []),
  ].join("; ");
}

export function clearAdminOAuthStateCookie(isProduction: boolean): string {
  return [
    `${ADMIN_OAUTH_STATE_COOKIE_NAME}=`,
    "Path=/api/admin/auth/google/callback",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(isProduction ? ["Secure"] : []),
  ].join("; ");
}
