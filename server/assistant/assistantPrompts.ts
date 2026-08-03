import type { AssistantPlan, AssistantSessionContext } from "./assistantTypes.js";
import { sessionContextForPrompt } from "./assistantContext.js";

export function adaptiveAssistantTemperature(plan: AssistantPlan): number {
  if (plan.intent === "product_help" || plan.intent === "workspace_lookup" || plan.intent === "document_analysis") return 0.2;
  if (plan.intent === "legal_analysis") return plan.depth === "thorough" ? 0.25 : 0.22;
  if (plan.intent === "draft") return 0.25;
  return plan.depth === "brief" ? 0.35 : 0.42;
}

export function buildAssistantTaskPrompt(input: {
  request: string;
  plan: AssistantPlan;
  session: AssistantSessionContext;
  conversationContext: string;
  evidenceBlock: string;
  checkedLocations?: string[];
  webSearchEnabled: boolean;
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
- Live web research is ${input.webSearchEnabled && input.plan.needsWeb ? "enabled for this response" : "not being used for this response"}. Do not claim current-law verification unless live grounding is present.
- Authorized locations actually checked: ${checked}
- Never say a location was checked unless it appears in that list.

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

