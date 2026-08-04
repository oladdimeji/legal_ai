import type { DocumentDiagnostic } from "./documentDiagnostics.js";
import type { DocumentBlock } from "./documentTypes.js";
import { normalizeDocument } from "./normalizeDocument.js";
import { parseDocument, repairMalformedTables } from "./parseDocument.js";

export type CompiledDocument = {
  title: string;
  normalizedMarkdown: string;
  blocks: DocumentBlock[];
  diagnostics: DocumentDiagnostic[];
};

export function compileDocument(title: string, markdown: string): CompiledDocument {
  const normalized = normalizeDocument(title, markdown);
  const repaired = repairMalformedTables(normalized.markdown);
  const diagnostics = [...normalized.diagnostics, ...repaired.diagnostics];
  return {
    title: normalized.title,
    normalizedMarkdown: repaired.markdown,
    blocks: parseDocument(repaired.markdown, diagnostics),
    diagnostics,
  };
}

