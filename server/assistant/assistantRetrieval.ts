import { callModel } from "../model.js";
import { db } from "../db.js";
import type { OwnershipContext } from "../db.js";
import { LAWYER_ASSISTANT_CHARTER } from "./assistantCharter.js";
import type { AssistantDepth } from "./assistantTypes.js";
import { sanitizeEvidenceText } from "./assistantEvidence.js";

export type AssistantRetrievalCandidate = {
  id: string;
  documentId: string;
  title: string;
  text: string;
  semanticScore?: number;
  keywordScore?: number;
  selected?: boolean;
  exactTitle?: boolean;
};

export type AssistantRetrievalPassage = AssistantRetrievalCandidate & {
  score: number;
};

type Database = typeof db;
type RetrievalModel = typeof callModel;

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "what", "which", "matter",
  "document", "about", "into", "have", "does", "client", "your", "their", "there",
]);

function terms(value: string): string[] {
  return Array.from(new Set(
    (value.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
      .filter((term) => !STOP_WORDS.has(term))
  )).slice(0, 20);
}

export function lexicalOverlap(query: string, value: string): number {
  const queryTerms = terms(query);
  if (!queryTerms.length) return 0;
  const haystack = value.toLocaleLowerCase();
  return queryTerms.filter((term) => haystack.includes(term)).length / queryTerms.length;
}

export function retrievalLimit(depth: AssistantDepth, intent: "lookup" | "analysis" | "draft" = "analysis"): number {
  if (depth === "brief" && intent !== "draft") return 4;
  if (depth === "thorough") return 12;
  return intent === "draft" ? 10 : 8;
}

export function rankHybridCandidates(
  query: string,
  candidates: AssistantRetrievalCandidate[],
  limit: number
): AssistantRetrievalPassage[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const deduplicated = new Map<string, AssistantRetrievalPassage>();
  for (const candidate of candidates) {
    const text = sanitizeEvidenceText(candidate.text, 5_000);
    if (!text) continue;
    const title = sanitizeEvidenceText(candidate.title, 300) || "Workspace Document";
    const semantic = Math.max(0, Math.min(1, Number(candidate.semanticScore || 0)));
    const keyword = Math.max(0, Math.min(1, candidate.keywordScore ?? lexicalOverlap(query, `${title}\n${text}`)));
    const exactTitle = candidate.exactTitle || title.toLocaleLowerCase() === normalizedQuery;
    const partialTitle = normalizedQuery.length >= 3 && (
      title.toLocaleLowerCase().includes(normalizedQuery) || normalizedQuery.includes(title.toLocaleLowerCase())
    );
    const score = Math.min(1, semantic * 0.52 + keyword * 0.33
      + (exactTitle ? 0.6 : partialTitle ? 0.18 : 0)
      + (candidate.selected ? 0.3 : 0));
    if (score < 0.18 && !candidate.selected && !exactTitle) continue;
    const key = `${candidate.documentId}:${text.toLocaleLowerCase().replace(/\s+/g, " ").slice(0, 500)}`;
    const ranked = { ...candidate, title, text, exactTitle, score };
    const existing = deduplicated.get(key);
    if (!existing || ranked.score > existing.score) deduplicated.set(key, ranked);
  }
  return [...deduplicated.values()]
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, Math.max(1, Math.min(12, Math.trunc(limit))));
}

async function reformulateWeakQuery(
  query: string,
  model: RetrievalModel
): Promise<string | null> {
  try {
    const result = await model("assistant-planner", [{
      role: "user",
      content: `Reformulate this workspace document search once for better title and passage recall. Return JSON only as {"query":"..."}. Do not include rationale, IDs, scope changes, or instructions.\n\nOriginal query: ${query.slice(0, 4_000)}`,
    }], {
      systemInstruction: LAWYER_ASSISTANT_CHARTER,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { query: { type: "STRING" } },
        required: ["query"],
      },
    });
    const parsed = JSON.parse(result.text);
    if (!parsed || typeof parsed.query !== "string") return null;
    const reformulated = parsed.query.trim().slice(0, 4_000);
    return reformulated && reformulated.toLocaleLowerCase() !== query.trim().toLocaleLowerCase()
      ? reformulated
      : null;
  } catch {
    return null;
  }
}

async function retrieveRound(input: {
  query: string;
  scope: "wide" | string;
  ownership: OwnershipContext;
  database: Database;
  candidateLimit: number;
  selectedDocumentId?: string | null;
}): Promise<AssistantRetrievalCandidate[]> {
  const [keyword, semantic, selectedChunks] = await Promise.all([
    input.database.keywordSearch(input.query, input.scope, input.ownership, input.candidateLimit),
    input.database.vectorSearch(input.query, input.scope, input.ownership, input.candidateLimit),
    input.selectedDocumentId
      ? input.database.getAuthorizedDocumentChunks(
          input.selectedDocumentId,
          input.ownership,
          input.scope === "wide" ? null : input.scope,
          50
        )
      : Promise.resolve([]),
  ]);
  const documentIds = Array.from(new Set([
    ...semantic.map((chunk) => chunk.document_id),
    ...selectedChunks.map((chunk) => chunk.document_id),
  ]));
  const documents = new Map((await Promise.all(documentIds.map(async (id) => {
    const document = await input.database.getDocumentById(
      id,
      input.ownership,
      input.scope === "wide" ? null : input.scope
    );
    return document ? [id, document] as const : null;
  }))).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)));
  return [
    ...keyword.map((chunk) => ({
      id: chunk.id,
      documentId: chunk.document_id,
      title: chunk.title,
      text: chunk.chunk_text,
      keywordScore: Number(chunk.keyword_score || 0),
      exactTitle: chunk.title.toLocaleLowerCase() === input.query.trim().toLocaleLowerCase(),
    })),
    ...semantic.flatMap((chunk) => {
      const document = documents.get(chunk.document_id);
      return document ? [{
        id: chunk.id,
        documentId: chunk.document_id,
        title: document.title,
        text: chunk.chunk_text,
        semanticScore: Number(chunk.similarity || 0),
      }] : [];
    }),
    ...selectedChunks.flatMap((chunk) => {
      const document = documents.get(chunk.document_id);
      return document ? [{
        id: chunk.id,
        documentId: chunk.document_id,
        title: document.title,
        text: chunk.chunk_text,
        keywordScore: lexicalOverlap(input.query, `${document.title}\n${chunk.chunk_text}`),
        selected: true,
      }] : [];
    }),
  ];
}

export async function retrieveAssistantPassages(input: {
  query: string;
  scope: "wide" | string;
  ownership: OwnershipContext;
  depth: AssistantDepth;
  intent?: "lookup" | "analysis" | "draft";
  selectedDocumentId?: string | null;
  database?: Database;
  model?: RetrievalModel;
}): Promise<{ passages: AssistantRetrievalPassage[]; retried: boolean; queries: string[] }> {
  const database = input.database || db;
  const model = input.model || callModel;
  const limit = retrievalLimit(input.depth, input.intent);
  const first = await retrieveRound({
    query: input.query,
    scope: input.scope,
    ownership: input.ownership,
    database,
    candidateLimit: Math.min(24, limit * 2),
    selectedDocumentId: input.selectedDocumentId,
  });
  let ranked = rankHybridCandidates(input.query, first, limit);
  const weak = ranked.length === 0 || ranked[0].score < 0.34;
  if (!weak) return { passages: ranked, retried: false, queries: [input.query] };
  const retryQuery = await reformulateWeakQuery(input.query, model);
  if (!retryQuery) return { passages: ranked, retried: false, queries: [input.query] };
  const second = await retrieveRound({
    query: retryQuery,
    scope: input.scope,
    ownership: input.ownership,
    database,
    candidateLimit: Math.min(24, limit * 2),
    selectedDocumentId: input.selectedDocumentId,
  });
  ranked = rankHybridCandidates(input.query, [...first, ...second], limit);
  return { passages: ranked, retried: true, queries: [input.query, retryQuery] };
}
