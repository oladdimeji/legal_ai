import { isValidEmail, normalizeEmail } from "./auth.js";

export const SITE_LOCK_DENIED_MESSAGE =
  "This application is currently available to approved accounts only.";

export interface SiteLockEnvironment {
  SITE_LOCKED?: string;
  SITE_REOPENS_AT?: string;
  SITE_ALLOWED_EMAILS?: string;
}

export interface SiteLockPolicy {
  locked: boolean;
  reopensAt: string | null;
  allowedEmails: ReadonlySet<string>;
}

export interface PublicSiteLockStatus {
  locked: boolean;
  reopensAt: string | null;
}

function normalizedCountdownDate(value: string | undefined): string | null {
  const candidate = value?.trim();
  const match = candidate?.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/i
  );
  if (!candidate || !match) return null;

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const daysInMonth =
    month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (
    day < 1 ||
    day > daysInMonth ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText || 0) > 59 ||
    Number(offsetHourText || 0) > 23 ||
    Number(offsetMinuteText || 0) > 59
  ) {
    return null;
  }
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizedAllowedEmails(value: string | undefined): ReadonlySet<string> {
  const candidate = value?.trim();
  if (!candidate) return new Set();

  const entries = candidate.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => !entry || !isValidEmail(entry))) return new Set();
  return new Set(entries.map(normalizeEmail));
}

export function readSiteLockPolicy(environment: SiteLockEnvironment): SiteLockPolicy {
  return {
    locked: environment.SITE_LOCKED?.trim().toLowerCase() === "true",
    reopensAt: normalizedCountdownDate(environment.SITE_REOPENS_AT),
    allowedEmails: normalizedAllowedEmails(environment.SITE_ALLOWED_EMAILS),
  };
}

export function isSiteLocked(policy: SiteLockPolicy): boolean {
  return policy.locked;
}

export function isEmailAllowlisted(email: string | null | undefined, policy: SiteLockPolicy): boolean {
  if (!email || !isValidEmail(email)) return false;
  return policy.allowedEmails.has(normalizeEmail(email));
}

export function canAccessPrivateApplication(
  email: string | null | undefined,
  policy: SiteLockPolicy
): boolean {
  return !isSiteLocked(policy) || isEmailAllowlisted(email, policy);
}

export function publicSiteLockStatus(policy: SiteLockPolicy): PublicSiteLockStatus {
  return { locked: policy.locked, reopensAt: policy.reopensAt };
}

export function isProtectedApplicationPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return (
    path === "/onboarding" ||
    path === "/assistant" ||
    path === "/matters" ||
    path.startsWith("/matters/") ||
    path === "/library" ||
    path === "/history" ||
    path === "/settings" ||
    path === "/client" ||
    path.startsWith("/client/")
  );
}
