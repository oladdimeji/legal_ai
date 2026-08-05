import type { Account, Message } from "../../src/types.js";
import { callModel } from "../model.js";
import type { OwnershipContext } from "../db.js";
import {
  attachmentNamesForMessage,
  researchSourceEvidenceForIds,
  type AssistantConversationArtifact,
} from "./assistantConversationState.js";
import { boundEvidence, sanitizeEvidenceText } from "./assistantEvidence.js";
import { validateAssistantToolCall } from "./assistantPlanner.js";
import {
  ASSISTANT_TOOL_LIMITS,
  executeAssistantToolPlan,
  type AssistantToolRunResult,
} from "./assistantToolExecutor.js";
import { ASSISTANT_TOOL_NAMES, type AssistantPlan, type AssistantSessionContext, type AssistantToolCall } from "./assistantTypes.js";
import { performAssistantWebResearch, type AssistantWebResearchResult } from "./assistantWebResearch.js";
import { LAWYER_ASSISTANT_CHARTER } from "./assistantCharter.js";

type Database = Parameters<typeof executeAssistantToolPlan>[0]["database"];
type Model = typeof callModel;

export type AssistantOrchestrationState = {
  planningRounds: number;
  attemptedCalls: number;
  currentMatterId: string | null;
  resolvedMatterIds: string[];
  checkedLocations: string[];
  evidence: AssistantToolRunResult["evidence"];
  errors: string[];
  clarificationQuestion?: string;
};

export type AssistantOrchestrationResult = {
  toolRun: AssistantToolRunResult;
  webResearch: AssistantWebResearchResult;
  planningRounds: number;
};

function callKey(call: AssistantToolCall): string {
  return `${call.name}:${JSON.stringify(Object.entries(call.arguments).sort(([left], [right]) => left.localeCompare(right)))}`;
}

export function deduplicateAssistantToolCalls(calls: readonly AssistantToolCall[]): AssistantToolCall[] {
  const seen = new Set<string>();
  return calls.filter((call) => {
    const key = callKey(call);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function exactReferenceToolCalls(input: {
  plan: AssistantPlan;
  artifacts: AssistantConversationArtifact[];
}): AssistantToolCall[] {
  const ids = new Set([
    ...input.plan.referencedArtifactIds,
    ...(input.plan.deliverable.sourceArtifactId ? [input.plan.deliverable.sourceArtifactId] : []),
  ]);
  const calls: AssistantToolCall[] = [];
  for (const artifact of input.artifacts) {
    if (!ids.has(artifact.id)) continue;
    if (artifact.kind === "matterWorkProduct" && artifact.matterId) {
      calls.push({ name: "get_work_product", arguments: { matterId: artifact.matterId, workProductId: artifact.id } });
    } else if (artifact.kind === "assistantDocument") {
      calls.push({ name: "get_assistant_document", arguments: { documentId: artifact.id } });
    }
  }
  return calls;
}

export function currentPageEvidenceToolCalls(input: {
  plan: AssistantPlan;
  session: AssistantSessionContext;
}): AssistantToolCall[] {
  if (!input.plan.needsCurrentPage) return [];
  const { selectedEntity, currentMatter, page } = input.session;
  if (selectedEntity) {
    if (selectedEntity.kind === "source" && currentMatter) {
      return [{ name: "get_matter_source", arguments: { matterId: currentMatter.id, documentId: selectedEntity.id } }];
    }
    if (selectedEntity.kind === "workProduct" && currentMatter) {
      return [{ name: "get_work_product", arguments: { matterId: currentMatter.id, workProductId: selectedEntity.id } }];
    }
    if (selectedEntity.kind === "libraryDocument") {
      return [{ name: "get_firm_library_document", arguments: { documentId: selectedEntity.id } }];
    }
    if (selectedEntity.kind === "assistantDocument") {
      return [{ name: "get_assistant_document", arguments: { documentId: selectedEntity.id } }];
    }
  }
  if (!currentMatter || page.routeKind !== "matter") return [];
  if (/intelligence/i.test(page.activeSection || "")) return [{ name: "get_matter_intelligence", arguments: { matterId: currentMatter.id } }];
  if (/collaboration/i.test(page.activeSection || "")) return [{ name: "get_matter_collaboration_summary", arguments: { matterId: currentMatter.id } }];
  if (/overview/i.test(page.activeSection || "")) return [{ name: "get_matter_overview", arguments: { matterId: currentMatter.id } }];
  return [];
}

export function isExplicitCrossThreadRequest(request: string): boolean {
  return /\b(?:another conversation|past conversations?|conversation history|my history|different thread|conversation (?:called|titled)|find the conversation|where we discussed)\b/i.test(request);
}

function initialCalls(input: {
  request: string;
  plan: AssistantPlan;
  session: AssistantSessionContext;
  artifacts: AssistantConversationArtifact[];
}): AssistantToolCall[] {
  const planned = input.plan.toolCalls.filter((call) =>
    call.name !== "search_conversation_history" || isExplicitCrossThreadRequest(input.request)
  );
  return deduplicateAssistantToolCalls([
    ...currentPageEvidenceToolCalls(input),
    ...exactReferenceToolCalls({ plan: input.plan, artifacts: input.artifacts }),
    ...planned,
  ]).slice(0, ASSISTANT_TOOL_LIMITS.calls);
}

function shouldPlanSecondRound(
  calls: AssistantToolCall[],
  run: AssistantToolRunResult,
  remaining: number
): boolean {
  if (remaining <= 0 || run.clarificationQuestion) return false;
  if (!calls.length) return false;
  return run.evidence.length === 0 || calls.some((call) =>
    call.name === "find_matter" ||
    call.name.startsWith("list_") ||
    call.name.startsWith("search_")
  );
}

async function followUpCalls(input: {
  request: string;
  plan: AssistantPlan;
  firstRun: AssistantToolRunResult;
  allowedMatterIds: string[];
  remaining: number;
  model: Model;
}): Promise<AssistantToolCall[]> {
  const prompt = `Plan one final read-only evidence retrieval round for the Exepts lawyer Assistant. Return JSON only as {"toolCalls":[{"name":"...","arguments":{}}]}. Return an empty array if the first round is sufficient.

Rules:
- Use at most ${input.remaining} calls.
- Do not repeat the first round.
- Fetch exact full records identified by list or search results when useful.
- Matter IDs may only be copied from this allowed list: ${JSON.stringify(input.allowedMatterIds)}.
- Do not search global History for current-thread references.
- Available tools: ${ASSISTANT_TOOL_NAMES.join(", ")}.

Request: ${sanitizeEvidenceText(input.request, 4_000)}
First-round evidence:
${sanitizeEvidenceText(JSON.stringify(input.firstRun.evidence.map((item) => ({
    sourceType: item.sourceType,
    title: item.title,
    entityId: item.entityId,
    matterId: item.matterId,
    text: item.text.slice(0, 1_200),
  }))), 12_000)}`;
  try {
    const result = await input.model("assistant-planner", [{ role: "user", content: prompt }], {
      systemInstruction: LAWYER_ASSISTANT_CHARTER,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
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
        required: ["toolCalls"],
      },
    });
    const parsed = JSON.parse(result.text)?.toolCalls;
    if (!Array.isArray(parsed)) return [];
    const allowedMatters = new Set(input.allowedMatterIds);
    return deduplicateAssistantToolCalls(parsed.filter(validateAssistantToolCall).filter((call: AssistantToolCall) => {
      if (call.name === "search_conversation_history" && !isExplicitCrossThreadRequest(input.request)) return false;
      const matterId = call.arguments.matterId;
      return typeof matterId !== "string" || allowedMatters.has(matterId);
    })).slice(0, input.remaining);
  } catch (error) {
    console.error("Assistant follow-up retrieval planning failed:", error);
    return [];
  }
}

function mergeRuns(first: AssistantToolRunResult, second?: AssistantToolRunResult): AssistantToolRunResult {
  const evidence = [...first.evidence, ...(second?.evidence || [])];
  const seenEvidence = new Set<string>();
  return {
    evidence: boundEvidence(evidence.filter((item) => {
      const key = `${item.sourceType}:${item.entityId || item.title}:${item.text}`;
      if (seenEvidence.has(key)) return false;
      seenEvidence.add(key);
      return true;
    }), ASSISTANT_TOOL_LIMITS.evidenceChars),
    checkedLocations: [...new Set([...first.checkedLocations, ...(second?.checkedLocations || [])])],
    attemptedCalls: first.attemptedCalls + (second?.attemptedCalls || 0),
    limitReached: first.limitReached || Boolean(second?.limitReached) || first.attemptedCalls + (second?.attemptedCalls || 0) >= ASSISTANT_TOOL_LIMITS.calls,
    errors: [...first.errors, ...(second?.errors || [])],
    resolvedMatterIds: [...new Set([...first.resolvedMatterIds, ...(second?.resolvedMatterIds || [])])],
    clarificationQuestion: first.clarificationQuestion || second?.clarificationQuestion,
  };
}

export async function orchestrateAssistantRetrieval(input: {
  request: string;
  plan: AssistantPlan;
  session: AssistantSessionContext;
  account: Account;
  ownership: OwnershipContext;
  currentMatterId: string | null;
  conversationMessages: Message[];
  artifacts: AssistantConversationArtifact[];
  database?: Database;
  model?: Model;
}): Promise<AssistantOrchestrationResult> {
  const model = input.model || callModel;
  const calls = initialCalls(input);
  const firstPlan = { ...input.plan, toolCalls: calls };
  const firstRun = await executeAssistantToolPlan({
    plan: firstPlan,
    account: input.account,
    ownership: input.ownership,
    currentMatterId: input.currentMatterId,
    request: input.request,
    database: input.database,
  });

  const sourceEvidence = researchSourceEvidenceForIds(
    input.conversationMessages,
    input.plan.referencedResearchSourceIds
  ).map((source) => ({
    id: source.id,
    sourceType: "temporaryAttachment" as const,
    title: source.name,
    sourceName: "Conversation Research Source",
    text: source.text,
    entityId: source.messageId,
  }));
  firstRun.evidence.push(...sourceEvidence);
  if (sourceEvidence.length) firstRun.checkedLocations.push("Conversation research sources");

  const allowedMatterIds = [...new Set([
    ...(input.currentMatterId ? [input.currentMatterId] : []),
    ...firstRun.resolvedMatterIds,
    ...input.artifacts.map((artifact) => artifact.matterId).filter((id): id is string => Boolean(id)),
  ])];
  const remaining = ASSISTANT_TOOL_LIMITS.calls - firstRun.attemptedCalls;
  let secondRun: AssistantToolRunResult | undefined;
  let planningRounds = 1;
  if (shouldPlanSecondRound(calls, firstRun, remaining)) {
    const nextCalls = await followUpCalls({
      request: input.request,
      plan: input.plan,
      firstRun,
      allowedMatterIds,
      remaining,
      model,
    });
    const used = new Set(calls.map(callKey));
    const uniqueNext = nextCalls.filter((call) => !used.has(callKey(call)));
    if (uniqueNext.length) {
      planningRounds = 2;
      secondRun = await executeAssistantToolPlan({
        plan: { ...input.plan, toolCalls: uniqueNext },
        account: input.account,
        ownership: input.ownership,
        currentMatterId: input.currentMatterId,
        authorizedMatterIds: allowedMatterIds,
        request: input.request,
        database: input.database,
      });
    }
  }
  const toolRun = mergeRuns(firstRun, secondRun);
  const webResearch = await performAssistantWebResearch({
    request: input.request,
    plan: input.plan,
    session: input.session,
    resolvedMatterIds: toolRun.resolvedMatterIds,
    artifactTitles: input.artifacts.map((artifact) => artifact.title),
    artifactIds: input.artifacts.map((artifact) => artifact.id),
    attachmentNames: input.conversationMessages.flatMap(attachmentNamesForMessage),
    privateDocumentTitles: toolRun.evidence.filter((item) => item.sourceType !== "web").map((item) => item.title),
    model,
  });
  return { toolRun, webResearch, planningRounds };
}
