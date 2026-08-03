import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { safeInternalPath } from "../server/auth.js";
import {
  ASSISTANT_PANEL_STORAGE_KEY,
  DEFAULT_ASSISTANT_PANEL_WIDTH,
  MAX_ASSISTANT_PANEL_WIDTH,
  MIN_ASSISTANT_PANEL_WIDTH,
  clampAssistantPanelWidth,
} from "../src/lib/assistantPanelWidth.js";
import { routeAssistantRequest } from "../src/lib/assistantRequestRouting.js";
import {
  pageContextForPrompt,
  validatePageContextThreadBoundary,
} from "../server/assistantRouting.js";
import { sanitizeWorkspacePageContext } from "../src/lib/workspacePageContext.js";
import type { WorkspacePageContext } from "../src/types.js";

const generalContext: WorkspacePageContext = { routeKind: "history", pageTitle: "History" };
const matterContext: WorkspacePageContext = {
  routeKind: "matter",
  pageTitle: "Acme dispute",
  activeSection: "Sources",
  matter: { id: "case_1", name: "Acme dispute", clientName: "Acme", status: "Open" },
  visibleActions: [{ id: "add-source", label: "Add Source", description: "Adds an authorized source." }],
};

test("lawyer authentication and onboarding default to Matters while assistant bookmarks stay valid", async () => {
  const [app, server, routes] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("server.ts", "utf8"),
    readFile("src/lib/routes.ts", "utf8"),
  ]);
  assert.equal(safeInternalPath(undefined), "/matters");
  assert.equal(safeInternalPath("/assistant"), "/assistant");
  assert.match(app, /route\.kind === "assistant"[\s\S]*navigate\("\/matters", true\)/);
  assert.match(app, /onCompleted={[\s\S]*navigate\("\/matters", true\)/);
  assert.match(server, /redirectTo: "\/matters"/);
  assert.match(routes, /if \(path === "\/assistant"\) return \{ kind: "assistant" \}/);
});

test("lawyer top navigation has exactly the three confirmed destinations", async () => {
  const shell = await readFile("src/components/LawyerWorkspaceShell.tsx", "utf8");
  const navigation = shell.slice(
    shell.indexOf("export const LAWYER_TOP_NAVIGATION"),
    shell.indexOf("] as const")
  );
  assert.match(navigation, /label: "Matters"/);
  assert.match(navigation, /label: "Firm Library"/);
  assert.match(navigation, /label: "History"/);
  assert.doesNotMatch(navigation, /Assistant|Settings/);
  assert.match(shell, /activeNavigation === item\.id/);
  assert.match(shell, /> Settings/);
  assert.match(shell, /> Log out/);
});

test("assistant panel is persistent, pointer and keyboard resizable, and stores its width", async () => {
  const [app, shell, widthHelper] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/components/LawyerWorkspaceShell.tsx", "utf8"),
    readFile("src/lib/assistantPanelWidth.ts", "utf8"),
  ]);
  assert.match(app, /<LawyerWorkspaceShell[\s\S]*assistant=\{[\s\S]*<AssistantView/);
  assert.match(shell, /role="separator"/);
  assert.match(shell, /onPointerDown/);
  assert.match(shell, /onKeyDown/);
  assert.match(shell, /window\.addEventListener\("resize"/);
  assert.match(widthHelper, new RegExp(ASSISTANT_PANEL_STORAGE_KEY.replaceAll(".", "\\.")));
});

test("assistant panel width clamps to desktop and narrow viewport bounds", () => {
  assert.equal(clampAssistantPanelWidth(Number.NaN, 1440), DEFAULT_ASSISTANT_PANEL_WIDTH);
  assert.equal(clampAssistantPanelWidth(100, 1440), MIN_ASSISTANT_PANEL_WIDTH);
  assert.equal(clampAssistantPanelWidth(900, 1440), MAX_ASSISTANT_PANEL_WIDTH);
  assert.equal(clampAssistantPanelWidth(512, 600), 280);
  assert.equal(clampAssistantPanelWidth(100, 500), 240);
});

test("client workspace keeps its existing independent navigation shell", async () => {
  const [app, clientWorkspace] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/components/ClientWorkspace.tsx", "utf8"),
  ]);
  assert.match(app, /account\.user\.account_type === "client"[\s\S]*<ClientWorkspace/);
  assert.match(clientWorkspace, /label: "Assistant"/);
  assert.match(clientWorkspace, /label: "Settings"/);
  await assert.rejects(readFile("src/components/Sidebar.tsx", "utf8"));
});

test("compact assistant omits the full-page landing and uses an overlay response editor", async () => {
  const assistant = await readFile("src/components/AssistantView.tsx", "utf8");
  assert.match(assistant, /id="compact-empty-conversation"/);
  assert.doesNotMatch(assistant, />Legal Assistant<\/h1>/);
  assert.match(assistant, /id="response-editor-panel" role="dialog" aria-modal="true"/);
  assert.doesNotMatch(assistant, /w-\[450px\]/);
});

test("page context sanitizer bounds browser-authored strings and action counts", () => {
  const sanitized = sanitizeWorkspacePageContext({
    ...matterContext,
    pageTitle: `  Acme\u0000 ${"x".repeat(300)}  `,
    visibleActions: Array.from({ length: 20 }, (_, index) => ({
      id: `action-${index}`,
      label: `Action ${index}`,
      description: "d".repeat(500),
      ignoredContent: "private document body",
    })),
    injected: { documentContents: "must not survive" },
  });
  assert.ok(sanitized);
  assert.equal(sanitized.pageTitle.length, 160);
  assert.equal(sanitized.visibleActions?.length, 12);
  assert.equal(sanitized.visibleActions?.[0].description.length, 320);
  assert.doesNotMatch(pageContextForPrompt(sanitized), /private document body|must not survive/);
  assert.equal(sanitizeWorkspacePageContext({ routeKind: "matter", pageTitle: "Missing Matter" }), null);
});

test("deterministic assistant routing separates UI help, general chat, workspace research, and deep research", () => {
  assert.equal(routeAssistantRequest({ content: "What does this button do?", pageContext: matterContext }), "ui_help");
  assert.equal(routeAssistantRequest({ content: "What is the capital of Ghana?", pageContext: generalContext }), "general");
  assert.equal(routeAssistantRequest({ content: "What is the capital of Ghana?", pageContext: matterContext }), "general");
  assert.equal(routeAssistantRequest({ content: "What do our Firm Library documents say?", pageContext: generalContext }), "workspace_research");
  assert.equal(routeAssistantRequest({ content: "Analyze the key claims", pageContext: matterContext }), "workspace_research");
  assert.equal(routeAssistantRequest({ content: "Compare all relevant cases comprehensively", pageContext: matterContext }), "deep_research");
  assert.equal(routeAssistantRequest({ content: "Hello", pageContext: matterContext }), "general");
  assert.equal(routeAssistantRequest({ content: "Simple question", pageContext: generalContext, forceDeepResearch: true }), "deep_research");
});

test("thread boundary validation rejects Matter/general and cross-Matter combinations", () => {
  assert.deepEqual(validatePageContextThreadBoundary(matterContext, "case_1"), { valid: true });
  assert.equal(validatePageContextThreadBoundary(matterContext, "case_2").valid, false);
  assert.equal(validatePageContextThreadBoundary(generalContext, "case_1").valid, false);
  assert.deepEqual(validatePageContextThreadBoundary(generalContext, null), { valid: true });
});

test("manual scope is absent and route context maintains one active thread per General or Matter context", async () => {
  const [app, assistant] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/components/AssistantView.tsx", "utf8"),
  ]);
  assert.doesNotMatch(assistant, /<select[\s\S]{0,500}General Assistant|setActiveCaseId/);
  assert.match(app, /assistantContextKey = activeCaseId \? `matter:\$\{activeCaseId\}` : "general"/);
  assert.match(app, /activeThreadIds\[assistantContextKey\]/);
  assert.match(app, /const key = thread\.case_id \? `matter:/);
  assert.match(assistant, /data\.some\(\(thread\) => thread\.id === activeThreadId\)/);
});

test("workspace views publish useful bounded context and visible action descriptions", async () => {
  const sources = await Promise.all([
    "MattersView.tsx",
    "MatterWorkspaceView.tsx",
    "FirmLibraryView.tsx",
    "HistoryView.tsx",
    "SettingsView.tsx",
  ].map((name) => readFile(`src/components/${name}`, "utf8")));
  for (const source of sources) assert.match(source, /publishPageContext/);
  assert.match(sources[1], /Matter Intelligence/);
  assert.match(sources[1], /Share with client/);
  assert.match(sources[1], /Collaboration/);
  assert.match(sources[2], /kind: "libraryDocument"/);
});

test("server validates page/thread and selected-entity context before routing", async () => {
  const server = await readFile("server.ts", "utf8");
  const endpoint = server.slice(
    server.indexOf('app.post("/api/threads/:id/messages"'),
    server.indexOf('// PUT route for updating a message')
  );
  assert.match(endpoint, /sanitizeWorkspacePageContext/);
  assert.match(endpoint, /validatePageContextThreadBoundary/);
  assert.match(endpoint, /return res\.status\(409\)/);
  assert.match(endpoint, /getDocumentById\(selectedItem\.id, requestOwnership, thread\.case_id\)/);
  assert.match(endpoint, /getDraftById\(selectedItem\.id, thread\.case_id, requestOwnership\)/);
});

test("UI help and general modes return before vector retrieval while workspace research retains evidence refusal", async () => {
  const server = await readFile("server.ts", "utf8");
  const endpoint = server.slice(
    server.indexOf('app.post("/api/threads/:id/messages"'),
    server.indexOf('// PUT route for updating a message')
  );
  const directBranch = endpoint.indexOf('assistantMode === "ui_help" || assistantMode === "general"');
  const directReturn = endpoint.indexOf('return res.status(201)', directBranch);
  const firstVectorSearch = endpoint.indexOf("db.vectorSearch");
  assert.ok(directBranch > 0 && directReturn > directBranch && firstVectorSearch > directReturn);
  const directSection = endpoint.slice(directBranch, directReturn);
  assert.doesNotMatch(directSection, /could not find any relevant documents|db\.vectorSearch/);
  assert.match(directSection, /Do not claim to have searched internal workspace documents/);
  assert.match(endpoint.slice(firstVectorSearch), /I could not find any relevant documents in the permitted context regarding this topic/);
});

test("Improve is task-aware and receives page and Draft context", async () => {
  const [server, assistant] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/AssistantView.tsx", "utf8"),
  ]);
  const improve = server.slice(server.indexOf('app.post("/api/improve-prompt"'), server.indexOf('app.post("/api/extract-files"'));
  assert.match(improve, /Do not turn ordinary chat or product-help questions into formal legal research queries/);
  assert.match(improve, /pageContextForPrompt/);
  assert.match(assistant, /JSON\.stringify\(\{ prompt: rawPrompt, pageContext, responseMode: "chat" \}\)/);
});
