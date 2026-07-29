import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cleanGeneratedBoilerplate } from "../server/generatedContentCleanup.js";
import {
  assistantCitationsToDisplayText,
  canonicalizeAssistantCitations,
  linkAssistantCitations,
  rewriteGoogleGroundingCitations,
} from "../src/lib/assistantCitations.js";
import type { Citation } from "../src/types.js";

const citations: Citation[] = [
  { id: "cit_1", type: "workspace", title: "Agreement", textSnippet: "A", sourceName: "Matter Sources" },
  { id: "cit_2", type: "web", title: "Case", textSnippet: "B", sourceName: "Google Search Grounding" },
];

test("Assistant research sources retain web search and attachments without retired connectors", async () => {
  const [assistant, server] = await Promise.all([
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  const route = server.slice(
    server.indexOf('app.post("/api/threads/:id/messages"'),
    server.indexOf('app.put("/api/messages/:id"', server.indexOf('app.post("/api/threads/:id/messages"'))
  );

  assert.doesNotMatch(assistant, /CourtListener|GovInfo|enableCourtListener|enableGovInfo/);
  assert.doesNotMatch(route, /CourtListenerAdapter|GovInfoAdapter|enableCourtListener|enableGovInfo/);
  assert.match(assistant, /const \[enableWebSearch, setEnableWebSearch\]/);
  assert.match(assistant, /<span>Web Search<\/span>/);
  assert.match(assistant, /temporaryFiles: submittedTemporaryFiles/);
  assert.match(assistant, /Temporary File Attachments/);
  assert.match(route, /temporaryAttachmentMetadata\(temporaryFiles\)/);
  assert.match(route, /sourceName: "Temporary File Attachment"/);
});

test("Assistant uses rotating working statuses and completes designed response streaming", async () => {
  const assistant = await readFile("src/components/AssistantView.tsx", "utf8");

  assert.doesNotMatch(assistant, /ANALYZING MATERIALS|Analyzing materials|connector API endpoints/i);
  assert.match(assistant, /Understanding your request…/);
  assert.match(assistant, /Reviewing Matter sources…/);
  assert.match(assistant, /Reviewing Firm Library…/);
  assert.match(assistant, /Searching the web…/);
  assert.match(assistant, /Checking research depth…/);
  assert.match(assistant, /Preparing the response…/);
  assert.match(assistant, /const \[streaming, setStreaming\]/);
  assert.match(assistant, /\{ \.\.\.savedAssistantMessage, content: "" \}/);
  assert.match(assistant, /content: revealedContent/);
  assert.match(assistant, /message\.id === savedAssistantMessage\.id \? savedAssistantMessage : message/);
  assert.match(assistant, /message\.id === tempUserMsg\.id \? savedUserMessage : message/);
  assert.match(assistant, /streaming \? "Responding\.\.\." : loading \? "Sending\.\.\."/);
  assert.match(assistant, /window\.clearInterval\(responseStreamTimerRef\.current\)/);
});

test("Assistant message wrappers no longer include a bottom separator", async () => {
  const assistant = await readFile("src/components/AssistantView.tsx", "utf8");
  const wrapperLine = assistant.split("\n").find((line) => line.includes("message-wrapper-${m.id}")) || "";
  assert.match(wrapperLine, /py-5/);
  assert.doesNotMatch(wrapperLine, /border-b|last:border-0|border-zinc-150/);
});

test("Assistant user messages persist only temporary attachment filenames in metadata", async () => {
  const [server, assistant] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/AssistantView.tsx", "utf8"),
  ]);
  const metadataHelper = server.slice(server.indexOf("function temporaryAttachmentMetadata"), server.indexOf("function sanitizePlainEditableText"));
  const metadataBody = metadataHelper.slice(metadataHelper.indexOf("const attachments"));
  assert.match(server, /temporaryAttachmentMetadata\(temporaryFiles\)/);
  assert.match(metadataHelper, /map\(\(name\) => \(\{ name \}\)\)/);
  assert.match(metadataHelper, /filename\.trim\(\)\.slice\(0, 180\)/);
  assert.doesNotMatch(metadataBody, /\.text|text:/);
  assert.match(assistant, /metadata: submittedAttachments\.length \? \{ attachments: submittedAttachments \} : \{\}/);
  assert.match(assistant, /submittedTemporaryFiles = temporaryFiles\.filter\(\(file\) => file\.status === "ready"\)/);
  assert.match(assistant, /attachmentNamesForMessage/);
  assert.match(assistant, /title=\{name\}/);
  assert.doesNotMatch(assistant, /href=.*attachments|onClick=.*attachmentNamesForMessage/);
});

test("Assistant citation normalization supports variants, groups, and invalid-token removal", () => {
  assert.equal(canonicalizeAssistantCitations("Rule [CIT_2], [cit-1], \\[cit 2\\].", citations), "Rule [cit_2], [cit_1], [cit_2].");
  assert.equal(linkAssistantCitations("One [cit_1, cit_2].", citations), "One [cit_1](#cit_1)[cit_2](#cit_2).");
  assert.equal(linkAssistantCitations("Bad [cit_9] text.", citations), "Bad text.");
  assert.equal(linkAssistantCitations("Keep [Section 2], [Exhibit A], and [Reserved].", citations), "Keep [Section 2], [Exhibit A], and [Reserved].");
  assert.equal(assistantCitationsToDisplayText("Copy [cit_1][cit_2].", citations), "Copy [1][2].");
});

test("Google grounding rewrite maps only actual grounding chunks", () => {
  assert.equal(rewriteGoogleGroundingCitations("Mapped [1], missing [2], mixed [cit_1, 2].", { 0: "cit_2" }), "Mapped [cit_2], missing, mixed [cit_1].");
  assert.doesNotMatch(rewriteGoogleGroundingCitations("No fallback [3].", {}), /cit_3/);
});

test("Generated boilerplate cleaner is narrow", () => {
  assert.equal(cleanGeneratedBoilerplate("This is not legal advice.\n\n## Answer\nThe record is incomplete."), "## Answer\nThe record is incomplete.");
  assert.equal(cleanGeneratedBoilerplate("## Answer\nAnalyze the Disclaimer of Warranties section.\n\nConsult a qualified lawyer."), "## Answer\nAnalyze the Disclaimer of Warranties section.");
  assert.equal(cleanGeneratedBoilerplate("## Disclaimer of Warranties\nThis clause limits remedies."), "## Disclaimer of Warranties\nThis clause limits remedies.");
  assert.equal(cleanGeneratedBoilerplate("The warranty disclaimer clause may bar recovery."), "The warranty disclaimer clause may bar recovery.");
});

test("Assistant prompts and copy path prevent generic disclaimers and internal citation display", async () => {
  const [server, assistant, portal] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("src/components/ClientPortalView.tsx", "utf8"),
  ]);
  assert.match(server, /Do not append generic legal-advice, AI, lawyer-review, consultation, informational-purpose, or limitation-of-liability disclaimer boilerplate/);
  assert.match(server, /cleanGeneratedText\(text\)/);
  assert.match(server, /cleanGeneratedWorkProductContent\(draftResult\.text\)/);
  assert.doesNotMatch(server, /professional disclaimer|standard liability disclaimer|replacement for the lawyer's advice/);
  assert.match(assistant, /assistantCitationsToDisplayText\(m\.content, m\.citations\)/);
  assert.doesNotMatch(assistant, /standard liability disclaimer|replacement for your lawyer/);
  assert.doesNotMatch(portal, /replacement for your lawyer's advice|Document understanding only/);
});
