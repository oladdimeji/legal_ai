import express from "express";
import type { NextFunction, Request, Response } from "express";
import path from "path";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { db } from "./server/db.js";
import type { OwnershipContext } from "./server/db.js";
import { callModel, MODEL_CONFIGS } from "./server/model.js";
import { CourtListenerAdapter } from "./server/connectors/courtlistener.js";
import { GovInfoAdapter } from "./server/connectors/govinfo.js";
import { Document, Citation, Message, Draft, ResearchStep } from "./src/types.js";
import { Packer } from "docx";
import { extractUploads, MAX_FILE_COUNT, MAX_FILE_SIZE_BYTES } from "./server/fileExtraction.js";
import { markdownToDocxDocument } from "./server/docxMarkdown.js";
import { cleanMatterIntelligenceContent } from "./server/matterIntelligenceContent.js";
import { cleanGeneratedBoilerplate } from "./server/generatedContentCleanup.js";
import { canonicalizeAssistantCitations, rewriteGoogleGroundingCitations, stripInternalCitationsForWorkProduct } from "./src/lib/assistantCitations.js";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  parseCookie,
  sessionCookie,
  verifyPassword,
} from "./server/auth.js";

const isProduction = process.env.NODE_ENV === "production";
const PORT = 3000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SIMILARITY_THRESHOLD = 0.65;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_FILE_COUNT },
});

interface AuthenticatedRequest extends Request {
  auth?: {
    user: { id: string; firm_id: string; name: string; email: string };
    firm: { id: string; name: string };
  };
}

function ownership(req: Request): OwnershipContext {
  const auth = (req as AuthenticatedRequest).auth!;
  return { userId: auth.user.id, firmId: auth.firm.id };
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

  app.post("/api/auth/signup", async (req, res) => {
    try {
      const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
      const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const password = typeof req.body.password === "string" ? req.body.password : "";
      if (!name || !email || !email.includes("@") || password.length < 8) {
        return res.status(400).json({
          error: "Name, a valid email, and a password of at least 8 characters are required.",
        });
      }

      const passwordHash = await hashPassword(password);
      const { token, tokenHash } = createSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const account = await db.createAccount(name, email, passwordHash, tokenHash, expiresAt);
      res.setHeader("Set-Cookie", sessionCookie(token, isProduction));
      res.setHeader("Cache-Control", "no-store");
      return res.status(201).json(account);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(409).json({ error: "An account with that email already exists." });
      }
      console.error("Signup failed:", err);
      return res.status(500).json({ error: "Unable to create the account." });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const password = typeof req.body.password === "string" ? req.body.password : "";
      const user = email && password ? await db.getUserForLogin(email) : null;
      const valid = user ? await verifyPassword(password, user.password_hash) : false;
      if (!user || !valid) {
        return res.status(401).json({ error: "Invalid email or password." });
      }

      const { token, tokenHash } = createSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      await db.createSession(user.id, tokenHash, expiresAt);
      const account = await db.getSessionAccount(tokenHash);
      if (!account) throw new Error("Session could not be loaded after login.");
      res.setHeader("Set-Cookie", sessionCookie(token, isProduction));
      res.setHeader("Cache-Control", "no-store");
      return res.json(account);
    } catch (err) {
      console.error("Login failed:", err);
      return res.status(500).json({ error: "Unable to sign in." });
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
      req.auth = account;
      return next();
    } catch (err) {
      console.error("Session validation failed:", err);
      return res.status(500).json({ error: "Unable to validate the session." });
    }
  };

  app.get("/api/auth/me", requireAuth, (req: AuthenticatedRequest, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.json(req.auth);
  });

  const portalTokenHash = (token: string) => hashSessionToken(decodeURIComponent(token));

  // Client Portal routes use a separate, Matter-specific invitation token rather than lawyer sessions.
  app.get("/api/portal/:token", async (req, res) => {
    const summary = await db.getPortalSummary(portalTokenHash(req.params.token));
    res.setHeader("Cache-Control", "no-store");
    if (!summary) return res.status(404).json({ error: "Client Portal access is unavailable" });
    return res.json(summary);
  });

  app.get("/api/portal/:token/work-product/:draftId", async (req, res) => {
    const draft = await db.getPermittedPortalDraft(
      portalTokenHash(req.params.token), req.params.draftId
    );
    res.setHeader("Cache-Control", "no-store");
    if (!draft) return res.status(404).json({ error: "Shared Work Product not found" });
    return res.json({ ...draft, content: cleanWorkProductContent(draft.content) });
  });

  app.get("/api/portal/:token/work-product/:draftId/download", async (req, res) => {
    const draft = await db.getPermittedPortalDraft(
      portalTokenHash(req.params.token), req.params.draftId
    );
    if (!draft) return res.status(404).json({ error: "Shared Work Product not found" });
    const buffer = await Packer.toBuffer(markdownToDocxDocument(draft.title, cleanWorkProductContent(draft.content)));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${draft.title.replace(/[^a-z0-9]/gi, "_")}.docx"`);
    return res.send(buffer);
  });

  app.post("/api/portal/:token/work-product/:draftId/comments", async (req, res) => {
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

  app.post("/api/portal/:token/work-product/:draftId/edit-copy", async (req, res) => {
    try {
      const content = typeof req.body.content === "string" ? cleanWorkProductContent(req.body.content) : "";
      return res.status(201).json(await db.createPortalClientRevision(
        portalTokenHash(req.params.token), req.params.draftId, content
      ));
    } catch {
      return res.status(404).json({ error: "Shared Work Product not found" });
    }
  });

  app.post("/api/portal/:token/documents", upload.array("files", MAX_FILE_COUNT), async (req, res) => {
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

  app.post("/api/portal/:token/requests/:requestId/responses", upload.array("files", MAX_FILE_COUNT), async (req, res) => {
    try {
      const allowed = new Set(["Acknowledgement", "Comment", "Upload files", "Shared files"]);
      const type = typeof req.body.type === "string" ? req.body.type : "";
      if (!allowed.has(type)) return res.status(400).json({ error: "Invalid client response type" });
      const tokenHash = portalTokenHash(req.params.token);
      const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
      if (type === "Comment" && !content) return res.status(400).json({ error: "Comment text is required" });
      const uploadedDocumentIds: string[] = [];
      if (type === "Upload files") {
        const extracted = await extractUploads((req.files || []) as Express.Multer.File[]);
        if (extracted.length === 0) return res.status(400).json({ error: "Select at least one file to upload" });
        for (const file of extracted) {
          const document = await db.uploadPortalDocument(tokenHash, file.filename, file.text);
          uploadedDocumentIds.push(document.id);
        }
      }
      const rawDraftIds = typeof req.body.draftIds === "string" ? JSON.parse(req.body.draftIds || "[]") : req.body.draftIds;
      const draftIds = Array.isArray(rawDraftIds) ? rawDraftIds.filter((id: unknown): id is string => typeof id === "string") : [];
      return res.status(201).json(await db.createPortalResponse(
        tokenHash, req.params.requestId, type, content || null, uploadedDocumentIds, type === "Shared files" ? draftIds : []
      ));
    } catch {
      return res.status(404).json({ error: "Client request or attachment not found" });
    }
  });

  app.post("/api/portal/:token/assistant", async (req, res) => {
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
        .map((message: any) => `${message.role.toUpperCase()}: ${message.content}`)
        .join("\n\n");
      const prompt = `You are a document-understanding assistant for an external legal client.
Answer ONLY from the documents selected below. Provide a plain-language explanation, summary, clause clarification, or grounded answer. Cite sources as [Source: exact title].
Do not provide external legal research, and do not imply access to the Firm Library, Matter Intelligence, lawyer conversations, or unshared material.
Do not append generic legal-advice, AI, lawyer-review, consultation, informational-purpose, or limitation-of-liability disclaimer boilerplate. State genuine evidentiary uncertainty directly and specifically instead.
Prior assistant conversation is only for resolving follow-up references, not an additional source.

PRIOR CHAT:
${history || "No prior chat."}

CLIENT QUESTION: ${query}\n\nSELECTED DOCUMENTS:\n${context}`;
      const result = await callModel("client-assistant", [{ role: "user", content: prompt }], { temperature: 0.2 });
      const cleanedText = cleanGeneratedText(result.text);
      const assistantMessage = await db.addPortalChatMessage(tokenHash, "assistant", cleanedText, selectedLabels);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ userMessage, assistantMessage, text: cleanedText, sources: selectedLabels });
    } catch (err: any) {
      const status = /not available/i.test(err.message) ? 404 : 500;
      return res.status(status).json({ error: err.message });
    }
  });

  // All remaining API routes require a server-validated session.
  app.use("/api", requireAuth);

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

  app.post("/api/cases/:caseId/collaboration/invite", async (req, res) => {
    try {
      const { token, tokenHash } = createSessionToken();
      const access = await db.activateClientInvite(req.params.caseId, tokenHash, ownership(req));
      res.setHeader("Cache-Control", "no-store");
      return res.json({ access, invitePath: `/client/${encodeURIComponent(token)}` });
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
    const { content, forceDeepResearch, enableWebSearch, enableCourtListener, enableGovInfo } = req.body;
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
          
          // Connectors Query
          const clResults = enableCourtListener ? await CourtListenerAdapter.query(subQ) : [];
          const giResults = enableGovInfo ? await GovInfoAdapter.query(subQ) : [];

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

          clResults.forEach((r) => {
            const cit = registerCitation({
              type: "connector",
              title: r.title,
              url: r.url,
              textSnippet: r.textSnippet,
              sourceName: r.sourceName
            });
            stepCitations.push(`[${cit.id}] ${cit.title} (${cit.sourceName})`);
          });

          giResults.forEach((r) => {
            const cit = registerCitation({
              type: "connector",
              title: r.title,
              url: r.url,
              textSnippet: r.textSnippet,
              sourceName: r.sourceName
            });
            stepCitations.push(`[${cit.id}] ${cit.title} (${cit.sourceName})`);
          });

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
          const contextText = localChunks.map(c => c.chunk_text).concat(clResults.map(r => r.textSnippet), giResults.map(r => r.textSnippet), temporaryFiles.map((f) => f.text.slice(0, 4000))).join("\n\n");
          let subNote = "";
          try {
            const noteResult = await callModel("summarize-subquestion", [
              { role: "user", content: `Summarize in 1-2 sentences what was found about "${subQ}" in the following context:\n\n${contextText || "No matching internal legal resources found."}` }
            ]);
            subNote = noteResult.text.trim();
          } catch (err) {
            subNote = "Completed document and connector lookup.";
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

        // Perform parallel lookups
        const [allLocalChunks, clResults, giResults] = await Promise.all([
          db.vectorSearch(retrievalQuery.slice(0, 4000), scope, requestOwnership, 3),
          enableCourtListener ? CourtListenerAdapter.query(content) : Promise.resolve([]),
          enableGovInfo ? GovInfoAdapter.query(content) : Promise.resolve([])
        ]);

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

        clResults.forEach((r) => {
          registerCitation({
            type: "connector",
            title: r.title,
            url: r.url,
            textSnippet: r.textSnippet,
            sourceName: r.sourceName
          });
        });

        giResults.forEach((r) => {
          registerCitation({
            type: "connector",
            title: r.title,
            url: r.url,
            textSnippet: r.textSnippet,
            sourceName: r.sourceName
          });
        });

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
      const { threadId, format, instructions } = req.body; // format = 'memo' | 'email' | 'summary'
      if (!threadId || !format) {
        return res.status(400).json({ error: "Thread ID and format are required" });
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

      const draftPrompt = `You are a meticulous legal counsel drafting a formal document based on legal research.
Draft a high-quality ${format.toUpperCase()} (e.g., memo, email advice, or legal summary) based on the legal consultation conversation history and references provided below.

Matter and account metadata:
${matterMetadata}

Conversation History:
${convoHistory}

Custom Instructions:
${instructions || "Ensure high-level professionalism and clear structure."}

INSTRUCTIONS:
1. Adhere to proper legal formatting for a ${format}:
   - Legal Memo: Include To, From, Date, Subject, Question Presented, Brief Answer, Statement of Facts, Discussion, and Conclusion sections.
   - Professional Legal Email: Include clear greeting, analytical overview, breakdown of issues, and next steps.
   - Legal Summary: Analytical breakdown of the primary matter, facts, governing laws, and key recommendations.
2. Produce a polished standalone work product. Do not include internal source IDs, Assistant citation tokens, numbered source markers, clickable citation syntax, footnotes, endnotes, a references list, or a bibliography unless the user explicitly requests formal citations. Integrate legal authorities naturally into prose by naming the case, statute, regulation, or document when relevant.
3. Use the server-provided current date exactly when a date is needed. Do not invent another date.
4. Do not emit bracketed placeholders such as [Client Name], [Your Name], or [Firm Name] when the metadata supplies those values. If optional metadata is missing, omit that field or use a neutral professional phrasing.
5. Do not append generic legal-advice, AI, lawyer-review, consultation, informational-purpose, or limitation-of-liability disclaimer boilerplate. State genuine evidentiary uncertainty directly and specifically instead. Do not remove substantive analysis of disclaimer clauses contained in the conversation or sources.
6. Output the draft using elegant, rich markdown with readable headers. Do not wrap in generic JSON, just output the clean draft text.`;

      const draftResult = await callModel("draft-generation", [{ role: "user", content: draftPrompt }], {
        temperature: 0.3
      });

      const title = `Legal ${format.charAt(0).toUpperCase() + format.slice(1)} - Thread Ref: ${thread.title.substring(0, 30)}`;
      const newDraft = await db.createDraft(
        threadId,
        thread.case_id,
        title,
        cleanGeneratedWorkProductContent(draftResult.text),
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
