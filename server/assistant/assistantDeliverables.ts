import type {
  Account,
  AssistantDocumentReference,
  Case,
  Thread,
  WorkspacePageContext,
} from "../../src/types.js";
import { buildAssistantDraftPrompt, titleForAssistantDraft } from "../assistantDrafting.js";
import { cleanGeneratedWorkProductContent } from "../generatedContentCleanup.js";
import { callModel, type GenerationModelCall } from "../model.js";
import { db } from "../db.js";
import type { OwnershipContext } from "../db.js";
import { LAWYER_ASSISTANT_CHARTER } from "./assistantCharter.js";
import type {
  AssistantConversationArtifact,
  AssistantConversationState,
} from "./assistantConversationState.js";
import { sanitizeEvidenceText } from "./assistantEvidence.js";
import type { AssistantEvidence, AssistantPlan } from "./assistantTypes.js";
import type { AssistantWebResearchResult } from "./assistantWebResearch.js";

type Database = typeof db;
type Model = GenerationModelCall;

export type AssistantDeliverableResult = {
  document: AssistantDocumentReference;
  sourceDocument?: AssistantDocumentReference;
  content: string;
};

function documentReference(artifact: AssistantConversationArtifact): AssistantDocumentReference {
  return {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    ...(artifact.matterId ? { matterId: artifact.matterId } : {}),
  };
}

function evidenceText(evidence: AssistantEvidence[]): string {
  let remaining = 26_000;
  const sections: string[] = [];
  for (const item of evidence) {
    if (remaining <= 0) break;
    const text = sanitizeEvidenceText(item.text, Math.min(12_000, remaining));
    if (!text) continue;
    sections.push(`${sanitizeEvidenceText(item.sourceName, 160)}: ${sanitizeEvidenceText(item.title, 300)}\n${text}`);
    remaining -= text.length;
  }
  return sections.join("\n\n");
}

function accountMetadata(account: Account, currentMatter: Case | null): string {
  return [
    currentMatter ? `Matter name: ${currentMatter.name}` : "",
    currentMatter?.description ? `Assignment description: ${currentMatter.description}` : "",
    currentMatter?.client_name ? `Client name: ${currentMatter.client_name}` : "",
    currentMatter?.client_email ? `Client email: ${currentMatter.client_email}` : "",
    currentMatter?.matter_type ? `Practice area: ${currentMatter.matter_type}` : "",
    currentMatter?.jurisdiction ? `Jurisdiction: ${currentMatter.jurisdiction}` : "",
    currentMatter?.preliminary_objectives ? `Preliminary objectives: ${currentMatter.preliminary_objectives}` : "",
    `Author name: ${account.user.name || account.user.email}`,
    `Firm name: ${account.firm?.name || ""}`,
  ].filter(Boolean).join("\n");
}

function revisedTitle(generated: string, sourceTitle: string): string {
  const normalizedGenerated = generated.trim().toLocaleLowerCase();
  const normalizedSource = sourceTitle.trim().toLocaleLowerCase();
  if (!generated.trim() || normalizedGenerated === normalizedSource) return `${sourceTitle} — Revised`;
  return generated;
}

export async function createAssistantDeliverable(input: {
  plan: AssistantPlan;
  thread: Thread;
  currentMatter: Case | null;
  conversationState: AssistantConversationState;
  sourceArtifact?: AssistantConversationArtifact | null;
  evidence: AssistantEvidence[];
  webResearch: AssistantWebResearchResult;
  ownership: OwnershipContext;
  account: Account;
  instruction: string;
  pageContext: WorkspacePageContext;
  conversationContext: string;
  database?: Database;
  model?: Model;
}): Promise<AssistantDeliverableResult> {
  if (input.plan.deliverable.kind === "message" || !input.plan.deliverable.documentAction) {
    throw new Error("The Assistant plan does not request a document deliverable");
  }
  const database = input.database || db;
  const model = input.model || callModel;
  const sourceArtifact = input.plan.deliverable.documentAction === "revise"
    ? input.sourceArtifact
      || input.conversationState.recentArtifacts.find((artifact) => artifact.id === input.plan.deliverable.sourceArtifactId)
      || null
    : null;
  if (input.plan.deliverable.documentAction === "revise" && !sourceArtifact) {
    throw new Error("The requested revision source is not in the authorized artifact ledger");
  }

  const draftingEvidence = [...input.evidence];
  let sourceDocument: AssistantDocumentReference | undefined;
  if (sourceArtifact?.kind === "matterWorkProduct") {
    if (!sourceArtifact.matterId) throw new Error("The source Work Product has no authorized Matter");
    const matter = await database.getCaseById(sourceArtifact.matterId, input.ownership);
    if (!matter) throw new Error("The source Work Product Matter was not found");
    const source = await database.getDraftById(sourceArtifact.id, sourceArtifact.matterId, input.ownership);
    if (!source) throw new Error("The source Work Product was not found");
    draftingEvidence.unshift({
      id: "revision_source",
      sourceType: "workProduct",
      title: source.title,
      sourceName: "Source Matter Work Product",
      text: source.content,
      entityId: source.id,
      matterId: sourceArtifact.matterId,
    });
    sourceDocument = documentReference(sourceArtifact);
  } else if (sourceArtifact?.kind === "assistantDocument") {
    const source = await database.getAssistantDocumentById(sourceArtifact.id, input.ownership);
    if (!source) throw new Error("The source Assistant Document was not found");
    draftingEvidence.unshift({
      id: "revision_source",
      sourceType: "assistantDocument",
      title: source.title,
      sourceName: "Source Assistant Document",
      text: source.content,
      entityId: source.id,
    });
    sourceDocument = documentReference(sourceArtifact);
  }

  const prompt = buildAssistantDraftPrompt({
    instruction: input.instruction,
    pageContext: input.pageContext,
    conversationContext: input.conversationContext,
    authorizedEvidence: evidenceText(draftingEvidence),
    accountMetadata: accountMetadata(input.account, input.currentMatter),
    currentDate: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }),
    publicWebResearch: input.webResearch.report,
    webResearchPerformed: input.webResearch.performed,
    depth: input.plan.depth,
  });
  const generateDocumentContent = async () => {
    const result = await model("draft-generation", [{ role: "user", content: prompt }], {
      googleSearch: false,
      thinkingLevel: "minimal",
      systemInstruction: LAWYER_ASSISTANT_CHARTER,
    });
    return cleanGeneratedWorkProductContent(result.text);
  };
  // A thinking model can occasionally return a successful response that carries no
  // text. That is not a provider error, so the transient retry runner never covers
  // it, and the request would fail even though repeating it normally succeeds.
  const content = (await generateDocumentContent()) || (await generateDocumentContent());
  if (!content) throw new Error("The model did not return document content");
  const generatedTitle = titleForAssistantDraft(content, input.instruction, input.thread.title);

  if (sourceArtifact?.kind === "matterWorkProduct") {
    const title = revisedTitle(generatedTitle, sourceArtifact.title);
    const saved = await database.createAssistantDraftRevision({
      threadId: input.thread.id,
      sourceDraftId: sourceArtifact.id,
      caseId: sourceArtifact.matterId!,
      title,
      content,
      ownership: input.ownership,
    });
    return {
      document: { id: saved.id, kind: "matterWorkProduct", title: saved.title, matterId: sourceArtifact.matterId },
      sourceDocument,
      content,
    };
  }
  if (sourceArtifact?.kind === "assistantDocument") {
    const title = revisedTitle(generatedTitle, sourceArtifact.title);
    const saved = await database.createAssistantDocument(input.thread.id, title, content, input.ownership);
    return {
      document: { id: saved.id, kind: "assistantDocument", title: saved.title },
      sourceDocument,
      content,
    };
  }

  const matterDestination = input.currentMatter && input.pageContext.routeKind === "matter"
    ? input.currentMatter
    : null;
  if (matterDestination) {
    const saved = await database.createDraft(
      input.thread.id,
      matterDestination.id,
      generatedTitle,
      content,
      input.ownership
    );
    return {
      document: { id: saved.id, kind: "matterWorkProduct", title: saved.title, matterId: matterDestination.id },
      content,
    };
  }
  const saved = await database.createAssistantDocument(
    input.thread.id,
    generatedTitle,
    content,
    input.ownership
  );
  return {
    document: { id: saved.id, kind: "assistantDocument", title: saved.title },
    content,
  };
}
