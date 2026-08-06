import {
  createHash,
  randomBytes,
  randomInt,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

export const SESSION_COOKIE_NAME = "legal_ai_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OAUTH_STATE_COOKIE_NAME = "exepts_oauth_state";
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_REQUEST_WINDOW_MS = 60 * 60 * 1000;
export const OTP_MAX_REQUESTS_PER_WINDOW = 5;
export const ACCESS_REVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ACCESS_REVIEW_RESEND_COOLDOWN_MS = 5 * 60 * 1000;
export const ACCESS_REVIEW_DAILY_LIMIT = 5;

export type AuthenticationAccountType = "lawyer" | "client";

export function normalizeAccountType(value: unknown): AuthenticationAccountType {
  return value === "client" ? "client" : "lawyer";
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: 64 * 1024 * 1024,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      }
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt);
  return [
    "scrypt",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, costText, blockText, parallelText, saltText, hashText] = storedHash.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;

  const cost = Number(costText);
  const blockSize = Number(blockText);
  const parallelization = Number(parallelText);
  if (
    cost !== SCRYPT_COST ||
    blockSize !== SCRYPT_BLOCK_SIZE ||
    parallelization !== SCRYPT_PARALLELIZATION
  ) {
    return false;
  }

  const expected = Buffer.from(hashText, "base64url");
  if (expected.length !== SCRYPT_KEY_LENGTH) return false;
  const actual = await scrypt(password, Buffer.from(saltText, "base64url"));
  return timingSafeEqual(actual, expected);
}

export function createSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function createCollaborationToken(): { token: string; tokenHash: string } {
  const random = randomBytes(16).toString("hex").toUpperCase();
  const token = `MAT-${random.match(/.{1,4}/g)!.join("-")}`;
  return { token, tokenHash: hashSessionToken(token) };
}

export function createAccessReviewToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function parseAccessReviewToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionCookie(token: string, isProduction: boolean): string {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(isProduction ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie(isProduction: boolean): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(isProduction ? ["Secure"] : []),
  ].join("; ");
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export function safeInternalPath(value: unknown, fallback = "/matters"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  if (value.includes("\\") || /[\u0000-\u001f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://exepts.invalid");
    if (url.origin !== "https://exepts.invalid") return fallback;
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (/^\/(?:auth|login|signup|onboarding)(?:\/|$|\?)/.test(path)) return fallback;
    const isProtectedPath =
      /^\/(?:assistant|matters|library|history|settings)\/?(?:[?#].*)?$/.test(path) ||
      /^\/matters\/[^/?#]+(?:[?#].*)?$/.test(path) ||
      /^\/client\/(?:assistant|shared-matters|history|settings)\/?(?:[?#].*)?$/.test(path) ||
      /^\/client\/shared-matters\/[^/?#]+(?:[?#].*)?$/.test(path);
    return isProtectedPath ? path : fallback;
  } catch {
    return fallback;
  }
}

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(code: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${code}`, "utf8").digest("hex");
}

export function createOtpHash(code: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString("base64url");
  return { salt, hash: hashOtp(code, salt) };
}

export function verifyOtpHash(code: string, salt: string, expectedHash: string): boolean {
  if (!/^\d{6}$/.test(code) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hashOtp(code, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createOAuthState(
  returnTo: unknown,
  accountType: unknown = "lawyer"
): { state: string; cookieValue: string } {
  const state = randomBytes(32).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      state,
      returnTo: safeInternalPath(returnTo),
      accountType: normalizeAccountType(accountType),
    }),
    "utf8"
  ).toString("base64url");
  return { state, cookieValue: payload };
}

export function oauthAccountTypeFromCookie(
  cookieValue: string | null
): AuthenticationAccountType {
  if (!cookieValue) return "lawyer";
  try {
    const parsed = JSON.parse(Buffer.from(cookieValue, "base64url").toString("utf8")) as {
      accountType?: unknown;
    };
    return normalizeAccountType(parsed.accountType);
  } catch {
    return "lawyer";
  }
}

export function parseCollaborationToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 256 || /[\u0000-\u001f/:\\]/.test(candidate)) {
    return null;
  }
  return /^(?:MAT-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}|[A-Za-z0-9_-]{32,256})$/.test(
    candidate
  )
    ? candidate
    : null;
}

export function validateOAuthState(
  suppliedState: unknown,
  cookieValue: string | null
): { valid: boolean; returnTo: string } {
  if (typeof suppliedState !== "string" || !cookieValue) {
    return { valid: false, returnTo: "/matters" };
  }
  try {
    const parsed = JSON.parse(Buffer.from(cookieValue, "base64url").toString("utf8")) as {
      state?: unknown;
      returnTo?: unknown;
    };
    if (typeof parsed.state !== "string") return { valid: false, returnTo: "/matters" };
    const supplied = Buffer.from(suppliedState);
    const expected = Buffer.from(parsed.state);
    const valid = supplied.length === expected.length && timingSafeEqual(supplied, expected);
    return { valid, returnTo: valid ? safeInternalPath(parsed.returnTo) : "/matters" };
  } catch {
    return { valid: false, returnTo: "/matters" };
  }
}

export function oauthStateCookie(value: string, isProduction: boolean): string {
  return [
    `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/api/auth/google/callback",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600",
    ...(isProduction ? ["Secure"] : []),
  ].join("; ");
}

export function clearOAuthStateCookie(isProduction: boolean): string {
  return [
    `${OAUTH_STATE_COOKIE_NAME}=`,
    "Path=/api/auth/google/callback",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(isProduction ? ["Secure"] : []),
  ].join("; ");
}
