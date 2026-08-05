import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("formal editors use Tiptap, the canonical codec, table extensions, and real titles", async () => {
  const [editor, extensions, surface, intelligence, shared, portal] = await Promise.all([
    readFile("src/components/RichDocumentEditor.tsx", "utf8"),
    readFile("src/lib/documentEditorExtensions.ts", "utf8"),
    readFile("src/components/DocumentEditorSurface.tsx", "utf8"),
    readFile("src/components/MatterIntelligence.tsx", "utf8"),
    readFile("src/components/ClientSharedMattersView.tsx", "utf8"),
    readFile("src/components/ClientPortalView.tsx", "utf8"),
  ]);
  assert.match(editor, /useEditor/);
  assert.match(editor, /EditorContent/);
  assert.match(editor, /normalizeEditorMarkdown/);
  assert.match(editor, /shouldApplyExternalEditorValue/);
  assert.match(extensions, /TableCell/);
  assert.match(extensions, /TableHeader/);
  assert.match(extensions, /setSelectedTableColumnAlignment/);
  assert.match(surface, /<RichDocumentEditor title=\{title\}/);
  assert.match(intelligence, /title=\{`\$\{matterName\} Matter Intelligence`\}/);
  assert.match(shared, /title=\{editingDraft\.title\}/);
  assert.match(portal, /title=\{editing\.title\}/);
});

test("the formal editor removes lossy browser mechanisms and unsupported persistence", async () => {
  const [editor, codec, packageJson] = await Promise.all([
    readFile("src/components/RichDocumentEditor.tsx", "utf8"),
    readFile("src/lib/documentEditorCodec.ts", "utf8"),
    readFile("package.json", "utf8"),
  ]);
  const combined = `${editor}\n${codec}`;
  assert.doesNotMatch(combined, /document\.execCommand|innerHTML|dangerouslySetInnerHTML|contentEditable|markdownToEditorHtml|editorHtmlToMarkdown/);
  assert.doesNotMatch(packageJson, /@uiw\/react-md-editor|@tiptap\/markdown|@tiptap-pro|collaboration/);
  assert.match(packageJson, /@tiptap\/react/);
  await assert.rejects(readFile("src/lib/richMarkdown.ts", "utf8"));
});

test("chat rendering remains on FormattedMarkdown and the Assistant response editor stays separate", async () => {
  const [assistant, clientAssistant, formatted, formal] = await Promise.all([
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("src/components/ClientAssistantView.tsx", "utf8"),
    readFile("src/components/FormattedMarkdown.tsx", "utf8"),
    readFile("src/components/WorkProductDocument.tsx", "utf8"),
  ]);
  assert.match(assistant, /FormattedMarkdown/);
  assert.match(assistant, /sideEditorContent/);
  assert.match(clientAssistant, /FormattedMarkdown/);
  assert.match(formatted, /react-markdown/);
  assert.doesNotMatch(formal, /FormattedMarkdown/);
});

test("all five DOCX routes continue through the shared facade and migrations remain untouched by Phase 2", async () => {
  const [server, migrations] = await Promise.all([readFile("server.ts", "utf8"), readFile("server/migrations.ts", "utf8")]);
  assert.equal((server.match(/markdownToDocxDocument\(/g) ?? []).length, 5);
  assert.doesNotMatch(migrations, /tiptap|editor_json|document_preview/i);
});

test("requested DOCX controls download same-origin blobs without opening tabs", async () => {
  const [surface, assistant, downloader] = await Promise.all([
    readFile("src/components/DocumentEditorSurface.tsx", "utf8"),
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("src/lib/downloadDocx.ts", "utf8"),
  ]);
  assert.match(surface, /void downloadDocx\(exportUrl\)/);
  assert.match(assistant, /void downloadDocx\(exportUrl\)/);
  assert.doesNotMatch(`${surface}\n${assistant}`, /window\.open\(exportUrl/);
  assert.match(downloader, /fetch\(exportUrl, \{ credentials: "same-origin" \}\)/);
  assert.match(downloader, /if \(!response\.ok\) throw/);
  assert.match(downloader, /Content-Disposition/);
  assert.match(downloader, /anchor\.download = safeDocxFilename/);
  assert.match(downloader, /URL\.revokeObjectURL\(objectUrl\)/);
});
