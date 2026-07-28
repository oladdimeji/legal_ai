import type { NextFunction, Request, Response } from "express";

export const FIRM_ROLES = ["firm_admin", "lawyer", "staff", "read_only"] as const;
export const MEMBER_STATUSES = ["active", "suspended", "removed"] as const;

export type FirmRole = (typeof FIRM_ROLES)[number];
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export type AuthorizationAction =
  | "workspace.view"
  | "assistant.use"
  | "matter.list"
  | "matter.create"
  | "matter.view"
  | "matter.download"
  | "matter.edit"
  | "matter.content.write"
  | "matter.content.delete"
  | "matter.client_access.manage"
  | "library.view"
  | "library.write"
  | "library.delete"
  | "integration.use"
  | "team.manage";

export interface AuthorizationPrincipal {
  userId: string;
  firmId: string;
  role: FirmRole;
  status: MemberStatus;
}

export interface AuthorizationDecisionInput {
  principal: AuthorizationPrincipal;
  action: AuthorizationAction;
  matterId: string | null;
  assigned: boolean;
}

export interface AuthorizationRoute {
  action: AuthorizationAction;
  matterId?: string | null;
  reference?: {
    type: "thread" | "message" | "draft" | "document" | "version" | "drive_import" | "response";
    id: string;
  };
}

const assignedMatterActions = new Set<AuthorizationAction>([
  "matter.view",
  "matter.download",
  "matter.edit",
  "matter.content.write",
  "matter.content.delete",
  "matter.client_access.manage",
]);

const roleActions: Record<FirmRole, ReadonlySet<AuthorizationAction>> = {
  firm_admin: new Set([
    "workspace.view", "assistant.use", "matter.list", "matter.create", "matter.view",
    "matter.download", "matter.edit", "matter.content.write", "matter.content.delete",
    "matter.client_access.manage", "library.view", "library.write", "library.delete",
    "integration.use", "team.manage",
  ]),
  lawyer: new Set([
    "workspace.view", "assistant.use", "matter.list", "matter.create", "matter.view",
    "matter.download", "matter.edit", "matter.content.write", "matter.content.delete",
    "matter.client_access.manage", "library.view", "library.write", "library.delete",
    "integration.use",
  ]),
  staff: new Set([
    "workspace.view", "assistant.use", "matter.list", "matter.view", "matter.download",
    "matter.edit", "matter.content.write", "library.view", "library.write",
  ]),
  read_only: new Set([
    "workspace.view", "matter.list", "matter.view", "matter.download", "library.view",
  ]),
};

export function decideAuthorization(input: AuthorizationDecisionInput): boolean {
  if (input.principal.status !== "active") return false;
  if (!roleActions[input.principal.role].has(input.action)) return false;
  if (
    (input.action === "integration.use" || input.action === "assistant.use" || input.action === "workspace.view")
    && input.matterId
    && input.principal.role !== "firm_admin"
  ) {
    return input.assigned;
  }
  if (!assignedMatterActions.has(input.action) || input.principal.role === "firm_admin") return true;
  return Boolean(input.matterId && input.assigned);
}

export function invitationCanBeAccepted(
  status: "pending" | "accepted" | "expired" | "revoked",
  expiresAt: string,
  now = new Date(),
): boolean {
  return status === "pending" && new Date(expiresAt).getTime() > now.getTime();
}

export function assertMemberRemovalAllowed(input: {
  targetUserId: string;
  actingUserId: string;
  replacementUserId: string;
  targetRole: FirmRole;
  activeAdminCount: number;
  replacementActive: boolean;
}): void {
  if (input.targetUserId === input.actingUserId) {
    throw new Error("Administrators cannot remove themselves");
  }
  if (input.targetUserId === input.replacementUserId) {
    throw new Error("The replacement member must be different from the removed member");
  }
  if (!input.replacementActive) throw new Error("A valid active replacement member is required");
  if (input.targetRole === "firm_admin" && input.activeAdminCount <= 1) {
    throw new Error("The final active firm administrator cannot be removed");
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pathId(pathname: string, pattern: RegExp): string | null {
  const match = pathname.match(pattern);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * This is the single route-to-action map for authenticated APIs. Unknown routes
 * fail closed in the middleware instead of silently inheriting a broad role.
 */
export function classifyProtectedRequest(req: Request): AuthorizationRoute | null {
  const method = req.method.toUpperCase();
  const pathname = req.path.startsWith("/api/") ? req.path.slice(4) : req.path;
  const body = (req.body || {}) as Record<string, unknown>;
  const query = req.query as Record<string, unknown>;
  const matterFromPath = pathId(pathname, /^\/cases\/([^/]+)/);
  const matterId = matterFromPath || stringValue(body.caseId) || stringValue(query.caseId);

  if (pathname === "/auth/me" && method === "GET") return { action: "workspace.view" };
  if (pathname.startsWith("/team/")) return { action: "team.manage" };
  if (pathname.startsWith("/google/")) {
    const importId = pathId(pathname, /^\/google\/drive\/imports\/([^/]+)\/reimport$/);
    return importId
      ? { action: "integration.use", reference: { type: "drive_import", id: importId } }
      : { action: "integration.use", matterId };
  }
  const driveDraftId = pathId(pathname, /^\/drafts\/([^/]+)\/export\/drive$/);
  if (driveDraftId) return { action: "integration.use", matterId, reference: { type: "draft", id: driveDraftId } };
  if (/^\/cases\/[^/]+\/intelligence\/export\/drive$/.test(pathname)) {
    return { action: "integration.use", matterId };
  }

  if (pathname === "/uploads/capabilities" && method === "GET") return { action: "workspace.view" };
  if (pathname === "/ingestion/jobs" && method === "GET") return { action: "workspace.view" };
  if (pathname === "/uploads/authorize" && method === "POST") {
    return { action: matterId ? "matter.content.write" : "library.write", matterId };
  }
  const versionId = pathId(pathname, /^\/(?:uploads|ingestion|document-versions)\/([^/]+)/);
  if (versionId) {
    const download = pathname.endsWith("/original-download");
    return {
      action: download ? "matter.download" : "matter.content.write",
      reference: { type: "version", id: versionId },
    };
  }
  if (pathname === "/improve-prompt" || pathname === "/extract-files") return { action: "assistant.use" };

  if (pathname === "/cases") {
    if (method === "GET") return { action: "matter.list" };
    if (method === "POST") return { action: "matter.create" };
  }
  if (matterFromPath) {
    if (/\/collaboration(?:\/|$)/.test(pathname)) {
      return {
        action: method === "GET" ? "matter.view" : "matter.client_access.manage",
        matterId,
      };
    }
    if (/\/(?:sources|intelligence|work-product)(?:\/|$)/.test(pathname)) {
      const isDownload = method === "GET" && /\/export$/.test(pathname);
      const isRead = method === "GET" && !isDownload;
      const isDelete = method === "DELETE";
      return {
        action: isDownload ? "matter.download" : isRead ? "matter.view" : isDelete
          ? "matter.content.delete" : "matter.content.write",
        matterId,
      };
    }
    return { action: method === "GET" ? "matter.view" : "matter.edit", matterId };
  }

  if (pathname === "/documents") {
    return { action: method === "GET" ? "library.view" : "library.write" };
  }
  const documentId = pathId(pathname, /^\/documents\/([^/]+)/);
  if (documentId) {
    return {
      action: method === "DELETE" ? "library.delete" : "library.view",
      reference: { type: "document", id: documentId },
    };
  }

  if (pathname === "/threads") {
    const action = method === "GET" ? "workspace.view" : "assistant.use";
    return { action, matterId };
  }
  const threadId = pathId(pathname, /^\/threads\/([^/]+)/);
  if (threadId) {
    return {
      action: method === "GET" ? "workspace.view" : "assistant.use",
      reference: { type: "thread", id: threadId },
    };
  }
  if (pathname === "/search") return { action: "assistant.use", matterId: stringValue(body.scope) === "wide" ? null : stringValue(body.scope) };
  const messageId = pathId(pathname, /^\/messages\/([^/]+)/);
  if (messageId) return { action: "assistant.use", reference: { type: "message", id: messageId } };

  if (pathname === "/drafts" && method === "POST") {
    const candidateThread = stringValue(body.threadId);
    return candidateThread
      ? { action: "matter.content.write", reference: { type: "thread", id: candidateThread } }
      : null;
  }
  const draftId = pathId(pathname, /^\/drafts\/([^/]+)/);
  if (draftId) {
    const isDownload = method === "GET" && pathname.endsWith("/export");
    const isRead = method === "GET" && !pathname.endsWith("/export");
    const isClientAccess = pathname.endsWith("/sharing") || pathname.endsWith("/client-revision");
    return {
      action: isDownload ? "matter.download" : isRead ? "matter.view" : isClientAccess
        ? "matter.client_access.manage" : "matter.content.write",
      matterId,
      reference: { type: "draft", id: draftId },
    };
  }

  return null;
}

export interface AuthorizationRepository {
  resolveAuthorization(input: {
    principal: AuthorizationPrincipal;
    route: AuthorizationRoute;
  }): Promise<{ exists: boolean; matterId: string | null; assigned: boolean; action?: AuthorizationAction }>;
}

export function createAuthorizationMiddleware(repository: AuthorizationRepository) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const account = (req as Request & { auth?: { user: { id: string; firm_id: string }; membership: { role: FirmRole; status: MemberStatus } } }).auth;
    if (!account) return res.status(401).json({ error: "Authentication required." });
    const route = classifyProtectedRequest(req);
    if (!route) return res.status(403).json({ error: "This action is not authorized." });
    const principal: AuthorizationPrincipal = {
      userId: account.user.id,
      firmId: account.user.firm_id,
      role: account.membership.role,
      status: account.membership.status,
    };
    try {
      const resolved = await repository.resolveAuthorization({ principal, route });
      if (!resolved.exists) return res.status(404).json({ error: "Authorized resource not found." });
      if (!decideAuthorization({
        principal,
        action: resolved.action || route.action,
        matterId: resolved.matterId,
        assigned: resolved.assigned,
      })) {
        return res.status(403).json({ error: "This action is not authorized." });
      }
      return next();
    } catch {
      return res.status(503).json({ error: "Authorization could not be evaluated." });
    }
  };
}
