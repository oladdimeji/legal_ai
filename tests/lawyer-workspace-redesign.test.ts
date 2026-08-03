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
  conversationMessageForPrompt,
  currentMatterIdForAssistant,
  pageContextForPrompt,
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

test("lawyer top navigation has exactly Matters, Firm Library, History, and Settings", async () => {
  const shell = await readFile("src/components/LawyerWorkspaceShell.tsx", "utf8");
  const navigation = shell.slice(
    shell.indexOf("export const LAWYER_TOP_NAVIGATION"),
    shell.indexOf("] as const")
  );
  assert.match(navigation, /label: "Matters"/);
  assert.match(navigation, /label: "Firm Library"/);
  assert.match(navigation, /label: "History"/);
  assert.match(navigation, /label: "Settings"/);
  assert.doesNotMatch(navigation, /Assistant|Log out/);
  assert.match(shell, /activeNavigation === item\.id/);
  assert.doesNotMatch(shell, /profileMenuOpen|Account menu|account\.user\.email|> Log out/);
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
    pageDescription: `Overview ${"p".repeat(700)} https://cloud.invalid/private`,
    visibleSections: Array.from({ length: 14 }, (_, index) => ({
      id: `section-${index}`,
      title: `Section ${index}`,
      description: index === 0 ? "Invitation code: SECRET-CODE" : "s".repeat(700),
    })),
  });
  assert.ok(sanitized);
  assert.equal(sanitized.pageTitle.length, 160);
  assert.equal(sanitized.visibleActions?.length, 12);
  assert.equal(sanitized.visibleActions?.[0].description.length, 320);
  assert.equal(sanitized.pageDescription?.length, 600);
  assert.equal(sanitized.visibleSections?.length, 10);
  assert.equal(sanitized.visibleSections?.[1].description.length, 500);
  assert.doesNotMatch(pageContextForPrompt(sanitized), /cloud\.invalid|SECRET-CODE/);
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
  const settingsContext: WorkspacePageContext = { routeKind: "settings", pageTitle: "Settings" };
  assert.equal(routeAssistantRequest({ content: "Can you explain the content of the settings for me?", pageContext: settingsContext }), "ui_help");
  assert.equal(routeAssistantRequest({ content: "Explain Windows settings generally.", pageContext: settingsContext }), "general");
});

test("current assistant Matter comes only from the submitted page and history labels remain concise", () => {
  assert.equal(currentMatterIdForAssistant(matterContext), "case_1");
  assert.equal(currentMatterIdForAssistant(generalContext), null);
  const labeled = conversationMessageForPrompt({
    id: "message_1", thread_id: "thread_1", role: "user", content: "What does this cover?",
    citations: [], steps: null, created_at: new Date(0).toISOString(), metadata: { pageContext: matterContext },
  });
  assert.match(labeled, /^USER \[Page: Acme dispute · Sources\]:/);
  const legacy = conversationMessageForPrompt({
    id: "message_2", thread_id: "thread_1", role: "user", content: "Legacy",
    citations: [], steps: null, created_at: new Date(0).toISOString(),
  });
  assert.equal(legacy, "USER: Legacy");
});

test("App owns one fresh session-only active thread and navigation never replaces it", async () => {
  const [app, assistant] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/components/AssistantView.tsx", "utf8"),
  ]);
  assert.doesNotMatch(assistant, /<select[\s\S]{0,500}General Assistant|setActiveCaseId/);
  assert.match(app, /const \[activeThreadId, setActiveThreadId\] = useState<string \| null>\(null\)/);
  assert.doesNotMatch(app, /activeThreadIds|assistantContextKey|localStorage.*Thread|sessionStorage.*Thread/);
  assert.match(app, /onSelectThread=\{\(thread\) => \{[\s\S]*setActiveThreadId\(thread\.id\)/);
  assert.match(app, /if \(thread\.case_id\) navigate\(`\/matters\//);
  assert.doesNotMatch(assistant, /fetchThreads|data\[0\]|\/api\/threads\?caseId/);
  assert.match(assistant, /if \(!activeThreadId\) return/);
  assert.match(assistant, /AbortController/);
  assert.match(assistant, /caseId: originContext\.routeKind === "matter"/);
  assert.match(assistant, /const handleAsk[\s\S]*await handleStartNewThread/);
  assert.match(app, /const handleStartNewThread = \(\) => \{\s*setActiveThreadId\(null\);\s*setNewConversationVersion/);
  assert.doesNotMatch(app.slice(app.indexOf("const handleStartNewThread"), app.indexOf("const handleLogout")), /fetch\(/);
  assert.ok(app.indexOf("const navigate") < app.indexOf("setActiveThreadId(thread.id)"));
});

test("navigation preserves the single conversation across every lawyer destination", async () => {
  const [app, shell] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/components/LawyerWorkspaceShell.tsx", "utf8"),
  ]);
  const navigate = app.slice(app.indexOf("const navigate"), app.indexOf("useEffect(() =>", app.indexOf("const navigate")));
  assert.doesNotMatch(navigate, /setActiveThreadId|setNewConversationVersion/);
  for (const destination of ["/matters", "/library", "/history", "/settings"]) {
    assert.match(shell, new RegExp(destination.replaceAll("/", "\\/")));
  }
  assert.match(app, /`\/documents\/\$\{encodeURIComponent\(document\.id\)\}`/);
  assert.match(app, /key=\{route\.matterId\}/);
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

test("server validates current page entities independently from thread History grouping", async () => {
  const server = await readFile("server.ts", "utf8");
  const endpoint = server.slice(
    server.indexOf('app.post("/api/threads/:id/messages"'),
    server.indexOf('// PUT route for updating a message')
  );
  assert.match(endpoint, /sanitizeWorkspacePageContext/);
  assert.doesNotMatch(endpoint, /validatePageContextThreadBoundary|thread\.case_id/);
  assert.match(endpoint, /getCaseById\(submittedCurrentMatterId, requestOwnership\)/);
  assert.match(endpoint, /getDocumentById\(selectedItem\.id, requestOwnership, currentMatterId\)/);
  assert.match(endpoint, /getDocumentById\(selectedItem\.id, requestOwnership, null\)/);
  assert.match(endpoint, /getDraftById\(selectedItem\.id, currentMatterId, requestOwnership\)/);
  assert.match(endpoint, /getAssistantDocumentById\(selectedItem\.id, requestOwnership\)/);
  assert.match(endpoint, /const retrievalScope = currentMatterId \|\| "wide"/);
  assert.match(endpoint, /pageContext \}/);
  assert.ok(endpoint.indexOf("getCaseById(submittedCurrentMatterId") < endpoint.indexOf("db.addMessage"));
  assert.ok(endpoint.indexOf("const retrievalScope = currentMatterId") < endpoint.indexOf("db.vectorSearch", endpoint.indexOf("const retrievalScope")));
});

test("Settings publishes role-aware page contents without publishing the invitation value", async () => {
  const settings = await readFile("src/components/SettingsView.tsx", "utf8");
  const publisher = settings.slice(settings.indexOf("publishPageContext({"), settings.indexOf("});", settings.indexOf("publishPageContext({")));
  assert.match(publisher, /title: "Account"/);
  assert.match(publisher, /title: "Firm administration"/);
  assert.match(publisher, /title: "Session"/);
  assert.match(publisher, /isAdmin \? \[/);
  assert.match(publisher, /Log out ends the current authenticated session/);
  assert.doesNotMatch(publisher, /value:\s*invitationCode|`[^`]*\$\{invitationCode\}/);
});

test("continuous threads can save to the current Matter or outside it with independent ownership checks", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const createDraft = database.slice(database.indexOf("public async createDraft"), database.indexOf("public async createManualDraft"));
  const createStandalone = database.slice(database.indexOf("public async createAssistantDocument"), database.indexOf("public async getAssistantDocumentById"));
  assert.match(createDraft, /JOIN cases c ON c\.id = \$3/);
  assert.match(createDraft, /t\.user_id = \$7[\s\S]*c\.firm_id = \$8/);
  assert.doesNotMatch(createDraft, /t\.case_id = \$3/);
  assert.match(createStandalone, /t\.user_id = \$3[\s\S]*u\.firm_id = \$4/);
  assert.doesNotMatch(createStandalone, /AND t\.case_id IS NULL/);
});

test("UI help and general modes return before retrieval while workspace analysis avoids generic refusal", async () => {
  const server = await readFile("server.ts", "utf8");
  const endpoint = server.slice(
    server.indexOf('app.post("/api/threads/:id/messages"'),
    server.indexOf('// PUT route for updating a message')
  );
  const directBranch = endpoint.indexOf('assistantMode === "ui_help" || assistantMode === "general"');
  const directReturn = endpoint.indexOf('return res.status(201)', directBranch);
  assert.ok(directBranch > 0 && directReturn > directBranch);
  const directSection = endpoint.slice(directBranch, directReturn);
  assert.doesNotMatch(directSection, /could not find any relevant documents|db\.vectorSearch/);
  assert.match(directSection, /Do not claim to have searched internal workspace documents/);
  assert.doesNotMatch(endpoint, /I could not find any relevant documents in the permitted context regarding this topic/);
  assert.match(endpoint.slice(directReturn), /General legal knowledge may still be used/);
});

test("composer keeps sources and Draft while removing manual Improve and Deep Research", async () => {
  const assistant = await readFile("src/components/AssistantView.tsx", "utf8");
  assert.match(assistant, />Research sources</);
  assert.match(assistant, /id="draft-mode-toggle"/);
  assert.match(assistant, /draftMode \? "Create Draft" : "Ask"/);
  assert.match(assistant, /FileSourcePicker/);
  assert.doesNotMatch(assistant, /handleImprovePrompt|btn-improve-query|forceDeepResearch|deepResearchEnabled|setDeepResearchEnabled/);
});
