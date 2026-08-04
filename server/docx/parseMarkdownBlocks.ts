import { parseDocument } from "../../shared/document/parseDocument.js";

export {
  DOCX_MAX_LIST_LEVEL,
  inlinePlainText,
  isSignatureTable,
  parseInlineMarkdown,
  repairMalformedTables,
} from "../../shared/document/parseDocument.js";

export function parseMarkdownBlocks(markdown: string) {
  return parseDocument(markdown);
}
