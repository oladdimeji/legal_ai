import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stripAssistantInlineCitations } from "../src/lib/assistantCitations.js";
import type { Citation } from "../src/types.js";

const registered: Citation[] = [
  { id: "cit_1", type: "workspace", title: "Agreement", textSnippet: "Clause", sourceName: "Matter Sources" },
  { id: "cit_2", type: "workspace", title: "Exhibit", textSnippet: "Exception", sourceName: "Matter Sources" },
  { id: "cit_web_1", type: "web", title: "Authority", textSnippet: "Rule", sourceName: "Google Search Grounding", url: "https://example.test/rule" },
];

test("registered current and historical Assistant citation forms are removed", () => {
  const cases = [
    "Rule [cit_1].", "Rule [CIT_1].", "Rule [cit-1].", "Rule [cit 1].",
    "Rule [cit_1, cit_2].", "Rule [cit_1][cit_2].", "Rule [cit_web_1].",
    "Rule [web_1].", "Rule [cit_1](#cit_1).", "Rule [1].", "Rule [1, 2].", "Rule [1][2].",
  ];
  for (const value of cases) {
    assert.equal(stripAssistantInlineCitations(value, registered), "Rule.", value);
  }
});

test("citation stripping repairs punctuation, empty parentheses, spaces, and excess blank lines", () => {
  assert.equal(
    stripAssistantInlineCitations("The clause applies [cit_1], subject to the exception [cit_2].", registered),
    "The clause applies, subject to the exception."
  );
  assert.equal(stripAssistantInlineCitations("Rule ([cit_1]).\n\n\nNext.", registered), "Rule.\n\nNext.");
});

test("legitimate bracketed legal content and unknown numbers remain", () => {
  const content = "[Section 2] [Exhibit A] [Number] [Reserved] [Schedule 1] [Draft]\n410 U.S. 113\n12 U.S.C. § 5511\nSection 5(1)\nParagraph [7]";
  assert.equal(stripAssistantInlineCitations(content, registered), content);
  assert.equal(stripAssistantInlineCitations("Paragraph [1]", []), "Paragraph [1]");
});

test("the save-path canonicalizer preserves unknown bare numbers for the registered stripper", async () => {
  const { canonicalizeAssistantCitations } = await import("../src/lib/assistantCitations.js");
  const canonical = canonicalizeAssistantCitations("Known [1]; paragraph [7].", registered);
  assert.equal(stripAssistantInlineCitations(canonical, registered), "Known; paragraph [7].");
});

test("Lawyer Assistant strips body and copy text while preserving source inspection UI", async () => {
  const [assistant, renderer] = await Promise.all([
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("src/components/FormattedMarkdown.tsx", "utf8"),
  ]);
  assert.match(assistant, /content=\{stripAssistantInlineCitations\(text, citationsList\)\}/);
  assert.match(assistant, /writeText\(stripAssistantInlineCitations\(m\.content, m\.citations\)\)/);
  assert.doesNotMatch(assistant, /onCitationHover=|onCitationClick=/);
  assert.match(assistant, /Source" : "Sources"\} Referenced/);
  assert.match(assistant, /setCitationPanelSource\(m\.citations\[0\]\)/);
  assert.match(assistant, /activeMessageCitations\.map/);
  assert.match(assistant, /citationPanelSource\.textSnippet/);
  assert.match(assistant, /citationPanelSource\.url/);
  assert.match(renderer, /onCitationClick|onCitationHover/);
});
