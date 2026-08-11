import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildConversationTitlePrompt,
  generateConversationTitle,
  sanitizeConversationTitle,
  tryGenerateConversationTitle,
} from "../server/conversationTitle.js";

test("title generation sends the complete first request through the fast configured model path", async () => {
  const request = "Hello, I have attached several documents. Please determine which separation agreement obligations remain enforceable after termination.";
  let receivedTask = "";
  let receivedPrompt = "";
  const title = await generateConversationTitle(request, async (task, messages) => {
    receivedTask = task;
    receivedPrompt = messages[0].content;
    return { text: "Separation Agreement Obligation Analysis", groundingMetadata: null };
  });

  assert.equal(title, "Separation Agreement Obligation Analysis");
  assert.equal(receivedTask, "classify-complexity");
  assert.match(receivedPrompt, /Return only the title/);
  assert.match(receivedPrompt, /Ignore greetings, introductory wording/);
  assert.ok(receivedPrompt.endsWith(request));
  assert.equal(buildConversationTitlePrompt(request).split(request).length, 2);
});

test("title sanitization removes presentation markers and preserves concise valid wording", () => {
  assert.equal(
    sanitizeConversationTitle("\n## **“Employment Matter Summary.”**\nIgnored second line"),
    "Employment Matter Summary"
  );
  assert.equal(
    sanitizeConversationTitle("Separation Agreement Obligations and Post-Termination Enforcement Questions"),
    "Separation Agreement Obligations and Post-Termination"
  );
  assert.equal(sanitizeConversationTitle("Question about immigration"), null);
  assert.equal(sanitizeConversationTitle(" \n\t "), null);
  assert.equal(sanitizeConversationTitle("***"), null);
});

test("invalid output, model failure, and save failure retain the caller's fallback without throwing", async () => {
  let savedTitle = "I have attached some documents; can you tell...";
  const save = async (title: string) => {
    savedTitle = title;
    return true;
  };
  const errors: unknown[] = [];

  assert.equal(await tryGenerateConversationTitle("Full request", save, {
    modelCall: async () => ({ text: "", groundingMetadata: null }),
    logError: (_message, error) => errors.push(error),
  }), false);
  assert.equal(savedTitle, "I have attached some documents; can you tell...");

  assert.equal(await tryGenerateConversationTitle("Full request", save, {
    modelCall: async () => { throw new Error("model unavailable"); },
    logError: (_message, error) => errors.push(error),
  }), false);
  assert.equal(savedTitle, "I have attached some documents; can you tell...");

  assert.equal(await tryGenerateConversationTitle("Full request", async () => false, {
    modelCall: async () => ({ text: "Document Relevance Review", groundingMetadata: null }),
    logError: (_message, error) => errors.push(error),
  }), false);
  assert.equal(savedTitle, "I have attached some documents; can you tell...");
  assert.equal(errors.length, 3);
});

test("message flow starts one non-blocking title task only for the first user message", async () => {
  const [server, database] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
  ]);
  const route = server.slice(
    server.indexOf('app.post("/api/threads/:id/messages"'),
    server.indexOf('app.put("/api/messages/:id"', server.indexOf('app.post("/api/threads/:id/messages"'))
  );

  assert.match(route, /const priorHistory = await db\.getRecentMessages/);
  assert.match(route, /const userMessage = await db\.addMessage/);
  assert.match(route, /const isFirstUserMessage = !priorHistory\.some\(\(message\) => message\.role === "user"\)/);
  assert.match(route, /if \(isFirstUserMessage\) \{\s*void tryGenerateConversationTitle\(\s*content,/);
  assert.match(route, /db\.updateThreadTitleForFirstMessage\(\s*threadId,\s*userMessage\.id,\s*thread\.title,/);
  assert.ok(route.indexOf("void tryGenerateConversationTitle") < route.indexOf("planAssistantRequest"));
  assert.match(database, /UPDATE threads t\s+SET title = \$1/);
  assert.match(database, /t\.id = \$2 AND t\.user_id = \$3 AND t\.title = \$4/);
  assert.match(database, /c\.id = t\.case_id AND c\.firm_id = \$5/);
  assert.match(database, /first_message\.id = \$6[\s\S]*first_message\.role = 'user'/);
  assert.match(database, /NOT EXISTS \([\s\S]*other_user_message\.role = 'user'[\s\S]*other_user_message\.id <> \$6/);
});

test("Voice persistence names only a brand-new thread from its first user transcript", async () => {
  const server = await readFile("server.ts", "utf8");
  const route = server.slice(
    server.indexOf('app.post("/api/threads/:id/voice/messages"'),
    server.indexOf("// Core Legal Search")
  );
  assert.match(route, /const priorHistory = role === "user"\s*\? await db\.getRecentMessages\(thread\.id, requestOwnership, 32\)\s*: \[\]/);
  assert.match(route, /const message = await db\.addVoiceMessage/);
  assert.match(route, /const isFirstUserMessage = role === "user" && !priorHistory\.some\(\(priorMessage\) => priorMessage\.role === "user"\)/);
  assert.match(route, /if \(isFirstUserMessage\) \{\s*void tryGenerateConversationTitle\(\s*content,/);
  assert.match(route, /db\.updateThreadTitleForFirstMessage\(\s*thread\.id,\s*message\.id,\s*thread\.title,/);
  assert.ok(route.indexOf("return res.status(201)") > route.indexOf("void tryGenerateConversationTitle"));
  assert.doesNotMatch(route, /await tryGenerateConversationTitle/);
  assert.doesNotMatch(route, /planAssistantRequest|orchestrateAssistantRetrieval|completeAssistantResponse/);
});

test("History remains a stored-title reader with unchanged grouping, open, and delete behavior", async () => {
  const [history, assistant, migrations] = await Promise.all([
    readFile("src/components/HistoryView.tsx", "utf8"),
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("server/migrations.ts", "utf8"),
  ]);

  assert.match(history, /fetch\("\/api\/threads\?history=true"\)/);
  assert.match(history, /\{thread\.title\}/);
  assert.doesNotMatch(history, /callModel|generateConversationTitle|first user message/i);
  assert.match(history, /title: "General Assistant"/);
  assert.match(history, /thread\.case_id === matter\.id/);
  assert.match(history, /onClick=\{\(\) => onSelectThread\(thread\)\}/);
  assert.match(history, /method: "DELETE"/);
  assert.match(assistant, /caseId: originContext\.routeKind === "matter"/);
  assert.doesNotMatch(assistant, /fetchThreads|data\[0\]/);
  assert.match(migrations, /title TEXT NOT NULL/);
});
