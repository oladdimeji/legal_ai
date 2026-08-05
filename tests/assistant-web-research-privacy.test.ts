import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  performAssistantWebResearch,
  privateWebResearchDenyList,
  redactPrivateWebResearchText,
} from "../server/assistant/assistantWebResearch.js";
import type { AssistantPlan, AssistantSessionContext } from "../server/assistant/assistantTypes.js";

const session: AssistantSessionContext = {
  currentUtcDate: "2026-08-05",
  user: { id: "user_private", name: "Ada Sentinel", email: "ada.sentinel@example.com", professionalRole: "Lawyer", customProfessionalRole: null, practiceAreas: [], customPracticeArea: null, workspaceType: "firm", firmRole: "member" },
  firm: { id: "firm_private", name: "Sentinel Legal" },
  page: { routeKind: "matter", pageTitle: "Project Nightfall", matter: { id: "case_private_7422", name: "Project Nightfall", clientName: "Atlas Sentinel" } },
  currentMatter: { id: "case_private_7422", name: "Project Nightfall", clientName: "Atlas Sentinel", clientEmail: "atlas@example.com", jurisdiction: "England and Wales", status: "Active" },
  selectedEntity: { kind: "source", id: "doc_private_7423", title: "Secret Agreement.pdf" },
};

const webPlan: AssistantPlan = {
  intent: "legal_analysis",
  depth: "standard",
  needsWorkspace: true,
  needsCurrentPage: false,
  needsWeb: true,
  needsClarification: false,
  deliverable: { kind: "message" },
  referencedArtifactIds: [],
  referencedResearchSourceIds: [],
  toolCalls: [],
};

test("deterministic web redaction removes private names, emails, IDs, filenames, and tokens", () => {
  const deny = privateWebResearchDenyList({
    session,
    resolvedMatterIds: ["case_other_999"],
    artifactTitles: ["Private Advice Memo"],
    attachmentNames: ["Client Schedule.pdf"],
    request: "Research the confidential party named Umbra Holdings",
  });
  const redacted = redactPrivateWebResearchText(
    "Ada Sentinel at ada.sentinel@example.com needs Project Nightfall case_private_7422 Secret Agreement.pdf Client Schedule.pdf Private Advice Memo for Umbra Holdings?token=secret",
    deny
  );
  for (const sentinel of ["Ada Sentinel", "ada.sentinel@example.com", "Project Nightfall", "case_private_7422", "Secret Agreement.pdf", "Client Schedule.pdf", "Private Advice Memo", "Umbra Holdings", "token=secret"]) {
    assert.doesNotMatch(redacted, new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("Google-enabled prompt receives only sanitized public questions and grounding becomes Exepts citations", async () => {
  const calls: Array<{ content: string; options: any }> = [];
  const result = await performAssistantWebResearch({
    request: "For Atlas Sentinel in Project Nightfall case_private_7422, verify the current filing deadline using Secret Agreement.pdf.",
    plan: webPlan,
    session,
    artifactTitles: ["Private Advice Memo"],
    artifactIds: ["assistant_private_1"],
    attachmentNames: ["Secret Agreement.pdf"],
    model: (async (_task: unknown, messages: Array<{ content: string }>, options: any) => {
      calls.push({ content: messages[0].content, options });
      if (!options.googleSearch) return { text: JSON.stringify({ questions: ["What is the current filing deadline under the applicable England and Wales rule?"] }) };
      return {
        text: "The current public deadline is stated by the court guidance [1].",
        groundingMetadata: { groundingChunks: [{ web: { title: "Court guidance", uri: "https://example.test/guidance" } }] },
      };
    }) as any,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.googleSearch, undefined);
  assert.equal(calls[1].options.googleSearch, true);
  for (const sentinel of ["Atlas Sentinel", "Project Nightfall", "case_private_7422", "Secret Agreement.pdf", "Private Advice Memo", "assistant_private_1", "ada.sentinel@example.com"]) {
    assert.doesNotMatch(calls[1].content, new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.equal(result.performed, true);
  assert.equal(result.citations[0].id, "web_1");
  assert.match(result.report, /\[web_1\]/);
});

test("no grounding chunks means no claim that web research was performed", async () => {
  const result = await performAssistantWebResearch({
    request: "Verify the current deadline.",
    plan: webPlan,
    session,
    model: (async (_task: unknown, _messages: unknown, options: any) => options.googleSearch
      ? { text: "Ungrounded answer", groundingMetadata: null }
      : { text: JSON.stringify({ questions: ["What is the current filing deadline?"] }) }) as any,
  });
  assert.equal(result.performed, false);
  assert.equal(result.report, "");
  assert.deepEqual(result.citations, []);
});

test("lawyer route final synthesis and document generation never enable Google Search directly", () => {
  const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const completion = readFileSync(new URL("../server/assistant/assistantCompletion.ts", import.meta.url), "utf8");
  const deliverables = readFileSync(new URL("../server/assistant/assistantDeliverables.ts", import.meta.url), "utf8");
  const route = server.slice(server.indexOf('app.post("/api/threads/:id/messages"'), server.indexOf('app.put("/api/messages/:id"'));
  assert.doesNotMatch(route, /googleSearch:\s*true/);
  assert.match(route, /orchestrateAssistantRetrieval/);
  assert.match(completion, /googleSearch:\s*false/);
  assert.match(deliverables, /googleSearch:\s*false/);
});
