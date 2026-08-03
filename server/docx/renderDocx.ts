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
import type { DocumentBlock, InlineContent, TableBlockRow } from "./documentTypes.js";

export const DOCX_STYLE_IDS = {
  title: "ExeptsTitle",
  body: "ExeptsBody",
  quote: "ExeptsBlockquote",
  code: "ExeptsCodeBlock",
} as const;

export type DocxNumberingDefinition = INumberingOptions["config"][number];

const BODY_FONT = "Arial";
const MONOSPACE_FONT = "Courier New";
const BODY_SIZE = 22;
const NEUTRAL_GRAY = "666666";
const LIGHT_GRAY = "EDEDED";
const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "B7B7B7" } as const;
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;

function headingLevel(level: 1 | 2 | 3 | 4 | 5 | 6): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  return [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ][level - 1];
}

function textRun(node: Extract<InlineContent, { type: "text" }>, hyperlink = false, forceBold = false): TextRun {
  return new TextRun({
    text: node.text,
    bold: node.bold || forceBold,
    italics: node.italic,
    underline: node.underline ? { type: UnderlineType.SINGLE } : undefined,
    style: hyperlink ? "Hyperlink" : undefined,
    font: node.code ? MONOSPACE_FONT : BODY_FONT,
    size: node.code ? 20 : BODY_SIZE,
    shading: node.code ? { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" } : undefined,
  });
}

function renderInline(content: InlineContent[], hyperlink = false, forceBold = false): ParagraphChild[] {
  return content.flatMap((node): ParagraphChild[] => {
    if (node.type === "text") return [textRun(node, hyperlink, forceBold)];
    if (node.type === "hardBreak") return [new TextRun({ break: 1 })];
    const children = renderInline(node.content, true, forceBold);
    return [new ExternalHyperlink({ link: node.url, children })];
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
          paragraph: {
            indent: { left: 360 + level * 360, hanging: 240 },
            spacing: { after: 80, line: 276 },
          },
        },
      })),
    }];
  });
}

function renderList(block: Extract<DocumentBlock, { type: "orderedList" | "unorderedList" }>, blockIndex: number): Paragraph[] {
  const hasOrderedItems = block.items.some((item) => item.ordered);
  const reference = hasOrderedItems ? numberingReference(blockIndex) : null;
  return block.items.map((item) => new Paragraph({
    style: DOCX_STYLE_IDS.body,
    children: renderInline(item.content),
    numbering: item.ordered && reference ? { reference, level: item.level } : undefined,
    bullet: item.ordered ? undefined : { level: item.level },
    spacing: { after: 80, line: 276 },
    widowControl: true,
  }));
}

function tableCellParagraph(content: InlineContent[], bold: boolean, signature: boolean, rowIndex: number): Paragraph {
  return new Paragraph({
    style: DOCX_STYLE_IDS.body,
    children: renderInline(content, false, bold),
    spacing: {
      before: signature && rowIndex > 0 ? 100 : 0,
      after: signature ? 100 : 60,
      line: 252,
    },
    keepLines: true,
    widowControl: true,
  });
}

function renderTableRow(row: TableBlockRow, rowIndex: number, columnCount: number, signature: boolean): TableRow {
  const isHeader = rowIndex === 0;
  const width = Math.floor(100 / Math.max(1, columnCount));
  return new TableRow({
    tableHeader: isHeader && !signature,
    cantSplit: true,
    children: row.cells.map((content) => new TableCell({
      width: { size: width, type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.TOP,
      shading: isHeader && !signature ? { type: ShadingType.CLEAR, fill: LIGHT_GRAY, color: "auto" } : undefined,
      borders: signature ? {
        top: NO_BORDER,
        bottom: NO_BORDER,
        left: NO_BORDER,
        right: NO_BORDER,
      } : undefined,
      children: [tableCellParagraph(content, isHeader, signature, rowIndex)],
    })),
  });
}

function renderTable(block: Extract<DocumentBlock, { type: "table" }>): Table {
  const columnCount = Math.max(1, ...block.rows.map((row) => row.cells.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: block.signatureLayout ? TableBorders.NONE : {
      top: TABLE_BORDER,
      bottom: TABLE_BORDER,
      left: TABLE_BORDER,
      right: TABLE_BORDER,
      insideHorizontal: TABLE_BORDER,
      insideVertical: TABLE_BORDER,
    },
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
    rows: block.rows.map((row, index) => renderTableRow(row, index, columnCount, block.signatureLayout)),
  });
}

function renderCodeBlock(text: string): Paragraph {
  const children: ParagraphChild[] = [];
  text.split("\n").forEach((line, index) => {
    if (index > 0) children.push(new TextRun({ break: 1 }));
    children.push(new TextRun({ text: line, font: MONOSPACE_FONT, size: 19 }));
  });
  if (!children.length) children.push(new TextRun({ text: "", font: MONOSPACE_FONT, size: 19 }));
  return new Paragraph({ style: DOCX_STYLE_IDS.code, children, keepLines: true });
}

function renderBlock(block: DocumentBlock, blockIndex: number): Array<Paragraph | Table> {
  switch (block.type) {
    case "heading":
      return [new Paragraph({
        heading: headingLevel(block.level),
        children: renderInline(block.content, false, true),
        pageBreakBefore: block.pageBreakBefore,
        keepNext: true,
        keepLines: true,
        widowControl: true,
      })];
    case "paragraph":
      return [new Paragraph({
        style: DOCX_STYLE_IDS.body,
        children: renderInline(block.content),
        pageBreakBefore: block.pageBreakBefore,
        widowControl: true,
      })];
    case "orderedList":
    case "unorderedList":
      return renderList(block, blockIndex);
    case "blockquote":
      return [new Paragraph({ style: DOCX_STYLE_IDS.quote, children: renderInline(block.content), keepLines: true })];
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
  const wordBoundary = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, wordBoundary >= Math.floor(limit * 0.65) ? wordBoundary : shortened.length).trimEnd()}…`;
}

function footer(): Footer {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES],
        font: BODY_FONT,
        size: 18,
        color: NEUTRAL_GRAY,
      })],
    })],
  });
}

export function renderDocx(title: string, blocks: DocumentBlock[]): DocxDocument {
  const numbering = createNumberingDefinitions(blocks);
  const headerTitle = truncateHeaderTitle(title);
  const pageFooter = footer();
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      style: DOCX_STYLE_IDS.title,
      children: [new TextRun({ text: title, bold: true, font: BODY_FONT, size: 32 })],
      alignment: AlignmentType.CENTER,
      keepNext: true,
      keepLines: true,
    }),
    ...blocks.flatMap(renderBlock),
  ];

  return new DocxDocument({
    title,
    features: { updateFields: true },
    numbering: { config: numbering },
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: BODY_SIZE, color: "000000" },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
        title: {
          run: { font: BODY_FONT, size: 32, bold: true, color: "000000" },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 300 }, keepNext: true, keepLines: true },
        },
        heading1: {
          run: { font: BODY_FONT, size: 28, bold: true, color: "000000" },
          paragraph: { spacing: { before: 300, after: 140 }, keepNext: true, keepLines: true, outlineLevel: 0 },
        },
        heading2: {
          run: { font: BODY_FONT, size: 25, bold: true, color: "000000" },
          paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, keepLines: true, outlineLevel: 1 },
        },
        heading3: {
          run: { font: BODY_FONT, size: 23, bold: true, color: "000000" },
          paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, keepLines: true, outlineLevel: 2 },
        },
        heading4: {
          run: { font: BODY_FONT, size: 22, bold: true, color: "000000" },
          paragraph: { spacing: { before: 180, after: 80 }, keepNext: true, keepLines: true, outlineLevel: 3 },
        },
        heading5: {
          run: { font: BODY_FONT, size: 21, bold: true, color: "000000" },
          paragraph: { spacing: { before: 160, after: 70 }, keepNext: true, keepLines: true, outlineLevel: 4 },
        },
        heading6: {
          run: { font: BODY_FONT, size: 20, bold: true, color: "000000" },
          paragraph: { spacing: { before: 140, after: 60 }, keepNext: true, keepLines: true, outlineLevel: 5 },
        },
        hyperlink: {
          run: { color: "0563C1", underline: { type: UnderlineType.SINGLE } },
        },
      },
      paragraphStyles: [
        {
          id: DOCX_STYLE_IDS.title,
          name: "Exepts Document Title",
          basedOn: "Title",
          next: DOCX_STYLE_IDS.body,
          quickFormat: true,
          run: { font: BODY_FONT, size: 32, bold: true, color: "000000" },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 300 }, keepNext: true, keepLines: true },
        },
        {
          id: DOCX_STYLE_IDS.body,
          name: "Exepts Body",
          basedOn: "Normal",
          quickFormat: true,
          run: { font: BODY_FONT, size: BODY_SIZE, color: "000000" },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
        {
          id: DOCX_STYLE_IDS.quote,
          name: "Exepts Block Quote",
          basedOn: DOCX_STYLE_IDS.body,
          run: { font: BODY_FONT, size: 21, color: "333333" },
          paragraph: {
            indent: { left: 420, right: 180 },
            border: { left: { style: BorderStyle.SINGLE, size: 10, color: "A6A6A6", space: 10 } },
            spacing: { before: 100, after: 140, line: 276 },
          },
        },
        {
          id: DOCX_STYLE_IDS.code,
          name: "Exepts Code Block",
          basedOn: DOCX_STYLE_IDS.body,
          run: { font: MONOSPACE_FONT, size: 19, color: "222222" },
          paragraph: {
            shading: { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" },
            border: {
              top: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" },
              bottom: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" },
              left: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" },
              right: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" },
            },
            indent: { left: 180, right: 180 },
            spacing: { before: 100, after: 140, line: 240 },
          },
        },
      ],
    },
    sections: [{
      properties: {
        titlePage: true,
        page: {
          size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
          margin: { top: 1296, right: 1296, bottom: 1296, left: 1296, header: 620, footer: 620 },
        },
      },
      headers: {
        first: new Header({ children: [new Paragraph({ children: [] })] }),
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: headerTitle, font: BODY_FONT, size: 18, color: NEUTRAL_GRAY })],
          })],
        }),
      },
      footers: { first: pageFooter, default: pageFooter },
      children,
    }],
  });
}
