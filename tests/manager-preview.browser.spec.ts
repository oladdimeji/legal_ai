import { createHash } from "node:crypto";
import http from "node:http";
import path from "node:path";
import express from "express";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { loadServerConfig } from "../server/config.js";
import { registerLawyerClientRoutes, registerPublicClientRoutes } from "../server/clientRoutes.js";
import type { ClientRepository } from "../server/clientRepository.js";
import type {
  TransactionalEmailInput,
  TransactionalEmailResult,
  TransactionalEmailSender,
} from "../server/transactionalEmail.js";

type Matter = { id: string; name: string; firm_name: string };
type Client = {
  id: string;
  name: string;
  email: string;
  normalized_email: string;
  password_hash: string;
  status: "active";
  email_verified_at: string | null;
};

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

class PreviewJourneyRepository {
  readonly matters = new Map<string, Matter>([
    ["matter_alpha", { id: "matter_alpha", name: "Alpha Matter", firm_name: "Preview Firm" }],
    ["matter_beta", { id: "matter_beta", name: "Beta Matter", firm_name: "Preview Firm" }],
  ]);
  readonly invitations = new Map<string, any>();
  readonly clients = new Map<string, Client>();
  readonly memberships: Array<{ id: string; clientUserId: string; caseId: string; status: string }> = [];
  readonly sessions = new Map<string, { id: string; clientUserId: string; revoked: boolean }>();
  readonly verifications = new Map<string, string>();
  readonly resets = new Map<string, { clientUserId: string; expiresAt: number; used: boolean }>();
  readonly notifications: any[] = [];
  readonly responses: any[] = [];
  readonly comments: any[] = [];
  readonly revisions: any[] = [];
  private sequence = 0;

  private id(prefix: string) {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }

  async getMatterLawyerEmailRecipients() {
    return [{ id: "lawyer_preview", name: "Preview Lawyer", email: "lawyer@example.test" }];
  }

  async getMatterClientAccess(_context: unknown, caseId: string) {
    if (!this.matters.has(caseId)) throw new Error("Matter not found");
    return {
      memberships: this.memberships.filter((item) => item.caseId === caseId),
      invitations: [...this.invitations.values()].filter((item) => item.case_id === caseId),
    };
  }

  async createInvitation(input: any) {
    const matter = this.matters.get(input.caseId);
    if (!matter) throw new Error("Matter not found");
    const invitation = {
      id: this.id("invitation"),
      firm_id: "firm_preview",
      case_id: input.caseId,
      email: input.email,
      normalized_email: input.email,
      client_name: input.clientName,
      token_hash: input.tokenHash,
      status: "pending",
      expires_at: input.expiresAt,
      matter_name: matter.name,
      firm_name: "Preview Firm",
    };
    this.invitations.set(input.tokenHash, invitation);
    return invitation;
  }

  async revokeInvitation(_context: unknown, caseId: string, invitationId: string) {
    const invitation = [...this.invitations.values()]
      .find((item) => item.case_id === caseId && item.id === invitationId && item.status === "pending");
    if (!invitation) return false;
    invitation.status = "revoked";
    return true;
  }

  async getInvitation(tokenHash: string) {
    const invitation = this.invitations.get(tokenHash);
    if (!invitation || new Date(invitation.expires_at).getTime() <= Date.now()) return null;
    return invitation;
  }

  async getClientCredential(normalizedEmail: string) {
    return [...this.clients.values()].find((item) => item.normalized_email === normalizedEmail) || null;
  }

  async acceptInvitation(input: any) {
    const invitation = this.invitations.get(input.tokenHash);
    if (!invitation || invitation.status !== "pending") throw new Error("Invitation unavailable");
    let client = input.existingClientUserId ? this.clients.get(input.existingClientUserId) : null;
    if (!client) {
      client = {
        id: this.id("client"),
        name: input.name,
        email: invitation.normalized_email,
        normalized_email: invitation.normalized_email,
        password_hash: input.passwordHash,
        status: "active",
        email_verified_at: input.markEmailVerified ? new Date().toISOString() : null,
      };
      this.clients.set(client.id, client);
    }
    if (input.verificationTokenHash) {
      this.verifications.set(input.verificationTokenHash, client.id);
    }
    const membership = {
      id: this.id("membership"),
      clientUserId: client.id,
      caseId: invitation.case_id,
      status: "active",
    };
    this.memberships.push(membership);
    invitation.status = "accepted";
    this.notifications.push({
      id: this.id("notification"),
      case_id: invitation.case_id,
      title: `${client.name} accepted the Matter invitation`,
      read_at: null,
      deep_link: `/app/matters/${invitation.case_id}`,
    });
    return {
      clientUserId: client.id,
      firmId: "firm_preview",
      caseId: invitation.case_id,
      membershipId: membership.id,
      email: client.email,
      name: client.name,
      matterName: invitation.matter_name,
      emailVerified: Boolean(client.email_verified_at),
    };
  }

  async verifyEmail(tokenHash: string) {
    const clientUserId = this.verifications.get(tokenHash);
    const client = clientUserId ? this.clients.get(clientUserId) : null;
    if (!client) return null;
    client.email_verified_at = new Date().toISOString();
    this.verifications.delete(tokenHash);
    return { clientUserId };
  }

  async createEmailVerification(clientUserId: string, tokenHash: string) {
    this.verifications.set(tokenHash, clientUserId);
  }

  async createSession(input: any) {
    this.sessions.set(input.tokenHash, {
      id: this.id("session"),
      clientUserId: input.clientUserId,
      revoked: false,
    });
  }

  async getSessionAccount(tokenHash: string) {
    const session = this.sessions.get(tokenHash);
    const client = session && !session.revoked ? this.clients.get(session.clientUserId) : null;
    return client?.email_verified_at ? {
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
        status: client.status,
        emailVerified: Boolean(client.email_verified_at),
      },
    } : null;
  }

  async deleteSession(tokenHash: string) {
    const session = this.sessions.get(tokenHash);
    if (session) session.revoked = true;
  }

  async listSessions(clientUserId: string, currentTokenHash: string) {
    return [...this.sessions.entries()]
      .filter(([, session]) => session.clientUserId === clientUserId)
      .map(([hash, session]) => ({
        id: session.id,
        current: hash === currentTokenHash,
        revoked_at: session.revoked ? new Date().toISOString() : null,
      }));
  }

  async revokeSession(clientUserId: string, sessionId: string) {
    const session = [...this.sessions.values()]
      .find((item) => item.clientUserId === clientUserId && item.id === sessionId);
    if (!session) return false;
    session.revoked = true;
    return true;
  }

  async createPasswordReset(clientUserId: string, tokenHash: string, expiresAt: string) {
    this.resets.set(tokenHash, {
      clientUserId,
      expiresAt: new Date(expiresAt).getTime(),
      used: false,
    });
  }

  async resetPassword(tokenHash: string, passwordHash: string) {
    const reset = this.resets.get(tokenHash);
    const client = reset ? this.clients.get(reset.clientUserId) : null;
    if (!reset || !client || reset.used || reset.expiresAt <= Date.now()) return null;
    reset.used = true;
    client.password_hash = passwordHash;
    for (const session of this.sessions.values()) {
      if (session.clientUserId === client.id) session.revoked = true;
    }
    return { clientUserId: client.id, email: client.email, name: client.name };
  }

  async getDashboard(clientUserId: string) {
    const allMemberships = this.memberships.filter((item) => item.clientUserId === clientUserId);
    const memberships = allMemberships.filter((item) => item.status === "active");
    const matters = memberships.map((item) => this.matters.get(item.caseId)!);
    return {
      matters,
      sharedDocuments: matters.map((matter) => ({
        id: `draft_${matter.id}`,
        case_id: matter.id,
        title: `${matter.name} Shared Advice`,
        content: "Lawyer-approved shared content.",
      })),
      requests: matters.map((matter) => ({
        id: `request_${matter.id}`,
        case_id: matter.id,
        request_type: "Review",
        instruction: "Please review and respond.",
        responses: this.responses.filter((item) => item.case_id === matter.id
          && item.client_user_id === clientUserId),
      })),
      comments: this.comments.filter((item) => item.client_user_id === clientUserId),
      activity: this.revisions.filter((item) => item.client_user_id === clientUserId),
      notifications: [],
      accessState: matters.length ? "active"
        : allMemberships.some((item) => item.status === "suspended") ? "suspended"
          : allMemberships.some((item) => item.status === "removed") ? "removed" : "empty",
    };
  }

  private hasAccess(clientUserId: string, caseId: string) {
    return this.memberships.some((item) =>
      item.clientUserId === clientUserId && item.caseId === caseId && item.status === "active");
  }

  async createResponse(input: any) {
    if (!this.hasAccess(input.clientUserId, input.caseId)
      || input.requestId !== `request_${input.caseId}`) throw new Error("Request not found");
    const response = {
      id: this.id("response"),
      case_id: input.caseId,
      client_user_id: input.clientUserId,
      content: input.content,
    };
    this.responses.push(response);
    this.notifications.push({
      id: this.id("notification"),
      case_id: input.caseId,
      title: "A client responded to a request",
      read_at: null,
      deep_link: `/app/matters/${input.caseId}`,
    });
    return response;
  }

  async createComment(input: any) {
    if (!this.hasAccess(input.clientUserId, input.caseId)
      || input.draftId !== `draft_${input.caseId}`) throw new Error("Document not found");
    const comment = { id: this.id("comment"), ...input, client_user_id: input.clientUserId };
    this.comments.push(comment);
    this.notifications.push({
      id: this.id("notification"),
      case_id: input.caseId,
      title: "A client left a comment",
      read_at: null,
      deep_link: `/app/matters/${input.caseId}`,
    });
    return comment;
  }

  async createRevision(input: any) {
    if (!this.hasAccess(input.clientUserId, input.caseId)
      || input.draftId !== `draft_${input.caseId}`) throw new Error("Document not found");
    const revision = { id: this.id("revision"), ...input, client_user_id: input.clientUserId };
    this.revisions.push(revision);
    return revision;
  }

  async getAuthorizedDraft(clientUserId: string, caseId: string, draftId: string) {
    if (!this.hasAccess(clientUserId, caseId) || draftId !== `draft_${caseId}`) return null;
    return { id: draftId, title: "Shared Advice", content: "Lawyer-approved shared content." };
  }

  async listLawyerNotifications() {
    return {
      items: this.notifications,
      unread: this.notifications.filter((item) => !item.read_at).length,
    };
  }

  async markLawyerNotificationRead(_context: unknown, notificationId: string) {
    const item = this.notifications.find((entry) => entry.id === notificationId);
    if (!item) return false;
    item.read_at = new Date().toISOString();
    return true;
  }

  async markAllLawyerNotificationsRead() {
    this.notifications.forEach((item) => { item.read_at = new Date().toISOString(); });
  }

  async markClientNotificationRead() { return false; }
  async markAllClientNotificationsRead() {}
  async getNotificationPreferences() {
    return { in_app_enabled: true, email_enabled: true, security_email_enabled: true };
  }
  async setNotificationPreferences(_kind: string, _id: string, input: any) {
    return {
      in_app_enabled: input.inAppEnabled,
      email_enabled: input.emailEnabled,
      security_email_enabled: true,
    };
  }
  async setMembershipStatus(input: any) {
    const membership = this.memberships.find((item) =>
      item.id === input.membershipId && item.caseId === input.caseId);
    if (!membership) return false;
    membership.status = input.status;
    return true;
  }
}

class CapturingEmail implements TransactionalEmailSender {
  readonly deliveries: TransactionalEmailInput[] = [];

  async send(input: TransactionalEmailInput): Promise<TransactionalEmailResult> {
    this.deliveries.push(input);
    return {
      status: "sent",
      providerMessageId: `mock-message-${this.deliveries.length}`,
      failureCategory: null,
    };
  }

  latestAction(templateKey: TransactionalEmailInput["templateKey"], email: string): string {
    const delivery = [...this.deliveries].reverse()
      .find((item) => item.templateKey === templateKey && item.toEmail === email);
    expect(delivery?.values.actionUrl).toBeTruthy();
    return delivery!.values.actionUrl;
  }
}

async function api<T>(
  page: Page,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: T }> {
  return page.evaluate(async ({ path: requestPath, init: requestInit }) => {
    const csrfResponse = await fetch("/api/security/csrf", { cache: "no-store" });
    const { token } = await csrfResponse.json();
    const response = await fetch(requestPath, {
      method: requestInit.method || "GET",
      headers: {
        ...(requestInit.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(["GET", "HEAD"].includes(requestInit.method || "GET")
          ? {} : { "X-CSRF-Token": token }),
      },
      body: requestInit.body === undefined ? undefined : JSON.stringify(requestInit.body),
      credentials: "same-origin",
    });
    const body = await response.json();
    return { status: response.status, body };
  }, { path, init }) as Promise<{ status: number; body: T }>;
}

async function activateClient(
  context: BrowserContext,
  origin: string,
  invitationUrl: string,
  name: string,
  password: string,
  email: CapturingEmail,
) {
  const page = await context.newPage();
  await page.goto(invitationUrl);
  await expect(page.getByRole("heading", { name: "Activate client access" })).toBeVisible();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Create or confirm password").fill(password);
  await page.getByRole("button", { name: "Activate account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const verificationUrl = email.latestAction(
    "email_verification",
    name === "Client Alpha" ? "alpha@example.test" : "beta@example.test",
  );
  await page.goto(verificationUrl);
  await expect(page).toHaveURL(`${origin}/client/dashboard`);
  await expect(page.getByText("Client dashboard")).toBeVisible();
  return page;
}

test("manager preview lawyer-to-client release journey", async ({ browser }) => {
  const repository = new PreviewJourneyRepository();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "512kb", strict: true }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  expect(address && typeof address === "object").toBeTruthy();
  const origin = `http://127.0.0.1:${(address as any).port}`;
  const config = loadServerConfig({
    NODE_ENV: "test",
    APP_BASE_URL: origin,
    BREVO_API_KEY: "mock-brevo-key",
    BREVO_SENDER_EMAIL: "preview@example.test",
    BREVO_SENDER_NAME: "Exepts Preview",
    BREVO_API_BASE_URL: "https://api.brevo.com/v3",
  });
  const email = new CapturingEmail();
  app.get("/api/config", (_req, res) => res.json({
    integrations: {
      govInfo: { status: "not_configured" },
      google: { status: "not_configured", capabilities: [] },
      transactionalEmail: { status: "configured" },
    },
  }));
  app.get("/api/auth/me", (_req, res) => res.status(401).json({ error: "Authentication required." }));
  registerPublicClientRoutes(app, {
    config,
    repository: repository as unknown as ClientRepository,
    email,
  });

  let lawyerLoggedIn = false;
  app.post("/api/login", (_req, res) => {
    lawyerLoggedIn = true;
    res.json({ user: { id: "lawyer_preview" } });
  });
  app.post("/api/cases", (req, res) => {
    if (!lawyerLoggedIn) return res.status(401).json({ error: "Authentication required" });
    const matter = repository.matters.get(req.body?.id || "matter_alpha");
    return matter ? res.status(201).json(matter) : res.status(404).json({ error: "Matter not found" });
  });
  app.post("/api/google/mock-link", (_req, res) =>
    res.json({ connected: true, scopes: ["openid", "email", "profile", "drive.file"] }));
  app.post("/api/drafts/:id/export/drive", (_req, res) =>
    res.json({ exported: true, providerFileId: "drive_preview_file" }));
  app.get("/api/portal/:token", (req, res) =>
    req.params.token === "legacy_valid"
      ? res.json({ matter: { id: "matter_alpha", name: "Alpha Matter" } })
      : res.status(401).json({ error: "Invalid or expired access link." }));

  registerLawyerClientRoutes(app, {
    config,
    repository: repository as unknown as ClientRepository,
    email,
    ownership: () => ({ userId: "lawyer_preview", firmId: "firm_preview" }),
  });
  const distPath = path.resolve("dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));

  try {
    const lawyerContext = await browser.newContext();
    const lawyerPage = await lawyerContext.newPage();
    await lawyerPage.goto(origin);

    expect((await api(lawyerPage, "/api/login", {
      method: "POST", body: { email: "lawyer@example.test", password: "test-only" },
    })).status).toBe(200);
    expect((await api(lawyerPage, "/api/cases", {
      method: "POST", body: { id: "matter_alpha", name: "Alpha Matter" },
    })).status).toBe(201);
    expect((await api<any>(lawyerPage, "/api/google/mock-link", { method: "POST" })).body.connected)
      .toBe(true);
    expect((await api<any>(lawyerPage, "/api/drafts/draft_matter_alpha/export/drive", {
      method: "POST",
    })).body.exported).toBe(true);

    const invitationA = await api<any>(
      lawyerPage,
      "/api/cases/matter_alpha/client-accounts/invitations",
      { method: "POST", body: { name: "Client Alpha", email: "alpha@example.test" } },
    );
    expect(invitationA.status).toBe(201);
    expect(invitationA.body.invitationUrl).toBeUndefined();
    const invitationAUrl = email.latestAction("client_invitation", "alpha@example.test");

    const clientAContext = await browser.newContext();
    const clientAPage = await activateClient(
      clientAContext,
      origin,
      invitationAUrl,
      "Client Alpha",
      "Alpha password 123!",
      email,
    );
    const firstDashboard = await api<any>(clientAPage, "/api/client/dashboard");
    expect(firstDashboard.body.matters.map((matter: Matter) => matter.id)).toEqual(["matter_alpha"]);
    expect(firstDashboard.body.sharedDocuments[0].content).toBe("Lawyer-approved shared content.");

    await clientAPage.getByRole("button", { name: "Alpha Matter Shared Advice" }).click();
    await expect(clientAPage.getByText("Lawyer-approved shared content.").first()).toBeVisible();
    expect((await api(clientAPage, "/api/client/matters/matter_alpha/documents/draft_matter_alpha/comments", {
      method: "POST", body: { content: "Please clarify paragraph two." },
    })).status).toBe(201);
    expect((await api(clientAPage, "/api/client/matters/matter_alpha/requests/request_matter_alpha/responses", {
      method: "POST", body: { content: "Reviewed and approved." },
    })).status).toBe(201);
    expect((await api(clientAPage, "/api/client/matters/matter_alpha/documents/draft_matter_alpha/revisions", {
      method: "POST", body: { content: "Client revision content." },
    })).status).toBe(201);
    await clientAPage.getByRole("button", { name: "Log out" }).click();
    await expect(clientAPage).toHaveURL(`${origin}/client/login`);
    await clientAPage.getByLabel("Email").fill("alpha@example.test");
    await clientAPage.getByLabel("Password").fill("Alpha password 123!");
    await clientAPage.getByRole("button", { name: "Log in" }).click();
    await expect(clientAPage).toHaveURL(`${origin}/client/dashboard`);
    expect((await api<any>(clientAPage, "/api/client/dashboard")).body.matters[0].id)
      .toBe("matter_alpha");

    const clientASecondContext = await browser.newContext();
    const clientASecondPage = await clientASecondContext.newPage();
    await clientASecondPage.goto(origin);
    expect((await api(clientASecondPage, "/api/client/login", {
      method: "POST", body: { email: "alpha@example.test", password: "Alpha password 123!" },
    })).status).toBe(200);
    const secondSessions = await api<any[]>(clientASecondPage, "/api/client/sessions");
    const remoteSession = secondSessions.body.find((session) => session.current);
    expect(remoteSession).toBeTruthy();
    expect((await api(clientAPage, `/api/client/sessions/${remoteSession.id}`, {
      method: "DELETE",
    })).status).toBe(200);
    expect((await api(clientASecondPage, "/api/client/me")).status).toBe(401);

    expect((await api(clientAPage, "/api/client/password-reset/request", {
      method: "POST", body: { email: "alpha@example.test" },
    })).status).toBe(200);
    const resetUrl = email.latestAction("password_reset", "alpha@example.test");
    const resetToken = new URL(resetUrl).pathname.split("/").at(-1)!;
    expect((await api(clientAPage, `/api/client/password-reset/${resetToken}`, {
      method: "POST", body: { password: "New Alpha password 456!" },
    })).status).toBe(200);
    expect((await api(clientAPage, `/api/client/password-reset/${resetToken}`, {
      method: "POST", body: { password: "Replay password 789!" },
    })).status).toBe(410);
    expect((await api(clientAPage, "/api/client/login", {
      method: "POST", body: { email: "alpha@example.test", password: "New Alpha password 456!" },
    })).status).toBe(200);

    expect((await api(clientAPage, "/api/client/password-reset/request", {
      method: "POST", body: { email: "alpha@example.test" },
    })).status).toBe(200);
    const expiredResetUrl = email.latestAction("password_reset", "alpha@example.test");
    const expiredResetToken = new URL(expiredResetUrl).pathname.split("/").at(-1)!;
    repository.resets.get(sha256(expiredResetToken))!.expiresAt = 0;
    expect((await api(clientAPage, `/api/client/password-reset/${expiredResetToken}`, {
      method: "POST", body: { password: "Expired password 789!" },
    })).status).toBe(410);

    const actualAlphaMembership = repository.memberships.find((item) =>
      item.caseId === "matter_alpha" && repository.clients.get(item.clientUserId)?.email === "alpha@example.test");
    expect(actualAlphaMembership).toBeTruthy();
    expect((await api(lawyerPage,
      `/api/cases/matter_alpha/client-accounts/memberships/${actualAlphaMembership!.id}/status`,
      { method: "PUT", body: { status: "suspended" } },
    )).status).toBe(200);
    expect((await api<any>(clientAPage, "/api/client/dashboard")).body.accessState).toBe("suspended");
    expect((await api(lawyerPage,
      `/api/cases/matter_alpha/client-accounts/memberships/${actualAlphaMembership!.id}/status`,
      { method: "PUT", body: { status: "active" } },
    )).status).toBe(200);

    const invitationB = await api<any>(
      lawyerPage,
      "/api/cases/matter_beta/client-accounts/invitations",
      { method: "POST", body: { name: "Client Beta", email: "beta@example.test" } },
    );
    const clientBContext = await browser.newContext();
    const clientBPage = await activateClient(
      clientBContext,
      origin,
      email.latestAction("client_invitation", "beta@example.test"),
      "Client Beta",
      "Beta password 123!",
      email,
    );
    expect((await api<any>(clientBPage, "/api/client/dashboard")).body.matters.map(
      (matter: Matter) => matter.id,
    )).toEqual(["matter_beta"]);
    expect((await api(clientBPage, "/api/client/matters/matter_alpha/requests/request_matter_alpha/responses", {
      method: "POST", body: { content: "Direct-ID attack." },
    })).status).toBe(404);

    expect((await api(lawyerPage,
      `/api/cases/matter_alpha/client-accounts/memberships/${actualAlphaMembership!.id}/status`,
      { method: "PUT", body: { status: "removed" } },
    )).status).toBe(200);
    expect((await api<any>(clientAPage, "/api/client/dashboard")).body.accessState).toBe("removed");

    const lawyerNotifications = await api<any>(lawyerPage, "/api/notifications");
    expect(lawyerNotifications.body.unread).toBeGreaterThanOrEqual(3);
    expect(lawyerNotifications.body.items.some(
      (item: any) => item.title === "A client responded to a request",
    )).toBe(true);

    expect((await api(lawyerPage, "/api/portal/legacy_valid")).status).toBe(200);
    expect((await api(lawyerPage, "/api/portal/legacy_invalid")).status).toBe(401);
    expect((await api(lawyerPage, `/api/client/invitations/${new URL(invitationAUrl).pathname.split("/").at(-1)}`)).status)
      .toBe(410);

    await Promise.all([
      clientAContext.close(),
      clientASecondContext.close(),
      clientBContext.close(),
      lawyerContext.close(),
    ]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
});
