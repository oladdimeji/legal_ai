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

test("Phase 5 Assistant exposes persistent General and Matter context language", async () => {
  const assistant = await readFile("src/components/AssistantView.tsx", "utf8");
  assert.match(assistant, />General Assistant<\/option>/);
  assert.match(assistant, /General Assistant Context/);
  assert.match(assistant, /Matter Context/);
  assert.match(assistant, /setActiveThreadId\(null\)[\s\S]*setActiveCaseId/);
  assert.doesNotMatch(assistant, />📁 Wide Library<\/option>/);
});

test("Phase 5 History groups by stored context and recent activity", async () => {
  const [history, database] = await Promise.all([
    readFile("src/components/HistoryView.tsx", "utf8"),
    readFile("server/db.ts", "utf8"),
  ]);
  assert.match(history, /title: "General Assistant"/);
  assert.match(history, /thread\.case_id === matter\.id/);
  assert.match(database, /COALESCE\(MAX\(m\.created_at\), t\.created_at\) AS last_activity_at/);
  assert.match(database, /WHERE t\.user_id = \$1/);
});

test("Phase 6 Work Product is Matter-scoped and global Draft navigation is removed", async () => {
  const [sidebar, workspace, server] = await Promise.all([
    readFile("src/components/Sidebar.tsx", "utf8"),
    readFile("src/components/MatterWorkspaceView.tsx", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  assert.doesNotMatch(sidebar, /Drafts & Documents/);
  assert.match(workspace, /<DraftEditorView caseId=\{matter\.id\}/);
  assert.match(server, /\/api\/cases\/:caseId\/work-product/);
  assert.match(server, /Matter context is required/);
});

test("migration 006 and copy operations preserve Work Product originals", async () => {
  const [migrations, database] = await Promise.all([
    readFile("server/migrations.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
  ]);
  assert.match(migrations, /version: 6/);
  assert.match(migrations, /parent_draft_id/);
  assert.match(migrations, /ON DELETE SET NULL/);
  assert.match(database, /'Duplicated Work Product', 'Duplicate'/);
  assert.match(database, /'Client Revision', d\.id, 'Client Revision'/);
  assert.doesNotMatch(database, /UPDATE drafts[\s\S]{0,120}revision_type = 'Client Revision'/);
});

test("Phase 7 Matter Intelligence is explicit, source-scoped, and snapshot-backed", async () => {
  const [server, database, view] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
    readFile("src/components/MatterIntelligence.tsx", "utf8"),
  ]);
  assert.match(server, /\/api\/cases\/:caseId\/intelligence\/generate/);
  assert.match(server, /using ONLY the supplied active Matter Sources/);
  assert.match(database, /getMatterIntelligenceSourceBundle/);
  assert.match(database, /c\.id = \$2 AND c\.firm_id = \$1/);
  assert.match(view, /Generate Matter Intelligence/);
  assert.match(view, /Sources have changed since this Matter Intelligence was generated/);
});

test("migration 007 stores one simple Matter Intelligence version and Source snapshot", async () => {
  const migrations = await readFile("server/migrations.ts", "utf8");
  assert.match(migrations, /version: 7/);
  assert.match(migrations, /case_id TEXT PRIMARY KEY REFERENCES cases/);
  assert.match(migrations, /source_snapshot JSONB/);
  assert.match(migrations, /version INTEGER NOT NULL DEFAULT 1/);
});

test("Phase 8 collaboration invite stores only a token hash and supports revocation", async () => {
  const [server, database] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
  ]);
  assert.match(server, /const \{ token, tokenHash \} = createSessionToken\(\)/);
  assert.match(server, /activateClientInvite\(req\.params\.caseId, tokenHash/);
  assert.match(server, /invitePath: `\/client\/\$\{encodeURIComponent\(token\)\}`/);
  assert.match(database, /SET token_hash = NULL, invitation_status = 'Revoked'/);
  assert.doesNotMatch(database, /INSERT INTO matter_client_access[\s\S]{0,200}\btoken\b(?!_hash)/);
});

test("Phase 8 requests validate Matter-owned Work Product before linking", async () => {
  const database = await readFile("server/db.ts", "utf8");
  assert.match(database, /d\.id = ANY\(\$1::text\[\]\) AND d\.case_id = \$2 AND c\.firm_id = \$3/);
  assert.match(database, /collaboration_request_documents/);
  assert.match(database, /markCollaborationResponseRead/);
});

test("migration 008 adds one-client collaboration records without an external account", async () => {
  const migrations = await readFile("server/migrations.ts", "utf8");
  assert.match(migrations, /version: 8/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS matter_client_access/);
  assert.match(migrations, /case_id TEXT NOT NULL UNIQUE REFERENCES cases/);
  assert.match(migrations, /collaboration_requests/);
  assert.match(migrations, /client_responses/);
});

test("Phase 9 portal token routes precede and remain separate from lawyer sessions", async () => {
  const [server, app] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/App.tsx", "utf8"),
  ]);
  assert.ok(server.indexOf('app.get("/api/portal/:token"') < server.indexOf('app.use("/api", requireAuth)'));
  assert.match(server, /portalTokenHash = \(token: string\) => hashSessionToken/);
  assert.match(app, /window\.location\.pathname\.startsWith\("\/client\/"\)/);
  assert.match(app, /<ClientPortalView token=\{portalToken\}/);
});

test("Phase 9 portal SQL allow-lists shared, requested, revision, and client-submission content", async () => {
  const database = await readFile("server/db.ts", "utf8");
  assert.match(database, /ca\.token_hash = \$1 AND ca\.invitation_status = 'Active' AND ca\.revoked_at IS NULL/);
  assert.match(database, /d\.shared_with_client = TRUE OR d\.revision_type = 'Client Revision' OR EXISTS/);
  assert.match(database, /source_type = 'Client Submission'/);
  assert.match(database, /id = ANY\(\$1::text\[\]\) AND case_id = \$2 AND firm_id = \$3/);
  const assistantMethod = database.slice(
    database.indexOf("getPortalAssistantSources"),
    database.indexOf("public async getDocuments", database.indexOf("getPortalAssistantSources"))
  );
  assert.doesNotMatch(assistantMethod, /matter_intelligence|threads|case_documents/);
});

test("Phase 9 Client Assistant prompt disables internal and external research context", async () => {
  const server = await readFile("server.ts", "utf8");
  const start = server.indexOf('app.post("/api/portal/:token/assistant"');
  const end = server.indexOf("// All remaining API routes", start);
  const route = server.slice(start, end);
  assert.match(route, /Answer ONLY from the documents selected below/);
  assert.match(route, /do not imply access to the Firm Library, Matter Intelligence, lawyer conversations/);
  assert.doesNotMatch(route, /googleSearch|CourtListenerAdapter|GovInfoAdapter|vectorSearch/);
});

test("migration 009 adds portal comments while temporary Assistant text remains request-only", async () => {
  const [migrations, portal] = await Promise.all([
    readFile("server/migrations.ts", "utf8"),
    readFile("src/components/ClientPortalView.tsx", "utf8"),
  ]);
  assert.match(migrations, /version: 9/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS portal_comments/);
  assert.doesNotMatch(migrations, /portal_temporary_documents/);
  assert.match(portal, /temporary external document text \(not saved\)/);
  assert.match(portal, /Edit a Copy/);
});
