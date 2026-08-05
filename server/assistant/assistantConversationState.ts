import type {
  AssistantDocumentReference,
  Message,
  WorkspacePageContext,
} from "../../src/types.js";
import { sanitizeWorkspacePageContext } from "../../src/lib/workspacePageContext.js";
import { sanitizeEvidenceText } from "./assistantEvidence.js";

export const ASSISTANT_CONVERSATION_STATE_LIMITS = {
  recentTurnLimit: 20,
  artifactLimit: 12,
  researchSourceLimit: 10,
  plannerConversationCharacters: 16_000,
  researchSourcesPerMessage: 5,
  researchSourceCharacters: 30_000,
  storedResearchCharactersPerMessage: 75_000,
} as const;

export type AssistantConversationArtifact = {
  id: string;
  kind: "matterWorkProduct" | "assistantDocument";
  title: string;
  matterId?: string;
  createdByMessageId: string;
  createdAt: string;
};

export type AssistantResearchSourceReference = {
  id: string;
  messageId: string;
  name: string;
  available: boolean;
};

export type StoredConversationResearchSource = {
  name: string;
  text: string;
};

export type AssistantConversationTurn = {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  pageLabel?: string;
  attachmentNames: string[];
  document?: AssistantConversationArtifact;
};

export type AssistantConversationState = {
  rollingMemory: string;
  recentTurns: AssistantConversationTurn[];
  recentArtifacts: AssistantConversationArtifact[];
  recentResearchSources: AssistantResearchSourceReference[];
  latestCreatedArtifact: AssistantConversationArtifact | null;
};

export type AssistantArtifactResolution = {
  artifact: AssistantConversationArtifact | null;
  needsClarification: boolean;
};

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeString(value: unknown, max: number): string {
  return sanitizeEvidenceText(value, max);
}

export function attachmentNamesForMessage(message: Message): string[] {
  const attachments = message.metadata?.attachments;
  if (!Array.isArray(attachments)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const attachment of attachments) {
    const value = typeof attachment === "string"
      ? attachment
      : plainRecord(attachment)?.name;
    const name = safeString(value, 180);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names.slice(0, ASSISTANT_CONVERSATION_STATE_LIMITS.researchSourcesPerMessage);
}

export function storedResearchSourcesForMessage(
  message: Message
): StoredConversationResearchSource[] {
  const sources = message.metadata?.researchSources;
  if (!Array.isArray(sources)) return [];
  const stored: StoredConversationResearchSource[] = [];
  let remaining = ASSISTANT_CONVERSATION_STATE_LIMITS.storedResearchCharactersPerMessage;
  for (const source of sources) {
    if (stored.length >= ASSISTANT_CONVERSATION_STATE_LIMITS.researchSourcesPerMessage || remaining <= 0) break;
    const record = plainRecord(source);
    const name = safeString(record?.name, 180);
    const text = safeString(
      record?.text,
      Math.min(ASSISTANT_CONVERSATION_STATE_LIMITS.researchSourceCharacters, remaining)
    );
    if (!name || !text) continue;
    stored.push({ name, text });
    remaining -= text.length;
  }
  return stored;
}

export function researchSourceId(messageId: string, index: number): string {
  return `research_${messageId}_${index + 1}`;
}

export function conversationResearchSourceMetadata(
  files: ReadonlyArray<{ filename: string; text: string }>
): { attachments?: Array<{ name: string }>; researchSources?: StoredConversationResearchSource[] } {
  const seen = new Set<string>();
  const researchSources: StoredConversationResearchSource[] = [];
  let remaining = ASSISTANT_CONVERSATION_STATE_LIMITS.storedResearchCharactersPerMessage;
  for (const file of files) {
    if (researchSources.length >= ASSISTANT_CONVERSATION_STATE_LIMITS.researchSourcesPerMessage || remaining <= 0) break;
    const name = safeString(file.filename, 180);
    if (!name || seen.has(name)) continue;
    const text = safeString(
      file.text,
      Math.min(ASSISTANT_CONVERSATION_STATE_LIMITS.researchSourceCharacters, remaining)
    );
    if (!text) continue;
    seen.add(name);
    researchSources.push({ name, text });
    remaining -= text.length;
  }
  if (!researchSources.length) return {};
  return {
    attachments: researchSources.map(({ name }) => ({ name })),
    researchSources,
  };
}

function artifactForMessage(message: Message): AssistantConversationArtifact | null {
  const document = plainRecord(message.metadata?.document);
  if (!document) return null;
  const id = safeString(document.id, 240);
  const title = safeString(document.title, 300);
  const kind = document.kind;
  if (!id || !title || (kind !== "matterWorkProduct" && kind !== "assistantDocument")) return null;
  const matterId = kind === "matterWorkProduct" ? safeString(document.matterId, 240) : "";
  if (kind === "matterWorkProduct" && !matterId) return null;
  return {
    id,
    kind,
    title,
    ...(matterId ? { matterId } : {}),
    createdByMessageId: message.id,
    createdAt: message.created_at,
  };
}

function pageLabelForMessage(message: Message): string | undefined {
  const context = sanitizeWorkspacePageContext(message.metadata?.pageContext);
  if (!context) return undefined;
  const label = [context.pageTitle, context.activeSection, context.selectedItem?.title]
    .map((value) => safeString(value, 300))
    .filter(Boolean)
    .join(" · ");
  return label || undefined;
}

function boundedRecentTurns(messages: Message[]): AssistantConversationTurn[] {
  const turns: AssistantConversationTurn[] = [];
  let used = 0;
  for (const message of [...messages].reverse()) {
    if (turns.length >= ASSISTANT_CONVERSATION_STATE_LIMITS.recentTurnLimit) break;
    const remaining = ASSISTANT_CONVERSATION_STATE_LIMITS.plannerConversationCharacters - used;
    if (remaining <= 0 && turns.length >= 4) break;
    const content = safeString(message.content, Math.min(3_000, Math.max(0, remaining)));
    const turn: AssistantConversationTurn = {
      messageId: message.id,
      role: message.role,
      content,
      createdAt: message.created_at,
      attachmentNames: attachmentNamesForMessage(message),
      ...(pageLabelForMessage(message) ? { pageLabel: pageLabelForMessage(message) } : {}),
      ...(artifactForMessage(message) ? { document: artifactForMessage(message)! } : {}),
    };
    turns.unshift(turn);
    used += content.length;
  }
  return turns;
}

export function buildAssistantConversationState(input: {
  messages: Message[];
  rollingMemory?: string | null;
}): AssistantConversationState {
  const recentTurns = boundedRecentTurns(input.messages);
  const artifacts: AssistantConversationArtifact[] = [];
  const seenArtifacts = new Set<string>();
  for (const message of [...input.messages].reverse()) {
    const artifact = artifactForMessage(message);
    if (!artifact || seenArtifacts.has(artifact.id)) continue;
    seenArtifacts.add(artifact.id);
    artifacts.push(artifact);
    if (artifacts.length >= ASSISTANT_CONVERSATION_STATE_LIMITS.artifactLimit) break;
  }

  const researchSources: AssistantResearchSourceReference[] = [];
  for (const message of [...input.messages].reverse()) {
    const names = attachmentNamesForMessage(message);
    const stored = storedResearchSourcesForMessage(message);
    const storedNames = new Set(stored.map((source) => source.name));
    const sourceNames = names.length ? names : stored.map((source) => source.name);
    sourceNames.forEach((name, index) => {
      if (researchSources.length >= ASSISTANT_CONVERSATION_STATE_LIMITS.researchSourceLimit) return;
      researchSources.push({
        id: researchSourceId(message.id, index),
        messageId: message.id,
        name,
        available: storedNames.has(name),
      });
    });
    if (researchSources.length >= ASSISTANT_CONVERSATION_STATE_LIMITS.researchSourceLimit) break;
  }

  return {
    rollingMemory: safeString(input.rollingMemory, 6_000),
    recentTurns,
    recentArtifacts: artifacts,
    recentResearchSources: researchSources,
    latestCreatedArtifact: artifacts[0] || null,
  };
}

function selectedPageArtifact(
  pageContext: WorkspacePageContext,
  currentMatterId: string | null
): AssistantConversationArtifact | null {
  const selected = pageContext.selectedItem;
  if (!selected?.id || !selected.title) return null;
  if (selected.kind === "workProduct" && currentMatterId) {
    return {
      id: selected.id,
      kind: "matterWorkProduct",
      title: safeString(selected.title, 300),
      matterId: currentMatterId,
      createdByMessageId: "current-page",
      createdAt: new Date(0).toISOString(),
    };
  }
  if (selected.kind === "assistantDocument") {
    return {
      id: selected.id,
      kind: "assistantDocument",
      title: safeString(selected.title, 300),
      createdByMessageId: "current-page",
      createdAt: new Date(0).toISOString(),
    };
  }
  return null;
}

export function resolveLatestArtifactReference(input: {
  content: string;
  conversationState: AssistantConversationState;
  pageContext: WorkspacePageContext;
  currentMatterId: string | null;
  plannerArtifactId?: string;
}): AssistantArtifactResolution {
  const current = selectedPageArtifact(input.pageContext, input.currentMatterId);
  if (current) return { artifact: current, needsClarification: false };

  const lowered = input.content.toLocaleLowerCase();
  const explicitlyNamed = input.conversationState.recentArtifacts.filter((artifact) =>
    lowered.includes(artifact.title.toLocaleLowerCase())
  );
  if (explicitlyNamed.length === 1) return { artifact: explicitlyNamed[0], needsClarification: false };
  if (explicitlyNamed.length > 1) return { artifact: null, needsClarification: true };

  if (input.plannerArtifactId) {
    const selected = input.conversationState.recentArtifacts.find(
      (artifact) => artifact.id === input.plannerArtifactId
    );
    if (selected) return { artifact: selected, needsClarification: false };
  }

  const directLatestReference = /\b(?:the document you (?:just )?created|the draft you (?:just )?made|that (?:document|draft|memo|memorandum|letter|agreement|report))\b/i.test(input.content);
  const directRevision = /\b(?:revise|rewrite|make|shorten|expand|add|remove|change|turn)\b[\s\S]{0,100}\b(?:it|that|the (?:document|draft|memo|memorandum|letter|agreement|report))\b/i.test(input.content);
  if (directLatestReference && input.conversationState.latestCreatedArtifact) {
    return { artifact: input.conversationState.latestCreatedArtifact, needsClarification: false };
  }
  if (directRevision) {
    return input.conversationState.recentArtifacts.length === 1
      ? { artifact: input.conversationState.recentArtifacts[0], needsClarification: false }
      : { artifact: null, needsClarification: input.conversationState.recentArtifacts.length > 1 };
  }
  return { artifact: null, needsClarification: false };
}

export function resolveConversationResearchSourceReference(input: {
  content: string;
  conversationState: AssistantConversationState;
}): { source: AssistantResearchSourceReference | null; needsClarification: boolean } {
  const lowered = input.content.toLocaleLowerCase();
  const named = input.conversationState.recentResearchSources.filter((source) =>
    lowered.includes(source.name.toLocaleLowerCase())
  );
  if (named.length === 1) return { source: named[0], needsClarification: false };
  if (named.length > 1) return { source: null, needsClarification: true };
  if (/\b(?:the|that|this) (?:attached )?(?:file|attachment|research source)\b/i.test(input.content)) {
    return input.conversationState.recentResearchSources.length === 1
      ? { source: input.conversationState.recentResearchSources[0], needsClarification: false }
      : { source: null, needsClarification: input.conversationState.recentResearchSources.length > 1 };
  }
  return { source: null, needsClarification: false };
}

export function researchSourceEvidenceForIds(
  messages: Message[],
  sourceIds: readonly string[]
): Array<{ id: string; messageId: string; name: string; text: string }> {
  const requested = new Set(sourceIds);
  const evidence: Array<{ id: string; messageId: string; name: string; text: string }> = [];
  for (const message of messages) {
    storedResearchSourcesForMessage(message).forEach((source, index) => {
      const id = researchSourceId(message.id, index);
      if (requested.has(id)) evidence.push({ id, messageId: message.id, ...source });
    });
  }
  return evidence;
}

export function publicAssistantMessage(message: Message): Message {
  if (!message.metadata) return message;
  const metadata = { ...message.metadata };
  if (Array.isArray(metadata.researchSources)) {
    metadata.researchSources = metadata.researchSources
      .map((source) => plainRecord(source))
      .filter((source): source is Record<string, unknown> => Boolean(source))
      .map((source) => ({
        name: safeString(source.name, 180),
        available: Boolean(safeString(source.text, 1)),
      }))
      .filter((source) => source.name);
  }
  return { ...message, metadata };
}

export function publicAssistantMessages(messages: Message[]): Message[] {
  return messages.map(publicAssistantMessage);
}

export function assistantDocumentReferenceForArtifact(
  artifact: AssistantConversationArtifact
): AssistantDocumentReference {
  return {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    ...(artifact.matterId ? { matterId: artifact.matterId } : {}),
  };
}
