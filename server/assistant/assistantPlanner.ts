import { callModel } from "../model.js";
import { LAWYER_ASSISTANT_CHARTER } from "./assistantCharter.js";
import {
  resolveConversationResearchSourceReference,
  resolveLatestArtifactReference,
  type AssistantConversationArtifact,
} from "./assistantConversationState.js";
import {
  ASSISTANT_DELIVERABLE_KINDS,
  ASSISTANT_INTENTS,
  ASSISTANT_TOOL_NAMES,
  type AssistantDeliverablePlan,
  type AssistantIntent,
  type AssistantPlan,
  type AssistantPlannerInput,
  type AssistantToolCall,
  type AssistantToolName,
} from "./assistantTypes.js";

const DEPTHS = new Set(["brief", "standard", "thorough"]);
const INTENTS = new Set<string>(ASSISTANT_INTENTS);
const DELIVERABLES = new Set<string>(ASSISTANT_DELIVERABLE_KINDS);
const TOOLS = new Set<string>(ASSISTANT_TOOL_NAMES);
const TOOL_ARGUMENTS: Record<AssistantToolName, Readonly<Record<string, "string" | "boolean">>> = {
  get_account_profile: {},
  get_firm_summary: { includeMembers: "boolean" },
  list_matters: {},
  find_matter: { query: "string", name: "string" },
  get_matter_overview: { matterId: "string" },
  list_matter_sources: { matterId: "string" },
  get_matter_source: { matterId: "string", documentId: "string" },
  search_matter_documents: { matterId: "string", documentId: "string", query: "string" },
  get_matter_intelligence: { matterId: "string" },
  list_matter_work_products: { matterId: "string" },
  get_work_product: { matterId: "string", workProductId: "string", id: "string" },
  get_matter_collaboration_summary: { matterId: "string" },
  list_firm_library_documents: {},
  get_firm_library_document: { documentId: "string", id: "string" },
  search_firm_library_documents: { documentId: "string", query: "string" },
  list_assistant_documents: {},
  get_assistant_document: { documentId: "string", id: "string" },
  search_conversation_history: { query: "string" },
  get_conversation: { threadId: "string", id: "string" },
};

const PLAN_KEYS = new Set([
  "intent", "depth", "needsWorkspace", "needsCurrentPage", "needsWeb",
  "needsClarification", "clarificationQuestion", "deliverable",
  "referencedArtifactIds", "referencedResearchSourceIds", "toolCalls",
]);
const DELIVERABLE_KEYS = new Set(["kind", "documentAction", "sourceArtifactId"]);

type PlannerModel = typeof callModel;

const toolCallSchema = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING", enum: [...ASSISTANT_TOOL_NAMES] },
    arguments: {
      type: "OBJECT",
      properties: {
        matterId: { type: "STRING" },
        query: { type: "STRING" },
        name: { type: "STRING" },
        documentId: { type: "STRING" },
        workProductId: { type: "STRING" },
        id: { type: "STRING" },
        threadId: { type: "STRING" },
        includeMembers: { type: "BOOLEAN" },
      },
    },
  },
  required: ["name", "arguments"],
};

const plannerResponseSchema = {
  type: "OBJECT",
  properties: {
    intent: { type: "STRING", enum: [...ASSISTANT_INTENTS] },
    depth: { type: "STRING", enum: ["brief", "standard", "thorough"] },
    needsWorkspace: { type: "BOOLEAN" },
    needsCurrentPage: { type: "BOOLEAN" },
    needsWeb: { type: "BOOLEAN" },
    needsClarification: { type: "BOOLEAN" },
    clarificationQuestion: { type: "STRING" },
    deliverable: {
      type: "OBJECT",
      properties: {
        kind: { type: "STRING", enum: [...ASSISTANT_DELIVERABLE_KINDS] },
        documentAction: { type: "STRING", enum: ["create", "revise"] },
        sourceArtifactId: { type: "STRING" },
      },
      required: ["kind"],
    },
    referencedArtifactIds: { type: "ARRAY", items: { type: "STRING" } },
    referencedResearchSourceIds: { type: "ARRAY", items: { type: "STRING" } },
    toolCalls: { type: "ARRAY", items: toolCallSchema },
  },
  required: [
    "intent", "depth", "needsWorkspace", "needsCurrentPage", "needsWeb",
    "needsClarification", "deliverable", "referencedArtifactIds",
    "referencedResearchSourceIds", "toolCalls",
  ],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateAssistantToolCall(value: unknown): value is AssistantToolCall {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).some((key) => key !== "name" && key !== "arguments")) return false;
  if (typeof value.name !== "string" || !TOOLS.has(value.name) || !isPlainObject(value.arguments)) return false;
  const schema = TOOL_ARGUMENTS[value.name as AssistantToolName];
  return Object.entries(value.arguments).every(([key, argument]) =>
    key in schema && typeof argument === schema[key]
  );
}

function pageArtifact(input: AssistantPlannerInput): AssistantConversationArtifact | null {
  const selected = input.pageContext.selectedItem;
  if (!selected?.id || !selected.title) return null;
  if (selected.kind === "workProduct" && input.currentMatterId) {
    return {
      id: selected.id,
      kind: "matterWorkProduct",
      title: selected.title,
      matterId: input.currentMatterId,
      createdByMessageId: "current-page",
      createdAt: new Date(0).toISOString(),
    };
  }
  if (selected.kind === "assistantDocument") {
    return {
      id: selected.id,
      kind: "assistantDocument",
      title: selected.title,
      createdByMessageId: "current-page",
      createdAt: new Date(0).toISOString(),
    };
  }
  return null;
}

function allowedArtifacts(input: AssistantPlannerInput): AssistantConversationArtifact[] {
  const current = pageArtifact(input);
  const combined = current
    ? [current, ...input.conversationState.recentArtifacts]
    : input.conversationState.recentArtifacts;
  return [...new Map(combined.map((artifact) => [artifact.id, artifact])).values()];
}

function uniqueStringIds(value: unknown, allowed: Set<string>): string[] | null {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id.trim())) return null;
  const ids = [...new Set(value.map((id) => String(id).trim()))];
  if (ids.length > 4 || ids.some((id) => !allowed.has(id))) return null;
  return ids;
}

function validateDeliverable(value: unknown, allowedArtifactIds: Set<string>): AssistantDeliverablePlan | null {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !DELIVERABLE_KEYS.has(key))) return null;
  if (typeof value.kind !== "string" || !DELIVERABLES.has(value.kind)) return null;
  if (value.kind === "message") {
    if (value.documentAction !== undefined || value.sourceArtifactId !== undefined) return null;
    return { kind: "message" };
  }
  if (value.documentAction !== "create" && value.documentAction !== "revise") return null;
  if (value.documentAction === "create") {
    if (value.sourceArtifactId !== undefined) return null;
    return { kind: value.kind as "document" | "message_and_document", documentAction: "create" };
  }
  if (typeof value.sourceArtifactId !== "string" || !allowedArtifactIds.has(value.sourceArtifactId)) return null;
  return {
    kind: value.kind as "document" | "message_and_document",
    documentAction: "revise",
    sourceArtifactId: value.sourceArtifactId,
  };
}

export function validateAssistantPlan(
  value: unknown,
  input: AssistantPlannerInput
): AssistantPlan | null {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !PLAN_KEYS.has(key))) return null;
  if (typeof value.intent !== "string" || !INTENTS.has(value.intent)) return null;
  if (typeof value.depth !== "string" || !DEPTHS.has(value.depth)) return null;
  if (
    typeof value.needsWorkspace !== "boolean" ||
    typeof value.needsCurrentPage !== "boolean" ||
    typeof value.needsWeb !== "boolean" ||
    typeof value.needsClarification !== "boolean" ||
    !Array.isArray(value.toolCalls) ||
    !value.toolCalls.every(validateAssistantToolCall) ||
    value.toolCalls.length > 8
  ) return null;

  const artifacts = allowedArtifacts(input);
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const sourceIds = new Set(input.conversationState.recentResearchSources.filter((source) => source.available).map((source) => source.id));
  const referencedArtifactIds = uniqueStringIds(value.referencedArtifactIds, artifactIds);
  const referencedResearchSourceIds = uniqueStringIds(value.referencedResearchSourceIds, sourceIds);
  const deliverable = validateDeliverable(value.deliverable, artifactIds);
  if (!referencedArtifactIds || !referencedResearchSourceIds || !deliverable) return null;

  if (value.needsClarification) {
    if (typeof value.clarificationQuestion !== "string" || !value.clarificationQuestion.trim()) return null;
  } else if (value.clarificationQuestion !== undefined) return null;

  const allowedMatterIds = new Set<string>([
    ...(input.currentMatterId ? [input.currentMatterId] : []),
    ...artifacts.map((artifact) => artifact.matterId).filter((id): id is string => Boolean(id)),
  ]);
  const toolCalls = value.toolCalls.map((call) => ({
    name: call.name as AssistantToolName,
    arguments: call.arguments,
  }));
  for (const call of toolCalls) {
    const matterId = call.arguments.matterId;
    if (typeof matterId === "string" && !allowedMatterIds.has(matterId)) return null;
  }
  if (!value.needsWorkspace && toolCalls.length > 0) return null;
  if (!value.needsWorkspace && (
    referencedArtifactIds.length > 0 ||
    referencedResearchSourceIds.length > 0 ||
    deliverable.documentAction === "revise"
  )) return null;
  if (deliverable.documentAction === "revise" && value.intent !== "document_revision") return null;
  if (deliverable.documentAction === "create" && value.intent !== "document_creation") return null;

  return {
    intent: value.intent as AssistantIntent,
    depth: value.depth as AssistantPlan["depth"],
    needsWorkspace: value.needsWorkspace,
    needsCurrentPage: value.needsCurrentPage,
    needsWeb: value.needsWeb,
    needsClarification: value.needsClarification,
    ...(value.needsClarification
      ? { clarificationQuestion: String(value.clarificationQuestion).trim().slice(0, 500) }
      : {}),
    deliverable,
    referencedArtifactIds,
    referencedResearchSourceIds,
    toolCalls,
  };
}

function currentPageToolCalls(input: AssistantPlannerInput): AssistantToolCall[] {
  const page = input.pageContext;
  const selected = page.selectedItem;
  if (selected?.id) {
    if (selected.kind === "source" && input.currentMatterId) {
      return [{ name: "get_matter_source", arguments: { matterId: input.currentMatterId, documentId: selected.id } }];
    }
    if (selected.kind === "workProduct" && input.currentMatterId) {
      return [{ name: "get_work_product", arguments: { matterId: input.currentMatterId, workProductId: selected.id } }];
    }
    if (selected.kind === "libraryDocument") {
      return [{ name: "get_firm_library_document", arguments: { documentId: selected.id } }];
    }
    if (selected.kind === "assistantDocument") {
      return [{ name: "get_assistant_document", arguments: { documentId: selected.id } }];
    }
  }
  if (input.currentMatterId && page.routeKind === "matter") {
    if (/intelligence/i.test(page.activeSection || "")) return [{ name: "get_matter_intelligence", arguments: { matterId: input.currentMatterId } }];
    if (/collaboration/i.test(page.activeSection || "")) return [{ name: "get_matter_collaboration_summary", arguments: { matterId: input.currentMatterId } }];
    if (/overview/i.test(page.activeSection || "")) return [{ name: "get_matter_overview", arguments: { matterId: input.currentMatterId } }];
  }
  return [];
}

function fallbackToolCalls(input: AssistantPlannerInput, intent: AssistantIntent): AssistantToolCall[] {
  const text = input.content.toLowerCase();
  if (intent === "general_conversation" || intent === "product_help") return [];
  if (/professional role|practice areas?|my account|my profile/.test(text)) return [{ name: "get_account_profile", arguments: {} }];
  if (/firm (?:name|role|members?)|administrator|admin\b/.test(text)) {
    return [{ name: "get_firm_summary", arguments: { includeMembers: /members?|people|team/.test(text) } }];
  }
  if (/which matters?|list (?:my )?matters?|matters? (?:are|on|waiting|recent)/.test(text)) return [{ name: "list_matters", arguments: {} }];
  if (/another conversation|past conversations?|conversation history|\bmy history\b|conversation (?:called|titled)|different thread|find the conversation/.test(text)) {
    return [{ name: "search_conversation_history", arguments: { query: input.content } }];
  }
  if (/assistant documents?|standalone documents?/.test(text)) return [{ name: "list_assistant_documents", arguments: {} }];

  const asksFirmLibrary = /firm library|firm precedent|library precedent/.test(text);
  const asksMatter = /this matter|matter sources?|in the matter|matter documents?/.test(text);
  if (asksFirmLibrary && asksMatter && input.currentMatterId) {
    return [
      { name: "search_matter_documents", arguments: { matterId: input.currentMatterId, query: input.content } },
      { name: "search_firm_library_documents", arguments: { query: input.content } },
    ];
  }
  if (asksFirmLibrary) {
    return /\b(?:which|list|show)\b/.test(text)
      ? [{ name: "list_firm_library_documents", arguments: {} }]
      : [{ name: "search_firm_library_documents", arguments: { query: input.content } }];
  }

  const pageCalls = currentPageToolCalls(input);
  if (pageCalls.length && /\b(?:this|current|open|selected)\b|document|page|clause|obligation|summar/.test(text)) return pageCalls;

  const comparisonMatter = input.currentMatterId && /\bcompare\b/.test(text)
    ? input.content.match(/(?:with|and)\s+(?:the\s+)?(.{2,80}?)\s+Matter\b/i)?.[1]?.trim()
    : null;
  if (input.currentMatterId && comparisonMatter) {
    return [
      { name: "get_matter_overview", arguments: { matterId: input.currentMatterId } },
      { name: "find_matter", arguments: { query: comparisonMatter } },
    ];
  }
  if (input.currentMatterId) {
    if (/matter intelligence|intelligence record/.test(text)) return [{ name: "get_matter_intelligence", arguments: { matterId: input.currentMatterId } }];
    if (/client (?:say|said|response)|collaboration|waiting for the client|comments?/.test(text)) return [{ name: "get_matter_collaboration_summary", arguments: { matterId: input.currentMatterId } }];
    if (/objectives?|jurisdiction|matter overview|assignment|matter status/.test(text)) return [{ name: "get_matter_overview", arguments: { matterId: input.currentMatterId } }];
    if (/work product/.test(text)) return [{ name: "list_matter_work_products", arguments: { matterId: input.currentMatterId } }];
    if (/\b(?:which|list|show) (?:matter )?sources?\b/.test(text)) return [{ name: "list_matter_sources", arguments: { matterId: input.currentMatterId } }];
    if (/facts we have|based on the facts|legal issues should we investigate|this matter/.test(text)) {
      return [
        { name: "get_matter_overview", arguments: { matterId: input.currentMatterId } },
        { name: "search_matter_documents", arguments: { matterId: input.currentMatterId, query: input.content } },
      ];
    }
  }
  return [];
}

function fallbackDeliverable(input: AssistantPlannerInput): {
  intent: AssistantIntent;
  deliverable: AssistantDeliverablePlan;
  artifactIds: string[];
  needsClarification: boolean;
  clarificationQuestion?: string;
} {
  const text = input.content;
  const revisionRequest = /\b(?:revise|rewrite|make|shorten|expand|add|remove|change|turn)\b[\s\S]{0,100}\b(?:it|that|document|draft|memo|letter|agreement|report)\b/i.test(text);
  const creationRequest = /\b(?:draft|prepare|write|create|generate|produce)\b[\s\S]{0,100}\b(?:letter|agreement|memorandum|memo|policy|report|contract|brief|notice|document)\b/i.test(text);
  const explanatoryRequest = /\b(?:analy[sz]e|explain|tell me|assess|identify|risks?|strategy|recommend)\b/i.test(text);
  if (revisionRequest) {
    const resolved = resolveLatestArtifactReference({
      content: text,
      conversationState: input.conversationState,
      pageContext: input.pageContext,
      currentMatterId: input.currentMatterId,
    });
    if (resolved.artifact) {
      return {
        intent: "document_revision",
        deliverable: { kind: explanatoryRequest ? "message_and_document" : "document", documentAction: "revise", sourceArtifactId: resolved.artifact.id },
        artifactIds: [resolved.artifact.id],
        needsClarification: false,
      };
    }
    if (resolved.needsClarification) {
      return {
        intent: "document_revision",
        deliverable: { kind: "message" },
        artifactIds: [],
        needsClarification: true,
        clarificationQuestion: "Which previously created document would you like me to revise?",
      };
    }
  }
  if (creationRequest) {
    return {
      intent: "document_creation",
      deliverable: { kind: explanatoryRequest ? "message_and_document" : "document", documentAction: "create" },
      artifactIds: [],
      needsClarification: false,
    };
  }
  return {
    intent: "general_conversation",
    deliverable: { kind: "message" },
    artifactIds: [],
    needsClarification: false,
  };
}

export function fallbackAssistantPlan(input: AssistantPlannerInput): AssistantPlan {
  const text = input.content.trim().toLowerCase();
  const deliverableDecision = fallbackDeliverable(input);
  const pageReference = /\b(this|current|open|selected) (?:page|document|source|work product|record)\b|\bwhat can i do here\b|\bthese controls\b/.test(text);
  const selectedDocument = input.hasTemporaryFiles || Boolean(input.pageContext.selectedItem &&
    ["source", "libraryDocument", "workProduct", "assistantDocument"].includes(input.pageContext.selectedItem.kind));
  const workspaceFact = /\b(my|our|this|the) (?:matter|client|work product|sources?|account|profile|firm|professional role|practice areas?|history)\b|\bwhich matters?\b|\bworkspace\b|\bcollaboration\b|\bfirm library\b|\bassistant documents?\b|\bfacts we have\b|\bbased on the facts\b/.test(text);
  const legalAnalysis = /\b(?:law|legal|clause|contract|liability|claim|defen[cs]e|jurisdiction|statute|case law|issue|promissory estoppel|estoppel)\b/.test(text);
  let intent = deliverableDecision.intent;
  if (intent === "general_conversation") {
    intent = selectedDocument
      ? "document_analysis"
      : pageReference
        ? "product_help"
        : workspaceFact
          ? (legalAnalysis ? "legal_analysis" : "workspace_lookup")
          : (legalAnalysis ? "legal_analysis" : "general_conversation");
  }
  const artifactResolution = resolveLatestArtifactReference({
    content: input.content,
    conversationState: input.conversationState,
    pageContext: input.pageContext,
    currentMatterId: input.currentMatterId,
  });
  const sourceResolution = resolveConversationResearchSourceReference({
    content: input.content,
    conversationState: input.conversationState,
  });
  const referencedArtifactIds = deliverableDecision.artifactIds.length
    ? deliverableDecision.artifactIds
    : artifactResolution.artifact ? [artifactResolution.artifact.id] : [];
  const referencedResearchSourceIds = sourceResolution.source?.available ? [sourceResolution.source.id] : [];
  const toolCalls = fallbackToolCalls(input, intent);
  const needsClarification = deliverableDecision.needsClarification || sourceResolution.needsClarification || Boolean(sourceResolution.source && !sourceResolution.source.available);
  const clarificationQuestion = deliverableDecision.clarificationQuestion
    || (sourceResolution.needsClarification ? "Which attached research source do you mean?" : undefined)
    || (sourceResolution.source && !sourceResolution.source.available ? `Please reattach ${sourceResolution.source.name}; this older conversation saved its name but not its extracted text.` : undefined);
  return {
    intent,
    depth: /\b(?:thorough|deep|comprehensive|exhaustive)\b/.test(text) ? "thorough" : text.length < 100 ? "brief" : "standard",
    needsWorkspace: toolCalls.length > 0 || selectedDocument || referencedArtifactIds.length > 0 || referencedResearchSourceIds.length > 0,
    needsCurrentPage: pageReference || selectedDocument,
    needsWeb: /\b(?:current|latest|today|recent|changed law|new regulation|current deadline|verify|up[- ]to[- ]date|search the web|look up|web research)\b/.test(text)
      && !/\b(?:summarize|rewrite|explain)\b[\s\S]{0,80}\b(?:attached|agreement|document|clause)\b/.test(text),
    needsClarification,
    ...(clarificationQuestion ? { clarificationQuestion } : {}),
    deliverable: deliverableDecision.deliverable,
    referencedArtifactIds,
    referencedResearchSourceIds,
    toolCalls,
  };
}

export async function planAssistantRequest(
  input: AssistantPlannerInput,
  model: PlannerModel = callModel
): Promise<AssistantPlan> {
  const prompt = `Plan the next Exepts lawyer-assistant response. Return only the requested JSON object. Do not include rationale or hidden reasoning.

Deliverable rules:
- Use message for explanations, summaries, clause analysis, assumptions, product help, and short wording fragments.
- Use document/create for a requested standalone letter, agreement, memorandum, policy, report, or similar formal deliverable.
- Use message_and_document/create when the user asks both for analysis or strategy and for a formal standalone document.
- Use document/revise only for a clear revision of one exact authorized generated artifact. Never overwrite it.
- A long answer alone is not a saved document. A two-sentence clause normally remains a message.

Retrieval rules:
- Ordinary greetings, stable legal explanations, rewriting, and product help need no private tools.
- The exact current conversation is already supplied. Do not search global History for what was said above, current-thread conclusions, or a document created in this conversation.
- Search global History only for another conversation, a named past thread, or an explicit cross-thread request.
- Use the current page only for page-referential requests and exact selected records.
- Firm Library requests must use Firm Library tools even inside a Matter. Matter searches must use Matter tools.
- Do not invent IDs. Referenced artifact and research-source IDs must be copied exactly from the ledgers.
- Each named temporary attachment is already uploaded, successfully extracted, authorized, and available as evidence for this request. Do not ask for a Matter, Firm Library, document library, workspace location, document name, or re-upload merely to access it.
- A named other Matter must first use find_matter. Ask one focused clarification only when genuinely unavoidable.
- Choose web research autonomously for current/latest law, recent authority, changed rules, current deadlines, explicit lookup/search/verification, and other potentially changed public facts.
- Avoid web research for private-document summaries, supplied-text rewriting, stable concepts, product help, and workspace metadata.
- Available tools: ${ASSISTANT_TOOL_NAMES.join(", ")}.

Request data:
${JSON.stringify({
    content: input.content,
    hasTemporaryFiles: input.hasTemporaryFiles,
    temporaryFileNames: input.temporaryFileNames,
    currentMatterId: input.currentMatterId,
    page: input.pageContext,
    conversationState: input.conversationState,
    currentUtcDate: new Date().toISOString().slice(0, 10),
  }).slice(0, 24_000)}`;
  try {
    const result = await model("assistant-planner", [{ role: "user", content: prompt }], {
      systemInstruction: LAWYER_ASSISTANT_CHARTER,
      responseMimeType: "application/json",
      responseSchema: plannerResponseSchema,
    });
    const parsed = validateAssistantPlan(JSON.parse(result.text), input);
    return parsed || fallbackAssistantPlan(input);
  } catch (error) {
    console.error("Assistant planning failed; using safe fallback:", error);
    return fallbackAssistantPlan(input);
  }
}
