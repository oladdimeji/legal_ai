import { callModel } from "../model.js";
import { LAWYER_ASSISTANT_CHARTER } from "./assistantCharter.js";
import {
  ASSISTANT_INTENTS,
  ASSISTANT_TOOL_NAMES,
  type AssistantIntent,
  type AssistantPlan,
  type AssistantPlannerInput,
  type AssistantToolCall,
  type AssistantToolName,
} from "./assistantTypes.js";

const DEPTHS = new Set(["brief", "standard", "thorough"]);
const INTENTS = new Set<string>(ASSISTANT_INTENTS);
const TOOLS = new Set<string>(ASSISTANT_TOOL_NAMES);
const TOOL_ARGUMENTS: Record<AssistantToolName, Readonly<Record<string, "string" | "boolean">>> = {
  get_account_profile: {},
  get_firm_summary: { includeMembers: "boolean" },
  list_matters: {},
  find_matter: { query: "string", name: "string" },
  get_matter_overview: { matterId: "string" },
  list_matter_sources: { matterId: "string" },
  get_matter_intelligence: { matterId: "string" },
  list_matter_work_products: { matterId: "string" },
  get_work_product: { matterId: "string", workProductId: "string", id: "string" },
  get_matter_collaboration_summary: { matterId: "string" },
  list_firm_library_documents: {},
  get_firm_library_document: { documentId: "string", id: "string" },
  search_workspace_documents: { matterId: "string", documentId: "string", query: "string" },
  list_assistant_documents: {},
  get_assistant_document: { documentId: "string", id: "string" },
  search_conversation_history: { query: "string" },
  get_conversation: { threadId: "string", id: "string" },
};
const PLAN_KEYS = new Set([
  "intent", "depth", "needsWorkspace", "needsCurrentPage", "needsWeb",
  "needsClarification", "clarificationQuestion", "toolCalls",
]);

type PlannerModel = typeof callModel;

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
    toolCalls: {
      type: "ARRAY",
      items: {
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
      },
    },
  },
  required: [
    "intent", "depth", "needsWorkspace", "needsCurrentPage", "needsWeb",
    "needsClarification", "toolCalls",
  ],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateToolCall(value: unknown): value is AssistantToolCall {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).some((key) => key !== "name" && key !== "arguments")) return false;
  if (typeof value.name !== "string" || !TOOLS.has(value.name) || !isPlainObject(value.arguments)) return false;
  const schema = TOOL_ARGUMENTS[value.name as AssistantToolName];
  return Object.entries(value.arguments).every(([key, argument]) =>
    key in schema && typeof argument === schema[key]
  );
}

export function validateAssistantPlan(value: unknown, enableWebSearch: boolean): AssistantPlan | null {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !PLAN_KEYS.has(key))) return null;
  if (typeof value.intent !== "string" || !INTENTS.has(value.intent)) return null;
  if (typeof value.depth !== "string" || !DEPTHS.has(value.depth)) return null;
  if (
    typeof value.needsWorkspace !== "boolean" ||
    typeof value.needsCurrentPage !== "boolean" ||
    typeof value.needsWeb !== "boolean" ||
    typeof value.needsClarification !== "boolean" ||
    !Array.isArray(value.toolCalls) ||
    !value.toolCalls.every(validateToolCall) ||
    value.toolCalls.length > 8
  ) return null;
  if (value.needsWeb && !enableWebSearch) return null;
  if (value.needsClarification) {
    if (typeof value.clarificationQuestion !== "string" || !value.clarificationQuestion.trim()) return null;
  } else if (value.clarificationQuestion !== undefined) {
    return null;
  }
  const toolCalls = value.toolCalls.map((call) => ({
    name: call.name as AssistantToolName,
    arguments: call.arguments,
  }));
  if (!value.needsWorkspace && toolCalls.length > 0) return null;
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
    toolCalls,
  };
}

function fallbackToolCalls(input: AssistantPlannerInput, intent: AssistantIntent): AssistantToolCall[] {
  const text = input.content.toLowerCase();
  if (intent === "general_conversation" || intent === "product_help") return [];
  if (/professional role|practice areas?|my account|my profile/.test(text)) {
    return [{ name: "get_account_profile", arguments: {} }];
  }
  if (/firm (?:name|role|members?)|administrator|admin\b/.test(text)) {
    return [{ name: "get_firm_summary", arguments: { includeMembers: /members?|people|team/.test(text) } }];
  }
  if (/which matters?|list (?:my )?matters?|matters? (?:are|on|waiting|recent)/.test(text)) {
    return [{ name: "list_matters", arguments: {} }];
  }
  if (/conversation history|\bmy history\b|previous conversation|what did we conclude/.test(text)) {
    return [{ name: "search_conversation_history", arguments: { query: input.content } }];
  }
  if (/assistant documents?|standalone documents?/.test(text)) {
    return [{ name: "list_assistant_documents", arguments: {} }];
  }
  if (/firm library/.test(text)) {
    return /\b(?:which|list|show)\b/.test(text)
      ? [{ name: "list_firm_library_documents", arguments: {} }]
      : [{ name: "search_workspace_documents", arguments: { query: input.content } }];
  }
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
    const calls: AssistantToolCall[] = [];
    if (/matter intelligence|intelligence record/.test(text)) {
      calls.push({ name: "get_matter_intelligence", arguments: { matterId: input.currentMatterId } });
    }
    if (/client (?:say|said|response)|collaboration|waiting for the client|comments?/.test(text)) {
      calls.push({ name: "get_matter_collaboration_summary", arguments: { matterId: input.currentMatterId } });
    }
    if (/objectives?|jurisdiction|matter overview|assignment|matter status/.test(text)) {
      calls.push({ name: "get_matter_overview", arguments: { matterId: input.currentMatterId } });
    }
    if (/work product|draft/.test(text)) {
      calls.push({ name: "list_matter_work_products", arguments: { matterId: input.currentMatterId } });
    }
    if (/\b(?:which|list|show) (?:matter )?sources?\b/.test(text)) {
      calls.push({ name: "list_matter_sources", arguments: { matterId: input.currentMatterId } });
    }
    if (/facts we have|based on the facts|legal issues should we investigate/.test(text)) {
      calls.push(
        { name: "get_matter_overview", arguments: { matterId: input.currentMatterId } },
        { name: "get_matter_intelligence", arguments: { matterId: input.currentMatterId } },
        { name: "search_workspace_documents", arguments: { matterId: input.currentMatterId, query: input.content } }
      );
    }
    if (calls.length) return calls;
  }
  const selectedDocument = input.pageContext.selectedItem;
  if (selectedDocument?.id && ["source", "libraryDocument"].includes(selectedDocument.kind)) {
    return [{
      name: "search_workspace_documents",
      arguments: {
        ...(input.currentMatterId ? { matterId: input.currentMatterId } : {}),
        documentId: selectedDocument.id,
        query: input.content,
      },
    }];
  }
  if (input.currentMatterId) {
    return [{ name: "search_workspace_documents", arguments: { matterId: input.currentMatterId, query: input.content } }];
  }
  return [];
}

export function fallbackAssistantPlan(input: AssistantPlannerInput): AssistantPlan {
  if (input.responseMode === "draft") {
    const intent: AssistantIntent = "draft";
    const toolCalls = fallbackToolCalls(input, intent);
    return {
      intent, depth: input.forceThorough ? "thorough" : "standard",
      needsWorkspace: input.hasTemporaryFiles || Boolean(input.currentMatterId) || toolCalls.length > 0,
      needsCurrentPage: true, needsWeb: input.enableWebSearch && input.forceThorough,
      needsClarification: false, toolCalls,
    };
  }
  const text = input.content.trim().toLowerCase();
  const pageReference = /\b(this|current) page\b|\bwhat can i do here\b|\bthese controls\b/.test(text);
  const selectedDocument = input.hasTemporaryFiles || Boolean(input.pageContext.selectedItem &&
    ["source", "libraryDocument", "workProduct", "assistantDocument"].includes(input.pageContext.selectedItem.kind));
  const workspaceFact = /\b(my|our|this|the) (?:matter|client|draft|work product|sources?|account|profile|firm|professional role|practice areas?|history)\b|\bwhich matters?\b|\bworkspace\b|\bcollaboration\b|\bfirm library\b|\bassistant documents?\b|\bprevious conversation\b|\bwhat did we conclude\b|\bfacts we have\b|\bbased on the facts\b/.test(text);
  const legalAnalysis = /\b(?:law|legal|clause|contract|liability|claim|defen[cs]e|jurisdiction|statute|case law|issue|promissory estoppel|estoppel)\b/.test(text);
  const intent: AssistantIntent = selectedDocument
    ? "document_analysis"
    : pageReference
      ? "product_help"
      : workspaceFact
        ? (legalAnalysis ? "legal_analysis" : "workspace_lookup")
        : (legalAnalysis ? "legal_analysis" : "general_conversation");
  const toolCalls = fallbackToolCalls(input, intent);
  return {
    intent,
    depth: input.forceThorough ? "thorough" : text.length < 100 ? "brief" : "standard",
    needsWorkspace: toolCalls.length > 0 || selectedDocument,
    needsCurrentPage: pageReference || selectedDocument || Boolean(input.currentMatterId && workspaceFact),
    needsWeb: input.enableWebSearch && /\b(?:current|latest|today|recent|new law|verify)\b/.test(text),
    needsClarification: false,
    toolCalls,
  };
}

export async function planAssistantRequest(
  input: AssistantPlannerInput,
  model: PlannerModel = callModel
): Promise<AssistantPlan> {
  if (input.responseMode === "draft") return fallbackAssistantPlan(input);
  const prompt = `Plan the next Exepts lawyer-assistant response. Return only the requested JSON object. Do not include rationale or hidden reasoning.

Rules:
- Ordinary greetings, conversation, rewriting, explanations, and general legal questions do not require private workspace tools.
- Use the current page for page-referential questions.
- Use read-only tools for private account, Firm, Matter, document, Work Product, Collaboration, or History facts.
- Prefer the current Matter for "this Matter", "the client", "this draft", and similar references.
- Do not invent IDs. Only use the supplied current Matter or selected item ID. A named other Matter must first use find_matter.
- Ask one clarification only when the target is genuinely ambiguous.
- Web research may be requested only when webSearchEnabled is true.
- Available tools: ${ASSISTANT_TOOL_NAMES.join(", ")}.

Request data:
${JSON.stringify({
    content: input.content,
    webSearchEnabled: input.enableWebSearch,
    forceThorough: input.forceThorough,
    hasTemporaryFiles: input.hasTemporaryFiles,
    currentMatterId: input.currentMatterId,
    page: input.pageContext,
  }).slice(0, 10_000)}`;
  try {
    const result = await model("assistant-planner", [{ role: "user", content: prompt }], {
      systemInstruction: LAWYER_ASSISTANT_CHARTER,
      responseMimeType: "application/json",
      responseSchema: plannerResponseSchema,
      temperature: 0.1,
    });
    const parsed = validateAssistantPlan(JSON.parse(result.text), input.enableWebSearch);
    return parsed || fallbackAssistantPlan(input);
  } catch (error) {
    console.error("Assistant planning failed; using safe fallback:", error);
    return fallbackAssistantPlan(input);
  }
}

export function legacyRequestMode(plan: AssistantPlan): "ui_help" | "general" | "workspace_research" | "deep_research" | "draft" {
  if (plan.intent === "draft") return "draft";
  if (plan.intent === "product_help") return "ui_help";
  if (!plan.needsWorkspace) return "general";
  return plan.depth === "thorough" ? "deep_research" : "workspace_research";
}
