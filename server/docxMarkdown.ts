import type { Document as DocxDocument } from "docx";
import { normalizeMarkdown } from "./docx/normalizeMarkdown.js";
import { parseMarkdownBlocks } from "./docx/parseMarkdownBlocks.js";
import { renderDocx } from "./docx/renderDocx.js";

export function markdownToDocxDocument(title: string, markdown: string): DocxDocument {
  const normalized = normalizeMarkdown(title, markdown);
  return renderDocx(title, parseMarkdownBlocks(normalized));
}
