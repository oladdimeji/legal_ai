import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WorkProductDocument from "../src/components/WorkProductDocument.js";

const render = (title: string, content: string) => renderToStaticMarkup(React.createElement(WorkProductDocument, { title, content }));

test("formal preview renders its normalized title once and every semantic heading level", () => {
  const html = render("Legal Memo", "# Legal Memo\n\n# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six");
  assert.equal((html.match(/Legal Memo/g) ?? []).length, 2, "title occurs in aria label and visible title only");
  assert.equal((html.match(/class=\"document-title\"/g) ?? []).length, 1);
  for (let level = 1; level <= 6; level += 1) assert.match(html, new RegExp(`<h${level}[^>]*>${["One", "Two", "Three", "Four", "Five", "Six"][level - 1]}</h${level}>`));
});

test("formal preview preserves hard breaks, secure links, combined marks, and ordered starts", () => {
  const html = render("Formatting", "First line  \nSecond line with [safe](https://example.com) and [unsafe](javascript:alert(1)).\n\n7. **_Item_**\n8. Next");
  assert.match(html, /First line<br\/>Second line/);
  assert.match(html, /href=\"https:\/\/example.com\" target=\"_blank\" rel=\"noopener noreferrer\"/);
  assert.doesNotMatch(html, /href=\"javascript:/);
  assert.match(html, /<ol start=\"7\">/);
  assert.match(html, /<strong><em>Item<\/em><\/strong>/);
});

test("formal preview renders nested lists and canonical table structure and alignment", () => {
  const html = render("Structure", "- Parent\n  1. Child\n     - Grandchild\n\n| Term | Explanation | Amount |\n|:---|:---:|---:|\n| Fee | Detailed explanatory prose for the fee | 1200 |");
  assert.match(html, /<ul><li>Parent<ol start=\"1\"><li value=\"1\">Child<ul>/);
  assert.match(html, /<table[^>]*>/);
  assert.match(html, /<colgroup>/);
  assert.match(html, /<thead>/);
  assert.match(html, /<tbody>/);
  assert.match(html, /document-table-align-right/);
  const widths = [...html.matchAll(/<col style=\"width:([^%]+)%\"\/>/g)].map((match) => Number(match[1]));
  assert.equal(widths.reduce((sum, value) => sum + value, 0), 100);
  assert.ok(new Set(widths).size > 1);
});

test("signature and wide tables use canonical classifications and paper orientations", async () => {
  const signature = render("Agreement", await readFile("tests/fixtures/docx/signature-agreement.md", "utf8"));
  assert.match(signature, /document-table-signature/);
  assert.match(signature, /data-signature-layout=\"true\"/);
  assert.doesNotMatch(signature, /<thead>/);
  const wide = render("Wide", await readFile("tests/fixtures/docx/wide-table.md", "utf8"));
  assert.match(wide, /document-paper-landscape/);
  const concise = render("Concise", await readFile("tests/fixtures/docx/concise-multicolumn.md", "utf8"));
  assert.doesNotMatch(concise, /document-paper-landscape/);
});

test("malformed table fallback is readable and code blocks preserve newlines", () => {
  const html = render("Fallback", "| Issue | Analysis |\n|---|---|---|\n| Termination | Notice is required |\n\n```ts\nconst one = 1;\nconst two = 2;\n```");
  assert.doesNotMatch(html, /\|---/);
  assert.match(html, /Issue/);
  assert.match(html, /Termination/);
  assert.match(html, /const one = 1;\nconst two = 2;/);
});

test("formal preview source uses only the canonical compiler while chat retains FormattedMarkdown", async () => {
  const preview = await readFile("src/components/document/DocumentPreview.tsx", "utf8");
  const facade = await readFile("src/components/WorkProductDocument.tsx", "utf8");
  const assistant = await readFile("src/components/AssistantView.tsx", "utf8");
  const clientAssistant = await readFile("src/components/ClientAssistantView.tsx", "utf8");
  assert.match(preview, /compileDocument/);
  assert.doesNotMatch(preview, /react-markdown|remark-gfm|dangerouslySetInnerHTML/);
  assert.doesNotMatch(facade, /FormattedMarkdown/);
  assert.match(assistant, /FormattedMarkdown/);
  assert.match(clientAssistant, /FormattedMarkdown/);
});
