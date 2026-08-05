import type { AssistantPlan, AssistantSessionContext } from "./assistantTypes.js";
import { sessionContextForPrompt } from "./assistantContext.js";
import type { ModelThinkingLevel } from "../model.js";

export function adaptiveAssistantThinkingLevel(
  plan: AssistantPlan
): ModelThinkingLevel {
  if (plan.depth === "thorough") return "high";

  if (
    plan.intent === "product_help" ||
    plan.intent === "general_conversation"
  ) {
    return "low";
  }

  return "medium";
}

export function buildAssistantTaskPrompt(input: {
  request: string;
  plan: AssistantPlan;
  session: AssistantSessionContext;
  conversationContext: string;
  evidenceBlock: string;
  checkedLocations?: string[];
  webResearchPerformed: boolean;
  generatedDocumentContext?: string;
}): string {
  const checked = input.checkedLocations?.length
    ? input.checkedLocations.join(", ")
    : "No private workspace locations were checked.";
  return `Complete the user's request as one coherent Exepts assistant.

Current task requirements:
- Intent: ${input.plan.intent}
- Requested depth: ${input.plan.depth}
- Answer the question first and use headings only when they improve a serious answer.
- Private facts must be supported by the authorized evidence. General knowledge may be used normally but must not be presented as a workspace fact.
- For legal analysis involving private facts, distinguish the workspace facts, general legal framework, analysis or inference, and specifically missing information when useful.
- Public web research was ${input.webResearchPerformed ? "actually performed and grounded sources are included below" : "not performed for this response"}. Do not claim current-law verification unless grounded public evidence is present.
- Authorized locations actually checked: ${checked}
- Never say a location was checked unless it appears in that list.
- Use the authorized evidence accurately, but do not place inline citation markers, source numbers, citation IDs, footnote markers, or source links inside the response prose. Exepts displays the supporting sources separately below the response.
- Do not mention internal citation identifiers such as cit_1 or cit_web_1. Do not append a source list to the response. Do not invent citations.

Server-validated session context:
${sessionContextForPrompt(input.session)}

Prior conversation is for continuity and reference resolution; it is not independent legal evidence:
<conversation_memory>
${input.conversationContext || "No prior conversation."}
</conversation_memory>

${input.evidenceBlock}

${input.generatedDocumentContext ? `<generated_document_context>\n${input.generatedDocumentContext}\n</generated_document_context>` : ""}

User request:
${input.request}`;
}
