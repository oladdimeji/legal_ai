import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cleanGeneratedBoilerplate } from "../server/generatedContentCleanup.js";
import { markdownToEditorHtml } from "../src/lib/richMarkdown.js";
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

test("Work Product preview and editor use a fully white document surface", async () => {
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
  assert.match(portal, /<WorkProductDocument content=\{open\.content\}/);
  assert.match(documentSurface, /<article className="min-h-full bg-white/);
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
  assert.match(sharedEditor, /<RichDocumentEditor value=\{content\}/);
  assert.match(portal, /<RichDocumentEditor value=\{editContent\}/);
  for (const source of [`${editor}\n${sharedEditor}`, portal]) {
    assert.doesNotMatch(source, /MDEditor|@uiw\/react-md-editor|preview="edit"|querySelector\("textarea"\)|insertTextMarkup/);
  }
  assert.match(rich, /useLayoutEffect/);
  assert.match(rich, /markdownToEditorHtml\(value\)/);
  assert.match(rich, /contentEditable/);
});

test("Markdown opens as formatted rich-editor HTML", () => {
  const html = markdownToEditorHtml(sampleMarkdown);
  assert.match(html, /<h1>Employment Advice<\/h1>/);
  assert.match(html, /<strong>important<\/strong>/);
  assert.match(html, /<em>time-sensitive<\/em>/);
  assert.match(html, /<ol><li>Review the agreement\.<\/li><li>Preserve all correspondence\.<\/li><\/ol>/);
  assert.match(html, /<ul><li>First supporting point<\/li><li>Second supporting point<\/li><\/ul>/);
  assert.match(html, /<blockquote>This is a quoted provision\.<\/blockquote>/);
  assert.match(html, /<a href="https:\/\/example\.com">the referenced policy<\/a>/);
  assert.doesNotMatch(html, /# Employment Advice|\*\*important\*\*|\[the referenced policy\]\(/);
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
  assert.match(server, /Produce a polished standalone work product/);
  assert.match(server, /Do not include internal source IDs, Assistant citation tokens, numbered source markers, clickable citation syntax, footnotes, endnotes, a references list, or a bibliography/);
  assert.match(server, /Integrate legal authorities naturally into prose/);
  assert.match(server, /cleanGeneratedWorkProductContent\(draftResult\.text\)/);
  assert.doesNotMatch(server, /Carry over all relevant citation references/);
  assert.doesNotMatch(server, /professional disclaimer|standard liability disclaimer/);
});

test("Work Product disclaimer cleanup remains narrow", () => {
  assert.equal(cleanGeneratedBoilerplate("This is not legal advice.\n\n# Memo\nAnalysis."), "# Memo\nAnalysis.");
  assert.equal(cleanGeneratedBoilerplate("# Disclaimer of Warranties\nThe clause is enforceable."), "# Disclaimer of Warranties\nThe clause is enforceable.");
});
