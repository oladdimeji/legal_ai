import type { Citation } from "../types";

const CITATION_PART_PATTERN = /^(?:cit[\s_-]*(\d+)|(\d+))$/i;

function validCitationIds(citations: Citation[]): Set<string> {
  return new Set(citations.map((citation) => citation.id));
}

function normalizeCitationPart(part: string, citations: Citation[], options: { allowBareNumbers: boolean }) {
  const trimmed = part.trim().replace(/^\\+/, "").replace(/\\+$/, "");
  const match = CITATION_PART_PATTERN.exec(trimmed);
  if (!match) return null;
  if (match[2] && !options.allowBareNumbers) return null;
  const id = `cit_${match[1] || match[2]}`;
  return validCitationIds(citations).has(id) ? id : null;
}

function normalizeCitationBracket(
  inner: string,
  citations: Citation[],
  options: { allowBareNumbers: boolean; link: boolean; removeInvalid: boolean }
) {
  const parts = inner.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const ids = parts.map((part) => normalizeCitationPart(part, citations, options));
  if (ids.every(Boolean)) {
    return ids.map((id) => options.link ? `[${id}](#${id})` : `[${id}]`).join("");
  }
  const allLookLikeCitations = parts.every((part) => /^(?:\\?cit[\s_-]*\d+|\d+)$/i.test(part));
  return allLookLikeCitations && options.removeInvalid ? "" : null;
}

export function rewriteGoogleGroundingCitations(content: string, chunkIndexToCitId: Record<number, string>): string {
  return content.replace(/(\\?)\[([^\]\n]{1,120})\](?!\()/g, (match, escaped, inner) => {
    const parts = inner.split(",").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return match;
    let changed = false;
    const rewritten = parts.map((part) => {
      if (/^\d+$/.test(part)) {
        const id = chunkIndexToCitId[Number(part) - 1];
        if (id) {
          changed = true;
          return `[${id}]`;
        }
        changed = true;
        return "";
      }
      return `${escaped}[${part}]`;
    }).filter(Boolean);
    return changed ? rewritten.join("") : match;
  }).replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,;:])/g, "$1");
}

export function canonicalizeAssistantCitations(content: string, citations: Citation[]): string {
  if (!citations.length) {
    return content.replace(/\\?\[(?:cit[\s_-]*\d+)(?:\s*,\s*cit[\s_-]*\d+)*\]/gi, "");
  }
  return content
    .replace(/(\\?)\[([^\]\n]{1,120})\](?!\()/g, (match, _escaped, inner) =>
      normalizeCitationBracket(inner, citations, {
        allowBareNumbers: false,
        link: false,
        removeInvalid: true,
      }) ?? match
    )
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:])/g, "$1");
}

export function linkAssistantCitations(content: string, citations: Citation[] = []) {
  if (!citations.length) {
    return content.replace(/\\?\[(?:cit[\s_-]*\d+)(?:\s*,\s*cit[\s_-]*\d+)*\]/gi, "");
  }
  return content
    .replace(/(\\?)\[([^\]\n]{1,120})\](?!\()/g, (match, _escaped, inner) =>
      normalizeCitationBracket(inner, citations, {
        allowBareNumbers: true,
        link: true,
        removeInvalid: true,
      }) ?? match
    )
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:])/g, "$1");
}

export function assistantCitationsToDisplayText(content: string, citations: Citation[] = []) {
  const linked = linkAssistantCitations(content, citations);
  return linked.replace(/\[cit_(\d+)\]\(#cit_\d+\)/g, "[$1]");
}

export function stripInternalCitationsForWorkProduct(content: string, options: { stripNumberedMarkers?: boolean } = {}): string {
  const tokenPattern = options.stripNumberedMarkers
    ? /\\?\[(?:cit[\s_-]*\d+|\d+)(?:\s*,\s*(?:cit[\s_-]*\d+|\d+))*\]/gi
    : /\\?\[(?:cit[\s_-]*\d+)(?:\s*,\s*cit[\s_-]*\d+)*\]/gi;
  return content
    .replace(tokenPattern, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/([([{])\s+([)\]}])/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
