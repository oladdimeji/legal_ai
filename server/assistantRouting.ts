import { WorkspacePageContext } from "../src/types.js";
import type { Message } from "../src/types.js";
import { sanitizeWorkspacePageContext } from "../src/lib/workspacePageContext.js";
import { attachmentNamesForMessage } from "./assistant/assistantConversationState.js";
import { sanitizeEvidenceText } from "./assistant/assistantEvidence.js";
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
  const content = sanitizeEvidenceText(message.content, 2_500);
  const attachmentNames = attachmentNamesForMessage(message);
  const attachmentLabel = attachmentNames.length
    ? ` [Attachments: ${attachmentNames.join(", ")}]`
    : "";
  if (message.role === "assistant") {
    const document = message.metadata?.document;
    if (document && typeof document === "object" && !Array.isArray(document)) {
      const record = document as Record<string, unknown>;
      const id = sanitizeEvidenceText(record.id, 240);
      const title = sanitizeEvidenceText(record.title, 300);
      const matterId = sanitizeEvidenceText(record.matterId, 240);
      const kind = record.kind === "matterWorkProduct"
        ? "Matter Work Product"
        : record.kind === "assistantDocument"
          ? "Assistant Document"
          : "";
      if (id && title && kind) {
        return `ASSISTANT [Created document: ${kind} "${title}", artifact ID ${id}${matterId ? `, Matter ${matterId}` : ""}]${attachmentLabel}: ${content}`;
      }
    }
    return `ASSISTANT${attachmentLabel}: ${content}`;
  }
  const context = sanitizeWorkspacePageContext(message.metadata?.pageContext);
  if (!context) return `USER${attachmentLabel}: ${content}`;
  const label = [context.pageTitle, context.activeSection, context.selectedItem?.title]
    .map((value) => sanitizeEvidenceText(value, 300))
    .filter(Boolean)
    .join(" · ");
  return `USER [Page: ${label}]${attachmentLabel}: ${content}`;
}
