import type { JSONContent } from "@tiptap/core";
import type { CompiledDocument } from "../../shared/document/compileDocument.js";
import { compileDocument } from "../../shared/document/compileDocument.js";
import type { DocumentBlock, InlineContent, ListItem, TableBlock } from "../../shared/document/documentTypes.js";

type EditorMark = NonNullable<JSONContent["marks"]>[number];
type ListTreeItem = ListItem & { children: ListTreeItem[] };

export function isSafeDocumentUrl(value: unknown): value is string {
  if (typeof value !== "string" || /[\r\n]/.test(value)) return false;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(value.trim())) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function inlineToEditor(content: InlineContent[], inheritedMarks: EditorMark[] = []): JSONContent[] {
  return content.flatMap((node): JSONContent[] => {
    if (node.type === "hardBreak") return [{ type: "hardBreak" }];
    if (node.type === "hyperlink") {
      if (!isSafeDocumentUrl(node.url)) return inlineToEditor(node.content, inheritedMarks);
      return inlineToEditor(node.content, [...inheritedMarks, { type: "link", attrs: { href: node.url } }]);
    }
    const marks: EditorMark[] = [...inheritedMarks];
    if (node.bold) marks.push({ type: "bold" });
    if (node.italic) marks.push({ type: "italic" });
    if (node.underline) marks.push({ type: "underline" });
    if (node.code) marks.push({ type: "code" });
    return node.text ? [{ type: "text", text: node.text, ...(marks.length ? { marks } : {}) }] : [];
  });
}

function paragraph(content: InlineContent[]): JSONContent {
  return { type: "paragraph", content: inlineToEditor(content) };
}

function listTree(items: ListItem[]): ListTreeItem[] {
  const roots: ListTreeItem[] = [];
  const stack: ListTreeItem[] = [];
  for (const item of items) {
    const node: ListTreeItem = { ...item, children: [] };
    while (stack.length > item.level) stack.pop();
    const parent = item.level > 0 ? stack[item.level - 1] : undefined;
    (parent?.children ?? roots).push(node);
    stack[item.level] = node;
    stack.length = item.level + 1;
  }
  return roots;
}

function listGroups(items: ListTreeItem[]): JSONContent[] {
  const groups: JSONContent[] = [];
  for (let index = 0; index < items.length;) {
    const ordered = items[index].ordered;
    const group: ListTreeItem[] = [];
    while (index < items.length && items[index].ordered === ordered) group.push(items[index++]);
    groups.push({
      type: ordered ? "orderedList" : "bulletList",
      ...(ordered ? { attrs: { start: group[0].marker ?? 1 } } : {}),
      content: group.map((item) => ({ type: "listItem", content: [paragraph(item.content), ...listGroups(item.children)] })),
    });
  }
  return groups;
}

function tableToEditor(table: TableBlock): JSONContent {
  return {
    type: "table",
    attrs: {
      layout: table.layout,
      orientation: table.orientation,
      signatureLayout: table.signatureLayout,
      columnWidths: table.columns.map((column) => column.widthWeight),
    },
    content: table.rows.map((row, rowIndex) => ({
      type: "tableRow",
      content: Array.from({ length: table.columns.length }, (_, columnIndex) => ({
        type: rowIndex < table.headerRows && !table.signatureLayout ? "tableHeader" : "tableCell",
        attrs: {
          colspan: 1,
          rowspan: 1,
          colwidth: null,
          alignment: table.columns[columnIndex].alignment,
          columnKind: table.columns[columnIndex].kind,
          widthWeight: table.columns[columnIndex].widthWeight,
        },
        content: [paragraph(row.cells[columnIndex] ?? [{ type: "text", text: "" }])],
      })),
    })),
  };
}

function blockToEditor(block: DocumentBlock): JSONContent[] {
  switch (block.type) {
    case "heading": return [{ type: "heading", attrs: { level: block.level }, content: inlineToEditor(block.content) }];
    case "paragraph": return [paragraph(block.content)];
    case "orderedList":
    case "unorderedList": return listGroups(listTree(block.items));
    case "blockquote": return [{ type: "blockquote", content: [paragraph(block.content)] }];
    case "codeBlock": return [{ type: "codeBlock", attrs: { language: block.language ?? null }, content: block.text ? [{ type: "text", text: block.text }] : [] }];
    case "table": return [tableToEditor(block)];
    case "pageBreak": return [];
  }
}

export function compiledDocumentToEditorJson(compiled: CompiledDocument): JSONContent {
  return { type: "doc", content: compiled.blocks.flatMap(blockToEditor) };
}

export function markdownToEditorDocument(title: string, markdown: string): JSONContent {
  return compiledDocumentToEditorJson(compileDocument(title, markdown));
}

function markName(mark: EditorMark): string {
  return typeof mark.type === "string" ? mark.type : "";
}

function longestBacktickRun(value: string): number {
  return Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length));
}

function escapeInlineText(value: string, tableCell: boolean): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/([*_`\[\]])/g, "\\$1");
  return tableCell ? escaped.replace(/\|/g, "\\|") : escaped;
}

function serializeInlineNode(node: JSONContent, tableCell: boolean): string {
  if (node.type === "hardBreak") return tableCell ? "<br>" : "  \n";
  if (node.type !== "text") return (node.content ?? []).map((child) => serializeInlineNode(child, tableCell)).join("");
  const marks = node.marks ?? [];
  const code = marks.some((mark) => markName(mark) === "code");
  let result: string;
  if (code) {
    const delimiter = "`".repeat(longestBacktickRun(node.text ?? "") + 1);
    const value = node.text ?? "";
    const padding = value.startsWith("`") || value.endsWith("`") || /^\s|\s$/.test(value) ? " " : "";
    result = `${delimiter}${padding}${value}${padding}${delimiter}`;
  } else {
    result = escapeInlineText(node.text ?? "", tableCell);
  }
  if (marks.some((mark) => markName(mark) === "underline")) result = `<u>${result}</u>`;
  if (marks.some((mark) => markName(mark) === "italic")) result = `_${result}_`;
  if (marks.some((mark) => markName(mark) === "bold")) result = `**${result}**`;
  const link = marks.find((mark) => markName(mark) === "link");
  const href = link?.attrs?.href;
  if (isSafeDocumentUrl(href)) result = `[${result}](${href})`;
  return result;
}

function serializeInline(nodes: JSONContent[] | undefined, tableCell = false): string {
  return (nodes ?? []).map((node) => serializeInlineNode(node, tableCell)).join("");
}

function readableInline(node: JSONContent): JSONContent[] {
  if (node.type === "text" || node.type === "hardBreak") return [node];
  const output: JSONContent[] = [];
  for (const child of node.content ?? []) {
    const nested = readableInline(child);
    if (output.length && nested.length && output[output.length - 1].type !== "hardBreak") output.push({ type: "hardBreak" });
    output.push(...nested);
  }
  return output;
}

function tableCellMarkdown(cell: JSONContent): string {
  const blocks = cell.content ?? [];
  const inline: JSONContent[] = [];
  blocks.forEach((block, index) => {
    if (index) inline.push({ type: "hardBreak" });
    if (block.type === "paragraph") inline.push(...(block.content ?? []));
    else inline.push(...readableInline(block));
  });
  return serializeInline(inline, true);
}

function tableAlignment(cell: JSONContent | undefined): "left" | "center" | "right" {
  const value = cell?.attrs?.alignment;
  return value === "center" || value === "right" ? value : "left";
}

function serializeTable(node: JSONContent): string {
  const rows = (node.content ?? []).filter((row) => row.type === "tableRow");
  if (!rows.length) return "";
  const columnCount = Math.max(1, ...rows.map((row) => row.content?.length ?? 0));
  const normalized = rows.map((row) => Array.from({ length: columnCount }, (_, index) => tableCellMarkdown(row.content?.[index] ?? { type: "tableCell", content: [] })));
  const alignments = Array.from({ length: columnCount }, (_, index) => tableAlignment(rows[0].content?.[index]));
  const separator = alignments.map((alignment) => alignment === "center" ? ":---:" : alignment === "right" ? "---:" : ":---");
  const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [row(normalized[0]), row(separator), ...normalized.slice(1).map(row)].join("\n");
}

function serializeList(node: JSONContent, depth = 0): string {
  const ordered = node.type === "orderedList";
  let counter = Number(node.attrs?.start) || 1;
  const lines: string[] = [];
  for (const item of node.content ?? []) {
    const content = item.content ?? [];
    const first = content.find((child) => child.type === "paragraph");
    const prefix = ordered ? `${counter}. ` : "- ";
    lines.push(`${"    ".repeat(depth)}${prefix}${serializeInline(first?.content)}`);
    for (const child of content.filter((entry) => entry.type === "orderedList" || entry.type === "bulletList")) lines.push(serializeList(child, depth + 1));
    counter += 1;
  }
  return lines.join("\n");
}

function codeFence(value: string): string {
  return "`".repeat(Math.max(3, longestBacktickRun(value) + 1));
}

function serializeBlock(node: JSONContent): string {
  switch (node.type) {
    case "heading": return `${"#".repeat(Math.min(6, Math.max(1, Number(node.attrs?.level) || 1)))} ${serializeInline(node.content)}`;
    case "paragraph": return serializeInline(node.content);
    case "orderedList":
    case "bulletList": return serializeList(node);
    case "blockquote": return (node.content ?? []).map(serializeBlock).join("\n").split("\n").map((line) => `> ${line}`).join("\n");
    case "codeBlock": {
      const value = node.content?.map((child) => child.text ?? "").join("") ?? "";
      const fence = codeFence(value);
      const language = typeof node.attrs?.language === "string" ? node.attrs.language.replace(/[^\w+-]/g, "") : "";
      return `${fence}${language}\n${value}\n${fence}`;
    }
    case "table": return serializeTable(node);
    default: return serializeInline(readableInline(node));
  }
}

export function editorJsonToMarkdown(document: JSONContent): string {
  return (document.content ?? []).map(serializeBlock).filter((value) => value.length > 0).join("\n\n").trim();
}

export function normalizeEditorMarkdown(title: string, document: JSONContent): string {
  return compileDocument(title, editorJsonToMarkdown(document)).normalizedMarkdown;
}

export function shouldApplyExternalEditorValue(value: string, lastEmitted: string | null, currentValue: string): boolean {
  return value !== lastEmitted && value !== currentValue;
}

export function setTableColumnAlignmentInJson(document: JSONContent, tableIndex: number, columnIndex: number, alignment: "left" | "center" | "right"): JSONContent {
  let seen = -1;
  const visit = (node: JSONContent): JSONContent => {
    if (node.type === "table") {
      seen += 1;
      if (seen === tableIndex) return { ...node, content: (node.content ?? []).map((row) => ({ ...row, content: (row.content ?? []).map((cell, index) => index === columnIndex ? { ...cell, attrs: { ...cell.attrs, alignment } } : cell) })) };
    }
    return { ...node, ...(node.content ? { content: node.content.map(visit) } : {}) };
  };
  return visit(document);
}
