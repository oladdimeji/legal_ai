import {
  LANDSCAPE_CONTENT_WIDTH_TWIPS,
  PORTRAIT_CONTENT_WIDTH_TWIPS,
} from "./documentTheme.js";
import type {
  DocumentAlignment,
  DocumentOrientation,
  DocumentTableLayout,
  TableColumn,
  TableColumnKind,
} from "./documentTypes.js";

export type TableLayoutInput = {
  rows: string[][];
  authoredAlignments?: Array<DocumentAlignment | null>;
  signature?: boolean;
};

export type TableLayoutPlan = {
  columns: TableColumn[];
  layout: DocumentTableLayout;
  orientation: DocumentOrientation;
  minimumReadableWidthTwips: number;
};

const NUMBER_VALUE = /^\s*(?:[$£€¥]\s*)?\(?[-+]?\d[\d,.]*(?:\s*%)?\)?\s*$/;
const DATE_VALUE = /^\s*(?:\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?)\s*$/i;
const STATUS_VALUE = /^(?:open|closed|pending|complete|completed|approved|rejected|high|medium|low|yes|no|active|inactive|draft|final|not started|in progress)$/i;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function classifyColumn(header: string, values: string[]): TableColumnKind {
  const populated = values.map((value) => value.trim()).filter(Boolean);
  if (populated.length && populated.filter((value) => NUMBER_VALUE.test(value)).length / populated.length >= 0.7) return "number";
  if (populated.length && populated.filter((value) => DATE_VALUE.test(value)).length / populated.length >= 0.7) return "date";
  if (populated.length && populated.filter((value) => STATUS_VALUE.test(value)).length / populated.length >= 0.7) return "status";
  const lengths = populated.map((value) => value.length);
  if (/\b(?:label|term|issue|party|category|item|name)\b/i.test(header) || (lengths.length && median(lengths) <= 18 && Math.max(...lengths) <= 32)) return "label";
  return "text";
}

function inferredAlignment(kind: TableColumnKind): DocumentAlignment {
  if (kind === "number") return "right";
  if (kind === "status") return "center";
  return "left";
}

function columnScore(header: string, values: string[], kind: TableColumnKind): number {
  const lengths = values.map((value) => value.trim().length);
  const populated = lengths.filter((length) => length > 0);
  const average = populated.length ? populated.reduce((sum, length) => sum + length, 0) / populated.length : 0;
  const longestToken = Math.max(0, ...values.flatMap((value) => value.split(/\s+/).map((token) => token.length)));
  const hardBreaks = values.reduce((count, value) => count + (value.match(/<br\s*\/?\s*>|\n/gi)?.length ?? 0), 0);
  const emptyRatio = values.length ? (values.length - populated.length) / values.length : 0;
  const longProseRatio = values.length ? values.filter((value) => value.length > 80).length / values.length : 0;
  const kindBase = kind === "text" ? 16 : kind === "label" ? 10 : kind === "date" ? 12 : 9;
  return Math.max(4, kindBase + Math.min(26, header.length * 0.45) + average * 0.7 + median(populated) * 0.35 + longestToken * 0.45 + hardBreaks * 4 + longProseRatio * 24 - emptyRatio * 5);
}

function boundedWeights(scores: number[]): number[] {
  if (!scores.length) return [];
  const minimum = Math.min(0.16, 0.7 / scores.length);
  const maximum = scores.length === 2 ? 0.72 : 0.58;
  let weights = scores.map((score) => score / scores.reduce((sum, value) => sum + value, 0));
  for (let pass = 0; pass < 8; pass += 1) {
    weights = weights.map((weight) => Math.min(maximum, Math.max(minimum, weight)));
    const total = weights.reduce((sum, value) => sum + value, 0);
    if (Math.abs(total - 1) < 0.000001) break;
    const adjustable = weights.map((weight, index) => ({ weight, index })).filter(({ weight }) => total > 1 ? weight > minimum : weight < maximum);
    if (!adjustable.length) break;
    const change = (1 - total) / adjustable.length;
    for (const { index } of adjustable) weights[index] += change;
  }
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((weight) => weight / total);
}

function minimumColumnWidth(kind: TableColumnKind, header: string, values: string[], columnCount: number): number {
  const longestToken = Math.max(header.length, ...values.flatMap((value) => value.split(/\s+/).map((token) => token.length)));
  const proseHeavy = values.filter((value) => value.length > 70).length >= Math.max(1, Math.ceil(values.length / 3));
  let width = kind === "number" ? 850 : kind === "date" ? 1100 : kind === "status" ? 900 : kind === "label" ? 1050 : 1300;
  width += Math.min(1500, longestToken * 42);
  if (proseHeavy) width += 650;
  if (columnCount >= 6 && (kind === "text" || proseHeavy)) width += 300;
  return width;
}

export function planTableLayout(input: TableLayoutInput): TableLayoutPlan {
  const columnCount = Math.max(1, ...input.rows.map((row) => row.length));
  if (input.signature && columnCount === 2) {
    return {
      columns: [0, 1].map(() => ({ alignment: "left", kind: "text", widthWeight: 0.5 })),
      layout: "signature",
      orientation: "portrait",
      minimumReadableWidthTwips: PORTRAIT_CONTENT_WIDTH_TWIPS,
    };
  }
  const header = input.rows[0] ?? [];
  const body = input.rows.slice(1);
  const kinds = Array.from({ length: columnCount }, (_, index) => classifyColumn(header[index] ?? "", body.map((row) => row[index] ?? "")));
  const scores = kinds.map((kind, index) => columnScore(header[index] ?? "", body.map((row) => row[index] ?? ""), kind));
  const weights = boundedWeights(scores);
  const minimumReadableWidthTwips = kinds.reduce((sum, kind, index) => sum + minimumColumnWidth(kind, header[index] ?? "", body.map((row) => row[index] ?? ""), columnCount), 0);
  const proseColumns = kinds.filter((kind) => kind === "text").length;
  const orientation: DocumentOrientation = minimumReadableWidthTwips > PORTRAIT_CONTENT_WIDTH_TWIPS && (columnCount >= 5 || proseColumns >= 3) ? "landscape" : "portrait";
  const layout: DocumentTableLayout = orientation === "landscape" ? "wide" : columnCount >= 5 ? "compact" : "standard";
  return {
    columns: kinds.map((kind, index) => ({
      kind,
      alignment: input.authoredAlignments?.[index] ?? inferredAlignment(kind),
      widthWeight: weights[index],
    })),
    layout,
    orientation,
    minimumReadableWidthTwips,
  };
}

export function tableGridWidths(columns: Array<Pick<TableColumn, "widthWeight">>, totalWidthTwips: number): number[] {
  if (!columns.length) return [];
  if (!Number.isInteger(totalWidthTwips) || totalWidthTwips < columns.length) throw new Error("Table width must provide at least one twip per column.");
  const positive = columns.map((column) => Math.max(Number.EPSILON, column.widthWeight));
  const totalWeight = positive.reduce((sum, weight) => sum + weight, 0);
  const exact = positive.map((weight) => weight / totalWeight * totalWidthTwips);
  const widths = exact.map((width) => Math.max(1, Math.floor(width)));
  let remaining = totalWidthTwips - widths.reduce((sum, width) => sum + width, 0);
  const order = exact.map((width, index) => ({ index, fraction: width - Math.floor(width) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  let cursor = 0;
  while (remaining > 0) {
    widths[order[cursor % order.length].index] += 1;
    cursor += 1;
    remaining -= 1;
  }
  while (remaining < 0) {
    const candidate = order.slice().reverse().find(({ index }) => widths[index] > 1);
    if (!candidate) throw new Error("Unable to allocate positive table widths.");
    widths[candidate.index] -= 1;
    remaining += 1;
  }
  return widths;
}

export function contentWidthForOrientation(orientation: DocumentOrientation): number {
  return orientation === "landscape" ? LANDSCAPE_CONTENT_WIDTH_TWIPS : PORTRAIT_CONTENT_WIDTH_TWIPS;
}

