import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Packer } from "docx";
import {
  buildAssistantDraftPrompt,
  titleForAssistantDraft,
} from "../server/assistantDrafting.js";
import { markdownToDocxDocument } from "../server/docxMarkdown.js";
import { parseRoute, routePath } from "../src/lib/routes.js";
import type { WorkspacePageContext } from "../src/types.js";

const generalContext: WorkspacePageContext = {
  routeKind: "history",
  pageTitle: "History",
};

test("autonomous drafting accepts arbitrary standalone document types", () => {
  const prompt = buildAssistantDraftPrompt({
    instruction: "Draft an asset purchase agreement",
    pageContext: generalContext,
    conversationContext: "",
    authorizedEvidence: "",
    accountMetadata: "Firm name: Example LLP",
    currentDate: "August 3, 2026",
    publicWebResearch: "",
    webResearchPerformed: false,
    depth: "standard",
  });
  assert.match(prompt, /contract, agreement, letter, brief, report, policy, summary, email, memorandum/);
  assert.match(prompt, /Do not restrict the output to a fixed format list/);
  assert.match(prompt, /exactly one polished standalone document/);
  assert.match(prompt, /Do not emit internal \[cit_\*\] tokens/);
  assert.doesNotMatch(prompt, /Format must be memo, email, or summary/);
  assert.equal(titleForAssistantDraft("# Mutual Non-Disclosure Agreement\n\nTerms", "Draft an NDA", "New"), "Mutual Non-Disclosure Agreement");
});

test("autonomous drafting completes appropriate attachments without forcing or fabricating them", () => {
  const prompt = buildAssistantDraftPrompt({
    instruction: "Draft a services agreement",
    pageContext: generalContext,
    conversationContext: "",
    authorizedEvidence: "",
    accountMetadata: "Firm name: Example LLP",
    currentDate: "August 7, 2026",
    publicWebResearch: "",
    webResearchPerformed: false,
    depth: "standard",
  });

  assert.match(prompt, /Exhibits, schedules, annexes, and appendices/);
  assert.match(prompt, /Do not add attachments automatically to every draft/);
  assert.match(prompt, /avoid unresolved attachment references/);
  assert.match(prompt, /never invent Matter facts or evidentiary material/);
  assert.match(prompt, /mark it for lawyer completion rather than fabricating it/);
  assert.match(prompt, /Do not add attachments where they are not appropriate or useful/);
});

test("unified composer removes Draft controls and renders autonomous document cards", async () => {
  const assistant = await readFile("src/components/AssistantView.tsx", "utf8");
  assert.doesNotMatch(assistant, /draft-mode-toggle|draftMode|responseMode|Create Draft/);
  assert.match(assistant, /id="btn-submit-send"/);
  assert.match(assistant, /metadata\?\.document/);
  assert.match(assistant, /assistant-document-card/);
  assert.match(assistant, /Download \.docx/);
  assert.doesNotMatch(assistant, /action-draft-|drafting-modal|draftFormat|Drafting Format Style|Generate Draft/);
});

test("lawyer Assistant response actions lazily reuse one private document per message", async () => {
  const [assistant, database, server] = await Promise.all([
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("server/db.ts", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  assert.match(assistant, /if \(existingDocument\) return existingDocument/);
  assert.match(assistant, /action-open-\$\{m\.id\}/);
  assert.match(assistant, /action-download-\$\{m\.id\}/);
  assert.match(assistant, /await downloadDocx\(documentExportUrl\(document\)\)/);
  assert.match(database, /assistant_response_\$\{messageId\}/);
  assert.match(database, /m\.role = 'assistant'/);
  assert.match(database, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(server, /app\.post\("\/api\/messages\/:id\/assistant-document"/);
  assert.match(server, /getOrCreateAssistantDocumentForMessage/);
});

test("autonomous document destination follows the current page rather than thread origin", async () => {
  const deliverables = await readFile("server/assistant/assistantDeliverables.ts", "utf8");
  assert.doesNotMatch(deliverables, /thread\.case_id/);
  assert.match(deliverables, /input\.currentMatter && input\.pageContext\.routeKind === "matter"/);
  assert.match(deliverables, /database\.createDraft\(/);
  assert.match(deliverables, /database\.createAssistantDocument\(/);
  assert.match(deliverables, /kind: "matterWorkProduct"/);
  assert.match(deliverables, /kind: "assistantDocument"/);
  assert.match(deliverables, /cleanGeneratedWorkProductContent\(result\.text\)/);
});

test("standalone assistant-document migration is additive and preserves documents on thread deletion", async () => {
  const migrations = await readFile("server/migrations.ts", "utf8");
  const migration = migrations.slice(migrations.indexOf("version: 23"));
  assert.match(migration, /CREATE TABLE IF NOT EXISTS assistant_documents/);
  assert.match(migration, /thread_id TEXT REFERENCES threads\(id\) ON DELETE SET NULL/);
  assert.match(migration, /user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /firm_id TEXT NOT NULL REFERENCES firm\(id\) ON DELETE CASCADE/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS assistant_documents_owner_updated_idx/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS assistant_documents_thread_idx/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE/);
});

test("standalone fetch, update, selected-context, and export require both user and firm ownership", async () => {
  const [database, server] = await Promise.all([
    readFile("server/db.ts", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  const databaseMethods = database.slice(database.indexOf("public async createAssistantDocument"));
  assert.match(databaseMethods, /t\.user_id = \$3[\s\S]*u\.firm_id = \$4[\s\S]*t\.scope <> 'client'/);
  assert.doesNotMatch(databaseMethods.slice(0, databaseMethods.indexOf("public async getAssistantDocumentById")), /t\.case_id IS NULL\s+AND t\.scope/);
  assert.match(databaseMethods, /WHERE id = \$1 AND user_id = \$2 AND firm_id = \$3/);
  assert.match(databaseMethods, /WHERE id = \$4 AND user_id = \$5 AND firm_id = \$6/);

  const fetchRoute = server.slice(
    server.indexOf('app.get("/api/assistant-documents/:id"'),
    server.indexOf('app.put("/api/assistant-documents/:id"')
  );
  const exportRoute = server.slice(
    server.indexOf('app.get("/api/assistant-documents/:id/export"'),
    server.indexOf('app.get("/api/cases/:caseId/work-product"')
  );
  assert.match(fetchRoute, /getAssistantDocumentById\(req\.params\.id, ownership\(req\)\)/);
  assert.match(exportRoute, /getAssistantDocumentById\(req\.params\.id, ownership\(req\)\)/);
  assert.match(server, /getAssistantDocumentById\(selectedItem\.id, requestOwnership\)/);
});

test("standalone document route uses the shared rich editor while the lawyer assistant remains mounted", async () => {
  const [app, view, sharedEditor, routeSource] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/components/AssistantDocumentView.tsx", "utf8"),
    readFile("src/components/DocumentEditorSurface.tsx", "utf8"),
    readFile("server/siteLock.ts", "utf8"),
  ]);
  assert.deepEqual(parseRoute("/documents/assistant_document_123"), {
    kind: "assistantDocument",
    documentId: "assistant_document_123",
  });
  assert.equal(routePath({ kind: "assistantDocument", documentId: "doc/a" }), "/documents/doc%2Fa");
  assert.match(app, /<LawyerWorkspaceShell[\s\S]*<AssistantView[\s\S]*<AssistantDocumentView/);
  assert.match(view, /routeKind: "assistantDocument"/);
  assert.match(view, /DocumentEditorSurface/);
  assert.match(sharedEditor, /RichDocumentEditor/);
  assert.match(sharedEditor, /WorkProductDocument/);
  assert.match(routeSource, /path\.startsWith\("\/documents\/"\)/);
});

test("Matter and standalone document export paths produce genuine DOCX packages", async () => {
  const server = await readFile("server.ts", "utf8");
  const buffer = await Packer.toBuffer(markdownToDocxDocument("Advice Letter", "# Advice\n\n**Proceed carefully.**"));
  assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
  assert.ok(buffer.length > 1000);
  assert.match(server, /markdownToDocxDocument\(draft\.title, cleanWorkProductContent\(draft\.content\)\)/);
  assert.match(server, /markdownToDocxDocument\(document\.title, cleanWorkProductContent\(document\.content\)\)/);
  assert.equal((server.match(/application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/g) || []).length >= 2, true);
});

test("standalone assistant documents are private and are not added to Firm Library or client sharing", async () => {
  const [view, deliverables, database] = await Promise.all([
    readFile("src/components/AssistantDocumentView.tsx", "utf8"),
    readFile("server/assistant/assistantDeliverables.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
  ]);
  assert.doesNotMatch(deliverables, /uploadDocument|linkLibraryDocument|setDraftSharing/);
  assert.doesNotMatch(view, /Share with client|Firm Library/);
  assert.match(database, /INSERT INTO assistant_documents/);
  assert.doesNotMatch(database.slice(database.indexOf("public async createAssistantDocument")), /INSERT INTO documents/);
});
