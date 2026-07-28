import { createHash } from "node:crypto";
import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export const INGESTION_QUEUE = "document-ingestion";
export const INGESTION_STATES = [
  "uploaded", "scanning", "extracting", "needs_ocr", "indexing", "ready", "failed", "cancelled",
] as const;
export type IngestionState = typeof INGESTION_STATES[number];

export type IngestionJob = { versionId: string; firmId: string };

export function chunkExtractedText(text: string, maxChars = 4_000): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxChars) {
      chunks.push(current);
      current = "";
    }
    if (paragraph.length > maxChars) {
      if (current) chunks.push(current);
      for (let offset = 0; offset < paragraph.length; offset += maxChars) {
        chunks.push(paragraph.slice(offset, offset + maxChars));
      }
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function chunkHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function extractStoredFile(
  filename: string,
  contentType: string,
  content: Uint8Array,
): Promise<{ text: string; scannedPdf: boolean }> {
  const extension = path.extname(filename).toLowerCase();
  let text = "";
  if (extension === ".txt" && ["text/plain", "application/octet-stream"].includes(contentType)) {
    text = Buffer.from(content).toString("utf8");
  } else if (
    extension === ".docx" &&
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    text = (await mammoth.extractRawText({ buffer: Buffer.from(content) })).value;
  } else if (extension === ".pdf" && contentType === "application/pdf") {
    const parser = new PDFParse({ data: content });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else {
    throw new Error("unsupported_type");
  }
  const normalized = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
  return { text: normalized, scannedPdf: extension === ".pdf" && !normalized };
}
