import type { Account, Case, WorkspacePageContext } from "../../src/types.js";
import type { AssistantSessionContext } from "./assistantTypes.js";
import { sanitizeEvidenceText } from "./assistantEvidence.js";

export function buildAssistantSessionContext(input: {
  account: Account;
  pageContext: WorkspacePageContext;
  currentMatter: Case | null;
}): AssistantSessionContext {
  const { account, currentMatter } = input;
  if (!account.firm || account.user.account_type !== "lawyer") {
    throw new Error("Authenticated lawyer workspace is required");
  }
  const pageContext = JSON.parse(
    sanitizeEvidenceText(JSON.stringify(input.pageContext), 6_000)
  ) as WorkspacePageContext;
  const selected = pageContext.selectedItem;
  return {
    currentUtcDate: new Date().toISOString().slice(0, 10),
    user: {
      id: account.user.id,
      name: account.user.name,
      email: account.user.email,
      professionalRole: account.user.professional_role,
      customProfessionalRole: account.user.custom_professional_role,
      practiceAreas: [...account.user.practice_areas].slice(0, 20),
      customPracticeArea: account.user.custom_practice_area,
      workspaceType: account.user.workspace_type,
      firmRole: account.user.firm_role,
    },
    firm: { id: account.firm.id, name: account.firm.name },
    page: pageContext,
    currentMatter: currentMatter ? {
      id: currentMatter.id,
      name: currentMatter.name,
      clientName: currentMatter.client_name || null,
      status: currentMatter.status || null,
    } : null,
    selectedEntity: selected?.id ? {
      kind: selected.kind,
      id: selected.id,
      title: selected.title,
    } : null,
  };
}

export function sessionContextForPrompt(context: AssistantSessionContext): string {
  return JSON.stringify({
    currentUtcDate: context.currentUtcDate,
    user: {
      name: context.user.name,
      email: context.user.email,
      professionalRole: context.user.professionalRole,
      customProfessionalRole: context.user.customProfessionalRole,
      practiceAreas: context.user.practiceAreas,
      customPracticeArea: context.user.customPracticeArea,
      workspaceType: context.user.workspaceType,
      firmRole: context.user.firmRole,
    },
    firm: { name: context.firm.name },
    page: context.page,
    currentMatter: context.currentMatter,
    selectedEntity: context.selectedEntity,
  }, null, 2).slice(0, 8_000);
}

