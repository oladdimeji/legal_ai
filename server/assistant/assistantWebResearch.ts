import type { Citation } from "../../src/types.js";
import { rewriteGoogleGroundingCitations } from "../../src/lib/assistantCitations.js";
import { callModel, type GenerationModelCall } from "../model.js";
import { LAWYER_ASSISTANT_CHARTER } from "./assistantCharter.js";
import { sanitizeEvidenceText } from "./assistantEvidence.js";
import type { AssistantPlan, AssistantSessionContext } from "./assistantTypes.js";

export type AssistantWebResearchResult = {
  performed: boolean;
  report: string;
  citations: Citation[];
  questions: string[];
};

type Model = GenerationModelCall;

const EMPTY_WEB_RESEARCH: AssistantWebResearchResult = {
  performed: false,
  report: "",
  citations: [],
  questions: [],
};

function normalizedDenyValues(values: unknown[]): string[] {
  return [...new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length >= 3))]
    .sort((left, right) => right.length - left.length);
}

export function privateWebResearchDenyList(input: {
  session: AssistantSessionContext;
  resolvedMatterIds?: string[];
  artifactTitles?: string[];
  artifactIds?: string[];
  attachmentNames?: string[];
  privateDocumentTitles?: string[];
  request?: string;
}): string[] {
  const confidentialParties = Array.from((input.request || "").matchAll(
    /\b(?:confidential|private)\s+(?:client|party|company|person)\s+(?:named|called)?\s*["']?([A-Z][\p{L}\p{N}&.' -]{2,80})["']?/giu
  )).map((match) => match[1]);
  return normalizedDenyValues([
    input.session.user.name,
    input.session.user.email,
    input.session.firm.name,
    input.session.firm.id,
    input.session.currentMatter?.name,
    input.session.currentMatter?.clientName,
    input.session.currentMatter?.clientEmail,
    input.session.currentMatter?.id,
    input.session.selectedEntity?.id,
    input.session.selectedEntity?.title,
    ...(input.resolvedMatterIds || []),
    ...(input.artifactTitles || []),
    ...(input.artifactIds || []),
    ...(input.attachmentNames || []),
    ...(input.privateDocumentTitles || []),
    ...confidentialParties,
  ]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactPrivateWebResearchText(value: unknown, denyList: readonly string[]): string {
  let text = sanitizeEvidenceText(value, 4_000);
  for (const denied of denyList) {
    text = text.replace(new RegExp(escapeRegExp(denied), "giu"), "[private]");
  }
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[private email]")
    .replace(/\b(?:case|draft|doc|document|msg|thread|user|firm|matter|assistant)_[A-Za-z0-9_-]{4,}\b/giu, "[private id]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu, "Bearer [redacted]")
    .replace(/([?&](?:access_token|refresh_token|token|code|api_key|key)=)[^&#\s]+/giu, "$1[redacted]")
    .replace(/\b(?:access_token|refresh_token|session_token|portal_token|password|api_key|client_secret)\s*[:=]\s*[^\s,;]+/giu, "[redacted secret]")
    .trim();
}

export function sanitizePublicResearchQuestions(
  value: unknown,
  denyList: readonly string[]
): string[] {
  if (!Array.isArray(value)) return [];
  const questions: string[] = [];
  for (const candidate of value) {
    const question = redactPrivateWebResearchText(candidate, denyList).slice(0, 700).trim();
    if (!question || question.replace(/\[private(?: email| id)?\]/gi, "").trim().length < 12) continue;
    const stillDenied = denyList.some((denied) => question.toLocaleLowerCase().includes(denied.toLocaleLowerCase()));
    if (stillDenied || questions.includes(question)) continue;
    questions.push(question);
    if (questions.length >= 3) break;
  }
  return questions;
}

export async function performAssistantWebResearch(input: {
  request: string;
  plan: AssistantPlan;
  session: AssistantSessionContext;
  resolvedMatterIds?: string[];
  artifactTitles?: string[];
  artifactIds?: string[];
  attachmentNames?: string[];
  privateDocumentTitles?: string[];
  model?: Model;
}): Promise<AssistantWebResearchResult> {
  if (!input.plan.needsWeb) return EMPTY_WEB_RESEARCH;
  const model = input.model || callModel;
  const denyList = privateWebResearchDenyList(input);
  const redactedTask = redactPrivateWebResearchText(input.request, denyList);
  const jurisdiction = redactPrivateWebResearchText(
    input.session.currentMatter?.jurisdiction || "",
    denyList
  );
  let proposedQuestions: unknown = [];
  try {
    const builderPrompt = `Create at most three concise public-web research questions for a current legal or public-fact check. Return JSON only as {"questions":["..."]}.

Do not reconstruct private names, filenames, document titles, internal IDs, deal values, quoted private clauses, or confidential facts. Replace private specifics with generic legal categories. Use the current UTC date where timing matters.

Current UTC date: ${input.session.currentUtcDate}
Public jurisdiction (only if useful): ${jurisdiction || "Not supplied"}
Redacted task: ${redactedTask}`;
    const result = await model("assistant-planner", [{ role: "user", content: builderPrompt }], {
      systemInstruction: LAWYER_ASSISTANT_CHARTER,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { questions: { type: "ARRAY", items: { type: "STRING" } } },
        required: ["questions"],
      },
    });
    proposedQuestions = JSON.parse(result.text)?.questions;
  } catch (error) {
    console.error("Assistant public research question builder failed:", error);
  }
  const questions = sanitizePublicResearchQuestions(proposedQuestions, denyList);
  if (!questions.length) {
    const fallback = sanitizePublicResearchQuestions([redactedTask], denyList);
    if (!fallback.length) return EMPTY_WEB_RESEARCH;
    questions.push(...fallback);
  }

  const publicPrompt = `Research the following sanitized public questions using Google Search. Return concise current findings. Do not speculate about private facts and do not request or reconstruct private workspace information.

Current UTC date: ${input.session.currentUtcDate}
${questions.map((question, index) => `${index + 1}. ${question}`).join("\n")}`;
  const result = await model("chat", [{ role: "user", content: publicPrompt }], {
    googleSearch: true,
    thinkingLevel: input.plan.depth === "thorough" ? "high" : "medium",
    systemInstruction: LAWYER_ASSISTANT_CHARTER,
  });

  const chunks = Array.isArray(result.groundingMetadata?.groundingChunks)
    ? result.groundingMetadata.groundingChunks
    : [];
  const citations: Citation[] = [];
  const chunkIds: Record<number, string> = {};
  chunks.forEach((chunk: any, index: number) => {
    if (!chunk?.web?.uri) return;
    const id = `web_${citations.length + 1}`;
    chunkIds[index] = id;
    citations.push({
      id,
      type: "web",
      title: sanitizeEvidenceText(chunk.web.title || "Public web source", 300),
      url: String(chunk.web.uri),
      textSnippet: "Public source returned by Google Search grounding.",
      sourceName: "Google Search Grounding",
    });
  });
  if (!citations.length) return { ...EMPTY_WEB_RESEARCH, questions };
  return {
    performed: true,
    report: sanitizeEvidenceText(rewriteGoogleGroundingCitations(result.text, chunkIds), 12_000),
    citations,
    questions,
  };
}
