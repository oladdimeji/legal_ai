export type InlineText = {
  type: "text";
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  code?: boolean;
};

export type InlineHyperlink = {
  type: "hyperlink";
  url: string;
  content: InlineContent[];
};

export type InlineContent = InlineText | InlineHyperlink | { type: "hardBreak" };

export type ListItem = {
  content: InlineContent[];
  level: number;
  ordered: boolean;
  marker?: number;
};

export type TableBlockRow = {
  cells: InlineContent[][];
};

export type DocumentBlock =
  | {
      type: "heading";
      level: 1 | 2 | 3 | 4 | 5 | 6;
      text: string;
      content: InlineContent[];
      pageBreakBefore?: boolean;
    }
  | {
      type: "paragraph";
      content: InlineContent[];
      pageBreakBefore?: boolean;
    }
  | {
      type: "orderedList";
      start: number;
      items: ListItem[];
    }
  | {
      type: "unorderedList";
      items: ListItem[];
    }
  | {
      type: "blockquote";
      content: InlineContent[];
    }
  | {
      type: "table";
      rows: TableBlockRow[];
      headerRow: boolean;
      signatureLayout: boolean;
    }
  | {
      type: "codeBlock";
      text: string;
      language?: string;
    }
  | {
      type: "pageBreak";
    };

export type MarkdownDocument = {
  blocks: DocumentBlock[];
};
