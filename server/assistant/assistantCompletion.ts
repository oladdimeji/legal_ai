import type {
  Account,
  AssistantDocumentReference,
  Case,
  Citation,
  Message,
  ResearchStep,
  Thread,
  WorkspacePageContext,
} from "../../src/types.js";
import {
  canonicalizeAssistantCitations,
  stripAssistantInlineCitations,
} from "../../src/lib/assistantCitations.js";
import type { OwnershipContext } from "../db.js";
import { cleanGeneratedBoilerplate } from "../generatedContentCleanup.js";
import { callModel, type DraftTextChunkHandler } from "../model.js";
import { LAWYER_ASSISTANT_CHARTER } from "./assistantCharter.js";
import {
  resolveLatestArtifactReference,
  type AssistantConversationState,
} from "./assistantConversationState.js";
import { createAssistantDeliverable } from "./assistantDeliverables.js";
import { wrapAuthorizedEvidence } from "./assistantEvidence.js";
import { adaptiveAssistantThinkingLevel, buildAssistantTaskPrompt } from "./assistantPrompts.js";
import {
  assistantCitationsForEvidence,
  assistantResearchSteps,
  assistantUsedWorkspace,
  evidenceWithAssistantCitationIds,
} from "./assistantResponse.js";
import type { AssistantSessionContext, AssistantPlan } from "./assistantTypes.js";
import type { AssistantToolRunResult } from "./assistantToolExecutor.js";
import type { AssistantWebResearchResult } from "./assistantWebResearch.js";

type SuggestionGenerator = (
  history: Message[],
  answer: string,
  documentContext?: { title: string; kind: string; action: "create" | "revise" }
) => Promise<string[]>;

export function assistantDocumentConfirmationContent(
  documentAction: "create" | "revise" | undefined,
  title: string
): string {
  return documentAction === "revise"
    ? `I have created a revised version of **${title}**.`
    : `I have created the **${title}**.`;
}

export type AssistantCompletionResult = {
  content: string;
  citations: Citation[];
  steps: ResearchStep[] | null;
  metadata: Record<string, unknown>;
  document?: AssistantDocumentReference;
  sourceDocument?: AssistantDocumentReference;
  clarificationQuestion?: string;
};

function normalizeWebResearch(webResearch: AssistantWebResearchResult): AssistantWebResearchResult {
  const citationIds = new Map<string, string>();
  const citations = webResearch.citations.map((citation, index) => {
    const id = `cit_web_${index + 1}`;
    citationIds.set(citation.id, id);
    return { ...citation, id };
  });
  const report = [...citationIds.entries()].reduce(
    (value, [from, to]) => value.replace(new RegExp(`\\[${from}\\]`, "g"), `[${to}]`),
    webResearch.report
  );
  return { ...webResearch, report, citations };
}

export async function completeAssistantResponse(input: {
  instruction: string;
  plan: AssistantPlan;
  session: AssistantSessionContext;
  thread: Thread;
  currentMatter: Case | null;
  pageContext: WorkspacePageContext;
  conversationState: AssistantConversationState;
  conversationContext: string;
  conversationHistory: Message[];
  toolRun: AssistantToolRunResult;
  webResearch: AssistantWebResearchResult;
  planningRounds: number;
  account: Account;
  ownership: OwnershipContext;
  generateSuggestions: SuggestionGenerator;
  onDraftChunk?: DraftTextChunkHandler;
}): Promise<AssistantCompletionResult> {
  const webResearch = normalizeWebResearch(input.webResearch);
  const toolRun: AssistantToolRunResult = {
    ...input.toolRun,
    evidence: [...input.toolRun.evidence],
    checkedLocations: [...input.toolRun.checkedLocations],
  };
  if (webResearch.performed && webResearch.report) {
    toolRun.evidence.push({
      id: "public_web_research",
      sourceType: "web",
      title: "Current public web research",
      sourceName: "Google Search Grounding",
      text: webResearch.report,
    });
    toolRun.checkedLocations.push("Current public web research");
  }

  let deliverable: Awaited<ReturnType<typeof createAssistantDeliverable>> | null = null;
  if (input.plan.deliverable.kind !== "message") {
    const sourceResolution = resolveLatestArtifactReference({
      content: input.instruction,
      conversationState: input.conversationState,
      pageContext: input.pageContext,
      currentMatterId: input.currentMatter?.id || null,
      plannerArtifactId: input.plan.deliverable.sourceArtifactId,
    });
    if (input.plan.deliverable.documentAction === "revise" && sourceResolution.needsClarification) {
      return {
        content: "",
        citations: [],
        steps: null,
        metadata: {},
        clarificationQuestion: "Which previously created document would you like me to revise?",
      };
    }
    deliverable = await createAssistantDeliverable({
      plan: input.plan,
      thread: input.thread,
      currentMatter: input.currentMatter,
      conversationState: input.conversationState,
      sourceArtifact: sourceResolution.artifact,
      evidence: toolRun.evidence,
      webResearch,
      ownership: input.ownership,
      account: input.account,
      instruction: input.instruction,
      pageContext: input.pageContext,
      conversationContext: input.conversationContext,
      onDraftChunk: input.onDraftChunk,
    });
  }

  const citations = assistantCitationsForEvidence(toolRun.evidence, webResearch.citations);
  let content: string;
  if (input.plan.deliverable.kind === "document" && deliverable) {
    content = assistantDocumentConfirmationContent(input.plan.deliverable.documentAction, deliverable.document.title);
  } else {
    const evidence = evidenceWithAssistantCitationIds(toolRun.evidence, citations);
    const generatedDocumentContext = deliverable
      ? `A saved ${deliverable.document.kind === "matterWorkProduct" ? "Matter Work Product" : "Assistant Document"} named "${deliverable.document.title}" was generated from the same evidence. Provide a concise explanation with the main conclusion, important assumptions or missing facts, and what the document contains. Do not contradict the saved document.\n\nBounded beginning of the generated document:\n${deliverable.content.slice(0, 4_000)}`
      : undefined;
    const prompt = buildAssistantTaskPrompt({
      request: input.instruction,
      plan: input.plan,
      session: input.session,
      conversationContext: input.conversationContext,
      evidenceBlock: wrapAuthorizedEvidence(evidence),
      checkedLocations: toolRun.checkedLocations,
      webResearchPerformed: webResearch.performed,
      generatedDocumentContext,
    });
    const modelResult = await callModel("chat", [{ role: "user", content: prompt }], {
      googleSearch: false,
      thinkingLevel: adaptiveAssistantThinkingLevel(input.plan),
      systemInstruction: LAWYER_ASSISTANT_CHARTER,
    });
    const canonicalContent = canonicalizeAssistantCitations(
      cleanGeneratedBoilerplate(modelResult.text),
      citations
    );
    content = stripAssistantInlineCitations(canonicalContent, citations);
  }

  const documentContext = deliverable ? {
    title: deliverable.document.title,
    kind: deliverable.document.kind,
    action: input.plan.deliverable.documentAction || "create",
  } as const : undefined;
  const suggestions = await input.generateSuggestions(
    input.conversationHistory,
    content,
    documentContext
  );
  const usedWorkspace = assistantUsedWorkspace(toolRun);
  const metadata: Record<string, unknown> = {
    suggestions,
    assistantIntent: input.plan.intent,
    deliverableKind: input.plan.deliverable.kind,
    usedWorkspace,
    usedWeb: webResearch.performed,
    ...(deliverable ? { document: deliverable.document } : {}),
    ...(deliverable?.sourceDocument ? { sourceDocument: deliverable.sourceDocument } : {}),
  };
  return {
    content,
    citations,
    steps: assistantResearchSteps({
      plan: input.plan,
      toolRun,
      planningRounds: input.planningRounds,
      webResearchPerformed: webResearch.performed,
    }),
    metadata,
    ...(deliverable ? { document: deliverable.document } : {}),
    ...(deliverable?.sourceDocument ? { sourceDocument: deliverable.sourceDocument } : {}),
  };
}
