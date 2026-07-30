const SUBJECT_LINE =
  /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*|__)?Subject(?::(?:\*\*|__)|(?:\*\*|__):|:)\s*(.+?)\s*$/i;

export function extractGeneratedSubject(content: string): string | null {
  const openingLines = content.slice(0, 4000).split(/\r?\n/).slice(0, 40);

  for (const line of openingLines) {
    const match = line.match(SUBJECT_LINE);
    const subject = match?.[1]?.trim();
    if (subject && subject.length <= 500) return subject;
  }

  return null;
}
