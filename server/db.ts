import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { Document, DocumentChunk, Case, Thread, Message, Draft, Citation } from "../src/types.js";
import { callModel } from "./model.js";
import { runMigrations } from "./migrations.js";
import {
  migrateLegacyDraftsFromEnvironment,
  migrateLegacyOwnerFromEnvironment,
} from "./legacyMigration.js";

const { Pool } = pg;

export interface OwnershipContext {
  userId: string;
  firmId: string;
}

// Lazy initialization of Pool
let poolInstance: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!poolInstance) {
    const connectionString = process.env.SUPABASE_DB_URL;
    if (!connectionString) {
      throw new Error("SUPABASE_DB_URL environment variable is missing. Please set it in Settings > Secrets.");
    }
    poolInstance = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      }
    });
  }
  return poolInstance;
}

// Seed document texts to be embedded on initial launch
const SEED_DOCUMENTS = [
  {
    title: "California Business and Professions Code Section 16600 (Non-Compete)",
    extracted_text: `California Business and Professions Code Section 16600 declares that, except as provided in this chapter, every contract by which anyone is restrained from engaging in a lawful profession, trade, or business of any kind is to that extent void. 
This law establishes a strict, absolute public policy in the State of California against employee non-compete agreements. California courts hold that even narrow restraints on practice are void.
There are very limited statutory exceptions, primarily restricted to the sale of the goodwill of a business, the dissolution of a partnership, or the sale of an ownership interest in a limited liability company (LLC). 
Employers attempting to enforce invalid non-competes in California may face unfair competition claims under Business and Professions Code Section 17200. Furthermore, under recent Senate Bill 699 and Assembly Bill 1076, it is unlawful to present an employee with a non-compete agreement or to attempt to enforce one, regardless of where or when the contract was signed, and employers must notify employees of the invalidity of prior covenants.`,
    section: "Employment Law",
    source_url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=16600.&lawCode=BPC",
    case_id: "case_tech_employment"
  },
  {
    title: "US Copyright Act Section 107 - Limitations on Exclusive Rights: Fair Use",
    extracted_text: `Notwithstanding the provisions of section 106 and 106A, the fair use of a copyrighted work, including such use by reproduction in copies or phonorecords or by any other means specified by that section, for purposes such as criticism, comment, news reporting, teaching (including multiple copies for classroom use), scholarship, or research, is not an infringement of copyright.
In determining whether the use made of a work in any particular case is a fair use the factors to be considered shall include:
1. The purpose and character of the use, including whether such use is of a commercial nature or is for nonprofit educational purposes;
2. The nature of the copyrighted work;
3. The amount and substantiality of the portion used in relation to the copyrighted work as a whole; and
4. The effect of the use upon the potential market for or value of the copyrighted work.
The fact that a work is unpublished shall not itself bar a finding of fair use if such finding is made upon due consideration of all the above factors.
Transformative uses are central to fair use analysis, evaluating whether the new work adds something new, with a further purpose or different character, altering the first with new expression, meaning, or message.`,
    section: "Intellectual Property",
    source_url: "https://www.copyright.gov/title17/92chap1.html#107",
    case_id: "case_ip_fair_use"
  },
  {
    title: "Supreme Court Guidelines on Executive Privilege (United States v. Nixon)",
    extracted_text: `Executive privilege is the implied power of the President and other executive branch members of the United States government to resist certain congressional and judicial interventions, such as subpoenas.
In the landmark case United States v. Nixon (1974), the Supreme Court recognized a constitutional basis for executive privilege but ruled that it is not absolute. 
The Court held that the generalized assertion of privilege cannot prevail over the fundamental demands of due process of law in the fair administration of criminal justice.
The interest in preserving confidentiality is weighty, but must yield to a demonstrated, specific need for evidence in a pending criminal trial.
Therefore, the President must comply with a judicial subpoena for tape recordings and documents relevant to a criminal trial, establishing that judicial review is supreme over executive immunity assertions.`,
    section: "Constitutional Law",
    source_url: "https://supreme.justia.com/cases/federal/us/418/683/",
    case_id: null
  },
  {
    title: "Federal Rule of Evidence 403 - Excluding Relevant Evidence for Prejudice, Confusion, Waste of Time, or Other Reasons",
    extracted_text: `The court may exclude relevant evidence if its probative value is substantially outweighed by a danger of one or more of the following: unfair prejudice, confusing the issues, misleading the jury, undue delay, wasting time, or needlessly presenting cumulative evidence.
This rule is one of the most critical tools in federal trial practice, granting the presiding judge broad discretion to manage the flow of information during a trial.
Unfair prejudice means an undue tendency to suggest decision on an improper basis, commonly, though not necessarily, an emotional one.
Confusion of the issues or misleading the jury evaluation focuses on whether the evidence would distract the trier of fact from the core legal questions of the case.
Wasting time and needlessly presenting cumulative evidence are considerations of judicial economy and trial efficiency.`,
    section: "Evidence Law",
    source_url: "https://www.rulesofevidence.org/article-iv/rule-403/",
    case_id: null
  },
  {
    title: "United States Constitution Fourteenth Amendment Section 1 - Citizenship, Due Process, and Equal Protection",
    extracted_text: `All persons born or naturalized in the United States, and subject to the jurisdiction thereof, are citizens of the United States and of the State wherein they reside. No State shall make or enforce any law which shall abridge the privileges or immunities of citizens of the United States; nor shall any State deprive any person of life, liberty, or property, without due process of law; nor deny to any person within its jurisdiction the equal protection of the laws.
The Fourteenth Amendment's Due Process Clause has been used by the Supreme Court to apply most of the Bill of Rights to the states through incorporation.
It also guarantees both procedural due process (fair processes and hearings before deprivation) and substantive due process (protecting fundamental rights from government interference).
The Equal Protection Clause prohibits states from denying any person equal protection under the law, serving as the constitutional basis for major civil rights decisions and anti-discrimination legislation.`,
    section: "Constitutional Law",
    source_url: "https://www.constitution.congress.gov/browse/amendment-14/section-1/",
    case_id: null
  }
];

class DatabaseService {
  private isSchemaInitialized = false;

  private async ensureSchema() {
    if (this.isSchemaInitialized) return;
    await runMigrations(getPool());
    this.isSchemaInitialized = true;
    console.log("PostgreSQL migrations verified successfully.");
  }

  public async initialize(): Promise<void> {
    await this.ensureSchema();
  }

  public isReady(): boolean {
    return this.isSchemaInitialized;
  }

  public async migrateLegacyOwner(): Promise<void> {
    await this.ensureSchema();
    await migrateLegacyOwnerFromEnvironment(getPool());
  }

  public async migrateLegacyDrafts(): Promise<void> {
    await this.ensureSchema();
    await migrateLegacyDraftsFromEnvironment(getPool());
  }

  private async query(text: string, params?: any[]): Promise<any[]> {
    await this.ensureSchema();
    const pool = getPool();
    const res = await pool.query(text, params);
    return res.rows;
  }

  public async seedDemoDataIfEnabled(): Promise<void> {
    if (process.env.SEED_DEMO_DATA !== "true") {
      console.log("Demo data seeding is disabled.");
      return;
    }

    const createdAt = new Date().toISOString();
    await this.query(
      "INSERT INTO firm (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      ["firm_123", "Sterling & Croft LLP"]
    );
    await this.query(
      `INSERT INTO users (id, firm_id, name, email)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      ["user_456", "firm_123", "Oladimeji", "oladimeji@workpodd.com"]
    );
    await this.query(
      `INSERT INTO cases (id, firm_id, name, description, created_at) VALUES
       ($1, $3, $4, $5, $7), ($2, $3, $6, $8, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        "case_tech_employment",
        "case_ip_fair_use",
        "firm_123",
        "California Tech Non-Compete Review",
        "Analysis of non-compete agreements and trade secret protection for engineering staff.",
        "Creative Content Fair Use Evaluation",
        createdAt,
        "Dispute surrounding documentary footage and copyright fair use limits under Section 107.",
      ]
    );

    console.log("Explicit demo seeding enabled; adding only missing demo documents.");
    for (const seed of SEED_DOCUMENTS) {
      const existing = await this.query(
        `SELECT id FROM documents
         WHERE firm_id = $1 AND title = $2 AND case_id IS NOT DISTINCT FROM $3
         LIMIT 1`,
        ["firm_123", seed.title, seed.case_id]
      );
      if (existing.length > 0) continue;

      await this.addDocumentInternal(
        seed.title,
        seed.extracted_text,
        seed.section,
        seed.source_url,
        null,
        seed.case_id,
        "firm_123"
      );
    }
    console.log("Explicit demo seeding completed without deleting existing data.");
  }

  private async addDocumentInternal(
    title: string,
    text: string,
    section: string,
    sourceUrl: string | null = null,
    driveId: string | null = null,
    caseId: string | null = null,
    firmId: string,
    sourceType = caseId ? "Matter Upload" : "Firm Library Document",
    origin = "Lawyer"
  ): Promise<Document> {
    const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const uploadedAt = new Date().toISOString();

    await this.query(
      `INSERT INTO documents
        (id, firm_id, case_id, title, source_url, drive_id, extracted_text, section, uploaded_at,
         source_type, origin, processing_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Processing')`,
      [docId, firmId, caseId, title, sourceUrl, driveId, text, section, uploadedAt, sourceType, origin]
    );

    // Paragraph splitting
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 15);

    console.log(`Generating embeddings for ${paragraphs.length} chunks of "${title}"...`);
    for (let i = 0; i < paragraphs.length; i++) {
      const chunkText = paragraphs[i];
      try {
        const embedding = await callModel("embedding", [], {
          textToEmbed: chunkText
        }) as number[];
        const vectorStr = `[${embedding.join(",")}]`;
        await this.query(
          `INSERT INTO document_chunks (id, document_id, chunk_text, embedding)
           VALUES ($1, $2, $3, $4)`,
          [`chunk_${docId}_${i}`, docId, chunkText, vectorStr]
        );
      } catch (error) {
        console.error(`Embedding generation failed for document ${docId}, chunk ${i}; chunk left unindexed.`, error);
      }
    }
    const indexed = await this.query(
      "SELECT COUNT(*)::int AS count FROM document_chunks WHERE document_id = $1",
      [docId]
    );
    await this.query(
      "UPDATE documents SET processing_state = $1 WHERE id = $2 AND firm_id = $3",
      [Number(indexed[0]?.count || 0) > 0 || paragraphs.length === 0 ? "Ready" : "Needs Attention", docId, firmId]
    );

    return {
      id: docId,
      firm_id: firmId,
      case_id: caseId,
      title,
      source_url: sourceUrl,
      drive_id: driveId,
      extracted_text: text,
      section,
      uploaded_at: uploadedAt
    };
  }

  public async createAccount(
    name: string,
    email: string,
    passwordHash: string,
    tokenHash: string,
    expiresAt: string
  ): Promise<{
    user: { id: string; firm_id: string; name: string; email: string };
    firm: { id: string; name: string };
  }> {
    await this.ensureSchema();
    const client = await getPool().connect();
    const firmId = `firm_${randomUUID()}`;
    const userId = `user_${randomUUID()}`;
    const now = new Date().toISOString();
    const firmName = `${name}'s Workspace`;

    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO firm (id, name) VALUES ($1, $2)", [firmId, firmName]);
      await client.query(
        `INSERT INTO users (id, firm_id, name, email, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [userId, firmId, name, email, passwordHash, now]
      );
      await client.query(
        `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at)
         VALUES ($1, $2, $3, $4, $3)`,
        [tokenHash, userId, now, expiresAt]
      );
      await client.query("COMMIT");
      return {
        user: { id: userId, firm_id: firmId, name, email },
        firm: { id: firmId, name: firmName },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getUserForLogin(email: string): Promise<{
    id: string;
    firm_id: string;
    name: string;
    email: string;
    password_hash: string;
  } | null> {
    const rows = await this.query(
      `SELECT id, firm_id, name, email, password_hash
       FROM users
       WHERE LOWER(BTRIM(email)) = $1 AND password_hash IS NOT NULL`,
      [email]
    );
    return rows[0] || null;
  }

  public async createSession(userId: string, tokenHash: string, expiresAt: string): Promise<void> {
    const now = new Date().toISOString();
    await this.query(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at)
       VALUES ($1, $2, $3, $4, $3)`,
      [tokenHash, userId, now, expiresAt]
    );
  }

  public async getSessionAccount(tokenHash: string): Promise<{
    user: { id: string; firm_id: string; name: string; email: string };
    firm: { id: string; name: string };
  } | null> {
    const now = new Date().toISOString();
    const rows = await this.query(
      `UPDATE sessions s
       SET last_used_at = $2
       FROM users u
       JOIN firm f ON f.id = u.firm_id
       WHERE s.token_hash = $1
         AND s.user_id = u.id
         AND s.expires_at > $2
       RETURNING u.id, u.firm_id, u.name, u.email, f.name AS firm_name`,
      [tokenHash, now]
    );
    if (!rows[0]) return null;
    return {
      user: {
        id: rows[0].id,
        firm_id: rows[0].firm_id,
        name: rows[0].name,
        email: rows[0].email,
      },
      firm: { id: rows[0].firm_id, name: rows[0].firm_name },
    };
  }

  public async deleteSession(tokenHash: string): Promise<void> {
    await this.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  public async getCases(context: OwnershipContext): Promise<Case[]> {
    return await this.query(
      "SELECT * FROM cases WHERE firm_id = $1 ORDER BY COALESCE(last_activity_at, created_at) DESC",
      [context.firmId]
    );
  }

  public async getCaseById(id: string, context: OwnershipContext): Promise<Case | undefined> {
    const rows = await this.query("SELECT * FROM cases WHERE id = $1 AND firm_id = $2", [
      id,
      context.firmId,
    ]);
    return rows[0];
  }

  public async createCase(
    name: string,
    description: string,
    context: OwnershipContext,
    details: { clientName?: string | null; clientEmail?: string | null } = {}
  ): Promise<Case> {
    const caseId = `case_${randomUUID()}`;
    const createdAt = new Date().toISOString();

    await this.query(
      `INSERT INTO cases
        (id, firm_id, name, description, created_at, status, client_name, client_email,
         updated_at, last_activity_at)
       VALUES ($1, $2, $3, $4, $5, 'Open', $6, $7, $5, $5)`,
      [caseId, context.firmId, name, description, createdAt, details.clientName || null, details.clientEmail || null]
    );

    const newCase: Case = {
      id: caseId,
      firm_id: context.firmId,
      name,
      description, created_at: createdAt, status: "Open",
      client_name: details.clientName || null, client_email: details.clientEmail || null,
      updated_at: createdAt, last_activity_at: createdAt,
    };

    try {
      console.log(`Auto-attaching documents for case: "${name}" based on description context...`);
      const searchResults = description
        ? await this.vectorSearch(`${name}\n${description}`, "wide", context, 3)
        : [];
      
      const attachedDocIds = new Set<string>();
      for (const chunk of searchResults) {
        if (chunk.similarity < 0.45) continue;
        const doc = await this.getDocumentById(chunk.document_id, context, null);
        if (doc && !attachedDocIds.has(doc.id)) {
          attachedDocIds.add(doc.id);
          await this.query(
            `INSERT INTO case_documents (case_id, document_id, link_origin, added_at)
             SELECT c.id, d.id, 'AI Suggested', $4
             FROM cases c
             JOIN documents d ON d.id = $2
             WHERE c.id = $1 AND c.firm_id = $3
               AND d.firm_id = $3 AND d.case_id IS NULL
               AND d.is_generated_draft_duplicate = FALSE
             ON CONFLICT DO NOTHING`,
            [caseId, doc.id, context.firmId, createdAt]
          );
          console.log(`Auto-attached document: "${doc.title}" (Score: ${chunk.similarity.toFixed(4)})`);
        }
      }
    } catch (err) {
      console.error("Error auto-attaching documents to case:", err);
    }

    return newCase;
  }

  public async updateCase(
    id: string,
    changes: Partial<Case>,
    context: OwnershipContext
  ): Promise<Case | undefined> {
    const allowedStatuses = new Set(["Open", "Waiting for Client", "On Hold", "Closed"]);
    if (changes.status && !allowedStatuses.has(changes.status)) throw new Error("Invalid Matter status");
    const now = new Date().toISOString();
    const rows = await this.query(
      `UPDATE cases SET
         name = COALESCE($1, name), client_name = $2, client_email = $3,
         matter_type = $4, jurisdiction = $5, preliminary_objectives = $6,
         status = COALESCE($7, status), matter_type_suggested = COALESCE($8, matter_type_suggested),
         jurisdiction_suggested = COALESCE($9, jurisdiction_suggested),
         objectives_suggested = COALESCE($10, objectives_suggested), updated_at = $11,
         last_activity_at = $11
       WHERE id = $12 AND firm_id = $13 RETURNING *`,
      [changes.name ?? null, changes.client_name ?? null, changes.client_email ?? null,
       changes.matter_type ?? null, changes.jurisdiction ?? null,
       changes.preliminary_objectives ?? null, changes.status ?? null,
       changes.matter_type_suggested ?? null, changes.jurisdiction_suggested ?? null,
       changes.objectives_suggested ?? null, now, id, context.firmId]
    );
    return rows[0];
  }

  public async validateFirmLibraryDocuments(ids: string[], context: OwnershipContext): Promise<boolean> {
    if (ids.length === 0) return true;
    const unique = Array.from(new Set(ids));
    const rows = await this.query(
      `SELECT id FROM documents WHERE id = ANY($1::text[]) AND firm_id = $2
       AND case_id IS NULL AND is_generated_draft_duplicate = FALSE`,
      [unique, context.firmId]
    );
    return rows.length === unique.length;
  }

  public async linkLibraryDocument(
    caseId: string, documentId: string, linkOrigin: "Manual" | "Starting Input", context: OwnershipContext
  ): Promise<boolean> {
    const rows = await this.query(
      `INSERT INTO case_documents (case_id, document_id, link_origin, added_at)
       SELECT c.id, d.id, $4, $5 FROM cases c JOIN documents d ON d.id = $2
       WHERE c.id = $1 AND c.firm_id = $3 AND d.firm_id = $3 AND d.case_id IS NULL
         AND d.is_generated_draft_duplicate = FALSE
       ON CONFLICT (case_id, document_id) DO UPDATE SET link_origin = EXCLUDED.link_origin
       RETURNING document_id`,
      [caseId, documentId, context.firmId, linkOrigin, new Date().toISOString()]
    );
    return rows.length === 1;
  }

  public async getCaseSources(caseId: string, context: OwnershipContext): Promise<Document[]> {
    return await this.query(
      `SELECT d.*, CASE WHEN d.case_id = $2 THEN NULL ELSE cd.link_origin END AS link_origin,
        COALESCE(cd.added_at, d.uploaded_at) AS date_added
       FROM cases c
       JOIN documents d ON d.firm_id = c.firm_id
       LEFT JOIN case_documents cd ON cd.case_id = c.id AND cd.document_id = d.id
       WHERE c.id = $2 AND c.firm_id = $1 AND d.is_generated_draft_duplicate = FALSE
         AND (d.case_id = c.id OR (d.case_id IS NULL AND cd.document_id IS NOT NULL))
       ORDER BY COALESCE(cd.added_at, d.uploaded_at) DESC`,
      [context.firmId, caseId]
    );
  }

  public async touchCase(caseId: string, context: OwnershipContext): Promise<void> {
    await this.query(
      "UPDATE cases SET last_activity_at = $1, updated_at = $1 WHERE id = $2 AND firm_id = $3",
      [new Date().toISOString(), caseId, context.firmId]
    );
  }

  public async getMatterSourceSnapshot(caseId: string, context: OwnershipContext): Promise<
    Array<{ id: string; uploaded_at: string; processing_state: string; link_origin: string | null }>
  > {
    return await this.query(
      `SELECT d.id, d.uploaded_at, d.processing_state,
         CASE WHEN d.case_id = $2 THEN NULL ELSE cd.link_origin END AS link_origin
       FROM cases c JOIN documents d ON d.firm_id = c.firm_id
       LEFT JOIN case_documents cd ON cd.case_id = c.id AND cd.document_id = d.id
       WHERE c.id = $2 AND c.firm_id = $1 AND d.is_generated_draft_duplicate = FALSE
         AND (d.case_id = c.id OR (d.case_id IS NULL AND cd.document_id IS NOT NULL))
       ORDER BY d.id`,
      [context.firmId, caseId]
    );
  }

  public async getMatterIntelligence(caseId: string, context: OwnershipContext): Promise<any | null> {
    const rows = await this.query(
      `SELECT mi.* FROM matter_intelligence mi JOIN cases c ON c.id = mi.case_id
       WHERE mi.case_id = $1 AND c.firm_id = $2`,
      [caseId, context.firmId]
    );
    if (!rows[0]) return null;
    const current = await this.getMatterSourceSnapshot(caseId, context);
    const stored = typeof rows[0].source_snapshot === "string"
      ? JSON.parse(rows[0].source_snapshot) : rows[0].source_snapshot;
    return { ...rows[0], source_snapshot: stored, sources_changed: JSON.stringify(stored) !== JSON.stringify(current) };
  }

  public async getMatterIntelligenceSourceBundle(caseId: string, context: OwnershipContext): Promise<{
    matter: Case; sources: Document[]; snapshot: any[];
  }> {
    const matter = await this.getCaseById(caseId, context);
    if (!matter) throw new Error("Matter not found");
    const sources = await this.getCaseSources(caseId, context);
    const snapshot = await this.getMatterSourceSnapshot(caseId, context);
    return { matter, sources, snapshot };
  }

  public async saveGeneratedMatterIntelligence(
    caseId: string, content: string, snapshot: any[], context: OwnershipContext
  ): Promise<any> {
    const now = new Date().toISOString();
    const rows = await this.query(
      `INSERT INTO matter_intelligence
        (case_id, content, source_snapshot, generated_at, last_edited_at, version)
       SELECT c.id, $2, $3::jsonb, $4, $4, 1 FROM cases c
       WHERE c.id = $1 AND c.firm_id = $5
       ON CONFLICT (case_id) DO UPDATE SET content = EXCLUDED.content,
         source_snapshot = EXCLUDED.source_snapshot, generated_at = EXCLUDED.generated_at,
         last_edited_at = EXCLUDED.last_edited_at,
         version = matter_intelligence.version + 1
       RETURNING *`,
      [caseId, content, JSON.stringify(snapshot), now, context.firmId]
    );
    if (!rows[0]) throw new Error("Matter not found");
    await this.touchCase(caseId, context);
    return { ...rows[0], sources_changed: false };
  }

  public async updateMatterIntelligence(
    caseId: string, content: string, context: OwnershipContext
  ): Promise<any> {
    const rows = await this.query(
      `UPDATE matter_intelligence mi SET content = $1, last_edited_at = $2
       WHERE mi.case_id = $3 AND EXISTS (
         SELECT 1 FROM cases c WHERE c.id = mi.case_id AND c.firm_id = $4
       ) RETURNING *`,
      [content, new Date().toISOString(), caseId, context.firmId]
    );
    if (!rows[0]) throw new Error("Matter Intelligence not found");
    return { ...rows[0], sources_changed: false };
  }

  public async getCollaboration(caseId: string, context: OwnershipContext): Promise<any> {
    const matter = await this.getCaseById(caseId, context);
    if (!matter) throw new Error("Matter not found");
    const access = (await this.query(
      `SELECT id, case_id, client_name, client_email, invitation_status, created_at,
        activated_at, revoked_at FROM matter_client_access WHERE case_id = $1`, [caseId]
    ))[0] || null;
    const shared = await this.query(
      `SELECT d.* FROM drafts d JOIN cases c ON c.id = d.case_id
       WHERE d.case_id = $1 AND c.firm_id = $2 AND d.shared_with_client = TRUE
       ORDER BY COALESCE(d.updated_at, d.created_at) DESC`, [caseId, context.firmId]
    );
    for (const draft of shared) {
      draft.client_comments = await this.query(
        `SELECT id, content, created_at FROM portal_comments
         WHERE case_id = $1 AND draft_id = $2 ORDER BY created_at DESC`,
        [caseId, draft.id]
      );
    }
    const requests = await this.query(
      `SELECT cr.* FROM collaboration_requests cr JOIN cases c ON c.id = cr.case_id
       WHERE cr.case_id = $1 AND c.firm_id = $2 ORDER BY cr.created_at DESC`,
      [caseId, context.firmId]
    );
    for (const request of requests) {
      request.documents = await this.query(
        `SELECT d.* FROM collaboration_request_documents rd JOIN drafts d ON d.id = rd.draft_id
         WHERE rd.request_id = $1 AND d.case_id = $2`, [request.id, caseId]
      );
      request.responses = await this.query(
        `SELECT r.* FROM client_responses r WHERE r.request_id = $1 ORDER BY r.created_at DESC`,
        [request.id]
      );
      for (const response of request.responses) {
        response.attachments = await this.getResponseAttachments(response.id);
      }
    }
    const unread = requests.reduce(
      (count: number, request: any) => count + request.responses.filter((response: any) => !response.is_read).length,
      0
    );
    return { matter, access, shared, requests, unread };
  }

  public async saveClientCollaborator(
    caseId: string, name: string, email: string, context: OwnershipContext
  ): Promise<any> {
    const id = `client_${randomUUID()}`;
    const now = new Date().toISOString();
    const rows = await this.query(
      `INSERT INTO matter_client_access
        (id, case_id, client_name, client_email, invitation_status, created_at)
       SELECT $1, c.id, $3, $4, 'Pending', $5 FROM cases c
       WHERE c.id = $2 AND c.firm_id = $6
       ON CONFLICT (case_id) DO UPDATE SET client_name = EXCLUDED.client_name,
         client_email = EXCLUDED.client_email
       RETURNING id, case_id, client_name, client_email, invitation_status, created_at,
         activated_at, revoked_at`,
      [id, caseId, name, email, now, context.firmId]
    );
    if (!rows[0]) throw new Error("Matter not found");
    return rows[0];
  }

  public async activateClientInvite(
    caseId: string, tokenHash: string, context: OwnershipContext
  ): Promise<any> {
    const now = new Date().toISOString();
    const rows = await this.query(
      `UPDATE matter_client_access ca SET token_hash = $1, invitation_status = 'Active',
         activated_at = $2, revoked_at = NULL
       WHERE ca.case_id = $3 AND EXISTS (
         SELECT 1 FROM cases c WHERE c.id = ca.case_id AND c.firm_id = $4
       ) RETURNING id, case_id, client_name, client_email, invitation_status,
         created_at, activated_at, revoked_at`,
      [tokenHash, now, caseId, context.firmId]
    );
    if (!rows[0]) throw new Error("Client collaborator not found");
    return rows[0];
  }

  public async revokeClientInvite(caseId: string, context: OwnershipContext): Promise<any> {
    const rows = await this.query(
      `UPDATE matter_client_access ca SET token_hash = NULL, invitation_status = 'Revoked', revoked_at = $1
       WHERE ca.case_id = $2 AND EXISTS (
         SELECT 1 FROM cases c WHERE c.id = ca.case_id AND c.firm_id = $3
       ) RETURNING id, case_id, client_name, client_email, invitation_status,
         created_at, activated_at, revoked_at`,
      [new Date().toISOString(), caseId, context.firmId]
    );
    if (!rows[0]) throw new Error("Client collaborator not found");
    return rows[0];
  }

  public async createCollaborationRequest(
    caseId: string, requestType: string, instruction: string, draftIds: string[], context: OwnershipContext
  ): Promise<any> {
    const allowed = new Set(["Review", "Comment", "Confirm information", "Upload a document", "Edit and return a copy", "Provide a written response"]);
    if (!allowed.has(requestType)) throw new Error("Invalid collaboration request type");
    const unique = Array.from(new Set(draftIds));
    if (unique.length === 0) throw new Error("Select at least one Work Product document");
    const owned = await this.query(
      `SELECT d.id FROM drafts d JOIN cases c ON c.id = d.case_id
       WHERE d.id = ANY($1::text[]) AND d.case_id = $2 AND c.firm_id = $3`,
      [unique, caseId, context.firmId]
    );
    if (owned.length !== unique.length) throw new Error("Work Product not found");
    const id = `request_${randomUUID()}`;
    const now = new Date().toISOString();
    const inserted = await this.query(
      `INSERT INTO collaboration_requests
        (id, case_id, request_type, instruction, status, created_at, updated_at)
       SELECT $1, c.id, $3, $4, 'Sent', $5, $5 FROM cases c
       WHERE c.id = $2 AND c.firm_id = $6 RETURNING *`,
      [id, caseId, requestType, instruction, now, context.firmId]
    );
    if (!inserted[0]) throw new Error("Matter not found");
    for (const draftId of unique) {
      await this.query(
        "INSERT INTO collaboration_request_documents(request_id, draft_id) VALUES($1, $2)",
        [id, draftId]
      );
    }
    return { ...inserted[0], documents: owned, responses: [] };
  }

  private async getResponseAttachments(responseId: string): Promise<any[]> {
    return await this.query(
      `SELECT a.id, a.response_id, a.document_id, a.draft_id, a.created_at,
         d.title AS document_title, w.title AS draft_title, w.origin AS draft_origin, w.revision_type
       FROM client_response_attachments a
       LEFT JOIN documents d ON d.id = a.document_id
       LEFT JOIN drafts w ON w.id = a.draft_id
       WHERE a.response_id = $1
       ORDER BY a.created_at`,
      [responseId]
    );
  }

  public async validatePortalRequest(tokenHash: string, requestId: string): Promise<any | null> {
    const access = await this.resolvePortalAccess(tokenHash);
    if (!access) return null;
    const rows = await this.query(
      "SELECT id FROM collaboration_requests WHERE id = $1 AND case_id = $2",
      [requestId, access.case_id]
    );
    return rows[0] ? access : null;
  }

  public async markCollaborationResponseRead(
    caseId: string, responseId: string, context: OwnershipContext
  ): Promise<boolean> {
    const rows = await this.query(
      `UPDATE client_responses r SET is_read = TRUE
       WHERE r.id = $1 AND EXISTS (
         SELECT 1 FROM collaboration_requests cr JOIN cases c ON c.id = cr.case_id
         WHERE cr.id = r.request_id AND cr.case_id = $2 AND c.firm_id = $3
       ) RETURNING r.id`,
      [responseId, caseId, context.firmId]
    );
    return rows.length === 1;
  }

  public async resolvePortalAccess(tokenHash: string): Promise<any | null> {
    const rows = await this.query(
      `SELECT ca.id AS access_id, ca.case_id, ca.client_name, ca.client_email,
         c.firm_id, c.name AS matter_name
       FROM matter_client_access ca JOIN cases c ON c.id = ca.case_id
       WHERE ca.token_hash = $1 AND ca.invitation_status = 'Active' AND ca.revoked_at IS NULL`,
      [tokenHash]
    );
    return rows[0] || null;
  }

  public async getPortalSummary(tokenHash: string): Promise<any | null> {
    const access = await this.resolvePortalAccess(tokenHash);
    if (!access) return null;
    const shared = await this.query(
      `SELECT id, case_id, title, content, created_at, updated_at, origin,
         parent_draft_id, revision_type
       FROM drafts WHERE case_id = $1 AND (shared_with_client = TRUE OR revision_type = 'Client Revision')
       ORDER BY COALESCE(updated_at, created_at) DESC`, [access.case_id]
    );
    const requests = await this.query(
      `SELECT cr.id, cr.request_type, cr.instruction, cr.status, cr.created_at, cr.updated_at,
         MAX(r.created_at) AS latest_response_at,
         COUNT(r.id)::int AS response_count
       FROM collaboration_requests cr
       LEFT JOIN client_responses r ON r.request_id = cr.id
       WHERE cr.case_id = $1
       GROUP BY cr.id
       ORDER BY CASE WHEN COUNT(r.id) = 0 THEN 0 ELSE 1 END ASC,
         COALESCE(MAX(r.created_at), cr.created_at) DESC`,
      [access.case_id]
    );
    for (const request of requests) {
      request.documents = await this.query(
        `SELECT d.id, d.title, d.created_at, d.updated_at, d.origin, d.revision_type
         FROM collaboration_request_documents rd JOIN drafts d ON d.id = rd.draft_id
         WHERE rd.request_id = $1 AND d.case_id = $2`, [request.id, access.case_id]
      );
      request.responses = await this.query(
        `SELECT id, response_type, content, document_id, draft_id, created_at
         FROM client_responses WHERE request_id = $1 ORDER BY created_at DESC`, [request.id]
      );
      for (const response of request.responses) {
        response.attachments = await this.getResponseAttachments(response.id);
      }
    }
    const portalDocuments = await this.query(
      `SELECT id, title, source_type, origin, processing_state, uploaded_at
       FROM documents WHERE case_id = $1 AND firm_id = $2 AND source_type = 'Client Submission'
       ORDER BY uploaded_at DESC`, [access.case_id, access.firm_id]
    );
    const revisions = await this.query(
      `SELECT id, case_id, title, content, created_at, updated_at, origin,
         parent_draft_id, revision_type
       FROM drafts WHERE case_id = $1 AND revision_type = 'Client Revision'
       ORDER BY created_at DESC`, [access.case_id]
    );
    const chatMessages = await this.getPortalChatMessages(tokenHash);
    return { access, shared, requests, portalDocuments, revisions, chatMessages };
  }

  public async getPermittedPortalDraft(tokenHash: string, draftId: string): Promise<any | null> {
    const access = await this.resolvePortalAccess(tokenHash);
    if (!access) return null;
    const rows = await this.query(
      `SELECT d.* FROM drafts d WHERE d.id = $1 AND d.case_id = $2 AND (
         d.shared_with_client = TRUE OR d.revision_type = 'Client Revision' OR EXISTS (
           SELECT 1 FROM collaboration_request_documents rd
           JOIN collaboration_requests cr ON cr.id = rd.request_id
           WHERE rd.draft_id = d.id AND cr.case_id = $2
         )
       )`, [draftId, access.case_id]
    );
    return rows[0] || null;
  }

  public async addPortalComment(tokenHash: string, draftId: string, content: string): Promise<any> {
    const access = await this.resolvePortalAccess(tokenHash);
    const draft = access ? await this.getPermittedPortalDraft(tokenHash, draftId) : null;
    if (!access || !draft) throw new Error("Shared Work Product not found");
    const id = `comment_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const rows = await this.query(
      `INSERT INTO portal_comments(id, case_id, draft_id, content, created_at)
       VALUES($1, $2, $3, $4, $5) RETURNING *`,
      [id, access.case_id, draftId, content, createdAt]
    );
    return rows[0];
  }

  public async createPortalClientRevision(
    tokenHash: string, draftId: string, content: string
  ): Promise<any> {
    const access = await this.resolvePortalAccess(tokenHash);
    const original = access ? await this.getPermittedPortalDraft(tokenHash, draftId) : null;
    if (!access || !original) throw new Error("Shared Work Product not found");
    const id = `draft_${randomUUID()}`;
    const now = new Date().toISOString();
    const rows = await this.query(
      `INSERT INTO drafts
        (id, thread_id, case_id, title, content, created_at, updated_at, origin,
         parent_draft_id, revision_type)
       VALUES($1, NULL, $2, $3, $4, $5, $5, 'Client Revision', $6, 'Client Revision')
       RETURNING *`,
      [id, access.case_id, `${original.title} (Client Revision)`, content, now, original.id]
    );
    return rows[0];
  }

  public async uploadPortalDocument(tokenHash: string, title: string, text: string): Promise<any> {
    const access = await this.resolvePortalAccess(tokenHash);
    if (!access) throw new Error("Client access not found");
    return await this.uploadDocument(
      title,
      text,
      { userId: "client-portal", firmId: access.firm_id },
      null,
      null,
      access.case_id,
      "Client Submission",
      "Client"
    );
  }

  public async createPortalResponse(
    tokenHash: string,
    requestId: string,
    responseType: string,
    content: string | null,
    uploadedFiles: Array<{ filename: string; text: string }> = [],
    draftIds: string[] = []
  ): Promise<any> {
    await this.ensureSchema();
    const access = await this.resolvePortalAccess(tokenHash);
    if (!access) throw new Error("Client access not found");
    const request = (await this.query(
      "SELECT id FROM collaboration_requests WHERE id = $1 AND case_id = $2",
      [requestId, access.case_id]
    ))[0];
    if (!request) throw new Error("Client request not found");
    const uniqueDraftIds = Array.from(new Set(draftIds.filter(Boolean)));
    const permittedDrafts: any[] = [];
    for (const draftId of uniqueDraftIds) {
      const draft = await this.getPermittedPortalDraft(tokenHash, draftId);
      if (!draft) throw new Error("Portal Work Product not found");
      permittedDrafts.push(draft);
    }

    const id = `response_${randomUUID()}`;
    const now = new Date().toISOString();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const uploadedPairs: Array<{ documentId: string; draftId: string }> = [];
      for (const file of uploadedFiles) {
        const documentId = `doc_${randomUUID()}`;
        await client.query(
          `INSERT INTO documents
            (id, firm_id, case_id, title, source_url, drive_id, extracted_text, section, uploaded_at,
             source_type, origin, processing_state)
           VALUES ($1, $2, $3, $4, NULL, NULL, $5, 'Client Submission', $6,
             'Client Submission', 'Client', 'Processing')`,
          [documentId, access.firm_id, access.case_id, file.filename, file.text, now]
        );
        const paragraphs = file.text
          .split(/\n\s*\n/)
          .map((paragraph) => paragraph.trim())
          .filter((paragraph) => paragraph.length > 15);
        for (let i = 0; i < paragraphs.length; i++) {
          try {
            const embedding = await callModel("embedding", [], { textToEmbed: paragraphs[i] }) as number[];
            await client.query(
              `INSERT INTO document_chunks (id, document_id, chunk_text, embedding)
               VALUES ($1, $2, $3, $4)`,
              [`chunk_${documentId}_${i}`, documentId, paragraphs[i], `[${embedding.join(",")}]`]
            );
          } catch (error) {
            console.error(`Embedding generation failed for portal response document ${documentId}, chunk ${i}; chunk left unindexed.`, error);
          }
        }
        const indexed = await client.query(
          "SELECT COUNT(*)::int AS count FROM document_chunks WHERE document_id = $1",
          [documentId]
        );
        await client.query(
          "UPDATE documents SET processing_state = $1 WHERE id = $2 AND firm_id = $3",
          [Number(indexed.rows[0]?.count || 0) > 0 || paragraphs.length === 0 ? "Ready" : "Needs Attention", documentId, access.firm_id]
        );

        const draftId = `draft_${randomUUID()}`;
        await client.query(
          `INSERT INTO drafts
            (id, thread_id, case_id, title, content, created_at, updated_at, origin, revision_type)
           VALUES($1, NULL, $2, $3, $4, $5, $5, 'Client Response Upload', 'Client Response')`,
          [draftId, access.case_id, `Client Response — ${file.filename}`, file.text, now]
        );
        uploadedPairs.push({ documentId, draftId });
      }

      const rows = await client.query(
        `INSERT INTO client_responses
          (id, request_id, response_type, content, document_id, draft_id, is_read, created_at)
         VALUES($1, $2, $3, $4, $5, $6, FALSE, $7) RETURNING *`,
        [
          id,
          requestId,
          responseType,
          content,
          uploadedPairs[0]?.documentId || null,
          uploadedPairs[0]?.draftId || uniqueDraftIds[0] || null,
          now,
        ]
      );
      for (const pair of uploadedPairs) {
        await client.query(
          `INSERT INTO client_response_attachments(id, response_id, document_id, draft_id, created_at)
           VALUES($1, $2, $3, $4, $5)`,
          [`attachment_${randomUUID()}`, id, pair.documentId, pair.draftId, now]
        );
      }
      for (const draft of permittedDrafts) {
        await client.query(
          `INSERT INTO client_response_attachments(id, response_id, document_id, draft_id, created_at)
           VALUES($1, $2, NULL, $3, $4)`,
          [`attachment_${randomUUID()}`, id, draft.id, now]
        );
      }
      await client.query(
        "UPDATE collaboration_requests SET status = 'Responded', updated_at = $1 WHERE id = $2 AND case_id = $3",
        [now, requestId, access.case_id]
      );
      await client.query("COMMIT");
      return { ...rows.rows[0], attachments: await this.getResponseAttachments(id) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getPortalAssistantSources(
    tokenHash: string, draftIds: string[], documentIds: string[]
  ): Promise<{ access: any; sources: Array<{ id: string; title: string; text: string }> } | null> {
    const access = await this.resolvePortalAccess(tokenHash);
    if (!access) return null;
    const sources: Array<{ id: string; title: string; text: string }> = [];
    for (const id of Array.from(new Set(draftIds))) {
      const draft = await this.getPermittedPortalDraft(tokenHash, id);
      if (!draft) throw new Error("Selected Work Product is not available in this Client Portal");
      sources.push({ id: draft.id, title: draft.title, text: draft.content });
    }
    if (documentIds.length) {
      const unique = Array.from(new Set(documentIds));
      const documents = await this.query(
        `SELECT id, title, extracted_text FROM documents
         WHERE id = ANY($1::text[]) AND case_id = $2 AND firm_id = $3
           AND source_type = 'Client Submission'`,
        [unique, access.case_id, access.firm_id]
      );
      if (documents.length !== unique.length) throw new Error("Selected portal document is not available");
      sources.push(...documents.map((document) => ({ id: document.id, title: document.title, text: document.extracted_text })));
    }
    return { access, sources };
  }

  public async getPortalChatMessages(tokenHash: string, limit = 30): Promise<any[]> {
    const access = await this.resolvePortalAccess(tokenHash);
    if (!access) return [];
    return await this.query(
      `SELECT id, role, content, selected_sources, created_at
       FROM portal_chat_messages
       WHERE access_id = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [access.access_id, limit]
    );
  }

  public async addPortalChatMessage(
    tokenHash: string, role: "user" | "assistant", content: string, selectedSources: Array<{ id: string; title: string }>
  ): Promise<any> {
    const access = await this.resolvePortalAccess(tokenHash);
    if (!access) throw new Error("Client access not found");
    const id = `portal_msg_${randomUUID()}`;
    const rows = await this.query(
      `INSERT INTO portal_chat_messages(id, access_id, role, content, selected_sources, created_at)
       VALUES($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
      [id, access.access_id, role, content, JSON.stringify(selectedSources), new Date().toISOString()]
    );
    return rows[0];
  }

  public async getDocuments(context: OwnershipContext, caseId: string | null): Promise<Document[]> {
    if (!caseId) {
      return await this.query(
        `SELECT * FROM documents
         WHERE firm_id = $1 AND case_id IS NULL AND is_generated_draft_duplicate = FALSE
         ORDER BY uploaded_at DESC`,
        [context.firmId]
      );
    }
    return await this.query(
      `SELECT d.*
       FROM documents d
       WHERE d.firm_id = $1
         AND d.is_generated_draft_duplicate = FALSE
         AND EXISTS (SELECT 1 FROM cases c WHERE c.id = $2 AND c.firm_id = $1)
         AND (
           d.case_id = $2 OR (
             d.case_id IS NULL AND EXISTS (
               SELECT 1 FROM case_documents cd
               WHERE cd.case_id = $2 AND cd.document_id = d.id
             )
           )
         )
       ORDER BY d.uploaded_at DESC`,
      [context.firmId, caseId]
    );
  }

  public async getDocumentById(
    id: string,
    context: OwnershipContext,
    caseId: string | null
  ): Promise<Document | undefined> {
    const rows = caseId
      ? await this.query(
          `SELECT d.* FROM documents d
           WHERE d.id = $1 AND d.firm_id = $2 AND d.is_generated_draft_duplicate = FALSE
             AND EXISTS (SELECT 1 FROM cases c WHERE c.id = $3 AND c.firm_id = $2)
             AND (
               d.case_id = $3 OR (
                 d.case_id IS NULL AND EXISTS (
                   SELECT 1 FROM case_documents cd
                   WHERE cd.case_id = $3 AND cd.document_id = d.id
                 )
               )
             )`,
          [id, context.firmId, caseId]
        )
      : await this.query(
          `SELECT * FROM documents
           WHERE id = $1 AND firm_id = $2 AND case_id IS NULL
             AND is_generated_draft_duplicate = FALSE`,
          [id, context.firmId]
        );
    return rows[0];
  }

  public async uploadDocument(
    title: string,
    text: string,
    context: OwnershipContext,
    sourceUrl: string | null = null,
    driveId: string | null = null,
    caseId: string | null = null,
    sourceType?: string,
    origin = "Lawyer"
  ): Promise<Document> {
    if (caseId && !(await this.getCaseById(caseId, context))) {
      throw new Error("Matter not found");
    }
    let suggestedSection = "General Legal Advice";
    try {
      const docEmbedding = await callModel("embedding", [], { textToEmbed: text.substring(0, 500) }) as number[];
      const vectorStr = `[${docEmbedding.join(",")}]`;

      const rows = await this.query(
        `SELECT d.section, AVG(1 - (dc.embedding <=> $1::vector)) as avg_sim
         FROM document_chunks dc
         JOIN documents d ON dc.document_id = d.id
         WHERE d.firm_id = $2 AND d.case_id IS NULL
           AND d.is_generated_draft_duplicate = FALSE
         GROUP BY d.section
         ORDER BY avg_sim DESC
         LIMIT 1`,
        [vectorStr, context.firmId]
      );

      if (rows.length > 0 && rows[0].avg_sim > 0.3) {
        suggestedSection = rows[0].section;
      }
    } catch (e) {
      console.error("Error suggesting section for document:", e);
    }

    return await this.addDocumentInternal(
      title,
      text,
      suggestedSection,
      sourceUrl,
      driveId,
      caseId,
      context.firmId,
      sourceType || (caseId ? "Matter Upload" : "Firm Library Document"),
      origin
    );
  }

  public async authorizePrivateUploadBatch(
    context: OwnershipContext,
    caseId: string | null,
    uploadSource: string,
    bucket: string,
    expiresAt: string,
    files: Array<{
      documentId: string;
      versionId: string;
      originalFilename: string;
      safeFilename: string;
      objectKey: string;
      contentType: string;
      byteSize: number;
      checksumSha256: string;
    }>,
    limits: { maxWorkspaceBytes: number; maxWorkspaceFiles: number },
  ): Promise<{ batchId: string }> {
    await this.ensureSchema();
    const client = await getPool().connect();
    const batchId = `upload_batch_${randomUUID()}`;
    const totalBytes = files.reduce((sum, file) => sum + file.byteSize, 0);
    try {
      await client.query("BEGIN");
      const firm = await client.query(
        "SELECT id FROM firm WHERE id = $1 FOR UPDATE",
        [context.firmId],
      );
      if (firm.rowCount !== 1) throw new Error("Workspace not found");
      if (caseId) {
        const matter = await client.query(
          "SELECT id FROM cases WHERE id = $1 AND firm_id = $2",
          [caseId, context.firmId],
        );
        if (matter.rowCount !== 1) throw new Error("Matter not found");
      }
      const usage = await client.query(
        `SELECT COUNT(*)::int AS file_count, COALESCE(SUM(byte_size), 0)::bigint AS total_bytes
         FROM document_versions
         WHERE firm_id = $1 AND upload_state IN ('Authorized', 'Uploaded')`,
        [context.firmId],
      );
      const workspaceFiles = Number(usage.rows[0]?.file_count || 0);
      const workspaceBytes = Number(usage.rows[0]?.total_bytes || 0);
      if (workspaceFiles + files.length > limits.maxWorkspaceFiles) {
        throw new Error("Workspace file limit exceeded.");
      }
      if (workspaceBytes + totalBytes > limits.maxWorkspaceBytes) {
        throw new Error("Workspace storage limit exceeded.");
      }
      const duplicate = await client.query(
        `SELECT checksum_sha256 FROM document_versions
         WHERE firm_id = $1 AND checksum_sha256 = ANY($2::text[])
         LIMIT 1`,
        [context.firmId, files.map((file) => file.checksumSha256)],
      );
      if (duplicate.rowCount) throw new Error("A file with the same checksum already exists in this workspace.");

      await client.query(
        `INSERT INTO upload_batches
          (id, firm_id, case_id, created_by_user_id, upload_source, state, file_count,
           total_bytes, authorization_expires_at)
         VALUES ($1, $2, $3, $4, $5, 'Authorized', $6, $7, $8)`,
        [batchId, context.firmId, caseId, context.userId, uploadSource, files.length, totalBytes, expiresAt],
      );
      for (const file of files) {
        await client.query(
          `INSERT INTO document_versions
            (id, document_id, reserved_document_id, firm_id, case_id, upload_batch_id, version_number,
             original_filename, safe_filename, object_key, storage_bucket, content_type,
             byte_size, checksum_sha256, upload_source, uploaded_by_user_id,
             upload_state, authorization_expires_at)
           VALUES ($1, NULL, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'Authorized', $15)`,
          [
            file.versionId, file.documentId, context.firmId, caseId, batchId, file.originalFilename,
            file.safeFilename, file.objectKey, bucket, file.contentType, file.byteSize,
            file.checksumSha256, uploadSource, context.userId, expiresAt,
          ],
        );
      }
      await client.query("COMMIT");
      return { batchId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getAuthorizedUploadVersion(versionId: string, context: OwnershipContext): Promise<any | undefined> {
    const rows = await this.query(
      `SELECT v.*, b.state AS batch_state
       FROM document_versions v
       JOIN upload_batches b ON b.id = v.upload_batch_id
       WHERE v.id = $1 AND v.firm_id = $2 AND v.uploaded_by_user_id = $3`,
      [versionId, context.firmId, context.userId],
    );
    return rows[0];
  }

  public async confirmPrivateUpload(versionId: string, context: OwnershipContext): Promise<Document> {
    await this.ensureSchema();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT v.* FROM document_versions v
         WHERE v.id = $1 AND v.firm_id = $2 AND v.uploaded_by_user_id = $3
         FOR UPDATE`,
        [versionId, context.firmId, context.userId],
      );
      const version = result.rows[0];
      if (!version) throw new Error("Upload not found");
      if (version.upload_state === "Uploaded" && version.document_id) {
        const existing = await client.query(
          "SELECT * FROM documents WHERE id = $1 AND firm_id = $2",
          [version.document_id, context.firmId],
        );
        await client.query("COMMIT");
        return existing.rows[0];
      }
      if (version.upload_state !== "Authorized") throw new Error("Upload is not confirmable");

      const documentId = version.reserved_document_id;
      const now = new Date().toISOString();
      const sourceType = version.case_id ? "Matter Upload" : "Firm Library Document";
      const inserted = await client.query(
        `INSERT INTO documents
          (id, firm_id, case_id, title, source_url, drive_id, extracted_text, section,
           uploaded_at, source_type, origin, processing_state)
         SELECT $1, $2, v.case_id, v.original_filename, NULL, NULL, '', 'Uncategorized',
           $3, $4, v.upload_source, 'Uploaded'
         FROM document_versions v
         WHERE v.id = $5 AND v.firm_id = $2
           AND (v.case_id IS NULL OR EXISTS (
             SELECT 1 FROM cases c WHERE c.id = v.case_id AND c.firm_id = $2
           ))
         RETURNING *`,
        [documentId, context.firmId, now, sourceType, versionId],
      );
      if (inserted.rowCount !== 1) throw new Error("Upload scope is no longer available");
      await client.query(
        `UPDATE document_versions
         SET document_id = $1, upload_state = 'Uploaded', confirmed_at = $2
         WHERE id = $3 AND firm_id = $4`,
        [documentId, now, versionId, context.firmId],
      );
      await client.query(
        `UPDATE upload_batches b SET
           state = CASE WHEN NOT EXISTS (
             SELECT 1 FROM document_versions v
             WHERE v.upload_batch_id = b.id AND v.upload_state <> 'Uploaded'
           ) THEN 'Uploaded' ELSE b.state END,
           completed_at = CASE WHEN NOT EXISTS (
             SELECT 1 FROM document_versions v
             WHERE v.upload_batch_id = b.id AND v.upload_state <> 'Uploaded'
           ) THEN $2 ELSE b.completed_at END
         WHERE b.id = $1 AND b.firm_id = $3`,
        [version.upload_batch_id, now, context.firmId],
      );
      await client.query("COMMIT");
      return inserted.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getOriginalDownload(versionId: string, context: OwnershipContext): Promise<any | undefined> {
    const rows = await this.query(
      `SELECT v.id, v.object_key, v.original_filename, v.content_type, v.byte_size
       FROM document_versions v
       JOIN documents d ON d.id = v.document_id AND d.firm_id = v.firm_id
       WHERE v.id = $1 AND v.firm_id = $2 AND v.upload_state = 'Uploaded'
         AND (
           d.case_id IS NULL OR EXISTS (
             SELECT 1 FROM cases c WHERE c.id = d.case_id AND c.firm_id = $2
           )
         )`,
      [versionId, context.firmId],
    );
    return rows[0];
  }

  public async attachIngestionJob(
    versionId: string,
    jobId: string,
    context: OwnershipContext,
  ): Promise<boolean> {
    const rows = await this.query(
      `UPDATE document_versions
       SET ingestion_job_id = COALESCE(ingestion_job_id, $2)
       WHERE id = $1 AND firm_id = $3 AND upload_state = 'Uploaded'
       RETURNING id`,
      [versionId, jobId, context.firmId],
    );
    return rows.length === 1;
  }

  public async requestIngestionCancellation(
    versionId: string,
    context: OwnershipContext,
  ): Promise<any | undefined> {
    const rows = await this.query(
      `UPDATE document_versions v
       SET cancellation_requested_at = NOW(),
           processing_state = CASE WHEN processing_state = 'uploaded' THEN 'cancelled' ELSE processing_state END,
           processing_completed_at = CASE WHEN processing_state = 'uploaded' THEN NOW() ELSE processing_completed_at END
       WHERE v.id = $1 AND v.firm_id = $2
         AND v.processing_state NOT IN ('ready', 'needs_ocr', 'failed', 'cancelled')
         AND EXISTS (
           SELECT 1 FROM documents d
           WHERE d.id = v.document_id AND d.firm_id = $2
             AND (d.case_id IS NULL OR EXISTS (
               SELECT 1 FROM cases c WHERE c.id = d.case_id AND c.firm_id = $2
             ))
         )
       RETURNING v.id, v.ingestion_job_id, v.processing_state`,
      [versionId, context.firmId],
    );
    return rows[0];
  }

  public async getIngestionVisibility(context: OwnershipContext): Promise<any[]> {
    return this.query(
      `SELECT v.id AS version_id, v.document_id, v.original_filename, v.processing_state,
              v.processing_attempts, v.processing_error_code, v.processing_heartbeat_at,
              v.processing_completed_at, v.case_id
       FROM document_versions v
       WHERE v.firm_id = $1 AND v.upload_state = 'Uploaded'
         AND (v.case_id IS NULL OR EXISTS (
           SELECT 1 FROM cases c WHERE c.id = v.case_id AND c.firm_id = $1
         ))
       ORDER BY v.created_at DESC`,
      [context.firmId],
    );
  }

  public async deleteDocument(
    id: string,
    context: OwnershipContext,
    caseId: string | null
  ): Promise<boolean> {
    if (caseId) {
      const directDocument = await this.query(
        `DELETE FROM documents d
         WHERE d.id = $1 AND d.firm_id = $2 AND d.case_id = $3
           AND EXISTS (SELECT 1 FROM cases c WHERE c.id = $3 AND c.firm_id = $2)
         RETURNING d.id`,
        [id, context.firmId, caseId]
      );
      if (directDocument.length === 1) return true;

      const linkedLibraryDocument = await this.query(
        `DELETE FROM case_documents cd
         WHERE cd.case_id = $1 AND cd.document_id = $2
           AND EXISTS (SELECT 1 FROM cases c WHERE c.id = cd.case_id AND c.firm_id = $3)
           AND EXISTS (
             SELECT 1 FROM documents d
             WHERE d.id = cd.document_id AND d.firm_id = $3 AND d.case_id IS NULL
           )
         RETURNING cd.document_id`,
        [caseId, id, context.firmId]
      );
      return linkedLibraryDocument.length === 1;
    }

    const libraryDocument = await this.query(
      `DELETE FROM documents
       WHERE id = $1 AND firm_id = $2 AND case_id IS NULL
       RETURNING id`,
      [id, context.firmId]
    );
    return libraryDocument.length === 1;
  }

  public async vectorSearch(
    query: string,
    scope: "wide" | string,
    context: OwnershipContext,
    limit = 5
  ): Promise<(DocumentChunk & { similarity: number })[]> {
    let queryEmbedding: number[];
    try {
      queryEmbedding = await callModel("embedding", [], { textToEmbed: query }) as number[];
    } catch (err) {
      console.error("Failed to generate embedding for vector search:", err);
      return [];
    }

    const vectorStr = `[${queryEmbedding.join(",")}]`;

    if (scope === "wide") {
      return await this.query(
        `SELECT dc.id, dc.document_id, dc.chunk_text, (1 - (dc.embedding <=> $1::vector))::float as similarity
         FROM document_chunks dc
         JOIN documents d ON d.id = dc.document_id
         WHERE d.firm_id = $2 AND d.case_id IS NULL
           AND d.is_generated_draft_duplicate = FALSE
         ORDER BY dc.embedding <=> $1::vector
         LIMIT $3`,
        [vectorStr, context.firmId, limit]
      );
    } else {
      return await this.query(
        `SELECT dc.id, dc.document_id, dc.chunk_text, (1 - (dc.embedding <=> $1::vector))::float as similarity
         FROM document_chunks dc
         JOIN documents d ON dc.document_id = d.id
         WHERE d.firm_id = $2 AND d.is_generated_draft_duplicate = FALSE
           AND EXISTS (SELECT 1 FROM cases c WHERE c.id = $3 AND c.firm_id = $2)
           AND (
             d.case_id = $3 OR (
               d.case_id IS NULL AND EXISTS (
                 SELECT 1 FROM case_documents cd
                 WHERE cd.case_id = $3 AND cd.document_id = d.id
               )
             )
           )
         ORDER BY dc.embedding <=> $1::vector
         LIMIT $4`,
        [vectorStr, context.firmId, scope, limit]
      );
    }
  }

  public async getThreads(context: OwnershipContext, caseId: string | null): Promise<Thread[]> {
    if (caseId) {
      return await this.query(
        `SELECT t.* FROM threads t
         JOIN cases c ON c.id = t.case_id
         WHERE t.user_id = $1 AND t.case_id = $2 AND c.firm_id = $3
         ORDER BY t.created_at DESC`,
        [context.userId, caseId, context.firmId]
      );
    }
    return await this.query(
      `SELECT * FROM threads
       WHERE user_id = $1 AND case_id IS NULL
       ORDER BY created_at DESC`,
      [context.userId]
    );
  }

  public async getHistoryThreads(context: OwnershipContext): Promise<Thread[]> {
    return await this.query(
      `SELECT t.*, COALESCE(MAX(m.created_at), t.created_at) AS last_activity_at
       FROM threads t
       LEFT JOIN messages m ON m.thread_id = t.id
       WHERE t.user_id = $1
         AND (
           t.case_id IS NULL OR EXISTS (
             SELECT 1 FROM cases c WHERE c.id = t.case_id AND c.firm_id = $2
           )
         )
       GROUP BY t.id
       ORDER BY COALESCE(MAX(m.created_at), t.created_at) DESC`,
      [context.userId, context.firmId]
    );
  }

  public async getThreadById(id: string, context: OwnershipContext): Promise<Thread | undefined> {
    const rows = await this.query(
      `SELECT t.* FROM threads t
       WHERE t.id = $1 AND t.user_id = $2
         AND (
           t.case_id IS NULL OR EXISTS (
             SELECT 1 FROM cases c WHERE c.id = t.case_id AND c.firm_id = $3
           )
         )`,
      [id, context.userId, context.firmId]
    );
    return rows[0];
  }

  public async createThread(
    title: string,
    caseId: string | null,
    context: OwnershipContext
  ): Promise<Thread> {
    if (caseId && !(await this.getCaseById(caseId, context))) {
      throw new Error("Matter not found");
    }
    const threadId = `thread_${Date.now()}`;
    const createdAt = new Date().toISOString();
    const scope = caseId ? "case" : "wide";
    const finalTitle = title || "New Legal Conversation";

    await this.query(
      `INSERT INTO threads (id, user_id, case_id, scope, title, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [threadId, context.userId, caseId, scope, finalTitle, createdAt]
    );

    return {
      id: threadId,
      user_id: context.userId,
      case_id: caseId,
      scope,
      title: finalTitle,
      created_at: createdAt
    };
  }

  public async deleteThread(id: string, context: OwnershipContext): Promise<boolean> {
    const rows = await this.query(
      `DELETE FROM threads t
       WHERE t.id = $1 AND t.user_id = $2
         AND (
           t.case_id IS NULL OR EXISTS (
             SELECT 1 FROM cases c WHERE c.id = t.case_id AND c.firm_id = $3
           )
         )
       RETURNING t.id`,
      [id, context.userId, context.firmId]
    );
    return rows.length === 1;
  }

  public async getMessages(threadId: string, context: OwnershipContext): Promise<Message[]> {
    const rows = await this.query(
      `SELECT m.* FROM messages m
       JOIN threads t ON t.id = m.thread_id
       WHERE m.thread_id = $1 AND t.user_id = $2
         AND (
           t.case_id IS NULL OR EXISTS (
             SELECT 1 FROM cases c WHERE c.id = t.case_id AND c.firm_id = $3
           )
         )
       ORDER BY m.created_at ASC`,
      [threadId, context.userId, context.firmId]
    );
    return rows.map((m) => ({
      ...m,
      citations: typeof m.citations === "string" ? JSON.parse(m.citations) : m.citations,
      steps: typeof m.steps === "string" ? JSON.parse(m.steps) : m.steps,
      metadata: typeof m.metadata === "string" ? JSON.parse(m.metadata) : m.metadata
    }));
  }

  public async storeGovInfoResearchRun(
    threadId: string,
    normalizedQuery: string,
    status: "ok" | "empty" | "unavailable",
    sources: Citation[],
    context: OwnershipContext,
    existingRunId?: string
  ): Promise<{ runId: string; citations: Citation[] }> {
    const client = await getPool().connect();
    const runId = existingRunId || `research_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    try {
      await client.query("BEGIN");
      const insertedRun = existingRunId
        ? await client.query(
          `SELECT r.id
           FROM research_runs r
           JOIN threads t ON t.id = r.thread_id
           LEFT JOIN cases c ON c.id = r.case_id
           WHERE r.id = $1 AND r.firm_id = $2 AND r.user_id = $3 AND r.thread_id = $4
             AND t.user_id = $3 AND (r.case_id IS NULL OR c.firm_id = $2)`,
          [runId, context.firmId, context.userId, threadId]
        )
        : await client.query(
          `INSERT INTO research_runs
          (id, firm_id, user_id, thread_id, case_id, provider, normalized_query, status, created_at, completed_at)
         SELECT $1, $2, $3, t.id, t.case_id, 'govinfo', $4, $5, $6, $6
         FROM threads t
         LEFT JOIN cases c ON c.id = t.case_id
         WHERE t.id = $7 AND t.user_id = $3
           AND (t.case_id IS NULL OR c.firm_id = $2)
         RETURNING id`,
          [runId, context.firmId, context.userId, normalizedQuery, status, createdAt, threadId]
        );
      if (insertedRun.rowCount !== 1) throw new Error("Research run scope is not authorized.");

      const attached: Citation[] = [];
      for (const source of sources) {
        if (
          source.provider !== "govinfo" ||
          !source.providerSourceId ||
          !source.url ||
          !source.textSnippet.trim()
        ) continue;
        const contentHash = createHash("sha256").update(source.textSnippet).digest("hex");
        const sourceId = `govinfo_${contentHash}`;
        const retrievedAt = source.retrievalDate || createdAt;
        await client.query(
          `INSERT INTO retrieved_legal_sources
            (id, provider, provider_source_id, title, canonical_url, publication_date, retrieved_at,
             content, content_hash, metadata)
           VALUES ($1, 'govinfo', $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [
            sourceId,
            source.providerSourceId,
            source.title,
            source.url,
            source.publicationDate || null,
            retrievedAt,
            source.textSnippet,
            contentHash,
            JSON.stringify(source.sourceMetadata || {}),
          ]
        );
        const runSourceId = `run_source_${randomUUID()}`;
        await client.query(
          `INSERT INTO research_run_sources
            (id, research_run_id, retrieved_source_id, title_snapshot, canonical_url_snapshot,
             publication_date_snapshot, retrieved_at_snapshot, supporting_passage, metadata_snapshot)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
           ON CONFLICT (research_run_id, retrieved_source_id, supporting_passage) DO NOTHING`,
          [
            runSourceId,
            runId,
            sourceId,
            source.title,
            source.url,
            source.publicationDate || null,
            retrievedAt,
            source.textSnippet,
            JSON.stringify(source.sourceMetadata || {}),
          ]
        );
        attached.push({ ...source, researchRunId: runId, textSnippet: source.textSnippet });
      }
      await client.query("COMMIT");
      return { runId, citations: attached };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getRecentMessages(
    threadId: string,
    context: OwnershipContext,
    limit = 12
  ): Promise<Message[]> {
    const rows = await this.query(
      `SELECT * FROM (
         SELECT m.* FROM messages m
         JOIN threads t ON t.id = m.thread_id
         WHERE m.thread_id = $1 AND t.user_id = $2
           AND (
             t.case_id IS NULL OR EXISTS (
               SELECT 1 FROM cases c WHERE c.id = t.case_id AND c.firm_id = $3
             )
           )
         ORDER BY m.created_at DESC
         LIMIT $4
       ) recent ORDER BY created_at ASC`,
      [threadId, context.userId, context.firmId, limit]
    );
    return rows.map((m) => ({
      ...m,
      citations: typeof m.citations === "string" ? JSON.parse(m.citations) : m.citations,
      steps: typeof m.steps === "string" ? JSON.parse(m.steps) : m.steps,
      metadata: typeof m.metadata === "string" ? JSON.parse(m.metadata) : m.metadata,
    }));
  }

  public async addMessage(
    threadId: string,
    role: "user" | "assistant",
    content: string,
    context: OwnershipContext,
    citations: Citation[] = [],
    steps: any[] | null = null,
    metadata: Record<string, unknown> = {}
  ): Promise<Message> {
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const createdAt = new Date().toISOString();

    const inserted = await this.query(
      `INSERT INTO messages (id, thread_id, role, content, citations, steps, created_at, metadata)
       SELECT $1, t.id, $3, $4, $5, $6, $7, $10::jsonb
       FROM threads t
       WHERE t.id = $2 AND t.user_id = $8
         AND (
           t.case_id IS NULL OR EXISTS (
             SELECT 1 FROM cases c WHERE c.id = t.case_id AND c.firm_id = $9
           )
         )
       RETURNING id`,
      [
        msgId,
        threadId,
        role,
        content,
        JSON.stringify(citations),
        JSON.stringify(steps),
        createdAt,
        context.userId,
        context.firmId,
        JSON.stringify(metadata),
      ]
    );
    if (inserted.length !== 1) throw new Error("Thread not found");

    return {
      id: msgId,
      thread_id: threadId,
      role,
      content,
      citations,
      steps,
      created_at: createdAt,
      metadata,
    };
  }

  public async updateMessage(
    id: string,
    threadId: string,
    content: string,
    context: OwnershipContext
  ): Promise<Message> {
    const rows = await this.query(
      `UPDATE messages m SET content = $1
       WHERE m.id = $2 AND m.thread_id = $3
         AND EXISTS (
           SELECT 1 FROM threads t
           WHERE t.id = m.thread_id AND t.user_id = $4
             AND (
               t.case_id IS NULL OR EXISTS (
                 SELECT 1 FROM cases c WHERE c.id = t.case_id AND c.firm_id = $5
               )
             )
         )
       RETURNING m.*`,
      [content, id, threadId, context.userId, context.firmId]
    );
    if (rows.length === 0) {
      throw new Error("Message not found");
    }
    const m = rows[0];
    return {
      ...m,
      citations: typeof m.citations === "string" ? JSON.parse(m.citations) : m.citations,
      steps: typeof m.steps === "string" ? JSON.parse(m.steps) : m.steps,
      metadata: typeof m.metadata === "string" ? JSON.parse(m.metadata) : m.metadata
    };
  }

  public async getDrafts(context: OwnershipContext, caseId: string | null): Promise<Draft[]> {
    if (!caseId) return [];
    return await this.query(
      `SELECT d.* FROM drafts d
       JOIN cases c ON c.id = d.case_id
       WHERE d.case_id = $1 AND c.firm_id = $2
       ORDER BY COALESCE(d.updated_at, d.created_at) DESC`,
      [caseId, context.firmId]
    );
  }

  public async getDraftById(
    id: string,
    caseId: string,
    context: OwnershipContext
  ): Promise<Draft | undefined> {
    const rows = await this.query(
      `SELECT d.* FROM drafts d
       JOIN cases c ON c.id = d.case_id
       WHERE d.id = $1 AND d.case_id = $2 AND c.firm_id = $3`,
      [id, caseId, context.firmId]
    );
    return rows[0];
  }

  public async createDraft(
    threadId: string,
    caseId: string | null,
    title: string,
    content: string,
    context: OwnershipContext
  ): Promise<Draft> {
    if (!caseId) throw new Error("A Matter is required before saving Work Product");
    const draftId = `draft_${Date.now()}`;
    const createdAt = new Date().toISOString();

    const inserted = await this.query(
      `INSERT INTO drafts (id, thread_id, case_id, title, content, created_at, updated_at, origin)
       SELECT $1, t.id, t.case_id, $4, $5, $6, $6, 'Generated from conversation'
       FROM threads t
       JOIN cases c ON c.id = t.case_id
       WHERE t.id = $2 AND t.case_id = $3
         AND t.user_id = $7 AND c.firm_id = $8
       RETURNING id`,
      [draftId, threadId, caseId, title, content, createdAt, context.userId, context.firmId]
    );
    if (inserted.length !== 1) throw new Error("Thread or Matter not found");

    return {
      id: draftId,
      thread_id: threadId,
      case_id: caseId,
      title,
      content,
      created_at: createdAt, updated_at: createdAt, origin: "Generated from conversation",
      shared_with_client: false, shared_at: null, parent_draft_id: null,
      revision_type: "Lawyer Original",
    };
  }

  public async createManualDraft(
    caseId: string, title: string, content: string, context: OwnershipContext
  ): Promise<Draft> {
    const id = `draft_${randomUUID()}`;
    const now = new Date().toISOString();
    const rows = await this.query(
      `INSERT INTO drafts
        (id, thread_id, case_id, title, content, created_at, updated_at, origin, revision_type)
       SELECT $1, NULL, c.id, $3, $4, $5, $5, 'Created in Matter', 'Lawyer Original'
       FROM cases c WHERE c.id = $2 AND c.firm_id = $6 RETURNING *`,
      [id, caseId, title, content, now, context.firmId]
    );
    if (!rows[0]) throw new Error("Matter not found");
    return rows[0];
  }

  public async duplicateDraft(
    id: string, caseId: string, context: OwnershipContext
  ): Promise<Draft> {
    const duplicateId = `draft_${randomUUID()}`;
    const now = new Date().toISOString();
    const rows = await this.query(
      `INSERT INTO drafts
        (id, thread_id, case_id, title, content, created_at, updated_at, origin, revision_type)
       SELECT $1, NULL, d.case_id, d.title || ' (Copy)', d.content, $4, $4, 'Duplicated Work Product', 'Duplicate'
       FROM drafts d JOIN cases c ON c.id = d.case_id
       WHERE d.id = $2 AND d.case_id = $3 AND c.firm_id = $5 RETURNING *`,
      [duplicateId, id, caseId, now, context.firmId]
    );
    if (!rows[0]) throw new Error("Work Product not found");
    return rows[0];
  }

  public async setDraftSharing(
    id: string, caseId: string, shared: boolean, context: OwnershipContext
  ): Promise<Draft> {
    const now = new Date().toISOString();
    const rows = await this.query(
      `UPDATE drafts d SET shared_with_client = $1, shared_at = $2, updated_at = $3
       WHERE d.id = $4 AND d.case_id = $5
         AND EXISTS (SELECT 1 FROM cases c WHERE c.id = d.case_id AND c.firm_id = $6)
       RETURNING d.*`,
      [shared, shared ? now : null, now, id, caseId, context.firmId]
    );
    if (!rows[0]) throw new Error("Work Product not found");
    return rows[0];
  }

  public async createClientRevision(
    id: string, caseId: string, content: string, context: OwnershipContext
  ): Promise<Draft> {
    const revisionId = `draft_${randomUUID()}`;
    const now = new Date().toISOString();
    const rows = await this.query(
      `INSERT INTO drafts
        (id, thread_id, case_id, title, content, created_at, updated_at, origin,
         parent_draft_id, revision_type)
       SELECT $1, NULL, d.case_id, d.title || ' (Client Revision)', $4, $5, $5,
         'Client Revision', d.id, 'Client Revision'
       FROM drafts d JOIN cases c ON c.id = d.case_id
       WHERE d.id = $2 AND d.case_id = $3 AND c.firm_id = $6 RETURNING *`,
      [revisionId, id, caseId, content, now, context.firmId]
    );
    if (!rows[0]) throw new Error("Work Product not found");
    return rows[0];
  }

  public async updateDraft(
    id: string,
    caseId: string,
    content: string,
    context: OwnershipContext
  ): Promise<Draft> {
    const rows = await this.query(
      `UPDATE drafts d SET content = $1, updated_at = $5
       WHERE d.id = $2 AND d.case_id = $3
         AND EXISTS (SELECT 1 FROM cases c WHERE c.id = d.case_id AND c.firm_id = $4)
       RETURNING d.*`,
      [content, id, caseId, context.firmId, new Date().toISOString()]
    );
    if (rows.length === 0) {
      throw new Error("Work Product not found");
    }
    return rows[0];
  }
}

export const db = new DatabaseService();
