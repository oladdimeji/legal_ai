import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { parseCookie } from "./auth.js";

export const CLIENT_SESSION_COOKIE_NAME = "exepts_client_session";
export const CLIENT_CSRF_COOKIE_NAME = "exepts_client_csrf";
export const CLIENT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function clientSessionCookie(token: string, production: boolean): string {
  return [
    `${CLIENT_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(CLIENT_SESSION_TTL_MS / 1000)}`,
    ...(production ? ["Secure"] : []),
  ].join("; ");
}

export function clearClientSessionCookie(production: boolean): string {
  return [
    `${CLIENT_SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(production ? ["Secure"] : []),
  ].join("; ");
}

export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function csrfCookie(token: string, production: boolean): string {
  return [
    `${CLIENT_CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/api",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=3600",
    ...(production ? ["Secure"] : []),
  ].join("; ");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireClientCsrf(req: Request, res: Response, next: NextFunction) {
  const cookie = parseCookie(req.headers.cookie, CLIENT_CSRF_COOKIE_NAME) || "";
  const header = typeof req.headers["x-csrf-token"] === "string"
    ? req.headers["x-csrf-token"] : "";
  if (!cookie || !header || !safeEqual(cookie, header)) {
    return res.status(403).json({ error: "Request validation failed." });
  }
  return next();
}

export function createOriginGuard(expectedOrigin: string) {
  const expected = new URL(expectedOrigin).origin;
  return (req: Request, res: Response, next: NextFunction) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) return next();
    const origin = req.headers.origin;
    if (typeof origin !== "string") {
      return res.status(403).json({ error: "Request origin is required." });
    }
    try {
      if (new URL(origin).origin !== expected) {
        return res.status(403).json({ error: "Request origin is not allowed." });
      }
    } catch {
      return res.status(403).json({ error: "Request origin is not allowed." });
    }
    return next();
  };
}

type Attempt = { failures: number; windowStartedAt: number; blockedUntil: number };

export class ProgressiveRateLimiter {
  private readonly attempts = new Map<string, Attempt>();

  constructor(
    private readonly maxAttempts = 10,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly baseDelayMs = 150,
    private readonly maxDelayMs = 4_000,
  ) {}

  async before(key: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const now = Date.now();
    let attempt = this.attempts.get(key);
    if (attempt && now - attempt.windowStartedAt > this.windowMs) {
      this.attempts.delete(key);
      attempt = undefined;
    }
    if (!attempt) return { allowed: true, retryAfterSeconds: 0 };
    if (attempt.failures >= this.maxAttempts && attempt.blockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((attempt.blockedUntil - now) / 1000)),
      };
    }
    const delay = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * Math.max(0, 2 ** Math.max(0, attempt.failures - 1)),
    );
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return { allowed: true, retryAfterSeconds: 0 };
  }

  fail(key: string): void {
    const now = Date.now();
    const current = this.attempts.get(key);
    const attempt = current && now - current.windowStartedAt <= this.windowMs
      ? current : { failures: 0, windowStartedAt: now, blockedUntil: now };
    attempt.failures += 1;
    const delay = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.max(0, attempt.failures - 1));
    attempt.blockedUntil = now + (attempt.failures >= this.maxAttempts ? this.windowMs : delay);
    this.attempts.set(key, attempt);
  }

  succeed(key: string): void {
    this.attempts.delete(key);
  }
}

export function requestFingerprint(req: Request, discriminator = ""): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return createHash("sha256")
    .update(`${ip}|${discriminator.trim().toLowerCase()}`, "utf8")
    .digest("hex");
}

export function metadataHash(value: string | undefined): string | null {
  return value
    ? createHash("sha256").update(value.slice(0, 500), "utf8").digest("hex")
    : null;
}

export function validEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)
    ? normalized : null;
}

export function validName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 160 ? name : null;
}

export function validPassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.length >= 12 && value.length <= 200 ? value : null;
}

export function validId(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{3,180}$/.test(value)
    ? value : null;
}

export function validContent(value: unknown, max = 20_000): string | null {
  if (typeof value !== "string") return null;
  const content = value.trim();
  return content.length >= 1 && content.length <= max ? content : null;
}

export function safeClientError(code: string): void {
  console.error("Client account request failed", { code });
}
