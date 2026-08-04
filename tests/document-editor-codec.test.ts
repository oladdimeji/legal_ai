import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import type { JSONContent } from "@tiptap/core";
import { compileDocument } from "../shared/document/compileDocument.js";
import { inlinePlainText } from "../shared/document/parseDocument.js";
import type { DocumentBlock, InlineContent } from "../shared/document/documentTypes.js";
import {
  compiledDocumentToEditorJson, editorJsonToMarkdown, markdownToEditorDocument,
  setTableColumnAlignmentInJson, shouldApplyExternalEditorValue,
} from "../src/lib/documentEditorCodec.js";

function inlineProjection(content: InlineContent[]): unknown[] {
  return content.map((node) => node.type === "hardBreak" ? ["break"] : node.type === "hyperlink" ? ["link", node.url, inlineProjection(node.content)] : ["text", node.text, !!node.bold, !!node.italic, !!node.underline, !!node.code]);
}

function blockProjection(block: DocumentBlock): unknown {
  switch (block.type) {
    case "heading": return [block.type, block.level, block.text, inlineProjection(block.content), !!block.pageBreakBefore];
    case "paragraph": return [block.type, inlineProjection(block.content), !!block.pageBreakBefore];
    case "orderedList":
    case "unorderedList": return [block.type, block.type === "orderedList" ? block.start : null, block.items.map((item) => [item.level, item.ordered, item.marker ?? null, inlineProjection(item.content)])];
    case "blockquote": return [block.type, inlineProjection(block.content)];
    case "codeBlock": return [block.type, block.language ?? null, block.text];
    case "pageBreak": return [block.type];
    case "table": return [block.type, block.headerRows, block.rows.map((row) => row.cells.map(inlineProjection)), block.columns.map((column) => [column.alignment, column.kind]), block.layout, block.orientation, block.signatureLayout];
  }
}

function semanticProjection(title: string, markdown: string): unknown[] {
  return compileDocument(title, markdown).blocks.map(blockProjection);
}

function roundTrip(title: string, markdown: string): string {
  return editorJsonToMarkdown(compiledDocumentToEditorJson(compileDocument(title, markdown)));
}

test("all Phase 1 fixtures survive the canonical editor round trip semantically", async () => {
  const fixtures = (await readdir("tests/fixtures/docx")).filter((name) => name.endsWith(".md"));
  for (const name of fixtures) {
    const markdown = await readFile(`tests/fixtures/docx/${name}`, "utf8");
    const title = name.replace(/\.md$/, "");
    assert.deepEqual(semanticProjection(title, roundTrip(title, markdown)), semanticProjection(title, markdown), name);
  }
});

test("H1-H6, combined marks, links, hard breaks, and unsafe links serialize deterministically", () => {
  const markdown = "# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\n**_<u>[Marked](https://example.com)</u>_** and [unsafe](javascript:alert(1))  \nnext";
  const first = roundTrip("Formatting", markdown);
  const second = roundTrip("Formatting", markdown);
  assert.equal(first, second);
  assert.equal(compileDocument("Formatting", first).blocks.map((block) => block.type).join(","), compileDocument("Formatting", markdown).blocks.map((block) => block.type).join(","));
  assert.match(first, /https:\/\/example\.com/);
  assert.doesNotMatch(first, /javascript:/);
  assert.match(first, /<u>/);
  assert.match(first, /  \nnext/);
});

test("ordered starts and bounded mixed nested lists round-trip", () => {
  const markdown = "7. Parent\n   - Child\n     - Grandchild\n8. Next";
  const serialized = roundTrip("Lists", markdown);
  assert.match(serialized, /^7\. Parent/m);
  assert.deepEqual(semanticProjection("Lists", serialized), semanticProjection("Lists", markdown));
});

test("code blocks choose safe fences and preserve language and embedded backticks", () => {
  const markdown = "Intro.\n\n````ts\nconst sample = `one`;\nconst fence = ```;\n````";
  const serialized = roundTrip("Code", markdown);
  assert.match(serialized, /````ts/);
  assert.deepEqual(semanticProjection("Code", serialized), semanticProjection("Code", markdown));
});

test("table edits keep valid dimensions, alignments, pipes, hard breaks, and empty cells", () => {
  const source = "| Left | Centre | Amount | Empty |\n|:---|:---:|---:|:---|\n| A \\| B | line one<br>line two | 12 | |";
  const document = markdownToEditorDocument("Table", source);
  const table = document.content?.find((node) => node.type === "table");
  assert.ok(table?.content);
  table.content.push({ type: "tableRow", content: table.content[0].content?.map((cell) => ({ ...cell, type: "tableCell", content: [{ type: "paragraph" }] })) });
  for (const row of table.content) row.content?.push({ type: row === table.content[0] ? "tableHeader" : "tableCell", attrs: { alignment: "left", columnKind: "text" }, content: [{ type: "paragraph" }] });
  const aligned = setTableColumnAlignmentInJson(document, 0, 1, "right");
  const markdown = editorJsonToMarkdown(aligned);
  const lines = markdown.split("\n").filter((line) => line.startsWith("|"));
  assert.ok(lines.length >= 4);
  assert.ok(lines.every((line) => (line.match(/(?<!\\)\|/g) ?? []).length === 6));
  assert.match(markdown, /A \\| B/);
  assert.match(markdown, /line one<br>line two/);
  assert.match(lines[1], /---:/);
  const compiled = compileDocument("Table", markdown);
  const compiledTable = compiled.blocks.find((block) => block.type === "table");
  assert.ok(compiledTable && compiledTable.rows.length === 3 && compiledTable.columns.length === 5);
  assert.equal(compiledTable.columns[1].alignment, "right");
});

test("signature tables remain signatures and unsupported cell blocks normalize to readable inline content", async () => {
  const source = await readFile("tests/fixtures/docx/signature-agreement.md", "utf8");
  const serialized = roundTrip("Agreement", source);
  const table = compileDocument("Agreement", serialized).blocks.find((block) => block.type === "table");
  assert.ok(table && table.signatureLayout);
  const custom: JSONContent = { type: "doc", content: [{ type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { alignment: "left" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Header" }] }] }, { type: "tableHeader", attrs: { alignment: "left" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Value" }] }] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Kept" }] }] }] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Safe" }] }, { type: "paragraph", content: [{ type: "text", text: "Also safe" }] }] }] }] }] };
  const markdown = editorJsonToMarkdown(custom);
  assert.match(markdown, /Kept/);
  assert.match(markdown, /Safe<br>Also safe/);
  assert.doesNotMatch(markdown, /<(?!(?:u|br)\b)[^>]+>/i);
});

test("empty documents and controlled synchronization decisions are stable", () => {
  assert.equal(editorJsonToMarkdown({ type: "doc", content: [] }), "");
  assert.equal(shouldApplyExternalEditorValue("same", "same", "different"), false);
  assert.equal(shouldApplyExternalEditorValue("same", null, "same"), false);
  assert.equal(shouldApplyExternalEditorValue("external", "old", "current"), true);
});

test("compiled table cell text remains readable after conversion", () => {
  const json = markdownToEditorDocument("Simple", "| A | B |\n|---|---|\n| one | two |");
  const markdown = editorJsonToMarkdown(json);
  const table = compileDocument("Simple", markdown).blocks.find((block) => block.type === "table");
  assert.ok(table);
  assert.equal(inlinePlainText(table.rows[1].cells[1]), "two");
});
