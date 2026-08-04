export const PORTRAIT_PAGE_WIDTH_TWIPS = 12240;
export const LANDSCAPE_PAGE_WIDTH_TWIPS = 15840;
export const PAGE_HEIGHT_TWIPS = 15840;
export const LANDSCAPE_PAGE_HEIGHT_TWIPS = 12240;
export const PAGE_MARGIN_TWIPS = 1296;
export const PORTRAIT_CONTENT_WIDTH_TWIPS = PORTRAIT_PAGE_WIDTH_TWIPS - PAGE_MARGIN_TWIPS * 2;
export const LANDSCAPE_CONTENT_WIDTH_TWIPS = LANDSCAPE_PAGE_WIDTH_TWIPS - PAGE_MARGIN_TWIPS * 2;

export const DOCUMENT_THEME = {
  page: {
    size: "letter",
    marginInches: 0.9,
    portraitWidthInches: 8.5,
    portraitMinHeightInches: 11,
    landscapeWidthInches: 11,
    landscapeMinHeightInches: 8.5,
    canvasColor: "F4F4F5",
    borderColor: "D4D4D8",
  },
  font: { bodyFamily: "Arial", monospaceFamily: "Courier New", bodySizePt: 11 },
  color: { text: "000000", muted: "666666", subtleFill: "F2F2F2", link: "0563C1" },
  typography: {
    titleSizePt: 16,
    headingSizePt: [14, 12.5, 11.5, 11, 10.5, 10],
    bodyLineHeight: 1.15,
    quoteSizePt: 10.5,
    codeSizePt: 9.5,
  },
  spacing: {
    paragraphAfterPt: 6,
    titleAfterPt: 15,
    headingBeforePt: [15, 12, 10, 9, 8, 7],
    headingAfterPt: [7, 6, 5, 4, 3.5, 3],
  },
  table: {
    standardSizePt: 10,
    compactSizePt: 9,
    minimumSizePt: 8.5,
    signatureSizePt: 10,
    headerFill: "EDEDED",
    borderColor: "B7B7B7",
  },
} as const;

export function ptToHalfPoints(points: number): number {
  return Math.round(points * 2);
}

export function ptToTwips(points: number): number {
  return Math.round(points * 20);
}
