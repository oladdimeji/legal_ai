import express from "express";
import type { NextFunction, Request, Response } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { db } from "./server/db.js";
import type { OwnershipContext } from "./server/db.js";
import { callModel, MODEL_CONFIGS } from "./server/model.js";
import { CourtListenerAdapter } from "./server/connectors/courtlistener.js";
import { GovInfoAdapter } from "./server/connectors/govinfo.js";
import { Document, Citation, Message, Draft, ResearchStep } from "./src/types.js";
import { Document as DocxDocument, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
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

function ownedErrorStatus(error: unknown): number {
  return error instanceof Error && /not found/i.test(error.message) ? 404 : 500;
}

function cleanSourceText(text: string): string {
  return text.replace(/\[cit_\d+\]/g, "");
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
Output ONLY the final enhanced text, do not add conversational pleasantries or explanation.

Raw prompt: "${prompt}"`;

      const result = await callModel("classify-complexity", [{ role: "user", content: enhancePrompt }]);
      res.json({ improved: result.text.trim() });
    } catch (err: any) {
      console.error("Error improving prompt:", err);
      res.status(500).json({ error: err.message });
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

  app.post("/api/cases", async (req, res) => {
    try {
      const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
      const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
      const startingNote = typeof req.body.startingNote === "string" ? req.body.startingNote.trim() : "";
      const startingDocument = req.body.startingDocument &&
        typeof req.body.startingDocument.title === "string" &&
        typeof req.body.startingDocument.text === "string" &&
        req.body.startingDocument.title.trim() && req.body.startingDocument.text.trim()
        ? { title: req.body.startingDocument.title.trim(), text: req.body.startingDocument.text.trim() }
        : null;
      const libraryDocumentIds: string[] = Array.isArray(req.body.libraryDocumentIds)
        ? req.body.libraryDocumentIds.filter((id: unknown): id is string => typeof id === "string")
        : [];
      if (!name || !description) {
        return res.status(400).json({ error: "Matter name and assignment description are required" });
      }
      if (!startingNote && !startingDocument && libraryDocumentIds.length === 0) {
        return res.status(400).json({ error: "At least one starting input is required" });
      }
      const requestOwnership = ownership(req);
      if (!(await db.validateFirmLibraryDocuments(libraryDocumentIds, requestOwnership))) {
        return res.status(404).json({ error: "Firm Library starting document not found" });
      }
      const newCase = await db.createCase(name, description, requestOwnership, {
        clientName: typeof req.body.clientName === "string" ? req.body.clientName.trim() : null,
        clientEmail: typeof req.body.clientEmail === "string" ? req.body.clientEmail.trim() : null,
      });
      if (startingNote) {
        await db.uploadDocument(
          `Starting instruction — ${name}`, startingNote, requestOwnership,
          null, null, newCase.id, "Starting Instruction", "Lawyer"
        );
      }
      if (startingDocument) {
        await db.uploadDocument(
          startingDocument.title, startingDocument.text, requestOwnership,
          null, null, newCase.id, "Matter Upload", "Lawyer"
        );
      }
      for (const documentId of Array.from(new Set(libraryDocumentIds))) {
        await db.linkLibraryDocument(newCase.id, documentId, "Starting Input", requestOwnership);
      }
      await db.touchCase(newCase.id, requestOwnership);
      res.status(201).json(newCase);
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

  app.post("/api/cases/:id/sources", async (req, res) => {
    try {
      const requestOwnership = ownership(req);
      const matter = await db.getCaseById(req.params.id, requestOwnership);
      if (!matter) return res.status(404).json({ error: "Matter not found" });
      if (typeof req.body.libraryDocumentId === "string") {
        const linked = await db.linkLibraryDocument(
          matter.id, req.body.libraryDocumentId, "Manual", requestOwnership
        );
        if (!linked) return res.status(404).json({ error: "Firm Library document not found" });
        await db.touchCase(matter.id, requestOwnership);
        return res.status(201).json({ linked: true });
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

  // Documents Library
  app.get("/api/documents", async (req, res) => {
    const caseId = requestedCaseId(req.query.caseId);
    res.json(await db.getDocuments(ownership(req), caseId));
  });

  // Upload/create Document
  app.post("/api/documents", async (req, res) => {
    try {
      const { title, text, sourceUrl, driveId, caseId } = req.body;
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

    if (!content) {
      return res.status(400).json({ error: "Message content is required" });
    }

    try {
      const requestOwnership = ownership(req);
      const thread = await db.getThreadById(threadId, requestOwnership);
      if (!thread) {
        return res.status(404).json({ error: "Thread not found" });
      }

      // Save user message first
      const userMessage = await db.addMessage(threadId, "user", content, requestOwnership);

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
          const allLocalChunks = await db.vectorSearch(subQ, scope, requestOwnership, 2);
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
              sourceName: "Workspace Library"
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

          // Generate sub-step note via AI (using cheaper/lighter model)
          const contextText = localChunks.map(c => c.chunk_text).concat(clResults.map(r => r.textSnippet), giResults.map(r => r.textSnippet)).join("\n\n");
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
          ? "1. If the section 'Gathered legal references to use and reference' above says \"No internal document matches.\" (or has no actual workspace document snippets) AND you do not have any active search grounding results or other sources, you MUST respond EXACTLY with: \"I could not find any relevant documents in your Workspace Library regarding this topic.\" and do NOT attempt to answer using your general external knowledge."
          : "1. If the section 'Gathered legal references to use and reference' above says \"No internal document matches.\" (or has no actual workspace document snippets), you MUST respond EXACTLY with: \"I could not find any relevant documents in your Workspace Library regarding this topic.\" and you MUST NOT attempt to answer or generate any explanation using your general external knowledge. You are strictly forbidden from simulating or fabricating any search results, external knowledge, or citations.";

        const citationInstSearch = enableWebSearch === true
          ? "- For Google Search grounding references, cite them using the bracketed numbers (e.g., [1], [2]) that match the search grounding chunks."
          : "- You DO NOT have access to Google Search grounding. You MUST NOT include any bracketed numbers like [1] or [2] in your text, and you MUST NOT simulate any search grounding citations.";

        const synthesisPrompt = `You are an elite legal research assistant. 
We have broken down the primary question and retrieved specialized legal sources.
Answer the primary legal question comprehensively using ONLY the gathered sources below ${groundingToolsDesc}
Do not invent anything. If the sources do not provide an answer, state that information is limited.

Gathered legal references to use and reference:
${totalGatheredContext || "No internal document matches."}

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

        // Rewrite any inline grounding search numbers (e.g. [1], [2], or within multi-citations like [cit_1, 2, 3]) to use the unified [cit_X] tags
        let text = finalResult.text;
        if (finalResult.groundingMetadata?.groundingChunks) {
          text = text.replace(/\[([^\]]+)\]/g, (match, inner) => {
            const items = inner.split(",");
            const rewrittenItems: string[] = [];
            let hasChanges = false;

            for (const item of items) {
              const trimmed = item.trim();
              if (/^\d+$/.test(trimmed)) {
                const num = parseInt(trimmed, 10);
                const index = num - 1;
                if (chunkIndexToCitId[index]) {
                  rewrittenItems.push(chunkIndexToCitId[index]);
                  hasChanges = true;
                } else {
                  rewrittenItems.push(`cit_${trimmed}`);
                  hasChanges = true;
                }
              } else {
                rewrittenItems.push(trimmed);
              }
            }

            if (hasChanges || items.length > 1) {
              return rewrittenItems.map(x => `[${x}]`).join("");
            }

            return match;
          });
        }

        finalContent = text;

      } else {
        // STANDARD RESEARCH FLOW (Single shot lookup)
        console.log(`[Standard Research] Performing single-shot legal lookup for: "${content}"...`);

        // Perform parallel lookups
        const [allLocalChunks, clResults, giResults] = await Promise.all([
          db.vectorSearch(content, scope, requestOwnership, 3),
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
            sourceName: "Workspace Library"
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

        const totalGatheredContext = citations
          .map((c) => `[${c.id}] Source: ${c.sourceName} - ${c.title}\nText Snippet: ${c.textSnippet}`)
          .join("\n\n");

        const groundingToolsDesc = enableWebSearch === true
          ? "AND the live Google Search grounding tool."
          : "and you DO NOT have access to any external search grounding tools or internet search. You MUST rely ONLY on the provided Sources above.";

        const groundingInst1 = enableWebSearch === true
          ? "1. If the section 'Provided Sources' above says \"No internal document matches.\" (or has no actual workspace document snippets) AND you do not have any active search grounding results or other sources, you MUST respond EXACTLY with: \"I could not find any relevant documents in your Workspace Library regarding this topic.\" and do NOT attempt to answer using your general external knowledge."
          : "1. If the section 'Provided Sources' above says \"No internal document matches.\" (or has no actual workspace document snippets), you MUST respond EXACTLY with: \"I could not find any relevant documents in your Workspace Library regarding this topic.\" and you MUST NOT attempt to answer or generate any explanation using your general external knowledge. You are strictly forbidden from simulating or fabricating any search results, external knowledge, or citations.";

        const citationInstSearch = enableWebSearch === true
          ? "- For Google Search grounding references, cite them using the bracketed numbers (e.g., [1], [2]) that match the search grounding chunks."
          : "- You DO NOT have access to Google Search grounding. You MUST NOT include any bracketed numbers like [1] or [2] in your text, and you MUST NOT simulate any search grounding citations.";

        const chatPrompt = `You are an elite legal research assistant.
Answer the legal query using the provided library sources below ${groundingToolsDesc}
Cite your statements using the inline square bracket tags matching the Source ID, e.g. [cit_1] or [cit_2].
Stay strict, professional, objective, and use clear legal logic.

Provided Sources:
${totalGatheredContext || "No internal document matches."}

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

        // Rewrite any inline grounding search numbers (e.g. [1], [2], or within multi-citations like [cit_1, 2, 3]) to use the unified [cit_X] tags
        let text = finalResult.text;
        if (finalResult.groundingMetadata?.groundingChunks) {
          text = text.replace(/\[([^\]]+)\]/g, (match, inner) => {
            const items = inner.split(",");
            const rewrittenItems: string[] = [];
            let hasChanges = false;

            for (const item of items) {
              const trimmed = item.trim();
              if (/^\d+$/.test(trimmed)) {
                const num = parseInt(trimmed, 10);
                const index = num - 1;
                if (chunkIndexToCitId[index]) {
                  rewrittenItems.push(chunkIndexToCitId[index]);
                  hasChanges = true;
                } else {
                  rewrittenItems.push(`cit_${trimmed}`);
                  hasChanges = true;
                }
              } else {
                rewrittenItems.push(trimmed);
              }
            }

            if (hasChanges || items.length > 1) {
              return rewrittenItems.map(x => `[${x}]`).join("");
            }

            return match;
          });
        }

        finalContent = text;
      }

      // Save assistant message with aggregated citations and steps
      const assistantMessage = await db.addMessage(
        threadId,
        "assistant",
        finalContent,
        requestOwnership,
        citations,
        researchSteps
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
  app.get("/api/drafts", async (req, res) => {
    const caseId = requestedCaseId(req.query.caseId);
    res.json(await db.getDrafts(ownership(req), caseId));
  });

  app.get("/api/drafts/:id", async (req, res) => {
    const caseId = requestedCaseId(req.query.caseId);
    if (!caseId) return res.status(400).json({ error: "Matter context is required" });
    const draft = await db.getDraftById(req.params.id, caseId, ownership(req));
    if (!draft) {
      return res.status(404).json({ error: "Draft not found" });
    }
    res.json(draft);
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

      const messages = await db.getMessages(threadId, requestOwnership);
      if (messages.length === 0) {
        return res.status(400).json({ error: "Cannot generate draft from empty conversation" });
      }

      // Compile conversation history for the drafting model
      const convoHistory = messages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n\n");

      const draftPrompt = `You are a meticulous legal counsel drafting an formal document based on legal research.
Draft a high-quality ${format.toUpperCase()} (e.g., memo, email advice, or legal summary) based on the legal consultation conversation history and references provided below.

Conversation History:
${convoHistory}

Custom Instructions:
${instructions || "Ensure high-level professionalism and clear structure."}

INSTRUCTIONS:
1. Adhere to proper legal formatting for a ${format}:
   - Legal Memo: Include To, From, Date, Subject, Question Presented, Brief Answer, Statement of Facts, Discussion, and Conclusion sections.
   - Professional Legal Email: Include clear greeting, analytical overview, breakdown of issues, next steps, and professional disclaimer.
   - Legal Summary: Analytical breakdown of the primary matter, facts, governing laws, and key recommendations.
2. Carry over all relevant citation references (like [cit_1] or external case names) inline or as footnotes.
3. Output the draft using elegant, rich markdown with readable headers. Do not wrap in generic JSON, just output the clean draft text.`;

      const draftResult = await callModel("draft-generation", [{ role: "user", content: draftPrompt }], {
        temperature: 0.3
      });

      const title = `Legal ${format.charAt(0).toUpperCase() + format.slice(1)} - Thread Ref: ${thread.title.substring(0, 30)}`;
      const newDraft = await db.createDraft(
        threadId,
        thread.case_id,
        title,
        draftResult.text,
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
      const updated = await db.updateDraft(req.params.id, caseId, content, ownership(req));
      res.json(updated);
    } catch (err: any) {
      res.status(ownedErrorStatus(err)).json({ error: err.message });
    }
  });

  // DOCX Export Endpoint
  app.get("/api/drafts/:id/export", async (req, res) => {
    try {
      const caseId = requestedCaseId(req.query.caseId);
      if (!caseId) return res.status(400).json({ error: "Matter context is required" });
      const draft = await db.getDraftById(req.params.id, caseId, ownership(req));
      if (!draft) {
        return res.status(404).json({ error: "Draft not found" });
      }

      // Parse the markdown draft to lines for a simple clean DOCX document
      const lines = draft.content.split("\n");
      const paragraphs: Paragraph[] = [];

      // Add a clean header
      paragraphs.push(
        new Paragraph({
          text: draft.title,
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 200 }
        })
      );

      // Simple markdown parser to docx paragraphs
      lines.forEach((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("# ")) {
          paragraphs.push(
            new Paragraph({
              text: trimmed.replace("# ", ""),
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 240, after: 120 }
            })
          );
        } else if (trimmed.startsWith("## ")) {
          paragraphs.push(
            new Paragraph({
              text: trimmed.replace("## ", ""),
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 100 }
            })
          );
        } else if (trimmed.startsWith("### ")) {
          paragraphs.push(
            new Paragraph({
              text: trimmed.replace("### ", ""),
              heading: HeadingLevel.HEADING_3,
              spacing: { before: 160, after: 80 }
            })
          );
        } else if (trimmed) {
          // Standard text paragraph
          // Bold matches
          const boldRegex = /\*\*(.*?)\*\*/g;
          const runs: TextRun[] = [];
          let lastIdx = 0;
          let match;

          while ((match = boldRegex.exec(trimmed)) !== null) {
            const index = match.index;
            if (index > lastIdx) {
              runs.push(new TextRun(trimmed.substring(lastIdx, index)));
            }
            runs.push(
              new TextRun({
                text: match[1],
                bold: true
              })
            );
            lastIdx = boldRegex.lastIndex;
          }

          if (lastIdx < trimmed.length) {
            runs.push(new TextRun(trimmed.substring(lastIdx)));
          }

          paragraphs.push(
            new Paragraph({
              children: runs.length > 0 ? runs : [new TextRun(trimmed)],
              spacing: { after: 120 }
            })
          );
        } else {
          // Blank line
          paragraphs.push(new Paragraph({ spacing: { after: 80 } }));
        }
      });

      const docx = new DocxDocument({
        sections: [
          {
            properties: {},
            children: paragraphs
          }
        ]
      });

      const buffer = await Packer.toBuffer(docx);

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
