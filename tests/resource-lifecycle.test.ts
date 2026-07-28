import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PERMANENT_DELETION_DELAY_MS,
  assertLifecycleTransition,
  assertPermanentDeletionEligible,
  confirmationMatches,
  deletionConfirmationDigest,
  deletionNotBefore,
  normalizeFolderPath,
  normalizeTags,
  retentionBlocksDeletion,
  revisionLane,
} from "../server/lifecycle.js";
import { decideAuthorization } from "../server/authorization.js";

test("archive and restore transitions are intentional and deletion/deleted states are terminal", () => {
  assert.doesNotThrow(() => assertLifecycleTransition("active", "archived"));
  assert.doesNotThrow(() => assertLifecycleTransition("archived", "active"));
  assert.throws(() => assertLifecycleTransition("deletion_pending", "active"), /pending/i);
  assert.throws(() => assertLifecycleTransition("deleted", "active"), /cannot be restored/i);
});

test("retention, archive state, and dependencies independently block permanent deletion", () => {
  const now = new Date("2030-01-01T00:00:00.000Z");
  assert.equal(retentionBlocksDeletion({ retentionState: "held", retentionUntil: null }, now), true);
  assert.equal(retentionBlocksDeletion({
    retentionState: "standard",
    retentionUntil: "2030-02-01T00:00:00.000Z",
  }, now), true);
  assert.throws(() => assertPermanentDeletionEligible({
    lifecycleState: "active",
  }, now), /archive/i);
  assert.throws(() => assertPermanentDeletionEligible({
    lifecycleState: "archived",
    retentionState: "held",
  }, now), /retention/i);
  assert.throws(() => assertPermanentDeletionEligible({
    lifecycleState: "archived",
    blockingDependencies: 1,
  }, now), /dependencies/i);
  assert.doesNotThrow(() => assertPermanentDeletionEligible({
    lifecycleState: "archived",
    retentionState: "standard",
    retentionUntil: "2029-01-01T00:00:00.000Z",
    blockingDependencies: 0,
  }, now));
});

test("permanent deletion confirmation is scoped, hash-only, delayed, and constant-format comparable", () => {
  const first = deletionConfirmationDigest("firm_1", "matter", "case_1", "Client Matter");
  const same = deletionConfirmationDigest("firm_1", "matter", "case_1", "Client Matter");
  const otherFirm = deletionConfirmationDigest("firm_2", "matter", "case_1", "Client Matter");
  assert.equal(first.length, 64);
  assert.equal(confirmationMatches(first, same), true);
  assert.equal(confirmationMatches(first, otherFirm), false);
  const now = new Date("2030-01-01T00:00:00.000Z");
  assert.equal(
    new Date(deletionNotBefore(now)).getTime() - now.getTime(),
    PERMANENT_DELETION_DELAY_MS,
  );
});

test("Firm Library folder and tag normalization is bounded and traversal-safe", () => {
  assert.equal(normalizeFolderPath("../../Client\\Pleadings//Filed"), "/Client/Pleadings/Filed");
  assert.deepEqual(normalizeTags([" Evidence ", "evidence", "", "PRIVILEGED"]), [
    "evidence",
    "privileged",
  ]);
});

test("lawyer and client Work Product histories remain separate", () => {
  assert.equal(revisionLane("Lawyer Original"), "lawyer");
  assert.equal(revisionLane("Duplicate"), "lawyer");
  assert.equal(revisionLane("Client Revision"), "client");
  assert.equal(revisionLane("Client Response"), "client");
});

test("only firm administrators can manage retention or request permanent deletion", () => {
  const base = { userId: "user_1", firmId: "firm_1", status: "active" as const };
  for (const role of ["lawyer", "staff", "read_only"] as const) {
    assert.equal(decideAuthorization({
      principal: { ...base, role },
      action: "matter.permanent_delete",
      matterId: "case_1",
      assigned: true,
    }), false);
    assert.equal(decideAuthorization({
      principal: { ...base, role },
      action: "matter.retention.manage",
      matterId: "case_1",
      assigned: true,
    }), false);
  }
  assert.equal(decideAuthorization({
    principal: { ...base, role: "firm_admin" },
    action: "matter.permanent_delete",
    matterId: "case_1",
    assigned: false,
  }), true);
});

test("migration and repositories preserve history, scope dependencies, and restore as a new version", async () => {
  const [migrations, database, server, worker] = await Promise.all([
    readFile("server/migrations.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
    readFile("server.ts", "utf8"),
    readFile("worker.ts", "utf8"),
  ]);
  const phase = migrations.slice(migrations.indexOf("version: 18"));
  assert.match(phase, /document_resource_versions/);
  assert.match(phase, /work_product_versions/);
  assert.match(phase, /permanent_deletion_requests/);
  assert.match(phase, /resource_audit_events/);
  assert.doesNotMatch(phase, /\b(?:DROP TABLE|TRUNCATE|DELETE FROM cases|DELETE FROM documents)\b/i);
  assert.match(database, /COALESCE\(MAX\(version_number\), 0\) \+ 1/);
  assert.match(database, /change_type[\s\S]*'restored'/);
  assert.match(database, /restoredFromVersionId/);
  assert.match(database, /WHERE v\.draft_id = \$1 AND v\.case_id = \$2 AND v\.firm_id = \$3/);
  assert.match(server, /application\/pdf/);
  assert.match(database, /exepts-matter-export/);
  assert.match(database, /original_filename[\s\S]*download_path/);
  assert.doesNotMatch(
    database.slice(database.indexOf("public async exportMatterPackage"), database.indexOf("public async requestPermanentDeletion")),
    /object_key/,
  );
  assert.match(worker, /FOR UPDATE SKIP LOCKED/);
  assert.match(worker, /dependency_or_storage_failure/);
});
