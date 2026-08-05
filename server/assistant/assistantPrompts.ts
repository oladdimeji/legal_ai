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
- When an evidence record has an id beginning with cit_, cite supported material workspace claims inline using that exact bracketed id. Do not invent citation ids and do not force citations onto trivial account or UI answers.

Server-validated session context:
${sessionContextForPrompt(input.session)}

Prior conversation is for continuity and reference resolution; it is not independent legal evidence:
<conversation_memory>
${input.conversationContext || "No prior conversation."}
</conversation_memory>

${input.evidenceBlock}

User request:
${input.request}`;
}
