import { EXPORT_SAFE_DOCUMENT_MARKDOWN_RULES } from "./documentDraftingRules.js";
import { TOP_TIER_LEGAL_DRAFTING_STANDARD } from "./legalDraftingStandard.js";
import {
  getWorkProductFormatInstructions,
  type WorkProductFormat,
} from "./workProductFormat.js";

export function buildWorkProductDraftPrompt({
  format,
  matterMetadata,
  conversationHistory,
  instructions,
}: {
  format: WorkProductFormat;
  matterMetadata: string;
  conversationHistory: string;
  instructions?: string;
}): string {
  const formatInstructions = getWorkProductFormatInstructions(format);

  return `You are a meticulous legal counsel drafting a formal document based on legal research.
Draft a high-quality ${format.toUpperCase()} based on the legal consultation conversation history and references provided below.

Matter and account metadata:
${matterMetadata}

Conversation History:
${conversationHistory}

Custom Instructions:
${instructions || "Ensure high-level professionalism and clear structure."}

FORMAT INSTRUCTIONS:
${formatInstructions}

${TOP_TIER_LEGAL_DRAFTING_STANDARD}

SHARED INSTRUCTIONS:
1. Produce a polished standalone work product. Do not include internal source IDs, Assistant citation tokens, numbered source markers, clickable citation syntax, footnotes, endnotes, a references list, or a bibliography unless the user explicitly requests formal citations. Integrate legal authorities naturally into prose by naming the case, statute, regulation, or document when relevant.
2. Use the server-provided current date exactly when a date is needed. Do not invent another date.
3. Do not emit bracketed placeholders such as [Client Name], [Your Name], or [Firm Name] when the metadata supplies those values. If optional metadata is missing, omit that field or use a neutral professional phrasing.
4. Do not append generic legal-advice, AI, lawyer-review, consultation, informational-purpose, or limitation-of-liability disclaimer boilerplate. State genuine evidentiary uncertainty directly and specifically instead. Do not remove substantive analysis of disclaimer clauses contained in the conversation or sources.
5. Output the draft using elegant, rich markdown with readable headers. Do not wrap in generic JSON, just output the clean draft text.

${EXPORT_SAFE_DOCUMENT_MARKDOWN_RULES}`;
}
