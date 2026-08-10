import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("document sharing and request creation notify only after successful actions", async () => {
  const server = await readFile("server.ts", "utf8");
  const sharing = server.slice(
    server.indexOf('app.put("/api/drafts/:id/sharing"'),
    server.indexOf('app.post("/api/drafts/:id/client-revision"')
  );
  const request = server.slice(
    server.indexOf('app.post("/api/cases/:caseId/collaboration/requests"'),
    server.indexOf('app.put("/api/cases/:caseId/collaboration/responses')
  );

  assert.ok(sharing.indexOf("await db.setDraftSharing") < sharing.indexOf("notifyActiveMatterClient"));
  assert.match(sharing, /if \(req\.body\.shared\) \{[\s\S]*notifyActiveMatterClient/);
  assert.match(sharing, /A document was shared with you in Exepts/);
  assert.ok(request.indexOf("await db.createCollaborationRequest") < request.indexOf("notifyActiveMatterClient"));
  assert.match(request, /A new \$\{type\} request is available for \$\{matterName\}/);
});

test("active client lookup is Matter-scoped and silently skips absent or invalid recipients", async () => {
  const [server, database] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
  ]);
  const lookup = database.slice(
    database.indexOf("public async getActiveClientCollaborator"),
    database.indexOf("public async getApprovedMatterLawyers")
  );
  const notifier = server.slice(
    server.indexOf("function notifyActiveMatterClient"),
    server.indexOf("function notifyMatterLawyers")
  );

  assert.match(lookup, /await this\.assertMatterAccess\(caseId, context\)/);
  assert.match(lookup, /ca\.case_id = \$1[\s\S]*c\.firm_id = \$2/);
  assert.match(lookup, /invitation_status = 'Active'[\s\S]*revoked_at IS NULL/);
  assert.match(notifier, /if \(!client \|\| !isValidEmail\(normalizeEmail\(client\.client_email\)\)\) return/);
});

test("Client Revision and request response notify approved explicit-access lawyers", async () => {
  const [server, database] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
  ]);
  const lawyers = database.slice(
    database.indexOf("public async getApprovedMatterLawyers"),
    database.indexOf("public async getCollaborationRequestType")
  );
  const revision = server.slice(
    server.indexOf('"/api/client/shared-matters/:accessId/work-products/:draftId/edit-copy"'),
    server.indexOf('"/api/client/shared-matters/:accessId/documents"')
  );
  const response = server.slice(
    server.indexOf('"/api/client/shared-matters/:accessId/requests/:requestId/responses"'),
    server.indexOf('"/api/client/assistant/conversations"')
  );

  assert.match(lawyers, /FROM matter_user_access access/);
  assert.match(lawyers, /access\.case_id = \$1[\s\S]*c\.firm_id = \$2/);
  assert.match(lawyers, /u\.account_type = 'lawyer'[\s\S]*u\.platform_access_status = 'approved'/);
  assert.match(lawyers, /SELECT DISTINCT u\.name, u\.email/);
  assert.ok(revision.indexOf("await db.createPortalClientRevision") < revision.indexOf("notifyMatterLawyers"));
  assert.match(revision, /Client Revision for [^\n]*documentTitle/);
  assert.ok(response.indexOf("await db.createPortalResponse") < response.indexOf('runBestEffortEmail("client request response"'));
  assert.match(response, /getCollaborationRequestType/);
  assert.match(response, /submitted a \$\{type\} response to the \$\{requestType/);
});

test("notification failures are caught outside successful collaboration actions", async () => {
  const server = await readFile("server.ts", "utf8");
  const wrapper = server.slice(
    server.indexOf("function runBestEffortEmail"),
    server.indexOf("async function sendPlainNotification")
  );

  assert.match(wrapper, /void Promise\.resolve\(\)[\s\S]*\.then\(notification\)[\s\S]*\.catch/);
  assert.match(wrapper, /console\.error/);
  assert.doesNotMatch(wrapper, /throw error/);
});
