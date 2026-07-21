import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Phase 3 navigation separates Matters and Firm Library", async () => {
  const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
  assert.match(sidebar, /id: "matters", label: "Matters"/);
  assert.match(sidebar, /id: "library", label: "Firm Library"/);
  assert.doesNotMatch(sidebar, /Workspace & Library/);
});

test("Firm Library has no Matter navigation or creation controls", async () => {
  const library = await readFile("src/components/FirmLibraryView.tsx", "utf8");
  assert.match(library, /caseId=null/);
  assert.match(library, /scope: "wide"/);
  assert.doesNotMatch(library, /Create Matter|Matter list|activeCaseId/);
});

test("Phase 4 Matter creation requires an assignment and starting input", async () => {
  const server = await readFile("server.ts", "utf8");
  assert.match(server, /Matter name and assignment description are required/);
  assert.match(server, /At least one starting input is required/);
  assert.match(server, /validateFirmLibraryDocuments/);
  assert.ok(server.indexOf("At least one starting input is required") < server.indexOf("db.createCase"));
});

test("Phase 4 Source links and details remain workspace scoped", async () => {
  const database = await readFile("server/db.ts", "utf8");
  assert.match(database, /c\.firm_id = \$3 AND d\.firm_id = \$3 AND d\.case_id IS NULL/);
  assert.match(database, /c\.id = \$2 AND c\.firm_id = \$1/);
  assert.match(database, /chunk\.similarity < 0\.45/);
  assert.match(database, /'AI Suggested'/);
});

test("migration 005 adds only additive Matter and Source metadata", async () => {
  const migrations = await readFile("server/migrations.ts", "utf8");
  assert.match(migrations, /version: 5/);
  assert.match(migrations, /name: "matter_core_and_sources"/);
  assert.match(migrations, /ADD COLUMN IF NOT EXISTS client_name/);
  assert.match(migrations, /ADD COLUMN IF NOT EXISTS source_type/);
  assert.match(migrations, /ADD COLUMN IF NOT EXISTS link_origin/);
});
