export interface ClientAssistantDocumentSource {
  id: string;
  title: string;
  matter_name: string;
  content: string;
}

export interface ClientDocumentPassage {
  documentId: string;
  documentTitle: string;
  matterName: string;
  text: string;
  score: number;
}

const STOP_WORDS = new Set([
  "about",
  "and",
  "after",
  "again",
  "against",
  "also",
  "because",
  "before",
  "being",
  "between",
  "could",
  "does",
  "from",
  "for",
  "have",
  "into",
  "more",
  "other",
  "should",
  "that",
  "the",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "under",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);

function termsForQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .match(/[a-z0-9]{3,}/g)
        ?.filter((term) => !STOP_WORDS.has(term)) || []
    )
  ).slice(0, 24);
}

function passagesForContent(content: string): string[] {
  const normalized = content
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!normalized) return [];

  const passages: string[] = [];
  for (const section of normalized.split(/\n{2,}/)) {
    const text = section.trim();
    if (!text) continue;
    for (let offset = 0; offset < text.length; offset += 1_200) {
      passages.push(text.slice(offset, offset + 1_400).trim());
      if (passages.length >= 120) return passages;
    }
  }
  return passages;
}

export function retrieveClientDocumentPassages(
  query: string,
  documents: ClientAssistantDocumentSource[],
  options: { maxPassages?: number; maxCharacters?: number } = {}
): ClientDocumentPassage[] {
  const maxPassages = options.maxPassages || 8;
  const maxCharacters = options.maxCharacters || 14_000;
  const terms = termsForQuery(query);
  const genericDocumentRequest =
    /\b(summarize|summary|overview|explain|review|describe|document|agreement|contract)\b/i.test(
      query
    );

  const ranked = documents.flatMap((document) =>
    passagesForContent(document.content).map((text, index) => {
      const lower = text.toLowerCase();
      const score = terms.reduce(
        (total, term) => total + (lower.includes(term) ? 1 : 0),
        0
      );
      return {
        documentId: document.id,
        documentTitle: document.title,
        matterName: document.matter_name,
        text,
        score: score + (genericDocumentRequest && index < 3 ? 0.25 : 0),
      };
    })
  );

  ranked.sort((left, right) => right.score - left.score);
  const selected: ClientDocumentPassage[] = [];
  let characters = 0;
  for (const passage of ranked) {
    if (passage.score <= 0 || selected.length >= maxPassages) break;
    if (characters + passage.text.length > maxCharacters && selected.length > 0) continue;
    selected.push(passage);
    characters += passage.text.length;
  }
  return selected;
}

export function formatClientDocumentEvidence(passages: ClientDocumentPassage[]): string {
  return passages
    .map(
      (passage, index) =>
        `EVIDENCE ${index + 1}\nDocument: ${passage.documentTitle}\nMatter: ${passage.matterName}\nPassage: ${passage.text}`
    )
    .join("\n\n");
}
