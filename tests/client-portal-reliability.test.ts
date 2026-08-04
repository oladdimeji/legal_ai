import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cleanClientAssistantContent } from "../server/generatedContentCleanup.js";

test("corrective migration makes response attachment targets nullable alternatives", async () => {
  const migrations = await readFile("server/migrations.ts", "utf8");
  assert.match(migrations, /version: 12/);
  assert.match(migrations, /name: "client_response_attachment_nullable_targets"/);
  assert.match(migrations, /ADD COLUMN IF NOT EXISTS id TEXT/);
  assert.match(migrations, /UPDATE client_response_attachments[\s\S]*md5/);
  assert.match(migrations, /DROP CONSTRAINT IF EXISTS client_response_attachments_pkey/);
  assert.match(migrations, /ALTER COLUMN document_id DROP NOT NULL/);
  assert.match(migrations, /ALTER COLUMN draft_id DROP NOT NULL/);
  assert.match(migrations, /PRIMARY KEY \(id\)/);
  assert.match(migrations, /CHECK \(document_id IS NOT NULL OR draft_id IS NOT NULL\)/);
  assert.match(migrations, /client_response_attachments_response_document_unique/);
  assert.match(migrations, /WHERE document_id IS NOT NULL/);
  assert.match(migrations, /client_response_attachments_response_draft_unique/);
  assert.match(migrations, /WHERE draft_id IS NOT NULL/);
});

test("portal response creation stores uploaded files as private Client Response Work Product", async () => {
  const [server, database, types] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
    readFile("src/types.ts", "utf8"),
  ]);
  assert.match(server, /validatePortalRequest\(tokenHash, req\.params\.requestId\)/);
  assert.match(server, /extractUploads\(\(req\.files \|\| \[\]\) as Express\.Multer\.File\[\]\)/);
  assert.match(server, /cleanWorkProductContent\(file\.text\)/);
  assert.match(database, /BEGIN/);
  assert.match(database, /COMMIT/);
  assert.match(database, /ROLLBACK/);
  assert.match(database, /source_type, origin, processing_state\)/);
  assert.match(database, /'Client Submission', 'Client', 'Processing'/);
  assert.match(database, /`Client Response — \$\{file\.filename\}`/);
  assert.match(database, /'Client Response Upload', 'Client Response'/);
  assert.match(database, /INSERT INTO client_response_attachments\(id, response_id, document_id, draft_id, created_at\)/);
  assert.match(database, /pair\.documentId, pair\.draftId/);
  assert.match(types, /"Client Response"/);
});

test("shared-file responses validate permitted Work Product and avoid duplicate drafts", async () => {
  const [server, database] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
  ]);
  assert.match(server, /parsePortalDraftIds\(req\.body\.draftIds\)/);
  assert.match(server, /Select each Work Product only once/);
  assert.match(server, /getPermittedPortalDraft\(tokenHash, draftId\)/);
  assert.match(server, /type === "Shared files" \? draftIds : \[\]/);
  assert.match(database, /for \(const draft of permittedDrafts\)/);
  assert.match(database, /NULL, \$3, \$4/);
  assert.doesNotMatch(database, /Duplicated Work Product[\s\S]{0,220}createPortalResponse/);
});

test("lawyer collaboration renders response attachments as openable Work Product controls without nested response buttons", async () => {
  const [collaboration, workspace] = await Promise.all([
    readFile("src/components/MatterCollaboration.tsx", "utf8"),
    readFile("src/components/MatterWorkspaceView.tsx", "utf8"),
  ]);
  assert.match(collaboration, /onOpenWorkProduct/);
  assert.match(collaboration, /openAttachment\(response\.id, item\.draft_id, response\.is_read\)/);
  assert.match(collaboration, /Client Response/);
  assert.match(collaboration, /Client Revision/);
  assert.match(collaboration, /Shared Work Product/);
  assert.doesNotMatch(collaboration, /request\.responses\.map\(\(response\) => <button/);
  assert.match(workspace, /collaborationDraftId/);
  assert.match(workspace, /setTab\("Work Product"\)/);
  assert.match(workspace, /initialDraftId=\{initialDraftId \|\| collaborationDraftId\}/);
});

test("Client Portal revision editing already uses RichDocumentEditor and no Markdown source editor", async () => {
  const portal = await readFile("src/components/ClientPortalView.tsx", "utf8");
  assert.match(portal, /Edit a Copy/);
  assert.match(portal, /<RichDocumentEditor title=\{editing\.title\} value=\{editContent\}/);
  assert.doesNotMatch(portal, /MDEditor|@uiw\/react-md-editor|preview="edit"/);
});

test("Client Assistant removes source labels, generated source sections, and disclaimer boilerplate", async () => {
  const dirty = `Here is the answer. [Source: Agreement.pdf]\n\n## Sources\n- Agreement.pdf\n- Policy.docx\n\nThis is not legal advice.`;
  assert.equal(cleanClientAssistantContent(dirty), "Here is the answer.");
  assert.equal(cleanClientAssistantContent("Keep [Section 2], [Exhibit A], and [Reserved]."), "Keep [Section 2], [Exhibit A], and [Reserved].");
  assert.equal(cleanClientAssistantContent("The selected document includes a Disclaimer of Warranties clause."), "The selected document includes a Disclaimer of Warranties clause.");
});

test("Client Assistant prompt and persistence prohibit visible citations while preserving lawyer Assistant citations", async () => {
  const [server, assistant] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/AssistantView.tsx", "utf8"),
  ]);
  const route = server.slice(
    server.indexOf('app.post("/api/portal/:token/assistant"'),
    server.indexOf("// All remaining API routes require a server-validated session.")
  );
  assert.match(route, /do not include source labels, internal source IDs, bracketed source tags, numbered citations/);
  assert.match(route, /cleanClientAssistantContent\(result\.text\)/);
  assert.match(route, /cleanClientAssistantContent\(message\.content\)/);
  assert.doesNotMatch(route, /\[Source: exact title\]|Cite sources as/);
  assert.match(assistant, /assistantCitationsToDisplayText/);
});

test("Client request confirmation displays every returned attachment and preserves failed selections", async () => {
  const portal = await readFile("src/components/ClientPortalView.tsx", "utf8");
  assert.match(portal, /latest\.attachments\?\.length > 0/);
  assert.match(portal, /latest\.attachments\.map/);
  assert.match(portal, /state\.files/);
  assert.match(portal, /setRequestState\(requestId, \{ sending: false, error:/);
  assert.match(portal, /delete next\[requestId\]/);
});
