import express from "express";
import type { NextFunction, Request, Response } from "express";
import path from "path";
import multer from "multer";
import { OAuth2Client } from "google-auth-library";
import { createServer as createViteServer } from "vite";
import { db } from "./server/db.js";
import type { OwnershipContext } from "./server/db.js";
import { callModel, MODEL_CONFIGS } from "./server/model.js";
import {
  Account,
  Document,
  Citation,
  Message,
  Draft,
  ProfessionalRole,
  ResearchStep,
  WorkspaceType,
} from "./src/types.js";
import { Packer } from "docx";
import { extractUploads, MAX_FILE_COUNT, MAX_FILE_SIZE_BYTES } from "./server/fileExtraction.js";
import { markdownToDocxDocument } from "./server/docxMarkdown.js";
import { cleanMatterIntelligenceContent } from "./server/matterIntelligenceContent.js";
import { cleanClientAssistantContent, cleanGeneratedBoilerplate } from "./server/generatedContentCleanup.js";
import { tryGenerateConversationTitle } from "./server/conversationTitle.js";
import {
  formatClientDocumentEvidence,
  retrieveClientDocumentPassages,
} from "./server/clientDocumentRetrieval.js";
import { extractGeneratedSubject, extractSummaryHeading } from "./server/extractGeneratedSubject.js";
import { getWorkProductFormatInstructions, isWorkProductFormat } from "./server/workProductFormat.js";
import { canonicalizeAssistantCitations, rewriteGoogleGroundingCitations, stripInternalCitationsForWorkProduct } from "./src/lib/assistantCitations.js";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  OAUTH_STATE_COOKIE_NAME,
  OTP_TTL_MS,
  clearSessionCookie,
  clearOAuthStateCookie,
  createCollaborationToken,
  createOAuthState,
  createOtpHash,
  createSessionToken,
  generateOtp,
  hashSessionToken,
  isValidEmail,
  normalizeAccountType,
  normalizeEmail,
  oauthAccountTypeFromCookie,
  oauthStateCookie,
  parseCollaborationToken,
  parseCookie,
  safeInternalPath,
  sessionCookie,
  validateOAuthState,
} from "./server/auth.js";
import {
  SITE_LOCK_DENIED_MESSAGE,
  canAccessPrivateApplication,
  isProtectedApplicationPath,
  isSiteLocked,
  publicSiteLockStatus,
  readSiteLockPolicy,
} from "./server/siteLock.js";

const isProduction = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 3000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SIMILARITY_THRESHOLD = 0.65;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_FILE_COUNT },
});

interface AuthenticatedRequest extends Request {
  auth?: Account;
}

function ownership(req: Request): OwnershipContext {
  const auth = (req as AuthenticatedRequest).auth;
  if (
    auth?.user.account_type !== "lawyer" ||
    !auth.user.onboarding_completed ||
    !auth.firm ||
    auth.user.firm_id !== auth.firm.id
  ) {
    throw new Error("Completed workspace authentication is required.");
  }
  return { userId: auth.user.id, firmId: auth.firm.id };
}

const PROFESSIONAL_ROLES: ProfessionalRole[] = [
  "Lawyer",
  "Paralegal",
  "Legal Assistant",
  "Legal Operations",
  "Other",
];
const PRACTICE_AREAS = [
  "Litigation",
  "Corporate and Commercial",
  "Real Estate",
  "Employment",
  "Family Law",
  "Criminal Law",
  "Intellectual Property",
  "Tax",
  "Regulatory and Compliance",
  "Other",
] as const;

function normalizeInvitationCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function redirectUrl(req: Request, pathname: string): string {
  const configured = process.env.APP_URL?.trim();
  const base = configured || `${req.protocol}://${req.get("host")}`;
  return new URL(pathname, base.endsWith("/") ? base : `${base}/`).toString();
}

async function sendOtpEmail(email: string, code: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "Exepts";
  if (!apiKey || !senderEmail) throw new Error("EMAIL_AUTH_NOT_CONFIGURED");
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email }],
      subject: "Your Exepts verification code",
      textContent: `Your verification code is: ${code}\n\nThis code expires in 10 minutes.`,
      htmlContent: `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 10 minutes.</p>`,
    }),
  });
  if (!response.ok) throw new Error(`BREVO_DELIVERY_FAILED_${response.status}`);
}

function requestedCaseId(value: unknown): string | null {
  return typeof value === "string" && value !== "null" && value ? value : null;
}

function parseStringArray(value: unknown): string[] {
  const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
  return Array.isArray(parsed)
    ? Array.from(new Set(parsed.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())))
    : [];
}

function documentBatchResponse(documents: Document[]) {
  return documents.length === 1 ? { ...documents[0], documents } : { documents };
}

function ownedErrorStatus(error: unknown): number {
  return error instanceof Error && /not found/i.test(error.message) ? 404 : 500;
}

function cleanSourceText(text: string): string {
  return text.replace(/\[cit_\d+\]/g, "");
}

function cleanGeneratedText(content: string): string {
  return cleanGeneratedBoilerplate(content);
}

function cleanWorkProductContent(content: string): string {
  return stripInternalCitationsForWorkProduct(cleanGeneratedBoilerplate(content));
}

function cleanGeneratedWorkProductContent(content: string): string {
  return stripInternalCitationsForWorkProduct(cleanGeneratedBoilerplate(content), { stripNumberedMarkers: true });
}

function cleanPortalSummary(summary: any) {
  const cleanDraft = (draft: any) => draft?.content ? { ...draft, content: cleanWorkProductContent(draft.content) } : draft;
  return {
    ...summary,
    shared: (summary.shared || []).map(cleanDraft),
    revisions: (summary.revisions || []).map(cleanDraft),
    chatMessages: (summary.chatMessages || []).map((message: any) =>
      message.role === "assistant" ? { ...message, content: cleanClientAssistantContent(message.content) } : message
    ),
  };
}

function parsePortalDraftIds(value: unknown): string[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value || "[]");
    } catch {
      throw new Error("Selected Work Product payload is malformed");
    }
  }
  if (parsed == null || parsed === "") return [];
  if (!Array.isArray(parsed)) throw new Error("Selected Work Product payload is malformed");
  const ids = parsed.map((id) => {
    if (typeof id !== "string") throw new Error("Selected Work Product payload is malformed");
    return id.trim();
  }).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error("Select each Work Product only once");
  return ids;
}

function parseClientAssistantDocumentIds(value: unknown): string[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 8) return null;
  const ids: string[] = [];
  for (const valueId of value) {
    if (
      typeof valueId !== "string" ||
      !valueId ||
      valueId.length > 200 ||
      valueId.trim() !== valueId
    ) {
      return null;
    }
    ids.push(valueId);
  }
  return new Set(ids).size === ids.length ? ids : null;
}

function portalResponseErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/exceeds|at most|too large/i.test(message)) return 413;
  if (/malformed|invalid client response type|required|select at least|unsupported|could not be read|empty|extractable text|mime type/i.test(message)) return 400;
  if (/not found|unavailable|not available/i.test(message)) return 404;
  return 500;
}

function temporaryAttachmentMetadata(files: Array<{ filename: string; text: string }>) {
  const seen = new Set<string>();
  const attachments = files
    .map((file) => file.filename.trim().slice(0, 180))
    .filter((name) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map((name) => ({ name }));
  return attachments.length ? { attachments } : {};
}

function sanitizePlainEditableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*|```/gi, ""))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .trim();
}

function boundedConversation(messages: Message[], maxChars = 12000): Message[] {
  const selected: Message[] = [];
  let used = 0;
  for (const message of [...messages].reverse()) {
    const content = message.content.slice(0, 2500);
    if (used + content.length > maxChars && selected.length >= 4) break;
    selected.unshift({ ...message, content });
    used += content.length;
  }
  return selected;
}

async function generateFollowUpSuggestions(history: Message[], answer: string): Promise<string[]> {
  try {
    const context = boundedConversation(history, 6000)
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n\n");
    const prompt = `Generate 3 or 4 concise follow-up questions for a lawyer based on this actual conversation and latest answer.
Return strict JSON: {"suggestions":["..."]}. Do not use generic canned questions.

CONVERSATION:
${context}

LATEST ANSWER:
${answer.slice(0, 5000)}`;
    const result = await callModel("classify-complexity", [{ role: "user", content: prompt }], {
      responseMimeType: "application/json",
      temperature: 0.2,
    });
    const parsed = JSON.parse(result.text);
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    return suggestions
      .filter((item: unknown): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4);
  } catch (error) {
    console.error("Follow-up suggestion generation failed:", error);
    return [];
  }
}

async function suggestMatterOverview(input: {
  name: string;
  description: string;
  startingContent: string;
}): Promise<Partial<{
  client_name: string;
  matter_type: string;
  jurisdiction: string;
  preliminary_objectives: string;
}>> {
  try {
    const prompt = `Suggest Matter Overview fields from only the supplied Matter name, assignment, and starting content.
Return strict JSON with any clearly supported fields only: {"client_name":"","matter_type":"","jurisdiction":"","preliminary_objectives":""}.
Omit or use empty strings for absent/unclear values. Do not fabricate.

MATTER NAME: ${input.name}
ASSIGNMENT: ${input.description}
STARTING CONTENT:
${input.startingContent.slice(0, 20000)}`;
    const result = await callModel("classify-complexity", [{ role: "user", content: prompt }], {
      responseMimeType: "application/json",
      temperature: 0.1,
    });
    const parsed = JSON.parse(result.text);
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === "string" && value.trim())
    ) as any;
  } catch (error) {
    console.error("Matter Overview suggestion failed:", error);
    return {};
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());
  const siteLockPolicy = readSiteLockPolicy(process.env);
  const denySiteLockAccess = (res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    return res.status(403).json({ error: SITE_LOCK_DENIED_MESSAGE });
  };

  // Migrations and legacy ownership validation must succeed before any route is served.
  try {
    await db.initialize();
    await db.seedDemoDataIfEnabled();
    await db.migrateLegacyOwner();
    await db.migrateLegacyDrafts();
  } catch (err) {
    console.error("Database initialization or explicit demo seeding failed:", err);
    throw err;
  }

  // --- API ROUTES ---

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.get("/api/site-status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.json(publicSiteLockStatus(siteLockPolicy));
  });

  app.post(["/api/auth/signup", "/api/auth/login"], (_req, res) => {
    if (isSiteLocked(siteLockPolicy)) return denySiteLockAccess(res);
    res.setHeader("Cache-Control", "no-store");
    return res.status(410).json({ error: "Password authentication is no longer available." });
  });

  app.get("/api/auth/google", (req, res) => {
    if (isSiteLocked(siteLockPolicy) && siteLockPolicy.allowedEmails.size === 0) {
      return denySiteLockAccess(res);
    }
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(503).json({ error: "Google authentication is not configured." });
    }
    const { state, cookieValue } = createOAuthState(
      req.query.returnTo,
      normalizeAccountType(req.query.accountType)
    );
    const client = new OAuth2Client(clientId, clientSecret, redirectUri);
    const url = client.generateAuthUrl({
      access_type: "online",
      scope: ["openid", "email", "profile"],
      state,
      prompt: "select_account",
    });
    res.setHeader("Set-Cookie", oauthStateCookie(cookieValue, isProduction));
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(url);
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const stateCookie = parseCookie(req.headers.cookie, OAUTH_STATE_COOKIE_NAME);
    const stateResult = validateOAuthState(req.query.state, stateCookie);
    const requestedAccountType = oauthAccountTypeFromCookie(stateCookie);
    const fail = (message: string) => {
      res.setHeader("Set-Cookie", clearOAuthStateCookie(isProduction));
      const retry = new URLSearchParams({ authError: message });
      if (stateResult.valid) {
        retry.set("returnTo", stateResult.returnTo);
        if (requestedAccountType === "client") retry.set("mode", "client");
      }
      return res.redirect(redirectUrl(req, `/auth?${retry.toString()}`));
    };
    if (!stateResult.valid) return fail("The sign-in request expired or was invalid. Please try again.");
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
    if (!code || !clientId || !clientSecret || !redirectUri) {
      return fail("Google sign-in could not be completed.");
    }
    try {
      const client = new OAuth2Client(clientId, clientSecret, redirectUri);
      const { tokens } = await client.getToken(code);
      if (!tokens.id_token) return fail("Google sign-in did not provide a verified identity.");
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      const payload = ticket.getPayload();
      const validIssuer =
        payload?.iss === "accounts.google.com" || payload?.iss === "https://accounts.google.com";
      if (
        !payload?.sub ||
        !payload.email ||
        payload.email_verified !== true ||
        payload.aud !== clientId ||
        !validIssuer
      ) {
        return fail("Google could not verify this email address.");
      }
      const email = normalizeEmail(payload.email);
      if (!canAccessPrivateApplication(email, siteLockPolicy)) {
        return fail(SITE_LOCK_DENIED_MESSAGE);
      }
      const { account } = await db.authenticateGoogle({
        sub: payload.sub,
        email,
        name: typeof payload.name === "string" ? payload.name.trim() || null : null,
        accountType: requestedAccountType,
      });
      const { token, tokenHash } = createSessionToken();
      await db.createSession(
        account.user.id,
        tokenHash,
        new Date(Date.now() + SESSION_TTL_MS).toISOString()
      );
      const destination =
        account.user.account_type === "client"
          ? safeInternalPath(stateResult.returnTo, "/client/assistant")
          : account.user.onboarding_completed
            ? safeInternalPath(stateResult.returnTo)
            : "/onboarding";
      res.setHeader("Set-Cookie", [
        sessionCookie(token, isProduction),
        clearOAuthStateCookie(isProduction),
      ]);
      res.setHeader("Cache-Control", "no-store");
      return res.redirect(redirectUrl(req, destination));
    } catch (error) {
      if (error instanceof Error && error.message === "GOOGLE_ACCOUNT_CONFLICT") {
        return fail("This Google account cannot be linked to the requested Exepts account.");
      }
      console.error("Google authentication failed.");
      return fail("Google sign-in could not be completed. Please try again.");
    }
  });

  app.post("/api/auth/email/request-code", async (req, res) => {
    const email = normalizeEmail(typeof req.body.email === "string" ? req.body.email : "");
    const accountType = normalizeAccountType(req.body.accountType);
    if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (!canAccessPrivateApplication(email, siteLockPolicy)) return denySiteLockAccess(res);
    try {
      const code = generateOtp();
      const { salt, hash } = createOtpHash(code);
      const issue = await db.issueEmailOtp({
        email,
        otpHash: hash,
        otpSalt: salt,
        expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
        accountType,
      });
      if (!issue.allowed) {
        res.setHeader("Retry-After", String(issue.retryAfterSeconds));
        return res.status(429).json({
          error: "Please wait before requesting another code.",
          retryAfterSeconds: issue.retryAfterSeconds,
        });
      }
      try {
        await sendOtpEmail(email, code);
      } catch (error) {
        console.error("Verification email delivery failed.");
        return res.status(502).json({ error: "Unable to send a verification code right now." });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        success: true,
        message: "If the address can receive email, a verification code has been sent.",
        retryAfterSeconds: issue.retryAfterSeconds,
      });
    } catch (error) {
      console.error("Email verification request failed.");
      return res.status(500).json({ error: "Unable to request a verification code." });
    }
  });

  app.post("/api/auth/email/verify-code", async (req, res) => {
    const email = normalizeEmail(typeof req.body.email === "string" ? req.body.email : "");
    const code = typeof req.body.code === "string" ? req.body.code.trim() : "";
    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Enter a valid email and six-digit code." });
    }
    if (!canAccessPrivateApplication(email, siteLockPolicy)) return denySiteLockAccess(res);
    try {
      const result = await db.consumeEmailOtp(email, code);
      if (result.status !== "verified") {
        const messages = {
          invalid: "The verification code is invalid.",
          expired: "The verification code has expired. Request a new code.",
          attempts_exceeded: "Too many attempts. Request a new code.",
        };
        return res.status(400).json({ error: messages[result.status] });
      }
      const { account } = await db.authenticateEmail(email, result.accountType);
      const { token, tokenHash } = createSessionToken();
      await db.createSession(
        account.user.id,
        tokenHash,
        new Date(Date.now() + SESSION_TTL_MS).toISOString()
      );
      res.setHeader("Set-Cookie", sessionCookie(token, isProduction));
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        account,
        redirectTo:
          account.user.account_type === "client"
            ? safeInternalPath(req.body.returnTo, "/client/assistant")
            : account.user.onboarding_completed
              ? safeInternalPath(req.body.returnTo)
              : "/onboarding",
      });
    } catch (error) {
      console.error("Email verification failed.");
      return res.status(500).json({ error: "Unable to verify the code." });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    const token = parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    if (token) await db.deleteSession(hashSessionToken(token));
    res.setHeader("Set-Cookie", clearSessionCookie(isProduction));
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true });
  });

  const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);
      const account = token ? await db.getSessionAccount(hashSessionToken(token)) : null;
      if (!account) {
        res.setHeader("Cache-Control", "no-store");
        return res.status(401).json({ error: "Authentication required." });
      }
      if (!canAccessPrivateApplication(account.user.email, siteLockPolicy)) {
        return denySiteLockAccess(res);
      }
      req.auth = account;
      return next();
    } catch (err) {
      console.error("Session validation failed:", err);
      return res.status(500).json({ error: "Unable to validate the session." });
    }
  };

  const requireLawyerAccount = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    if (req.auth?.user.account_type !== "lawyer") {
      return res.status(403).json({ error: "Lawyer account access is required." });
    }
    return next();
  };

  const requireClientAccount = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    if (req.auth?.user.account_type !== "client") {
      return res.status(403).json({ error: "Client account access is required." });
    }
    return next();
  };

  app.get("/api/auth/me", requireAuth, (req: AuthenticatedRequest, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.json(req.auth);
  });

  // Compatibility marker for the established onboarding route: app.post("/api/onboarding/complete"
  app.post(
    "/api/onboarding/complete",
    requireAuth,
    requireLawyerAccount,
    async (req: AuthenticatedRequest, res) => {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const professionalRole = req.body.professionalRole as ProfessionalRole;
    const customProfessionalRole =
      typeof req.body.customProfessionalRole === "string"
        ? req.body.customProfessionalRole.trim()
        : "";
    const workspaceType = req.body.workspaceType as WorkspaceType;
    const invitationCode = normalizeInvitationCode(req.body.invitationCode);
    const rawPracticeAreas: unknown[] = Array.isArray(req.body.practiceAreas)
      ? req.body.practiceAreas
      : [];
    const practiceAreas: string[] = Array.from(
      new Set(
        rawPracticeAreas.filter(
          (area): area is string =>
            typeof area === "string" &&
            PRACTICE_AREAS.includes(area as (typeof PRACTICE_AREAS)[number])
        )
      )
    );
    const customPracticeArea =
      typeof req.body.customPracticeArea === "string"
        ? req.body.customPracticeArea.trim()
        : "";
    if (!name || name.length > 120) {
      return res.status(400).json({ error: "Full name is required." });
    }
    if (!PROFESSIONAL_ROLES.includes(professionalRole)) {
      return res.status(400).json({ error: "Select a professional role." });
    }
    if (professionalRole === "Other" && !customProfessionalRole) {
      return res.status(400).json({ error: "Enter your professional role." });
    }
    if (customProfessionalRole.length > 80) {
      return res.status(400).json({ error: "Professional role must be 80 characters or fewer." });
    }
    if (!["firm", "independent"].includes(workspaceType)) {
      return res.status(400).json({ error: "Select how you will use Exepts." });
    }
    if (workspaceType === "firm" && !invitationCode) {
      return res.status(400).json({ error: "Enter a Firm invitation code." });
    }
    if (invitationCode.length > 100) {
      return res.status(400).json({ error: "Firm invitation code is too long." });
    }
    if (rawPracticeAreas.length !== practiceAreas.length) {
      return res.status(400).json({ error: "One or more practice areas are invalid." });
    }
    if (practiceAreas.includes("Other") && !customPracticeArea) {
      return res.status(400).json({ error: "Enter the other practice area." });
    }
    if (customPracticeArea.length > 80) {
      return res.status(400).json({ error: "Practice area must be 80 characters or fewer." });
    }
    try {
      const account = await db.completeOnboarding({
        userId: req.auth!.user.id,
        name,
        professionalRole,
        customProfessionalRole: professionalRole === "Other" ? customProfessionalRole : null,
        workspaceType,
        invitationCode: workspaceType === "firm" ? invitationCode : null,
        practiceAreas,
        customPracticeArea: practiceAreas.includes("Other") ? customPracticeArea : null,
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ account, redirectTo: "/matters" });
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_INVITATION_CODE") {
        return res.status(400).json({ error: "That Firm invitation code is invalid." });
      }
      console.error("Onboarding completion failed.");
      return res.status(500).json({ error: "Unable to complete onboarding." });
    }
    }
  );

  const portalTokenHash = (token: string) => hashSessionToken(decodeURIComponent(token));

  const clientCollaborationError =
    "This collaboration token is invalid, unavailable, or already connected to another account.";

  app.post(
    "/api/client/shared-matters/redeem",
    requireAuth,
    requireClientAccount,
    async (req: AuthenticatedRequest, res) => {
      const token = parseCollaborationToken(req.body?.token);
      if (!token) return res.status(400).json({ error: clientCollaborationError });
      try {
        const claimed = await db.claimClientCollaboration(
          hashSessionToken(token),
          req.auth!.user.id
        );
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json(claimed);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "CLIENT_COLLABORATION_UNAVAILABLE"
        ) {
          return res.status(404).json({ error: clientCollaborationError });
        }
        console.error("Collaboration token redemption failed.");
        return res.status(500).json({
          error: "The Shared Matter could not be added right now.",
        });
      }
    }
  );

  app.get(
    "/api/client/shared-matters",
    requireAuth,
    requireClientAccount,
    async (req: AuthenticatedRequest, res) => {
      res.setHeader("Cache-Control", "no-store");
      return res.json(await db.getClientSharedMatters(req.auth!.user.id));
    }
  );

  app.get(
    "/api/client/shared-matters/:accessId",
    requireAuth,
    requireClientAccount,
    async (req: AuthenticatedRequest, res) => {
      const summary = await db.getClientSharedMatterSummary(
        req.params.accessId,
        req.auth!.user.id
      );
      res.setHeader("Cache-Control", "no-store");
      if (!summary) return res.status(404).json({ error: "Shared Matter not found." });
      const { chatMessages: _portalChatMessages, ...clientSummary } =
        cleanPortalSummary(summary);
      return res.json(clientSummary);
    }
  );

  app.get(
    "/api/client/shared-matters/:accessId/work-products/:draftId",
    requireAuth,
    requireClientAccount,
    async (req: AuthenticatedRequest, res) => {
      const draft = await db.getClientPermittedDraft(
        req.params.accessId,
        req.params.draftId,
        req.auth!.user.id
      );
      res.setHeader("Cache-Control", "no-store");
      if (!draft) return res.status(404).json({ error: "Shared document not found." });
      return res.json({ ...draft, content: cleanWorkProductContent(draft.content) });
    }
  );

  app.get(
    "/api/client/shared-matters/:accessId/work-products/:draftId/download",
    requireAuth,
    requireClientAccount,
    async (req: AuthenticatedRequest, res) => {
      const draft = await db.getClientPermittedDraft(
        req.params.accessId,
        req.params.draftId,
        req.auth!.user.id
      );
      if (!draft) return res.status(404).json({ error: "Shared document not found." });
      const buffer = await Packer.toBuffer(
        markdownToDocxDocument(draft.title, cleanWorkProductContent(draft.content))
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${draft.title.replace(/[^a-z0-9]/gi, "_")}.docx"`
      );
      return res.send(buffer);
    }
  );

  app.post(
    "/api/client/shared-matters/:accessId/work-products/:draftId/comments",
    requireAuth,
    requireClientAccount,
    async (req: AuthenticatedRequest, res) => {
      const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
      if (!content) return res.status(400).json({ error: "Comment is required." });
      const access = await db.resolveClientSharedMatter(
        req.params.accessId,
        req.auth!.user.id
      );
      const draft = access
        ? await db.getClientPermittedDraft(
            req.params.accessId,
            req.params.draftId,
            req.auth!.user.id
          )
        : null;
      if (!access || !draft) {
        return res.status(404).json({ error: "Shared document not found." });
      }
      try {
        return res.status(201).json(
          await db.addPortalComment(access.token_hash, req.params.draftId, content)
        );
      } catch {
        return res.status(404).json({ error: "Shared document not found." });
      }
    }
  );

  app.post(
    "/api/client/shared-matters/:accessId/work-products/:draftId/edit-copy",
    requireAuth,
    requireClientAccount,
    async (req: AuthenticatedRequest, res) => {
      const content =
        typeof req.body.content === "string"
          ? cleanWorkProductContent(req.body.content)
          : "";
      const access = await db.resolveClientSharedMatter(
        req.params.accessId,
        req.auth!.user.id
      );
      if (!access) return res.status(404).json({ error: "Shared document not found." });
      try {
        return res.status(201).json(
          await db.createPortalClientRevision(
            access.token_hash,
            req.params.draftId,
            content
          )
        );
      } catch {
        return res.status(404).json({ error: "Shared document not found." });
      }
    }
  );

  app.post(
    "/api/client/shared-matters/:accessId/documents",
    requireAuth,
    requireClientAccount,
    upload.array("files", MAX_FILE_COUNT),
    async (req: AuthenticatedRequest, res) => {
      const access = await db.resolveClientSharedMatter(
        req.params.accessId,
        req.auth!.user.id
      );
      if (!access) return res.status(404).json({ error: "Shared Matter not found." });
      try {
        const extracted = await extractUploads((req.files || []) as Express.Multer.File[]);
        if (extracted.length === 0) {
          return res.status(400).json({
            error: "Upload at least one PDF, DOCX, or TXT file.",
          });
        }
        const documents = [];
        for (const file of extracted) {
          documents.push(
            await db.uploadPortalDocument(access.token_hash, file.filename, file.text)
          );
        }
        return res.status(201).json({ documents });
      } catch (error) {
        const status = portalResponseErrorStatus(error);
        return res.status(status).json({
          error:
            status === 404
              ? "Shared Matter not found."
              : error instanceof Error
                ? error.message
                : "Files could not be uploaded.",
        });
      }
    }
  );

  app.post(
    "/api/client/shared-matters/:accessId/requests/:requestId/responses",
    requireAuth,
    requireClientAccount,
    upload.array("files", MAX_FILE_COUNT),
    async (req: AuthenticatedRequest, res) => {
      const allowed = new Set([
        "Acknowledgement",
        "Comment",
        "Upload files",
        "Shared files",
      ]);
      const type = typeof req.body.type === "string" ? req.body.type : "";
      if (!allowed.has(type)) {
        return res.status(400).json({ error: "Invalid client response type." });
      }
      const access = await db.resolveClientSharedMatter(
        req.params.accessId,
        req.auth!.user.id
      );
      if (
        !access ||
        !(await db.validatePortalRequest(access.token_hash, req.params.requestId))
      ) {
        return res.status(404).json({ error: "Client request not found." });
      }
      try {
        const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
        if (type === "Comment" && !content) {
          return res.status(400).json({ error: "Comment text is required." });
        }
        const draftIds = parsePortalDraftIds(req.body.draftIds);
        if (type !== "Shared files" && draftIds.length > 0) {
          return res.status(400).json({
            error: "Shared Work Product can only be attached to a Shared files response.",
          });
        }
        if (type === "Shared files" && draftIds.length === 0) {
          return res.status(400).json({ error: "Select at least one shared Work Product." });
        }
        for (const draftId of draftIds) {
          if (
            !(await db.getClientPermittedDraft(
              req.params.accessId,
              draftId,
              req.auth!.user.id
            ))
          ) {
            return res.status(404).json({
              error: "Selected Work Product is not available.",
            });
          }
        }
        let uploadedFiles: Array<{ filename: string; text: string }> = [];
        if (type === "Upload files") {
          const extracted = await extractUploads(
            (req.files || []) as Express.Multer.File[]
          );
          if (extracted.length === 0) {
            return res.status(400).json({ error: "Select at least one file to upload." });
          }
          uploadedFiles = extracted.map((file) => ({
            filename: file.filename,
            text: cleanWorkProductContent(file.text),
          }));
        } else if (((req.files || []) as Express.Multer.File[]).length > 0) {
          return res.status(400).json({
            error: "Files can only be attached to an Upload files response.",
          });
        }
        return res.status(201).json(
          await db.createPortalResponse(
            access.token_hash,
            req.params.requestId,
            type,
            content || null,
            uploadedFiles,
            type === "Shared files" ? draftIds : []
          )
        );
      } catch (error) {
        const status = portalResponseErrorStatus(error);
        if (status === 500) console.error("Client response creation failed.");
        return res.status(status).json({
          error:
            status === 404
              ? "Client request not found."
              : error instanceof Error
                ? error.message
                : "Response could not be sent.",
        });
      }
    }
  );

  app.get(
    "/api/client/assistant/conversations",
    requireAuth,
    requireClientAccount,
    async (req: AuthenticatedRequest, res) => {
      res.setHeader("Cache-Control", "no-store");
      return res.json(await db.getClientConversations(req.auth!.user.id));
    }
  );

  app.get(
    "/api/client/assistant/documents",
    requireAuth,
    requireClientAccount,
    async (req: AuthenticatedRequest, res) => {
      try {
        res.setHeader("Cache-Control", "no-store");
        return res.json(await db.getClientAssistantDocuments(req.auth!.user.id));
      } catch {
        console.error("Client Assistant document list failed.");
        return res.status(500).json({
          error: "Shared documents could not be loaded right now.",
        });
      }
    }
  );

  app.post(
    "/api/client/assistant/conversations",
    requireAuth,
    requireClientAccount,
    async (req: AuthenticatedRequest, res) => {
      res.setHeader("Cache-Control", "no-store");
      return res
        .status(201)
        .json(await db.createClientConversation(req.auth!.user.id));
    }
  );

  app.get(
    "/api/client/assistant/conversations/:threadId/messages",
    requireAuth,
    requireClientAccount,
    async (req: AuthenticatedRequest, res) => {
      const thread = await db.getClientConversation(
        req.params.threadId,
        req.auth!.user.id
      );
      res.setHeader("Cache-Control", "no-store");
      if (!thread) return res.status(404).json({ error: "Conversation not found." });
      return res.json(
        await db.getClientMessages(req.params.threadId, req.auth!.user.id)
      );
    }
  );

  app.delete(
    "/api/client/assistant/conversations/:threadId",
    requireAuth,
    requireClientAccount,
    async (req: AuthenticatedRequest, res) => {
      const deleted = await db.deleteClientConversation(
        req.params.threadId,
        req.auth!.user.id
      );
      if (!deleted) return res.status(404).json({ error: "Conversation not found." });
      return res.json({ success: true });
    }
  );

  app.post(
    "/api/client/assistant/messages",
    requireAuth,
    requireClientAccount,
    async (req: AuthenticatedRequest, res) => {
      const threadId =
        typeof req.body.conversationId === "string" ? req.body.conversationId : "";
      const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
      const documentIds = parseClientAssistantDocumentIds(req.body.documentIds);
      if (!threadId || !content) {
        return res.status(400).json({
          error: "Conversation and message content are required.",
        });
      }
      if (content.length > 12000) {
        return res.status(400).json({ error: "Message is too long." });
      }
      if (!documentIds) {
        return res.status(400).json({ error: "Selected documents are invalid." });
      }
      const thread = await db.getClientConversation(threadId, req.auth!.user.id);
      if (!thread) return res.status(404).json({ error: "Conversation not found." });
      try {
        const selectedDocuments = await db.getAuthorizedClientAssistantDocuments(
          req.auth!.user.id,
          documentIds
        );
        const passages = retrieveClientDocumentPassages(
          content,
          selectedDocuments.map((document) => ({
            ...document,
            content: cleanWorkProductContent(document.content),
          }))
        );
        const priorMessages = await db.getClientMessages(
          threadId,
          req.auth!.user.id,
          12
        );
        const userMessage = await db.addClientMessage(
          threadId,
          req.auth!.user.id,
          "user",
          content,
          selectedDocuments.length
            ? {
                selectedDocuments: selectedDocuments.map((document) => ({
                  id: document.id,
                  title: document.title,
                  matterName: document.matter_name,
                })),
              }
            : {}
        );
        if (!priorMessages.some((message) => message.role === "user")) {
          void tryGenerateConversationTitle(content, (generatedTitle) =>
            db.updateClientConversationTitleForFirstMessage(
              threadId,
              userMessage.id,
              thread.title,
              generatedTitle,
              req.auth!.user.id
            )
          );
        }
        const history = boundedConversation([...priorMessages, userMessage], 12000)
          .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
          .join("\n\n");
        const clientSystemInstruction = selectedDocuments.length
          ? "You are the client-facing assistant for Exepts. Provide clear, practical information grounded only in the supplied authorized document evidence. Cite supporting documents by their supplied title. If the evidence is insufficient, say so clearly. Do not invent document content, page numbers, clauses, or sections. Do not claim access to any other Matter files or internal legal work. Do not present yourself as the client's lawyer. Encourage the client to consult their lawyer for case-specific legal advice."
          : "You are the client-facing assistant for Exepts. Provide clear, practical, general information. Do not claim access to a lawyer's private Matter files or internal legal work. Do not present yourself as the client's lawyer. Encourage the client to consult their lawyer for case-specific legal advice.";
        const prompt = selectedDocuments.length
          ? `Answer the latest client message using only the authorized evidence below and the conversation for conversational continuity. References must use document titles only; page or section metadata is not available.

CLIENT CONVERSATION:
${history}

AUTHORIZED DOCUMENT EVIDENCE:
${formatClientDocumentEvidence(passages)}`
          : `Use only this client's conversation below. You do not have access to Shared Matters, collaboration documents, lawyer requests, Work Products, Matter Sources, Firm Library content, lawyer conversations, or private Matter information.

CLIENT CONVERSATION:
${history}`;
        const assistantContent =
          selectedDocuments.length && passages.length === 0
            ? "The selected documents do not contain enough information to answer that question. Please ask your lawyer for case-specific guidance."
            : cleanClientAssistantContent(
                (
                  await callModel(
                    "client-assistant",
                    [{ role: "user", content: prompt }],
                    { temperature: 0.2, systemInstruction: clientSystemInstruction }
                  )
                ).text
              );
        const assistantMessage = await db.addClientMessage(
          threadId,
          req.auth!.user.id,
          "assistant",
          assistantContent
        );
        res.setHeader("Cache-Control", "no-store");
        return res.json({ userMessage, assistantMessage });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "CLIENT_ASSISTANT_DOCUMENT_UNAVAILABLE"
        ) {
          return res.status(404).json({
            error: "One or more selected documents are no longer available.",
          });
        }
        console.error("Client Assistant response failed.");
        return res.status(500).json({ error: "The Assistant could not respond right now." });
      }
    }
  );

  const requireClaimedPortalToken = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const access = await db.resolveClientPortalAccess(
        portalTokenHash(req.params.token),
        req.auth!.user.id
      );
      if (!access) {
        return res.status(404).json({ error: "Client Portal access is unavailable" });
      }
      return next();
    } catch {
      return res.status(404).json({ error: "Client Portal access is unavailable" });
    }
  };

  // Legacy token endpoints remain compatible, but now require the claiming client account.
  app.get("/api/portal/:token", requireAuth, requireClientAccount, requireClaimedPortalToken, async (req, res) => {
    const summary = await db.getPortalSummary(portalTokenHash(req.params.token));
    res.setHeader("Cache-Control", "no-store");
    if (!summary) return res.status(404).json({ error: "Client Portal access is unavailable" });
    return res.json(cleanPortalSummary(summary));
  });

  app.get("/api/portal/:token/work-product/:draftId", requireAuth, requireClientAccount, requireClaimedPortalToken, async (req, res) => {
    const draft = await db.getPermittedPortalDraft(
      portalTokenHash(req.params.token), req.params.draftId
    );
    res.setHeader("Cache-Control", "no-store");
    if (!draft) return res.status(404).json({ error: "Shared Work Product not found" });
    return res.json({ ...draft, content: cleanWorkProductContent(draft.content) });
  });

  app.get("/api/portal/:token/work-product/:draftId/download", requireAuth, requireClientAccount, requireClaimedPortalToken, async (req, res) => {
    const draft = await db.getPermittedPortalDraft(
      portalTokenHash(req.params.token), req.params.draftId
    );
    if (!draft) return res.status(404).json({ error: "Shared Work Product not found" });
    const buffer = await Packer.toBuffer(markdownToDocxDocument(draft.title, cleanWorkProductContent(draft.content)));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${draft.title.replace(/[^a-z0-9]/gi, "_")}.docx"`);
    return res.send(buffer);
  });

  app.post("/api/portal/:token/work-product/:draftId/comments", requireAuth, requireClientAccount, requireClaimedPortalToken, async (req, res) => {
    try {
      const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
      if (!content) return res.status(400).json({ error: "Comment is required" });
      return res.status(201).json(await db.addPortalComment(
        portalTokenHash(req.params.token), req.params.draftId, content
      ));
    } catch {
      return res.status(404).json({ error: "Shared Work Product not found" });
    }
  });

  app.post("/api/portal/:token/work-product/:draftId/edit-copy", requireAuth, requireClientAccount, requireClaimedPortalToken, async (req, res) => {
    try {
      const content = typeof req.body.content === "string" ? cleanWorkProductContent(req.body.content) : "";
      return res.status(201).json(await db.createPortalClientRevision(
        portalTokenHash(req.params.token), req.params.draftId, content
      ));
    } catch {
      return res.status(404).json({ error: "Shared Work Product not found" });
    }
  });

  // Legacy route signature retained in behavior:
  // app.post("/api/portal/:token/documents", upload.array("files", MAX_FILE_COUNT)
  app.post("/api/portal/:token/documents", requireAuth, requireClientAccount, requireClaimedPortalToken, upload.array("files", MAX_FILE_COUNT), async (req, res) => {
    try {
      const tokenHash = portalTokenHash(req.params.token);
      const access = await db.resolvePortalAccess(tokenHash);
      if (!access) return res.status(404).json({ error: "Client Portal access is unavailable" });
      const extracted = await extractUploads((req.files || []) as Express.Multer.File[]);
      if (extracted.length === 0) return res.status(400).json({ error: "Upload at least one PDF, DOCX, or TXT file" });
      const documents = [];
      for (const file of extracted) {
        documents.push(await db.uploadPortalDocument(tokenHash, file.filename, file.text));
      }
      return res.status(201).json({ documents });
    } catch {
      return res.status(404).json({ error: "Client Portal access is unavailable" });
    }
  });

  app.post("/api/portal/:token/requests/:requestId/responses", requireAuth, requireClientAccount, requireClaimedPortalToken, upload.array("files", MAX_FILE_COUNT), async (req, res) => {
    try {
      const allowed = new Set(["Acknowledgement", "Comment", "Upload files", "Shared files"]);
      const type = typeof req.body.type === "string" ? req.body.type : "";
      if (!allowed.has(type)) return res.status(400).json({ error: "Invalid client response type" });
      const tokenHash = portalTokenHash(req.params.token);
      const access = await db.validatePortalRequest(tokenHash, req.params.requestId);
      if (!access) return res.status(404).json({ error: "Client request not found" });
      const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
      if (type === "Comment" && !content) return res.status(400).json({ error: "Comment text is required" });
      const draftIds = parsePortalDraftIds(req.body.draftIds);
      if (type !== "Shared files" && draftIds.length > 0) return res.status(400).json({ error: "Shared Work Product can only be attached to a Shared files response" });
      if (type === "Shared files" && draftIds.length === 0) return res.status(400).json({ error: "Select at least one shared Work Product" });
      if (type === "Shared files") {
        for (const draftId of draftIds) {
          if (!(await db.getPermittedPortalDraft(tokenHash, draftId))) {
            return res.status(404).json({ error: "Selected Work Product is not available in this Client Portal" });
          }
        }
      }
      let uploadedFiles: Array<{ filename: string; text: string }> = [];
      if (type === "Upload files") {
        const extracted = await extractUploads((req.files || []) as Express.Multer.File[]);
        if (extracted.length === 0) return res.status(400).json({ error: "Select at least one file to upload" });
        uploadedFiles = extracted.map((file) => ({ filename: file.filename, text: cleanWorkProductContent(file.text) }));
      } else if (((req.files || []) as Express.Multer.File[]).length > 0) {
        return res.status(400).json({ error: "Files can only be attached to an Upload files response" });
      }
      return res.status(201).json(await db.createPortalResponse(
        tokenHash, req.params.requestId, type, content || null, uploadedFiles, type === "Shared files" ? draftIds : []
      ));
    } catch (error) {
      const status = portalResponseErrorStatus(error);
      if (status === 500) {
        console.error("Portal response creation failed", {
          requestId: req.params.requestId,
          responseType: req.body?.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return res.status(status).json({ error: error instanceof Error ? error.message : "Response could not be sent" });
    }
  });

  app.post("/api/portal/:token/assistant", requireAuth, requireClientAccount, requireClaimedPortalToken, async (req, res) => {
    try {
      const draftIds: string[] = Array.isArray(req.body.draftIds)
        ? req.body.draftIds.filter((id: unknown): id is string => typeof id === "string") : [];
      const documentIds: string[] = Array.isArray(req.body.documentIds)
        ? req.body.documentIds.filter((id: unknown): id is string => typeof id === "string") : [];
      const query = typeof req.body.query === "string" ? req.body.query.trim() : "";
      if (!query) return res.status(400).json({ error: "Question is required" });
      const tokenHash = portalTokenHash(req.params.token);
      const bundle = await db.getPortalAssistantSources(
        tokenHash, draftIds, documentIds
      );
      if (!bundle) return res.status(404).json({ error: "Client Portal access is unavailable" });
      const sources = [...bundle.sources];
      if (sources.length === 0) return res.status(400).json({ error: "Select or attach at least one permitted document" });
      const priorMessages = await db.getPortalChatMessages(tokenHash, 20);
      const selectedLabels = sources.map(({ id, title }) => ({ id, title }));
      const userMessage = await db.addPortalChatMessage(tokenHash, "user", query, selectedLabels);
      const context = sources.map((source, index) =>
        `DOCUMENT ${index + 1}: ${source.title}\n${source.text.slice(0, 16000)}`
      ).join("\n\n---\n\n").slice(0, 60000);
      const history = priorMessages
        .slice(-12)
        .map((message: any) => `${message.role.toUpperCase()}: ${message.role === "assistant" ? cleanClientAssistantContent(message.content) : message.content}`)
        .join("\n\n");
      const prompt = `You are a document-understanding assistant for an external legal client.
Answer only from the selected documents, but do not include source labels, internal source IDs, bracketed source tags, numbered citations, footnotes, endnotes, a Sources section, a References section, or a bibliography. Integrate the answer naturally in clear plain language.
Do not provide external legal research, and do not imply access to the Firm Library, Matter Intelligence, lawyer conversations, or unshared material.
Do not append generic legal-advice, AI, lawyer-review, consultation, informational-purpose, or limitation-of-liability disclaimer boilerplate. State genuine evidentiary uncertainty directly and specifically instead.
Prior assistant conversation is only for resolving follow-up references, not an additional source.

PRIOR CHAT:
${history || "No prior chat."}

CLIENT QUESTION: ${query}\n\nSELECTED DOCUMENTS:\n${context}`;
      const result = await callModel("client-assistant", [{ role: "user", content: prompt }], { temperature: 0.2 });
      const cleanedText = cleanClientAssistantContent(result.text);
      const assistantMessage = await db.addPortalChatMessage(tokenHash, "assistant", cleanedText, selectedLabels);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ userMessage, assistantMessage, text: cleanedText, sources: selectedLabels });
    } catch (err: any) {
      const status = /not available/i.test(err.message) ? 404 : 500;
      return res.status(status).json({ error: err.message });
    }
  });

  // All remaining API routes require a completed, server-validated workspace session.
  const requireCompletedOnboarding = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    if (
      req.auth?.user.account_type !== "lawyer" ||
      !req.auth?.user.onboarding_completed ||
      !req.auth.user.firm_id ||
      !req.auth.firm ||
      req.auth.user.firm_id !== req.auth.firm.id
    ) {
      return res.status(403).json({ error: "Complete onboarding before using the workspace." });
    }
    return next();
  };

  const requireFirmAdmin = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    if (!req.auth) {
      return res.status(401).json({ error: "Authentication required." });
    }
    if (
      !req.auth.user.onboarding_completed ||
      !req.auth.user.firm_id ||
      !req.auth.firm ||
      req.auth.user.firm_id !== req.auth.firm.id ||
      req.auth.user.firm_role !== "admin"
    ) {
      return res.status(403).json({ error: "Firm Admin access is required." });
    }
    return next();
  };

  // The former lawyer gate was: app.use("/api", requireAuth, requireCompletedOnboarding)
  app.use("/api", requireAuth, requireLawyerAccount, requireCompletedOnboarding);

  app.get(
    "/api/settings/firm-admin",
    requireFirmAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const settings = await db.getFirmAdminSettings(ownership(req));
        res.setHeader("Cache-Control", "no-store");
        if (!settings) return res.status(404).json({ error: "Firm settings not found." });
        return res.json(settings);
      } catch (error) {
        console.error("Firm administration loading failed.");
        return res.status(500).json({ error: "Unable to load Firm administration." });
      }
    }
  );

  app.patch(
    "/api/settings/firm",
    requireFirmAdmin,
    async (req: AuthenticatedRequest, res) => {
      const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
      if (!name) return res.status(400).json({ error: "Firm name is required." });
      if (name.length > 120) {
        return res.status(400).json({ error: "Firm name must be 120 characters or fewer." });
      }
      try {
        const firm = await db.updateFirmName(name, ownership(req));
        res.setHeader("Cache-Control", "no-store");
        if (!firm) return res.status(404).json({ error: "Firm settings not found." });
        return res.json(firm);
      } catch (error) {
        console.error("Firm name update failed.");
        return res.status(500).json({ error: "Unable to save the Firm name." });
      }
    }
  );

  app.post(
    "/api/settings/firm/invitation-code",
    requireFirmAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const invitationCode = await db.regenerateFirmInvitationCode(ownership(req));
        res.setHeader("Cache-Control", "no-store");
        if (!invitationCode) {
          return res.status(404).json({ error: "Firm settings not found." });
        }
        return res.json({ invitationCode });
      } catch (error) {
        console.error("Firm invitation code generation failed.");
        return res.status(500).json({ error: "Unable to generate an invitation code." });
      }
    }
  );

  // Enhance/Improve Raw Prompt into Legal-Grade Query
  app.post("/api/improve-prompt", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const enhancePrompt = `You are an elite senior legal advisor. 
Transform the following raw question or thought into a professional, precise, structured, and formal legal-grade research query. 
Incorporate standard legal terminology, specify statutory frameworks or jurisdictional queries where appropriate, and ensure it remains clear and succinct for search retrieval.
Output ONLY plain editable text. Do not use Markdown headings, bold, italics, bullet markers, code fences, or tables. Preserve ordinary legal punctuation and numbered prose only when numbering is substantively useful.

Raw prompt: "${prompt}"`;

      const result = await callModel("classify-complexity", [{ role: "user", content: enhancePrompt }]);
      res.json({ improved: sanitizePlainEditableText(result.text) });
    } catch (err: any) {
      console.error("Error improving prompt:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/extract-files", upload.array("files", MAX_FILE_COUNT), async (req, res) => {
    try {
      const files = (req.files || []) as Express.Multer.File[];
      const extracted = await extractUploads(files);
      return res.json({
        files: extracted.map((file) => ({
          filename: file.filename,
          text: file.text,
          extension: file.extension,
          mimeType: file.mimeType,
          characterCount: file.text.length,
        })),
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message || "File extraction failed" });
    }
  });

  // Cases List and Create
  app.get("/api/cases", async (req, res) => {
    res.json(await db.getCases(ownership(req)));
  });

  app.get("/api/cases/:id", async (req, res) => {
    const matter = await db.getCaseById(req.params.id, ownership(req));
    if (!matter) return res.status(404).json({ error: "Matter not found" });
    return res.json(matter);
  });

  app.post("/api/cases", upload.array("files", MAX_FILE_COUNT), async (req, res) => {
    try {
      const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
      const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
      const rawLibraryIds = typeof req.body.libraryDocumentIds === "string"
        ? JSON.parse(req.body.libraryDocumentIds || "[]")
        : req.body.libraryDocumentIds;
      const libraryDocumentIds: string[] = Array.isArray(rawLibraryIds)
        ? rawLibraryIds.filter((id: unknown): id is string => typeof id === "string")
        : [];
      if (!name || !description) {
        return res.status(400).json({ error: "Matter name and assignment description are required" });
      }
      const requestOwnership = ownership(req);
      if (!(await db.validateFirmLibraryDocuments(libraryDocumentIds, requestOwnership))) {
        return res.status(404).json({ error: "Firm Library starting document not found" });
      }
      const newCase = await db.createCase(name, description, requestOwnership, {
        clientName: typeof req.body.clientName === "string" ? req.body.clientName.trim() : null,
        clientEmail: typeof req.body.clientEmail === "string" ? req.body.clientEmail.trim() : null,
      });
      const warnings: string[] = [];
      const startingTexts: string[] = [description];
      try {
        const extracted = await extractUploads((req.files || []) as Express.Multer.File[]);
        for (const file of extracted) {
          await db.uploadDocument(file.filename, file.text, requestOwnership, null, null, newCase.id, "Matter Upload", "Lawyer");
          startingTexts.push(`${file.filename}\n${file.text}`);
        }
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "An optional file could not be processed.");
      }
      for (const documentId of Array.from(new Set(libraryDocumentIds))) {
        await db.linkLibraryDocument(newCase.id, documentId, "Starting Input", requestOwnership);
      }
      const suggestions = await suggestMatterOverview({ name, description, startingContent: startingTexts.join("\n\n") });
      let finalCase = newCase;
      if (Object.keys(suggestions).length > 0) {
        finalCase = await db.updateCase(newCase.id, {
          ...newCase,
          client_name: suggestions.client_name || newCase.client_name || null,
          matter_type: suggestions.matter_type || null,
          jurisdiction: suggestions.jurisdiction || null,
          preliminary_objectives: suggestions.preliminary_objectives || null,
          matter_type_suggested: Boolean(suggestions.matter_type),
          jurisdiction_suggested: Boolean(suggestions.jurisdiction),
          objectives_suggested: Boolean(suggestions.preliminary_objectives),
        }, requestOwnership) || newCase;
      }
      await db.touchCase(newCase.id, requestOwnership);
      res.status(201).json({ ...finalCase, warnings });
    } catch (err: any) {
      res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.put("/api/cases/:id", async (req, res) => {
    try {
      const matter = await db.updateCase(req.params.id, req.body, ownership(req));
      if (!matter) return res.status(404).json({ error: "Matter not found" });
      return res.json(matter);
    } catch (err: any) {
      return res.status(/invalid matter status/i.test(err.message) ? 400 : ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.get("/api/cases/:id/sources", async (req, res) => {
    const matter = await db.getCaseById(req.params.id, ownership(req));
    if (!matter) return res.status(404).json({ error: "Matter not found" });
    return res.json(await db.getCaseSources(req.params.id, ownership(req)));
  });

  app.post("/api/cases/:id/sources", upload.array("files", MAX_FILE_COUNT), async (req, res) => {
    try {
      const requestOwnership = ownership(req);
      const matter = await db.getCaseById(req.params.id, requestOwnership);
      if (!matter) return res.status(404).json({ error: "Matter not found" });
      const libraryDocumentIds = [
        ...parseStringArray(req.body.libraryDocumentIds),
        ...(typeof req.body.libraryDocumentId === "string" && req.body.libraryDocumentId.trim()
          ? [req.body.libraryDocumentId.trim()]
          : []),
      ];
      const uniqueLibraryDocumentIds = Array.from(new Set(libraryDocumentIds));
      if (uniqueLibraryDocumentIds.length > 0) {
        if (!(await db.validateFirmLibraryDocuments(uniqueLibraryDocumentIds, requestOwnership))) {
          return res.status(404).json({ error: "Firm Library document not found" });
        }
        for (const documentId of uniqueLibraryDocumentIds) {
          await db.linkLibraryDocument(matter.id, documentId, "Manual", requestOwnership);
        }
        await db.touchCase(matter.id, requestOwnership);
        return res.status(201).json({ linked: true, documentIds: uniqueLibraryDocumentIds });
      }
      const files = (req.files || []) as Express.Multer.File[];
      if (files.length > 0) {
        const extracted = await extractUploads(files);
        const documents = [];
        for (const file of extracted) {
          const title = extracted.length === 1 && typeof req.body.title === "string" && req.body.title.trim()
            ? req.body.title.trim()
            : file.filename;
          documents.push(await db.uploadDocument(
            title, file.text, requestOwnership, null, null, matter.id, "Matter Upload", "Lawyer"
          ));
        }
        await db.touchCase(matter.id, requestOwnership);
        return res.status(201).json(documentBatchResponse(documents));
      }
      const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
      const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
      if (!text) return res.status(400).json({ error: "Source content is required" });
      const sourceType = req.body.sourceType === "Starting Instruction" ? "Starting Instruction" : "Matter Upload";
      const document = await db.uploadDocument(
        title || (sourceType === "Starting Instruction" ? "Matter instruction" : "Matter source"),
        text, requestOwnership, null, null, matter.id, sourceType, "Lawyer"
      );
      await db.touchCase(matter.id, requestOwnership);
      return res.status(201).json(document);
    } catch (err: any) {
      return res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.delete("/api/cases/:caseId/sources/:documentId", async (req, res) => {
    const removed = await db.deleteDocument(
      req.params.documentId, ownership(req), req.params.caseId
    );
    if (!removed) return res.status(404).json({ error: "Matter Source not found" });
    await db.touchCase(req.params.caseId, ownership(req));
    return res.json({ success: true });
  });

  app.get("/api/cases/:caseId/intelligence", async (req, res) => {
    const matter = await db.getCaseById(req.params.caseId, ownership(req));
    if (!matter) return res.status(404).json({ error: "Matter not found" });
    const record = await db.getMatterIntelligence(matter.id, ownership(req));
    return res.json(record ? { ...record, content: cleanMatterIntelligenceContent(record.content) } : null);
  });

  app.post("/api/cases/:caseId/intelligence/generate", async (req, res) => {
    try {
      const requestOwnership = ownership(req);
      const bundle = await db.getMatterIntelligenceSourceBundle(req.params.caseId, requestOwnership);
      if (bundle.sources.length === 0) {
        return res.status(400).json({ error: "Add at least one Matter Source before generating Intelligence" });
      }
      const sourceText = bundle.sources.map((source, index) =>
        `SOURCE ${index + 1}: ${source.title}\nTYPE: ${source.source_type || "Matter Source"}\n${source.extracted_text.slice(0, 12000)}`
      ).join("\n\n---\n\n").slice(0, 60000);
      const prompt = `Generate compact Matter Intelligence for the owned Matter below using ONLY the supplied active Matter Sources.
Do not infer facts from other matters or external knowledge. You may use only active Matter Sources.
Do not include [Source: ...]. Do not include source labels, inline citation tags, footnotes, endnotes, or a bibliography. Do not expose internal source identifiers.
Integrate grounded analysis naturally into the document. State factual uncertainty naturally when the sources do not establish something.
Do not add AI disclaimers, "This is not legal advice" boilerplate, "Consult a lawyer" boilerplate, "AI may make mistakes" boilerplate, lawyer-review warnings, or generic limitation-of-liability paragraphs unless the user explicitly requests that content or it is substantive content being analyzed from a source document.
Use exactly these Markdown section headings:
## Matter Summary
## Key Facts and Chronology
## Legal Issues and Authorities
## Analysis, Risks, and Preliminary Conclusions
## Open Questions and Recommended Next Actions
State uncertainty clearly. Do not add assignees, due dates, or task workflow.

MATTER: ${bundle.matter.name}
ASSIGNMENT: ${bundle.matter.description}
JURISDICTION: ${bundle.matter.jurisdiction || "Not confirmed"}

ACTIVE MATTER SOURCES:
${sourceText}`;
      const generated = await callModel("matter-intelligence", [{ role: "user", content: prompt }], { temperature: 0.2 });
      return res.status(201).json(
        await db.saveGeneratedMatterIntelligence(
          bundle.matter.id, cleanMatterIntelligenceContent(cleanGeneratedText(generated.text)), bundle.snapshot, requestOwnership
        )
      );
    } catch (err: any) {
      return res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.put("/api/cases/:caseId/intelligence", async (req, res) => {
    try {
      const content = typeof req.body.content === "string" ? req.body.content : "";
      if (!content.trim()) return res.status(400).json({ error: "Matter Intelligence content is required" });
      return res.json(await db.updateMatterIntelligence(req.params.caseId, cleanMatterIntelligenceContent(content), ownership(req)));
    } catch (err: any) {
      return res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.get("/api/cases/:caseId/intelligence/export", async (req, res) => {
    try {
      const record = await db.getMatterIntelligence(req.params.caseId, ownership(req));
      const matter = await db.getCaseById(req.params.caseId, ownership(req));
      if (!record || !matter) return res.status(404).json({ error: "Matter Intelligence not found" });
      const buffer = await Packer.toBuffer(markdownToDocxDocument(`${matter.name} Matter Intelligence`, cleanMatterIntelligenceContent(record.content)));
      const safeTitle = `${matter.name}_matter_intelligence`.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.docx"`);
      return res.send(buffer);
    } catch (err: any) {
      return res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.get("/api/cases/:caseId/collaboration", async (req, res) => {
    try {
      return res.json(await db.getCollaboration(req.params.caseId, ownership(req)));
    } catch (err: any) {
      return res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.put("/api/cases/:caseId/collaboration/client", async (req, res) => {
    try {
      const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
      const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
      if (!name || !email || !email.includes("@")) {
        return res.status(400).json({ error: "Client name and valid email are required" });
      }
      return res.json(await db.saveClientCollaborator(req.params.caseId, name, email, ownership(req)));
    } catch (err: any) {
      return res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.post("/api/cases/:caseId/collaboration/token", async (req, res) => {
    try {
      const { token, tokenHash } = createCollaborationToken();
      const access = await db.activateClientInvite(req.params.caseId, tokenHash, ownership(req));
      res.setHeader("Cache-Control", "no-store");
      return res.json({ access, token });
    } catch (err: any) {
      return res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.post("/api/cases/:caseId/collaboration/revoke", async (req, res) => {
    try {
      return res.json(await db.revokeClientInvite(req.params.caseId, ownership(req)));
    } catch (err: any) {
      return res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.post("/api/cases/:caseId/collaboration/requests", async (req, res) => {
    try {
      const type = typeof req.body.type === "string" ? req.body.type : "";
      const instruction = typeof req.body.instruction === "string" ? req.body.instruction.trim() : "";
      const draftIds: string[] = Array.isArray(req.body.draftIds)
        ? req.body.draftIds.filter((id: unknown): id is string => typeof id === "string") : [];
      return res.status(201).json(
        await db.createCollaborationRequest(req.params.caseId, type, instruction, draftIds, ownership(req))
      );
    } catch (err: any) {
      const status = /invalid|select at least/i.test(err.message) ? 400 : ownedErrorStatus(err);
      return res.status(status).json({ error: err.message });
    }
  });

  app.put("/api/cases/:caseId/collaboration/responses/:responseId/read", async (req, res) => {
    const updated = await db.markCollaborationResponseRead(
      req.params.caseId, req.params.responseId, ownership(req)
    );
    if (!updated) return res.status(404).json({ error: "Client response not found" });
    return res.json({ success: true });
  });

  // Documents Library
  app.get("/api/documents", async (req, res) => {
    const caseId = requestedCaseId(req.query.caseId);
    res.json(await db.getDocuments(ownership(req), caseId));
  });

  // Upload/create Document
  app.post("/api/documents", upload.array("files", MAX_FILE_COUNT), async (req, res) => {
    try {
      const { title, text, sourceUrl, driveId, caseId } = req.body;
      const files = (req.files || []) as Express.Multer.File[];
      if (files.length > 0) {
        const extracted = await extractUploads(files);
        const documents = [];
        for (const file of extracted) {
          documents.push(await db.uploadDocument(
            extracted.length === 1 && typeof title === "string" && title.trim() ? title.trim() : file.filename,
            file.text,
            ownership(req),
            sourceUrl || null,
            driveId || null,
            caseId || null
          ));
        }
        return res.status(201).json(documentBatchResponse(documents));
      }
      if (!title || !text) {
        return res.status(400).json({ error: "Title and text content are required" });
      }
      
      const newDoc = await db.uploadDocument(
        title,
        text,
        ownership(req),
        sourceUrl || null,
        driveId || null,
        caseId || null
      );
      res.status(201).json(newDoc);
    } catch (err: any) {
      console.error("Error creating document:", err);
      res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.delete("/api/documents/:id", async (req, res) => {
    try {
      if (typeof req.query.caseId !== "string") {
        return res.status(400).json({ error: "Document context is required" });
      }
      const deleted = await db.deleteDocument(
        req.params.id,
        ownership(req),
        requestedCaseId(req.query.caseId)
      );
      if (!deleted) return res.status(404).json({ error: "Document not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  // Threads API
  app.get("/api/threads", async (req, res) => {
    if (req.query.history === "true") {
      return res.json(await db.getHistoryThreads(ownership(req)));
    }
    const caseId = requestedCaseId(req.query.caseId);
    return res.json(await db.getThreads(ownership(req), caseId));
  });

  app.post("/api/threads", async (req, res) => {
    try {
      const { title, caseId } = req.body;
      const newThread = await db.createThread(
        title || "New Legal Conversation",
        caseId || null,
        ownership(req)
      );
      res.status(201).json(newThread);
    } catch (err: any) {
      res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.delete("/api/threads/:id", async (req, res) => {
    try {
      const deleted = await db.deleteThread(req.params.id, ownership(req));
      if (!deleted) return res.status(404).json({ error: "Thread not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/threads/:id/messages", async (req, res) => {
    const thread = await db.getThreadById(req.params.id, ownership(req));
    if (!thread) return res.status(404).json({ error: "Thread not found" });
    return res.json(await db.getMessages(req.params.id, ownership(req)));
  });

  // Core Legal Search (semantic + keyword search fallback)
  app.post("/api/search", async (req, res) => {
    try {
      const { query, scope } = req.body; // scope = "wide" or case_id
      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }
      const results = await db.vectorSearch(query, scope || "wide", ownership(req), 5);
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Core Assistant Chat Endpoint
  app.post("/api/threads/:id/messages", async (req, res) => {
    const threadId = req.params.id;
    const { content, forceDeepResearch, enableWebSearch } = req.body;
    const temporaryFiles: Array<{ filename: string; text: string }> = Array.isArray(req.body.temporaryFiles)
      ? req.body.temporaryFiles
          .filter((file: any) => typeof file?.filename === "string" && typeof file?.text === "string")
          .map((file: any) => ({ filename: file.filename.slice(0, 180), text: file.text.slice(0, 30000) }))
      : [];

    if (!content) {
      return res.status(400).json({ error: "Message content is required" });
    }

    try {
      const requestOwnership = ownership(req);
      const thread = await db.getThreadById(threadId, requestOwnership);
      if (!thread) {
        return res.status(404).json({ error: "Thread not found" });
      }
      const priorHistory = await db.getRecentMessages(threadId, requestOwnership, 12);

      // Save user message first
      const userMessage = await db.addMessage(
        threadId,
        "user",
        content,
        requestOwnership,
        [],
        null,
        temporaryAttachmentMetadata(temporaryFiles)
      );
      const isFirstUserMessage = !priorHistory.some((message) => message.role === "user");
      if (isFirstUserMessage) {
        void tryGenerateConversationTitle(
          content,
          (generatedTitle) => db.updateThreadTitleForFirstMessage(
            threadId,
            userMessage.id,
            thread.title,
            generatedTitle,
            requestOwnership
          )
        );
      }
      const conversationHistory = boundedConversation([...priorHistory, userMessage], 12000);
      const conversationContext = conversationHistory
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join("\n\n");
      const retrievalQuery = [...conversationHistory.filter((m) => m.role === "user").slice(-3).map((m) => m.content), content].join("\n");

      const scope = thread.case_id || "wide";

      // 1. Determine if Deep Research is needed and split into sub-questions in ONE single call
      let needsDeepResearch = forceDeepResearch === true;
      let classificationReason = "Manual override or preset config";
      let subQuestions: string[] = [];

      try {
        const combinedPrompt = `Analyze this legal query and determine if it requires complex, multi-step analysis, comparisons of laws, or structured sub-questions to answer properly (e.g. cross-disciplinary issues, detailed statutes, case comparing).
If it requires Deep Research (or if forced), also break this complex legal question into 2 to 3 simple, highly targeted legal sub-questions for individual document retrieval and legislative/statutory lookups.

Respond with a JSON object of this exact schema:
{
  "requiresDeepResearch": boolean,
  "reason": "short explanation",
  "subQuestions": ["sub-question 1", "sub-question 2", ...]
}

Query: "${content}"`;

        const classResult = await callModel("classify-complexity", [{ role: "user", content: combinedPrompt }], {
          responseMimeType: "application/json"
        });
        const parsed = JSON.parse(classResult.text);
        if (forceDeepResearch !== true) {
          needsDeepResearch = parsed.requiresDeepResearch === true;
        }
        classificationReason = parsed.reason || "AI Classifier result";
        subQuestions = parsed.subQuestions || [];
        if (!Array.isArray(subQuestions)) {
          subQuestions = [];
        }
        console.log(`[Classifier] Needs Deep Research: ${needsDeepResearch}. Reason: ${classificationReason}. Sub-questions count: ${subQuestions.length}`);
      } catch (err) {
        console.error("Combined classification and split pass failed:", err);
        if (forceDeepResearch !== true) {
          needsDeepResearch = false;
        }
      }

      if (needsDeepResearch && subQuestions.length === 0) {
        subQuestions = [content];
      }

      // Initialize lists for unified citations
      const citations: Citation[] = [];
      const citationIdMap = new Map<string, Citation>();

      // Internal citation counters
      let citationIdx = 1;

      // Function to register a citation and avoid duplicates by source document
      const registerCitation = (cit: Omit<Citation, "id">) => {
        const key = `${cit.type}_${cit.title}`;
        if (citationIdMap.has(key)) {
          const existing = citationIdMap.get(key)!;
          if (!existing.textSnippet.includes(cit.textSnippet)) {
            existing.textSnippet = `${existing.textSnippet}\n\n[Additional Snippet]:\n${cit.textSnippet}`;
          }
          return existing;
        }
        const finalCit: Citation = {
          ...cit,
          id: `cit_${citationIdx++}`
        };
        citationIdMap.set(key, finalCit);
        citations.push(finalCit);
        return finalCit;
      };

      let finalContent = "";
      let researchSteps: ResearchStep[] | null = null;

      // 2. Perform Retrieval & Model Synthesis
      if (needsDeepResearch) {
        console.log(`[Deep Research] Commencing multi-step research loop for: "${content}"...`);
        researchSteps = [];

        // Step B: Loop over each sub-question
        for (let i = 0; i < subQuestions.length; i++) {
          const subQ = subQuestions[i];
          console.log(`[Deep Research] Processing sub-question: "${subQ}"`);

          // Introduce a delay before processing each sub-question to avoid rate limit spikes
          if (i > 0) {
            await sleep(800);
          }
          
          // Vector Search Chunks with similarity threshold
          const allLocalChunks = await db.vectorSearch(`${subQ}\n${retrievalQuery}`.slice(0, 4000), scope, requestOwnership, 2);
          const localChunks = allLocalChunks.filter(c => c.similarity >= SIMILARITY_THRESHOLD);
          
          // Register retrieved context to citations
          const stepCitations: string[] = [];

          for (const c of localChunks) {
            const doc = await db.getDocumentById(
              c.document_id,
              requestOwnership,
              thread.case_id
            );
            const cit = registerCitation({
              type: "workspace",
              title: doc ? doc.title : "Workspace Document",
              textSnippet: cleanSourceText(c.chunk_text),
              sourceName: thread.case_id ? "Matter Sources" : "Firm Library"
            });
            stepCitations.push(`[${cit.id}] ${cit.title}`);
          }

          for (const file of temporaryFiles) {
            const cit = registerCitation({
              type: "workspace",
              title: file.filename,
              textSnippet: cleanSourceText(file.text.slice(0, 1200)),
              sourceName: "Temporary File Attachment"
            });
            stepCitations.push(`[${cit.id}] ${cit.title} (Temporary File Attachment)`);
          }

          // Generate sub-step note via AI (using cheaper/lighter model)
          const contextText = localChunks.map(c => c.chunk_text).concat(temporaryFiles.map((f) => f.text.slice(0, 4000))).join("\n\n");
          let subNote = "";
          try {
            const noteResult = await callModel("summarize-subquestion", [
              { role: "user", content: `Summarize in 1-2 sentences what was found about "${subQ}" in the following context:\n\n${contextText || "No matching internal legal resources found."}` }
            ]);
            subNote = noteResult.text.trim();
          } catch (err) {
            subNote = "Completed permitted source lookup.";
          }

          researchSteps.push({
            subQuestion: subQ,
            retrievedContext: stepCitations.length > 0 ? stepCitations.join("\n") : "No specific sources retrieved.",
            note: subNote
          });
        }

        // Introduce a final delay before the synthesis call
        await sleep(800);

        // Step C: Synthesize final response using Google Search Grounding & Steps Context
        const totalGatheredContext = citations
          .map((c) => `[${c.id}] Source: ${c.sourceName} - ${c.title}\nText Snippet: ${c.textSnippet}`)
          .join("\n\n");

        const groundingToolsDesc = enableWebSearch === true
          ? "AND your live web search grounding tool."
          : "and you DO NOT have access to any external search grounding tools or internet search. You MUST rely ONLY on the provided legal references above.";

        const groundingInst1 = enableWebSearch === true
          ? "1. If the section 'Gathered legal references to use and reference' above says \"No internal document matches.\" (or has no actual permitted document snippets) AND you do not have any active search grounding results or other sources, you MUST respond EXACTLY with: \"I could not find any relevant documents in the permitted context regarding this topic.\" and do NOT attempt to answer using your general external knowledge."
          : "1. If the section 'Gathered legal references to use and reference' above says \"No internal document matches.\" (or has no actual permitted document snippets), you MUST respond EXACTLY with: \"I could not find any relevant documents in the permitted context regarding this topic.\" and you MUST NOT attempt to answer or generate any explanation using your general external knowledge. You are strictly forbidden from simulating or fabricating any search results, external knowledge, or citations.";

        const citationInstSearch = enableWebSearch === true
          ? "- For Google Search grounding references, cite them using the bracketed numbers (e.g., [1], [2]) that match the search grounding chunks."
          : "- You DO NOT have access to Google Search grounding. You MUST NOT include any bracketed numbers like [1] or [2] in your text, and you MUST NOT simulate any search grounding citations.";

        const synthesisPrompt = `You are an elite legal research assistant. 
We have broken down the primary question and retrieved specialized legal sources.
Answer the primary legal question comprehensively using ONLY the gathered sources below ${groundingToolsDesc}
Do not invent anything. If the sources do not provide an answer, state that information is limited.
Do not append generic legal-advice, AI, lawyer-review, consultation, informational-purpose, or limitation-of-liability disclaimer boilerplate. State genuine evidentiary uncertainty directly and specifically instead.

Gathered legal references to use and reference:
${totalGatheredContext || "No internal document matches."}

Prior conversation for resolving follow-up references only. This is not a legal source:
${conversationContext || "No prior conversation."}

Primary Question: "${content}"

CRITICAL GROUNDING INSTRUCTIONS (CRITICAL - ALWAYS STRICTLY ENFORCE):
${groundingInst1}
2. If sources are present but do not directly address or answer the legal query, clearly state that your workspace legal resources are insufficient to answer the query. Do not hallucinate or use external knowledge to construct a detailed answer.
3. Do not assume or reference historical topics like the Nuremberg trials, Tokyo tribunals, Geneva Conventions, or general world war laws unless they are explicitly and literally contained within the provided legal references above.

INSTRUCTIONS FOR CITATIONS (CRITICAL - PLEASE BE EXTREMELY PRECISE):
- You MUST reference the sources using their exact citation tag inside square brackets, e.g. [cit_1], [cit_2].
- Cite claims and assertions directly inline next to the specific statements they support (e.g., "Under California law, a trade secret is protected [cit_1].").
- STRICTLY PROHIBITED: Do NOT use blanket, repeating clusters of citations (e.g., appending '[cit_1][cit_2][cit_3][cit_4]' or '[1][2][3][4]' to every sentence or at the end of paragraphs).
- Each sentence should only cite the SPECIFIC source that directly supports that individual claim. If a sentence makes a claim about 'unfair prejudice', only cite the exact source(s) that mention 'unfair prejudice'. If the next sentence is about 'wasting time', only cite the source(s) mentioning 'wasting time'.
- DO NOT list more than 1 or 2 of the most direct citations per claim. Be conservative and precise.
- Never write out "Source ID: cit_1" or "cit_1" as plain text in your prose. Keep citations strictly as inline bracket tags [cit_1].
${citationInstSearch}`;

        const finalResult = await callModel("chat", [{ role: "user", content: synthesisPrompt }], {
          googleSearch: enableWebSearch === true,
          temperature: 0.2
        });

        // Parse any Search Grounding links and register them as citations
        const chunkIndexToCitId: Record<number, string> = {};
        if (finalResult.groundingMetadata?.groundingChunks) {
          finalResult.groundingMetadata.groundingChunks.forEach((chunk: any, i: number) => {
            if (chunk.web) {
              const cit = registerCitation({
                type: "web",
                title: chunk.web.title || "Web Reference",
                url: chunk.web.uri,
                textSnippet: `Live Web Search Grounding source.`,
                sourceName: "Google Search Grounding"
              });
              chunkIndexToCitId[i] = cit.id;
            }
          });
        }

        const text = rewriteGoogleGroundingCitations(finalResult.text, chunkIndexToCitId);

        finalContent = canonicalizeAssistantCitations(cleanGeneratedText(text), citations);

      } else {
        // STANDARD RESEARCH FLOW (Single shot lookup)
        console.log(`[Standard Research] Performing single-shot legal lookup for: "${content}"...`);

        const allLocalChunks = await db.vectorSearch(retrievalQuery.slice(0, 4000), scope, requestOwnership, 3);

        const localChunks = allLocalChunks.filter(c => c.similarity >= SIMILARITY_THRESHOLD);

        // Register in citations list
        for (const c of localChunks) {
          const doc = await db.getDocumentById(
            c.document_id,
            requestOwnership,
            thread.case_id
          );
          registerCitation({
            type: "workspace",
            title: doc ? doc.title : "Workspace Document",
            textSnippet: cleanSourceText(c.chunk_text),
            sourceName: thread.case_id ? "Matter Sources" : "Firm Library"
          });
        }

        for (const file of temporaryFiles) {
          registerCitation({
            type: "workspace",
            title: file.filename,
            textSnippet: cleanSourceText(file.text.slice(0, 1200)),
            sourceName: "Temporary File Attachment"
          });
        }

        const totalGatheredContext = citations
          .map((c) => `[${c.id}] Source: ${c.sourceName} - ${c.title}\nText Snippet: ${c.textSnippet}`)
          .join("\n\n");

        const groundingToolsDesc = enableWebSearch === true
          ? "AND the live Google Search grounding tool."
          : "and you DO NOT have access to any external search grounding tools or internet search. You MUST rely ONLY on the provided Sources above.";

        const groundingInst1 = enableWebSearch === true
          ? "1. If the section 'Provided Sources' above says \"No internal document matches.\" (or has no actual permitted document snippets) AND you do not have any active search grounding results or other sources, you MUST respond EXACTLY with: \"I could not find any relevant documents in the permitted context regarding this topic.\" and do NOT attempt to answer using your general external knowledge."
          : "1. If the section 'Provided Sources' above says \"No internal document matches.\" (or has no actual permitted document snippets), you MUST respond EXACTLY with: \"I could not find any relevant documents in the permitted context regarding this topic.\" and you MUST NOT attempt to answer or generate any explanation using your general external knowledge. You are strictly forbidden from simulating or fabricating any search results, external knowledge, or citations.";

        const citationInstSearch = enableWebSearch === true
          ? "- For Google Search grounding references, cite them using the bracketed numbers (e.g., [1], [2]) that match the search grounding chunks."
          : "- You DO NOT have access to Google Search grounding. You MUST NOT include any bracketed numbers like [1] or [2] in your text, and you MUST NOT simulate any search grounding citations.";

        const chatPrompt = `You are an elite legal research assistant.
Answer the legal query using the provided library sources below ${groundingToolsDesc}
Cite your statements using the inline square bracket tags matching the Source ID, e.g. [cit_1] or [cit_2].
Stay strict, professional, objective, and use clear legal logic.
Do not append generic legal-advice, AI, lawyer-review, consultation, informational-purpose, or limitation-of-liability disclaimer boilerplate. State genuine evidentiary uncertainty directly and specifically instead.

Provided Sources:
${totalGatheredContext || "No internal document matches."}

Prior conversation for resolving follow-up references only. This is not a legal source:
${conversationContext || "No prior conversation."}

Legal Question: "${content}"

CRITICAL GROUNDING INSTRUCTIONS (CRITICAL - ALWAYS STRICTLY ENFORCE):
${groundingInst1}
2. If sources are present but do not directly address or answer the legal query, clearly state that your workspace legal resources are insufficient to answer the query. Do not hallucinate or use external knowledge to construct a detailed answer.
3. Do not assume or reference historical topics like the Nuremberg trials, Tokyo tribunals, Geneva Conventions, or general world war laws unless they are explicitly and literally contained within the provided sources above.

INSTRUCTIONS FOR CITATIONS (CRITICAL - PLEASE BE EXTREMELY PRECISE):
- You MUST reference the sources using their exact citation tag inside square brackets, e.g. [cit_1], [cit_2].
- Cite claims and assertions directly inline next to the specific statements they support (e.g., "Under California law, a trade secret is protected [cit_1].").
- STRICTLY PROHIBITED: Do NOT use blanket, repeating clusters of citations (e.g., appending '[cit_1][cit_2][cit_3][cit_4]' or '[1][2][3][4]' to every sentence or at the end of paragraphs).
- Each sentence should only cite the SPECIFIC source that directly supports that individual claim. If a sentence makes a claim about 'unfair prejudice', only cite the exact source(s) that mention 'unfair prejudice'. If the next sentence is about 'wasting time', only cite the source(s) mentioning 'wasting time'.
- DO NOT list more than 1 or 2 of the most direct citations per claim. Be conservative and precise.
- Never write out "Source ID: cit_1" or "cit_1" as plain text in your prose. Keep citations strictly as inline bracket tags [cit_1].
${citationInstSearch}`;

        const finalResult = await callModel("chat", [{ role: "user", content: chatPrompt }], {
          googleSearch: enableWebSearch === true,
          temperature: 0.1
        });

        // Parse web search grounding results
        const chunkIndexToCitId: Record<number, string> = {};
        if (finalResult.groundingMetadata?.groundingChunks) {
          finalResult.groundingMetadata.groundingChunks.forEach((chunk: any, i: number) => {
            if (chunk.web) {
              const cit = registerCitation({
                type: "web",
                title: chunk.web.title || "Web Reference",
                url: chunk.web.uri,
                textSnippet: `Live Web Search Grounding source.`,
                sourceName: "Google Search Grounding"
              });
              chunkIndexToCitId[i] = cit.id;
            }
          });
        }

        const text = rewriteGoogleGroundingCitations(finalResult.text, chunkIndexToCitId);

        finalContent = canonicalizeAssistantCitations(cleanGeneratedText(text), citations);
      }

      // Save assistant message with aggregated citations and steps
      const suggestions = await generateFollowUpSuggestions([...conversationHistory], finalContent);
      const assistantMessage = await db.addMessage(
        threadId,
        "assistant",
        finalContent,
        requestOwnership,
        citations,
        researchSteps,
        { suggestions }
      );

      res.status(201).json({
        userMessage,
        assistantMessage
      });

    } catch (err: any) {
      console.error("Error in assistant chat endpoint:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT route for updating a message (inline editor)
  app.put("/api/messages/:id", async (req, res) => {
    try {
      const { content } = req.body;
      const threadId = typeof req.query.threadId === "string" ? req.query.threadId : "";
      if (!content || !threadId) {
        return res.status(400).json({ error: "Content and thread context are required" });
      }
      const updatedMessage = await db.updateMessage(
        req.params.id,
        threadId,
        content,
        ownership(req)
      );
      res.json(updatedMessage);
    } catch (err: any) {
      console.error("Error updating message:", err);
      res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  // Draft Generation and Editable View APIs
  app.get("/api/cases/:caseId/work-product", async (req, res) => {
    const matter = await db.getCaseById(req.params.caseId, ownership(req));
    if (!matter) return res.status(404).json({ error: "Matter not found" });
    const drafts = await db.getDrafts(ownership(req), matter.id);
    return res.json(drafts.map((draft) => ({ ...draft, content: cleanWorkProductContent(draft.content) })));
  });

  app.post("/api/cases/:caseId/work-product", async (req, res) => {
    try {
      const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
      const content = typeof req.body.content === "string" ? cleanWorkProductContent(req.body.content) : "";
      if (!title) return res.status(400).json({ error: "Work Product title is required" });
      return res.status(201).json(
        await db.createManualDraft(req.params.caseId, title, content, ownership(req))
      );
    } catch (err: any) {
      return res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.get("/api/drafts/:id", async (req, res) => {
    const caseId = requestedCaseId(req.query.caseId);
    if (!caseId) return res.status(400).json({ error: "Matter context is required" });
    const draft = await db.getDraftById(req.params.id, caseId, ownership(req));
    if (!draft) {
      return res.status(404).json({ error: "Work Product not found" });
    }
    res.json({ ...draft, content: cleanWorkProductContent(draft.content) });
  });

  app.post("/api/drafts", async (req, res) => {
    try {
      const { threadId, format, instructions } = req.body;
      if (!threadId) {
        return res.status(400).json({ error: "Thread ID is required" });
      }
      if (!isWorkProductFormat(format)) {
        return res.status(400).json({ error: "Format must be memo, email, or summary" });
      }

      const requestOwnership = ownership(req);
      const thread = await db.getThreadById(threadId, requestOwnership);
      if (!thread) {
        return res.status(404).json({ error: "Thread not found" });
      }
      if (!thread.case_id) {
        return res.status(400).json({ error: "Select a Matter before saving generated Work Product" });
      }
      const matter = await db.getCaseById(thread.case_id, requestOwnership);
      if (!matter) return res.status(404).json({ error: "Matter not found" });

      const messages = await db.getMessages(threadId, requestOwnership);
      if (messages.length === 0) {
        return res.status(400).json({ error: "Cannot generate draft from empty conversation" });
      }

      // Compile conversation history for the drafting model
      const convoHistory = messages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n\n");

      const currentDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
      const matterMetadata = [
        `Matter name: ${matter.name}`,
        `Assignment description: ${matter.description}`,
        matter.client_name ? `Client name: ${matter.client_name}` : "",
        matter.client_email ? `Client email: ${matter.client_email}` : "",
        matter.matter_type ? `Practice area: ${matter.matter_type}` : "",
        matter.jurisdiction ? `Jurisdiction: ${matter.jurisdiction}` : "",
        matter.preliminary_objectives ? `Preliminary objectives: ${matter.preliminary_objectives}` : "",
        `Lawyer name: ${(req as AuthenticatedRequest).auth!.user.name}`,
        `Firm name: ${(req as AuthenticatedRequest).auth!.firm.name}`,
        `Current date: ${currentDate}`,
      ].filter(Boolean).join("\n");

      const formatInstructions = getWorkProductFormatInstructions(format);

      const draftPrompt = `You are a meticulous legal counsel drafting a formal document based on legal research.
Draft a high-quality ${format.toUpperCase()} based on the legal consultation conversation history and references provided below.

Matter and account metadata:
${matterMetadata}

Conversation History:
${convoHistory}

Custom Instructions:
${instructions || "Ensure high-level professionalism and clear structure."}

FORMAT INSTRUCTIONS:
${formatInstructions}

SHARED INSTRUCTIONS:
1. Produce a polished standalone work product. Do not include internal source IDs, Assistant citation tokens, numbered source markers, clickable citation syntax, footnotes, endnotes, a references list, or a bibliography unless the user explicitly requests formal citations. Integrate legal authorities naturally into prose by naming the case, statute, regulation, or document when relevant.
2. Use the server-provided current date exactly when a date is needed. Do not invent another date.
3. Do not emit bracketed placeholders such as [Client Name], [Your Name], or [Firm Name] when the metadata supplies those values. If optional metadata is missing, omit that field or use a neutral professional phrasing.
4. Do not append generic legal-advice, AI, lawyer-review, consultation, informational-purpose, or limitation-of-liability disclaimer boilerplate. State genuine evidentiary uncertainty directly and specifically instead. Do not remove substantive analysis of disclaimer clauses contained in the conversation or sources.
5. Output the draft using elegant, rich markdown with readable headers. Do not wrap in generic JSON, just output the clean draft text.`;

      const draftResult = await callModel("draft-generation", [{ role: "user", content: draftPrompt }], {
        temperature: 0.3
      });

      const cleanedContent = cleanGeneratedWorkProductContent(draftResult.text);
      const subjectTitle = extractGeneratedSubject(cleanedContent);
      const summaryTitle = format === "summary" && !subjectTitle
        ? extractSummaryHeading(cleanedContent)
        : null;
      const fallbackTitle = `Legal ${format.charAt(0).toUpperCase() + format.slice(1)} - Thread Ref: ${thread.title.substring(0, 30)}`;
      const title = subjectTitle || summaryTitle || fallbackTitle;
      const newDraft = await db.createDraft(
        threadId,
        thread.case_id,
        title,
        cleanedContent,
        requestOwnership
      );

      res.status(201).json(newDraft);
    } catch (err: any) {
      console.error("Error creating draft:", err);
      res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.put("/api/drafts/:id", async (req, res) => {
    try {
      const { content } = req.body;
      const caseId = requestedCaseId(req.query.caseId);
      if (!caseId) return res.status(400).json({ error: "Matter context is required" });
      const updated = await db.updateDraft(req.params.id, caseId, cleanWorkProductContent(content), ownership(req));
      res.json({ ...updated, content: cleanWorkProductContent(updated.content) });
    } catch (err: any) {
      res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.post("/api/drafts/:id/duplicate", async (req, res) => {
    try {
      const caseId = requestedCaseId(req.query.caseId);
      if (!caseId) return res.status(400).json({ error: "Matter context is required" });
      const duplicate = await db.duplicateDraft(req.params.id, caseId, ownership(req));
      const cleaned = cleanWorkProductContent(duplicate.content);
      if (cleaned !== duplicate.content) {
        const updatedDuplicate = await db.updateDraft(duplicate.id, caseId, cleaned, ownership(req));
        return res.status(201).json({ ...updatedDuplicate, content: cleanWorkProductContent(updatedDuplicate.content) });
      }
      return res.status(201).json({ ...duplicate, content: cleaned });
    } catch (err: any) {
      return res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.put("/api/drafts/:id/sharing", async (req, res) => {
    try {
      const caseId = requestedCaseId(req.query.caseId);
      if (!caseId || typeof req.body.shared !== "boolean") {
        return res.status(400).json({ error: "Matter context and sharing state are required" });
      }
      const draft = await db.setDraftSharing(req.params.id, caseId, req.body.shared, ownership(req));
      return res.json({ ...draft, content: cleanWorkProductContent(draft.content) });
    } catch (err: any) {
      return res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  app.post("/api/drafts/:id/client-revision", async (req, res) => {
    try {
      const caseId = requestedCaseId(req.query.caseId);
      const content = typeof req.body.content === "string" ? cleanWorkProductContent(req.body.content) : "";
      if (!caseId) return res.status(400).json({ error: "Matter context is required" });
      return res.status(201).json(
        await db.createClientRevision(req.params.id, caseId, content, ownership(req))
      );
    } catch (err: any) {
      return res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  // DOCX Export Endpoint
  app.get("/api/drafts/:id/export", async (req, res) => {
    try {
      const caseId = requestedCaseId(req.query.caseId);
      if (!caseId) return res.status(400).json({ error: "Matter context is required" });
      const draft = await db.getDraftById(req.params.id, caseId, ownership(req));
      if (!draft) {
        return res.status(404).json({ error: "Work Product not found" });
      }

      const buffer = await Packer.toBuffer(markdownToDocxDocument(draft.title, cleanWorkProductContent(draft.content)));

      // Clean title for safe attachment name
      const safeTitle = draft.title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.docx"`);
      res.send(buffer);

    } catch (err: any) {
      console.error("DOCX Export Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- VITE MIDDLEWARE SETUP ---

  app.use(async (req, res, next) => {
    if (
      req.method !== "GET" ||
      !isSiteLocked(siteLockPolicy) ||
      !isProtectedApplicationPath(req.path)
    ) {
      return next();
    }
    try {
      const token = parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);
      const account = token ? await db.getSessionAccount(hashSessionToken(token)) : null;
      if (canAccessPrivateApplication(account?.user.email, siteLockPolicy)) return next();
    } catch (error) {
      console.error("Protected page site-lock validation failed.");
    }
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, "/");
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
