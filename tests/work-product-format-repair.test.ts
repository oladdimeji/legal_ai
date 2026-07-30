import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractGeneratedSubject } from "../server/extractGeneratedSubject.js";
import {
  getWorkProductFormatInstructions,
  isWorkProductFormat,
} from "../server/workProductFormat.js";

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

test("draft creation uses cleaned content Subject or the unchanged technical fallback", async () => {
  const server = await readFile("server.ts", "utf8");
  assert.match(server, /const cleanedContent = cleanGeneratedWorkProductContent\(draftResult\.text\)/);
  assert.match(server, /const fallbackTitle = `Legal \$\{format\.charAt\(0\)\.toUpperCase\(\) \+ format\.slice\(1\)\} - Thread Ref: \$\{thread\.title\.substring\(0, 30\)\}`/);
  assert.match(server, /const title = extractGeneratedSubject\(cleanedContent\) \|\| fallbackTitle/);
  assert.match(server, /db\.createDraft\([\s\S]*?title,\s*cleanedContent,\s*requestOwnership/);
  assert.doesNotMatch(server, /matter\.name[\s\S]{0,100}extractGeneratedSubject|extractGeneratedSubject[\s\S]{0,100}matter\.name/);
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
  assert.match(sources, /<WorkProductDocument content=\{preview\.extracted_text\} \/>/);
  assert.match(sources, /overflow-y-auto/);
  assert.match(sources, /No extracted content is available for this Source/);

  const preview = sources.slice(sources.indexOf("{preview &&"));
  assert.doesNotMatch(preview, /RichDocumentEditor|Editor|Save|sharing|Export/);
  assert.match(sources, /setPreview\(source\)/);
  assert.match(sources, /method: "DELETE"/);
  assert.match(sources, /method: "POST"/);
});
