import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
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

test("lawyer assistant memory migration is additive and idempotent", async () => {
  assert.ok(
    migrationManifest.some(
      (migration) => migration.version === 24 && migration.name === "lawyer_assistant_thread_memory"
    )
  );
  const source = await readFile("server/migrations.ts", "utf8");
  const memoryMigration = source.slice(source.indexOf('name: "lawyer_assistant_thread_memory"'));
  assert.match(memoryMigration, /ADD COLUMN IF NOT EXISTS memory_summary TEXT/);
  assert.match(memoryMigration, /ADD COLUMN IF NOT EXISTS memory_message_count INTEGER NOT NULL DEFAULT 0/);
  assert.match(memoryMigration, /ADD COLUMN IF NOT EXISTS memory_updated_at TEXT/);
  assert.doesNotMatch(memoryMigration, /DROP TABLE|DELETE FROM|TRUNCATE/);
});

test("AI usage ledger migration is registered after migration 26", async () => {
  assert.ok(
    migrationManifest.some(
      (migration) => migration.version === 27 && migration.name === "append_only_ai_usage_ledger"
    )
  );
  const source = await readFile("server/migrations.ts", "utf8");
  const usageMigration = source.slice(source.indexOf("version: 27"));
  assert.match(usageMigration, /CREATE TABLE IF NOT EXISTS ai_usage_events/);
  assert.doesNotMatch(usageMigration, /\bDROP\b|\bTRUNCATE\b|DELETE\s+FROM|ALTER\s+TABLE[\s\S]*RENAME/i);
});
