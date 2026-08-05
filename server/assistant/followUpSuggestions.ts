const ASSISTANT_OFFER_PREFIXES = [
  /^would\s+you\s+like\s+me\s+to\s+/i,
  /^would\s+you\s+like\s+us\s+to\s+/i,
  /^do\s+you\s+want\s+me\s+to\s+/i,
  /^should\s+i\s+/i,
  /^should\s+we\s+/i,
  /^shall\s+i\s+/i,
  /^can\s+i\s+/i,
  /^i\s+can\s+/i,
  /^let\s+me\s+/i,
  /^would\s+it\s+help\s+if\s+i\s+(?:were\s+to\s+)?/i,
];

function capitalizeFirstLetter(value: string): string {
  const firstLetterIndex = value.search(/\p{L}/u);
  if (firstLetterIndex < 0) return value;
  return value.slice(0, firstLetterIndex)
    + value[firstLetterIndex].toUpperCase()
    + value.slice(firstLetterIndex + 1);
}

export function normalizeFollowUpSuggestion(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  const prefix = ASSISTANT_OFFER_PREFIXES.find((candidate) => candidate.test(trimmed));
  if (!prefix) return trimmed;

  const normalized = capitalizeFirstLetter(trimmed.replace(prefix, "").trim());
  if (!normalized) return "";
  return normalized.endsWith("?") ? `${normalized.slice(0, -1)}.` : normalized;
}

export function normalizeFollowUpSuggestions(inputs: unknown[]): string[] {
  const seen = new Set<string>();
  const uniqueSuggestions: string[] = [];

  const normalizedSuggestions = inputs.map((input) => (
    typeof input === "string" ? normalizeFollowUpSuggestion(input) : ""
  ));
  for (const suggestion of normalizedSuggestions) {
    if (!suggestion) continue;
    const deduplicationKey = suggestion.toLowerCase();
    if (seen.has(deduplicationKey)) continue;
    seen.add(deduplicationKey);
    uniqueSuggestions.push(suggestion);
  }

  return uniqueSuggestions.slice(0, 4);
}
