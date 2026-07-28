import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Request, Response } from "express";
import {
  FIRM_ROLES,
  assertMemberRemovalAllowed,
  classifyProtectedRequest,
  createAuthorizationMiddleware,
  decideAuthorization,
  invitationCanBeAccepted,
  type AuthorizationAction,
  type FirmRole,
} from "../server/authorization.js";

const allActions: AuthorizationAction[] = [
  "workspace.view", "assistant.use", "matter.list", "matter.create", "matter.view",
  "matter.download", "matter.edit", "matter.content.write", "matter.content.delete",
  "matter.client_access.manage", "library.view", "library.write", "library.delete",
  "integration.use", "team.manage",
];

function permitted(role: FirmRole, action: AuthorizationAction, assigned = true, matterId: string | null = "matter_1") {
  return decideAuthorization({
    principal: { userId: "user_1", firmId: "firm_1", role, status: "active" },
    action,
    matterId,
    assigned,
  });
}

test("behavioral role/action matrix enforces assignment and permanent-action boundaries", () => {
  for (const action of allActions) assert.equal(permitted("firm_admin", action, false), true, `admin: ${action}`);

  const lawyerDenied = new Set<AuthorizationAction>(["team.manage"]);
  for (const action of allActions) {
    assert.equal(permitted("lawyer", action), !lawyerDenied.has(action), `lawyer: ${action}`);
  }
  assert.equal(permitted("lawyer", "matter.view", false), false);
  assert.equal(permitted("lawyer", "matter.content.write", false), false);
  assert.equal(permitted("lawyer", "integration.use", false), false);
  assert.equal(permitted("lawyer", "assistant.use", false), false);
  assert.equal(permitted("lawyer", "integration.use", false, null), true);
  assert.equal(permitted("lawyer", "assistant.use", false, null), true);

  const staffAllowed = new Set<AuthorizationAction>([
    "workspace.view", "assistant.use", "matter.list", "matter.view", "matter.download",
    "matter.edit", "matter.content.write", "library.view", "library.write",
  ]);
  for (const action of allActions) {
    assert.equal(permitted("staff", action), staffAllowed.has(action), `staff: ${action}`);
  }
  assert.equal(permitted("staff", "matter.content.write", false), false);

  const readOnlyAllowed = new Set<AuthorizationAction>([
    "workspace.view", "matter.list", "matter.view", "matter.download", "library.view",
  ]);
  for (const action of allActions) {
    assert.equal(permitted("read_only", action), readOnlyAllowed.has(action), `read_only: ${action}`);
  }

  for (const role of FIRM_ROLES) {
    assert.equal(decideAuthorization({
      principal: { userId: "user_1", firmId: "firm_1", role, status: "suspended" },
      action: "workspace.view",
      matterId: null,
      assigned: false,
    }), false);
  }
});

test("central middleware fails closed for cross-firm IDs and denies unassigned Matter substitution", async () => {
  const outcomes: Array<{ exists: boolean; matterId: string | null; assigned: boolean }> = [
    { exists: false, matterId: null, assigned: false },
    { exists: true, matterId: "matter_foreign", assigned: false },
    { exists: true, matterId: "matter_assigned", assigned: true },
  ];
  let nextCalls = 0;
  const middleware = createAuthorizationMiddleware({
    async resolveAuthorization() {
      return outcomes.shift()!;
    },
  });
  const makeRequest = () => ({
    method: "GET",
    path: "/cases/matter_substituted",
    body: {},
    query: {},
    auth: {
      user: { id: "user_1", firm_id: "firm_1" },
      membership: { role: "lawyer", status: "active" },
    },
  }) as unknown as Request;
  const statuses: number[] = [];
  const response = {
    status(code: number) { statuses.push(code); return this; },
    json() { return this; },
  } as unknown as Response;
  const next = () => { nextCalls += 1; };

  await middleware(makeRequest(), response, next);
  await middleware(makeRequest(), response, next);
  await middleware(makeRequest(), response, next);

  assert.deepEqual(statuses, [404, 403]);
  assert.equal(nextCalls, 1);
});

test("direct resource routes carry both the supplied Matter and resource ID for substitution checks", () => {
  const request = {
    method: "PUT",
    path: "/drafts/draft_foreign",
    body: {},
    query: { caseId: "matter_requested" },
  } as unknown as Request;
  assert.deepEqual(classifyProtectedRequest(request), {
    action: "matter.content.write",
    matterId: "matter_requested",
    reference: { type: "draft", id: "draft_foreign" },
  });
  assert.equal(classifyProtectedRequest({
    method: "PATCH", path: "/unknown", body: {}, query: {},
  } as unknown as Request), null);
  assert.deepEqual(classifyProtectedRequest({
    method: "GET", path: "/api/auth/me", body: {}, query: {},
  } as unknown as Request), { action: "workspace.view" });
});

test("invitation expiry and member-removal ownership rules are behavioral and fail closed", () => {
  const now = new Date("2026-07-28T12:00:00.000Z");
  assert.equal(invitationCanBeAccepted("pending", "2026-07-28T12:00:01.000Z", now), true);
  assert.equal(invitationCanBeAccepted("pending", "2026-07-28T12:00:00.000Z", now), false);
  assert.equal(invitationCanBeAccepted("revoked", "2026-07-29T12:00:00.000Z", now), false);
  assert.equal(invitationCanBeAccepted("accepted", "2026-07-29T12:00:00.000Z", now), false);

  assert.throws(() => assertMemberRemovalAllowed({
    targetUserId: "admin_1", actingUserId: "admin_1", replacementUserId: "admin_2", targetRole: "firm_admin",
    activeAdminCount: 2, replacementActive: true,
  }), /remove themselves/);
  assert.throws(() => assertMemberRemovalAllowed({
    targetUserId: "admin_2", actingUserId: "admin_1", replacementUserId: "admin_1", targetRole: "firm_admin",
    activeAdminCount: 1, replacementActive: true,
  }), /final active/);
  assert.throws(() => assertMemberRemovalAllowed({
    targetUserId: "lawyer_1", actingUserId: "admin_1", replacementUserId: "admin_1", targetRole: "lawyer",
    activeAdminCount: 1, replacementActive: false,
  }), /replacement/);
  assert.throws(() => assertMemberRemovalAllowed({
    targetUserId: "lawyer_1", actingUserId: "admin_1", replacementUserId: "lawyer_1", targetRole: "lawyer",
    activeAdminCount: 1, replacementActive: true,
  }), /different/);
  assert.doesNotThrow(() => assertMemberRemovalAllowed({
    targetUserId: "lawyer_1", actingUserId: "admin_1", replacementUserId: "admin_1", targetRole: "lawyer",
    activeAdminCount: 1, replacementActive: true,
  }));
});

test("migration and repositories preserve owners, hash invitations, assign creators, and hand off removal", () => {
  const migrations = readFileSync(new URL("../server/migrations.ts", import.meta.url), "utf8");
  const db = readFileSync(new URL("../server/db.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

  assert.match(migrations, /version:\s*17[\s\S]*CREATE TABLE IF NOT EXISTS firm_memberships/);
  assert.match(migrations, /CHECK \(role IN \('firm_admin', 'lawyer', 'staff', 'read_only'\)\)/);
  assert.match(migrations, /INSERT INTO firm_memberships[\s\S]*FROM users u[\s\S]*ON CONFLICT \(firm_id, user_id\) DO NOTHING/);
  assert.match(migrations, /INSERT INTO matter_assignments[\s\S]*FROM cases c[\s\S]*JOIN users u ON u\.firm_id = c\.firm_id/);
  assert.doesNotMatch(migrations.slice(migrations.indexOf("version: 17")), /\b(?:DROP TABLE|TRUNCATE|DELETE FROM cases|DELETE FROM users)\b/i);

  assert.match(db, /INSERT INTO cases[\s\S]*created_by_user_id[\s\S]*INSERT INTO matter_assignments[\s\S]*await client\.query\("COMMIT"\)/);
  assert.match(db, /UPDATE cases SET created_by_user_id = \$1[\s\S]*UPDATE matter_assignments SET status = 'removed'[\s\S]*DELETE FROM sessions/);
  assert.match(db, /token_hash = \$1 AND status = 'pending' AND expires_at > NOW\(\)[\s\S]*FOR UPDATE/);
  assert.doesNotMatch(db, /INSERT INTO firm_invitations[\s\S]{0,500}\btoken\b(?!_hash)/);
  assert.match(server, /app\.use\("\/api", requireAuth\);\s*app\.use\("\/api", createAuthorizationMiddleware\(db\)\)/);
});
