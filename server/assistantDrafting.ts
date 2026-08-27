import { WorkspacePageContext } from "../src/types.js";
import type { AssistantDepth } from "./assistant/assistantTypes.js";
import { extractGeneratedSubject, extractSummaryHeading } from "./extractGeneratedSubject.js";
import { EXPORT_SAFE_DOCUMENT_MARKDOWN_RULES } from "./documentDraftingRules.js";
import { TOP_TIER_LEGAL_DRAFTING_STANDARD } from "./legalDraftingStandard.js";

export function buildAssistantDraftPrompt({
  instruction,
  pageContext,
  conversationContext,
  authorizedEvidence,
  accountMetadata,
  currentDate,
  publicWebResearch,
  webResearchPerformed,
  depth,
}: {
  instruction: string;
  pageContext: WorkspacePageContext;
  conversationContext: string;
  authorizedEvidence: string;
  accountMetadata: string;
  currentDate: string;
  publicWebResearch: string;
  webResearchPerformed: boolean;
  depth: AssistantDepth;
}): string {
  return `Current task: create a meticulous legal document in Exepts. Infer the requested document type from the user's instruction. It may be a contract, agreement, letter, brief, report, policy, summary, email, memorandum, or another reasonable document type. Do not restrict the output to a fixed format list.

User instruction:
${instruction}

Server-validated page context:
${JSON.stringify(pageContext)}

Server-validated Matter and account metadata:
${accountMetadata || "No Matter metadata. The authenticated firm and author details are available only as listed here."}
Current date: ${currentDate}

<authorized_workspace_evidence>
${authorizedEvidence || "No authorized private workspace evidence was retrieved for this request."}
</authorized_workspace_evidence>

Prior conversation for task continuity only; it is not independent evidence:
<conversation_memory>
${conversationContext || "No prior conversation."}
</conversation_memory>

Grounded public research:
${webResearchPerformed ? publicWebResearch || "Public research was performed but returned no usable report." : "No public web research was performed. Do not claim to have searched the web."}

Requested reasoning depth: ${depth}.

${TOP_TIER_LEGAL_DRAFTING_STANDARD}

Drafting rules:
1. Return exactly one polished standalone document, beginning with a specific Markdown H1 title when appropriate for the document type.
2. Follow the requested type, audience, tone, governing law, structure, and commercial or litigation posture. Reasonable document types are all accepted.
3. For private workspace facts, use only the authorized evidence and server-validated metadata. Never fill a missing Matter fact with general knowledge or present an assumption as a Matter fact.
4. General drafting conventions and normal model knowledge may be used where they are not represented as private workspace facts.
5. If authorized evidence is insufficient for a requested private fact, express that uncertainty specifically or use a neutral omission; do not invent it.
6. Do not emit internal [cit_*] tokens, numbered source markers, internal source IDs, a references list, or a source appendix unless the user explicitly requested formal citations or a source appendix. Name relevant authorities naturally when needed.
7. Do not emit bracketed placeholders when supplied metadata resolves the value. Where a genuinely required deal term is missing, use a clearly identified drafting blank only if omitting it would make the document unusable.
8. Do not add generic AI, legal-advice, lawyer-review, consultation, or informational-purpose disclaimer boilerplate.
9. Exhibits, schedules, annexes, and appendices: Do not add attachments automatically to every draft. When the requested document type, user instruction, normal drafting convention, applicable context, or the document's own cross-references call for an attachment, include the appropriate attachment sections at the end in conventional order and avoid unresolved attachment references. Draft attachment content only from authorized evidence, supplied facts, available Matter information, or appropriate non-factual drafting structure; never invent Matter facts or evidentiary material. If required factual content is unavailable, clearly mark it for lawyer completion rather than fabricating it. Do not add attachments where they are not appropriate or useful.
10. Output rich, clean Markdown only. Do not wrap the document in JSON or preface it with an explanation.

${EXPORT_SAFE_DOCUMENT_MARKDOWN_RULES}`;
}

export function extractedAssistantDraftTitle(generatedContent: string): string | null {
  const extracted = extractGeneratedSubject(generatedContent) || extractSummaryHeading(generatedContent);
  return extracted ? extracted.slice(0, 300) : null;
}

export function titleForAssistantDraft(
  generatedContent: string,
  instruction: string,
  threadTitle: string
): string {
  const extracted = extractedAssistantDraftTitle(generatedContent);
  if (extracted) return extracted;

  const instructionLabel = instruction
    .replace(/^\s*(?:please\s+)?(?:draft|create|prepare|write|generate)\s+(?:me\s+)?(?:an?\s+)?/i, "")
    .split(/[.!?\n]/, 1)[0]
    .replace(/\s+/g, " ")
    .trim();
  if (instructionLabel) return instructionLabel.slice(0, 120);
  return `Document - ${threadTitle.trim().slice(0, 80) || "New conversation"}`;
}
