import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cleanGeneratedBoilerplate } from "../server/generatedContentCleanup.js";
import { buildWorkProductDraftPrompt } from "../server/workProductDrafting.js";
import { editorJsonToMarkdown, markdownToEditorDocument } from "../src/lib/documentEditorCodec.js";
import { stripInternalCitationsForWorkProduct } from "../src/lib/assistantCitations.js";

const sampleMarkdown = `# Employment Advice

This is **important** and *time-sensitive*.

## Recommended Actions

1. Review the agreement.
2. Preserve all correspondence.

- First supporting point
- Second supporting point

> This is a quoted provision.

See [the referenced policy](https://example.com).`;

test("Work Product preview uses canonical Letter paper while editor remains on its document surface", async () => {
  const [editor, sharedEditor, portal, documentSurface] = await Promise.all([
    readFile("src/components/DraftEditorView.tsx", "utf8"),
    readFile("src/components/DocumentEditorSurface.tsx", "utf8"),
    readFile("src/components/ClientPortalView.tsx", "utf8"),
    readFile("src/components/WorkProductDocument.tsx", "utf8"),
  ]);
  assert.match(editor, /DocumentEditorSurface/);
  assert.match(sharedEditor, /id=\{idPrefix === "editor" \? "work-product-document-scroll"/);
  assert.match(sharedEditor, /id=\{idPrefix === "editor" \? "paper-layout"/);
  assert.doesNotMatch(`${editor}\n${sharedEditor}`, /bg-zinc-100 p-12/);
  assert.match(portal, /min-h-0 flex-1 overflow-y-auto bg-white/);
  assert.match(portal, /<WorkProductDocument title=\{open\.title\} content=\{open\.content\}/);
  assert.match(documentSurface, /DocumentPreview title=\{title\} content=\{content\}/);
  const preview = await readFile("src/components/document/DocumentPreview.tsx", "utf8");
  assert.match(preview, /compileDocument/);
});

test("Work Product title wraps and actions render in a separate toolbar row", async () => {
  const [editor, sharedEditor] = await Promise.all([
    readFile("src/components/DraftEditorView.tsx", "utf8"),
    readFile("src/components/DocumentEditorSurface.tsx", "utf8"),
  ]);
  assert.match(sharedEditor, /whitespace-normal break-words/);
  assert.doesNotMatch(sharedEditor, /<h2 className="truncate/);
  assert.match(sharedEditor, /<div className="mt-3 flex flex-wrap items-center gap-3">/);
  const combined = `${editor}\n${sharedEditor}`;
  for (const label of ["Duplicate", "Share with client", "Editor", "Preview", "Save", "Download .docx"]) {
    assert.match(combined, new RegExp(label.replace(".", "\\.")));
  }
});

test("Work Product edit paths use the repaired rich editor and no Markdown source editor", async () => {
  const [editor, sharedEditor, portal, rich] = await Promise.all([
    readFile("src/components/DraftEditorView.tsx", "utf8"),
    readFile("src/components/DocumentEditorSurface.tsx", "utf8"),
    readFile("src/components/ClientPortalView.tsx", "utf8"),
    readFile("src/components/RichDocumentEditor.tsx", "utf8"),
  ]);
  assert.match(editor, /DocumentEditorSurface/);
  assert.match(sharedEditor, /<RichDocumentEditor title=\{title\} value=\{content\}/);
  assert.match(portal, /<RichDocumentEditor title=\{editing\.title\} value=\{editContent\}/);
  for (const source of [`${editor}\n${sharedEditor}`, portal]) {
    assert.doesNotMatch(source, /MDEditor|@uiw\/react-md-editor|preview="edit"|querySelector\("textarea"\)|insertTextMarkup/);
  }
  assert.match(rich, /useEditor/);
  assert.match(rich, /EditorContent/);
  assert.match(rich, /normalizeEditorMarkdown/);
  assert.doesNotMatch(rich, /useLayoutEffect|innerHTML|contentEditable|document\.execCommand/);
});

test("first successful client share introduces Matter Collaboration once", async () => {
  const [editor, workspace, landing] = await Promise.all([
    readFile("src/components/DraftEditorView.tsx", "utf8"),
    readFile("src/components/MatterWorkspaceView.tsx", "utf8"),
    readFile("src/components/LandingPage.tsx", "utf8"),
  ]);
  assert.doesNotMatch(landing, /Request a Demo/);
  assert.equal(landing.match(/Request Access/g)?.length, 3);
  assert.match(editor, /if \(nextShared\) onShareWithClientSuccess\?\.\(\);/);
  assert.match(workspace, /exepts:collaboration-introduced:\$\{matter\.id\}/);
  assert.match(workspace, /if \(window\.localStorage\.getItem\(markerKey\)\) return;/);
  assert.match(workspace, /window\.localStorage\.setItem\(markerKey, "true"\);\s+setTab\("Collaboration"\);/);
});

test("Markdown opens as a structured editor document and serializes back to Markdown", () => {
  const document = markdownToEditorDocument("Employment Advice", sampleMarkdown);
  assert.equal(document.type, "doc");
  assert.ok(document.content?.some((node) => node.type === "heading"));
  assert.ok(document.content?.some((node) => node.type === "orderedList"));
  assert.ok(document.content?.some((node) => node.type === "bulletList"));
  assert.ok(document.content?.some((node) => node.type === "blockquote"));
  const markdown = editorJsonToMarkdown(document);
  assert.match(markdown, /\*\*important\*\*/);
  assert.match(markdown, /\[the referenced policy\]\(https:\/\/example\.com\)/);
});

test("Work Product internal citation stripper is narrow and idempotent", () => {
  const dirty = "Analysis [cit_1][CIT_2] and grouped [cit-3, cit 4]. Footnote [1], ordinary [Exhibit A], [Section 2], 410 U.S. 113, and 12 U.S.C. § 5511 remain.";
  const cleaned = stripInternalCitationsForWorkProduct(dirty);
  assert.equal(cleaned, "Analysis and grouped. Footnote [1], ordinary [Exhibit A], [Section 2], 410 U.S. 113, and 12 U.S.C. § 5511 remain.");
  assert.equal(stripInternalCitationsForWorkProduct(cleaned), cleaned);
  assert.equal(stripInternalCitationsForWorkProduct("Generated source marker [1].", { stripNumberedMarkers: true }), "Generated source marker.");
});

test("Work Product routes clean historical content, duplication, revisions, and DOCX export", async () => {
  const server = await readFile("server.ts", "utf8");
  assert.match(server, /cleanWorkProductContent\(draft\.content\)/);
  assert.match(server, /drafts\.map\(\(draft\) => \(\{ \.\.\.draft, content: cleanWorkProductContent\(draft\.content\) \}\)\)/);
  assert.match(server, /db\.updateDraft\(duplicate\.id, caseId, cleaned/);
  assert.match(server, /createClientRevision\(req\.params\.id, caseId, content/);
  assert.match(server, /createPortalClientRevision\([\s\S]{0,120}content/);
  assert.match(server, /markdownToDocxDocument\(draft\.title, cleanWorkProductContent\(draft\.content\)\)/);
});

test("Work Product generation asks for standalone deliverables without automatic references", async () => {
  const server = await readFile("server.ts", "utf8");
  const prompt = buildWorkProductDraftPrompt({
    format: "memo",
    matterMetadata: "Matter name: Example",
    conversationHistory: "USER: Draft the requested memorandum.",
  });
  assert.match(prompt, /Produce a polished standalone work product/);
  assert.match(prompt, /Do not include internal source IDs, Assistant citation tokens, numbered source markers, clickable citation syntax, footnotes, endnotes, a references list, or a bibliography/);
  assert.match(prompt, /Integrate legal authorities naturally into prose/);
  assert.match(server, /cleanGeneratedWorkProductContent\(draftResult\.text\)/);
  assert.doesNotMatch(server, /Carry over all relevant citation references/);
  assert.doesNotMatch(server, /professional disclaimer|standard liability disclaimer/);
});

test("Work Product disclaimer cleanup remains narrow", () => {
  assert.equal(cleanGeneratedBoilerplate("This is not legal advice.\n\n# Memo\nAnalysis."), "# Memo\nAnalysis.");
  assert.equal(cleanGeneratedBoilerplate("# Disclaimer of Warranties\nThe clause is enforceable."), "# Disclaimer of Warranties\nThe clause is enforceable.");
});
