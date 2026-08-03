const THEMATIC_BREAK = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})(?:\s*[\w+-]+)?\s*$/;

function stripTitlePresentation(value: string): string {
  let result = value.trim();
  result = result.replace(/^#{1,6}\s+/, "");
  for (let index = 0; index < 2; index += 1) {
    result = result.replace(/^(?:\*\*|__)([\s\S]*)(?:\*\*|__)$/, "$1").trim();
  }
  return result;
}

export function normalizedTitle(value: string): string {
  return stripTitlePresentation(value)
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/[\s.:;,!?\-–—]+$/g, "")
    .trim()
    .toLocaleLowerCase("en-US");
}

function unwrapSingleOuterFence(lines: string[]): string[] {
  let first = 0;
  let last = lines.length - 1;
  while (first <= last && !lines[first].trim()) first += 1;
  while (last >= first && !lines[last].trim()) last -= 1;
  if (first >= last) return lines;

  const opening = lines[first].match(FENCE);
  if (!opening) return lines;
  const closingPattern = new RegExp(`^\\s{0,3}${opening[1][0]}{${opening[1].length},}\\s*$`);
  if (!closingPattern.test(lines[last])) return lines;
  const internalFence = lines.slice(first + 1, last).some((line) => closingPattern.test(line));
  if (internalFence) return lines;
  return lines.slice(first + 1, last);
}

function openingBlockEnd(lines: string[], start: number): number {
  let end = start;
  while (end < lines.length && lines[end].trim()) end += 1;
  return end;
}

function openingBlockMatchesTitle(lines: string[], title: string): boolean {
  if (lines.length !== 1) return false;
  return normalizedTitle(lines[0]) === title;
}

export function normalizeMarkdown(title: string, markdown: string): string {
  const normalizedLines = markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      if (/ {2,}$/.test(line)) return `${line.replace(/\s+$/, "")}  `;
      return line.replace(/[\t ]+$/g, "");
    });

  let lines = unwrapSingleOuterFence(normalizedLines);
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  const titleKey = normalizedTitle(title);
  if (titleKey) {
    let cursor = 0;
    while (cursor < lines.length) {
      while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
      const end = openingBlockEnd(lines, cursor);
      if (!openingBlockMatchesTitle(lines.slice(cursor, end), titleKey)) break;
      lines.splice(0, end);
      while (lines.length && !lines[0].trim()) lines.shift();
      cursor = 0;
    }
  }

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
  return collapsed.join("\n");
}

export function isThematicBreak(line: string): boolean {
  return THEMATIC_BREAK.test(line);
}
