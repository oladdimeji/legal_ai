import { WorkspacePageContext } from "../src/types.js";
export { routeAssistantRequest } from "../src/lib/assistantRequestRouting.js";

export function validatePageContextThreadBoundary(
  pageContext: WorkspacePageContext,
  threadCaseId: string | null
): { valid: true } | { valid: false; error: string } {
  const submittedMatterId = pageContext.routeKind === "matter" ? pageContext.matter?.id || null : null;
  if (submittedMatterId !== threadCaseId) {
    return {
      valid: false,
      error: "The conversation does not belong to the submitted page context.",
    };
  }
  return { valid: true };
}

export function pageContextForPrompt(context: WorkspacePageContext): string {
  return JSON.stringify(context, null, 2).slice(0, 6000);
}
