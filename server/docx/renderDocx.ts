import {
  AlignmentType,
  BorderStyle,
  Document as DocxDocument,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableBorders,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
  type INumberingOptions,
  type ParagraphChild,
} from "docx";
import type { CompiledDocument } from "../../shared/document/compileDocument.js";
import {
  DOCUMENT_THEME,
  PAGE_HEIGHT_TWIPS,
  PAGE_MARGIN_TWIPS,
  PORTRAIT_PAGE_WIDTH_TWIPS,
} from "../../shared/document/documentTheme.js";
import { contentWidthForOrientation, tableGridWidths } from "../../shared/document/tableLayout.js";
import type {
  DocumentAlignment,
  DocumentBlock,
  DocumentOrientation,
  InlineContent,
  TableBlock,
  TableBlockRow,
} from "../../shared/document/documentTypes.js";
import { inlinePlainText } from "../../shared/document/parseDocument.js";

export const DOCX_STYLE_IDS = {
  title: "ExeptsTitle",
  body: "ExeptsBody",
  quote: "ExeptsBlockquote",
  code: "ExeptsCodeBlock",
} as const;

export type DocxNumberingDefinition = INumberingOptions["config"][number];

const BODY_FONT = DOCUMENT_THEME.font.bodyFamily;
const MONOSPACE_FONT = DOCUMENT_THEME.font.monospaceFamily;
const BODY_SIZE = DOCUMENT_THEME.font.bodySizePt * 2;
const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: DOCUMENT_THEME.table.borderColor } as const;
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;

function headingLevel(level: 1 | 2 | 3 | 4 | 5 | 6): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  return [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][level - 1];
}

function textRun(node: Extract<InlineContent, { type: "text" }>, hyperlink = false, forceBold = false, size = BODY_SIZE): TextRun {
  return new TextRun({
    text: node.text,
    bold: node.bold || forceBold,
    italics: node.italic,
    underline: node.underline ? { type: UnderlineType.SINGLE } : undefined,
    style: hyperlink ? "Hyperlink" : undefined,
    font: node.code ? MONOSPACE_FONT : BODY_FONT,
    size: node.code ? Math.min(20, size) : size,
    shading: node.code ? { type: ShadingType.CLEAR, fill: DOCUMENT_THEME.color.subtleFill, color: "auto" } : undefined,
  });
}

function renderInline(content: InlineContent[], hyperlink = false, forceBold = false, size = BODY_SIZE): ParagraphChild[] {
  return content.flatMap((node): ParagraphChild[] => {
    if (node.type === "text") return [textRun(node, hyperlink, forceBold, size)];
    if (node.type === "hardBreak") return [new TextRun({ break: 1, font: BODY_FONT, size })];
    return [new ExternalHyperlink({ link: node.url, children: renderInline(node.content, true, forceBold, size) })];
  });
}

function numberingReference(blockIndex: number): string {
  return `exepts-ordered-list-${blockIndex + 1}`;
}

export function createNumberingDefinitions(blocks: DocumentBlock[]): DocxNumberingDefinition[] {
  return blocks.flatMap((block, blockIndex) => {
    if ((block.type !== "orderedList" && block.type !== "unorderedList") || !block.items.some((item) => item.ordered)) return [];
    const firstOrdered = block.items.find((item) => item.ordered);
    const start = block.type === "orderedList" ? block.start : firstOrdered?.marker ?? 1;
    return [{
      reference: numberingReference(blockIndex),
      levels: [0, 1, 2].map((level) => ({
        level,
        format: LevelFormat.DECIMAL,
        text: `%${level + 1}.`,
        start: level === 0 ? start : 1,
        alignment: AlignmentType.LEFT,
        style: {
          run: { font: BODY_FONT, size: BODY_SIZE },
          paragraph: { indent: { left: 360 + level * 360, hanging: 240 }, spacing: { after: 80, line: 276 } },
        },
      })),
    }];
  });
}

function renderList(block: Extract<DocumentBlock, { type: "orderedList" | "unorderedList" }>, blockIndex: number): Paragraph[] {
  const reference = block.items.some((item) => item.ordered) ? numberingReference(blockIndex) : null;
  return block.items.map((item) => new Paragraph({
    style: DOCX_STYLE_IDS.body,
    children: renderInline(item.content),
    numbering: item.ordered && reference ? { reference, level: item.level } : undefined,
    bullet: item.ordered ? undefined : { level: item.level },
    spacing: { after: 80, line: 276 },
    widowControl: true,
  }));
}

function alignment(value: DocumentAlignment): (typeof AlignmentType)[keyof typeof AlignmentType] {
  return value === "center" ? AlignmentType.CENTER : value === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT;
}

function tableFontSize(block: TableBlock): number {
  if (block.signatureLayout) return DOCUMENT_THEME.table.signatureSizePt * 2;
  if (block.columns.length === 2) return DOCUMENT_THEME.table.standardSizePt * 2;
  if (block.columns.length <= 4) return 19;
  return Math.max(DOCUMENT_THEME.table.minimumSizePt * 2, DOCUMENT_THEME.table.compactSizePt * 2);
}

export function shouldPreventRowSplit(row: TableBlockRow, table: TableBlock, rowIndex = 1): boolean {
  if (rowIndex < table.headerRows) return true;
  const values = row.cells.map(inlinePlainText);
  const totalLength = values.reduce((sum, value) => sum + value.length, 0);
  const longest = Math.max(0, ...values.map((value) => value.length));
  const hardBreaks = values.reduce((sum, value) => sum + (value.match(/\n/g)?.length ?? 0), 0);
  if (table.signatureLayout) return totalLength <= 360 && longest <= 180 && hardBreaks <= 8;
  return totalLength <= 280 && longest <= 140 && hardBreaks <= 3;
}

function tableCellParagraph(content: InlineContent[], options: {
  bold: boolean;
  signature: boolean;
  rowIndex: number;
  alignment: DocumentAlignment;
  size: number;
}): Paragraph {
  return new Paragraph({
    children: renderInline(content, false, options.bold, options.size),
    alignment: alignment(options.alignment),
    spacing: { before: options.signature && options.rowIndex > 0 ? 80 : 0, after: 0, line: Math.max(216, options.size * 12) },
    widowControl: true,
  });
}

function renderTableRow(row: TableBlockRow, rowIndex: number, block: TableBlock, widths: number[], size: number): TableRow {
  const isHeader = rowIndex < block.headerRows;
  const signature = block.signatureLayout;
  return new TableRow({
    tableHeader: isHeader && !signature,
    cantSplit: shouldPreventRowSplit(row, block, rowIndex) ? true : undefined,
    children: widths.map((width, columnIndex) => new TableCell({
      width: { size: width, type: WidthType.DXA },
      verticalAlign: VerticalAlign.TOP,
      shading: isHeader && !signature ? { type: ShadingType.CLEAR, fill: DOCUMENT_THEME.table.headerFill, color: "auto" } : undefined,
      borders: signature ? { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER } : undefined,
      children: [tableCellParagraph(row.cells[columnIndex] ?? [{ type: "text", text: "" }], {
        bold: isHeader,
        signature,
        rowIndex,
        alignment: block.columns[columnIndex]?.alignment ?? "left",
        size,
      })],
    })),
  });
}

function renderTable(block: TableBlock): Table {
  const totalWidth = contentWidthForOrientation(block.orientation);
  const widths = tableGridWidths(block.columns, totalWidth);
  const size = tableFontSize(block);
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.AUTOFIT,
    borders: block.signatureLayout ? TableBorders.NONE : {
      top: TABLE_BORDER,
      bottom: TABLE_BORDER,
      left: TABLE_BORDER,
      right: TABLE_BORDER,
      insideHorizontal: TABLE_BORDER,
      insideVertical: TABLE_BORDER,
    },
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
    rows: block.rows.map((row, index) => renderTableRow(row, index, block, widths, size)),
  });
}

function renderCodeBlock(text: string): Paragraph {
  const children: ParagraphChild[] = [];
  text.split("\n").forEach((line, index) => {
    if (index > 0) children.push(new TextRun({ break: 1 }));
    children.push(new TextRun({ text: line, font: MONOSPACE_FONT, size: 19 }));
  });
  if (!children.length) children.push(new TextRun({ text: "", font: MONOSPACE_FONT, size: 19 }));
  return new Paragraph({ style: DOCX_STYLE_IDS.code, children });
}

function renderBlock(block: DocumentBlock, blockIndex: number): Array<Paragraph | Table> {
  switch (block.type) {
    case "heading":
      return [new Paragraph({ heading: headingLevel(block.level), children: renderInline(block.content, false, true), pageBreakBefore: block.pageBreakBefore, keepNext: true, keepLines: true, widowControl: true })];
    case "paragraph":
      return [new Paragraph({ style: DOCX_STYLE_IDS.body, children: renderInline(block.content), pageBreakBefore: block.pageBreakBefore, widowControl: true })];
    case "orderedList":
    case "unorderedList":
      return renderList(block, blockIndex);
    case "blockquote":
      return [new Paragraph({ style: DOCX_STYLE_IDS.quote, children: renderInline(block.content) })];
    case "table":
      return [renderTable(block)];
    case "codeBlock":
      return [renderCodeBlock(block.text)];
    case "pageBreak":
      return [new Paragraph({ children: [new PageBreak()] })];
  }
}

function truncateHeaderTitle(title: string, limit = 90): string {
  const compact = title.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  const shortened = compact.slice(0, limit - 1);
  const boundary = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, boundary >= Math.floor(limit * 0.65) ? boundary : shortened.length).trimEnd()}…`;
}

function pageFooter(): Footer {
  return new Footer({ children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], font: BODY_FONT, size: 18, color: DOCUMENT_THEME.color.muted })],
  })] });
}

function pageHeaders(title: string, includeFirst: boolean) {
  return {
    ...(includeFirst ? { first: new Header({ children: [new Paragraph({ children: [] })] }) } : {}),
    default: new Header({ children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: truncateHeaderTitle(title), font: BODY_FONT, size: 18, color: DOCUMENT_THEME.color.muted })],
    })] }),
  };
}

type SectionGroup = { orientation: DocumentOrientation; entries: Array<{ block: DocumentBlock; index: number }> };

function sectionGroups(blocks: DocumentBlock[]): SectionGroup[] {
  const groups: SectionGroup[] = [{ orientation: "portrait", entries: [] }];
  for (const [index, block] of blocks.entries()) {
    const orientation = block.type === "table" ? block.orientation : "portrait";
    let current = groups[groups.length - 1];
    if (orientation === "landscape" && current.orientation === "portrait") {
      const previous = current.entries[current.entries.length - 1];
      const moveHeading = previous?.block.type === "heading" && !previous.block.pageBreakBefore ? current.entries.pop() : undefined;
      current = { orientation: "landscape", entries: moveHeading ? [moveHeading] : [] };
      groups.push(current);
    } else if (orientation === "portrait" && current.orientation === "landscape") {
      current = { orientation: "portrait", entries: [] };
      groups.push(current);
    }
    current.entries.push({ block, index });
  }
  return groups.filter((group, index) => index === 0 || group.entries.length > 0);
}

export function renderDocx(compiled: CompiledDocument): DocxDocument {
  const numbering = createNumberingDefinitions(compiled.blocks);
  const footer = pageFooter();
  const groups = sectionGroups(compiled.blocks);
  return new DocxDocument({
    title: compiled.title,
    features: { updateFields: true },
    numbering: { config: numbering },
    styles: {
      default: {
        document: { run: { font: BODY_FONT, size: BODY_SIZE, color: DOCUMENT_THEME.color.text }, paragraph: { spacing: { after: 120, line: 276 } } },
        title: { run: { font: BODY_FONT, size: 32, bold: true, color: DOCUMENT_THEME.color.text }, paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 300 }, keepNext: true, keepLines: true } },
        heading1: { run: { font: BODY_FONT, size: 28, bold: true, color: DOCUMENT_THEME.color.text }, paragraph: { spacing: { before: 300, after: 140 }, keepNext: true, keepLines: true, outlineLevel: 0 } },
        heading2: { run: { font: BODY_FONT, size: 25, bold: true, color: DOCUMENT_THEME.color.text }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, keepLines: true, outlineLevel: 1 } },
        heading3: { run: { font: BODY_FONT, size: 23, bold: true, color: DOCUMENT_THEME.color.text }, paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, keepLines: true, outlineLevel: 2 } },
        heading4: { run: { font: BODY_FONT, size: 22, bold: true, color: DOCUMENT_THEME.color.text }, paragraph: { spacing: { before: 180, after: 80 }, keepNext: true, keepLines: true, outlineLevel: 3 } },
        heading5: { run: { font: BODY_FONT, size: 21, bold: true, color: DOCUMENT_THEME.color.text }, paragraph: { spacing: { before: 160, after: 70 }, keepNext: true, keepLines: true, outlineLevel: 4 } },
        heading6: { run: { font: BODY_FONT, size: 20, bold: true, color: DOCUMENT_THEME.color.text }, paragraph: { spacing: { before: 140, after: 60 }, keepNext: true, keepLines: true, outlineLevel: 5 } },
        hyperlink: { run: { color: "0563C1", underline: { type: UnderlineType.SINGLE } } },
      },
      paragraphStyles: [
        { id: DOCX_STYLE_IDS.title, name: "Exepts Document Title", basedOn: "Title", next: DOCX_STYLE_IDS.body, quickFormat: true, run: { font: BODY_FONT, size: 32, bold: true, color: DOCUMENT_THEME.color.text }, paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 300 }, keepNext: true, keepLines: true } },
        { id: DOCX_STYLE_IDS.body, name: "Exepts Body", basedOn: "Normal", quickFormat: true, run: { font: BODY_FONT, size: BODY_SIZE, color: DOCUMENT_THEME.color.text }, paragraph: { spacing: { after: 120, line: 276 } } },
        { id: DOCX_STYLE_IDS.quote, name: "Exepts Block Quote", basedOn: DOCX_STYLE_IDS.body, run: { font: BODY_FONT, size: 21, color: "333333" }, paragraph: { indent: { left: 420, right: 180 }, border: { left: { style: BorderStyle.SINGLE, size: 10, color: "A6A6A6", space: 10 } }, spacing: { before: 100, after: 140, line: 276 } } },
        { id: DOCX_STYLE_IDS.code, name: "Exepts Code Block", basedOn: DOCX_STYLE_IDS.body, run: { font: MONOSPACE_FONT, size: 19, color: "222222" }, paragraph: { shading: { type: ShadingType.CLEAR, fill: DOCUMENT_THEME.color.subtleFill, color: "auto" }, border: { top: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" }, bottom: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" }, left: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" }, right: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" } }, indent: { left: 180, right: 180 }, spacing: { before: 100, after: 140, line: 240 } } },
      ],
    },
    sections: groups.map((group, sectionIndex) => {
      const first = sectionIndex === 0;
      const landscape = group.orientation === "landscape";
      const children: Array<Paragraph | Table> = [];
      if (first) children.push(new Paragraph({ style: DOCX_STYLE_IDS.title, children: [new TextRun({ text: compiled.title, bold: true, font: BODY_FONT, size: 32 })], alignment: AlignmentType.CENTER, keepNext: true, keepLines: true }));
      children.push(...group.entries.flatMap(({ block, index }) => renderBlock(block, index)));
      return {
        properties: {
          ...(first ? { titlePage: true } : { type: SectionType.NEXT_PAGE }),
          page: {
            // docx swaps the supplied Letter dimensions when landscape orientation is set.
            size: { width: PORTRAIT_PAGE_WIDTH_TWIPS, height: PAGE_HEIGHT_TWIPS, orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            margin: { top: PAGE_MARGIN_TWIPS, right: PAGE_MARGIN_TWIPS, bottom: PAGE_MARGIN_TWIPS, left: PAGE_MARGIN_TWIPS, header: 620, footer: 620 },
          },
        },
        headers: pageHeaders(compiled.title, first),
        footers: { ...(first ? { first: footer } : {}), default: footer },
        children,
      };
    }),
  });
}
