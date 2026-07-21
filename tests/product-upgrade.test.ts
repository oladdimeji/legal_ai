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
