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

test("Phase 12 Matter creation requires only an assignment and supports optional files/library", async () => {
  const [server, matters] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/MattersView.tsx", "utf8"),
  ]);
  assert.match(server, /Matter name and assignment description are required/);
  assert.doesNotMatch(server, /At least one starting input is required|startingNote|startingDocument/);
  assert.match(server, /validateFirmLibraryDocuments/);
  assert.match(server, /upload\.array\("files", MAX_FILE_COUNT\)/);
  assert.match(matters, /Matter name and assignment description are required/);
  assert.doesNotMatch(matters, /Starting instruction|Starting document title|Document text/);
  assert.match(matters, /Optional Firm Library/);
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

test("migration 009 keeps portal comments while Phase 13 removes temporary Assistant text", async () => {
  const [migrations, portal, server] = await Promise.all([
    readFile("server/migrations.ts", "utf8"),
    readFile("src/components/ClientPortalView.tsx", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  assert.match(migrations, /version: 9/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS portal_comments/);
  assert.doesNotMatch(migrations, /portal_temporary_documents/);
  assert.doesNotMatch(portal, /temporary external document text \(not saved\)|temporaryText/);
  assert.doesNotMatch(server, /temporaryText/);
  assert.match(migrations, /portal_chat_messages/);
  assert.match(portal, /Edit a Copy/);
});

test("Phase 10 removes obsolete combined and global Draft surfaces", async () => {
  const [app, sidebar, server] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/components/Sidebar.tsx", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  await assert.rejects(readFile("src/components/WorkspaceView.tsx", "utf8"));
  assert.doesNotMatch(app, /components\/WorkspaceView|components\/DraftsView/);
  assert.doesNotMatch(sidebar, /Wide Library|Drafts & Documents|Workspace & Library/);
  assert.doesNotMatch(server, /app\.get\("\/api\/drafts",/);
  assert.match(server, /app\.get\("\/api\/cases\/:caseId\/work-product"/);
});

test("Phase 10 removes misleading editor and attachment controls", async () => {
  const [assistant, editor] = await Promise.all([
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("src/components/DraftEditorView.tsx", "utf8"),
  ]);
  assert.doesNotMatch(assistant, /Add from Google Drive|Drive cloud OAuth picker|handleAttachMockFile|handleLocalFileUpload|Add from Workspace/);
  assert.match(assistant, /CourtListener Case Law/);
  assert.match(assistant, /GovInfo Legislative Library/);
  assert.doesNotMatch(assistant, /\(Simulated\)/);
  assert.doesNotMatch(editor, /Format Painter|Show Edits|version-selector|V3 \(Current Work Product\)/);
});

test("Phase 11 Assistant keeps sidebar state user-controlled", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  assert.doesNotMatch(app, /setIsSidebarCollapsed\(true\)/);
  assert.match(app, /onMessagesChange=\{\(\) => undefined\}/);
});

test("Phase 11 Improve returns plain editable text", async () => {
  const [server, assistant] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/AssistantView.tsx", "utf8"),
  ]);
  assert.match(server, /sanitizePlainEditableText/);
  assert.match(server, /Do not use Markdown headings, bold, italics, bullet markers/);
  assert.match(assistant, /const \[improving, setImproving\]/);
  assert.match(assistant, /Improving\.\.\./);
});

test("Phase 11 Assistant uses bounded history and persists dynamic follow-ups", async () => {
  const [server, database, migrations, types] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
    readFile("server/migrations.ts", "utf8"),
    readFile("src/types.ts", "utf8"),
  ]);
  assert.match(database, /getRecentMessages/);
  assert.match(server, /Prior conversation for resolving follow-up references only/);
  assert.match(server, /generateFollowUpSuggestions/);
  assert.match(server, /\{ suggestions \}/);
  assert.match(migrations, /version: 10/);
  assert.match(migrations, /assistant_message_metadata/);
  assert.match(types, /metadata\?:/);
});

test("Phase 11 temporary Assistant file sources are extracted and cited without persistence", async () => {
  const [server, assistant, extractor] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("server/fileExtraction.ts", "utf8"),
  ]);
  assert.match(server, /\/api\/extract-files/);
  assert.match(server, /Temporary File Attachment/);
  assert.match(assistant, /temporaryFiles/);
  assert.match(assistant, /accept=".pdf,.docx,.txt/);
  assert.match(extractor, /MAX_FILE_SIZE_BYTES/);
  assert.match(extractor, /OCR is not supported/);
  assert.doesNotMatch(server, /INSERT INTO documents[\s\S]{0,120}temporaryFiles/);
});

test("Phase 11 shared Markdown renderer is used for formatted read-only surfaces", async () => {
  const [renderer, assistant, intelligence] = await Promise.all([
    readFile("src/components/FormattedMarkdown.tsx", "utf8"),
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("src/components/MatterIntelligence.tsx", "utf8"),
  ]);
  assert.match(renderer, /remarkGfm/);
  assert.match(renderer, /blockquote/);
  assert.match(renderer, /table/);
  assert.match(assistant, /<FormattedMarkdown/);
  assert.match(intelligence, /<FormattedMarkdown content=\{content\}/);
  assert.doesNotMatch(intelligence, /whitespace-pre-wrap/);
});

test("Phase 11 Matter Intelligence DOCX export remains Matter-owned", async () => {
  const server = await readFile("server.ts", "utf8");
  assert.match(server, /\/api\/cases\/:caseId\/intelligence\/export/);
  assert.match(server, /db\.getMatterIntelligence\(req\.params\.caseId, ownership\(req\)\)/);
  assert.match(server, /markdownToDocxDocument/);
});

test("Phase 12 Overview suggestions are non-blocking and flagged", async () => {
  const [server, overview] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/MatterOverview.tsx", "utf8"),
  ]);
  assert.match(server, /suggestMatterOverview/);
  assert.match(server, /Matter Overview suggestion failed/);
  assert.match(server, /matter_type_suggested: Boolean/);
  assert.match(overview, /Edit Overview/);
  assert.match(overview, /Cancel/);
  assert.match(overview, /Suggested/);
});

test("Phase 12 Firm Library and Matter Source uploads use real file pickers", async () => {
  const [library, sources, server] = await Promise.all([
    readFile("src/components/FirmLibraryView.tsx", "utf8"),
    readFile("src/components/MatterSources.tsx", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  assert.match(library, /Choose PDF, DOCX, or TXT/);
  assert.doesNotMatch(library, /Paste extracted document text/);
  assert.match(sources, /Choose PDF, DOCX, or TXT/);
  assert.match(sources, /Write Source note/);
  assert.match(server, /app\.post\("\/api\/documents", upload\.array\("files", 1\)/);
  assert.match(server, /app\.post\("\/api\/cases\/:id\/sources", upload\.array\("files", 1\)/);
});

test("Phase 12 Work Product uses formatted preview/editor and sharing progress", async () => {
  const editor = await readFile("src/components/DraftEditorView.tsx", "utf8");
  assert.match(editor, /@uiw\/react-md-editor/);
  assert.match(editor, /<FormattedMarkdown content=\{content\}/);
  assert.match(editor, /Sharing\.\.\./);
  assert.match(editor, /Stopping\.\.\./);
  assert.match(editor, /disabled:cursor-not-allowed/);
});

test("Phase 12 generated draft prompt uses actual Matter account and date metadata", async () => {
  const server = await readFile("server.ts", "utf8");
  assert.match(server, /Matter and account metadata/);
  assert.match(server, /Lawyer name:/);
  assert.match(server, /Firm name:/);
  assert.match(server, /Current date:/);
  assert.match(server, /Do not emit bracketed placeholders/);
});

test("Phase 13 Collaboration empty state hides normal sections until collaborator exists", async () => {
  const view = await readFile("src/components/MatterCollaboration.tsx", "utf8");
  assert.match(view, /Create Collaborator & Invite/);
  assert.match(view, /if \(!data\.access\)/);
  const emptyBlock = view.slice(view.indexOf("if (!data.access)"), view.indexOf("return (", view.indexOf("return (") + 1));
  assert.doesNotMatch(emptyBlock, /Shared Documents|Requests and Responses|Send Request/);
});

test("Phase 13 invite copy rotates token and remains hash-only", async () => {
  const [server, database, view] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
    readFile("src/components/MatterCollaboration.tsx", "utf8"),
  ]);
  assert.match(server, /const \{ token, tokenHash \} = createSessionToken\(\)/);
  assert.match(server, /activateClientInvite\(req\.params\.caseId, tokenHash/);
  assert.match(database, /SET token_hash = \$1, invitation_status = 'Active'/);
  assert.doesNotMatch(database, /RETURNING[\s\S]{0,100}\btoken\b(?!_hash)/);
  assert.match(view, /Fresh invite link copied\. Older links are now invalid\./);
  assert.match(view, /rotateAndCopyInvite/);
});

test("Phase 13 lawyer request instruction is optional and document selection remains required", async () => {
  const [server, database, view] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
    readFile("src/components/MatterCollaboration.tsx", "utf8"),
  ]);
  assert.doesNotMatch(server, /Request instruction is required/);
  assert.match(database, /Select at least one Work Product document/);
  assert.match(view, /Optional comment or instruction/);
  assert.match(view, /draftIds\.length === 0/);
  assert.match(view, /Sending\.\.\./);
});

test("Phase 13 client responses are per-request with four approved options", async () => {
  const [portal, server] = await Promise.all([
    readFile("src/components/ClientPortalView.tsx", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  assert.match(portal, /Record<string, ResponseState>/);
  assert.match(portal, /requestState\(requestId/);
  assert.match(portal, /const responseOptions = \["Acknowledgement", "Comment", "Upload files", "Shared files"\]/);
  assert.doesNotMatch(portal, /Written Answer|Existing Portal Document|Client Revision as/);
  assert.match(server, /new Set\(\["Acknowledgement", "Comment", "Upload files", "Shared files"\]\)/);
});

test("Phase 13 portal uploads and response attachments are token and Matter scoped", async () => {
  const [server, database, migrations] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
    readFile("server/migrations.ts", "utf8"),
  ]);
  assert.match(server, /app\.post\("\/api\/portal\/:token\/documents", upload\.array\("files", MAX_FILE_COUNT\)/);
  assert.match(server, /extractUploads\(\(req\.files \|\| \[\]\) as Express\.Multer\.File\[\]\)/);
  assert.match(database, /uploadPortalDocument\(tokenHash/);
  assert.match(database, /resolvePortalAccess\(tokenHash\)/);
  assert.match(database, /case_id = \$2 AND firm_id = \$3[\s\S]*source_type = 'Client Submission'/);
  assert.match(migrations, /client_response_attachments/);
});

test("Phase 13 Client Revisions appear in shared lists and originals remain preserved", async () => {
  const [database, portal] = await Promise.all([
    readFile("server/db.ts", "utf8"),
    readFile("src/components/ClientPortalView.tsx", "utf8"),
  ]);
  assert.match(database, /shared_with_client = TRUE OR revision_type = 'Client Revision'/);
  assert.match(database, /parent_draft_id, revision_type/);
  assert.doesNotMatch(database, /UPDATE drafts[\s\S]{0,160}Client Revision/);
  assert.match(portal, /Client Revision/);
  assert.match(portal, /await load\(\)/);
});

test("Phase 13 requests sort unanswered first and update only the responded request", async () => {
  const database = await readFile("server/db.ts", "utf8");
  assert.match(database, /ORDER BY CASE WHEN COUNT\(r\.id\) = 0 THEN 0 ELSE 1 END ASC/);
  assert.match(database, /COALESCE\(MAX\(r\.created_at\), cr\.created_at\) DESC/);
  assert.match(database, /UPDATE collaboration_requests SET status = 'Responded', updated_at = \$1 WHERE id = \$2 AND case_id = \$3/);
});

test("Phase 13 request and response document titles are visible", async () => {
  const [database, lawyer, portal] = await Promise.all([
    readFile("server/db.ts", "utf8"),
    readFile("src/components/MatterCollaboration.tsx", "utf8"),
    readFile("src/components/ClientPortalView.tsx", "utf8"),
  ]);
  assert.match(database, /document_title/);
  assert.match(database, /draft_title/);
  assert.match(lawyer, /request\.documents\.map/);
  assert.match(lawyer, /response\.attachments\.map/);
  assert.match(portal, /request\.documents\.map/);
});

test("Phase 13 Client Assistant persists history and uses formatted Markdown", async () => {
  const [server, database, portal, migrations] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
    readFile("src/components/ClientPortalView.tsx", "utf8"),
    readFile("server/migrations.ts", "utf8"),
  ]);
  assert.match(migrations, /portal_chat_messages/);
  assert.match(database, /getPortalChatMessages/);
  assert.match(database, /addPortalChatMessage/);
  assert.match(server, /Prior assistant conversation is only for resolving follow-up references/);
  assert.match(server, /PRIOR CHAT:/);
  assert.match(portal, /chatMessages/);
  assert.match(portal, /<FormattedMarkdown content=\{message\.content\}/);
});

test("Phase 13 private foreign content and revoked portal access remain denied", async () => {
  const [database, server] = await Promise.all([
    readFile("server/db.ts", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  const portalAssistantRoute = server.slice(
    server.indexOf('app.post("/api/portal/:token/assistant"'),
    server.indexOf('app.post("/api/threads"', server.indexOf('app.post("/api/portal/:token/assistant"'))
  );
  assert.match(database, /ca\.token_hash = \$1 AND ca\.invitation_status = 'Active' AND ca\.revoked_at IS NULL/);
  assert.match(database, /getPermittedPortalDraft\(tokenHash, draftId\)/);
  assert.match(database, /Selected Work Product is not available in this Client Portal/);
  assert.match(portalAssistantRoute, /Client Portal access is unavailable/);
  assert.doesNotMatch(portalAssistantRoute, /CourtListenerAdapter|GovInfoAdapter|googleSearch: true/);
});

test("Phase 10 preserves SQL-before-ranking and direct-ID ownership guards", async () => {
  const database = await readFile("server/db.ts", "utf8");
  assert.match(database, /d\.firm_id = \$2\s+AND d\.case_id IS NULL[\s\S]{0,500}ORDER BY dc\.embedding <=> \$1/);
  assert.match(database, /c\.id = \$3 AND c\.firm_id = \$2[\s\S]{0,900}ORDER BY dc\.embedding <=> \$1/);
  assert.match(database, /t\.id = \$1 AND t\.user_id = \$2[\s\S]{0,250}c\.firm_id = \$3/);
  assert.match(database, /d\.id = \$1 AND d\.case_id = \$2 AND c\.firm_id = \$3/);
  assert.match(database, /ca\.token_hash = \$1 AND ca\.invitation_status = 'Active' AND ca\.revoked_at IS NULL/);
});
