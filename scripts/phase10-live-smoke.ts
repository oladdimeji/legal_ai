import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../server/db.js";

const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const marker = `phase10-${Date.now()}-${randomUUID().slice(0, 8)}`;
const password = `Smoke-${randomBytes(18).toString("base64url")}!9a`;

type Session = { cookie: string; user: { id: string }; firm: { id: string } };

async function request(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json") ? await response.json() : await response.arrayBuffer();
  return { response, body };
}

async function signup(label: string): Promise<Session> {
  const email = `${marker}-${label}@example.test`;
  const result = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name: `Phase 10 ${label}`, email, password }),
  });
  assert.equal(result.response.status, 201);
  const cookie = (result.response.headers.get("set-cookie") || "").split(";", 1)[0];
  assert.ok(cookie);
  const account = result.body as Session;
  const duplicate = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name: "Duplicate", email: email.toUpperCase(), password }),
  });
  assert.equal(duplicate.response.status, 409);
  for (const path of ["/api/cases", "/api/documents?caseId=null", "/api/threads?history=true"]) {
    const empty = await request(path, {}, cookie);
    assert.equal(empty.response.status, 200);
    assert.deepEqual(empty.body, []);
  }
  return { cookie, user: account.user, firm: account.firm };
}

async function createMatter(session: Session, suffix: string) {
  const result = await request("/api/cases", {
    method: "POST",
    body: JSON.stringify({
      name: `${marker} Matter ${suffix}`,
      description: `Isolated assignment ${suffix}`,
      startingNote: `${marker}-matter-${suffix}-source deterministic content`,
    }),
  }, session.cookie);
  assert.equal(result.response.status, 201);
  return result.body as { id: string };
}

async function main() {
  const a = await signup("a");
  const b = await signup("b");
  const [a1, a2, b1, b2] = await Promise.all([
    createMatter(a, "A1"), createMatter(a, "A2"), createMatter(b, "B1"), createMatter(b, "B2"),
  ]);

  const library = await request("/api/documents", {
    method: "POST",
    body: JSON.stringify({ title: `${marker} Firm Library`, text: `${marker}-firm-library-only deterministic clause` }),
  }, a.cookie);
  assert.equal(library.response.status, 201);
  const libraryId = (library.body as { id: string }).id;
  const linked = await request(`/api/cases/${a1.id}/sources`, {
    method: "POST", body: JSON.stringify({ libraryDocumentId: libraryId }),
  }, a.cookie);
  assert.equal(linked.response.status, 201);

  const a1Sources = await request(`/api/cases/${a1.id}/sources`, {}, a.cookie);
  const a2Sources = await request(`/api/cases/${a2.id}/sources`, {}, a.cookie);
  assert.ok((a1Sources.body as any[]).some((item) => item.id === libraryId));
  assert.ok(!(a2Sources.body as any[]).some((item) => item.id === libraryId));
  const directA1 = (a1Sources.body as any[]).find((item) => item.case_id === a1.id);
  const directA2 = (a2Sources.body as any[]).find((item) => item.case_id === a2.id);
  assert.ok(directA1 && directA2);

  const general = await request("/api/search", {
    method: "POST", body: JSON.stringify({ query: `${marker}-firm-library-only`, scope: "wide" }),
  }, a.cookie);
  assert.equal(general.response.status, 200);
  assert.ok((general.body as any[]).some((item) => item.document_id === libraryId));
  assert.ok(!(general.body as any[]).some((item) => item.document_id === directA1.id));
  const matterA = await request("/api/search", {
    method: "POST", body: JSON.stringify({ query: `${marker} deterministic`, scope: a1.id }),
  }, a.cookie);
  assert.ok((matterA.body as any[]).some((item) => item.document_id === libraryId));
  assert.ok((matterA.body as any[]).some((item) => item.document_id === directA1.id));
  assert.ok(!(matterA.body as any[]).some((item) => item.document_id === directA2.id));
  const foreignSearch = await request("/api/search", {
    method: "POST", body: JSON.stringify({ query: marker, scope: a1.id }),
  }, b.cookie);
  assert.deepEqual(foreignSearch.body, []);

  const generalThread = await request("/api/threads", {
    method: "POST", body: JSON.stringify({ title: `${marker} General`, caseId: null }),
  }, a.cookie);
  const retainedMatterThread = await request("/api/threads", {
    method: "POST", body: JSON.stringify({ title: `${marker} Matter A2`, caseId: a2.id }),
  }, a.cookie);
  assert.equal(generalThread.response.status, 201);
  assert.equal(retainedMatterThread.response.status, 201);
  const generalThreads = await request("/api/threads?caseId=null", {}, a.cookie);
  const matterThreads = await request(`/api/threads?caseId=${a2.id}`, {}, a.cookie);
  assert.ok((generalThreads.body as any[]).some((item) => item.id === (generalThread.body as any).id && item.case_id === null));
  assert.ok((matterThreads.body as any[]).some((item) => item.id === (retainedMatterThread.body as any).id && item.case_id === a2.id));
  assert.ok(!(matterThreads.body as any[]).some((item) => item.id === (generalThread.body as any).id));

  const threadResult = await request("/api/threads", {
    method: "POST", body: JSON.stringify({ title: `${marker} survival`, caseId: a1.id }),
  }, a.cookie);
  const thread = threadResult.body as { id: string };
  await db.addMessage(thread.id, "user", `${marker} work product facts`, { userId: a.user.id, firmId: a.firm.id });
  const draft = await db.createDraft(thread.id, a1.id, `${marker} Work Product`, "Preserved lawyer original", { userId: a.user.id, firmId: a.firm.id });
  const privateDraft = await db.createManualDraft(a1.id, `${marker} Private Work Product`, "Private lawyer content", { userId: a.user.id, firmId: a.firm.id });
  assert.equal((await request(`/api/cases/${a1.id}/sources`, {}, a.cookie)).body.length, (a1Sources.body as any[]).length);

  const foreignChecks = await Promise.all([
    request(`/api/cases/${a1.id}`, {}, b.cookie),
    request(`/api/documents/${directA1.id}?caseId=${a1.id}`, { method: "DELETE" }, b.cookie),
    request(`/api/threads/${thread.id}/messages`, {}, b.cookie),
    request(`/api/messages/unknown?threadId=${thread.id}`, { method: "PUT", body: JSON.stringify({ content: "foreign" }) }, b.cookie),
    request(`/api/drafts/${draft.id}?caseId=${a1.id}`, {}, b.cookie),
    request(`/api/drafts/${draft.id}?caseId=${a1.id}`, { method: "PUT", body: JSON.stringify({ content: "foreign" }) }, b.cookie),
    request(`/api/drafts/${draft.id}/export?caseId=${a1.id}`, {}, b.cookie),
  ]);
  foreignChecks.forEach(({ response }) => assert.ok([403, 404].includes(response.status)));
  assert.equal((await request(`/api/cases/${a1.id}`, {}, a.cookie)).response.status, 200);
  assert.equal((await request(`/api/documents/${directA1.id}?caseId=${a1.id}`, { method: "DELETE" }, b.cookie)).response.status, 404);

  const deleted = await request(`/api/threads/${thread.id}`, { method: "DELETE" }, a.cookie);
  assert.equal(deleted.response.status, 200);
  const surviving = await request(`/api/drafts/${draft.id}?caseId=${a1.id}`, {}, a.cookie);
  assert.equal(surviving.response.status, 200);
  assert.equal((surviving.body as any).thread_id, null);

  const shared = await request(`/api/drafts/${draft.id}/sharing?caseId=${a1.id}`, {
    method: "PUT", body: JSON.stringify({ shared: true }),
  }, a.cookie);
  assert.equal(shared.response.status, 200);
  const collaborator = await request(`/api/cases/${a1.id}/collaboration/client`, {
    method: "PUT", body: JSON.stringify({ name: "Smoke Client", email: `${marker}-client@example.test` }),
  }, a.cookie);
  assert.equal(collaborator.response.status, 200);
  const invitation = await request(`/api/cases/${a1.id}/collaboration/invite`, { method: "POST" }, a.cookie);
  assert.equal(invitation.response.status, 200);
  const invitePath = (invitation.body as { invitePath: string }).invitePath;
  const token = decodeURIComponent(invitePath.split("/").pop() || "");
  const portal = await request(`/api/portal/${encodeURIComponent(token)}`);
  assert.equal(portal.response.status, 200);
  assert.ok((portal.body as any).shared.some((item: any) => item.id === draft.id));
  assert.ok(!(portal.body as any).shared.some((item: any) => item.id === privateDraft.id));
  assert.equal((await request(`/api/portal/${encodeURIComponent(token)}/work-product/${privateDraft.id}`)).response.status, 404);
  const revision = await request(`/api/portal/${encodeURIComponent(token)}/work-product/${draft.id}/edit-copy`, {
    method: "POST", body: JSON.stringify({ content: "Client revision content" }),
  });
  assert.equal(revision.response.status, 201);
  assert.equal((revision.body as any).parent_draft_id, draft.id);
  assert.equal((revision.body as any).revision_type, "Client Revision");
  assert.equal((await request(`/api/drafts/${draft.id}?caseId=${a1.id}`, {}, a.cookie)).body.content, "Preserved lawyer original");
  const rejectedAssistant = await request(`/api/portal/${encodeURIComponent(token)}/assistant`, {
    method: "POST",
    body: JSON.stringify({ query: "What does the selected document say?", draftIds: [draft.id, privateDraft.id], documentIds: [] }),
  });
  assert.equal(rejectedAssistant.response.status, 404);
  const clientAssistant = await request(`/api/portal/${encodeURIComponent(token)}/assistant`, {
    method: "POST",
    body: JSON.stringify({ query: "What does the selected document say?", draftIds: [draft.id], documentIds: [] }),
  });
  assert.equal(clientAssistant.response.status, 200);
  assert.deepEqual((clientAssistant.body as any).sources.map((source: any) => source.id), [draft.id]);

  const intelligence = await request(`/api/cases/${a1.id}/intelligence/generate`, { method: "POST" }, a.cookie);
  assert.equal(intelligence.response.status, 201);
  assert.equal((intelligence.body as any).case_id, a1.id);
  assert.equal((await request(`/api/cases/${a1.id}/intelligence`, {}, b.cookie)).response.status, 404);
  await request(`/api/cases/${a1.id}/collaboration/revoke`, { method: "POST" }, a.cookie);
  assert.equal((await request(`/api/portal/${encodeURIComponent(token)}`)).response.status, 404);

  const logout = await request("/api/auth/logout", { method: "POST" }, b.cookie);
  assert.equal(logout.response.status, 200);
  assert.equal((await request("/api/auth/me", {}, b.cookie)).response.status, 401);
  const badLogin = await request("/api/auth/login", {
    method: "POST", body: JSON.stringify({ email: `${marker}-b@example.test`, password: "incorrect" }),
  });
  assert.equal(badLogin.response.status, 401);

  console.log(JSON.stringify({
    signupIsolation: true,
    twoUsers: true,
    twoMattersPerWorkspace: true,
    firmLibraryClassification: true,
    generalMatterRetrievalIsolation: true,
    historyContextIsolation: true,
    directIdIsolation: true,
    workProductSurvival: true,
    clientRevisionCopy: true,
    matterIntelligenceIsolation: true,
    clientAssistantAllowList: true,
    invitationRevocation: true,
    logoutInvalidation: true,
    retainedFixtures: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(`Phase 10 live smoke failed: ${error instanceof Error ? error.stack : "unknown error"}`);
  process.exitCode = 1;
});
