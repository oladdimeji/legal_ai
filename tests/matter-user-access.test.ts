import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const databaseSource = readFileSync(new URL("../server/db.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../server/migrations.ts", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

function methodSource(name: string, nextName: string): string {
  const start = databaseSource.indexOf(`public async ${name}`);
  const end = databaseSource.indexOf(`public async ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return databaseSource.slice(start, end);
}

test("migration 25 additively creates Matter user access and its listing index", () => {
  assert.match(migrationSource, /version:\s*25[\s\S]*?name:\s*"matter_user_access_control"/);
  assert.match(
    migrationSource,
    /CREATE TABLE IF NOT EXISTS matter_user_access[\s\S]*?case_id TEXT NOT NULL REFERENCES cases\(id\) ON DELETE CASCADE[\s\S]*?user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE[\s\S]*?granted_at TEXT NOT NULL[\s\S]*?PRIMARY KEY \(case_id, user_id\)/
  );
  assert.match(
    migrationSource,
    /CREATE INDEX IF NOT EXISTS matter_user_access_user_case_idx[\s\S]*?ON matter_user_access\(user_id, case_id\)/
  );
  const migration25 = migrationSource.slice(migrationSource.indexOf("version: 25"));
  assert.doesNotMatch(migration25, /\b(DROP|TRUNCATE|DELETE FROM|ALTER TABLE cases)\b/i);
});

test("migration 25 backfills every existing lawyer in the Matter firm", () => {
  assert.match(
    migrationSource,
    /INSERT INTO matter_user_access \(case_id, user_id, granted_at\)[\s\S]*?SELECT c\.id, u\.id, NOW\(\)::text[\s\S]*?JOIN users u ON u\.firm_id = c\.firm_id[\s\S]*?u\.account_type = 'lawyer'[\s\S]*?ON CONFLICT DO NOTHING/
  );
});

test("a lawyer joining by invitation after migration receives no existing Matter grants", () => {
  const onboarding = methodSource("completeOnboarding", "deleteSession");
  assert.match(onboarding, /invitation_code/);
  assert.doesNotMatch(onboarding, /matter_user_access/);
});

test("Matter creation atomically inserts the Matter and creator grant", () => {
  const creation = methodSource("createCase", "updateCase");
  assert.match(creation, /WITH created_case AS \([\s\S]*?INSERT INTO cases/);
  assert.match(
    creation,
    /granted_access AS \([\s\S]*?INSERT INTO matter_user_access \(case_id, user_id, granted_at\)[\s\S]*?SELECT id, \$2, \$6 FROM created_case/
  );
  assert.match(creation, /u\.id = \$2 AND u\.firm_id = \$3 AND u\.account_type = 'lawyer'/);
});

test("Matter list and direct lookup require both user access and Firm ownership", () => {
  const list = methodSource("getCases", "getCaseById");
  const direct = methodSource("getCaseById", "createCase");
  for (const source of [list, direct]) {
    assert.match(source, /JOIN matter_user_access access/);
    assert.match(source, /access\.user_id = \$/);
    assert.match(source, /c\.firm_id = \$/);
  }
});

test("Matter-bound lawyer operations use the centralized authorization boundary", () => {
  assert.match(databaseSource, /private async hasMatterAccess/);
  assert.match(databaseSource, /private async assertMatterAccess/);
  assert.match(databaseSource, /private async assertThreadMatterAccess[\s\S]*?this\.assertMatterAccess/);

  const guardedMatterMethods = [
    ["updateCase", "validateFirmLibraryDocuments"],
    ["linkLibraryDocument", "getCaseSources"],
    ["getCaseSources", "touchCase"],
    ["getMatterIntelligence", "getMatterIntelligenceSourceBundle"],
    ["getCollaboration", "saveClientCollaborator"],
    ["getDocuments", "getDocumentById"],
    ["deleteDocument", "vectorSearch"],
    ["getDrafts", "getDraftById"],
    ["createManualDraft", "duplicateDraft"],
    ["updateDraft", "getThreadMessageCount"],
  ];
  for (const [name, nextName] of guardedMatterMethods) {
    assert.match(methodSource(name, nextName), /assertMatterAccess/);
  }

  for (const [name, nextName] of [
    ["getThreadById", "createThread"],
    ["getMessages", "getRecentMessages"],
    ["addMessage", "updateMessage"],
    ["getThreadMessageCount", "updateThreadMemory"],
  ]) {
    assert.match(methodSource(name, nextName), /assertThreadMatterAccess/);
  }
});

test("Firm Library and Client Portal authorization paths stay independent of Matter grants", () => {
  const documents = methodSource("getDocuments", "getDocumentById");
  assert.match(
    documents,
    /if \(!caseId\)[\s\S]*?firm_id = \$1 AND case_id IS NULL[\s\S]*?await this\.assertMatterAccess\(caseId, context\)/
  );
  const portalStart = databaseSource.indexOf("public async resolvePortalAccess");
  const lawyerDocumentsStart = databaseSource.indexOf("public async getDocuments", portalStart);
  const portalMethods = databaseSource.slice(portalStart, lawyerDocumentsStart);
  assert.match(portalMethods, /token_hash/);
  assert.doesNotMatch(portalMethods, /assertMatterAccess|matter_user_access/);
});

test("unauthorized Matter access is deliberately surfaced as not found and maps to 404", () => {
  assert.match(
    databaseSource,
    /private async assertMatterAccess[\s\S]*?throw new Error\("Matter not found"\)/
  );
  assert.match(
    serverSource,
    /function ownedErrorStatus\(error: unknown\): number \{[\s\S]*?\/not found\/i\.test\(error\.message\) \? 404 : 500/
  );
});
