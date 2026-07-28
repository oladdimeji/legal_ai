import { createHash, timingSafeEqual } from "node:crypto";

export const RESOURCE_LIFECYCLE_FEATURE_FLAG = "FEATURE_RESOURCE_LIFECYCLE";
export const PERMANENT_DELETION_DELAY_MS = 24 * 60 * 60 * 1000;

export type LifecycleState = "active" | "archived" | "deletion_pending";
export type RetentionState = "standard" | "held";

export interface DependencySummary {
  sources?: number;
  libraryLinks?: number;
  conversations?: number;
  workProducts?: number;
  workProductLinks?: number;
  clientAccess?: number;
  requests?: number;
  originals?: number;
  versions?: number;
  embeddings?: number;
  auditReferences?: number;
}

export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
      .map((tag) => tag.slice(0, 40)),
  )).slice(0, 25);
}

export function normalizeFolderPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "/";
  const parts = value.replaceAll("\\", "/").split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.slice(0, 80));
  return parts.length ? `/${parts.join("/")}` : "/";
}

export function revisionLane(revisionType: string | null | undefined): "lawyer" | "client" {
  return revisionType === "Client Revision" || revisionType === "Client Response" ? "client" : "lawyer";
}

export function retentionBlocksDeletion(input: {
  retentionState: RetentionState;
  retentionUntil: string | Date | null;
}, now = new Date()): boolean {
  if (input.retentionState === "held") return true;
  return Boolean(input.retentionUntil && new Date(input.retentionUntil).getTime() > now.getTime());
}

export function dependencyTotal(summary: DependencySummary): number {
  return Object.values(summary).reduce((total, value) => total + Number(value || 0), 0);
}

export function deletionConfirmationDigest(
  firmId: string,
  resourceType: "matter" | "document" | "work_product",
  resourceId: string,
  confirmation: string,
): string {
  return createHash("sha256")
    .update(`${firmId}\0${resourceType}\0${resourceId}\0${confirmation.normalize("NFKC")}`)
    .digest("hex");
}

export function confirmationMatches(expectedDigest: string, actualDigest: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || !/^[a-f0-9]{64}$/.test(actualDigest)) return false;
  return timingSafeEqual(Buffer.from(expectedDigest, "hex"), Buffer.from(actualDigest, "hex"));
}

export function deletionNotBefore(now = new Date()): string {
  return new Date(now.getTime() + PERMANENT_DELETION_DELAY_MS).toISOString();
}

export function assertLifecycleTransition(
  current: LifecycleState | "deleted",
  target: "active" | "archived",
): void {
  if (current === "deletion_pending") throw new Error("Permanent deletion is pending");
  if (current === "deleted") throw new Error("Permanently deleted resources cannot be restored");
  if (current === target) return;
  if (current === "active" && target !== "archived") throw new Error("Archive the resource first");
  if (current === "archived" && target !== "active") throw new Error("Invalid restore transition");
}

export function assertPermanentDeletionEligible(input: {
  lifecycleState: LifecycleState;
  retentionState?: RetentionState;
  retentionUntil?: string | Date | null;
  blockingDependencies?: number;
}, now = new Date()): void {
  if (input.lifecycleState !== "archived") throw new Error("Archive the resource before permanent deletion");
  if (input.retentionState && retentionBlocksDeletion({
    retentionState: input.retentionState,
    retentionUntil: input.retentionUntil || null,
  }, now)) {
    throw new Error("Retention blocks permanent deletion");
  }
  if (Number(input.blockingDependencies || 0) > 0) {
    throw new Error("Dependencies must be removed before permanent deletion");
  }
}
