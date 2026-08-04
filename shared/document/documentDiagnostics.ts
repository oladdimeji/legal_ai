export type DocumentDiagnosticCode =
  | "duplicate-title-removed"
  | "outer-fence-removed"
  | "malformed-table-repaired"
  | "malformed-table-fallback"
  | "wide-table-landscape"
  | "unsupported-html-fallback"
  | "excessive-table-columns"
  | "empty-document";

export type DocumentDiagnostic = {
  code: DocumentDiagnosticCode;
  message: string;
  blockIndex?: number;
};

export function documentDiagnostic(
  code: DocumentDiagnosticCode,
  message: string,
  blockIndex?: number,
): DocumentDiagnostic {
  return { code, message, ...(blockIndex === undefined ? {} : { blockIndex }) };
}

