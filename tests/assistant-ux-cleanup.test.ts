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

test("Assistant uses progressive working activities and completes designed response streaming", async () => {
  const [assistant, activityHelper] = await Promise.all([
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("src/lib/assistantWorkingActivities.ts", "utf8"),
  ]);
  const activityImplementation = `${assistant}\n${activityHelper}`;

  assert.doesNotMatch(activityImplementation, /ANALYZING MATERIALS|Analyzing materials|connector API endpoints/i);
  assert.match(activityHelper, /Understanding your request…[\s\S]*Request understood/);
  assert.match(activityHelper, /Checking the relevant context…[\s\S]*Relevant context checked/);
  assert.doesNotMatch(activityImplementation, /Reviewing Matter sources…|Reviewing Firm Library materials…/);
  assert.match(activityHelper, /hasAttachments[\s\S]*Reviewing attached documents…[\s\S]*Attached documents reviewed/);
  assert.doesNotMatch(activityImplementation, /Searching the web…|Breaking the question into research steps…|Checking research depth…/);
  assert.match(activityHelper, /Preparing the response…[\s\S]*Response prepared/);
  assert.match(activityHelper, /Refining the response…/);
  assert.match(assistant, /const WORKING_ACTIVITY_DELAY_MS = 2000/);
  assert.doesNotMatch(activityImplementation, /\(current(?:Index)? \+ 1\) %/);
  assert.match(activityHelper, /Math\.min\(currentIndex \+ 1, activityCount - 1\)/);
  assert.match(assistant, /workingStageIndex >= workingActivities\.length - 1/);
  assert.match(assistant, /visibleAssistantWorkingActivities\([\s\S]*workingActivities,[\s\S]*workingStageIndex/);
  assert.match(assistant, /activity\.isCompleted[\s\S]*<Check /);
  assert.match(assistant, /activity\.isCompleted[\s\S]*\? "text-zinc-500"[\s\S]*: "animate-pulse text-zinc-700 motion-reduce:animate-none"/);
  assert.match(assistant, /\{loading && !streaming && \(/);
  assert.match(assistant, /role="status"[\s\S]*aria-live="polite"/);
  assert.match(assistant, /min-w-0 break-words/);
  assert.doesNotMatch(activityImplementation, /classificationReason|Classifier result|confidence score/i);
  assert.match(assistant, /const \[streaming, setStreaming\]/);
  assert.match(assistant, /\{ \.\.\.savedAssistantMessage, content: "" \}/);
  assert.match(assistant, /content: revealedContent/);
  assert.match(assistant, /2800 \+ wordCount \* 14/);
  assert.match(assistant, /Math\.min\(8500, Math\.max\(3000,/);
  assert.match(assistant, /Math\.min\(90, Math\.max\(24,/);
  assert.match(assistant, /prefers-reduced-motion: reduce/);
  assert.match(assistant, /revealedTokenCount < wordCount[\s\S]*revealNextChunk\(\)/);
  assert.match(assistant, /message\.id === savedAssistantMessage\.id \? savedAssistantMessage : message/);
  assert.match(assistant, /message\.id !== savedUserMessage\.id && message\.id !== savedAssistantMessage\.id/);
  assert.match(assistant, /message\.id === tempUserMsg\.id \? savedUserMessage : message/);
  assert.match(assistant, /streaming \? \(draftMode \? "Creating\.\.\." : "Responding\.\.\."\)/);
  assert.match(assistant, /draftMode \? "Create Draft" : "Ask"/);
  assert.match(assistant, /window\.clearTimeout\(workingActivityTimerRef\.current\)/);
  assert.match(assistant, /window\.clearTimeout\(responseStreamTimerRef\.current\)/);
});

test("Assistant message wrappers no longer include a bottom separator", async () => {
  const assistant = await readFile("src/components/AssistantView.tsx", "utf8");
  const wrapperLine = assistant.split("\n").find((line) => line.includes("message-wrapper-${m.id}")) || "";
  assert.match(wrapperLine, /py-5/);
  assert.doesNotMatch(wrapperLine, /border-b|last:border-0|border-zinc-150/);
});

test("Assistant user messages persist sanitized research sources internally and strip them from public responses", async () => {
  const [server, assistant, conversationState] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("server/assistant/assistantConversationState.ts", "utf8"),
  ]);
  const metadataHelper = server.slice(server.indexOf("function temporaryAttachmentMetadata"), server.indexOf("function sanitizePlainEditableText"));
  assert.match(server, /\{ \.\.\.temporaryAttachmentMetadata\(temporaryFiles\), pageContext \}/);
  assert.match(metadataHelper, /conversationResearchSourceMetadata\(files\)/);
  assert.match(conversationState, /researchSourcesPerMessage: 5/);
  assert.match(conversationState, /researchSourceCharacters: 30_000/);
  assert.match(conversationState, /storedResearchCharactersPerMessage: 75_000/);
  assert.match(conversationState, /sanitizeEvidenceText/);
  assert.match(conversationState, /publicAssistantMessage[\s\S]*researchSources[\s\S]*available:/);
  assert.match(server, /publicAssistantMessages\(await db\.getMessages/);
  assert.match(server, /publicAssistantMessage\(userMessage\)/);
  assert.match(server, /publicAssistantMessage\(assistantMessage\)/);
  assert.match(assistant, /metadata: \{[\s\S]*attachments: submittedAttachments[\s\S]*pageContext: submittedPageContext/);
  assert.match(assistant, /submittedTemporaryFiles = temporaryFiles\.filter\(\(file\) => file\.status === "ready"\)/);
  assert.match(assistant, /attachmentNamesForMessage/);
  assert.match(assistant, /title=\{name\}/);
  assert.doesNotMatch(assistant, /href=.*attachments|onClick=.*attachmentNamesForMessage/);
});

test("Assistant routes temporary and selected document evidence through existing authorized paths", async () => {
  const server = await readFile("server.ts", "utf8");
  const route = server.slice(
    server.indexOf('app.post("/api/threads/:id/messages"'),
    server.indexOf('app.put("/api/messages/:id"', server.indexOf('app.post("/api/threads/:id/messages"'))
  );

  assert.match(route, /filename: file\.filename\.trim\(\)\.slice\(0, 180\)/);
  assert.match(route, /filter\(\(file: \{ filename: string; text: string \}\) => file\.filename\.length > 0\)/);
  assert.match(route, /new Set\(temporaryFiles\.map\(\(file\) => file\.filename\)\)/);
  assert.match(route, /\.slice\(0, MAX_FILE_COUNT\)/);
  assert.match(route, /temporaryFileNames,/);
  assert.match(route, /temporaryAttachmentEvidence\(temporaryFiles\)/);
  assert.match(route, /assistantPlan\.needsWorkspace \|\| toolRun\.evidence\.length > 0/);
  assert.match(route, /wrapAuthorizedEvidence\(evidenceWithCitationIds\)/);

  assert.match(route, /getDocumentById\(selectedItem\.id, requestOwnership, currentMatterId\)/);
  assert.match(route, /sourceName: "Matter Sources"/);
  assert.match(route, /getDocumentById\(selectedItem\.id, requestOwnership, null\)/);
  assert.match(route, /sourceName: "Firm Library"/);
  assert.match(route, /getDraftById\(selectedItem\.id, currentMatterId, requestOwnership\)/);
  assert.match(route, /sourceName: "Matter Work Product"/);
  assert.match(route, /sourceType: selectedItem\?\.kind === "workProduct"[\s\S]*?\? "workProduct"[\s\S]*?\? "firmLibrary"[\s\S]*?: "matterSource"/);

  assert.doesNotMatch(route, /MATTER_SOURCE_SENTINEL_7422|FIRM_LIBRARY_SENTINEL_7423|WORK_PRODUCT_SENTINEL_7424/);
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
