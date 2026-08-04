import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Packer } from "docx";
import JSZip from "jszip";
import mammoth from "mammoth";
import type { DocumentBlock, InlineContent } from "../server/docx/documentTypes.js";
import { normalizeMarkdown, normalizedTitle } from "../server/docx/normalizeMarkdown.js";
import {
  DOCX_MAX_LIST_LEVEL,
  parseInlineMarkdown,
  parseMarkdownBlocks,
} from "../server/docx/parseMarkdownBlocks.js";
import {
  createNumberingDefinitions,
  DOCX_STYLE_IDS,
} from "../server/docx/renderDocx.js";
import { markdownToDocxDocument } from "../server/docxMarkdown.js";

const TITLE = "Master Services Agreement";
const LEGAL_FIXTURE = `# MASTER SERVICES AGREEMENT

MASTER SERVICES AGREEMENT

Introductory text split
across two soft-wrapped lines.

---

## 1. SERVICES

#### 1.1 Scope of Services

Provider shall perform the Services.

1. First requirement.
2. Second requirement.

## 2. CONFIDENTIALITY

1. First separate obligation.
2. Second separate obligation.

See [Exepts](https://exepts.com).

## SIGNATURES

| PROVIDER | CLIENT |
|:---|:---|
| Signature: __________________ | Signature: __________________ |
| Name: _______________________ | Name: _______________________ |
| Title: ______________________ | Title: ______________________ |
| Date: _______________________ | Date: _______________________ |

## EXHIBIT A

Statement of Work.`;

function plainInline(content: InlineContent[]): string {
  return content.map((node) => {
    if (node.type === "text") return node.text;
    if (node.type === "hyperlink") return plainInline(node.content);
    return "\n";
  }).join("");
}

function blockText(block: DocumentBlock): string {
  if (block.type === "heading") return block.text;
  if (block.type === "paragraph" || block.type === "blockquote") return plainInline(block.content);
  if (block.type === "orderedList" || block.type === "unorderedList") return block.items.map((item) => plainInline(item.content)).join("\n");
  if (block.type === "table") return block.rows.flatMap((row) => row.cells.map(plainInline)).join("\n");
  if (block.type === "codeBlock") return block.text;
  return "";
}

async function packedParts(title = TITLE, markdown = LEGAL_FIXTURE): Promise<{
  buffer: Buffer;
  rawText: string;
  html: string;
  documentXml: string;
  numberingXml: string;
  stylesXml: string;
  footerXml: string;
  settingsXml: string;
  relationshipsXml: string;
  headersXml: string[];
}> {
  const buffer = await Packer.toBuffer(markdownToDocxDocument(title, markdown));
  const [{ value: rawText }, { value: html }, zip] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer }),
    JSZip.loadAsync(buffer),
  ]);
  const part = async (path: string) => (await zip.file(path)?.async("string")) ?? "";
  const headerPaths = Object.keys(zip.files).filter((path) => /^word\/header\d+\.xml$/.test(path));
  return {
    buffer,
    rawText,
    html,
    documentXml: await part("word/document.xml"),
    numberingXml: await part("word/numbering.xml"),
    stylesXml: await part("word/styles.xml"),
    footerXml: await part("word/footer1.xml"),
    settingsXml: await part("word/settings.xml"),
    relationshipsXml: await part("word/_rels/document.xml.rels"),
    headersXml: await Promise.all(headerPaths.map(part)),
  };
}

test("export normalization removes only consecutive opening title duplicates and raw wrappers", () => {
  const normalized = normalizeMarkdown(TITLE, `\r\n\`\`\`markdown\r\n# MASTER SERVICES AGREEMENT\r\n\r\n**Master   Services Agreement.**\r\n\r\nMaster Services Agreement\r\n\r\nProduct Development Services\r\n\r\n\r\nBody  \r\ncontinued\r\n\`\`\`\r\n`);
  assert.equal(normalized, "Product Development Services\n\nBody  \ncontinued");
  assert.equal(normalizedTitle("## ** MASTER   SERVICES AGREEMENT: **"), normalizedTitle(TITLE));
  assert.equal(normalizeMarkdown(TITLE, "Subtitle\n\nMaster Services Agreement"), "Subtitle\n\nMaster Services Agreement");
});

test("block parser removes thematic breaks, joins soft wraps, and preserves deliberate hard breaks", () => {
  const normalized = normalizeMarkdown(TITLE, LEGAL_FIXTURE.replace("---", "---\n\n***\n\n___"));
  const blocks = parseMarkdownBlocks(normalized);
  const allText = blocks.map(blockText).join("\n");
  assert.match(allText, /Introductory text split across two soft-wrapped lines\./);
  assert.doesNotMatch(allText, /(^|\n)(?:---|\*\*\*|___)(?:\n|$)/);
  assert.equal(blocks.filter((block) => block.type === "paragraph" && blockText(block) === "").length, 0);

  const hardBreak = parseMarkdownBlocks("First line  \nsecond line.")[0];
  assert.equal(hardBreak.type, "paragraph");
  if (hardBreak.type === "paragraph") assert.ok(hardBreak.content.some((node) => node.type === "hardBreak"));
});

test("headings cover H1-H6 and conservative legal headings without leaking markers", () => {
  const blocks = parseMarkdownBlocks([
    "# One", "## Two", "### Three", "#### 1.1 Scope of Services", "##### Five", "###### Six",
    "1. SERVICES AND STATEMENTS OF WORK", "1.1 Scope of Services", "ARTICLE I — SERVICES",
  ].join("\n\n"));
  const headings = blocks.filter((block) => block.type === "heading");
  assert.deepEqual(headings.slice(0, 6).map((block) => block.level), [1, 2, 3, 4, 5, 6]);
  assert.equal(headings.some((block) => block.text === "1.1 Scope of Services"), true);
  assert.doesNotMatch(headings.map((block) => block.text).join("\n"), /#{1,6}/);
  const numberedSentence = parseMarkdownBlocks("1. First requirement.")[0];
  assert.equal(numberedSentence.type, "orderedList");
});

test("list blocks restart independently, preserve starts, and clamp nested levels", () => {
  const blocks = parseMarkdownBlocks(`1. First\n2. Second\n\n1. Separate first\n2. Separate second\n\n4) Fourth\n5) Fifth\n\n1.1 Scope of Services\n\n            1. Deep item`);
  const lists = blocks.filter((block) => block.type === "orderedList");
  assert.equal(lists.length, 4);
  assert.deepEqual(lists.map((block) => block.start), [1, 1, 4, 1]);
  assert.notEqual(createNumberingDefinitions(blocks)[0].reference, createNumberingDefinitions(blocks)[1].reference);
  assert.equal(createNumberingDefinitions(blocks)[2].levels[0].start, 4);
  assert.equal(blocks.some((block) => block.type === "heading" && block.text === "1.1 Scope of Services"), true);
  assert.equal(Math.max(...lists.flatMap((block) => block.items.map((item) => item.level))), DOCX_MAX_LIST_LEVEL);
});

test("inline parser supports formatting, real safe links, email links, and drafting blanks", () => {
  const inline = parseInlineMarkdown("**Label:** *text* <u>under</u> `code` [Exepts](https://exepts.com) [Email](mailto:person@example.com) <other@example.com> [Unsafe](javascript:alert(1)) __________________");
  assert.ok(inline.some((node) => node.type === "text" && node.bold && node.text === "Label:"));
  assert.ok(inline.some((node) => node.type === "text" && node.italic && node.text === "text"));
  assert.ok(inline.some((node) => node.type === "text" && node.underline && node.text === "under"));
  assert.ok(inline.some((node) => node.type === "text" && node.code && node.text === "code"));
  assert.deepEqual(inline.filter((node) => node.type === "hyperlink").map((node) => node.url), [
    "https://exepts.com", "mailto:person@example.com", "mailto:other@example.com",
  ]);
  assert.match(plainInline(inline), /Unsafe/);
  assert.match(plainInline(inline), /_{16}/);
});

test("tables parse safely and signature tables are detected conservatively", () => {
  const blocks = parseMarkdownBlocks(normalizeMarkdown(TITLE, LEGAL_FIXTURE));
  const table = blocks.find((block) => block.type === "table");
  assert.ok(table && table.type === "table");
  assert.equal(table.signatureLayout, true);
  assert.equal(table.rows.length, 5);
  assert.doesNotMatch(blockText(table), /:---|\|/);

  const generic = parseMarkdownBlocks("| Term | Meaning |\n|---|---|\n| A \\| B | Value |")[0];
  assert.equal(generic.type, "table");
  if (generic.type === "table") {
    assert.equal(generic.signatureLayout, false);
    assert.equal(plainInline(generic.rows[1].cells[0]), "A | B");
  }
  const malformed = parseMarkdownBlocks("| A | B |\n|--|---|\n| one | two |");
  assert.equal(malformed.some((block) => block.type === "table"), true);
  assert.match(malformed.map(blockText).join(" "), /A[\s\S]*B[\s\S]*one[\s\S]*two/);
  assert.doesNotMatch(malformed.map(blockText).join(" "), /\|--/);

  const namedParties = parseMarkdownBlocks("| ACME LLC | BETA INC |\n|---|---|\n| Signature: ___ | Signature: ___ |\n| Name: ___ | Name: ___ |")[0];
  assert.ok(namedParties.type === "table" && namedParties.signatureLayout);
});

test("attachments and signature sections receive safe page-break plans", () => {
  const blocks = parseMarkdownBlocks("Opening.\n\nIN WITNESS WHEREOF, the parties agree.\n\n## SIGNATURES\n\n| PROVIDER | CLIENT |\n|---|---|\n| Signature: ___ | Signature: ___ |\n\n## EXHIBIT A\n\nTerms.");
  const witness = blocks.find((block) => block.type === "paragraph" && blockText(block).startsWith("IN WITNESS"));
  const signatures = blocks.find((block) => block.type === "heading" && block.text === "SIGNATURES");
  const exhibit = blocks.find((block) => block.type === "heading" && block.text === "EXHIBIT A");
  assert.ok(witness?.type === "paragraph" && witness.pageBreakBefore);
  assert.ok(signatures?.type === "heading" && !signatures.pageBreakBefore);
  assert.ok(exhibit?.type === "heading" && exhibit.pageBreakBefore);
  const firstExhibit = parseMarkdownBlocks("## EXHIBIT A\n\nTerms.")[0];
  assert.ok(firstExhibit.type === "heading" && !firstExhibit.pageBreakBefore);
});

test("packed DOCX has professional styles, real structures, fields, and readable legal text", async () => {
  const packed = await packedParts();
  assert.equal(packed.buffer.subarray(0, 2).toString("ascii"), "PK");
  assert.match(packed.html, /<table>/);
  assert.match(packed.html, /<a href="https:\/\/exepts\.com">Exepts<\/a>/);
  assert.match(packed.documentXml, /<w:tbl>/);
  assert.match(packed.documentXml, /w:pageBreakBefore/);
  assert.match(packed.relationshipsXml, /Target="https:\/\/exepts\.com"[^>]*TargetMode="External"/);
  assert.match(packed.footerXml, /w:instrText[^>]*>PAGE<\/w:instrText>/);
  assert.match(packed.footerXml, /w:instrText[^>]*>NUMPAGES<\/w:instrText>/);
  assert.match(packed.settingsXml, /w:updateFields/);
  assert.match(packed.documentXml, /<w:titlePg\/>/);
  assert.match(packed.documentXml, /w:headerReference w:type="default"/);
  assert.match(packed.documentXml, /w:headerReference w:type="first"/);
  assert.equal(packed.headersXml.filter((xml) => xml.includes(TITLE)).length, 1);
  assert.equal(packed.headersXml.some((xml) => /<w:p\/>/.test(xml) && !xml.includes(TITLE)), true);
  assert.match(packed.stylesXml, new RegExp(`w:styleId="${DOCX_STYLE_IDS.title}"`));
  assert.match(packed.stylesXml, new RegExp(`w:styleId="${DOCX_STYLE_IDS.body}"`));
  assert.match(packed.stylesXml, /w:styleId="Heading1"/);
  assert.match(packed.stylesXml, /w:styleId="Heading6"/);
  assert.ok((packed.numberingXml.match(/<w:abstractNum/g) ?? []).length >= 2);
  assert.equal((packed.rawText.match(/Master Services Agreement/gi) ?? []).length, 1);
  assert.doesNotMatch(packed.rawText, /####|(^|\n)---(?:\n|$)|:---|\|/m);
  assert.match(packed.rawText, /1\.1 Scope of Services/);
  assert.match(packed.rawText, /Signature: __________________/);
  assert.match(packed.rawText, /EXHIBIT A/);

  const empty = await packedParts("Empty Document", "");
  assert.match(empty.rawText, /Empty Document/);
});

test("all existing Word routes retain the shared renderer and scoped cleanup", async () => {
  const [server, migrations, docxFiles] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/migrations.ts", "utf8"),
    readdir("server/docx"),
  ]);
  assert.equal((server.match(/markdownToDocxDocument\(/g) ?? []).length, 5);
  assert.match(server, /markdownToDocxDocument\(draft\.title, cleanWorkProductContent\(draft\.content\)\)/);
  assert.match(server, /markdownToDocxDocument\(document\.title, cleanWorkProductContent\(document\.content\)\)/);
  assert.match(server, /markdownToDocxDocument\(`\$\{matter\.name\} Matter Intelligence`, cleanMatterIntelligenceContent\(record\.content\)\)/);
  assert.ok(docxFiles.includes("normalizeMarkdown.ts") && docxFiles.includes("parseMarkdownBlocks.ts") && docxFiles.includes("renderDocx.ts"));
  assert.doesNotMatch(migrations, /docx/i);
});
