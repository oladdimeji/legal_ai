import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractGeneratedSubject,
  extractSummaryHeading,
} from "../server/extractGeneratedSubject.js";
import {
  getWorkProductFormatInstructions,
  isWorkProductFormat,
} from "../server/workProductFormat.js";
import { buildWorkProductDraftPrompt } from "../server/workProductDrafting.js";

test("draft formats accept only memo, email, and summary", () => {
  for (const format of ["memo", "email", "summary"]) {
    assert.equal(isWorkProductFormat(format), true);
  }
  for (const format of ["", "letter", "MEMO", null, undefined]) {
    assert.equal(isWorkProductFormat(format), false);
  }
});

test("each draft format receives only its own instructions", () => {
  const memo = getWorkProductFormatInstructions("memo");
  const email = getWorkProductFormatInstructions("email");
  const summary = getWorkProductFormatInstructions("summary");

  assert.match(memo, /Create a legal memorandum/);
  assert.match(memo, /Question Presented/);
  assert.doesNotMatch(memo, /professional legal email|clear legal summary/i);

  assert.match(email, /Create a professional legal email/);
  assert.match(email, /Do not format this as a legal memorandum/);
  assert.match(email, /Do not begin with "LEGAL MEMORANDUM"/);
  assert.doesNotMatch(email, /Create a legal memorandum|Create a clear legal summary/);

  assert.match(summary, /Create a clear legal summary/);
  assert.match(summary, /Do not format this as a legal memorandum/);
  assert.match(summary, /Do not format this as an email/);
  assert.match(summary, /Do not begin with "LEGAL MEMORANDUM"/);
  assert.doesNotMatch(summary, /Create a legal memorandum|Create a professional legal email/);
});

test("generated Subject extraction preserves exact wording and content", () => {
  const samples = [
    "Subject: Review and Advice: Acme Employment Separation Terms",
    "**Subject:** Review and Advice: Acme Employment Separation Terms",
    "### Subject: Review and Advice: Acme Employment Separation Terms",
    "**Subject**: Review and Advice: Acme Employment Separation Terms",
  ];

  for (const content of samples) {
    const original = content;
    assert.equal(
      extractGeneratedSubject(content),
      "Review and Advice: Acme Employment Separation Terms"
    );
    assert.equal(content, original);
  }
});

test("Subject extraction is opening-line scoped and rejects unrelated subject text", () => {
  assert.equal(extractGeneratedSubject("# Summary\n\nSubject matter jurisdiction is disputed."), null);
  assert.equal(
    extractGeneratedSubject(`${Array.from({ length: 41 }, (_, index) => `Line ${index}`).join("\n")}\nSubject: Too late`),
    null
  );
  assert.equal(extractGeneratedSubject("Subject:\nTo: Client"), null);
});

test("Summary heading extraction uses the first meaningful opening heading", () => {
  const content = `# Executive Summary

## **Relationship   Between the Submitted Documents and the Employment Matter**

Analysis remains unchanged.`;
  const original = content;
  assert.equal(
    extractSummaryHeading(content),
    "Relationship Between the Submitted Documents and the Employment Matter"
  );
  assert.equal(content, original);
});

test("Summary heading extraction rejects generic, metadata, deep, and unsafe headings", () => {
  for (const heading of [
    "# Summary",
    "## Legal Summary",
    "# Executive Summary",
    "# Overview",
    "# Introduction",
    "# Background",
    "# Relevant Facts",
    "# Key Facts",
    "# Key Issues",
    "# Legal Issues",
    "# Analysis",
    "# Discussion",
    "# Findings",
    "# Recommendations",
    "# Next Steps",
    "# Conclusion",
    "# Subject: Metadata",
  ]) {
    assert.equal(extractSummaryHeading(heading), null);
  }
  assert.equal(
    extractSummaryHeading("# Legal Summary: Relationship Between the Documents and the Matter"),
    "Legal Summary: Relationship Between the Documents and the Matter"
  );
  assert.equal(
    extractSummaryHeading(`${Array.from({ length: 41 }, (_, index) => `Line ${index}`).join("\n")}\n# Too Deep`),
    null
  );
  assert.equal(extractSummaryHeading(`# ${"Long heading ".repeat(30)}`), null);
});

test("draft creation uses Subject, summary heading, or the unchanged technical fallback", async () => {
  const server = await readFile("server.ts", "utf8");
  assert.match(server, /const cleanedContent = cleanGeneratedWorkProductContent\(draftResult\.text\)/);
  assert.match(server, /const subjectTitle = extractGeneratedSubject\(cleanedContent\)/);
  assert.match(server, /const summaryTitle = format === "summary" && !subjectTitle[\s\S]*?\? extractSummaryHeading\(cleanedContent\)[\s\S]*?: null/);
  assert.match(server, /const fallbackTitle = `Legal \$\{format\.charAt\(0\)\.toUpperCase\(\) \+ format\.slice\(1\)\} - Thread Ref: \$\{thread\.title\.substring\(0, 30\)\}`/);
  assert.match(server, /const title = subjectTitle \|\| summaryTitle \|\| fallbackTitle/);
  assert.match(server, /db\.createDraft\([\s\S]*?title,\s*cleanedContent,\s*requestOwnership/);
  assert.doesNotMatch(server, /matter\.name[\s\S]{0,100}extractSummaryHeading|extractSummaryHeading[\s\S]{0,100}matter\.name/);

  const prompt = buildWorkProductDraftPrompt({
    format: "summary",
    matterMetadata: "Matter name: Example",
    conversationHistory: "USER: Summarize the supplied evidence.",
  });
  assert.match(prompt, /Create a clear legal summary/);
  assert.doesNotMatch(prompt, /extractGeneratedSubject|extractSummaryHeading|summaryTitle/);
  assert.match(server, /const draftPrompt = buildWorkProductDraftPrompt\(\{/);
});

test("historical and custom Work Product titles remain untouched", async () => {
  const [server, editor] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/DraftEditorView.tsx", "utf8"),
  ]);
  assert.match(server, /createManualDraft\(req\.params\.caseId, title, content, ownership\(req\)\)/);
  assert.match(editor, /\{draft\.title\}/);
  assert.doesNotMatch(editor, /draft\.title\.replace\("Legal ", ""\)/);
});

test("Matter Source preview reuses the read-only Work Product presentation", async () => {
  const sources = await readFile("src/components/MatterSources.tsx", "utf8");
  assert.match(sources, /import WorkProductDocument from "\.\/WorkProductDocument"/);
  assert.match(sources, /<WorkProductDocument title=\{preview\.title\} content=\{preview\.extracted_text\} \/>/);
  assert.match(sources, /overflow-y-auto/);
  assert.match(sources, /No extracted content is available for this Source/);

  const preview = sources.slice(sources.indexOf("{preview &&"));
  assert.doesNotMatch(preview, /RichDocumentEditor|Editor|Save|sharing|Export/);
  assert.match(sources, /setPreview\(source\)/);
  assert.match(sources, /method: "DELETE"/);
  assert.match(sources, /method: "POST"/);
});

test("Firm Library preview matches the read-only document presentation", async () => {
  const library = await readFile("src/components/FirmLibraryView.tsx", "utf8");
  assert.match(library, /import WorkProductDocument from "\.\/WorkProductDocument"/);
  assert.match(library, /<WorkProductDocument title=\{preview\.title\} content=\{preview\.extracted_text\} \/>/);
  assert.match(library, /Firm Library · \{preview\.section\}/);
  assert.match(library, /aria-label="Close Firm Library preview"/);
  assert.match(library, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(library, /No extracted content is available for this Firm Library document/);

  const preview = library.slice(library.indexOf("{preview &&"));
  assert.doesNotMatch(preview, /RichDocumentEditor|Editor|Save|sharing|Export/);
});

test("Firm Library contains long labels and filenames without changing its column widths", async () => {
  const [library, styles] = await Promise.all([
    readFile("src/components/FirmLibraryView.tsx", "utf8"),
    readFile("src/index.css", "utf8"),
  ]);

  assert.match(library, /lg:grid-cols-\[220px_minmax\(0,1fr\)_300px\]/);
  assert.match(library, /<aside className="min-w-0/);
  assert.match(library, /<section className="min-w-0 space-y-2">/);
  assert.match(library, /className="min-w-0 flex-1 text-left cursor-pointer"><p className="truncate/);
  assert.match(library, /sections\.map[\s\S]*?\[overflow-wrap:anywhere\]/);
  assert.match(library, /<form onSubmit=\{upload\} className="min-w-0/);
  assert.match(library, /uploadProgress && <p className="\[overflow-wrap:anywhere\]/);
  assert.match(library, /uploadFailures\.map[\s\S]*?className="\[overflow-wrap:anywhere\]/);
  assert.match(library, /<div className="min-w-0">\s*<h3 className="truncate font-semibold">/);
  assert.match(styles, /\.document-title\s*\{[\s\S]*?overflow-wrap: anywhere;/);
});

test("Firm Library upload keeps multi-file selection and sends one file per request without an optional title", async () => {
  const library = await readFile("src/components/FirmLibraryView.tsx", "utf8");
  assert.doesNotMatch(library, /Optional title for one-file upload only/);
  assert.doesNotMatch(library, /\[title, setTitle\]|form\.append\("title"/);
  assert.match(library, /uploadPersistentFilesSequentially/);
  assert.match(library, /form\.append\("files", file\)/);
  assert.doesNotMatch(library, /fileSelection\.files\.forEach\(\(file\) => form\.append\("files", file\)\)/);
  assert.match(library, /FileSourcePicker/);
  assert.match(library, /SelectedFileList/);
  assert.match(library, /setUploadError/);
  assert.match(library, /setUploading/);
  assert.match(library, /Upload and index/);
});
