const SUBJECT_LINE =
  /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*|__)?Subject(?::(?:\*\*|__)|(?:\*\*|__):|:)\s*(.+?)\s*$/i;

const GENERIC_SUMMARY_HEADINGS = new Set([
  "summary",
  "legal summary",
  "executive summary",
  "overview",
  "introduction",
  "background",
  "relevant facts",
  "key facts",
  "key issues",
  "legal issues",
  "analysis",
  "discussion",
  "findings",
  "recommendations",
  "next steps",
  "conclusion",
]);

export function extractGeneratedSubject(content: string): string | null {
  const openingLines = content.slice(0, 4000).split(/\r?\n/).slice(0, 40);

  for (const line of openingLines) {
    const match = line.match(SUBJECT_LINE);
    const subject = match?.[1]?.trim();
    if (subject && subject.length <= 500) return subject;
  }

  return null;
}

export function extractSummaryHeading(content: string): string | null {
  const openingLines = content.slice(0, 4000).split(/\r?\n/).slice(0, 40);

  for (const line of openingLines) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;

    const heading = match[1]
      .replace(/^(?:\*\*|__)\s*(.*?)\s*(?:\*\*|__)$/, "$1")
      .replace(/\s+/g, " ")
      .trim();
    const genericLabel = heading.toLowerCase().replace(/[.:]+$/, "").trim();

    if (
      heading &&
      heading.length <= 300 &&
      !GENERIC_SUMMARY_HEADINGS.has(genericLabel) &&
      !/^(?:to|from|date|subject|firm|client)\s*:/i.test(heading)
    ) {
      return heading;
    }
  }

  return null;
}
