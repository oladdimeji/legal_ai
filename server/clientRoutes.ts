import { createHash, randomBytes } from "node:crypto";
import type { Application, NextFunction, Request, Response } from "express";
import { Packer } from "docx";
import {
  SESSION_TTL_MS,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  parseCookie,
  verifyPassword,
} from "./auth.js";
import type { OwnershipContext } from "./db.js";
import type { ServerConfig } from "./config.js";
import {
  CLIENT_SESSION_COOKIE_NAME,
  CLIENT_SESSION_TTL_MS,
  ProgressiveRateLimiter,
  clearClientSessionCookie,
  clientSessionCookie,
  createOriginGuard,
  csrfCookie,
  metadataHash,
  newCsrfToken,
  requestFingerprint,
  requireClientCsrf,
  safeClientError,
  validContent,
  validEmail,
  validId,
  validName,
  validPassword,
} from "./clientSecurity.js";
import type { ClientSessionAccount } from "./clientRepository.js";
import { ClientRepository } from "./clientRepository.js";
import type { TransactionalEmailSender } from "./transactionalEmail.js";
import { markdownToDocxDocument } from "./docxMarkdown.js";

interface AuthenticatedClientRequest extends Request {
  clientAuth?: ClientSessionAccount;
  clientSessionTokenHash?: string;
}

const invitationLimiter = new ProgressiveRateLimiter(8);
const loginLimiter = new ProgressiveRateLimiter(10);
const verificationLimiter = new ProgressiveRateLimiter(10);
const resetLimiter = new ProgressiveRateLimiter(8);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function rawToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token) };
}

function noStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
}

function rateLimited(res: Response, retryAfterSeconds: number) {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  return res.status(429).json({ error: "Too many attempts. Try again later." });
}

async function emailLawyerActivity(
  repository: ClientRepository,
  email: TransactionalEmailSender,
  config: ServerConfig,
  input: {
    clientUserId: string;
    caseId: string;
    subject: string;
    heading: string;
    message: string;
  },
): Promise<void> {
  if (!config.features.transactionalEmail) return;
  const recipients = await repository.getMatterLawyerEmailRecipients(
    input.clientUserId,
    input.caseId,
  );
  await Promise.all(recipients.map((recipient) => email.send({
    clientUserId: input.clientUserId,
    toEmail: recipient.email,
    toName: recipient.name,
    templateKey: "client_notification",
    values: {
      recipientName: recipient.name,
      subject: input.subject,
      heading: input.heading,
      message: input.message,
      actionUrl: `${config.appBaseUrl}/app/matters/${encodeURIComponent(input.caseId)}`,
    },
  })));
}

async function issueClientSession(
  repository: ClientRepository,
  clientUserId: string,
  req: Request,
  res: Response,
  production: boolean,
): Promise<void> {
  const { token, tokenHash } = createSessionToken();
  await repository.createSession({
    clientUserId,
    tokenHash,
    expiresAt: new Date(Date.now() + CLIENT_SESSION_TTL_MS).toISOString(),
    userAgentHash: metadataHash(req.headers["user-agent"]),
    ipHash: metadataHash(req.ip || req.socket.remoteAddress),
  });
  res.setHeader("Set-Cookie", clientSessionCookie(token, production));
  noStore(res);
}

export function registerPublicClientRoutes(
  app: Application,
  input: {
    config: ServerConfig;
    repository: ClientRepository;
    email: TransactionalEmailSender;
  },
): void {
  const { config, repository, email } = input;
  const enabled = () => config.features.clientAccounts;
  const production = config.environment === "production";
  const originGuard = createOriginGuard(config.appBaseUrl || "http://localhost:3000");

  app.get("/api/security/csrf", (_req, res) => {
    const token = newCsrfToken();
    res.setHeader("Set-Cookie", csrfCookie(token, production));
    noStore(res);
    return res.json({ token });
  });

  app.get("/api/client/invitations/:token", async (req, res) => {
    if (!enabled()) return res.status(404).json({ error: "Client accounts are not enabled." });
    const invitation = await repository.getInvitation(sha256(req.params.token));
    noStore(res);
    if (!invitation || invitation.status !== "pending") {
      return res.status(410).json({ error: "This invitation is unavailable or expired." });
    }
    return res.json({
      clientName: invitation.client_name,
      email: invitation.email,
      matterName: invitation.matter_name,
      firmName: invitation.firm_name,
      expiresAt: invitation.expires_at,
    });
  });

  app.post(
    "/api/client/invitations/:token/accept",
    originGuard,
    requireClientCsrf,
    async (req, res) => {
      if (!enabled()) return res.status(404).json({ error: "Client accounts are not enabled." });
      const key = requestFingerprint(req, req.params.token);
      const limit = await invitationLimiter.before(key);
      if (!limit.allowed) return rateLimited(res, limit.retryAfterSeconds);
      try {
        const tokenHash = sha256(req.params.token);
        const invitation = await repository.getInvitation(tokenHash);
        if (!invitation || invitation.status !== "pending") {
          invitationLimiter.fail(key);
          return res.status(410).json({ error: "This invitation is unavailable or expired." });
        }
        const password = validPassword(req.body?.password);
        const requestedName = validName(req.body?.name);
        if (!password) {
          invitationLimiter.fail(key);
          return res.status(400).json({ error: "Use a password of 12 to 200 characters." });
        }
        const existing = await repository.getClientCredential(invitation.normalized_email);
        if (existing && !(await verifyPassword(password, existing.password_hash || ""))) {
          invitationLimiter.fail(key);
          return res.status(401).json({ error: "Invitation activation could not be completed." });
        }
        if (!existing && !requestedName) {
          invitationLimiter.fail(key);
          return res.status(400).json({ error: "Name is required." });
        }
        const verification = rawToken();
        const previewVerification = !config.features.transactionalEmail
          && config.clientInternalPreviewLinks;
        const accepted = await repository.acceptInvitation({
          tokenHash,
          name: requestedName || existing?.name || invitation.client_name,
          passwordHash: existing ? null : await hashPassword(password),
          existingClientUserId: existing?.id || null,
          verificationTokenHash: previewVerification || existing ? null : verification.tokenHash,
          verificationExpiresAt: previewVerification || existing
            ? null : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          markEmailVerified: previewVerification,
        });
        invitationLimiter.succeed(key);
        let verificationRequired = !accepted.emailVerified;
        let delivery: "sent" | "failed" | "skipped" = "skipped";
        if (verificationRequired && config.features.transactionalEmail) {
          const actionUrl = `${config.appBaseUrl}/client/verify/${encodeURIComponent(verification.token)}`;
          const sent = await email.send({
            firmId: accepted.firmId,
            clientUserId: accepted.clientUserId,
            toEmail: accepted.email,
            toName: accepted.name,
            templateKey: "email_verification",
            values: { recipientName: accepted.name, actionUrl },
          });
          delivery = sent.status;
        }
        if (!verificationRequired) {
          await issueClientSession(repository, accepted.clientUserId, req, res, production);
        } else {
          noStore(res);
        }
        await emailLawyerActivity(repository, email, config, {
          clientUserId: accepted.clientUserId,
          caseId: accepted.caseId,
          subject: "A client accepted an Exepts invitation",
          heading: "Client invitation accepted",
          message: `${accepted.name} activated access to the invited Matter.`,
        });
        return res.status(201).json({
          activated: true,
          verificationRequired,
          delivery,
          dashboardAvailable: !verificationRequired && config.features.clientDashboard,
        });
      } catch (error) {
        invitationLimiter.fail(key);
        safeClientError(error instanceof Error && /expired|unavailable/.test(error.message)
          ? "invitation_unavailable" : "invitation_accept_failed");
        return res.status(400).json({ error: "Invitation activation could not be completed." });
      }
    },
  );

  app.post("/api/client/verify/:token", originGuard, requireClientCsrf, async (req, res) => {
    if (!enabled()) return res.status(404).json({ error: "Client accounts are not enabled." });
    const key = requestFingerprint(req, req.params.token);
    const limit = await verificationLimiter.before(key);
    if (!limit.allowed) return rateLimited(res, limit.retryAfterSeconds);
    const verified = await repository.verifyEmail(sha256(req.params.token));
    if (!verified) {
      verificationLimiter.fail(key);
      return res.status(410).json({ error: "This verification link is unavailable or expired." });
    }
    verificationLimiter.succeed(key);
    await issueClientSession(repository, verified.clientUserId, req, res, production);
    return res.json({ verified: true });
  });

  app.post(
    "/api/client/verification/request",
    originGuard,
    requireClientCsrf,
    async (req, res) => {
      if (!enabled()) return res.status(404).json({ error: "Client accounts are not enabled." });
      const emailAddress = validEmail(req.body?.email) || "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const key = requestFingerprint(req, emailAddress);
      const limit = await verificationLimiter.before(key);
      if (!limit.allowed) return rateLimited(res, limit.retryAfterSeconds);
      const credential = emailAddress ? await repository.getClientCredential(emailAddress) : null;
      const valid = credential && password
        ? await verifyPassword(password, credential.password_hash || "") : false;
      if (
        credential
        && valid
        && credential.status === "active"
        && !credential.email_verified_at
        && config.features.transactionalEmail
      ) {
        const verification = rawToken();
        await repository.createEmailVerification(
          credential.id,
          verification.tokenHash,
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        );
        await email.send({
          clientUserId: credential.id,
          toEmail: credential.email,
          toName: credential.name,
          templateKey: "email_verification",
          values: {
            recipientName: credential.name,
            actionUrl: `${config.appBaseUrl}/client/verify/${encodeURIComponent(verification.token)}`,
          },
        });
      }
      verificationLimiter.succeed(key);
      noStore(res);
      return res.json({
        message: "If verification is available, a new one-time link will be sent.",
      });
    },
  );

  app.post("/api/client/login", originGuard, requireClientCsrf, async (req, res) => {
    if (!enabled()) return res.status(404).json({ error: "Client accounts are not enabled." });
    const emailAddress = validEmail(req.body?.email) || "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const key = requestFingerprint(req, emailAddress);
    const limit = await loginLimiter.before(key);
    if (!limit.allowed) return rateLimited(res, limit.retryAfterSeconds);
    const credential = emailAddress ? await repository.getClientCredential(emailAddress) : null;
    const valid = credential && password
      ? await verifyPassword(password, credential.password_hash || "") : false;
    if (
      !credential
      || !valid
      || credential.status !== "active"
      || !credential.email_verified_at
    ) {
      loginLimiter.fail(key);
      return res.status(401).json({ error: "Invalid email or password." });
    }
    loginLimiter.succeed(key);
    await issueClientSession(repository, credential.id, req, res, production);
    return res.json({
      client: { id: credential.id, name: credential.name, email: credential.email },
      dashboardAvailable: config.features.clientDashboard,
    });
  });

  app.post(
    "/api/client/password-reset/request",
    originGuard,
    requireClientCsrf,
    async (req, res) => {
      if (!enabled()) return res.status(404).json({ error: "Client accounts are not enabled." });
      const emailAddress = validEmail(req.body?.email) || "";
      const key = requestFingerprint(req, emailAddress);
      const limit = await resetLimiter.before(key);
      if (!limit.allowed) return rateLimited(res, limit.retryAfterSeconds);
      const credential = emailAddress ? await repository.getClientCredential(emailAddress) : null;
      if (
        credential
        && credential.status === "active"
        && credential.email_verified_at
        && config.features.transactionalEmail
      ) {
        const reset = rawToken();
        await repository.createPasswordReset(
          credential.id,
          reset.tokenHash,
          new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        );
        await email.send({
          clientUserId: credential.id,
          toEmail: credential.email,
          toName: credential.name,
          templateKey: "password_reset",
          values: {
            recipientName: credential.name,
            actionUrl: `${config.appBaseUrl}/client/reset-password/${encodeURIComponent(reset.token)}`,
          },
        });
      }
      resetLimiter.succeed(key);
      noStore(res);
      return res.json({
        message: "If an eligible account exists, password-reset instructions will be sent.",
      });
    },
  );

  app.post(
    "/api/client/password-reset/:token",
    originGuard,
    requireClientCsrf,
    async (req, res) => {
      if (!enabled()) return res.status(404).json({ error: "Client accounts are not enabled." });
      const key = requestFingerprint(req, req.params.token);
      const limit = await resetLimiter.before(key);
      if (!limit.allowed) return rateLimited(res, limit.retryAfterSeconds);
      const password = validPassword(req.body?.password);
      if (!password) return res.status(400).json({ error: "Use a password of 12 to 200 characters." });
      const reset = await repository.resetPassword(
        sha256(req.params.token),
        await hashPassword(password),
      );
      if (!reset) {
        resetLimiter.fail(key);
        return res.status(410).json({ error: "This reset link is unavailable or expired." });
      }
      if (config.features.transactionalEmail) {
        await email.send({
          clientUserId: reset.clientUserId,
          toEmail: reset.email,
          toName: reset.name,
          templateKey: "account_security_notice",
          values: {
            recipientName: reset.name,
            subject: "Your Exepts client password was changed",
            heading: "Password changed",
            message: "Your password was reset and existing client sessions were revoked.",
            actionUrl: `${config.appBaseUrl}/client/login`,
          },
        });
      }
      resetLimiter.succeed(key);
      noStore(res);
      return res.json({ reset: true });
    },
  );

  const requireClientAuth = async (
    req: AuthenticatedClientRequest,
    res: Response,
    next: NextFunction,
  ) => {
    const token = parseCookie(req.headers.cookie, CLIENT_SESSION_COOKIE_NAME);
    const tokenHash = token ? hashSessionToken(token) : "";
    const account = tokenHash ? await repository.getSessionAccount(tokenHash) : null;
    if (!account) {
      noStore(res);
      return res.status(401).json({ error: "Client authentication required." });
    }
    req.clientAuth = account;
    req.clientSessionTokenHash = tokenHash;
    return next();
  };

  app.get("/api/client/me", requireClientAuth, (req: AuthenticatedClientRequest, res) => {
    noStore(res);
    return res.json(req.clientAuth);
  });

  app.post(
    "/api/client/logout",
    originGuard,
    requireClientCsrf,
    requireClientAuth,
    async (req: AuthenticatedClientRequest, res) => {
      await repository.deleteSession(req.clientSessionTokenHash!);
      res.setHeader("Set-Cookie", clearClientSessionCookie(production));
      noStore(res);
      return res.json({ success: true });
    },
  );

  app.get("/api/client/dashboard", requireClientAuth, async (req: AuthenticatedClientRequest, res) => {
    if (!config.features.clientDashboard) {
      return res.status(404).json({ error: "Client dashboard is not enabled." });
    }
    noStore(res);
    return res.json(await repository.getDashboard(req.clientAuth!.client.id));
  });

  app.get("/api/client/sessions", requireClientAuth, async (req: AuthenticatedClientRequest, res) => {
    noStore(res);
    return res.json(await repository.listSessions(
      req.clientAuth!.client.id,
      req.clientSessionTokenHash!,
    ));
  });

  app.get("/api/client/preferences", requireClientAuth, async (req: AuthenticatedClientRequest, res) => {
    noStore(res);
    return res.json(await repository.getNotificationPreferences(
      "client",
      req.clientAuth!.client.id,
    ));
  });

  app.put(
    "/api/client/preferences",
    originGuard,
    requireClientCsrf,
    requireClientAuth,
    async (req: AuthenticatedClientRequest, res) => {
      if (typeof req.body?.inAppEnabled !== "boolean" || typeof req.body?.emailEnabled !== "boolean") {
        return res.status(400).json({ error: "Invalid notification preferences." });
      }
      return res.json(await repository.setNotificationPreferences(
        "client",
        req.clientAuth!.client.id,
        req.body,
      ));
    },
  );

  app.put(
    "/api/client/notifications/:notificationId/read",
    originGuard,
    requireClientCsrf,
    requireClientAuth,
    async (req: AuthenticatedClientRequest, res) => {
      const notificationId = validId(req.params.notificationId);
      if (!notificationId) return res.status(400).json({ error: "Invalid notification." });
      const changed = await repository.markClientNotificationRead(
        req.clientAuth!.client.id,
        notificationId,
      );
      return changed ? res.json({ read: true })
        : res.status(404).json({ error: "Notification not found." });
    },
  );

  app.put(
    "/api/client/notifications/read-all",
    originGuard,
    requireClientCsrf,
    requireClientAuth,
    async (req: AuthenticatedClientRequest, res) => {
      await repository.markAllClientNotificationsRead(req.clientAuth!.client.id);
      return res.json({ read: true });
    },
  );

  app.get(
    "/api/client/matters/:caseId/documents/:draftId/download",
    requireClientAuth,
    async (req: AuthenticatedClientRequest, res) => {
      const caseId = validId(req.params.caseId);
      const draftId = validId(req.params.draftId);
      if (!caseId || !draftId) return res.status(400).json({ error: "Invalid document." });
      const draft = await repository.getAuthorizedDraft(
        req.clientAuth!.client.id,
        caseId,
        draftId,
      );
      if (!draft) return res.status(404).json({ error: "Shared Work Product not found." });
      const buffer = await Packer.toBuffer(markdownToDocxDocument(draft.title, draft.content));
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${draft.title.replace(/[^a-z0-9]/gi, "_")}.docx"`,
      );
      return res.send(buffer);
    },
  );

  app.delete(
    "/api/client/sessions/:sessionId",
    originGuard,
    requireClientCsrf,
    requireClientAuth,
    async (req: AuthenticatedClientRequest, res) => {
      const sessionId = validId(req.params.sessionId);
      if (!sessionId) return res.status(400).json({ error: "Invalid session." });
      const revoked = await repository.revokeSession(req.clientAuth!.client.id, sessionId);
      if (revoked && config.features.transactionalEmail) {
        await email.send({
          clientUserId: req.clientAuth!.client.id,
          toEmail: req.clientAuth!.client.email,
          toName: req.clientAuth!.client.name,
          templateKey: "account_security_notice",
          values: {
            recipientName: req.clientAuth!.client.name,
            subject: "An Exepts client session was revoked",
            heading: "Session revoked",
            message: "A client-account session was remotely revoked.",
            actionUrl: `${config.appBaseUrl}/client/dashboard`,
          },
        });
      }
      return revoked ? res.json({ revoked: true })
        : res.status(404).json({ error: "Session not found." });
    },
  );

  app.post(
    "/api/client/matters/:caseId/requests/:requestId/responses",
    originGuard,
    requireClientCsrf,
    requireClientAuth,
    async (req: AuthenticatedClientRequest, res) => {
      const caseId = validId(req.params.caseId);
      const requestId = validId(req.params.requestId);
      const content = validContent(req.body?.content);
      if (!caseId || !requestId || !content) {
        return res.status(400).json({ error: "A valid text response is required." });
      }
      try {
        const response = await repository.createResponse({
          clientUserId: req.clientAuth!.client.id,
          caseId,
          requestId,
          content,
        });
        await emailLawyerActivity(repository, email, config, {
          clientUserId: req.clientAuth!.client.id,
          caseId,
          subject: "A client responded in Exepts",
          heading: "New client response",
          message: "A client responded to a lawyer request in an authorized Matter.",
        });
        return res.status(201).json(response);
      } catch {
        return res.status(404).json({ error: "Request not found." });
      }
    },
  );

  app.post(
    "/api/client/matters/:caseId/documents/:draftId/comments",
    originGuard,
    requireClientCsrf,
    requireClientAuth,
    async (req: AuthenticatedClientRequest, res) => {
      const caseId = validId(req.params.caseId);
      const draftId = validId(req.params.draftId);
      const content = validContent(req.body?.content, 5_000);
      if (!caseId || !draftId || !content) {
        return res.status(400).json({ error: "A valid comment is required." });
      }
      try {
        const comment = await repository.createComment({
          clientUserId: req.clientAuth!.client.id,
          caseId,
          draftId,
          content,
        });
        await emailLawyerActivity(repository, email, config, {
          clientUserId: req.clientAuth!.client.id,
          caseId,
          subject: "A client commented in Exepts",
          heading: "New client comment",
          message: "A client left a comment on shared Work Product.",
        });
        return res.status(201).json(comment);
      } catch {
        return res.status(404).json({ error: "Shared Work Product not found." });
      }
    },
  );

  app.post(
    "/api/client/matters/:caseId/documents/:draftId/revisions",
    originGuard,
    requireClientCsrf,
    requireClientAuth,
    async (req: AuthenticatedClientRequest, res) => {
      const caseId = validId(req.params.caseId);
      const draftId = validId(req.params.draftId);
      const content = validContent(req.body?.content, 200_000);
      if (!caseId || !draftId || !content) {
        return res.status(400).json({ error: "Valid revision content is required." });
      }
      try {
        const revision = await repository.createRevision({
          clientUserId: req.clientAuth!.client.id,
          caseId,
          draftId,
          content,
        });
        await emailLawyerActivity(repository, email, config, {
          clientUserId: req.clientAuth!.client.id,
          caseId,
          subject: "A client created a revision in Exepts",
          heading: "New client revision",
          message: "A client created a private revision of shared Work Product.",
        });
        return res.status(201).json(revision);
      } catch {
        return res.status(404).json({ error: "Shared Work Product not found." });
      }
    },
  );
}

export function registerLawyerClientRoutes(
  app: Application,
  input: {
    config: ServerConfig;
    repository: ClientRepository;
    email: TransactionalEmailSender;
    ownership: (req: Request) => OwnershipContext;
  },
): void {
  const { config, repository, email, ownership } = input;
  const originGuard = createOriginGuard(config.appBaseUrl || "http://localhost:3000");

  app.get("/api/cases/:caseId/client-accounts", async (req, res) => {
    if (!config.features.clientAccounts) {
      return res.status(404).json({ error: "Client accounts are not enabled." });
    }
    const caseId = validId(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid Matter." });
    try {
      noStore(res);
      return res.json(await repository.getMatterClientAccess(ownership(req), caseId));
    } catch {
      return res.status(404).json({ error: "Matter not found." });
    }
  });

  app.post(
    "/api/cases/:caseId/client-accounts/invitations",
    originGuard,
    requireClientCsrf,
    async (req, res) => {
      if (!config.features.clientAccounts) {
        return res.status(404).json({ error: "Client accounts are not enabled." });
      }
      const caseId = validId(req.params.caseId);
      const clientName = validName(req.body?.name);
      const emailAddress = validEmail(req.body?.email);
      if (!caseId || !clientName || !emailAddress) {
        return res.status(400).json({ error: "Valid client name and email are required." });
      }
      try {
        const invitationToken = rawToken();
        const invitation = await repository.createInvitation({
          context: ownership(req),
          caseId,
          clientName,
          email: emailAddress,
          tokenHash: invitationToken.tokenHash,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        });
        const invitationUrl = `${config.appBaseUrl}/client/invitations/${encodeURIComponent(invitationToken.token)}`;
        let delivery: "sent" | "failed" | "skipped" = "skipped";
        if (config.features.transactionalEmail) {
          const result = await email.send({
            firmId: ownership(req).firmId,
            toEmail: emailAddress,
            toName: clientName,
            templateKey: "client_invitation",
            values: {
              recipientName: clientName,
              matterName: invitation.matter_name,
              lawyerName: "Your lawyer",
              actionUrl: invitationUrl,
            },
          });
          delivery = result.status;
        }
        noStore(res);
        return res.status(201).json({
          invitation: {
            id: invitation.id,
            email: invitation.email,
            name: invitation.client_name,
            status: invitation.status,
            expiresAt: invitation.expires_at,
          },
          delivery,
          ...(config.clientInternalPreviewLinks && !config.features.transactionalEmail
            ? { invitationUrl } : {}),
        });
      } catch (error) {
        const conflict = error instanceof Error && /pending|unique/i.test(error.message);
        safeClientError(conflict ? "client_invitation_conflict" : "client_invitation_failed");
        return res.status(conflict ? 409 : 400).json({
          error: conflict ? "A pending invitation already exists for this contact."
            : "Client invitation could not be created.",
        });
      }
    },
  );

  app.delete(
    "/api/cases/:caseId/client-accounts/invitations/:invitationId",
    originGuard,
    requireClientCsrf,
    async (req, res) => {
      if (!config.features.clientAccounts) {
        return res.status(404).json({ error: "Client accounts are not enabled." });
      }
      const caseId = validId(req.params.caseId);
      const invitationId = validId(req.params.invitationId);
      if (!caseId || !invitationId) return res.status(400).json({ error: "Invalid invitation." });
      const revoked = await repository.revokeInvitation(ownership(req), caseId, invitationId);
      return revoked ? res.json({ revoked: true })
        : res.status(404).json({ error: "Pending invitation not found." });
    },
  );

  app.put(
    "/api/cases/:caseId/client-accounts/memberships/:membershipId/status",
    originGuard,
    requireClientCsrf,
    async (req, res) => {
      if (!config.features.clientAccounts) {
        return res.status(404).json({ error: "Client accounts are not enabled." });
      }
      const caseId = validId(req.params.caseId);
      const membershipId = validId(req.params.membershipId);
      const status = ["active", "suspended", "removed"].includes(req.body?.status)
        ? req.body.status as "active" | "suspended" | "removed" : null;
      if (!caseId || !membershipId || !status) {
        return res.status(400).json({ error: "Invalid access change." });
      }
      const changed = await repository.setMembershipStatus({
        context: ownership(req),
        caseId,
        membershipId,
        status,
      });
      return changed ? res.json({ status })
        : res.status(404).json({ error: "Client membership not found." });
    },
  );

  app.get("/api/notifications", async (req, res) => {
    if (!config.features.clientNotifications) {
      return res.status(404).json({ error: "Notifications are not enabled." });
    }
    noStore(res);
    return res.json(await repository.listLawyerNotifications(ownership(req)));
  });

  app.get("/api/notifications/preferences", async (req, res) => {
    if (!config.features.clientNotifications) {
      return res.status(404).json({ error: "Notifications are not enabled." });
    }
    noStore(res);
    return res.json(await repository.getNotificationPreferences(
      "lawyer",
      ownership(req).userId,
    ));
  });

  app.put(
    "/api/notifications/preferences",
    originGuard,
    requireClientCsrf,
    async (req, res) => {
      if (!config.features.clientNotifications) {
        return res.status(404).json({ error: "Notifications are not enabled." });
      }
      if (typeof req.body?.inAppEnabled !== "boolean" || typeof req.body?.emailEnabled !== "boolean") {
        return res.status(400).json({ error: "Invalid notification preferences." });
      }
      return res.json(await repository.setNotificationPreferences(
        "lawyer",
        ownership(req).userId,
        req.body,
      ));
    },
  );

  app.put(
    "/api/notifications/:notificationId/read",
    originGuard,
    requireClientCsrf,
    async (req, res) => {
      if (!config.features.clientNotifications) {
        return res.status(404).json({ error: "Notifications are not enabled." });
      }
      const id = validId(req.params.notificationId);
      if (!id) return res.status(400).json({ error: "Invalid notification." });
      const changed = await repository.markLawyerNotificationRead(ownership(req), id);
      return changed ? res.json({ read: true })
        : res.status(404).json({ error: "Notification not found." });
    },
  );

  app.put(
    "/api/notifications/read-all",
    originGuard,
    requireClientCsrf,
    async (req, res) => {
      if (!config.features.clientNotifications) {
        return res.status(404).json({ error: "Notifications are not enabled." });
      }
      await repository.markAllLawyerNotificationsRead(ownership(req));
      return res.json({ read: true });
    },
  );
}
