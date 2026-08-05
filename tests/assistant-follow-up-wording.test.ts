import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeFollowUpSuggestion,
  normalizeFollowUpSuggestions,
} from "../server/assistant/followUpSuggestions.js";

const conversions = [
  ["Would you like me to draft an email?", "Draft an email."],
  ["Do you want me to review the clause?", "Review the clause."],
  ["Should I compare these documents?", "Compare these documents."],
  ["Should we insert a two-year period?", "Insert a two-year period."],
  ["Shall I prepare a summary?", "Prepare a summary."],
  ["Can I search the Firm Library?", "Search the Firm Library."],
  ["I can create a revised version.", "Create a revised version."],
  ["Let me explain the assumptions.", "Explain the assumptions."],
] as const;

for (const [input, expected] of conversions) {
  test(`normalizes Assistant offer: ${input}`, () => {
    assert.equal(normalizeFollowUpSuggestion(input), expected);
  });
}

test("preserves direct questions and imperatives", () => {
  for (const suggestion of [
    "What assumptions did you use?",
    "Which authority supports this conclusion?",
    "How does this compare with the earlier agreement?",
    "Compare this with the Firm Library precedent.",
  ]) {
    assert.equal(normalizeFollowUpSuggestion(suggestion), suggestion);
  }
});

test("trims values, removes empty results, and corrects offer punctuation only", () => {
  assert.equal(normalizeFollowUpSuggestion("  Should I review this?  "), "Review this.");
  assert.equal(normalizeFollowUpSuggestion("Should I?"), "Should I?");
  assert.equal(normalizeFollowUpSuggestion("   "), "");
  assert.equal(normalizeFollowUpSuggestion("Review this?"), "Review this?");
});

test("deduplicates normalized suggestions case-insensitively in original order and limits to four", () => {
  assert.deepEqual(normalizeFollowUpSuggestions([
    "Would you like me to draft an email?",
    "draft an email.",
    "Review the clause.",
    "Compare the documents.",
    "Explain the assumptions.",
    "Prepare a summary.",
  ]), [
    "Draft an email.",
    "Review the clause.",
    "Compare the documents.",
    "Explain the assumptions.",
  ]);
});

test("generation prompt requires user-perspective ready-to-send messages and rejects offer wording", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  const suggestionFunction = server.slice(
    server.indexOf("async function generateFollowUpSuggestions"),
    server.indexOf("async function suggestMatterOverview"),
  );
  assert.match(suggestionFunction, /lawyer\/user's perspective/);
  assert.match(suggestionFunction, /ready to send verbatim when clicked/);
  assert.match(suggestionFunction, /direct instructions or direct questions/);
  assert.match(suggestionFunction, /Would you like me to/);
  assert.match(suggestionFunction, /Should we/);
  assert.match(suggestionFunction, /normalizeFollowUpSuggestions\(suggestions\)/);
  assert.match(suggestionFunction, /Title:/);
  assert.match(suggestionFunction, /Kind:/);
  assert.match(suggestionFunction, /Action:/);
  assert.doesNotMatch(suggestionFunction, /documentContext\.(?:content|text|body)/);
});

test("frontend submits a clicked follow-up suggestion verbatim", async () => {
  const assistantView = await readFile(new URL("../src/components/AssistantView.tsx", import.meta.url), "utf8");
  assert.match(assistantView, /onClick=\{\(\) => handleSend\(undefined, suggestion\)\}/);
});
