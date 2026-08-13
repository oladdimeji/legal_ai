import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Packer } from "docx";
import JSZip from "jszip";
import mammoth from "mammoth";
import { compileDocument } from "../shared/document/compileDocument.js";
import {
  LANDSCAPE_CONTENT_WIDTH_TWIPS,
  PORTRAIT_CONTENT_WIDTH_TWIPS,
} from "../shared/document/documentTheme.js";
import { planTableLayout, tableGridWidths } from "../shared/document/tableLayout.js";
import type { TableBlock } from "../shared/document/documentTypes.js";
import { shouldPreventRowSplit } from "../server/docx/renderDocx.js";
import { markdownToDocxDocument } from "../server/docxMarkdown.js";
import { EXPORT_SAFE_DOCUMENT_MARKDOWN_RULES } from "../server/documentDraftingRules.js";
import { buildWorkProductDraftPrompt } from "../server/workProductDrafting.js";
import { buildAssistantDraftPrompt } from "../server/assistantDrafting.js";

const fixture = async (name: string) => readFile(`tests/fixtures/docx/${name}.md`, "utf8");
const table = (compiled: ReturnType<typeof compileDocument>): TableBlock => {
  const result = compiled.blocks.find((block): block is TableBlock => block.type === "table");
  assert.ok(result, "Expected a compiled table");
  return result;
};

async function documentXml(title: string, markdown: string): Promise<{ xml: string; text: string }> {
  const buffer = await Packer.toBuffer(markdownToDocxDocument(title, markdown));
  const zip = await JSZip.loadAsync(buffer);
  return {
    xml: (await zip.file("word/document.xml")?.async("string")) ?? "",
    text: (await mammoth.extractRawText({ buffer })).value,
  };
}

test("all required source fixtures are present without binary DOCX fixtures", async () => {
  const names = await readdir("tests/fixtures/docx");
  const expected = [
    "legal-memorandum.md", "client-advice-letter.md", "signature-agreement.md", "term-meaning.md",
    "chronology.md", "risk-matrix.md", "comparison-four-column.md", "long-prose-table.md",
    "wide-table.md", "concise-multicolumn.md", "aligned-table.md", "rich-table.md",
    "repairable-table.md", "fallback-table.md", "empty.md", "minimal.md",
  ];
  assert.deepEqual(expected.filter((name) => !names.includes(name)), []);
  assert.equal(names.some((name) => name.endsWith(".docx")), false);
});

test("canonical compilation is deterministic and reports normalization without private content", () => {
  const privateSentence = "Highly private client narrative that must not enter a diagnostic.";
  const markdown = `\`\`\`markdown\n# Test Document\n\n${privateSentence}\n\`\`\``;
  const first = compileDocument("Test Document", markdown);
  const second = compileDocument("Test Document", markdown);
  assert.deepEqual(first, second);
  assert.deepEqual(first.diagnostics.map((item) => item.code), ["outer-fence-removed", "duplicate-title-removed"]);
  assert.equal(JSON.stringify(first.diagnostics).includes(privateSentence), false);
  assert.match(first.normalizedMarkdown, /Highly private/);
  const empty = compileDocument("Empty", "");
  assert.equal(empty.diagnostics.some((item) => item.code === "empty-document"), true);
  assert.deepEqual(empty.blocks, []);
});

test("GFM tables preserve alignment and infer semantic column kinds", async () => {
  const aligned = table(compileDocument("Alignment", await fixture("aligned-table")));
  assert.deepEqual(aligned.columns.map((column) => column.alignment), ["left", "center", "right"]);
  assert.equal(aligned.columns[2].kind, "number");
  assert.ok(aligned.columns.every((column) => column.widthWeight > 0));
  assert.ok(Math.abs(aligned.columns.reduce((sum, column) => sum + column.widthWeight, 0) - 1) < 1e-9);

  const chronology = table(compileDocument("Chronology", await fixture("chronology")));
  assert.equal(chronology.columns[0].kind, "date");
  assert.equal(chronology.columns[0].alignment, "left");
});

test("content-aware widths favor substantive prose and round to exact positive twips", async () => {
  const term = table(compileDocument("Definitions", await fixture("term-meaning")));
  assert.ok(term.columns[1].widthWeight > term.columns[0].widthWeight * 1.5);
  const termWidths = tableGridWidths(term.columns, PORTRAIT_CONTENT_WIDTH_TWIPS);
  assert.equal(termWidths.reduce((sum, width) => sum + width, 0), PORTRAIT_CONTENT_WIDTH_TWIPS);
  assert.ok(termWidths.every((width) => width > 0));

  const signature = table(compileDocument("Agreement", await fixture("signature-agreement")));
  assert.deepEqual(signature.columns.map((column) => column.widthWeight), [0.5, 0.5]);
  assert.deepEqual(tableGridWidths(signature.columns, PORTRAIT_CONTENT_WIDTH_TWIPS), [4824, 4824]);

  const concise = table(compileDocument("Comparison", await fixture("concise-multicolumn")));
  assert.equal(concise.orientation, "portrait");
  assert.ok(Math.max(...concise.columns.map((column) => column.widthWeight)) - Math.min(...concise.columns.map((column) => column.widthWeight)) < 0.08);
  assert.deepEqual(planTableLayout({ rows: [["A", "B"], ["one", "two"]] }), planTableLayout({ rows: [["A", "B"], ["one", "two"]] }));
});

test("wide classification is based on minimum readability rather than column count alone", async () => {
  const wide = compileDocument("Wide", await fixture("wide-table"));
  const wideTable = table(wide);
  assert.equal(wideTable.orientation, "landscape");
  assert.equal(wideTable.layout, "wide");
  assert.equal(wide.diagnostics.some((item) => item.code === "wide-table-landscape"), true);
  const widths = tableGridWidths(wideTable.columns, LANDSCAPE_CONTENT_WIDTH_TWIPS);
  assert.equal(widths.reduce((sum, width) => sum + width, 0), LANDSCAPE_CONTENT_WIDTH_TWIPS);

  const concise = table(compileDocument("Concise", await fixture("concise-multicolumn")));
  assert.equal(concise.columns.length, 4);
  assert.equal(concise.orientation, "portrait");
});

test("malformed tables repair conservatively or fall back to labelled readable blocks", () => {
  const repaired = compileDocument("Repair", "Date | Event | Significance\n-- | --- | ---\n2026-01-01 | Notice sent");
  const repairedTable = table(repaired);
  assert.equal(repairedTable.rows[1].cells.length, 3);
  assert.equal(repaired.diagnostics.some((item) => item.code === "malformed-table-repaired"), true);

  const fallback = compileDocument("Fallback", "| Issue | Analysis |\n|---|---|---|\n| Termination | Notice is required |");
  assert.equal(fallback.blocks.some((block) => block.type === "table"), false);
  assert.equal(fallback.diagnostics.some((item) => item.code === "malformed-table-fallback"), true);
  const readable = JSON.stringify(fallback.blocks);
  assert.match(readable, /Issue/);
  assert.match(readable, /Termination/);
  assert.doesNotMatch(readable, /\|---/);
});

test("row splitting locks headers and short rows but releases long prose", async () => {
  const longTable = table(compileDocument("Long", await fixture("long-prose-table")));
  assert.equal(shouldPreventRowSplit(longTable.rows[0], longTable, 0), true);
  assert.equal(shouldPreventRowSplit(longTable.rows[1], longTable, 1), false);
  const compact = table(compileDocument("Concise", await fixture("concise-multicolumn")));
  assert.equal(shouldPreventRowSplit(compact.rows[1], compact, 1), true);
});

test("DOCX XML contains semantic grids, alignment, pagination, and landscape transitions", async () => {
  const term = await documentXml("Definitions", await fixture("term-meaning"));
  assert.match(term.xml, /<w:tblGrid>/);
  const gridWidths = [...term.xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((match) => Number(match[1]));
  assert.ok(new Set(gridWidths.slice(0, 2)).size > 1);
  assert.match(term.xml, /<w:tblLayout w:type="autofit"\/>/);
  assert.match(term.xml, /<w:tblHeader\/>/);
  assert.match(term.xml, /<w:tblCellMar>/);
  assert.match(term.xml, /<w:shd[^>]*w:fill="EDEDED"/);

  const aligned = await documentXml("Aligned", await fixture("aligned-table"));
  assert.match(aligned.xml, /<w:jc w:val="center"\/>/);
  assert.match(aligned.xml, /<w:jc w:val="right"\/>/);

  const long = await documentXml("Long", await fixture("long-prose-table"));
  const rows = [...long.xml.matchAll(/<w:tr[\s\S]*?<\/w:tr>/g)].map((match) => match[0]);
  assert.match(rows[0], /w:tblHeader/);
  assert.match(rows[0], /w:cantSplit/);
  assert.equal(rows.slice(1).some((row) => /w:cantSplit/.test(row)), false);
  assert.doesNotMatch(rows.slice(1).join(""), /w:keepLines/);

  const wide = await documentXml("Wide Review", await fixture("wide-table"));
  assert.match(wide.xml, /w:orient="landscape"/);
  assert.ok((wide.xml.match(/w:orient="portrait"/g) ?? []).length >= 2);
  assert.doesNotMatch(wide.text, /\|\s*(?:---|Jurisdiction\s*\|)/);
});

test("all exportable generation prompts share the exact export-safe rules", async () => {
  const assistantPrompt = buildAssistantDraftPrompt({
    instruction: "Draft a memo",
    pageContext: { routeKind: "assistantDocument", pageTitle: "Assistant Document", visibleActions: [] },
    conversationContext: "",
    authorizedEvidence: "",
    accountMetadata: "",
    currentDate: "August 4, 2026",
    publicWebResearch: "",
    webResearchPerformed: false,
    depth: "standard",
  });
  assert.ok(assistantPrompt.includes(EXPORT_SAFE_DOCUMENT_MARKDOWN_RULES));
  const workProductPrompt = buildWorkProductDraftPrompt({
    format: "memo",
    matterMetadata: "Matter name: Example",
    conversationHistory: "USER: Draft a memo.",
  });
  assert.ok(workProductPrompt.includes(EXPORT_SAFE_DOCUMENT_MARKDOWN_RULES));
  const server = await readFile("server.ts", "utf8");
  assert.equal((server.match(/\$\{EXPORT_SAFE_DOCUMENT_MARKDOWN_RULES\}/g) ?? []).length, 1);
  assert.match(server, /Use exactly these Markdown section headings:/);
  assert.match(server, /Do not infer facts from other matters or external knowledge/);
  assert.match(server, /Do not append generic legal-advice/);
  assert.match(server, /State uncertainty clearly/);
});
