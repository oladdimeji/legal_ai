import { documentDiagnostic, type DocumentDiagnostic } from "./documentDiagnostics.js";

const THEMATIC_BREAK = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})(?:\s*[\w+-]+)?\s*$/;

function stripTitlePresentation(value: string): string {
  let result = value.trim().replace(/^#{1,6}\s+/, "");
  for (let index = 0; index < 2; index += 1) {
    result = result.replace(/^(?:\*\*|__)([\s\S]*)(?:\*\*|__)$/, "$1").trim();
  }
  return result;
}

export function displayTitle(value: string): string {
  return stripTitlePresentation(value).replace(/[\s\u00a0]+/g, " ").trim() || "Untitled Document";
}

export function normalizedTitle(value: string): string {
  return stripTitlePresentation(value)
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/[\s.:;,!?\-–—]+$/g, "")
    .trim()
    .toLocaleLowerCase("en-US");
}

function unwrapSingleOuterFence(lines: string[]): { lines: string[]; removed: boolean } {
  let first = 0;
  let last = lines.length - 1;
  while (first <= last && !lines[first].trim()) first += 1;
  while (last >= first && !lines[last].trim()) last -= 1;
  if (first >= last) return { lines, removed: false };
  const opening = lines[first].match(FENCE);
  if (!opening) return { lines, removed: false };
  const closingPattern = new RegExp(`^\\s{0,3}${opening[1][0]}{${opening[1].length},}\\s*$`);
  if (!closingPattern.test(lines[last])) return { lines, removed: false };
  if (lines.slice(first + 1, last).some((line) => closingPattern.test(line))) return { lines, removed: false };
  return { lines: lines.slice(first + 1, last), removed: true };
}

export type NormalizedDocument = {
  title: string;
  markdown: string;
  diagnostics: DocumentDiagnostic[];
};

export function normalizeDocument(title: string, markdown: string): NormalizedDocument {
  const diagnostics: DocumentDiagnostic[] = [];
  const normalizedLines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => {
    if (/ {2,}$/.test(line)) return `${line.replace(/\s+$/, "")}  `;
    return line.replace(/[\t ]+$/g, "");
  });
  const unwrapped = unwrapSingleOuterFence(normalizedLines);
  let lines = unwrapped.lines;
  if (unwrapped.removed) diagnostics.push(documentDiagnostic("outer-fence-removed", "A whole-document Markdown fence was removed."));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  const titleKey = normalizedTitle(title);
  let removedTitles = 0;
  while (titleKey && lines.length) {
    let end = 0;
    while (end < lines.length && lines[end].trim()) end += 1;
    if (end !== 1 || normalizedTitle(lines[0]) !== titleKey) break;
    lines.splice(0, end);
    while (lines.length && !lines[0].trim()) lines.shift();
    removedTitles += 1;
  }
  if (removedTitles) diagnostics.push(documentDiagnostic("duplicate-title-removed", "One or more duplicate opening titles were removed."));

  const collapsed: string[] = [];
  let previousBlank = false;
  for (const line of lines) {
    const blank = !line.trim();
    if (blank && previousBlank) continue;
    collapsed.push(line);
    previousBlank = blank;
  }
  while (collapsed.length && !collapsed[0].trim()) collapsed.shift();
  while (collapsed.length && !collapsed[collapsed.length - 1].trim()) collapsed.pop();
  if (!collapsed.some((line) => line.trim())) diagnostics.push(documentDiagnostic("empty-document", "The source document contains no body content."));
  return { title: displayTitle(title), markdown: collapsed.join("\n"), diagnostics };
}

export function normalizeMarkdown(title: string, markdown: string): string {
  return normalizeDocument(title, markdown).markdown;
}

export function isThematicBreak(line: string): boolean {
  return THEMATIC_BREAK.test(line);
}

