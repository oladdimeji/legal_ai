import type {
  DocumentBlock,
  InlineContent,
  InlineText,
  ListItem,
  TableBlockRow,
} from "./documentTypes.js";
import { isThematicBreak } from "./normalizeMarkdown.js";

type InlineStyle = Pick<InlineText, "bold" | "italic" | "underline" | "code">;

const MAX_LIST_LEVEL = 2;
const EXPLICIT_HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)(?:(\d+)[.)]|([-*+]))\s+(.+)$/;
const FENCE_START = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]+)?\s*$/;
const TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/;
const ATTACHMENT_HEADING = /^(?:EXHIBIT|SCHEDULE|APPENDIX|ANNEX)(?:\s+[A-Z0-9][\s\S]*)?$/;
const SIGNATURE_HEADING = /^(?:SIGNATURE PAGE|SIGNATURES)$/;

function pushText(nodes: InlineContent[], text: string, style: InlineStyle): void {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (
    last?.type === "text"
    && Boolean(last.bold) === Boolean(style.bold)
    && Boolean(last.italic) === Boolean(style.italic)
    && Boolean(last.underline) === Boolean(style.underline)
    && Boolean(last.code) === Boolean(style.code)
  ) {
    last.text += text;
    return;
  }
  nodes.push({ type: "text", text, ...style });
}

function findClosingMarker(text: string, marker: string, from: number): number {
  let index = text.indexOf(marker, from);
  while (index >= 0) {
    if (index > from && text[index - 1] !== "\\") return index;
    index = text.indexOf(marker, index + marker.length);
  }
  return -1;
}

function safeExternalUrl(value: string): string | null {
  const candidate = value.trim();
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(candidate)) return candidate;
  try {
    const url = new URL(candidate);
    if ((url.protocol === "https:" || url.protocol === "http:") && !/[\r\n]/.test(candidate)) {
      return candidate;
    }
  } catch {
    // A malformed or relative URL is intentionally rendered as ordinary text.
  }
  return null;
}

function parseInlineRange(text: string, style: InlineStyle): InlineContent[] {
  const nodes: InlineContent[] = [];
  let plain = "";
  const flush = () => {
    pushText(nodes, plain, style);
    plain = "";
  };

  for (let index = 0; index < text.length;) {
    const remainder = text.slice(index);
    const hardBreak = remainder.match(/^<br\s*\/?\s*>/i);
    if (hardBreak) {
      flush();
      nodes.push({ type: "hardBreak" });
      index += hardBreak[0].length;
      continue;
    }

    if (text[index] === "\\" && index + 1 < text.length && /[\\`*_[\]()|]/.test(text[index + 1])) {
      plain += text[index + 1];
      index += 2;
      continue;
    }

    if (remainder.startsWith("<u>")) {
      const close = text.indexOf("</u>", index + 3);
      if (close >= 0) {
        flush();
        nodes.push(...parseInlineRange(text.slice(index + 3, close), { ...style, underline: true }));
        index = close + 4;
        continue;
      }
    }

    if (text[index] === "`") {
      const close = findClosingMarker(text, "`", index + 1);
      if (close >= 0) {
        flush();
        pushText(nodes, text.slice(index + 1, close), { ...style, code: true });
        index = close + 1;
        continue;
      }
    }

    const draftingBlank = remainder.match(/^_{3,}/);
    if (draftingBlank) {
      plain += draftingBlank[0];
      index += draftingBlank[0].length;
      continue;
    }

    const strongMarker = remainder.startsWith("**") ? "**" : remainder.startsWith("__") ? "__" : null;
    if (strongMarker) {
      const close = findClosingMarker(text, strongMarker, index + 2);
      if (close > index + 2) {
        flush();
        nodes.push(...parseInlineRange(text.slice(index + 2, close), { ...style, bold: true }));
        index = close + 2;
        continue;
      }
    }

    if ((text[index] === "*" || text[index] === "_") && text[index + 1] && !/\s/.test(text[index + 1])) {
      const marker = text[index];
      const close = findClosingMarker(text, marker, index + 1);
      if (close > index + 1 && !/\s/.test(text[close - 1])) {
        flush();
        nodes.push(...parseInlineRange(text.slice(index + 1, close), { ...style, italic: true }));
        index = close + 1;
        continue;
      }
    }

    if (text[index] === "[") {
      const labelEnd = text.indexOf("](", index + 1);
      const urlEnd = labelEnd >= 0 ? text.indexOf(")", labelEnd + 2) : -1;
      if (labelEnd >= 0 && urlEnd >= 0) {
        const label = text.slice(index + 1, labelEnd);
        const url = safeExternalUrl(text.slice(labelEnd + 2, urlEnd));
        flush();
        if (url) nodes.push({ type: "hyperlink", url, content: parseInlineRange(label, style) });
        else nodes.push(...parseInlineRange(label, style));
        index = urlEnd + 1;
        continue;
      }
    }

    if (text[index] === "<") {
      const close = text.indexOf(">", index + 1);
      if (close >= 0) {
        const address = text.slice(index + 1, close);
        if (/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)) {
          flush();
          nodes.push({
            type: "hyperlink",
            url: `mailto:${address}`,
            content: [{ type: "text", text: address, ...style }],
          });
          index = close + 1;
          continue;
        }
      }
    }

    plain += text[index];
    index += 1;
  }
  flush();
  return nodes.length ? nodes : [{ type: "text", text: "", ...style }];
}

export function parseInlineMarkdown(text: string): InlineContent[] {
  return parseInlineRange(text, {});
}

function joinSoftWrappedLines(lines: string[]): string {
  let result = "";
  for (const rawLine of lines) {
    const hardBreak = / {2,}$/.test(rawLine);
    const line = rawLine.trim().replace(/ {2,}$/, "");
    if (result && !result.endsWith("<br>")) result += " ";
    result += line;
    if (hardBreak) result += "<br>";
  }
  return result;
}

function legalHeadingLevel(text: string): 1 | 2 | 3 | 4 | null {
  const value = text.trim();
  if (ATTACHMENT_HEADING.test(value) || SIGNATURE_HEADING.test(value) || /^ARTICLE\s+(?:[IVXLCDM]+|\d+)(?:\s+[—–-]\s+.+)?$/.test(value)) return 1;
  if (/^\d+\.\s+[A-Z][A-Z0-9 &'(),/\-–—]+$/.test(value)) return 2;
  if (/^\d+(?:\.\d+)+\s+\S[\s\S]*$/.test(value)) return 4;
  return null;
}

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const content = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of content) {
    if (escaped) {
      cell += character === "|" ? "|" : `\\${character}`;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells.length >= 2 ? cells : null;
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return Boolean(cells?.length && cells.every((cell) => TABLE_SEPARATOR_CELL.test(cell.replace(/\s/g, ""))));
}

function inlinePlainText(content: InlineContent[]): string {
  return content.map((node) => {
    if (node.type === "text") return node.text;
    if (node.type === "hyperlink") return inlinePlainText(node.content);
    return "\n";
  }).join("");
}

export function isSignatureTable(rows: TableBlockRow[]): boolean {
  if (rows.length < 2 || rows[0].cells.length !== 2) return false;
  const header = rows[0].cells.map((cell) => inlinePlainText(cell).trim().toUpperCase());
  const fieldCount = rows.slice(1).flatMap((row) => row.cells)
    .filter((cell) => /^(?:SIGNATURE|NAME|TITLE|DATE)\s*:/i.test(inlinePlainText(cell).trim())).length;
  const namedColumns = header.every((cell) => cell.length > 0) && header[0] !== header[1];
  const knownPartyRole = header.some((cell) => /\b(?:CLIENT|PROVIDER|DEVELOPER|COMPANY|PARTY|CUSTOMER|VENDOR)\b/.test(cell));
  return namedColumns && fieldCount >= 2 && (knownPartyRole || fieldCount >= 4);
}

function parseTable(lines: string[], index: number): { block: DocumentBlock; next: number } | null {
  const headerCells = splitTableRow(lines[index]);
  if (!headerCells || index + 1 >= lines.length || !isTableSeparator(lines[index + 1])) return null;
  const separatorCells = splitTableRow(lines[index + 1]);
  if (!separatorCells || separatorCells.length !== headerCells.length) return null;

  const rawRows: string[][] = [headerCells];
  let cursor = index + 2;
  while (cursor < lines.length && lines[cursor].trim()) {
    const cells = splitTableRow(lines[cursor]);
    if (!cells || cells.length !== headerCells.length) break;
    rawRows.push(cells);
    cursor += 1;
  }
  const rows = rawRows.map((cells) => ({ cells: cells.map(parseInlineMarkdown) }));
  return {
    block: { type: "table", rows, headerRow: true, signatureLayout: isSignatureTable(rows) },
    next: cursor,
  };
}

function indentationLevel(whitespace: string): number {
  const spaces = whitespace.replace(/\t/g, "    ").length;
  return Math.min(MAX_LIST_LEVEL, Math.floor(spaces / 2));
}

function parseList(lines: string[], index: number): { block: DocumentBlock; next: number } | null {
  const first = lines[index].match(LIST_ITEM);
  if (!first || legalHeadingLevel(lines[index])) return null;
  const firstOrdered = Boolean(first[2]);
  const items: ListItem[] = [];
  let cursor = index;
  while (cursor < lines.length && lines[cursor].trim()) {
    const match = lines[cursor].match(LIST_ITEM);
    if (match && !legalHeadingLevel(lines[cursor])) {
      const ordered = Boolean(match[2]);
      items.push({
        content: parseInlineMarkdown(match[4]),
        level: indentationLevel(match[1]),
        ordered,
        marker: match[2] ? Number(match[2]) : undefined,
      });
      cursor += 1;
      continue;
    }
    if (!items.length || EXPLICIT_HEADING.test(lines[cursor]) || FENCE_START.test(lines[cursor]) || isThematicBreak(lines[cursor])) break;
    const continuation = lines[cursor].trim();
    const lastItem = items[items.length - 1];
    lastItem.content = [
      ...lastItem.content,
      { type: "text", text: " " },
      ...parseInlineMarkdown(continuation),
    ];
    cursor += 1;
  }
  if (!items.length) return null;
  if (firstOrdered) {
    return { block: { type: "orderedList", start: Number(first[2]), items }, next: cursor };
  }
  return { block: { type: "unorderedList", items }, next: cursor };
}

function applyPagination(blocks: DocumentBlock[]): DocumentBlock[] {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.type === "heading" && ATTACHMENT_HEADING.test(block.text.trim()) && index > 0) {
      block.pageBreakBefore = true;
    }
    if (block.type === "heading" && SIGNATURE_HEADING.test(block.text.trim()) && index > 0) {
      const previous = blocks[index - 1];
      if (previous?.type === "paragraph" && inlinePlainText(previous.content).trimStart().startsWith("IN WITNESS WHEREOF")) {
        previous.pageBreakBefore = true;
      } else {
        block.pageBreakBefore = true;
      }
    }
    if (block.type === "paragraph" && inlinePlainText(block.content).trimStart().startsWith("IN WITNESS WHEREOF") && index > 0) {
      const next = blocks[index + 1];
      if ((next?.type === "table" && next.signatureLayout) || (next?.type === "heading" && SIGNATURE_HEADING.test(next.text.trim()))) {
        block.pageBreakBefore = true;
        if (next.type === "heading") next.pageBreakBefore = false;
      }
    }
  }
  return blocks;
}

export function parseMarkdownBlocks(markdown: string): DocumentBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: DocumentBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim() || isThematicBreak(line)) {
      index += 1;
      continue;
    }

    const fence = line.match(FENCE_START);
    if (fence) {
      const content: string[] = [];
      const closing = new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      index += 1;
      while (index < lines.length && !closing.test(lines[index])) {
        content.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "codeBlock", text: content.join("\n"), language: fence[2] });
      continue;
    }

    const table = parseTable(lines, index);
    if (table) {
      blocks.push(table.block);
      index = table.next;
      continue;
    }

    const heading = line.match(EXPLICIT_HEADING);
    if (heading) {
      const text = heading[2].trim();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text,
        content: parseInlineMarkdown(text),
      });
      index += 1;
      continue;
    }

    const plainHeadingLevel = legalHeadingLevel(line);
    if (plainHeadingLevel) {
      const text = line.trim();
      blocks.push({ type: "heading", level: plainHeadingLevel, text, content: parseInlineMarkdown(text) });
      index += 1;
      continue;
    }

    const list = parseList(lines, index);
    if (list) {
      blocks.push(list.block);
      index = list.next;
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", content: parseInlineMarkdown(joinSoftWrappedLines(quoteLines)) });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (
        paragraphLines.length
        && (isThematicBreak(lines[index])
          || EXPLICIT_HEADING.test(lines[index])
          || legalHeadingLevel(lines[index])
          || FENCE_START.test(lines[index])
          || parseTable(lines, index)
          || LIST_ITEM.test(lines[index])
          || /^\s{0,3}>/.test(lines[index]))
      ) break;
      paragraphLines.push(lines[index]);
      index += 1;
    }
    if (paragraphLines.length) {
      blocks.push({ type: "paragraph", content: parseInlineMarkdown(joinSoftWrappedLines(paragraphLines)) });
    } else {
      // Defensive progress for malformed constructs that did not produce a block.
      blocks.push({ type: "paragraph", content: parseInlineMarkdown(line.trim()) });
      index += 1;
    }
  }
  return applyPagination(blocks);
}

export const DOCX_MAX_LIST_LEVEL = MAX_LIST_LEVEL;
