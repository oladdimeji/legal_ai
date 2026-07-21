import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const databaseSource = readFileSync(new URL("../server/db.ts", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

test("legacy global list and direct mutation query shapes are absent", () => {
  assert.doesNotMatch(databaseSource, /SELECT \* FROM cases ORDER BY/);
  assert.doesNotMatch(databaseSource, /SELECT \* FROM documents ORDER BY/);
  assert.doesNotMatch(databaseSource, /SELECT \* FROM threads ORDER BY/);
  assert.doesNotMatch(databaseSource, /SELECT \* FROM drafts ORDER BY/);
  assert.doesNotMatch(databaseSource, /DELETE FROM documents WHERE id = \$1/);
  assert.doesNotMatch(databaseSource, /UPDATE messages SET content = \$1 WHERE id = \$2/);
  assert.doesNotMatch(databaseSource, /UPDATE drafts SET content = \$1 WHERE id = \$2/);
});

test("general vector retrieval is constrained to owned Firm Library documents before ranking", () => {
  assert.match(
    databaseSource,
    /JOIN documents d ON d\.id = dc\.document_id[\s\S]*?d\.firm_id = \$2 AND d\.case_id IS NULL[\s\S]*?ORDER BY dc\.embedding[\s\S]*?LIMIT \$3/
  );
});

test("Matter vector retrieval requires an owned Matter and direct-or-linked source predicate", () => {
  assert.match(databaseSource, /EXISTS \(SELECT 1 FROM cases c WHERE c\.id = \$3 AND c\.firm_id = \$2\)/);
  assert.match(databaseSource, /d\.case_id = \$3 OR \([\s\S]*?d\.case_id IS NULL AND EXISTS/);
});

test("protected routes derive ownership from authenticated request context", () => {
  assert.match(serverSource, /function ownership\(req: Request\): OwnershipContext/);
  assert.match(serverSource, /app\.use\("\/api", requireAuth\)/);
  assert.doesNotMatch(serverSource, /req\.body\.(userId|firmId)/);
});
