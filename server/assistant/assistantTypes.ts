import type { WorkspacePageContext } from "../../src/types.js";

export const ASSISTANT_TOOL_NAMES = [
  "get_account_profile",
  "get_firm_summary",
  "list_matters",
  "find_matter",
  "get_matter_overview",
  "list_matter_sources",
  "get_matter_intelligence",
  "list_matter_work_products",
  "get_work_product",
  "get_matter_collaboration_summary",
  "list_firm_library_documents",
  "get_firm_library_document",
  "search_workspace_documents",
  "list_assistant_documents",
  "get_assistant_document",
  "search_conversation_history",
  "get_conversation",
] as const;

export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number];

export type AssistantToolCall = {
  name: AssistantToolName;
  arguments: Record<string, unknown>;
};

export const ASSISTANT_INTENTS = [
  "general_conversation",
  "product_help",
  "workspace_lookup",
  "document_analysis",
  "legal_analysis",
  "draft",
] as const;

export type AssistantIntent = (typeof ASSISTANT_INTENTS)[number];
export type AssistantDepth = "brief" | "standard" | "thorough";

export type AssistantPlan = {
  intent: AssistantIntent;
  depth: AssistantDepth;
  needsWorkspace: boolean;
  needsCurrentPage: boolean;
  needsWeb: boolean;
  needsClarification: boolean;
  clarificationQuestion?: string;
  toolCalls: AssistantToolCall[];
};

export type AssistantSessionContext = {
  currentUtcDate: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    professionalRole: string | null;
    customProfessionalRole: string | null;
    practiceAreas: string[];
    customPracticeArea: string | null;
    workspaceType: string | null;
    firmRole: string | null;
  };
  firm: { id: string; name: string };
  page: WorkspacePageContext;
  currentMatter: {
    id: string;
    name: string;
    clientName: string | null;
    status: string | null;
  } | null;
  selectedEntity: {
    kind: string;
    id: string;
    title: string;
  } | null;
};

export type AssistantEvidenceSourceType =
  | "account"
  | "firm"
  | "matterOverview"
  | "matterSource"
  | "matterIntelligence"
  | "workProduct"
  | "collaboration"
  | "firmLibrary"
  | "assistantDocument"
  | "conversation"
  | "temporaryAttachment"
  | "web";

export type AssistantEvidence = {
  id: string;
  sourceType: AssistantEvidenceSourceType;
  title: string;
  sourceName: string;
  text: string;
  entityId?: string;
  matterId?: string;
};

export type AssistantPlannerInput = {
  content: string;
  responseMode: "chat" | "draft";
  enableWebSearch: boolean;
  forceThorough: boolean;
  hasTemporaryFiles: boolean;
  pageContext: WorkspacePageContext;
  currentMatterId: string | null;
};

