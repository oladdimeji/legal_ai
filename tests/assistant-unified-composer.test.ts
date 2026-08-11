import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function assistantSource() {
  return readFile(new URL("../src/components/AssistantView.tsx", import.meta.url), "utf8");
}

test("composer exposes Sources, accessible icon-only Send, and Voice Agent controls", async () => {
  const source = await assistantSource();
  const composer = source.slice(source.indexOf("const renderComposer"), source.indexOf("// Persistent Citation Metadata Panel helper"));
  assert.match(composer, />Sources<\/span>/);
  assert.match(composer, /id="btn-submit-send"/);
  assert.match(composer, /disabled=\{!inputValue\.trim\(\) \|\| loading \|\| fileExtracting \|\| cloudFilesBusy\}/);
  assert.match(composer, /aria-label="Send message"/);
  assert.match(composer, /<Send className="h-3\.5 w-3\.5" aria-hidden="true" \/>/);
  assert.doesNotMatch(composer, />\s*Send\s*</);
  assert.match(composer, /id="btn-voice-mode"/);
  assert.match(composer, />Voice Agent<\/span>/);
  assert.match(composer, /aria-label=\{voiceMode\.active \? "Turn off Voice Agent" : "Start Voice Conversation"\}/);
  assert.match(composer, /title=\{voiceMode\.active \? "Turn off Voice Agent" : "Start Voice Conversation"\}/);
  assert.match(composer, /aria-pressed=\{voiceMode\.active\}/);
  assert.doesNotMatch(composer, /Sending|animate-spin/);
  assert.doesNotMatch(composer, /Draft|Create Draft|Web Search|Google Grounding|Legal Data Grounding|btn-submit-ask|>Ask</);
});

test("composer submits only content, page context, and extracted research-source files", async () => {
  const source = await assistantSource();
  const send = source.slice(source.indexOf("const handleSend"), source.indexOf("const handleTemporaryFiles"));
  assert.match(send, /content: queryText/);
  assert.match(send, /pageContext: submittedPageContext/);
  assert.match(send, /temporaryFiles: submittedTemporaryFiles/);
  assert.doesNotMatch(send, /responseMode|enableWebSearch|forceDeepResearch|routeAssistantRequest/);
});

test("research files remain visible as removable chips and clear only after success", async () => {
  const source = await assistantSource();
  assert.match(source, /id="attached-chips-row"/);
  assert.match(source, /temporaryFiles\.map\(\(file\) =>/);
  assert.match(source, /aria-label=\{`Remove \$\{file\.filename\}`\}/);
  assert.match(source, /submittedTemporaryFiles = temporaryFiles\.filter/);
  assert.match(source, /activeThreadIdRef\.current === currentThreadId[\s\S]*setTemporaryFiles\(\[\]\)/);
});

test("ordinary responses omit zero-source warnings while citations and document cards remain available", async () => {
  const source = await assistantSource();
  assert.doesNotMatch(source, /0 sources matched/);
  assert.match(source, /m\.citations && m\.citations\.length > 0/);
  assert.match(source, /assistant-document-card/);
  assert.match(source, /onOpenDocument\(document\)/);
  assert.match(source, /FormattedMarkdown/);
});

test("unified placeholders and empty state describe capabilities without separate modes", async () => {
  const source = await assistantSource();
  assert.match(source, /Ask about this Matter, create a document, or request anything else…/);
  assert.match(source, /Ask about this page, your workspace, or anything else…/);
  assert.match(source, /Ask a question, work with your workspace, create a document, or attach research sources\./);
  assert.doesNotMatch(source, /Describe the document you want to create|Quick-Enable Grounding Sources/);
});
