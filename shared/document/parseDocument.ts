import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { documentDiagnostic, type DocumentDiagnostic } from "./documentDiagnostics.js";
import { planTableLayout } from "./tableLayout.js";
import type {
  DocumentAlignment,
  DocumentBlock,
  InlineContent,
  InlineText,
  ListItem,
  TableBlockRow,
} from "./documentTypes.js";

type AstNode = {
  type: string;
  value?: string;
  url?: string;
  depth?: number;
  ordered?: boolean;
  start?: number | null;
  align?: Array<"left" | "center" | "right" | null>;
  lang?: string | null;
  children?: AstNode[];
};

const MAX_LIST_LEVEL = 2;
const ATTACHMENT_HEADING = /^(?:EXHIBIT|SCHEDULE|APPENDIX|ANNEX)(?:\s+[A-Z0-9][\s\S]*)?$/;
const SIGNATURE_HEADING = /^(?:SIGNATURE PAGE|SIGNATURES)$/;
const ARTICLE_HEADING = /^ARTICLE\s+(?:[IVXLCDM]+|\d+)(?:\s+(?:[—–-]|â€”|â€“)\s+.+)?$/;
const TABLE_SEPARATOR_CELL = /^:?-{2,}:?$/;

type InlineStyle = Pick<InlineText, "bold" | "italic" | "underline" | "code">;

function pushText(content: InlineContent[], text: string, style: InlineStyle = {}): void {
  const normalized = text.replace(/\s*\n\s*/g, " ");
  if (!normalized) return;
  const previous = content[content.length - 1];
  if (previous?.type === "text" && previous.bold === style.bold && previous.italic === style.italic && previous.underline === style.underline && previous.code === style.code) {
    previous.text += normalized;
  } else {
    content.push({ type: "text", text: normalized, ...style });
  }
}

function safeExternalUrl(value: string): string | null {
  const candidate = value.trim();
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(candidate)) return candidate;
  try {
    const url = new URL(candidate);
    if ((url.protocol === "https:" || url.protocol === "http:") && !/[\r\n]/.test(candidate)) return candidate;
  } catch {
    // Unsafe and relative targets intentionally become ordinary readable text.
  }
  return null;
}

function inlineNodes(nodes: AstNode[], diagnostics: DocumentDiagnostic[], inherited: InlineStyle = {}): InlineContent[] {
  const content: InlineContent[] = [];
  let underline = Boolean(inherited.underline);
  for (const node of nodes) {
    const style = { ...inherited, underline };
    switch (node.type) {
      case "text":
        pushText(content, node.value ?? "", style);
        break;
      case "strong":
        content.push(...inlineNodes(node.children ?? [], diagnostics, { ...style, bold: true }));
        break;
      case "emphasis":
        content.push(...inlineNodes(node.children ?? [], diagnostics, { ...style, italic: true }));
        break;
      case "inlineCode":
        pushText(content, node.value ?? "", { ...style, code: true });
        break;
      case "break":
        content.push({ type: "hardBreak" });
        break;
      case "link": {
        const children = inlineNodes(node.children ?? [], diagnostics, style);
        const url = safeExternalUrl(node.url ?? "");
        if (url) content.push({ type: "hyperlink", url, content: children });
        else content.push(...children);
        break;
      }
      case "html": {
        const html = node.value ?? "";
        if (/^<br\s*\/?\s*>$/i.test(html)) content.push({ type: "hardBreak" });
        else if (/^<u\s*>$/i.test(html)) underline = true;
        else if (/^<\/u\s*>$/i.test(html)) underline = false;
        else {
          const readable = html.replace(/<[^>]*>/g, "").trim();
          if (readable) pushText(content, readable, style);
          diagnostics.push(documentDiagnostic("unsupported-html-fallback", "Unsupported HTML was converted to readable text."));
        }
        break;
      }
      default:
        if (node.children) content.push(...inlineNodes(node.children, diagnostics, style));
        else if (node.value) pushText(content, node.value, style);
    }
  }
  return content.length ? content : [{ type: "text", text: "" }];
}

export function parseInlineMarkdown(text: string): InlineContent[] {
  const diagnostics: DocumentDiagnostic[] = [];
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text) as AstNode;
  const paragraph = tree.children?.find((node) => node.type === "paragraph");
  return inlineNodes(paragraph?.children ?? [{ type: "text", value: text }], diagnostics);
}

export function inlinePlainText(content: InlineContent[]): string {
  return content.map((node) => node.type === "text" ? node.text : node.type === "hyperlink" ? inlinePlainText(node.content) : "\n").join("");
}

function plainAstText(node: AstNode): string {
  if (node.value) return node.value;
  return (node.children ?? []).map(plainAstText).join("");
}

function legalHeadingLevel(text: string): 1 | 2 | 3 | 4 | null {
  const value = text.trim();
  if (ATTACHMENT_HEADING.test(value) || SIGNATURE_HEADING.test(value) || ARTICLE_HEADING.test(value)) return 1;
  if (/^\d+\.\s+[A-Z][A-Z0-9 &'(),/\-–—]+$/.test(value)) return 2;
  if (/^\d+(?:\.\d+)+\s+\S[\s\S]*$/.test(value)) return 4;
  return null;
}

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const hasLeading = trimmed.startsWith("|");
  const hasTrailing = /(?<!\\)\|$/.test(trimmed);
  const content = trimmed.slice(hasLeading ? 1 : 0, hasTrailing ? -1 : undefined);
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of content) {
    if (escaped) {
      cell += character === "|" ? "\\|" : `\\${character}`;
      escaped = false;
    } else if (character === "\\") escaped = true;
    else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells.length >= 2 ? cells : null;
}

function separatorCells(line: string): string[] | null {
  const cells = splitTableRow(line);
  return cells?.length && cells.every((cell) => TABLE_SEPARATOR_CELL.test(cell.replace(/\s/g, ""))) ? cells : null;
}

function canonicalTableRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function tableFallback(headers: string[], rows: string[][]): string[] {
  const output: string[] = [];
  for (const row of rows) {
    row.forEach((value, index) => {
      if (!value.trim()) return;
      output.push(`**${headers[index]?.trim() || `Column ${index + 1}`}**`, "", value.replace(/\\\|/g, "|"), "");
    });
  }
  return output.length ? output.slice(0, -1) : headers.map((header) => `**${header || "Untitled field"}**`);
}

export function repairMalformedTables(markdown: string): { markdown: string; diagnostics: DocumentDiagnostic[] } {
  const lines = markdown.split("\n");
  const output: string[] = [];
  const diagnostics: DocumentDiagnostic[] = [];
  for (let index = 0; index < lines.length;) {
    const header = splitTableRow(lines[index]);
    const separator = index + 1 < lines.length ? separatorCells(lines[index + 1]) : null;
    if (!header || !separator) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    let cursor = index + 2;
    const rawRows: string[][] = [];
    while (cursor < lines.length && lines[cursor].trim() && lines[cursor].includes("|")) {
      const row = splitTableRow(lines[cursor]);
      if (!row) break;
      rawRows.push(row);
      cursor += 1;
    }
    const columnCount = header.length;
    const regionLines = lines.slice(index, cursor);
    const outerPipeStyle = regionLines.map((line) => {
      const trimmed = line.trim();
      return `${trimmed.startsWith("|")}:${/(?<!\\)\|$/.test(trimmed)}`;
    });
    const needsRepair = header.some((cell) => !cell)
      || separator.some((cell) => cell.replace(/[^-]/g, "").length < 3)
      || rawRows.some((row) => row.length !== columnCount)
      || new Set(outerPipeStyle).size > 1
      || outerPipeStyle.some((style) => style !== "true:true")
      || regionLines.some((line) => line !== line.trim());
    const repairableSeparator = separator.length === columnCount;
    const repairableRows = rawRows.every((row) => row.length <= columnCount || (row.length === columnCount + 1 && !row[row.length - 1]));
    if (!repairableSeparator || !repairableRows) {
      output.push(...tableFallback(header, rawRows));
      diagnostics.push(documentDiagnostic("malformed-table-fallback", "A table-like region was converted to labelled readable text."));
      index = cursor;
      continue;
    }
    const repairedHeader = header.map((cell, cellIndex) => cell || `Column ${cellIndex + 1}`);
    const repairedSeparator = separator.map((cell) => {
      const compact = cell.replace(/\s/g, "");
      const left = compact.startsWith(":");
      const right = compact.endsWith(":");
      return `${left ? ":" : ""}---${right ? ":" : ""}`;
    });
    const repairedRows = rawRows.map((row) => {
      const result = row.length === columnCount + 1 ? row.slice(0, -1) : [...row];
      while (result.length < columnCount) result.push("");
      return result;
    });
    const canonical = [canonicalTableRow(repairedHeader), canonicalTableRow(repairedSeparator), ...repairedRows.map(canonicalTableRow)];
    if (needsRepair) diagnostics.push(documentDiagnostic("malformed-table-repaired", "A malformed table was repaired without inventing cell content."));
    output.push(...canonical);
    index = cursor;
  }
  return { markdown: output.join("\n"), diagnostics };
}

export function isSignatureTable(rows: TableBlockRow[]): boolean {
  if (rows.length < 2 || rows[0].cells.length !== 2) return false;
  const header = rows[0].cells.map((cell) => inlinePlainText(cell).trim().toUpperCase());
  const fieldCount = rows.slice(1).flatMap((row) => row.cells).filter((cell) => /^(?:SIGNATURE|NAME|TITLE|DATE)\s*:/i.test(inlinePlainText(cell).trim())).length;
  const namedColumns = header.every(Boolean) && header[0] !== header[1];
  const knownPartyRole = header.some((cell) => /\b(?:CLIENT|PROVIDER|DEVELOPER|COMPANY|PARTY|CUSTOMER|VENDOR)\b/.test(cell));
  return namedColumns && fieldCount >= 2 && (knownPartyRole || fieldCount >= 4);
}

function flattenList(node: AstNode, diagnostics: DocumentDiagnostic[], level = 0): ListItem[] {
  const items: ListItem[] = [];
  let marker = node.start ?? 1;
  for (const item of node.children ?? []) {
    const paragraph = item.children?.find((child) => child.type === "paragraph");
    items.push({
      content: inlineNodes(paragraph?.children ?? [], diagnostics),
      level: Math.min(MAX_LIST_LEVEL, level),
      ordered: Boolean(node.ordered),
      marker: node.ordered ? marker ?? undefined : undefined,
    });
    if (node.ordered && marker !== null) marker += 1;
    for (const nested of item.children?.filter((child) => child.type === "list") ?? []) items.push(...flattenList(nested, diagnostics, level + 1));
  }
  return items;
}

function tableBlock(node: AstNode, diagnostics: DocumentDiagnostic[], blockIndex: number): DocumentBlock {
  const rows: TableBlockRow[] = (node.children ?? []).map((row) => ({
    cells: (row.children ?? []).map((cell) => inlineNodes(cell.children ?? [], diagnostics)),
  }));
  const signatureLayout = isSignatureTable(rows);
  const plainRows = rows.map((row) => row.cells.map(inlinePlainText));
  const authored = Array.from({ length: Math.max(1, ...rows.map((row) => row.cells.length)) }, (_, index) => node.align?.[index] as DocumentAlignment | null ?? null);
  const plan = planTableLayout({ rows: plainRows, authoredAlignments: authored, signature: signatureLayout });
  if (plan.orientation === "landscape") diagnostics.push(documentDiagnostic("wide-table-landscape", "A dense table was assigned to a landscape section.", blockIndex));
  if (plan.columns.length > 6) diagnostics.push(documentDiagnostic("excessive-table-columns", "A table contains more than six columns.", blockIndex));
  return {
    type: "table",
    headerRows: 1,
    headerRow: true,
    rows,
    columns: plan.columns,
    layout: plan.layout,
    orientation: plan.orientation,
    signatureLayout,
  };
}

function applyPagination(blocks: DocumentBlock[]): DocumentBlock[] {
  blocks.forEach((block, index) => {
    if (block.type === "heading" && ATTACHMENT_HEADING.test(block.text.trim()) && index > 0) block.pageBreakBefore = true;
    if (block.type === "heading" && SIGNATURE_HEADING.test(block.text.trim()) && index > 0) {
      const previous = blocks[index - 1];
      if (previous?.type === "paragraph" && inlinePlainText(previous.content).trimStart().startsWith("IN WITNESS WHEREOF")) previous.pageBreakBefore = true;
      else block.pageBreakBefore = true;
    }
    if (block.type === "paragraph" && inlinePlainText(block.content).trimStart().startsWith("IN WITNESS WHEREOF") && index > 0) {
      const next = blocks[index + 1];
      if ((next?.type === "table" && next.signatureLayout) || (next?.type === "heading" && SIGNATURE_HEADING.test(next.text.trim()))) {
        block.pageBreakBefore = true;
        if (next.type === "heading") next.pageBreakBefore = false;
      }
    }
  });
  return blocks;
}

function preserveAuthoredListRestarts(markdown: string): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  const rootOrdered = /^\s{0,3}\d+[.)]\s+/;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim()) {
      result.push(line);
      continue;
    }
    let next = index;
    while (next < lines.length && !lines[next].trim()) next += 1;
    const previous = result[result.length - 1] ?? "";
    if (rootOrdered.test(previous) && next < lines.length && rootOrdered.test(lines[next])) {
      result.push("", "---", "");
      index = next - 1;
    } else {
      result.push(line);
    }
  }
  return result.join("\n");
}

export function parseDocument(markdown: string, diagnostics: DocumentDiagnostic[] = []): DocumentBlock[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(preserveAuthoredListRestarts(markdown)) as AstNode;
  const blocks: DocumentBlock[] = [];
  for (const node of tree.children ?? []) {
    switch (node.type) {
      case "heading": {
        const content = inlineNodes(node.children ?? [], diagnostics);
        blocks.push({ type: "heading", level: Math.min(6, Math.max(1, node.depth ?? 1)) as 1 | 2 | 3 | 4 | 5 | 6, text: inlinePlainText(content), content });
        break;
      }
      case "paragraph": {
        const content = inlineNodes(node.children ?? [], diagnostics);
        const text = inlinePlainText(content);
        const level = legalHeadingLevel(text);
        blocks.push(level ? { type: "heading", level, text, content } : { type: "paragraph", content });
        break;
      }
      case "list": {
        if (node.ordered && (node.children?.length ?? 0) === 1) {
          const paragraph = node.children?.[0]?.children?.find((child) => child.type === "paragraph");
          const content = inlineNodes(paragraph?.children ?? [], diagnostics);
          const text = `${node.start ?? 1}. ${inlinePlainText(content)}`;
          const level = legalHeadingLevel(text);
          if (level) {
            blocks.push({ type: "heading", level, text, content: [{ type: "text", text }] });
            break;
          }
        }
        const items = flattenList(node, diagnostics);
        if (node.ordered) blocks.push({ type: "orderedList", start: node.start ?? 1, items });
        else blocks.push({ type: "unorderedList", items });
        break;
      }
      case "blockquote": {
        const content = (node.children ?? []).flatMap((child, index) => {
          const inline = inlineNodes(child.children ?? [], diagnostics);
          return index ? [{ type: "hardBreak" } as InlineContent, ...inline] : inline;
        });
        blocks.push({ type: "blockquote", content });
        break;
      }
      case "code": {
        const legacyIndentedList = !node.lang && (node.value ?? "").match(/^\s*(\d+)[.)]\s+([^\n]+)$/);
        if (legacyIndentedList) {
          blocks.push({
            type: "orderedList",
            start: Number(legacyIndentedList[1]),
            items: [{
              content: parseInlineMarkdown(legacyIndentedList[2]),
              level: MAX_LIST_LEVEL,
              ordered: true,
              marker: Number(legacyIndentedList[1]),
            }],
          });
        } else {
          blocks.push({ type: "codeBlock", text: node.value ?? "", ...(node.lang ? { language: node.lang } : {}) });
        }
        break;
      }
      case "table":
        blocks.push(tableBlock(node, diagnostics, blocks.length));
        break;
      case "thematicBreak":
        break;
      case "html": {
        const readable = (node.value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        if (readable) blocks.push({ type: "paragraph", content: [{ type: "text", text: readable }] });
        diagnostics.push(documentDiagnostic("unsupported-html-fallback", "Unsupported HTML was converted to readable text."));
        break;
      }
      default: {
        const text = plainAstText(node).trim();
        if (text) blocks.push({ type: "paragraph", content: [{ type: "text", text }] });
      }
    }
  }
  return applyPagination(blocks);
}

export const DOCX_MAX_LIST_LEVEL = MAX_LIST_LEVEL;
