import type { Account, Case, Document, Draft, Message, Thread } from "../../src/types.js";
import { ASSISTANT_TOOL_NAMES, type AssistantToolName } from "./assistantTypes.js";
import { sanitizeEvidenceText } from "./assistantEvidence.js";
import { conversationMessageForPrompt } from "../assistantRouting.js";

export type AssistantToolDefinition = {
  name: AssistantToolName;
  description: string;
  scope: "account" | "firm" | "matter" | "firmLibrary" | "user";
};

const DESCRIPTIONS: Record<AssistantToolName, Omit<AssistantToolDefinition, "name">> = {
  get_account_profile: { description: "Read the authenticated lawyer's safe account profile.", scope: "account" },
  get_firm_summary: { description: "Read the Firm name and the lawyer's Firm role; members are admin-only.", scope: "firm" },
  list_matters: { description: "List bounded Matter metadata for the authenticated Firm.", scope: "firm" },
  find_matter: { description: "Resolve one explicitly named authorized Matter conservatively.", scope: "firm" },
  get_matter_overview: { description: "Read the authorized Matter Overview record.", scope: "matter" },
  list_matter_sources: { description: "List authorized Matter Source metadata.", scope: "matter" },
  get_matter_intelligence: { description: "Read the authorized Matter Intelligence record.", scope: "matter" },
  list_matter_work_products: { description: "List Work Product metadata for the authorized Matter.", scope: "matter" },
  get_work_product: { description: "Read one Work Product in its authorized Matter.", scope: "matter" },
  get_matter_collaboration_summary: { description: "Read a secret-free, bounded Collaboration summary.", scope: "matter" },
  list_firm_library_documents: { description: "List Firm Library document metadata only.", scope: "firmLibrary" },
  get_firm_library_document: { description: "Read one explicitly selected Firm Library document.", scope: "firmLibrary" },
  search_workspace_documents: { description: "Search passages in one authorized Matter or Firm Library scope.", scope: "matter" },
  list_assistant_documents: { description: "List standalone documents owned by this authenticated lawyer.", scope: "user" },
  get_assistant_document: { description: "Read one standalone document owned by this authenticated lawyer.", scope: "user" },
  search_conversation_history: { description: "Search this lawyer's own non-client conversation History.", scope: "user" },
  get_conversation: { description: "Read one explicitly selected owned non-client conversation.", scope: "user" },
};

export const ASSISTANT_READ_ONLY_TOOLS: readonly AssistantToolDefinition[] = ASSISTANT_TOOL_NAMES.map((name) => ({
  name,
  ...DESCRIPTIONS[name],
}));

export function mapSafeAccountProfile(account: Account) {
  return {
    name: account.user.name,
    email: account.user.email,
    professionalRole: account.user.professional_role,
    customProfessionalRole: account.user.custom_professional_role,
    practiceAreas: account.user.practice_areas.slice(0, 20),
    customPracticeArea: account.user.custom_practice_area,
    workspaceType: account.user.workspace_type,
    firmRole: account.user.firm_role,
    firmName: account.firm?.name || null,
  };
}

export function mapMatterMetadata(matter: Case) {
  return {
    id: matter.id,
    name: matter.name,
    clientName: matter.client_name || null,
    status: matter.status || null,
    practiceArea: matter.matter_type || null,
    jurisdiction: matter.jurisdiction || null,
    lastActivityAt: matter.last_activity_at || matter.updated_at || matter.created_at,
    createdAt: matter.created_at,
  };
}

export function mapMatterOverview(matter: Case) {
  return {
    ...mapMatterMetadata(matter),
    assignmentDescription: sanitizeEvidenceText(matter.description, 4_000),
    clientEmail: matter.client_email || null,
    preliminaryObjectives: sanitizeEvidenceText(matter.preliminary_objectives, 4_000) || null,
    suggestedFields: {
      practiceArea: Boolean(matter.matter_type_suggested),
      jurisdiction: Boolean(matter.jurisdiction_suggested),
      objectives: Boolean(matter.objectives_suggested),
    },
    updatedAt: matter.updated_at || null,
  };
}

export function mapDocumentMetadata(document: Document) {
  return {
    id: document.id,
    title: document.title,
    section: document.section,
    sourceType: document.source_type || null,
    origin: document.origin || null,
    processingState: document.processing_state || null,
    linkOrigin: document.link_origin || null,
    uploadedAt: document.uploaded_at,
  };
}

export function mapWorkProductMetadata(draft: Draft) {
  return {
    id: draft.id,
    title: draft.title,
    origin: draft.origin || null,
    revisionType: draft.revision_type || null,
    sharedWithClient: Boolean(draft.shared_with_client),
    createdAt: draft.created_at,
    updatedAt: draft.updated_at || draft.created_at,
  };
}

export function mapSafeCollaboration(collaboration: any) {
  return {
    matter: collaboration?.matter ? {
      id: String(collaboration.matter.id),
      name: String(collaboration.matter.name),
    } : null,
    collaborator: collaboration?.access ? {
      name: collaboration.access.client_name || null,
      email: collaboration.access.client_email || null,
      invitationStatus: collaboration.access.invitation_status || null,
      createdAt: collaboration.access.created_at || null,
      activatedAt: collaboration.access.activated_at || null,
      revokedAt: collaboration.access.revoked_at || null,
    } : null,
    sharedWorkProducts: Array.isArray(collaboration?.shared)
      ? collaboration.shared.slice(0, 20).map((draft: any) => ({
          title: String(draft.title || "Untitled Work Product"),
          revisionType: draft.revision_type || null,
          sharedAt: draft.shared_at || null,
          updatedAt: draft.updated_at || draft.created_at || null,
          clientComments: Array.isArray(draft.client_comments)
            ? draft.client_comments.slice(0, 20).map((comment: any) => ({
                content: sanitizeEvidenceText(comment.content, 2_000),
                createdAt: comment.created_at || null,
              }))
            : [],
        }))
      : [],
    requests: Array.isArray(collaboration?.requests)
      ? collaboration.requests.slice(0, 20).map((request: any) => ({
          requestType: request.request_type || null,
          instruction: sanitizeEvidenceText(request.instruction, 2_000),
          status: request.status || null,
          createdAt: request.created_at || null,
          updatedAt: request.updated_at || null,
          workProductTitles: Array.isArray(request.documents)
            ? request.documents.slice(0, 20).map((document: any) => String(document.title || "Untitled Work Product"))
            : [],
          responses: Array.isArray(request.responses)
            ? request.responses.slice(0, 20).map((response: any) => ({
                responseType: response.response_type || null,
                content: sanitizeEvidenceText(response.content, 4_000) || null,
                isRead: Boolean(response.is_read),
                createdAt: response.created_at || null,
                attachmentTitles: Array.isArray(response.attachments)
                  ? response.attachments.slice(0, 20).map((attachment: any) =>
                      String(attachment.document_title || attachment.draft_title || "Client attachment")
                    )
                  : [],
              }))
            : [],
        }))
      : [],
    unreadResponseCount: Number(collaboration?.unread || 0),
  };
}

export function mapConversation(thread: Thread, messages: Message[]) {
  return {
    thread: {
      id: thread.id,
      title: thread.title,
      matterId: thread.case_id,
      createdAt: thread.created_at,
    },
    messages: messages.slice(-30).map((message) => ({
      role: message.role,
      content: sanitizeEvidenceText(conversationMessageForPrompt(message), 3_500),
      createdAt: message.created_at,
    })),
  };
}
