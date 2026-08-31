import path from "node:path";
import type { Express } from "express";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_COUNT = 5;
export const MAX_TOTAL_EXTRACTED_CHARS = 120_000;

const supported = {
  ".pdf": ["application/pdf", "application/octet-stream"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",
  ],
  ".txt": ["text/plain", "application/octet-stream"],
} as const;

export interface ExtractedFile {
  filename: string;
  text: string;
  extension: ".pdf" | ".docx" | ".txt";
  mimeType: string;
}

export function validateUploadFile(file: Express.Multer.File): ".pdf" | ".docx" | ".txt" {
  const extension = path.extname(file.originalname).toLowerCase() as keyof typeof supported;
  if (!(extension in supported)) {
    throw new Error("Unsupported file type. Upload PDF, DOCX, or TXT files only.");
  }
  if (!supported[extension].includes(file.mimetype as never)) {
    throw new Error(`The MIME type for ${file.originalname} does not match its extension.`);
  }
  if (!file.buffer?.length) {
    throw new Error(`${file.originalname} is empty.`);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`${file.originalname} exceeds the 10 MB file size limit.`);
  }
  return extension;
}

export async function extractTextFromUpload(file: Express.Multer.File): Promise<ExtractedFile> {
  const extension = validateUploadFile(file);
  let text = "";

  try {
    if (extension === ".txt") {
      text = file.buffer.toString("utf8");
    } else if (extension === ".docx") {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value;
    } else {
      const parser = new PDFParse({ data: file.buffer });
      const result = await parser.getText();
      text = result.text;
      await parser.destroy();
    }
  } catch {
    throw new Error(`${file.originalname} could not be read. It may be corrupt, encrypted, or unsupported.`);
  }

  const normalized = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (!normalized) {
    throw new Error(`${file.originalname} does not contain extractable text. OCR is not supported.`);
  }

  return {
    filename: file.originalname,
    text: normalized,
    extension,
    mimeType: file.mimetype,
  };
}

export async function extractUploads(files: Express.Multer.File[] = []): Promise<ExtractedFile[]> {
  if (files.length > MAX_FILE_COUNT) {
    throw new Error(`Upload at most ${MAX_FILE_COUNT} files at a time.`);
  }
  const extracted: ExtractedFile[] = [];
  let totalChars = 0;
  for (const file of files) {
    const item = await extractTextFromUpload(file);
    totalChars += item.text.length;
    if (totalChars > MAX_TOTAL_EXTRACTED_CHARS) {
      throw new Error("Extracted text exceeds the request limit. Upload fewer or shorter documents.");
    }
    extracted.push(item);
  }
  return extracted;
}
