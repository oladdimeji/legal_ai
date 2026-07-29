import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertLifecycleTransition,
  normalizeFolderPath,
  normalizeTags,
  revisionLane,
} from "../server/lifecycle.js";

test("archive and restore transitions are intentional and deletion/deleted states are terminal", () => {
  assert.doesNotThrow(() => assertLifecycleTransition("active", "archived"));
  assert.doesNotThrow(() => assertLifecycleTransition("archived", "active"));
  assert.throws(() => assertLifecycleTransition("deletion_pending", "active"), /pending/i);
  assert.throws(() => assertLifecycleTransition("deleted", "active"), /cannot be restored/i);
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

test("migration and repositories preserve history, scope dependencies, and restore as a new version", async () => {
  const [migrations, database, server] = await Promise.all([
    readFile("server/migrations.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
    readFile("server.ts", "utf8"),
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
  assert.doesNotMatch(server, /permanent-deletion/);
});
