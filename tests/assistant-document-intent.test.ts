import assert from "node:assert/strict";
import test from "node:test";
import {
  detectAssistantDocumentIntent,
  reconcileAssistantDocumentIntent,
} from "../server/assistant/assistantDocumentIntent.js";
import { fallbackAssistantPlan, planAssistantRequest } from "../server/assistant/assistantPlanner.js";
import type { AssistantPlan, AssistantPlannerInput } from "../server/assistant/assistantTypes.js";

const page = { routeKind: "history" as const, pageTitle: "Assistant" };
const artifact = {
  id: "artifact_exact_1",
  kind: "assistantDocument" as const,
  title: "Termination Review",
  createdByMessageId: "assistant_1",
  createdAt: "2026-08-05T10:00:00.000Z",
};

function input(content: string, overrides: Partial<AssistantPlannerInput> = {}): AssistantPlannerInput {
  return {
    content,
    hasTemporaryFiles: false,
    temporaryFileNames: [],
    pageContext: page,
    currentMatterId: null,
    conversationState: {
      rollingMemory: "",
      recentTurns: [],
      recentArtifacts: [],
      recentResearchSources: [],
      latestCreatedArtifact: null,
    },
    ...overrides,
  };
}

function messagePlan(overrides: Partial<AssistantPlan> = {}): AssistantPlan {
  return {
    intent: "general_conversation",
    depth: "brief",
    needsWorkspace: false,
    needsCurrentPage: false,
    needsWeb: false,
    needsClarification: false,
    deliverable: { kind: "message" },
    referencedArtifactIds: [],
    referencedResearchSourceIds: [],
    toolCalls: [],
    ...overrides,
  };
}

function withArtifacts(content: string, artifacts = [artifact]): AssistantPlannerInput {
  return input(content, {
    conversationState: {
      rollingMemory: "",
      recentTurns: [],
      recentArtifacts: artifacts,
      recentResearchSources: [],
      latestCreatedArtifact: artifacts[0] || null,
    },
  });
}

test("semantic creation requests produce standalone saved documents", () => {
  const requests = [
    "Draft an email to Dimeji.",
    "Compose an accompanying email message.",
    "Prepare a legal memorandum.",
    "Write a client advice letter.",
    "Create a review document.",
    "Generate a report.",
    "Produce a checklist.",
    "Turn that into a simple and clear review document I can reference.",
    "Turn the above into a document.",
    "Convert this analysis into a client-facing letter.",
    "Return this as a document.",
    "Provide that as a Word document.",
    "Put this into a formal memo.",
    "Format the analysis as a report.",
    "Save this as an advice note.",
    "Give me a document I can share.",
    "Could you draft an email for Dimeji?",
    "Please prepare an accompanying transmittal letter.",
    "Prepare a revised version.",
  ];
  for (const request of requests) {
    const plan = fallbackAssistantPlan(input(request));
    assert.equal(detectAssistantDocumentIntent(input(request)).kind, "explicit_create", request);
    assert.equal(plan.intent, "document_creation", request);
    assert.deepEqual(plan.deliverable, { kind: "document", documentAction: "create" }, request);
  }
});

test("requests for explanation plus a formal deliverable produce both outputs", () => {
  for (const request of [
    "Analyse the risks and prepare a memorandum.",
    "Explain the recommendation and draft a client letter.",
    "Tell me the main issues and create a review document.",
    "Assess the agreement and prepare an email explaining the required changes.",
  ]) {
    assert.deepEqual(fallbackAssistantPlan(input(request)).deliverable, {
      kind: "message_and_document",
      documentAction: "create",
    }, request);
  }
});

test("informational and short-wording requests remain messages", () => {
  for (const request of [
    "What does this document contain?",
    "Summarize this agreement.",
    "Explain the termination clause.",
    "What are the risks?",
    "What should the email say?",
    "How should I draft a memorandum?",
    "How do I prepare a client letter?",
    "Give me a two-line response.",
    "Suggest an email subject line.",
    "Review this draft and tell me what is wrong.",
    "Write one sentence I can add.",
    "Compare these documents.",
    "What assumptions did you use in the document?",
  ]) {
    assert.equal(fallbackAssistantPlan(input(request)).deliverable.kind, "message", request);
  }
});

test("explicit chat-only and non-persistence instructions have highest precedence", () => {
  for (const request of [
    "Draft the email here, but do not create a document.",
    "Write it in the chat only.",
    "Do not save this.",
    "Do not create a document.",
    "Just show me the wording here.",
    "Prepare a memo without saving it.",
    "Compose the email here without creating a file.",
    "Give me an example only.",
  ]) {
    const requestInput = input(request);
    assert.equal(detectAssistantDocumentIntent(requestInput).kind, "explicit_message_only", request);
    assert.deepEqual(fallbackAssistantPlan(requestInput).deliverable, { kind: "message" }, request);
  }
});

test("explicit saved-artifact revisions resolve the exact authorized artifact", () => {
  for (const request of [
    "Revise the document you created.",
    "Rewrite that memo.",
    "Make the previous document shorter.",
    "Shorten the letter you just created.",
    "Update that report.",
    "Amend the agreement.",
    "Add a termination clause to that document.",
    "Remove the final section from the memo.",
    "Turn the previous report into a client letter.",
    "Convert the document you created into an email.",
  ]) {
    const plan = fallbackAssistantPlan(withArtifacts(request));
    assert.equal(plan.intent, "document_revision", request);
    assert.deepEqual(plan.deliverable, {
      kind: "document",
      documentAction: "revise",
      sourceArtifactId: artifact.id,
    }, request);
    assert.deepEqual(plan.referencedArtifactIds, [artifact.id], request);
  }
});

test("conversation-content conversion creates, while ambiguous or missing revisions clarify", () => {
  const conversion = fallbackAssistantPlan(withArtifacts("Turn that into a document."));
  assert.deepEqual(conversion.deliverable, { kind: "document", documentAction: "create" });
  assert.deepEqual(conversion.referencedArtifactIds, []);

  const second = { ...artifact, id: "artifact_exact_2", title: "Commercial Review" };
  const ambiguous = fallbackAssistantPlan(withArtifacts("Amend the agreement.", [artifact, second]));
  assert.equal(ambiguous.needsClarification, true);
  assert.deepEqual(ambiguous.deliverable, { kind: "message" });
  assert.match(ambiguous.clarificationQuestion || "", /Which previously created document/i);
  const ambiguousPronoun = fallbackAssistantPlan(withArtifacts("Rewrite that memo.", [artifact, second]));
  assert.equal(ambiguousPronoun.needsClarification, true);
  assert.deepEqual(ambiguousPronoun.deliverable, { kind: "message" });

  const missing = fallbackAssistantPlan(input("Revise the document you created."));
  assert.equal(missing.needsClarification, true);
  assert.deepEqual(missing.deliverable, { kind: "message" });
});

test("bounded affirmative replies accept only the latest Assistant formal-document offer", () => {
  const offers = [
    ["Would you like me to draft an accompanying email?", "Yes."],
    ["I can prepare a client-facing memorandum.", "Please do."],
    ["Should I create a formal review report?", "Go ahead."],
    ["Would it help if I drafted a transmittal letter?", "That would be great."],
    ["Would you like me to compose an email message?", "Sure."],
  ];
  for (const [offer, reply] of offers) {
    const requestInput = input(reply, {
      conversationState: {
        rollingMemory: "",
        recentTurns: [{ messageId: "a1", role: "assistant", content: offer, createdAt: "2026-08-05T10:00:00Z", attachmentNames: [] }],
        recentArtifacts: [], recentResearchSources: [], latestCreatedArtifact: null,
      },
    });
    assert.equal(detectAssistantDocumentIntent(requestInput).kind, "accepted_document_offer", `${offer} / ${reply}`);
    assert.deepEqual(fallbackAssistantPlan(requestInput).deliverable, { kind: "document", documentAction: "create" });
  }

  for (const offer of ["Would you like me to explain the agreement?", "Should I search the Firm Library?"]) {
    const requestInput = input("Please do.", {
      conversationState: {
        rollingMemory: "", recentTurns: [{ messageId: "a1", role: "assistant", content: offer, createdAt: "2026-08-05T10:00:00Z", attachmentNames: [] }],
        recentArtifacts: [], recentResearchSources: [], latestCreatedArtifact: null,
      },
    });
    assert.equal(fallbackAssistantPlan(requestInput).deliverable.kind, "message", offer);
  }

  const overridden = input("Yes, but show it here only.", {
    conversationState: {
      rollingMemory: "", recentTurns: [{ messageId: "a1", role: "assistant", content: "Would you like me to draft an email?", createdAt: "2026-08-05T10:00:00Z", attachmentNames: [] }],
      recentArtifacts: [], recentResearchSources: [], latestCreatedArtifact: null,
    },
  });
  assert.deepEqual(fallbackAssistantPlan(overridden).deliverable, { kind: "message" });
});

test("reconciliation corrects high-confidence model misses and preserves unrelated plan decisions", async () => {
  const planner = (plan: AssistantPlan) => (async () => ({ text: JSON.stringify(plan), groundingMetadata: null })) as any;
  const preservedFields = {
    needsWorkspace: true,
    needsCurrentPage: true,
    needsWeb: true,
    referencedResearchSourceIds: [],
    toolCalls: [{ name: "get_account_profile" as const, arguments: {} }],
  };
  for (const request of ["Draft an email to Dimeji.", "Turn that into a review document."]) {
    const plan = await planAssistantRequest(input(request), planner(messagePlan({ ...preservedFields })));
    assert.deepEqual(plan.deliverable, { kind: "document", documentAction: "create" });
    assert.equal(plan.needsWeb, true);
    assert.deepEqual(plan.toolCalls, preservedFields.toolCalls);
  }

  const wrongDocument = messagePlan({ intent: "document_creation", deliverable: { kind: "document", documentAction: "create" } });
  assert.deepEqual((await planAssistantRequest(input("What does this document contain?"), planner(wrongDocument))).deliverable, { kind: "message" });
  assert.deepEqual((await planAssistantRequest(input("Draft the email here but do not save it."), planner(wrongDocument))).deliverable, { kind: "message" });

  const appropriate = messagePlan({
    intent: "document_creation",
    depth: "thorough",
    needsWeb: true,
    deliverable: { kind: "message_and_document", documentAction: "create" },
  });
  assert.deepEqual(await planAssistantRequest(input("Analyse the risks and prepare a memorandum."), planner(appropriate)), appropriate);
});

test("direct reconciliation removes revision fields from explicit message-only plans", () => {
  const revisionInput = withArtifacts("Draft the memo here without saving.");
  const revisionPlan = messagePlan({
    intent: "document_revision",
    needsWorkspace: true,
    deliverable: { kind: "document", documentAction: "revise", sourceArtifactId: artifact.id },
    referencedArtifactIds: [artifact.id],
  });
  const result = reconcileAssistantDocumentIntent(revisionPlan, detectAssistantDocumentIntent(revisionInput), revisionInput);
  assert.deepEqual(result.deliverable, { kind: "message" });
});

test("planner document create plans proceed without clarification even when the hint is none", () => {
  const plannerCreate = messagePlan({
    intent: "document_creation",
    needsClarification: true,
    clarificationQuestion: "What client name should appear in the agreement?",
    deliverable: { kind: "document", documentAction: "create" },
  });
  const reconciled = reconcileAssistantDocumentIntent(
    plannerCreate,
    detectAssistantDocumentIntent(input("Put together a client engagement letter.")),
    input("Put together a client engagement letter.")
  );
  assert.equal(reconciled.needsClarification, false);
  assert.equal(reconciled.clarificationQuestion, undefined);
  assert.deepEqual(reconciled.deliverable, { kind: "document", documentAction: "create" });
});
