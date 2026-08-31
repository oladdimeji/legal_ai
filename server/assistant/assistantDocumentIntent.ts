import { resolveLatestArtifactReference } from "./assistantConversationState.js";
import type { AssistantPlan, AssistantPlannerInput } from "./assistantTypes.js";

export type AssistantDocumentIntentKind =
  | "explicit_message_only"
  | "explicit_create"
  | "explicit_revision"
  | "accepted_document_offer"
  | "informational_message"
  | "none";

export type AssistantDocumentIntentHint = {
  kind: AssistantDocumentIntentKind;
  wantsExplanation: boolean;
};

const CREATION_VERBS = ["draft", "prepare", "write", "compose", "create", "generate", "produce", "make"] as const;
const CONVERSION_PHRASES = [
  "turn into", "turn to", "convert into", "convert to", "return as", "provide as",
  "put into", "format as", "save as", "give me",
] as const;
const FORMAL_DELIVERABLES = [
  "word document", "review document", "document", "accompanying email message", "accompanying email",
  "email message", "email", "client advice letter", "client letter", "advice letter", "transmittal letter",
  "letter", "legal memorandum", "memorandum", "memo", "review report", "report", "agreement", "contract",
  "policy", "legal brief", "brief", "notice", "checklist", "advice note", "transmittal", "revised version",
] as const;
const REVISION_VERBS = ["revise", "rewrite", "update", "amend", "make", "shorten", "expand", "add", "remove", "change"] as const;
const EXPLICIT_MESSAGE_ONLY_PHRASES = [
  "do not create a document", "don't create a document", "do not save", "don't save", "chat only",
  "in the chat only", "show it here only", "write it here only", "without creating a document",
  "without creating a file", "without saving", "example only",
] as const;
const AFFIRMATIVE_REPLIES = [
  "yes", "yes please", "please do", "go ahead", "that would be great", "do it", "sure", "okay", "ok",
] as const;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alternatives = (values: readonly string[]) => values.map(escapeRegex).join("|");
const phraseAlternatives = (values: readonly string[]) => values
  .map((value) => value.split(" ").map(escapeRegex).join("\\b[\\s\\S]{0,100}\\b"))
  .join("|");
const CREATION_VERB_PATTERN = alternatives(CREATION_VERBS);
const CONVERSION_PATTERN = phraseAlternatives(CONVERSION_PHRASES);
const DELIVERABLE_PATTERN = alternatives(FORMAL_DELIVERABLES);
const REVISION_VERB_PATTERN = alternatives(REVISION_VERBS);
const SAVED_ARTIFACT_PATTERN = alternatives([
  "document", "draft", "memo", "memorandum", "letter", "agreement", "contract", "report", "policy",
  "brief", "checklist", "advice note", "email",
]);

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
}

function containsAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

function isExplicitMessageOnly(text: string): boolean {
  return containsAny(text, EXPLICIT_MESSAGE_ONLY_PHRASES)
    || /\b(?:show|write|draft|compose) (?:it|this|that|the (?:email|memo|letter|wording)) here only\b/.test(text)
    || /\bjust show me (?:the )?(?:wording|text|draft) here\b/.test(text);
}

function isInstructionalOrInformational(text: string): boolean {
  return /^(?:what (?:does|are|should|assumptions)|how (?:should|do|can|would)|explain\b|summari[sz]e\b|compare\b|suggest\b)/.test(text)
    || /^(?:review|assess)\b[\s\S]{0,120}\b(?:tell me|what (?:is|are|could)|identify)\b/.test(text)
    || /^(?:give me (?:a )?(?:two|2)[- ]line response|write (?:a |one )sentence\b)/.test(text);
}

function hasFormalDeliverable(text: string): boolean {
  return new RegExp(`\\b(?:${DELIVERABLE_PATTERN})\\b`).test(text);
}

function hasDirectCreationRequest(text: string): boolean {
  if (!hasFormalDeliverable(text)) return false;
  const action = new RegExp(`\\b(?:${CREATION_VERB_PATTERN})\\b[\\s\\S]{0,120}\\b(?:${DELIVERABLE_PATTERN})\\b`);
  const conversion = new RegExp(`\\b(?:${CONVERSION_PATTERN})\\b[\\s\\S]{0,100}\\b(?:${DELIVERABLE_PATTERN})\\b`);
  return action.test(text) || conversion.test(text);
}

function isInstructionalDocumentQuestion(text: string): boolean {
  return /^(?:how (?:should|do|can|would) i|what is the (?:best )?way to)\b/.test(text)
    || /^what should (?:the |an )?(?:email|email message|letter|memo|memorandum|report) say\b/.test(text);
}

function hasSavedArtifactReference(text: string): boolean {
  const noun = `(?:${SAVED_ARTIFACT_PATTERN})`;
  return new RegExp(`\\b(?:the |that |this |previous |prior )${noun}\\b`).test(text)
    || new RegExp(`\\b${noun} (?:you (?:just )?(?:created|drafted|made)|just created)\\b`).test(text)
    || /\b(?:it|that)\b/.test(text);
}

function isExplicitRevision(text: string): boolean {
  const ordinaryRevision = new RegExp(`\\b(?:${REVISION_VERB_PATTERN})\\b[\\s\\S]{0,120}\\b(?:it|that|(?:the previous |the prior |the |that |this |previous |prior )?(?:${SAVED_ARTIFACT_PATTERN}))\\b`);
  if (ordinaryRevision.test(text) && hasSavedArtifactReference(text)) return true;

  const conversion = new RegExp(`\\b(?:turn|convert)\\b[\\s\\S]{0,100}\\b(?:into|to)\\b`);
  if (!conversion.test(text)) return false;
  const beforeTarget = text.slice(0, text.search(/\b(?:into|to)\b/));
  return new RegExp(`\\b(?:the |that |this |previous |prior )?(?:${SAVED_ARTIFACT_PATTERN})\\b`).test(beforeTarget);
}

function wantsSeparateExplanation(text: string): boolean {
  return /\b(?:analy[sz]e|explain|tell me|assess|identify|set out|describe)\b[\s\S]{0,180}\b(?:and|then|also)\b/.test(text)
    || /\b(?:and|then|also)\b[\s\S]{0,180}\b(?:analy[sz]e|explain|tell me|assess|identify|set out|describe)\b/.test(text);
}

function isBoundedAffirmative(text: string): boolean {
  if (!text || text.length > 100) return false;
  const reply = text.replace(/[.!]+$/g, "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  return AFFIRMATIVE_REPLIES.includes(reply as (typeof AFFIRMATIVE_REPLIES)[number]);
}

function latestAssistantOfferedDocument(input: AssistantPlannerInput): boolean {
  const latestAssistantTurn = [...input.conversationState.recentTurns].reverse().find((turn) => turn.role === "assistant");
  if (!latestAssistantTurn) return false;
  const offer = normalized(latestAssistantTurn.content);
  if (!/\b(?:would you like me to|should i|i can|would it help if i)\b/.test(offer)) return false;
  const offeredCreation = new RegExp(`\\b(?:draft(?:ed)?|prepar(?:e|ed)|writ(?:e|ten)|compos(?:e|ed)|creat(?:e|ed)|generat(?:e|ed)|produc(?:e|ed)|make|made)\\b[\\s\\S]{0,120}\\b(?:${DELIVERABLE_PATTERN})\\b`);
  return offeredCreation.test(offer);
}

export function detectAssistantDocumentIntent(input: AssistantPlannerInput): AssistantDocumentIntentHint {
  const text = normalized(input.content);
  const wantsExplanation = wantsSeparateExplanation(text);
  if (isExplicitMessageOnly(text)) return { kind: "explicit_message_only", wantsExplanation: false };
  if (isExplicitRevision(text)) return { kind: "explicit_revision", wantsExplanation };
  if (hasDirectCreationRequest(text) && !isInstructionalDocumentQuestion(text)) {
    return { kind: "explicit_create", wantsExplanation };
  }
  if (isBoundedAffirmative(text) && latestAssistantOfferedDocument(input)) {
    return { kind: "accepted_document_offer", wantsExplanation: false };
  }
  if (isInstructionalOrInformational(text)) return { kind: "informational_message", wantsExplanation: false };
  return { kind: "none", wantsExplanation: false };
}

function forceMessage(plan: AssistantPlan): AssistantPlan {
  return { ...plan, deliverable: { kind: "message" } };
}

export function assistantPlanRequestsDocumentCreate(plan: AssistantPlan): boolean {
  return plan.intent === "document_creation"
    && plan.deliverable.documentAction === "create"
    && plan.deliverable.kind !== "message";
}

function withoutDocumentCreateClarification(plan: AssistantPlan): AssistantPlan {
  if (!assistantPlanRequestsDocumentCreate(plan)) return plan;
  const { clarificationQuestion: _removed, ...rest } = plan;
  return {
    ...rest,
    needsClarification: false,
  };
}

export function reconcileAssistantDocumentIntent(
  plan: AssistantPlan,
  hint: AssistantDocumentIntentHint,
  input: AssistantPlannerInput
): AssistantPlan {
  if (hint.kind === "explicit_message_only" || hint.kind === "informational_message") return forceMessage(plan);
  if (hint.kind === "none") return withoutDocumentCreateClarification(plan);

  if (hint.kind === "explicit_create") {
    if (plan.deliverable.documentAction === "create" && plan.deliverable.kind !== "message") {
      return withoutDocumentCreateClarification(plan);
    }
    return {
      ...plan,
      intent: "document_creation",
      needsClarification: false,
      clarificationQuestion: undefined,
      deliverable: { kind: hint.wantsExplanation ? "message_and_document" : "document", documentAction: "create" },
    };
  }

  if (hint.kind === "accepted_document_offer") {
    if (plan.deliverable.documentAction === "create" && plan.deliverable.kind === "document") {
      return withoutDocumentCreateClarification(plan);
    }
    return {
      ...plan,
      intent: "document_creation",
      needsClarification: false,
      clarificationQuestion: undefined,
      deliverable: { kind: "document", documentAction: "create" },
    };
  }

  const resolution = resolveLatestArtifactReference({
    content: input.content,
    conversationState: input.conversationState,
    pageContext: input.pageContext,
    currentMatterId: input.currentMatterId,
  });
  if (!resolution.artifact) {
    return {
      ...plan,
      intent: "document_revision",
      needsClarification: true,
      clarificationQuestion: "Which previously created document would you like me to revise?",
      deliverable: { kind: "message" },
    };
  }
  const references = [...new Set([...plan.referencedArtifactIds, resolution.artifact.id])];
  return {
    ...plan,
    intent: "document_revision",
    needsWorkspace: true,
    needsClarification: false,
    clarificationQuestion: undefined,
    deliverable: {
      kind: hint.wantsExplanation ? "message_and_document" : "document",
      documentAction: "revise",
      sourceArtifactId: resolution.artifact.id,
    },
    referencedArtifactIds: references.slice(Math.max(0, references.length - 4)),
  };
}
