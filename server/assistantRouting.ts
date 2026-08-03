import { WorkspacePageContext } from "../src/types.js";
import type { Message } from "../src/types.js";
import { sanitizeWorkspacePageContext } from "../src/lib/workspacePageContext.js";
export { routeAssistantRequest } from "../src/lib/assistantRequestRouting.js";

export function currentMatterIdForAssistant(
  pageContext: WorkspacePageContext
): string | null {
  return pageContext.routeKind === "matter" ? pageContext.matter?.id || null : null;
}

export function pageContextForPrompt(context: WorkspacePageContext): string {
  return JSON.stringify(context, null, 2).slice(0, 6000);
}

export function conversationMessageForPrompt(message: Message): string {
  if (message.role !== "user") return `${message.role.toUpperCase()}: ${message.content}`;
  const context = sanitizeWorkspacePageContext(message.metadata?.pageContext);
  if (!context) return `USER: ${message.content}`;
  const label = [context.pageTitle, context.activeSection, context.selectedItem?.title]
    .filter(Boolean)
    .join(" · ");
  return `USER [Page: ${label}]: ${message.content}`;
}
