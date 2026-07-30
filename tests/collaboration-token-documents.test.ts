import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatClientDocumentEvidence,
  retrieveClientDocumentPassages,
} from "../server/clientDocumentRetrieval.js";

test("lawyer token UI displays and copies only the generated opaque token", async () => {
  const [server, view] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/MatterCollaboration.tsx", "utf8"),
  ]);
  assert.match(server, /"\/api\/cases\/:caseId\/collaboration\/token"/);
  assert.match(server, /createCollaborationToken\(\)/);
  assert.match(server, /return res\.json\(\{ access, token \}\)/);
  assert.doesNotMatch(server, /invitePath:|\/client\/\$\{encodeURIComponent\(token\)/);
  assert.match(view, />\s*Collaboration token\s*</);
  assert.match(view, /navigator\.clipboard\.writeText\(collaborationToken\)/);
  assert.match(view, /> Copy token/);
  assert.doesNotMatch(view, /location\.origin|Copy Invite Link|Collaboration link/);
});

test("client redemption is token-only, trim-safe, immediate, and never navigates", async () => {
  const view = await readFile("src/components/ClientSharedMattersView.tsx", "utf8");
  const claim = view.slice(view.indexOf("const claim ="), view.indexOf("return ("));
  assert.match(claim, /const submittedToken = token\.trim\(\)/);
  assert.match(claim, /"\/api\/client\/shared-matters\/redeem"/);
  assert.match(claim, /JSON\.stringify\(\{ token: submittedToken \}\)/);
  assert.match(claim, /setMatters\(\(current\) =>/);
  assert.match(claim, /setAdding\(false\)/);
  assert.doesNotMatch(claim, /window\.location|new URL|onOpenMatter/);
  assert.match(view, /disabled=\{!token\.trim\(\) \|\| claiming\}/);
});

test("redemption transaction locks the invitation, derives the client, and cannot copy Matter data", async () => {
  const [database, server] = await Promise.all([
    readFile("server/db.ts", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  const claim = database.slice(
    database.indexOf("public async claimClientCollaboration"),
    database.indexOf("public async getClientSharedMatters")
  );
  assert.match(claim, /await client\.query\("BEGIN"\)/);
  assert.match(claim, /FOR UPDATE OF ca/);
  assert.match(claim, /account_type !== "client"/);
  assert.match(claim, /claimed_by_user_id !== clientUserId/);
  assert.match(claim, /WHERE id = \$2 AND claimed_by_user_id IS NULL/);
  assert.match(claim, /await client\.query\("COMMIT"\)/);
  assert.doesNotMatch(claim, /clientEmail|authenticatedEmail|ca\.client_email/);
  assert.doesNotMatch(claim, /INSERT INTO cases|INSERT INTO drafts|INSERT INTO documents/);
  assert.match(
    server,
    /claimClientCollaboration\(\s*hashSessionToken\(token\),\s*req\.auth!\.user\.id\s*\)/
  );
});

test("explicit revocation detaches the client while active token rotation preserves the claim", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const activation = database.slice(
    database.indexOf("public async activateClientInvite"),
    database.indexOf("public async revokeClientInvite")
  );
  const revocation = database.slice(
    database.indexOf("public async revokeClientInvite"),
    database.indexOf("public async createCollaborationRequest")
  );
  const collaboratorSave = database.slice(
    database.indexOf("public async saveClientCollaborator"),
    database.indexOf("public async activateClientInvite")
  );
  assert.match(activation, /SET token_hash = \$1, invitation_status = 'Active'/);
  assert.doesNotMatch(activation, /claimed_by_user_id\s*=\s*NULL/);
  assert.match(
    revocation,
    /token_hash = NULL, invitation_status = 'Revoked',[\s\S]*claimed_by_user_id = NULL/
  );
  assert.doesNotMatch(collaboratorSave, /claimed_by_user_id\s*=/);
});

test("first claim, same-client retry, and other-client rejection remain explicit", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const claim = database.slice(
    database.indexOf("public async claimClientCollaboration"),
    database.indexOf("public async getClientSharedMatters")
  );
  assert.match(
    claim,
    /access\.claimed_by_user_id && access\.claimed_by_user_id !== clientUserId/
  );
  assert.match(claim, /if \(!access\.claimed_by_user_id\)/);
  assert.match(claim, /SET claimed_by_user_id = \$1/);
  assert.match(claim, /return \{\s*id: access\.id/);
});

test("client document allow-list is session-derived and rechecks active sharing for every message", async () => {
  const [database, server] = await Promise.all([
    readFile("server/db.ts", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  const authorization = database.slice(
    database.indexOf("public async getClientAssistantDocuments"),
    database.indexOf("public async resolveClientSharedMatter")
  );
  assert.match(authorization, /ca\.claimed_by_user_id = \$1/);
  assert.match(authorization, /ca\.invitation_status = 'Active'/);
  assert.match(authorization, /ca\.revoked_at IS NULL/);
  assert.match(authorization, /ca\.token_hash IS NOT NULL/);
  assert.match(authorization, /d\.shared_with_client = TRUE OR EXISTS/);
  assert.match(authorization, /d\.id = ANY\(\$2::text\[\]\)/);
  assert.match(authorization, /rows\.length !== documentIds\.length/);
  assert.doesNotMatch(authorization, /clientUserId.*req\.body|c\.description|extracted_text/);

  const route = server.slice(
    server.indexOf('"/api/client/assistant/messages"'),
    server.indexOf("const requireClaimedPortalToken")
  );
  assert.match(route, /getAuthorizedClientAssistantDocuments\(\s*req\.auth!\.user\.id/);
  assert.match(route, /One or more selected documents are no longer available/);
  assert.match(route, /documentIds = parseClientAssistantDocumentIds\(req\.body\.documentIds\)/);
});

test("selected-document retrieval includes relevant authorized evidence and omits unrelated passages", () => {
  const passages = retrieveClientDocumentPassages(
    "What payment obligations apply after delivery?",
    [
      {
        id: "draft_allowed",
        title: "Services Agreement",
        matter_name: "Contract Review",
        content:
          "Delivery occurs on acceptance.\n\nPayment is due within thirty days after delivery. Late balances accrue interest.",
      },
      {
        id: "draft_other",
        title: "Unrelated Schedule",
        matter_name: "Contract Review",
        content: "The office address is listed in the signature block.",
      },
    ]
  );
  assert.ok(passages.length > 0);
  assert.ok(passages.every((passage) => passage.documentId === "draft_allowed"));
  const evidence = formatClientDocumentEvidence(passages);
  assert.match(evidence, /Document: Services Agreement/);
  assert.match(evidence, /Payment is due within thirty days/);
  assert.doesNotMatch(evidence, /draft_allowed|draft_other/);
});

test("missing selected-document evidence produces the explicit insufficient-information path", async () => {
  const passages = retrieveClientDocumentPassages("What is the tax indemnity cap?", [
    {
      id: "draft_allowed",
      title: "Delivery Note",
      matter_name: "Contract Review",
      content: "The package was delivered on Tuesday.",
    },
  ]);
  assert.deepEqual(passages, []);
  const server = await readFile("server.ts", "utf8");
  assert.match(
    server,
    /selected documents do not contain enough information to answer that question/
  );
});
