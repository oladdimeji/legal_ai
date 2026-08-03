import type { AssistantEvidence } from "./assistantTypes.js";

export const MAX_EVIDENCE_ITEM_CHARS = 15_000;
export const MAX_TOTAL_EVIDENCE_CHARS = 26_000;

export function sanitizeEvidenceText(value: unknown, maxChars = MAX_EVIDENCE_ITEM_CHARS): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/<\/?authorized_workspace_evidence>/gi, "[evidence-boundary]")
    .replace(/<\/?conversation_memory>/gi, "[memory-boundary]")
    .replace(/\r\n?/g, "\n")
    .slice(0, maxChars)
    .trim();
}

export function boundEvidence(
  evidence: AssistantEvidence[],
  maxChars = MAX_TOTAL_EVIDENCE_CHARS
): AssistantEvidence[] {
  const bounded: AssistantEvidence[] = [];
  let remaining = maxChars;
  for (const item of evidence) {
    if (remaining <= 0) break;
    const text = sanitizeEvidenceText(item.text, Math.min(MAX_EVIDENCE_ITEM_CHARS, remaining));
    if (!text) continue;
    bounded.push({
      ...item,
      title: sanitizeEvidenceText(item.title, 300),
      sourceName: sanitizeEvidenceText(item.sourceName, 160),
      text,
    });
    remaining -= text.length;
  }
  return bounded;
}

export function wrapAuthorizedEvidence(evidence: AssistantEvidence[]): string {
  const body = boundEvidence(evidence)
    .map((item) => JSON.stringify({
      id: item.id,
      sourceType: item.sourceType,
      title: item.title,
      sourceName: item.sourceName,
      entityId: item.entityId,
      matterId: item.matterId,
      text: item.text,
    }))
    .join("\n");
  return `<authorized_workspace_evidence>\n${body || "No authorized workspace evidence was retrieved."}\n</authorized_workspace_evidence>`;
}

