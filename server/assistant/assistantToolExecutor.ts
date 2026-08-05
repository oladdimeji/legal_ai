import { db } from "../db.js";
import type { OwnershipContext } from "../db.js";
import type { Account } from "../../src/types.js";
import { boundEvidence, sanitizeEvidenceText } from "./assistantEvidence.js";
import type {
  AssistantEvidence,
  AssistantPlan,
  AssistantToolCall,
  AssistantToolName,
} from "./assistantTypes.js";
import {
  mapConversation,
  mapDocumentMetadata,
  mapMatterMetadata,
  mapMatterOverview,
  mapSafeAccountProfile,
  mapSafeCollaboration,
  mapWorkProductMetadata,
} from "./assistantTools.js";
import { retrieveAssistantPassages } from "./assistantRetrieval.js";

export const ASSISTANT_TOOL_LIMITS = {
  planningRounds: 2,
  calls: 8,
  nonCurrentMatters: 2,
  matterRows: 50,
  documentRows: 25,
  passages: 12,
  historyRows: 10,
  evidenceChars: 26_000,
} as const;

type Database = typeof db;

export type AssistantToolRunResult = {
  evidence: AssistantEvidence[];
  checkedLocations: string[];
  attemptedCalls: number;
  limitReached: boolean;
  errors: string[];
  resolvedMatterIds: string[];
  clarificationQuestion?: string;
};

function stringArgument(call: AssistantToolCall, key: string, max = 500): string | null {
  const value = call.arguments[key];
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function booleanArgument(call: AssistantToolCall, key: string): boolean {
  return call.arguments[key] === true;
}

function evidence(
  callIndex: number,
  sourceType: AssistantEvidence["sourceType"],
  title: string,
  sourceName: string,
  value: unknown,
  ids: { entityId?: string; matterId?: string } = {}
): AssistantEvidence {
  return {
    id: `workspace_${callIndex}`,
    sourceType,
    title,
    sourceName,
    text: sanitizeEvidenceText(JSON.stringify(value, null, 2)),
    ...ids,
  };
}

function conservativeMatterMatches(matters: Awaited<ReturnType<Database["getCases"]>>, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  const exact = matters.filter((matter) => matter.name.toLocaleLowerCase() === normalized);
  if (exact.length) return exact.slice(0, 5);
  const clientExact = matters.filter((matter) => (matter.client_name || "").toLocaleLowerCase() === normalized);
  if (clientExact.length) return clientExact.slice(0, 5);
  if (normalized.length < 3) return [];
  return matters.filter((matter) =>
    matter.name.toLocaleLowerCase().includes(normalized) ||
    (matter.client_name || "").toLocaleLowerCase().includes(normalized)
  ).slice(0, 5);
}

export async function executeAssistantToolPlan(input: {
  plan: AssistantPlan;
  account: Account;
  ownership: OwnershipContext;
  currentMatterId: string | null;
  request: string;
  authorizedMatterIds?: string[];
  database?: Database;
}): Promise<AssistantToolRunResult> {
  const database = input.database || db;
  const result: AssistantToolRunResult = {
    evidence: [], checkedLocations: [], attemptedCalls: 0,
    limitReached: false, errors: [], resolvedMatterIds: [],
  };
  const allowedMatterIds = new Set<string>();
  if (input.currentMatterId) allowedMatterIds.add(input.currentMatterId);
  const nonCurrentMatterIds = new Set<string>();
  for (const matterId of input.authorizedMatterIds || []) {
    allowedMatterIds.add(matterId);
    if (matterId !== input.currentMatterId) nonCurrentMatterIds.add(matterId);
    if (!result.resolvedMatterIds.includes(matterId)) result.resolvedMatterIds.push(matterId);
  }
  let uniquelyResolvedMatterId: string | null = null;

  const authorizeMatter = async (matterId: string | null) => {
    if (!matterId || !allowedMatterIds.has(matterId)) throw new Error("Matter was not authorized for this request");
    if (matterId !== input.currentMatterId) {
      nonCurrentMatterIds.add(matterId);
      if (nonCurrentMatterIds.size > ASSISTANT_TOOL_LIMITS.nonCurrentMatters) {
        throw new Error("Non-current Matter limit reached");
      }
    }
    const matter = await database.getCaseById(matterId, input.ownership);
    if (!matter) throw new Error("Matter not found");
    return matter;
  };

  const execute = async (call: AssistantToolCall) => {
    if (result.attemptedCalls >= ASSISTANT_TOOL_LIMITS.calls) {
      result.limitReached = true;
      return;
    }
    result.attemptedCalls += 1;
    const index = result.attemptedCalls;
    try {
      switch (call.name) {
        case "get_account_profile": {
          result.checkedLocations.push("Account profile");
          result.evidence.push(evidence(index, "account", "Authenticated account profile", "Exepts Account", mapSafeAccountProfile(input.account)));
          break;
        }
        case "get_firm_summary": {
          result.checkedLocations.push("Firm profile");
          const value = await database.getAssistantSafeFirmSummary(input.ownership, booleanArgument(call, "includeMembers"));
          result.evidence.push(evidence(index, "firm", "Firm summary", "Exepts Firm", value));
          break;
        }
        case "list_matters": {
          result.checkedLocations.push("Matter list");
          const matters = (await database.getCases(input.ownership)).slice(0, ASSISTANT_TOOL_LIMITS.matterRows);
          result.evidence.push(evidence(index, "matterOverview", "Authorized Matter list", "Exepts Matters", matters.map(mapMatterMetadata)));
          break;
        }
        case "find_matter": {
          result.checkedLocations.push("Matter names");
          const query = stringArgument(call, "query") || stringArgument(call, "name");
          if (!query) throw new Error("Matter name is required");
          const matters = (await database.getCases(input.ownership)).slice(0, ASSISTANT_TOOL_LIMITS.matterRows);
          const matches = conservativeMatterMatches(matters, query);
          if (matches.length === 1) {
            const id = matches[0].id;
            if (id !== input.currentMatterId && nonCurrentMatterIds.size >= ASSISTANT_TOOL_LIMITS.nonCurrentMatters) {
              throw new Error("Non-current Matter limit reached");
            }
            allowedMatterIds.add(id);
            uniquelyResolvedMatterId = id;
            if (!result.resolvedMatterIds.includes(id)) result.resolvedMatterIds.push(id);
          } else if (matches.length > 1) {
            result.clarificationQuestion = `I found more than one matching Matter: ${matches.map((matter) => matter.name).join(", ")}. Which Matter do you mean?`;
          }
          result.evidence.push(evidence(index, "matterOverview", `Matter matches for ${query}`, "Exepts Matters", matches.map(mapMatterMetadata)));
          break;
        }
        case "get_matter_overview": {
          const matterId = stringArgument(call, "matterId") || input.currentMatterId;
          const matter = await authorizeMatter(matterId);
          result.checkedLocations.push(`Matter Overview: ${matter.name}`);
          result.evidence.push(evidence(index, "matterOverview", `${matter.name} — Overview`, "Matter Overview", mapMatterOverview(matter), { entityId: matter.id, matterId: matter.id }));
          break;
        }
        case "list_matter_sources": {
          const matterId = stringArgument(call, "matterId") || input.currentMatterId;
          const matter = await authorizeMatter(matterId);
          const documents = (await database.getCaseSources(matter.id, input.ownership)).slice(0, ASSISTANT_TOOL_LIMITS.documentRows);
          result.checkedLocations.push(`Matter Sources: ${matter.name}`);
          result.evidence.push(evidence(index, "matterSource", `${matter.name} — Sources`, "Matter Sources", documents.map(mapDocumentMetadata), { matterId: matter.id }));
          break;
        }
        case "get_matter_source": {
          const matterId = stringArgument(call, "matterId") || input.currentMatterId;
          const documentId = stringArgument(call, "documentId");
          const matter = await authorizeMatter(matterId);
          if (!documentId) throw new Error("Matter Source ID is required");
          const document = await database.getDocumentById(documentId, input.ownership, matter.id);
          if (!document) throw new Error("Matter Source not found in this Matter");
          result.checkedLocations.push(`Matter Source: ${document.title}`);
          result.evidence.push(evidence(index, "matterSource", document.title, "Matter Sources", {
            ...mapDocumentMetadata(document),
            content: sanitizeEvidenceText(document.extracted_text),
          }, { entityId: document.id, matterId: matter.id }));
          break;
        }
        case "get_matter_intelligence": {
          const matterId = stringArgument(call, "matterId") || input.currentMatterId;
          const matter = await authorizeMatter(matterId);
          const record = await database.getMatterIntelligence(matter.id, input.ownership);
          result.checkedLocations.push(`Matter Intelligence: ${matter.name}`);
          const value = record ? {
            content: sanitizeEvidenceText(record.content),
            version: record.version,
            generatedAt: record.generated_at,
            lastEditedAt: record.last_edited_at,
            sourcesChanged: Boolean(record.sources_changed),
          } : { status: "not_generated" };
          result.evidence.push(evidence(index, "matterIntelligence", `${matter.name} — Matter Intelligence`, "Matter Intelligence", value, { matterId: matter.id }));
          break;
        }
        case "list_matter_work_products": {
          const matterId = stringArgument(call, "matterId") || input.currentMatterId;
          const matter = await authorizeMatter(matterId);
          const drafts = (await database.getDrafts(input.ownership, matter.id)).slice(0, ASSISTANT_TOOL_LIMITS.documentRows);
          result.checkedLocations.push(`Work Product list: ${matter.name}`);
          result.evidence.push(evidence(index, "workProduct", `${matter.name} — Work Product`, "Matter Work Product", drafts.map(mapWorkProductMetadata), { matterId: matter.id }));
          if (drafts[0] && /\b(?:latest|compare|address|revise|review)\b/i.test(input.request)) {
            await execute({
              name: "get_work_product",
              arguments: { matterId: matter.id, workProductId: drafts[0].id },
            });
          }
          break;
        }
        case "get_work_product": {
          const matterId = stringArgument(call, "matterId") || input.currentMatterId;
          const draftId = stringArgument(call, "workProductId") || stringArgument(call, "id");
          const matter = await authorizeMatter(matterId);
          if (!draftId) throw new Error("Work Product ID is required");
          const draft = await database.getDraftById(draftId, matter.id, input.ownership);
          if (!draft) throw new Error("Work Product not found");
          result.checkedLocations.push(`Work Product: ${draft.title}`);
          result.evidence.push(evidence(index, "workProduct", draft.title, "Matter Work Product", {
            ...mapWorkProductMetadata(draft), content: sanitizeEvidenceText(draft.content),
          }, { entityId: draft.id, matterId: matter.id }));
          break;
        }
        case "get_matter_collaboration_summary": {
          const matterId = stringArgument(call, "matterId") || input.currentMatterId;
          const matter = await authorizeMatter(matterId);
          const collaboration = await database.getCollaboration(matter.id, input.ownership);
          result.checkedLocations.push(`Collaboration: ${matter.name}`);
          result.evidence.push(evidence(index, "collaboration", `${matter.name} — Collaboration`, "Matter Collaboration", mapSafeCollaboration(collaboration), { matterId: matter.id }));
          break;
        }
        case "list_firm_library_documents": {
          const documents = (await database.getDocuments(input.ownership, null)).slice(0, ASSISTANT_TOOL_LIMITS.documentRows);
          result.checkedLocations.push("Firm Library document list");
          result.evidence.push(evidence(index, "firmLibrary", "Firm Library documents", "Firm Library", documents.map(mapDocumentMetadata)));
          break;
        }
        case "get_firm_library_document": {
          const documentId = stringArgument(call, "documentId") || stringArgument(call, "id");
          if (!documentId) throw new Error("Firm Library document ID is required");
          const document = await database.getDocumentById(documentId, input.ownership, null);
          if (!document) throw new Error("Firm Library document not found");
          result.checkedLocations.push(`Firm Library document: ${document.title}`);
          result.evidence.push(evidence(index, "firmLibrary", document.title, "Firm Library", {
            ...mapDocumentMetadata(document), content: sanitizeEvidenceText(document.extracted_text),
          }, { entityId: document.id }));
          break;
        }
        case "search_matter_documents": {
          const matterId = stringArgument(call, "matterId") || input.currentMatterId;
          const matter = await authorizeMatter(matterId);
          result.checkedLocations.push(`Matter document passages: ${matter.name}`);
          const query = stringArgument(call, "query", 4_000) || input.request.slice(0, 4_000);
          const retrieval = await retrieveAssistantPassages({
            query,
            scope: matter.id,
            ownership: input.ownership,
            depth: input.plan.depth,
            intent: input.plan.intent === "document_creation" || input.plan.intent === "document_revision" ? "draft" : input.plan.intent === "workspace_lookup" ? "lookup" : "analysis",
            selectedDocumentId: stringArgument(call, "documentId"),
            database,
          });
          for (const passage of retrieval.passages.slice(0, ASSISTANT_TOOL_LIMITS.passages)) {
            result.evidence.push(evidence(index * 100 + result.evidence.length, "matterSource", passage.title, "Matter Sources", {
              passage: sanitizeEvidenceText(passage.text, 4_000),
              retrievalScore: Number(passage.score.toFixed(4)),
            }, { entityId: passage.documentId, matterId: matter.id }));
          }
          break;
        }
        case "search_firm_library_documents": {
          result.checkedLocations.push("Firm Library document passages");
          const query = stringArgument(call, "query", 4_000) || input.request.slice(0, 4_000);
          const retrieval = await retrieveAssistantPassages({
            query,
            scope: "wide",
            ownership: input.ownership,
            depth: input.plan.depth,
            intent: input.plan.intent === "document_creation" || input.plan.intent === "document_revision" ? "draft" : input.plan.intent === "workspace_lookup" ? "lookup" : "analysis",
            selectedDocumentId: stringArgument(call, "documentId"),
            database,
          });
          for (const passage of retrieval.passages.slice(0, ASSISTANT_TOOL_LIMITS.passages)) {
            result.evidence.push(evidence(index * 100 + result.evidence.length, "firmLibrary", passage.title, "Firm Library", {
              passage: sanitizeEvidenceText(passage.text, 4_000),
              retrievalScore: Number(passage.score.toFixed(4)),
            }, { entityId: passage.documentId }));
          }
          break;
        }
        case "list_assistant_documents": {
          const documents = await database.getAssistantDocuments(input.ownership, ASSISTANT_TOOL_LIMITS.documentRows);
          result.checkedLocations.push("Private assistant documents");
          result.evidence.push(evidence(index, "assistantDocument", "Private assistant documents", "Assistant Documents", documents.map((document) => ({
            id: document.id, title: document.title, createdAt: document.created_at, updatedAt: document.updated_at,
          }))));
          break;
        }
        case "get_assistant_document": {
          const documentId = stringArgument(call, "documentId") || stringArgument(call, "id");
          if (!documentId) throw new Error("Assistant document ID is required");
          const document = await database.getAssistantDocumentById(documentId, input.ownership);
          if (!document) throw new Error("Assistant document not found");
          result.checkedLocations.push(`Private assistant document: ${document.title}`);
          result.evidence.push(evidence(index, "assistantDocument", document.title, "Assistant Documents", {
            title: document.title, content: sanitizeEvidenceText(document.content),
            createdAt: document.created_at, updatedAt: document.updated_at,
          }, { entityId: document.id }));
          break;
        }
        case "search_conversation_history": {
          const query = stringArgument(call, "query") || input.request;
          const matches = await database.searchAssistantConversationHistory(input.ownership, query, ASSISTANT_TOOL_LIMITS.historyRows);
          result.checkedLocations.push("Owned lawyer conversation History");
          result.evidence.push(evidence(index, "conversation", `Conversation matches for ${query}`, "Assistant History", matches));
          break;
        }
        case "get_conversation": {
          const threadId = stringArgument(call, "threadId") || stringArgument(call, "id");
          if (!threadId) throw new Error("Conversation ID is required");
          const thread = await database.getThreadById(threadId, input.ownership);
          if (!thread) throw new Error("Conversation not found");
          const messages = await database.getRecentMessages(thread.id, input.ownership, 30);
          result.checkedLocations.push(`Owned conversation: ${thread.title}`);
          result.evidence.push(evidence(index, "conversation", thread.title, "Assistant History", mapConversation(thread, messages), { entityId: thread.id, ...(thread.case_id ? { matterId: thread.case_id } : {}) }));
          break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed";
      result.errors.push(`${call.name}: ${message}`);
    }
  };

  for (const call of input.plan.toolCalls.slice(0, ASSISTANT_TOOL_LIMITS.calls)) await execute(call);
  if (input.plan.toolCalls.length > ASSISTANT_TOOL_LIMITS.calls) result.limitReached = true;

  const hasResolvedOverview = uniquelyResolvedMatterId && result.evidence.some((item) =>
    item.sourceType === "matterOverview" && item.matterId === uniquelyResolvedMatterId
  );
  if (uniquelyResolvedMatterId && !hasResolvedOverview && /\b(compare|objective|jurisdiction|status|client|overview)\b/i.test(input.request)) {
    await execute({ name: "get_matter_overview", arguments: { matterId: uniquelyResolvedMatterId } });
  }

  result.evidence = boundEvidence(result.evidence, ASSISTANT_TOOL_LIMITS.evidenceChars);
  result.checkedLocations = [...new Set(result.checkedLocations)];
  return result;
}

export function toolIsReadOnly(name: AssistantToolName): boolean {
  return !/^(create|update|delete|share|send|invite|rotate|revoke|edit)_/.test(name);
}
