import { Extension, type Editor, type JSONContent } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { selectedRect, TableMap } from "@tiptap/pm/tables";
import { isSafeDocumentUrl } from "./documentEditorCodec.js";

const documentCellAttributes = {
  colspan: { default: 1, parseHTML: () => 1, rendered: false },
  rowspan: { default: 1, parseHTML: () => 1, rendered: false },
  colwidth: { default: null, parseHTML: () => null, rendered: false },
  alignment: {
    default: "left",
    parseHTML: (element: HTMLElement) => element.getAttribute("data-alignment") || "left",
    renderHTML: (attributes: Record<string, unknown>) => ({ "data-alignment": attributes.alignment }),
  },
  columnKind: {
    default: "text",
    parseHTML: (element: HTMLElement) => element.getAttribute("data-column-kind") || "text",
    renderHTML: (attributes: Record<string, unknown>) => ({ "data-column-kind": attributes.columnKind }),
  },
  widthWeight: {
    default: null,
    parseHTML: (element: HTMLElement) => Number(element.getAttribute("data-width-weight")) || null,
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = Number(attributes.widthWeight);
      return Number.isFinite(value) && value > 0 ? { "data-width-weight": String(value), style: `width: ${(value * 100).toFixed(2)}%` } : {};
    },
  },
};

const DocumentTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      layout: { default: "standard", parseHTML: (element) => element.getAttribute("data-layout") || "standard", renderHTML: (attrs) => ({ "data-layout": attrs.layout }) },
      orientation: { default: "portrait", parseHTML: (element) => element.getAttribute("data-orientation") || "portrait", renderHTML: (attrs) => ({ "data-orientation": attrs.orientation }) },
      signatureLayout: { default: false, parseHTML: (element) => element.getAttribute("data-signature-layout") === "true", renderHTML: (attrs) => ({ "data-signature-layout": attrs.signatureLayout ? "true" : "false" }) },
      columnWidths: { default: null, rendered: false },
    };
  },
});

const DocumentTableCell = TableCell.extend({ content: "paragraph", addAttributes() { return { ...this.parent?.(), ...documentCellAttributes }; } });
const DocumentTableHeader = TableHeader.extend({ content: "paragraph", addAttributes() { return { ...this.parent?.(), ...documentCellAttributes }; } });
const CodeBlockLanguage = Extension.create({
  name: "exeptsCodeBlockLanguage",
  addGlobalAttributes() {
    return [{ types: ["codeBlock"], attributes: { language: { default: null, parseHTML: (element) => element.getAttribute("data-language"), renderHTML: (attributes) => attributes.language ? { "data-language": attributes.language } : {} } } }];
  },
});

export const documentEditorExtensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, link: false, underline: false }),
  Underline,
  Link.configure({
    autolink: false,
    linkOnPaste: true,
    openOnClick: false,
    protocols: ["http", "https", "mailto"],
    isAllowedUri: (url) => isSafeDocumentUrl(url),
    HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
  }),
  DocumentTable.configure({ resizable: false, allowTableNodeSelection: true, HTMLAttributes: { class: "document-editor-table" } }),
  TableRow,
  DocumentTableHeader,
  DocumentTableCell,
  CodeBlockLanguage,
];

export function setSelectedTableColumnAlignment(editor: Editor, alignment: "left" | "center" | "right"): boolean {
  if (!editor.isActive("table")) return false;
  const { state } = editor.view;
  const rect = selectedRect(state);
  const map = TableMap.get(rect.table);
  let transaction = state.tr;
  for (let row = 0; row < map.height; row += 1) {
    const position = rect.tableStart + map.positionAt(row, rect.left, rect.table);
    const cell = transaction.doc.nodeAt(position);
    if (cell) transaction = transaction.setNodeMarkup(position, undefined, { ...cell.attrs, alignment });
  }
  if (!transaction.docChanged) return false;
  editor.view.dispatch(transaction);
  editor.view.focus();
  return true;
}

export function readableCellPaste(text: string): JSONContent[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines.flatMap((line, index): JSONContent[] => [...(index ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])]);
}
