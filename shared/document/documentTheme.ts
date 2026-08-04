export const PORTRAIT_PAGE_WIDTH_TWIPS = 12240;
export const LANDSCAPE_PAGE_WIDTH_TWIPS = 15840;
export const PAGE_HEIGHT_TWIPS = 15840;
export const LANDSCAPE_PAGE_HEIGHT_TWIPS = 12240;
export const PAGE_MARGIN_TWIPS = 1296;
export const PORTRAIT_CONTENT_WIDTH_TWIPS = PORTRAIT_PAGE_WIDTH_TWIPS - PAGE_MARGIN_TWIPS * 2;
export const LANDSCAPE_CONTENT_WIDTH_TWIPS = LANDSCAPE_PAGE_WIDTH_TWIPS - PAGE_MARGIN_TWIPS * 2;

export const DOCUMENT_THEME = {
  page: { size: "letter", marginInches: 0.9 },
  font: { bodyFamily: "Arial", monospaceFamily: "Courier New", bodySizePt: 11 },
  color: { text: "000000", muted: "666666", subtleFill: "F2F2F2" },
  table: {
    standardSizePt: 10,
    compactSizePt: 9,
    minimumSizePt: 8.5,
    signatureSizePt: 10,
    headerFill: "EDEDED",
    borderColor: "B7B7B7",
  },
} as const;

