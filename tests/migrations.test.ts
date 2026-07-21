import assert from "node:assert/strict";
import test from "node:test";
import { migrationManifest } from "../server/migrations.js";

test("migration versions are unique and strictly increasing", () => {
  const versions = migrationManifest.map((migration) => migration.version);
  assert.deepEqual(versions, [...new Set(versions)]);
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b));
});

test("draft preservation migration is registered", () => {
  assert.ok(
    migrationManifest.some(
      (migration) => migration.name === "preserve_drafts_when_threads_are_deleted"
    )
  );
});
