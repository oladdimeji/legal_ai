import { WorkspacePageContext } from "../src/types.js";
import { extractGeneratedSubject, extractSummaryHeading } from "./extractGeneratedSubject.js";

const WORKSPACE_DRAFT_PATTERN = /\b(?:matter|client file|firm library|workspace|source|work product|uploaded|attached|document on (?:this|the) page)\b/i;

export function assistantDraftNeedsWorkspaceEvidence({
  hasMatter,
  hasTemporaryFiles,
  hasSelectedEntity,
  instruction,
}: {
  hasMatter: boolean;
  hasTemporaryFiles: boolean;
  hasSelectedEntity: boolean;
  instruction: string;
}): boolean {
  return hasMatter || hasTemporaryFiles || hasSelectedEntity || WORKSPACE_DRAFT_PATTERN.test(instruction);
}

export function buildAssistantDraftPrompt({
  instruction,
  pageContext,
  conversationContext,
  authorizedEvidence,
  accountMetadata,
  currentDate,
  webSearchEnabled,
  deepResearchEnabled,
  researchPlan,
}: {
  instruction: string;
  pageContext: WorkspacePageContext;
  conversationContext: string;
  authorizedEvidence: string;
  accountMetadata: string;
  currentDate: string;
  webSearchEnabled: boolean;
  deepResearchEnabled: boolean;
  researchPlan?: string[];
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

Research configuration:
- Live Google Search grounding is ${webSearchEnabled ? "enabled and may be used when useful" : "disabled; do not claim to have searched the web"}.
- Deep Research is ${deepResearchEnabled ? "enabled; resolve complex issues carefully before drafting" : "not forced"}.
${deepResearchEnabled && researchPlan?.length ? `- Research plan:\n${researchPlan.map((question) => `  - ${question}`).join("\n")}` : ""}

Drafting rules:
1. Return exactly one polished standalone document, beginning with a specific Markdown H1 title when appropriate for the document type.
2. Follow the requested type, audience, tone, governing law, structure, and commercial or litigation posture. Reasonable document types are all accepted.
3. For private workspace facts, use only the authorized evidence and server-validated metadata. Never fill a missing Matter fact with general knowledge or present an assumption as a Matter fact.
4. General drafting conventions and normal model knowledge may be used where they are not represented as private workspace facts.
5. If authorized evidence is insufficient for a requested private fact, express that uncertainty specifically or use a neutral omission; do not invent it.
6. Do not emit internal [cit_*] tokens, numbered source markers, internal source IDs, a references list, or a source appendix unless the user explicitly requested formal citations or a source appendix. Name relevant authorities naturally when needed.
7. Do not emit bracketed placeholders when supplied metadata resolves the value. Where a genuinely required deal term is missing, use a clearly identified drafting blank only if omitting it would make the document unusable.
8. Do not add generic AI, legal-advice, lawyer-review, consultation, or informational-purpose disclaimer boilerplate.
9. Output rich, clean Markdown only. Do not wrap the document in JSON or preface it with an explanation.`;
}

export function titleForAssistantDraft(
  generatedContent: string,
  instruction: string,
  threadTitle: string
): string {
  const extracted = extractGeneratedSubject(generatedContent) || extractSummaryHeading(generatedContent);
  if (extracted) return extracted.slice(0, 300);

  const instructionLabel = instruction
    .replace(/^\s*(?:please\s+)?(?:draft|create|prepare|write|generate)\s+(?:me\s+)?(?:an?\s+)?/i, "")
    .split(/[.!?\n]/, 1)[0]
    .replace(/\s+/g, " ")
    .trim();
  if (instructionLabel) return instructionLabel.slice(0, 120);
  return `Document - ${threadTitle.trim().slice(0, 80) || "New conversation"}`;
}
