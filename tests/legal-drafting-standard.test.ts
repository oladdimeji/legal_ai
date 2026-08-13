import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildAssistantDraftPrompt } from "../server/assistantDrafting.js";
import { TOP_TIER_LEGAL_DRAFTING_STANDARD } from "../server/legalDraftingStandard.js";
import { MODEL_CONFIGS, MODEL_THINKING_LEVELS } from "../server/model.js";
import { buildWorkProductDraftPrompt } from "../server/workProductDrafting.js";

function autonomousPrompt(): string {
  return buildAssistantDraftPrompt({
    instruction: "Revise the existing services agreement's termination clause without rewriting unrelated sections.",
    pageContext: {
      routeKind: "matter",
      pageTitle: "Matter",
      matter: { id: "matter_1", name: "Example Matter" },
    },
    conversationContext: "The user previously requested a targeted revision.",
    authorizedEvidence: "The authorized source agreement appears here.",
    accountMetadata: "Matter name: Example Matter\nFirm name: Example LLP",
    currentDate: "August 13, 2026",
    publicWebResearch: "",
    webResearchPerformed: false,
    depth: "standard",
  });
}

function workProductPrompt(format: "memo" | "email" | "summary"): string {
  return buildWorkProductDraftPrompt({
    format,
    matterMetadata: "Matter name: Example Matter\nCurrent date: August 13, 2026",
    conversationHistory: "USER: Analyze only the supplied facts.",
    instructions: "Keep the selected format and use a neutral tone.",
  });
}

test("both formal drafting paths consume the exact shared premium standard", () => {
  const assistant = autonomousPrompt();
  const legacy = workProductPrompt("memo");

  assert.ok(assistant.includes(TOP_TIER_LEGAL_DRAFTING_STANDARD));
  assert.ok(legacy.includes(TOP_TIER_LEGAL_DRAFTING_STANDARD));
  assert.equal(assistant.match(/Premium legal-drafting quality standard/g)?.length, 1);
  assert.equal(legacy.match(/Premium legal-drafting quality standard/g)?.length, 1);
});

test("the shared standard requires proportional, document-specific completeness and consistency", () => {
  assert.match(TOP_TIER_LEGAL_DRAFTING_STANDARD, /Comprehensive does not mean unnecessarily long/);
  assert.match(TOP_TIER_LEGAL_DRAFTING_STANDARD, /do not impose artificial brevity or artificial verbosity/i);
  assert.match(TOP_TIER_LEGAL_DRAFTING_STANDARD, /short email, single clause, or consent should remain appropriately concise/i);
  assert.match(TOP_TIER_LEGAL_DRAFTING_STANDARD, /provisions or analytical components ordinarily necessary for this particular work product/i);
  assert.match(TOP_TIER_LEGAL_DRAFTING_STANDARD, /Include conventional components only where applicable/i);
  assert.match(TOP_TIER_LEGAL_DRAFTING_STANDARD, /Internal contractual consistency/);
  assert.match(TOP_TIER_LEGAL_DRAFTING_STANDARD, /undefined terms/);
  assert.match(TOP_TIER_LEGAL_DRAFTING_STANDARD, /broken cross-references/);
  assert.match(TOP_TIER_LEGAL_DRAFTING_STANDARD, /silently ensure it is complete for its intended purpose/i);
});

test("evidence, attachment, disclaimer, arbitrary-type, and targeted-revision safeguards remain in autonomous drafting", () => {
  const prompt = autonomousPrompt();

  assert.match(prompt, /Do not restrict the output to a fixed format list/);
  assert.match(prompt, /Never fill a missing Matter fact with general knowledge/i);
  assert.match(prompt, /never invent Matter facts or evidentiary material/i);
  assert.match(prompt, /Do not add attachments automatically to every draft/);
  assert.match(prompt, /Do not add attachments where they are not appropriate or useful/);
  assert.match(prompt, /Do not add generic AI, legal-advice, lawyer-review, consultation, or informational-purpose disclaimer boilerplate/);
  assert.match(TOP_TIER_LEGAL_DRAFTING_STANDARD, /do not gratuitously rewrite unrelated sections/i);
  assert.match(TOP_TIER_LEGAL_DRAFTING_STANDARD, /make only genuinely necessary conforming edits/i);
});

test("legacy Work Product formats retain distinct instructions inside the shared standard", () => {
  const memo = workProductPrompt("memo");
  const email = workProductPrompt("email");
  const summary = workProductPrompt("summary");

  assert.match(memo, /Create a legal memorandum/);
  assert.match(memo, /Question Presented/);
  assert.doesNotMatch(memo, /Create a professional legal email|Create a clear legal summary/);

  assert.match(email, /Create a professional legal email/);
  assert.match(email, /Do not format this as a legal memorandum/);
  assert.doesNotMatch(email, /Create a legal memorandum|Create a clear legal summary/);

  assert.match(summary, /Create a clear legal summary/);
  assert.match(summary, /Do not format this as an email/);
  assert.doesNotMatch(summary, /Create a legal memorandum|Create a professional legal email/);

  for (const prompt of [memo, email, summary]) {
    assert.ok(prompt.includes(TOP_TIER_LEGAL_DRAFTING_STANDARD));
    assert.match(prompt, /Do not append generic legal-advice/);
  }
});

test("draft model and thinking configuration remain unchanged and each path has one generation call", async () => {
  assert.equal(MODEL_CONFIGS["draft-generation"], "gemini-3.6-flash");
  assert.equal(MODEL_THINKING_LEVELS["draft-generation"], "medium");

  const [deliverables, server] = await Promise.all([
    readFile("server/assistant/assistantDeliverables.ts", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  assert.equal((deliverables.match(/model\("draft-generation"/g) ?? []).length, 1);
  const route = server.slice(
    server.indexOf('app.post("/api/drafts"'),
    server.indexOf('app.post("/api/drafts/:id/client-revision"')
  );
  assert.equal((route.match(/callModel\("draft-generation"/g) ?? []).length, 1);
  assert.doesNotMatch(route, /review-generation|polish-generation/);
});
