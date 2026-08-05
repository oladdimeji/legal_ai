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
  const allLookLikeCitations = parts.every((part) =>
    /^\\?cit[\s_-]*\d+$/i.test(part) || (options.allowBareNumbers && /^\d+$/.test(part))
  );
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

function citationAliases(citations: Citation[]): Set<string> {
  const aliases = new Set<string>();
  for (const citation of citations) {
    const normalizedId = citation.id.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!normalizedId) continue;
    aliases.add(normalizedId);
    const workspaceNumber = /^cit_(\d+)$/.exec(normalizedId);
    if (workspaceNumber) aliases.add(workspaceNumber[1]);
    const webNumber = /^cit_web_(\d+)$/.exec(normalizedId);
    if (webNumber) aliases.add(`web_${webNumber[1]}`);
  }
  return aliases;
}

function normalizedCitationAlias(value: string): string {
  return value.trim().replace(/^\\+|\\+$/g, "").toLowerCase().replace(/[\s-]+/g, "_");
}

/** Removes only inline markers that resolve to citations registered on the message. */
export function stripAssistantInlineCitations(
  content: string,
  citations: Citation[] = []
): string {
  if (!content || citations.length === 0) return content;
  const aliases = citationAliases(citations);
  const stripped = content.replace(
    /(\\?)\[([^\]\n]{1,160})\](?:\(\s*#([^\)\n]{1,160})\s*\))?/g,
    (match, _escaped: string, inner: string, anchor: string | undefined) => {
      const parts = inner.split(",").map(normalizedCitationAlias).filter(Boolean);
      if (parts.length === 0 || !parts.every((part) => aliases.has(part))) return match;
      if (anchor && !aliases.has(normalizedCitationAlias(anchor))) return match;
      return "";
    }
  );
  return stripped
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n[ \t]+\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
