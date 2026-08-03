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
