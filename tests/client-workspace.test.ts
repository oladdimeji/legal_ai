import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createCollaborationToken,
  createOAuthState,
  oauthAccountTypeFromCookie,
  parseCollaborationToken,
} from "../server/auth.js";
import { parseRoute } from "../src/lib/routes.js";

test("client account migration is additive, backfills lawyers, and adds a nullable claim owner", async () => {
  const migrations = await readFile("server/migrations.ts", "utf8");
  const migration = migrations.slice(
    migrations.indexOf('name: "authenticated_client_workspace"')
  );
  assert.match(migration, /account_type TEXT NOT NULL DEFAULT 'lawyer'/);
  assert.match(migration, /account_type IN \('lawyer', 'client'\)/);
  assert.match(migration, /claimed_by_user_id TEXT REFERENCES users\(id\) ON DELETE SET NULL/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM users|ALTER TABLE cases RENAME/);
});

test("OAuth account mode is carried in the state cookie and defaults safely to lawyer", () => {
  const clientState = createOAuthState("/client/shared-matters", "client");
  assert.equal(oauthAccountTypeFromCookie(clientState.cookieValue), "client");
  const invalidState = createOAuthState("/assistant", "administrator");
  assert.equal(oauthAccountTypeFromCookie(invalidState.cookieValue), "lawyer");
  assert.equal(oauthAccountTypeFromCookie(null), "lawyer");
});

test("collaboration tokens are opaque, hash-only values and URL input is rejected", () => {
  const first = createCollaborationToken();
  const second = createCollaborationToken();
  assert.match(first.token, /^MAT-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
  assert.equal(first.token.includes("://"), false);
  assert.equal(first.token === second.token, false);
  assert.equal(first.token.includes(first.tokenHash), false);
  assert.equal(parseCollaborationToken(`  ${first.token}  `), first.token);
  assert.equal(parseCollaborationToken(`https://app.exepts.test/client/${first.token}`), null);
  assert.equal(parseCollaborationToken("javascript:alert(1)"), null);
  assert.equal(parseCollaborationToken("short"), null);
});

test("new auth accounts use requested mode while existing accounts are never retyped", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const emailAuth = database.slice(
    database.indexOf("public async authenticateEmail"),
    database.indexOf("public async authenticateGoogle")
  );
  const googleAuth = database.slice(
    database.indexOf("public async authenticateGoogle"),
    database.indexOf("public async completeOnboarding")
  );
  assert.match(emailAuth, /requestedAccountType/);
  assert.match(emailAuth, /requestedAccountType === "client"/);
  assert.doesNotMatch(emailAuth, /UPDATE users SET account_type/);
  assert.match(googleAuth, /CASE WHEN \$2 = 'client' THEN TRUE ELSE FALSE END/);
  assert.doesNotMatch(googleAuth, /UPDATE users SET account_type/);
});

test("server has reusable account guards and keeps client APIs outside the lawyer API gate", async () => {
  const server = await readFile("server.ts", "utf8");
  const clientRoutes = server.indexOf('app.post(\n    "/api/client/shared-matters/redeem"');
  const lawyerGate = server.indexOf(
    'app.use("/api", requireAuth, requireLawyerAccount, requireCompletedOnboarding)'
  );
  assert.match(server, /const requireLawyerAccount/);
  assert.match(server, /const requireClientAccount/);
  assert.match(server, /account_type !== "lawyer"/);
  assert.match(server, /account_type !== "client"/);
  assert.ok(clientRoutes > 0 && clientRoutes < lawyerGate);
  assert.match(
    server,
    /"\/api\/onboarding\/complete",\s*requireAuth,\s*requireLawyerAccount/
  );
});

test("claiming uses the token credential, client identity, locking, and idempotency without email authorization", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const claim = database.slice(
    database.indexOf("public async claimClientCollaboration"),
    database.indexOf("public async getClientSharedMatters")
  );
  assert.match(claim, /account_type !== "client"/);
  assert.match(claim, /FOR UPDATE OF ca/);
  assert.match(claim, /claimed_by_user_id && access\.claimed_by_user_id !== clientUserId/);
  assert.match(claim, /if \(!access\.claimed_by_user_id\)/);
  assert.doesNotMatch(claim, /clientEmail|authenticatedEmail|ca\.client_email/);
  assert.doesNotMatch(claim, /INSERT INTO cases|INSERT INTO drafts|INSERT INTO documents/);
});

test("Shared Matter queries require claim ownership and live collaboration state", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const clientAccess = database.slice(
    database.indexOf("public async getClientSharedMatters"),
    database.indexOf("public async getClientPermittedDraft")
  );
  assert.match(clientAccess, /ca\.claimed_by_user_id = \$1/);
  assert.match(clientAccess, /ca\.claimed_by_user_id = \$2/);
  assert.match(clientAccess, /ca\.invitation_status = 'Active'/);
  assert.match(clientAccess, /ca\.revoked_at IS NULL/);
  assert.match(clientAccess, /ca\.token_hash IS NOT NULL/);
  assert.doesNotMatch(clientAccess, /c\.description|preliminary_objectives|matter_intelligence/);
});

test("client conversations are case-free, user-owned, and excluded from lawyer history", async () => {
  const database = await readFile("server/db.ts", "utf8");
  assert.match(database, /t\.scope = 'client' AND t\.case_id IS NULL/);
  assert.match(database, /t\.user_id = \$1 AND t\.scope = 'client'/);
  assert.match(database, /t\.scope <> 'client'/);
  assert.match(database, /updateClientConversationTitleForFirstMessage/);
  assert.match(database, /other_user_message\.id <> \$5/);
});

test("client Assistant uses only authorized selected shared documents and client history", async () => {
  const server = await readFile("server.ts", "utf8");
  const route = server.slice(
    server.indexOf('"/api/client/assistant/messages"'),
    server.indexOf("const requireClaimedPortalToken")
  );
  assert.match(route, /db\.getClientMessages/);
  assert.match(route, /db\.addClientMessage/);
  assert.match(route, /tryGenerateConversationTitle/);
  assert.match(route, /You do not have access to Shared Matters/);
  assert.match(route, /getAuthorizedClientAssistantDocuments/);
  assert.match(route, /retrieveClientDocumentPassages/);
  assert.match(route, /AUTHORIZED DOCUMENT EVIDENCE/);
  assert.doesNotMatch(route, /vectorSearch|Firm Library Document|googleSearch: true/);
});

test("client routes cover the persistent workspace and disable token deep links", () => {
  assert.deepEqual(parseRoute("/client/assistant"), { kind: "clientAssistant" });
  assert.deepEqual(parseRoute("/client/shared-matters"), { kind: "clientSharedMatters" });
  assert.deepEqual(parseRoute("/client/shared-matters/access_1"), {
    kind: "clientSharedMatter",
    accessId: "access_1",
  });
  assert.deepEqual(parseRoute("/client/history"), { kind: "clientHistory" });
  assert.deepEqual(parseRoute("/client/settings"), { kind: "clientSettings" });
  assert.deepEqual(parseRoute("/client/existing-token"), { kind: "unknown" });
});

test("App uses the small account branch and clients bypass lawyer onboarding and Matter loading", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const clientBranch = app.indexOf('account.user.account_type === "client"');
  const onboardingRender = app.indexOf("<OnboardingView");
  assert.ok(clientBranch > 0 && clientBranch < onboardingRender);
  assert.match(app, /<ClientWorkspace/);
  assert.match(app, /account\?\.user\.account_type === "lawyer"/);
  assert.doesNotMatch(app, /import ClientPortalView/);
});

test("Client Workspace navigation is limited and ordered for secondary users", async () => {
  const workspace = await readFile("src/components/ClientWorkspace.tsx", "utf8");
  const assistant = workspace.indexOf('label: "Assistant"');
  const shared = workspace.indexOf('label: "Shared Matters"');
  const history = workspace.indexOf('label: "History"');
  const settings = workspace.indexOf('label: "Settings"');
  assert.ok(assistant < shared && shared < history && history < settings);
  assert.doesNotMatch(
    workspace,
    /Firm Library|Matter Intelligence|Work Products|Client Portal administration/
  );
});

test("Shared Matters has add, card/list, safe metadata, two detail tabs, preview, download, and requests", async () => {
  const view = await readFile("src/components/ClientSharedMattersView.tsx", "utf8");
  assert.match(view, /Add Shared Matter/);
  assert.match(view, /Card view/);
  assert.match(view, /List view/);
  assert.match(view, /"Shared Documents" \| "Requests"/);
  assert.match(view, /<WorkProductDocument content=\{openDraft\.content\}/);
  assert.match(view, /\/download/);
  assert.match(view, /Submit Response/);
  assert.doesNotMatch(view, /preliminary_objectives|Matter Intelligence|Firm Library/);
});

test("persistent Shared Matters reconnects Edit a Copy to the existing Client Revision flow", async () => {
  const [view, server, database] = await Promise.all([
    readFile("src/components/ClientSharedMattersView.tsx", "utf8"),
    readFile("server.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
  ]);
  const detail = view.slice(view.indexOf("function SharedMatterDetail"));
  const revisionMethod = database.slice(
    database.indexOf("public async createPortalClientRevision"),
    database.indexOf("public async uploadPortalDocument")
  );
  const persistentEndpoint = server.slice(
    server.indexOf(
      '"/api/client/shared-matters/:accessId/work-products/:draftId/edit-copy"'
    ),
    server.indexOf('"/api/client/shared-matters/:accessId/documents"')
  );

  assert.match(detail, /<RichDocumentEditor/);
  assert.match(detail, /setEditContent\(currentDraft\.content\)/);
  assert.match(detail, /The lawyer’s original will remain unchanged\./);
  assert.match(detail, /Save Client Revision/);
  assert.match(detail, /method: "POST"/);
  assert.match(detail, /work-products\/\$\{encodeURIComponent\(editingDraft\.id\)\}\/edit-copy/);
  assert.match(detail, /JSON\.stringify\(\{ content: editContent \}\)/);
  assert.match(detail, /revisions:\s*\[\s*revision,/);
  assert.match(detail, /draft\.revision_type === "Client Revision"/);
  assert.match(detail, /draft\.revision_type !== "Client Revision"/);
  assert.match(detail, /if \(!editingDraft \|\| savingRevision\) return/);
  assert.match(detail, /disabled=\{savingRevision\}/);
  assert.match(detail, /setRevisionError\(/);
  assert.doesNotMatch(detail, /alert\(/);

  assert.match(persistentEndpoint, /requireAuth,\s*requireClientAccount/);
  assert.match(persistentEndpoint, /resolveClientSharedMatter\(\s*req\.params\.accessId,\s*req\.auth!\.user\.id/);
  assert.match(persistentEndpoint, /createPortalClientRevision\(/);

  assert.match(revisionMethod, /INSERT INTO drafts/);
  assert.match(revisionMethod, /\$2, \$3, \$4, \$5, \$5, 'Client Revision', \$6, 'Client Revision'/);
  assert.match(revisionMethod, /original\.id/);
  assert.match(revisionMethod, /original\.revision_type === "Client Revision"/);
  assert.doesNotMatch(revisionMethod, /UPDATE drafts/);
  assert.doesNotMatch(revisionMethod, /portal_comments|addPortalComment/);
});

test("Client Revisions remain visible to the lawyer's normal Matter Work Product query", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const lawyerDrafts = database.slice(
    database.indexOf("public async getDrafts"),
    database.indexOf("public async getDraftById")
  );
  assert.match(lawyerDrafts, /FROM drafts d/);
  assert.match(lawyerDrafts, /d\.case_id = \$1/);
  assert.doesNotMatch(lawyerDrafts, /revision_type\s*(?:<>|!=)|revision_type IS NULL/);
});

test("Client Assistant has persistent chat UX and an authorized document picker", async () => {
  const assistant = await readFile("src/components/ClientAssistantView.tsx", "utf8");
  assert.match(assistant, /New Chat/);
  assert.match(assistant, /scrollIntoView/);
  assert.match(assistant, /workingStages/);
  assert.match(assistant, /revealAssistantMessage/);
  assert.match(assistant, /<FormattedMarkdown/);
  assert.match(assistant, /\/api\/client\/assistant\/messages/);
  assert.match(assistant, /Attach documents/);
  assert.match(assistant, /documentIds: documentIdsForMessage/);
  assert.match(assistant, /selectedDocuments/);
  assert.doesNotMatch(
    assistant,
    /Matter selector|Deep Research|Web Search|Work Product creation|file source/
  );
});

test("Client History reads stored client titles and scopes open and delete to client routes", async () => {
  const history = await readFile("src/components/ClientHistoryView.tsx", "utf8");
  assert.match(history, /\/api\/client\/assistant\/conversations/);
  assert.match(history, /method: "DELETE"/);
  assert.match(history, /onOpen\(conversation\.id\)/);
  assert.doesNotMatch(history, /title-generation|tryGenerateConversationTitle|case_id/);
});

test("Client Settings and landing entry expose only the narrow client account surface", async () => {
  const [settings, landing, auth] = await Promise.all([
    readFile("src/components/ClientSettingsView.tsx", "utf8"),
    readFile("src/components/LandingPage.tsx", "utf8"),
    readFile("src/components/AuthView.tsx", "utf8"),
  ]);
  assert.match(settings, /\["Name"/);
  assert.match(settings, /\["Email"/);
  assert.match(settings, /\["Account type", "Client"\]/);
  assert.match(settings, /Log out/);
  assert.doesNotMatch(settings, /Firm invitation|Firm member|Billing|Notifications/);
  assert.match(landing, />\s*Client Portal\s*</);
  assert.match(auth, /accountType: accountMode/);
});
