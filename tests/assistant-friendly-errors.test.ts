import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AssistantServerError,
  friendlyAssistantClientError,
} from "../src/components/AssistantView.js";

test("server-provided safe Assistant errors display directly", () => {
  const busy = "The Assistant is temporarily busy and could not complete this request. Please try again in a moment.";
  assert.equal(friendlyAssistantClientError(new AssistantServerError(busy)), busy);
});

test("browser connectivity and unknown errors receive friendly messages", () => {
  assert.equal(friendlyAssistantClientError(new TypeError("Failed to fetch")), "The Assistant could not connect. Please check your connection and try again.");
  assert.equal(friendlyAssistantClientError({ unexpected: true }), "The Assistant could not complete the request. Please try again.");
});

test("temporary UI errors are calm, local-only, and do not trigger another request", async () => {
  const assistant = await readFile("src/components/AssistantView.tsx", "utf8");
  assert.doesNotMatch(assistant, /Please verify your GEMINI_API_KEY in Secrets|❌ Error:/);
  assert.match(assistant, /metadata: \{ error: true \}/);
  assert.match(assistant, /m\.metadata\?\.error !== true/);
  const catchBlock = assistant.slice(assistant.indexOf("} catch (err: any)"), assistant.indexOf("} finally", assistant.indexOf("} catch (err: any)")));
  assert.doesNotMatch(catchBlock, /fetch\(/);
  assert.match(assistant, /\{loading && !streaming && draftStream === null \? \(/);
  assert.match(assistant, /consumeAssistantTurnResponse/);
});
