import pg from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import {
  Account,
  AccountType,
  Document,
  DocumentChunk,
  Case,
  Thread,
  Message,
  Draft,
  AssistantDocument,
  Citation,
  FirmAdminSettings,
  FirmRole,
  PlatformAccessStatus,
  ProfessionalRole,
  WorkspaceType,
} from "../src/types.js";
import { callModel, embedTexts } from "./model.js";
import { runMigrations } from "./migrations.js";
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_REQUESTS_PER_WINDOW,
  OTP_REQUEST_WINDOW_MS,
  OTP_RESEND_COOLDOWN_MS,
  ACCESS_REVIEW_DAILY_LIMIT,
  ACCESS_REVIEW_RESEND_COOLDOWN_MS,
  verifyOtpHash,
} from "./auth.js";
import {
  migrateLegacyDraftsFromEnvironment,
  migrateLegacyOwnerFromEnvironment,
} from "./legacyMigration.js";

const { Pool } = pg;

export interface OwnershipContext {
  userId: string;
  firmId: string;
}

const MAX_EMBEDDING_BATCH_TEXTS = 18;
const MAX_EMBEDDING_BATCH_CHARACTERS = 60_000;
const DOCUMENT_CHUNK_INSERT_BATCH_SIZE = 10;

type PreparedDocumentChunk = {
  index: number;
  text: string;
  embedding: number[];
};

type PreparedDocumentIndex = {
  chunks: PreparedDocumentChunk[];
  chunkCount: number;
  batchCount: number;
  fallbackToSingleCount: number;
  embeddingDurationMs: number;
};

type ChunkQuery = (text: string, params: any[]) => Promise<unknown>;

export function splitEmbeddingBatches(texts: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let characters = 0;
  for (const text of texts) {
    if (
      current.length > 0 &&
      (current.length >= MAX_EMBEDDING_BATCH_TEXTS || characters + text.length > MAX_EMBEDDING_BATCH_CHARACTERS)
    ) {
      batches.push(current);
      current = [];
      characters = 0;
    }
    current.push(text);
    characters += text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function prepareDocumentIndex(text: string, documentId: string): Promise<PreparedDocumentIndex> {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 15);
  const batches = splitEmbeddingBatches(paragraphs);
  const chunks: PreparedDocumentChunk[] = [];
  let offset = 0;
  let fallbackToSingleCount = 0;
  const embeddingStartedAt = Date.now();

  for (const batch of batches) {
    try {
      const embeddings = await embedTexts(batch);
      embeddings.forEach((embedding, batchIndex) => {
        chunks.push({ index: offset + batchIndex, text: batch[batchIndex], embedding });
      });
    } catch {
      fallbackToSingleCount += batch.length;
      console.warn(`Embedding batch failed for document ${documentId}; falling back to ${batch.length} individual embeddings.`);
      for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
        try {
          const embedding = await callModel("embedding", [], { textToEmbed: batch[batchIndex] }) as number[];
          chunks.push({ index: offset + batchIndex, text: batch[batchIndex], embedding });
        } catch {
          console.error(`Embedding generation failed for document ${documentId}, chunk ${offset + batchIndex}; chunk left unindexed.`);
        }
      }
    }
    offset += batch.length;
  }

  return {
    chunks,
    chunkCount: paragraphs.length,
    batchCount: batches.length,
    fallbackToSingleCount,
    embeddingDurationMs: Date.now() - embeddingStartedAt,
  };
}

async function insertDocumentChunks(
  documentId: string,
  chunks: PreparedDocumentChunk[],
  query: ChunkQuery
): Promise<void> {
  for (let offset = 0; offset < chunks.length; offset += DOCUMENT_CHUNK_INSERT_BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + DOCUMENT_CHUNK_INSERT_BATCH_SIZE);
    const values = batch.map((_chunk, index) => {
      const parameter = index * 4;
      return `($${parameter + 1}, $${parameter + 2}, $${parameter + 3}, $${parameter + 4})`;
    });
    const params = batch.flatMap((chunk) => [
      `chunk_${documentId}_${chunk.index}`,
      documentId,
      chunk.text,
      `[${chunk.embedding.join(",")}]`,
    ]);
    await query(
      `INSERT INTO document_chunks (id, document_id, chunk_text, embedding)
       VALUES ${values.join(", ")}`,
      params
    );
  }
}

function accountFromRow(row: Record<string, unknown>): Account {
  return {
    user: {
      id: String(row.id),
      account_type: (row.account_type || "lawyer") as AccountType,
      firm_id: row.firm_id ? String(row.firm_id) : null,
      firm_role: (row.firm_role || null) as FirmRole | null,
      name: row.name ? String(row.name) : null,
      email: String(row.email),
      google_sub: row.google_sub ? String(row.google_sub) : null,
      email_verified_at: row.email_verified_at ? String(row.email_verified_at) : null,
      onboarding_completed: Boolean(row.onboarding_completed),
      professional_role: (row.professional_role || null) as ProfessionalRole | null,
      custom_professional_role: row.custom_professional_role
        ? String(row.custom_professional_role)
        : null,
      workspace_type: (row.workspace_type || null) as WorkspaceType | null,
      practice_areas: Array.isArray(row.practice_areas) ? row.practice_areas.map(String) : [],
      custom_practice_area: row.custom_practice_area
        ? String(row.custom_practice_area)
        : null,
      platform_access_status: (row.platform_access_status || "pending") as PlatformAccessStatus,
      access_submitted_at: row.access_submitted_at ? String(row.access_submitted_at) : null,
      access_reviewed_at: row.access_reviewed_at ? String(row.access_reviewed_at) : null,
      client_access_granted: Boolean(row.client_access_granted),
    },
    firm: row.firm_id
      ? { id: String(row.firm_id), name: String(row.firm_name) }
      : null,
  };
}

export interface AccessReviewApplicant {
  userId: string;
  fullName: string;
  email: string;
  professionalRole: ProfessionalRole;
  customProfessionalRole: string | null;
  workspaceType: WorkspaceType;
  firmName: string | null;
  practiceAreas: string[];
  customPracticeArea: string | null;
  submittedAt: string;
}

export type AccessReviewLookup =
  | { state: "invalid" }
  | { state: "completed"; decision: "approved" | "denied" }
  | { state: "pending"; applicant: AccessReviewApplicant; expiresAt: string };

export type AccessReviewDecisionResult =
  | { state: "invalid" }
  | { state: "completed"; decision: "approved" | "denied"; changed: false }
  | {
      state: "completed";
      decision: "approved" | "denied";
      changed: true;
      user: { email: string; name: string | null };
    };

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

  private async hasMatterAccess(caseId: string, context: OwnershipContext): Promise<boolean> {
    const rows = await this.query(
      `SELECT 1
       FROM cases c
       JOIN matter_user_access access
         ON access.case_id = c.id AND access.user_id = $2
       WHERE c.id = $1 AND c.firm_id = $3
       LIMIT 1`,
      [caseId, context.userId, context.firmId]
    );
    return rows.length === 1;
  }

  private async assertMatterAccess(caseId: string, context: OwnershipContext): Promise<void> {
    if (!(await this.hasMatterAccess(caseId, context))) {
      throw new Error("Matter not found");
    }
  }

  private async assertThreadMatterAccess(
    threadId: string,
    context: OwnershipContext
  ): Promise<void> {
    const rows = await this.query(
      `SELECT case_id FROM threads
       WHERE id = $1 AND user_id = $2 AND scope <> 'client'`,
      [threadId, context.userId]
    );
    if (rows[0]?.case_id) {
      await this.assertMatterAccess(String(rows[0].case_id), context);
    }
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
      `INSERT INTO users
        (id, firm_id, name, email, onboarding_completed, workspace_type, firm_role)
       VALUES ($1, $2, $3, $4, TRUE, 'firm', 'member') ON CONFLICT (id) DO NOTHING`,
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

    await this.query(
      `INSERT INTO matter_user_access (case_id, user_id, granted_at)
       SELECT c.id, u.id, $3
       FROM cases c JOIN users u ON u.id = $2 AND u.firm_id = c.firm_id
       WHERE c.id = ANY($1::text[]) AND u.account_type = 'lawyer'
       ON CONFLICT DO NOTHING`,
      [["case_tech_employment", "case_ip_fair_use"], "user_456", createdAt]
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
    const indexingStartedAt = Date.now();

    await this.query(
      `INSERT INTO documents
        (id, firm_id, case_id, title, source_url, drive_id, extracted_text, section, uploaded_at,
         source_type, origin, processing_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Processing')`,
      [docId, firmId, caseId, title, sourceUrl, driveId, text, section, uploadedAt, sourceType, origin]
    );

    const prepared = await prepareDocumentIndex(text, docId);
    const insertStartedAt = Date.now();
    await insertDocumentChunks(docId, prepared.chunks, (query, params) => this.query(query, params));
    const indexed = await this.query(
      "SELECT COUNT(*)::int AS count FROM document_chunks WHERE document_id = $1",
      [docId]
    );
    await this.query(
      "UPDATE documents SET processing_state = $1 WHERE id = $2 AND firm_id = $3",
      [Number(indexed[0]?.count || 0) > 0 ? "Ready" : "Needs Attention", docId, firmId]
    );
    console.info("Document indexing completed.", {
      documentId: docId,
      characterCount: text.length,
      chunkCount: prepared.chunkCount,
      embeddingBatchCount: prepared.batchCount,
      embeddingDurationMs: prepared.embeddingDurationMs,
      indexingDurationMs: Date.now() - insertStartedAt,
      totalIndexingDurationMs: Date.now() - indexingStartedAt,
      fallbackToSingleCount: prepared.fallbackToSingleCount,
    });

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

  public async createSession(userId: string, tokenHash: string, expiresAt: string): Promise<void> {
    const now = new Date().toISOString();
    await this.query(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at)
       VALUES ($1, $2, $3, $4, $3)`,
      [tokenHash, userId, now, expiresAt]
    );
  }

  public async getSessionAccount(tokenHash: string): Promise<Account | null> {
    const now = new Date().toISOString();
    const rows = await this.query(
      `UPDATE sessions s
       SET last_used_at = $2
       FROM users u
       WHERE s.token_hash = $1
         AND s.user_id = u.id
         AND s.expires_at > $2
       RETURNING u.*,
         (SELECT f.name FROM firm f WHERE f.id = u.firm_id) AS firm_name,
         EXISTS (
           SELECT 1 FROM matter_client_access access
           WHERE access.claimed_by_user_id = u.id
             AND access.invitation_status = 'Active'
             AND access.revoked_at IS NULL
             AND access.token_hash IS NOT NULL
         ) AS client_access_granted`,
      [tokenHash, now]
    );
    return rows[0] ? accountFromRow(rows[0]) : null;
  }

  public async issueEmailOtp(input: {
    email: string;
    otpHash: string;
    otpSalt: string;
    expiresAt: string;
    accountType: AccountType;
  }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    await this.ensureSchema();
    const client = await getPool().connect();
    const now = new Date();
    const nowText = now.toISOString();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.email]);
      await client.query(
        `DELETE FROM email_otp_challenges
         WHERE expires_at < $1 AND created_at < $2`,
        [nowText, new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()]
      );
      const recent = await client.query<{ created_at: string }>(
        `SELECT created_at FROM email_otp_challenges
         WHERE email = $1 AND created_at > $2
         ORDER BY created_at DESC`,
        [input.email, new Date(now.getTime() - OTP_REQUEST_WINDOW_MS).toISOString()]
      );
      const lastCreatedAt = recent.rows[0]?.created_at
        ? new Date(recent.rows[0].created_at).getTime()
        : 0;
      const cooldownRemaining = OTP_RESEND_COOLDOWN_MS - (now.getTime() - lastCreatedAt);
      if (cooldownRemaining > 0 || recent.rows.length >= OTP_MAX_REQUESTS_PER_WINDOW) {
        await client.query("COMMIT");
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(
              (cooldownRemaining > 0 ? cooldownRemaining : OTP_REQUEST_WINDOW_MS) / 1000
            )
          ),
        };
      }
      await client.query(
        `UPDATE email_otp_challenges SET consumed_at = $2
         WHERE email = $1 AND consumed_at IS NULL`,
        [input.email, nowText]
      );
      await client.query(
        `INSERT INTO email_otp_challenges
          (id, email, otp_hash, otp_salt, expires_at, attempt_count, created_at, consumed_at,
           account_type)
         VALUES ($1, $2, $3, $4, $5, 0, $6, NULL, $7)`,
        [
          `otp_${randomUUID()}`,
          input.email,
          input.otpHash,
          input.otpSalt,
          input.expiresAt,
          nowText,
          input.accountType,
        ]
      );
      await client.query("COMMIT");
      return { allowed: true, retryAfterSeconds: Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async consumeEmailOtp(
    email: string,
    code: string
  ): Promise<{
    status: "verified" | "invalid" | "expired" | "attempts_exceeded";
    accountType: AccountType;
  }> {
    await this.ensureSchema();
    const client = await getPool().connect();
    const now = new Date().toISOString();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
      const result = await client.query<{
        id: string;
        otp_hash: string;
        otp_salt: string;
        expires_at: string;
        attempt_count: number;
        account_type: AccountType;
      }>(
        `SELECT id, otp_hash, otp_salt, expires_at, attempt_count, account_type
         FROM email_otp_challenges
         WHERE email = $1 AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [email]
      );
      const challenge = result.rows[0];
      if (!challenge) {
        await client.query("COMMIT");
        return { status: "invalid", accountType: "lawyer" };
      }
      if (challenge.attempt_count >= OTP_MAX_ATTEMPTS) {
        await client.query(
          "UPDATE email_otp_challenges SET consumed_at = $2 WHERE id = $1",
          [challenge.id, now]
        );
        await client.query("COMMIT");
        return { status: "attempts_exceeded", accountType: challenge.account_type };
      }
      if (challenge.expires_at <= now) {
        await client.query(
          "UPDATE email_otp_challenges SET consumed_at = $2 WHERE id = $1",
          [challenge.id, now]
        );
        await client.query("COMMIT");
        return { status: "expired", accountType: challenge.account_type };
      }
      if (!verifyOtpHash(code, challenge.otp_salt, challenge.otp_hash)) {
        const attempts = challenge.attempt_count + 1;
        await client.query(
          `UPDATE email_otp_challenges
           SET attempt_count = $2, consumed_at = CASE WHEN $2 >= $3 THEN $4 ELSE NULL END
           WHERE id = $1`,
          [challenge.id, attempts, OTP_MAX_ATTEMPTS, now]
        );
        await client.query("COMMIT");
        return {
          status: attempts >= OTP_MAX_ATTEMPTS ? "attempts_exceeded" : "invalid",
          accountType: challenge.account_type,
        };
      }
      await client.query(
        "UPDATE email_otp_challenges SET consumed_at = $2 WHERE id = $1",
        [challenge.id, now]
      );
      await client.query("COMMIT");
      return { status: "verified", accountType: challenge.account_type };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getUserByEmail(email: string): Promise<{
    id: string;
    account_type: AccountType;
    onboarding_completed: boolean;
    platform_access_status: PlatformAccessStatus;
  } | null> {
    await this.ensureSchema();
    const rows = await this.query(
      "SELECT id, account_type, onboarding_completed, platform_access_status FROM users WHERE LOWER(BTRIM(email)) = $1",
      [email]
    );
    return rows[0]
      ? {
          id: String(rows[0].id),
          account_type: rows[0].account_type as AccountType,
          onboarding_completed: Boolean(rows[0].onboarding_completed),
          platform_access_status: rows[0].platform_access_status as PlatformAccessStatus,
        }
      : null;
  }

  public async authenticateEmail(
    email: string,
    requestedAccountType: AccountType
  ): Promise<{ account: Account; isNew: boolean }> {
    await this.ensureSchema();
    const client = await getPool().connect();
    const now = new Date().toISOString();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
      const existing = await client.query<{ id: string; account_type: AccountType }>(
        "SELECT id, account_type FROM users WHERE LOWER(BTRIM(email)) = $1 FOR UPDATE",
        [email]
      );
      if (requestedAccountType === "lawyer" && (!existing.rows[0] || existing.rows[0].account_type !== "lawyer")) {
        throw new Error("LAWYER_ACCOUNT_REQUIRED");
      }
      const isNew = existing.rows.length === 0;
      const userId = existing.rows[0]?.id || `user_${randomUUID()}`;
      if (isNew) {
        await client.query(
          `INSERT INTO users
            (id, account_type, firm_id, name, email, email_verified_at, onboarding_completed,
             created_at, updated_at)
           VALUES ($1, $2, NULL, NULL, $3, $4, $5, $4, $4)`,
          [userId, requestedAccountType, email, now, requestedAccountType === "client"]
        );
      } else {
        await client.query(
          "UPDATE users SET email_verified_at = COALESCE(email_verified_at, $2), updated_at = $2 WHERE id = $1",
          [userId, now]
        );
      }
      const accountResult = await client.query(
        `SELECT u.*, f.name AS firm_name,
           EXISTS (
             SELECT 1 FROM matter_client_access access
             WHERE access.claimed_by_user_id = u.id
               AND access.invitation_status = 'Active'
               AND access.revoked_at IS NULL
               AND access.token_hash IS NOT NULL
           ) AS client_access_granted
         FROM users u LEFT JOIN firm f ON f.id = u.firm_id WHERE u.id = $1`,
        [userId]
      );
      await client.query("COMMIT");
      return { account: accountFromRow(accountResult.rows[0]), isNew };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async authenticateGoogle(input: {
    sub: string;
    email: string;
    name: string | null;
    accountType: AccountType;
  }): Promise<{ account: Account; isNew: boolean }> {
    await this.ensureSchema();
    const client = await getPool().connect();
    const now = new Date().toISOString();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.email]);
      const bySub = await client.query<{ id: string; email: string }>(
        "SELECT id, email FROM users WHERE google_sub = $1 FOR UPDATE",
        [input.sub]
      );
      const byEmail = await client.query<{ id: string; google_sub: string | null }>(
        "SELECT id, google_sub FROM users WHERE LOWER(BTRIM(email)) = $1 FOR UPDATE",
        [input.email]
      );
      if (bySub.rows[0] && byEmail.rows[0] && bySub.rows[0].id !== byEmail.rows[0].id) {
        throw new Error("GOOGLE_ACCOUNT_CONFLICT");
      }
      if (byEmail.rows[0]?.google_sub && byEmail.rows[0].google_sub !== input.sub) {
        throw new Error("GOOGLE_ACCOUNT_CONFLICT");
      }
      const isNew = !bySub.rows[0] && !byEmail.rows[0];
      const userId = bySub.rows[0]?.id || byEmail.rows[0]?.id || `user_${randomUUID()}`;
      if (isNew) {
        await client.query(
          `INSERT INTO users
            (id, account_type, firm_id, name, email, google_sub, email_verified_at,
             onboarding_completed, created_at, updated_at)
           VALUES ($1, $2, NULL, $3, $4, $5, $6,
             CASE WHEN $2 = 'client' THEN TRUE ELSE FALSE END, $6, $6)`,
          [
            userId,
            input.accountType,
            input.name,
            input.email,
            input.sub,
            now,
          ]
        );
      } else {
        await client.query(
          `UPDATE users SET google_sub = COALESCE(google_sub, $2),
             email_verified_at = COALESCE(email_verified_at, $3),
             name = COALESCE(name, $4), updated_at = $3
           WHERE id = $1`,
          [userId, input.sub, now, input.name]
        );
      }
      const accountResult = await client.query(
        `SELECT u.*, f.name AS firm_name,
           EXISTS (
             SELECT 1 FROM matter_client_access access
             WHERE access.claimed_by_user_id = u.id
               AND access.invitation_status = 'Active'
               AND access.revoked_at IS NULL
               AND access.token_hash IS NOT NULL
           ) AS client_access_granted
         FROM users u LEFT JOIN firm f ON f.id = u.firm_id WHERE u.id = $1`,
        [userId]
      );
      await client.query("COMMIT");
      return { account: accountFromRow(accountResult.rows[0]), isNew };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async submitPublicAccessRequest(input: {
    email: string;
    name: string;
    professionalRole: ProfessionalRole;
    customProfessionalRole: string | null;
    workspaceType: WorkspaceType;
    invitationCode: string | null;
    practiceAreas: string[];
    customPracticeArea: string | null;
  }): Promise<{
    account: Account;
    existing: boolean;
    status: "pending" | "approved" | "denied" | "client";
    submissionKind: "new" | "existing_pending" | "approved" | "denied" | "client";
  }> {
    await this.ensureSchema();
    const client = await getPool().connect();
    const now = new Date().toISOString();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.email]);
      const existingResult = await client.query<{
        id: string;
        account_type: AccountType;
        onboarding_completed: boolean;
        platform_access_status: PlatformAccessStatus;
        firm_id: string | null;
      }>(
        "SELECT id, account_type, onboarding_completed, platform_access_status, firm_id FROM users WHERE LOWER(BTRIM(email)) = $1 FOR UPDATE",
        [input.email]
      );
      const existingUser = existingResult.rows[0];
      if (existingUser && existingUser.account_type !== "lawyer") {
        await client.query("COMMIT");
        return {
          account: await this.getAccountForUser(existingUser.id, client),
          existing: true,
          status: "client",
          submissionKind: "client",
        };
      }
      if (!existingUser) {
        let firmId: string | null = null;
        if (input.workspaceType === "firm") {
          const firmResult = await client.query<{ id: string }>(
            `SELECT id FROM firm
             WHERE invitation_code IS NOT NULL AND UPPER(BTRIM(invitation_code)) = $1`,
            [input.invitationCode]
          );
          if (!firmResult.rows[0]) throw new Error("INVALID_INVITATION_CODE");
          firmId = firmResult.rows[0].id;
        } else {
          firmId = `firm_${randomUUID()}`;
          await client.query("INSERT INTO firm (id, name) VALUES ($1, 'Personal Workspace')", [firmId]);
        }
        const userId = `user_${randomUUID()}`;
        await client.query(
          `INSERT INTO users
            (id, account_type, firm_id, name, email, email_verified_at, onboarding_completed,
             professional_role, custom_professional_role, workspace_type, practice_areas,
             custom_practice_area, firm_role, platform_access_status, access_submitted_at,
             created_at, updated_at)
           VALUES ($1, 'lawyer', $2, $3, $4, NULL, TRUE, $5, $6, $7, $8::jsonb, $9, $10, 'pending', $11, $11, $11)`,
          [
            userId,
            firmId,
            input.name,
            input.email,
            input.professionalRole,
            input.customProfessionalRole,
            input.workspaceType,
            JSON.stringify(input.practiceAreas),
            input.customPracticeArea,
            input.workspaceType === "independent" ? "admin" : "member",
            now,
          ]
        );
        await client.query("COMMIT");
        return {
          account: await this.getAccountForUser(userId, client),
          existing: false,
          status: "pending",
          submissionKind: "new",
        };
      }
      if (!existingUser.onboarding_completed) {
        let firmId = existingUser.firm_id;
        if (input.workspaceType === "firm") {
          const firmResult = await client.query<{ id: string }>(
            `SELECT id FROM firm
             WHERE invitation_code IS NOT NULL AND UPPER(BTRIM(invitation_code)) = $1`,
            [input.invitationCode]
          );
          if (!firmResult.rows[0]) throw new Error("INVALID_INVITATION_CODE");
          firmId = firmResult.rows[0].id;
        } else if (!firmId) {
          firmId = `firm_${randomUUID()}`;
          await client.query("INSERT INTO firm (id, name) VALUES ($1, 'Personal Workspace')", [firmId]);
        }
        await client.query(
          `UPDATE users SET firm_id = $2, name = $3, professional_role = $4,
             custom_professional_role = $5, workspace_type = $6, practice_areas = $7::jsonb,
             custom_practice_area = $8, firm_role = $9, onboarding_completed = TRUE,
             platform_access_status = 'pending',
             access_submitted_at = COALESCE(access_submitted_at, $10),
             updated_at = $10
           WHERE id = $1`,
          [
            existingUser.id,
            firmId,
            input.name,
            input.professionalRole,
            input.customProfessionalRole,
            input.workspaceType,
            JSON.stringify(input.practiceAreas),
            input.customPracticeArea,
            input.workspaceType === "independent" ? "admin" : "member",
            now,
          ]
        );
        await client.query("COMMIT");
        return {
          account: await this.getAccountForUser(existingUser.id, client),
          existing: true,
          status: "pending",
          submissionKind: "new",
        };
      }
      if (existingUser.platform_access_status === "approved") {
        await client.query("COMMIT");
        return {
          account: await this.getAccountForUser(existingUser.id, client),
          existing: true,
          status: "approved",
          submissionKind: "approved",
        };
      }
      if (existingUser.platform_access_status === "denied") {
        await client.query("COMMIT");
        return {
          account: await this.getAccountForUser(existingUser.id, client),
          existing: true,
          status: "denied",
          submissionKind: "denied",
        };
      }
      await client.query("COMMIT");
      return {
        account: await this.getAccountForUser(existingUser.id, client),
        existing: true,
        status: "pending",
        submissionKind: "existing_pending",
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async getAccountForUser(userId: string, client?: pg.PoolClient): Promise<Account> {
    if (client) {
      const result = await client.query(
        `SELECT u.*, f.name AS firm_name,
           EXISTS (
             SELECT 1 FROM matter_client_access access
             WHERE access.claimed_by_user_id = u.id
               AND access.invitation_status = 'Active'
               AND access.revoked_at IS NULL
               AND access.token_hash IS NOT NULL
           ) AS client_access_granted
         FROM users u LEFT JOIN firm f ON f.id = u.firm_id WHERE u.id = $1`,
        [userId]
      );
      return accountFromRow(result.rows[0]);
    }

    const rows = await this.query(
      `SELECT u.*, f.name AS firm_name,
         EXISTS (
           SELECT 1 FROM matter_client_access access
           WHERE access.claimed_by_user_id = u.id
             AND access.invitation_status = 'Active'
             AND access.revoked_at IS NULL
             AND access.token_hash IS NOT NULL
         ) AS client_access_granted
       FROM users u LEFT JOIN firm f ON f.id = u.firm_id WHERE u.id = $1`,
      [userId]
    );
    return accountFromRow(rows[0]);
  }

  public async completeOnboarding(input: {
    userId: string;
    name: string;
    professionalRole: ProfessionalRole;
    customProfessionalRole: string | null;
    workspaceType: WorkspaceType;
    invitationCode: string | null;
    practiceAreas: string[];
    customPracticeArea: string | null;
  }): Promise<Account> {
    await this.ensureSchema();
    const client = await getPool().connect();
    const now = new Date().toISOString();
    try {
      await client.query("BEGIN");
      const userResult = await client.query<{
        id: string;
        account_type: AccountType;
        firm_id: string | null;
        onboarding_completed: boolean;
      }>(
        "SELECT id, firm_id, onboarding_completed, account_type FROM users WHERE id = $1 FOR UPDATE",
        [input.userId]
      );
      const user = userResult.rows[0];
      if (!user) throw new Error("USER_NOT_FOUND");
      if (user.account_type !== "lawyer") throw new Error("LAWYER_ACCOUNT_REQUIRED");
      let firmId = user.firm_id;
      const shouldCreate = !user.onboarding_completed;
      if (shouldCreate) {
        if (input.workspaceType === "firm") {
          const firmResult = await client.query<{ id: string }>(
            `SELECT id FROM firm
             WHERE invitation_code IS NOT NULL AND UPPER(BTRIM(invitation_code)) = $1`,
            [input.invitationCode]
          );
          if (!firmResult.rows[0]) throw new Error("INVALID_INVITATION_CODE");
          firmId = firmResult.rows[0].id;
        } else if (!firmId) {
          firmId = `firm_${randomUUID()}`;
          await client.query("INSERT INTO firm (id, name) VALUES ($1, 'Personal Workspace')", [
            firmId,
          ]);
        }
        await client.query(
          `UPDATE users SET firm_id = $2, name = $3, professional_role = $4,
             custom_professional_role = $5, workspace_type = $6, practice_areas = $7::jsonb,
             custom_practice_area = $8, firm_role = $9, onboarding_completed = TRUE,
             platform_access_status = 'pending',
             access_submitted_at = COALESCE(access_submitted_at, $10),
             updated_at = $10
           WHERE id = $1`,
          [
            input.userId,
            firmId,
            input.name,
            input.professionalRole,
            input.customProfessionalRole,
            input.workspaceType,
            JSON.stringify(input.practiceAreas),
            input.customPracticeArea,
            input.workspaceType === "independent" ? "admin" : "member",
            now,
          ]
        );
      }
      const accountResult = await client.query(
        `SELECT u.*, f.name AS firm_name,
           EXISTS (
             SELECT 1 FROM matter_client_access access
             WHERE access.claimed_by_user_id = u.id
               AND access.invitation_status = 'Active'
               AND access.revoked_at IS NULL
               AND access.token_hash IS NOT NULL
           ) AS client_access_granted
         FROM users u LEFT JOIN firm f ON f.id = u.firm_id WHERE u.id = $1`,
        [input.userId]
      );
      await client.query("COMMIT");
      return accountFromRow(accountResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async deleteSession(tokenHash: string): Promise<void> {
    await this.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  public async issueAccessReviewRequest(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<
    | { allowed: false; reason: "unavailable" }
    | { allowed: false; reason: "rate_limited"; retryAfterSeconds: number }
    | { allowed: true; requestId: string; applicant: AccessReviewApplicant }
  > {
    await this.ensureSchema();
    const client = await getPool().connect();
    const now = new Date();
    const nowText = now.toISOString();
    try {
      await client.query("BEGIN");
      const userResult = await client.query<{
        id: string;
        name: string | null;
        email: string;
        professional_role: ProfessionalRole | null;
        custom_professional_role: string | null;
        workspace_type: WorkspaceType | null;
        firm_name: string | null;
        practice_areas: unknown;
        custom_practice_area: string | null;
        access_submitted_at: string | null;
        account_type: AccountType;
        onboarding_completed: boolean;
        platform_access_status: PlatformAccessStatus;
      }>(
        `SELECT u.*, f.name AS firm_name
         FROM users u LEFT JOIN firm f ON f.id = u.firm_id
         WHERE u.id = $1 FOR UPDATE OF u`,
        [input.userId]
      );
      const user = userResult.rows[0];
      if (
        !user || user.account_type !== "lawyer" || !user.onboarding_completed ||
        user.platform_access_status !== "pending" || !user.name ||
        !user.professional_role || !user.workspace_type || !user.access_submitted_at
      ) {
        await client.query("COMMIT");
        return { allowed: false, reason: "unavailable" };
      }
      const recent = await client.query<{ created_at: string }>(
        `SELECT created_at FROM access_review_requests
         WHERE user_id = $1 AND created_at > $2
         ORDER BY created_at DESC`,
        [input.userId, new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()]
      );
      const latestMs = recent.rows[0] ? new Date(recent.rows[0].created_at).getTime() : 0;
      const cooldownMs = ACCESS_REVIEW_RESEND_COOLDOWN_MS - (now.getTime() - latestMs);
      const dailyMs = recent.rows.length >= ACCESS_REVIEW_DAILY_LIMIT
        ? new Date(recent.rows[recent.rows.length - 1].created_at).getTime() +
          24 * 60 * 60 * 1000 - now.getTime()
        : 0;
      if (cooldownMs > 0 || dailyMs > 0) {
        await client.query("COMMIT");
        return {
          allowed: false,
          reason: "rate_limited",
          retryAfterSeconds: Math.max(1, Math.ceil(Math.max(cooldownMs, dailyMs) / 1000)),
        };
      }
      await client.query(
        `UPDATE access_review_requests SET invalidated_at = $2
         WHERE user_id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
        [input.userId, nowText]
      );
      const requestId = `access_review_${randomUUID()}`;
      await client.query(
        `INSERT INTO access_review_requests
          (id, user_id, token_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [requestId, input.userId, input.tokenHash, nowText, input.expiresAt]
      );
      await client.query("COMMIT");
      return {
        allowed: true,
        requestId,
        applicant: {
          userId: user.id,
          fullName: user.name,
          email: user.email,
          professionalRole: user.professional_role,
          customProfessionalRole: user.custom_professional_role,
          workspaceType: user.workspace_type,
          firmName: user.workspace_type === "firm" ? user.firm_name : null,
          practiceAreas: Array.isArray(user.practice_areas)
            ? user.practice_areas.map(String)
            : [],
          customPracticeArea: user.custom_practice_area,
          submittedAt: user.access_submitted_at,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async markAccessReviewNotification(
    requestId: string,
    delivered: boolean
  ): Promise<void> {
    if (delivered) {
      await this.query(
        "UPDATE access_review_requests SET notification_sent_at = $2 WHERE id = $1",
        [requestId, new Date().toISOString()]
      );
    } else {
      await this.query(
        "UPDATE access_review_requests SET notification_failed_at = $2 WHERE id = $1",
        [requestId, new Date().toISOString()]
      );
    }
  }

  public async getAccessReview(tokenHash: string): Promise<AccessReviewLookup> {
    const rows = await this.query(
      `SELECT request.expires_at, request.consumed_at, request.invalidated_at,
         request.decision, u.id, u.name, u.email, u.professional_role,
         u.custom_professional_role, u.workspace_type, u.practice_areas,
         u.custom_practice_area, u.access_submitted_at, f.name AS firm_name
       FROM access_review_requests request
       JOIN users u ON u.id = request.user_id
       LEFT JOIN firm f ON f.id = u.firm_id
       WHERE request.token_hash = $1`,
      [tokenHash]
    );
    const row = rows[0];
    if (!row) return { state: "invalid" };
    if (row.consumed_at && (row.decision === "approved" || row.decision === "denied")) {
      return { state: "completed", decision: row.decision };
    }
    if (row.invalidated_at || row.expires_at <= new Date().toISOString()) {
      return { state: "invalid" };
    }
    return {
      state: "pending",
      expiresAt: String(row.expires_at),
      applicant: {
        userId: String(row.id),
        fullName: String(row.name),
        email: String(row.email),
        professionalRole: row.professional_role as ProfessionalRole,
        customProfessionalRole: row.custom_professional_role
          ? String(row.custom_professional_role) : null,
        workspaceType: row.workspace_type as WorkspaceType,
        firmName: row.workspace_type === "firm" && row.firm_name
          ? String(row.firm_name) : null,
        practiceAreas: Array.isArray(row.practice_areas) ? row.practice_areas.map(String) : [],
        customPracticeArea: row.custom_practice_area
          ? String(row.custom_practice_area) : null,
        submittedAt: String(row.access_submitted_at),
      },
    };
  }

  public async decideAccessReview(
    tokenHash: string,
    decision: "approved" | "denied"
  ): Promise<AccessReviewDecisionResult> {
    await this.ensureSchema();
    const client = await getPool().connect();
    const now = new Date().toISOString();
    try {
      await client.query("BEGIN");
      const requestResult = await client.query<{
        id: string;
        user_id: string;
        expires_at: string;
        consumed_at: string | null;
        invalidated_at: string | null;
        decision: "approved" | "denied" | null;
      }>(
        `SELECT id, user_id, expires_at, consumed_at, invalidated_at, decision
         FROM access_review_requests WHERE token_hash = $1 FOR UPDATE`,
        [tokenHash]
      );
      const request = requestResult.rows[0];
      if (!request) {
        await client.query("COMMIT");
        return { state: "invalid" };
      }
      if (request.consumed_at && request.decision) {
        await client.query("COMMIT");
        return { state: "completed", decision: request.decision, changed: false };
      }
      if (request.invalidated_at || request.expires_at <= now) {
        await client.query("COMMIT");
        return { state: "invalid" };
      }
      const userResult = await client.query<{
        id: string;
        email: string;
        name: string | null;
        account_type: AccountType;
        onboarding_completed: boolean;
        firm_id: string | null;
      }>(
        `SELECT id, email, name, account_type, onboarding_completed, firm_id
         FROM users WHERE id = $1 FOR UPDATE`,
        [request.user_id]
      );
      const user = userResult.rows[0];
      if (!user || user.account_type !== "lawyer" || !user.onboarding_completed || !user.firm_id) {
        await client.query("ROLLBACK");
        return { state: "invalid" };
      }
      await client.query(
        `UPDATE users SET platform_access_status = $2, access_reviewed_at = $3,
           updated_at = $3 WHERE id = $1`,
        [user.id, decision, now]
      );
      await client.query(
        `UPDATE access_review_requests SET consumed_at = $2, decision = $3 WHERE id = $1`,
        [request.id, now, decision]
      );
      await client.query("COMMIT");
      return {
        state: "completed",
        decision,
        changed: true,
        user: { email: user.email, name: user.name },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getFirmAdminSettings(
    context: OwnershipContext
  ): Promise<FirmAdminSettings | null> {
    const firms = await this.query(
      `SELECT f.id, f.name, f.invitation_code
       FROM firm f
       WHERE f.id = $2
         AND EXISTS (
           SELECT 1 FROM users administrator
           WHERE administrator.id = $1
             AND administrator.firm_id = f.id
             AND administrator.firm_role = 'admin'
         )`,
      [context.userId, context.firmId]
    );
    const firm = firms[0];
    if (!firm) return null;

    const members = await this.query(
      `SELECT id, name, email, professional_role, custom_professional_role, firm_role
       FROM users
       WHERE firm_id = $1
         AND account_type = 'lawyer'
         AND platform_access_status = 'approved'
       ORDER BY CASE firm_role WHEN 'admin' THEN 0 ELSE 1 END,
                LOWER(COALESCE(name, email)), LOWER(email)`,
      [context.firmId]
    );
    return {
      firm: {
        id: String(firm.id),
        name: String(firm.name),
        invitationCode: firm.invitation_code ? String(firm.invitation_code) : null,
      },
      members: members.map((member) => ({
        id: String(member.id),
        name: member.name ? String(member.name) : null,
        email: String(member.email),
        professionalRole: (member.professional_role || null) as ProfessionalRole | null,
        customProfessionalRole: member.custom_professional_role
          ? String(member.custom_professional_role)
          : null,
        firmRole: member.firm_role as FirmRole,
      })),
    };
  }

  public async getAssistantSafeFirmSummary(
    context: OwnershipContext,
    includeMembers: boolean
  ): Promise<{
    firmName: string;
    firmRole: FirmRole;
    members?: Array<{
      name: string | null;
      email: string;
      professionalRole: ProfessionalRole | null;
      customProfessionalRole: string | null;
      firmRole: FirmRole;
    }>;
  } | null> {
    const rows = await this.query(
      `SELECT f.name AS firm_name, u.firm_role
       FROM users u JOIN firm f ON f.id = u.firm_id
       WHERE u.id = $1 AND u.firm_id = $2 AND f.id = $2
         AND u.account_type = 'lawyer'`,
      [context.userId, context.firmId]
    );
    if (!rows[0]) return null;
    const firmRole = rows[0].firm_role as FirmRole;
    const result: {
      firmName: string;
      firmRole: FirmRole;
      members?: Array<{
        name: string | null;
        email: string;
        professionalRole: ProfessionalRole | null;
        customProfessionalRole: string | null;
        firmRole: FirmRole;
      }>;
    } = { firmName: String(rows[0].firm_name), firmRole };
    if (includeMembers && firmRole === "admin") {
      const members = await this.query(
        `SELECT name, email, professional_role, custom_professional_role, firm_role
         FROM users WHERE firm_id = $1 AND account_type = 'lawyer'
           AND platform_access_status = 'approved'
         ORDER BY CASE firm_role WHEN 'admin' THEN 0 ELSE 1 END,
           LOWER(COALESCE(name, email)), LOWER(email)
         LIMIT 50`,
        [context.firmId]
      );
      result.members = members.map((member) => ({
        name: member.name ? String(member.name) : null,
        email: String(member.email),
        professionalRole: (member.professional_role || null) as ProfessionalRole | null,
        customProfessionalRole: member.custom_professional_role
          ? String(member.custom_professional_role)
          : null,
        firmRole: member.firm_role as FirmRole,
      }));
    }
    return result;
  }

  public async updateFirmName(
    name: string,
    context: OwnershipContext
  ): Promise<{ id: string; name: string } | null> {
    const rows = await this.query(
      `UPDATE firm f
       SET name = $3
       WHERE f.id = $2
         AND EXISTS (
           SELECT 1 FROM users administrator
           WHERE administrator.id = $1
             AND administrator.firm_id = f.id
             AND administrator.firm_role = 'admin'
         )
       RETURNING f.id, f.name`,
      [context.userId, context.firmId, name]
    );
    return rows[0] ? { id: String(rows[0].id), name: String(rows[0].name) } : null;
  }

  public async regenerateFirmInvitationCode(
    context: OwnershipContext
  ): Promise<string | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const invitationCode = `EXE-${randomBytes(8).toString("hex").toUpperCase()}`;
      try {
        const rows = await this.query(
          `UPDATE firm f
           SET invitation_code = $3
           WHERE f.id = $2
             AND EXISTS (
               SELECT 1 FROM users administrator
               WHERE administrator.id = $1
                 AND administrator.firm_id = f.id
                 AND administrator.firm_role = 'admin'
             )
           RETURNING f.invitation_code`,
          [context.userId, context.firmId, invitationCode]
        );
        return rows[0] ? String(rows[0].invitation_code) : null;
      } catch (error) {
        if ((error as { code?: string }).code !== "23505") throw error;
      }
    }
    throw new Error("INVITATION_CODE_GENERATION_FAILED");
  }

  public async getCases(context: OwnershipContext): Promise<Case[]> {
    return await this.query(
      `SELECT c.* FROM cases c
       JOIN matter_user_access access
         ON access.case_id = c.id AND access.user_id = $1
       WHERE c.firm_id = $2
       ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC`,
      [context.userId, context.firmId]
    );
  }

  public async getCaseById(id: string, context: OwnershipContext): Promise<Case | undefined> {
    const rows = await this.query(
      `SELECT c.* FROM cases c
       JOIN matter_user_access access
         ON access.case_id = c.id AND access.user_id = $2
       WHERE c.id = $1 AND c.firm_id = $3`,
      [id, context.userId, context.firmId]
    );
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

    const rows = await this.query(
      `WITH created_case AS (
         INSERT INTO cases
        (id, firm_id, name, description, created_at, status, client_name, client_email,
         updated_at, last_activity_at)
         SELECT $1, u.firm_id, $4, $5, $6, 'Open', $7, $8, $6, $6
         FROM users u
         WHERE u.id = $2 AND u.firm_id = $3 AND u.account_type = 'lawyer'
         RETURNING *
       ), granted_access AS (
         INSERT INTO matter_user_access (case_id, user_id, granted_at)
         SELECT id, $2, $6 FROM created_case
         RETURNING case_id
       )
       SELECT created_case.* FROM created_case
       JOIN granted_access ON granted_access.case_id = created_case.id`,
      [caseId, context.userId, context.firmId, name, description, createdAt,
       details.clientName || null, details.clientEmail || null]
    );
    if (!rows[0]) throw new Error("Matter not found");

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
    await this.assertMatterAccess(id, context);
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

  public async listFirmLibraryDocumentMetadata(
    context: OwnershipContext
  ): Promise<Array<{ id: string; title: string }>> {
    return await this.query(
      `SELECT id, title FROM documents
       WHERE firm_id = $1 AND case_id IS NULL AND is_generated_draft_duplicate = FALSE
       ORDER BY title ASC, id ASC`,
      [context.firmId]
    );
  }

  public async linkLibraryDocument(
    caseId: string, documentId: string, linkOrigin: "Manual" | "Starting Input", context: OwnershipContext
  ): Promise<boolean> {
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
    await this.query(
      "UPDATE cases SET last_activity_at = $1, updated_at = $1 WHERE id = $2 AND firm_id = $3",
      [new Date().toISOString(), caseId, context.firmId]
    );
  }

  public async getMatterSourceSnapshot(caseId: string, context: OwnershipContext): Promise<
    Array<{ id: string; uploaded_at: string; processing_state: string; link_origin: string | null }>
  > {
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
    const matter = await this.getCaseById(caseId, context);
    if (!matter) throw new Error("Matter not found");
    const sources = await this.getCaseSources(caseId, context);
    const snapshot = await this.getMatterSourceSnapshot(caseId, context);
    return { matter, sources, snapshot };
  }

  public async saveGeneratedMatterIntelligence(
    caseId: string, content: string, snapshot: any[], context: OwnershipContext
  ): Promise<any> {
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
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

  public async getActiveClientCollaborator(
    caseId: string, context: OwnershipContext
  ): Promise<any | null> {
    await this.assertMatterAccess(caseId, context);
    const rows = await this.query(
      `SELECT ca.client_name, ca.client_email, c.name AS matter_name
       FROM matter_client_access ca
       JOIN cases c ON c.id = ca.case_id
       WHERE ca.case_id = $1
         AND c.firm_id = $2
         AND ca.invitation_status = 'Active'
         AND ca.revoked_at IS NULL
       LIMIT 1`,
      [caseId, context.firmId]
    );
    return rows[0] || null;
  }

  public async getApprovedMatterLawyers(
    caseId: string, firmId: string
  ): Promise<Array<{ name: string | null; email: string }>> {
    return await this.query(
      `SELECT DISTINCT u.name, u.email
       FROM matter_user_access access
       JOIN cases c ON c.id = access.case_id
       JOIN users u ON u.id = access.user_id AND u.firm_id = c.firm_id
       WHERE access.case_id = $1
         AND c.firm_id = $2
         AND u.account_type = 'lawyer'
         AND u.platform_access_status = 'approved'
         AND NULLIF(BTRIM(u.email), '') IS NOT NULL`,
      [caseId, firmId]
    );
  }

  public async getCollaborationRequestType(
    caseId: string, requestId: string, firmId: string
  ): Promise<string | null> {
    const rows = await this.query(
      `SELECT cr.request_type
       FROM collaboration_requests cr
       JOIN cases c ON c.id = cr.case_id
       WHERE cr.id = $1 AND cr.case_id = $2 AND c.firm_id = $3
       LIMIT 1`,
      [requestId, caseId, firmId]
    );
    return rows[0]?.request_type || null;
  }

  public async activateClientInvite(
    caseId: string, tokenHash: string, context: OwnershipContext
  ): Promise<any> {
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
    const rows = await this.query(
      `UPDATE matter_client_access ca SET token_hash = NULL, invitation_status = 'Revoked',
         revoked_at = $1, claimed_by_user_id = NULL
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
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
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

  public async resolveClientPortalAccess(
    tokenHash: string,
    clientUserId: string
  ): Promise<any | null> {
    const rows = await this.query(
      `SELECT ca.id AS access_id, ca.case_id, ca.client_name, ca.client_email,
         ca.token_hash, c.firm_id, c.name AS matter_name, f.name AS firm_name
       FROM matter_client_access ca
       JOIN cases c ON c.id = ca.case_id
       LEFT JOIN firm f ON f.id = c.firm_id
       WHERE ca.token_hash = $1
         AND ca.claimed_by_user_id = $2
         AND ca.invitation_status = 'Active'
         AND ca.revoked_at IS NULL`,
      [tokenHash, clientUserId]
    );
    return rows[0] || null;
  }

  public async getClientAccessInvitation(accessId: string): Promise<any | null> {
    const rows = await this.query(
      `SELECT ca.id, ca.client_name, ca.client_email, c.name AS matter_name, f.name AS firm_name
       FROM matter_client_access ca
       JOIN cases c ON c.id = ca.case_id
       LEFT JOIN firm f ON f.id = c.firm_id
       WHERE ca.id = $1
         AND ca.invitation_status = 'Active'
         AND ca.revoked_at IS NULL
         AND ca.token_hash IS NOT NULL
       LIMIT 1`,
      [accessId]
    );
    return rows[0] || null;
  }

  public async redeemClientInvitation(
    accessId: string,
    tokenHash: string
  ): Promise<{ account: Account; accessId: string }>
  {
    await this.ensureSchema();
    const client = await getPool().connect();
    const now = new Date().toISOString();
    try {
      await client.query("BEGIN");
      // Lock the access row matching both id and token_hash
      const accessResult = await client.query(
        `SELECT id, case_id, client_name, client_email, claimed_by_user_id
         FROM matter_client_access
         WHERE id = $1
           AND token_hash = $2
           AND invitation_status = 'Active'
           AND revoked_at IS NULL
         FOR UPDATE`,
        [accessId, tokenHash]
      );
      const access = accessResult.rows[0];
      if (!access) throw new Error("CLIENT_INVITATION_INVALID");

      let clientUserId = access.claimed_by_user_id;

      if (!clientUserId) {
        // find or create user by email
        const email = (access.client_email || "").toLowerCase().trim();
        if (!email) throw new Error("CLIENT_INVITATION_INVALID");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
        const existing = await client.query(`SELECT id, account_type FROM users WHERE LOWER(BTRIM(email)) = $1 FOR UPDATE`, [email]);
        if (existing.rows[0] && existing.rows[0].account_type === 'lawyer') {
          throw new Error("CLIENT_EMAIL_CONFLICT");
        }
        if (!existing.rows[0]) {
          clientUserId = `user_${randomUUID()}`;
          await client.query(
            `INSERT INTO users (id, account_type, firm_id, name, email, email_verified_at, onboarding_completed, platform_access_status, created_at, updated_at)
             VALUES ($1, 'client', NULL, $2, $3, NULL, TRUE, 'approved', $4, $4)`,
            [clientUserId, access.client_name || null, email, now]
          );
        } else {
          clientUserId = existing.rows[0].id;
        }
      }

      // Enforce one-client-one-matter: ensure this user does not already claim another active access
      const conflict = await client.query(
        `SELECT 1 FROM matter_client_access ca
         WHERE ca.claimed_by_user_id = $1
           AND ca.id <> $2
           AND ca.invitation_status = 'Active'
           AND ca.revoked_at IS NULL
           AND ca.token_hash IS NOT NULL
         LIMIT 1`,
        [clientUserId, accessId]
      );
      if (conflict.rows[0]) throw new Error("CLIENT_ALREADY_HAS_ACTIVE_MATTER");

      // Claim the access if not already claimed
      await client.query(
        `UPDATE matter_client_access SET claimed_by_user_id = $1 WHERE id = $2 AND (claimed_by_user_id IS NULL OR claimed_by_user_id = $1)`,
        [clientUserId, accessId]
      );

      // Ensure client user platform status
      await client.query(
        `UPDATE users SET platform_access_status = 'approved', updated_at = $2 WHERE id = $1 AND account_type = 'client'`,
        [clientUserId, now]
      );

      const accountResult = await client.query(
        `SELECT u.*, f.name AS firm_name,
           EXISTS (
             SELECT 1 FROM matter_client_access access WHERE access.claimed_by_user_id = u.id AND access.invitation_status = 'Active' AND access.revoked_at IS NULL AND access.token_hash IS NOT NULL
           ) AS client_access_granted
         FROM users u LEFT JOIN firm f ON f.id = u.firm_id WHERE u.id = $1`,
        [clientUserId]
      );

      await client.query("COMMIT");
      return { account: accountFromRow(accountResult.rows[0]), accessId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async claimClientCollaboration(
    tokenHash: string,
    clientUserId: string
  ): Promise<any> {
    await this.ensureSchema();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query<{
        id: string;
        account_type: AccountType;
      }>(
        `SELECT id, account_type
         FROM users
         WHERE id = $1
         FOR UPDATE`,
        [clientUserId]
      );
      const user = userResult.rows[0];
      if (!user || user.account_type !== "client") {
        throw new Error("CLIENT_COLLABORATION_UNAVAILABLE");
      }

      const accessResult = await client.query<{
        id: string;
        case_id: string;
        claimed_by_user_id: string | null;
        matter_name: string;
        firm_name: string | null;
      }>(
        `SELECT ca.id, ca.case_id, ca.claimed_by_user_id,
           c.name AS matter_name, f.name AS firm_name
         FROM matter_client_access ca
         JOIN cases c ON c.id = ca.case_id
         LEFT JOIN firm f ON f.id = c.firm_id
         WHERE ca.token_hash = $1
           AND ca.invitation_status = 'Active'
           AND ca.revoked_at IS NULL
         FOR UPDATE OF ca`,
        [tokenHash]
      );
      const access = accessResult.rows[0];
      if (
        !access ||
        (access.claimed_by_user_id && access.claimed_by_user_id !== clientUserId)
      ) {
        throw new Error("CLIENT_COLLABORATION_UNAVAILABLE");
      }

      if (!access.claimed_by_user_id) {
        await client.query(
          `UPDATE matter_client_access
           SET claimed_by_user_id = $1
           WHERE id = $2 AND claimed_by_user_id IS NULL`,
          [clientUserId, access.id]
        );
      }
      await client.query(
        `UPDATE users SET platform_access_status = 'approved', updated_at = $2
         WHERE id = $1 AND account_type = 'client'`,
        [clientUserId, new Date().toISOString()]
      );
      await client.query("COMMIT");
      return {
        id: access.id,
        matterName: access.matter_name,
        firmName: access.firm_name,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getClientSharedMatters(clientUserId: string): Promise<any[]> {
    return await this.query(
      `SELECT ca.id, c.name AS matter_name, f.name AS firm_name,
         (
           SELECT COUNT(*)::int
           FROM collaboration_requests cr
           WHERE cr.case_id = ca.case_id AND cr.status <> 'Responded'
         ) AS active_request_count,
         (
           SELECT COUNT(*)::int
           FROM drafts d
           WHERE d.case_id = ca.case_id AND d.shared_with_client = TRUE
         ) AS shared_document_count,
         GREATEST(
           ca.activated_at,
           COALESCE((SELECT MAX(COALESCE(d.updated_at, d.created_at))
             FROM drafts d WHERE d.case_id = ca.case_id AND d.shared_with_client = TRUE), ca.activated_at),
           COALESCE((SELECT MAX(cr.updated_at)
             FROM collaboration_requests cr WHERE cr.case_id = ca.case_id), ca.activated_at)
         ) AS last_shared_activity_at
       FROM matter_client_access ca
       JOIN cases c ON c.id = ca.case_id
       LEFT JOIN firm f ON f.id = c.firm_id
       WHERE ca.claimed_by_user_id = $1
         AND ca.invitation_status = 'Active'
         AND ca.revoked_at IS NULL
         AND ca.token_hash IS NOT NULL
       ORDER BY last_shared_activity_at DESC NULLS LAST, c.name`,
      [clientUserId]
    );
  }

  public async getClientAssistantDocuments(clientUserId: string): Promise<any[]> {
    return await this.query(
      `SELECT DISTINCT d.id, d.title, c.name AS matter_name,
         'Ready'::text AS processing_state, 'Work Product'::text AS file_type
       FROM matter_client_access ca
       JOIN cases c ON c.id = ca.case_id
       JOIN drafts d ON d.case_id = ca.case_id
       WHERE ca.claimed_by_user_id = $1
         AND ca.invitation_status = 'Active'
         AND ca.revoked_at IS NULL
         AND ca.token_hash IS NOT NULL
         AND (
           d.shared_with_client = TRUE OR EXISTS (
             SELECT 1
             FROM collaboration_request_documents request_document
             JOIN collaboration_requests request
               ON request.id = request_document.request_id
             WHERE request_document.draft_id = d.id
               AND request.case_id = ca.case_id
           )
         )
       ORDER BY c.name, d.title, d.id`,
      [clientUserId]
    );
  }

  public async getAuthorizedClientAssistantDocuments(
    clientUserId: string,
    documentIds: string[]
  ): Promise<Array<{ id: string; title: string; matter_name: string; content: string }>> {
    if (documentIds.length === 0) return [];
    const rows = await this.query(
      `SELECT DISTINCT d.id, d.title, c.name AS matter_name, d.content
       FROM matter_client_access ca
       JOIN cases c ON c.id = ca.case_id
       JOIN drafts d ON d.case_id = ca.case_id
       WHERE ca.claimed_by_user_id = $1
         AND ca.invitation_status = 'Active'
         AND ca.revoked_at IS NULL
         AND ca.token_hash IS NOT NULL
         AND d.id = ANY($2::text[])
         AND (
           d.shared_with_client = TRUE OR EXISTS (
             SELECT 1
             FROM collaboration_request_documents request_document
             JOIN collaboration_requests request
               ON request.id = request_document.request_id
             WHERE request_document.draft_id = d.id
               AND request.case_id = ca.case_id
           )
         )`,
      [clientUserId, documentIds]
    );
    if (rows.length !== documentIds.length) {
      throw new Error("CLIENT_ASSISTANT_DOCUMENT_UNAVAILABLE");
    }
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    return documentIds.map((id) => byId.get(id)!);
  }

  public async resolveClientSharedMatter(
    accessId: string,
    clientUserId: string
  ): Promise<any | null> {
    const rows = await this.query(
      `SELECT ca.id AS access_id, ca.case_id, ca.client_name, ca.client_email,
         ca.token_hash, c.firm_id, c.name AS matter_name, f.name AS firm_name
       FROM matter_client_access ca
       JOIN cases c ON c.id = ca.case_id
       LEFT JOIN firm f ON f.id = c.firm_id
       WHERE ca.id = $1
         AND ca.claimed_by_user_id = $2
         AND ca.invitation_status = 'Active'
         AND ca.revoked_at IS NULL
         AND ca.token_hash IS NOT NULL`,
      [accessId, clientUserId]
    );
    return rows[0] || null;
  }

  public async getClientSharedMatterSummary(
    accessId: string,
    clientUserId: string
  ): Promise<any | null> {
    const access = await this.resolveClientSharedMatter(accessId, clientUserId);
    if (!access) return null;
    const summary = await this.getPortalSummary(access.token_hash);
    if (!summary) return null;
    return {
      ...summary,
      access: {
        id: access.access_id,
        client_name: access.client_name,
        matter_name: access.matter_name,
        firm_name: access.firm_name,
      },
    };
  }

  public async getClientPermittedDraft(
    accessId: string,
    draftId: string,
    clientUserId: string
  ): Promise<any | null> {
    const access = await this.resolveClientSharedMatter(accessId, clientUserId);
    return access ? await this.getPermittedPortalDraft(access.token_hash, draftId) : null;
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
    if (!access || !original || original.revision_type === "Client Revision") {
      throw new Error("Shared Work Product not found");
    }
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
        const indexingStartedAt = Date.now();
        await client.query(
          `INSERT INTO documents
            (id, firm_id, case_id, title, source_url, drive_id, extracted_text, section, uploaded_at,
             source_type, origin, processing_state)
           VALUES ($1, $2, $3, $4, NULL, NULL, $5, 'Client Submission', $6,
             'Client Submission', 'Client', 'Processing')`,
          [documentId, access.firm_id, access.case_id, file.filename, file.text, now]
        );
        const prepared = await prepareDocumentIndex(file.text, documentId);
        const insertStartedAt = Date.now();
        await insertDocumentChunks(documentId, prepared.chunks, (query, params) => client.query(query, params));
        const indexed = await client.query(
          "SELECT COUNT(*)::int AS count FROM document_chunks WHERE document_id = $1",
          [documentId]
        );
        await client.query(
          "UPDATE documents SET processing_state = $1 WHERE id = $2 AND firm_id = $3",
          [Number(indexed.rows[0]?.count || 0) > 0 ? "Ready" : "Needs Attention", documentId, access.firm_id]
        );
        console.info("Portal response document indexing completed.", {
          documentId,
          characterCount: file.text.length,
          chunkCount: prepared.chunkCount,
          embeddingBatchCount: prepared.batchCount,
          embeddingDurationMs: prepared.embeddingDurationMs,
          indexingDurationMs: Date.now() - insertStartedAt,
          totalIndexingDurationMs: Date.now() - indexingStartedAt,
          fallbackToSingleCount: prepared.fallbackToSingleCount,
        });

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
    await this.assertMatterAccess(caseId, context);
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
    if (caseId) await this.assertMatterAccess(caseId, context);
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
    if (caseId) await this.assertMatterAccess(caseId, context);
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

  public async deleteDocument(
    id: string,
    context: OwnershipContext,
    caseId: string | null
  ): Promise<boolean> {
    if (caseId) {
      await this.assertMatterAccess(caseId, context);
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
    if (scope !== "wide") await this.assertMatterAccess(scope, context);
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
      await this.assertMatterAccess(caseId, context);
      return await this.query(
        `SELECT t.* FROM threads t
         JOIN cases c ON c.id = t.case_id
         WHERE t.user_id = $1 AND t.case_id = $2 AND c.firm_id = $3
         ORDER BY COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.thread_id = t.id), t.created_at) DESC`,
        [context.userId, caseId, context.firmId]
      );
    }
    return await this.query(
      `SELECT t.* FROM threads t
       WHERE t.user_id = $1 AND t.case_id IS NULL AND t.scope <> 'client'
       ORDER BY COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.thread_id = t.id), t.created_at) DESC`,
      [context.userId]
    );
  }

  public async keywordSearch(
    query: string,
    scope: "wide" | string,
    context: OwnershipContext,
    limit = 12
  ): Promise<Array<DocumentChunk & { title: string; keyword_score: number }>> {
    if (scope !== "wide") await this.assertMatterAccess(scope, context);
    const terms = Array.from(new Set(
      query.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []
    )).filter((term) => ![
      "the", "and", "for", "with", "that", "this", "from", "what", "which",
      "matter", "document", "about", "into", "have", "does", "client",
    ].includes(term)).slice(0, 12);
    if (!query.trim() || terms.length === 0) return [];
    const patterns = terms.map((term) => `%${term}%`);
    const normalizedLimit = Math.max(1, Math.min(24, Math.trunc(limit)));
    const scoring = `(
      CASE
        WHEN LOWER(d.title) = LOWER($1) THEN 0.9
        WHEN d.title ILIKE $2 THEN 0.65
        ELSE 0
      END
      + 0.35 * (
        SELECT COUNT(*)::float / GREATEST(CARDINALITY($3::text[]), 1)
        FROM UNNEST($3::text[]) pattern
        WHERE dc.chunk_text ILIKE pattern OR d.title ILIKE pattern
      )
    )`;
    if (scope === "wide") {
      return await this.query(
        `SELECT dc.id, dc.document_id, dc.chunk_text, d.title,
           ${scoring} AS keyword_score
         FROM document_chunks dc JOIN documents d ON d.id = dc.document_id
         WHERE d.firm_id = $4 AND d.case_id IS NULL
           AND d.is_generated_draft_duplicate = FALSE
           AND (dc.chunk_text ILIKE ANY($3::text[]) OR d.title ILIKE ANY($3::text[]))
         ORDER BY keyword_score DESC, d.uploaded_at DESC
         LIMIT $5`,
        [query.trim().slice(0, 500), `%${query.trim().slice(0, 300)}%`, patterns, context.firmId, normalizedLimit]
      );
    }
    return await this.query(
      `SELECT dc.id, dc.document_id, dc.chunk_text, d.title,
         ${scoring} AS keyword_score
       FROM document_chunks dc JOIN documents d ON d.id = dc.document_id
       WHERE d.firm_id = $4 AND d.is_generated_draft_duplicate = FALSE
         AND EXISTS (SELECT 1 FROM cases c WHERE c.id = $5 AND c.firm_id = $4)
         AND (
           d.case_id = $5 OR (
             d.case_id IS NULL AND EXISTS (
               SELECT 1 FROM case_documents cd
               WHERE cd.case_id = $5 AND cd.document_id = d.id
             )
           )
         )
         AND (dc.chunk_text ILIKE ANY($3::text[]) OR d.title ILIKE ANY($3::text[]))
       ORDER BY keyword_score DESC, d.uploaded_at DESC
       LIMIT $6`,
      [query.trim().slice(0, 500), `%${query.trim().slice(0, 300)}%`, patterns, context.firmId, scope, normalizedLimit]
    );
  }

  public async getAuthorizedDocumentChunks(
    documentId: string,
    context: OwnershipContext,
    caseId: string | null,
    limit = 50
  ): Promise<DocumentChunk[]> {
    const document = await this.getDocumentById(documentId, context, caseId);
    if (!document) return [];
    return await this.query(
      `SELECT dc.id, dc.document_id, dc.chunk_text
       FROM document_chunks dc JOIN documents d ON d.id = dc.document_id
       WHERE dc.document_id = $1 AND d.firm_id = $2
       ORDER BY dc.id LIMIT $3`,
      [document.id, context.firmId, Math.max(1, Math.min(80, Math.trunc(limit)))]
    );
  }

  public async getHistoryThreads(context: OwnershipContext): Promise<Thread[]> {
    return await this.query(
      `SELECT t.*, COALESCE(MAX(m.created_at), t.created_at) AS last_activity_at
       FROM threads t
       LEFT JOIN messages m ON m.thread_id = t.id
       WHERE t.user_id = $1
         AND t.scope <> 'client'
         AND (
           t.case_id IS NULL OR EXISTS (
             SELECT 1 FROM cases c
             JOIN matter_user_access access
               ON access.case_id = c.id AND access.user_id = $1
             WHERE c.id = t.case_id AND c.firm_id = $2
           )
         )
       GROUP BY t.id
       ORDER BY COALESCE(MAX(m.created_at), t.created_at) DESC`,
      [context.userId, context.firmId]
    );
  }

  public async getThreadById(id: string, context: OwnershipContext): Promise<Thread | undefined> {
    await this.assertThreadMatterAccess(id, context);
    const rows = await this.query(
      `SELECT t.* FROM threads t
       WHERE t.id = $1 AND t.user_id = $2 AND t.scope <> 'client'
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
    if (caseId) await this.assertMatterAccess(caseId, context);
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

  public async getClientConversations(clientUserId: string): Promise<Thread[]> {
    return await this.query(
      `SELECT t.*, COALESCE(MAX(m.created_at), t.created_at) AS last_activity_at
       FROM threads t
       LEFT JOIN messages m ON m.thread_id = t.id
       WHERE t.user_id = $1 AND t.scope = 'client' AND t.case_id IS NULL
       GROUP BY t.id
       ORDER BY COALESCE(MAX(m.created_at), t.created_at) DESC`,
      [clientUserId]
    );
  }

  public async createClientConversation(clientUserId: string): Promise<Thread> {
    const threadId = `thread_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const rows = await this.query(
      `INSERT INTO threads (id, user_id, case_id, scope, title, created_at)
       SELECT $1, u.id, NULL, 'client', 'New Conversation', $3
       FROM users u
       WHERE u.id = $2 AND u.account_type = 'client'
       RETURNING *`,
      [threadId, clientUserId, createdAt]
    );
    if (!rows[0]) throw new Error("Client account not found");
    return rows[0];
  }

  public async getClientConversation(
    threadId: string,
    clientUserId: string
  ): Promise<Thread | null> {
    const rows = await this.query(
      `SELECT * FROM threads
       WHERE id = $1 AND user_id = $2 AND scope = 'client' AND case_id IS NULL`,
      [threadId, clientUserId]
    );
    return rows[0] || null;
  }

  public async getClientMessages(
    threadId: string,
    clientUserId: string,
    limit?: number
  ): Promise<Message[]> {
    const params: unknown[] = [threadId, clientUserId];
    const limitClause = typeof limit === "number" ? "LIMIT $3" : "";
    if (typeof limit === "number") params.push(limit);
    const rows = await this.query(
      `SELECT * FROM (
         SELECT m.*
         FROM messages m
         JOIN threads t ON t.id = m.thread_id
         WHERE m.thread_id = $1
           AND t.user_id = $2
           AND t.scope = 'client'
           AND t.case_id IS NULL
         ORDER BY m.created_at DESC
         ${limitClause}
       ) client_messages
       ORDER BY created_at ASC`,
      params
    );
    return rows.map((message) => ({
      ...message,
      citations:
        typeof message.citations === "string"
          ? JSON.parse(message.citations)
          : message.citations,
      steps: typeof message.steps === "string" ? JSON.parse(message.steps) : message.steps,
      metadata:
        typeof message.metadata === "string"
          ? JSON.parse(message.metadata)
          : message.metadata,
    }));
  }

  public async addClientMessage(
    threadId: string,
    clientUserId: string,
    role: "user" | "assistant",
    content: string,
    metadata: Record<string, unknown> = {}
  ): Promise<Message> {
    const id = `msg_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const rows = await this.query(
      `INSERT INTO messages
        (id, thread_id, role, content, citations, steps, created_at, metadata)
       SELECT $1, t.id, $4, $5, '[]'::jsonb, NULL, $6, $7::jsonb
       FROM threads t
       WHERE t.id = $2
         AND t.user_id = $3
         AND t.scope = 'client'
         AND t.case_id IS NULL
       RETURNING *`,
      [id, threadId, clientUserId, role, content, createdAt, JSON.stringify(metadata)]
    );
    if (!rows[0]) throw new Error("Client conversation not found");
    return {
      ...rows[0],
      citations: [],
      steps: null,
      metadata,
    };
  }

  public async updateClientConversationTitleForFirstMessage(
    threadId: string,
    firstMessageId: string,
    expectedCurrentTitle: string,
    generatedTitle: string,
    clientUserId: string
  ): Promise<boolean> {
    const rows = await this.query(
      `UPDATE threads t
       SET title = $1
       WHERE t.id = $2
         AND t.user_id = $3
         AND t.scope = 'client'
         AND t.case_id IS NULL
         AND t.title = $4
         AND EXISTS (
           SELECT 1 FROM messages first_message
           WHERE first_message.id = $5
             AND first_message.thread_id = t.id
             AND first_message.role = 'user'
         )
         AND NOT EXISTS (
           SELECT 1 FROM messages other_user_message
           WHERE other_user_message.thread_id = t.id
             AND other_user_message.role = 'user'
             AND other_user_message.id <> $5
         )
       RETURNING t.id`,
      [generatedTitle, threadId, clientUserId, expectedCurrentTitle, firstMessageId]
    );
    return rows.length === 1;
  }

  public async deleteClientConversation(
    threadId: string,
    clientUserId: string
  ): Promise<boolean> {
    const rows = await this.query(
      `DELETE FROM threads
       WHERE id = $1 AND user_id = $2 AND scope = 'client' AND case_id IS NULL
       RETURNING id`,
      [threadId, clientUserId]
    );
    return rows.length === 1;
  }

  public async updateThreadTitleForFirstMessage(
    threadId: string,
    firstMessageId: string,
    expectedCurrentTitle: string,
    generatedTitle: string,
    context: OwnershipContext
  ): Promise<boolean> {
    await this.assertThreadMatterAccess(threadId, context);
    const rows = await this.query(
      `UPDATE threads t
       SET title = $1
       WHERE t.id = $2 AND t.user_id = $3 AND t.title = $4 AND t.scope <> 'client'
         AND (
           t.case_id IS NULL OR EXISTS (
             SELECT 1 FROM cases c WHERE c.id = t.case_id AND c.firm_id = $5
           )
         )
         AND EXISTS (
           SELECT 1 FROM messages first_message
           WHERE first_message.id = $6
             AND first_message.thread_id = t.id
             AND first_message.role = 'user'
         )
         AND NOT EXISTS (
           SELECT 1 FROM messages other_user_message
           WHERE other_user_message.thread_id = t.id
             AND other_user_message.role = 'user'
             AND other_user_message.id <> $6
         )
       RETURNING t.id`,
      [
        generatedTitle,
        threadId,
        context.userId,
        expectedCurrentTitle,
        context.firmId,
        firstMessageId,
      ]
    );
    return rows.length === 1;
  }

  public async deleteThread(id: string, context: OwnershipContext): Promise<boolean> {
    await this.assertThreadMatterAccess(id, context);
    const rows = await this.query(
      `DELETE FROM threads t
       WHERE t.id = $1 AND t.user_id = $2 AND t.scope <> 'client'
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
    await this.assertThreadMatterAccess(threadId, context);
    const rows = await this.query(
      `SELECT m.* FROM messages m
       JOIN threads t ON t.id = m.thread_id
       WHERE m.thread_id = $1 AND t.user_id = $2 AND t.scope <> 'client'
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

  public async getRecentMessages(
    threadId: string,
    context: OwnershipContext,
    limit = 12
  ): Promise<Message[]> {
    await this.assertThreadMatterAccess(threadId, context);
    const rows = await this.query(
      `SELECT * FROM (
         SELECT m.* FROM messages m
         JOIN threads t ON t.id = m.thread_id
         WHERE m.thread_id = $1 AND t.user_id = $2 AND t.scope <> 'client'
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
    await this.assertThreadMatterAccess(threadId, context);
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const createdAt = new Date().toISOString();

    const inserted = await this.query(
      `INSERT INTO messages (id, thread_id, role, content, citations, steps, created_at, metadata)
       SELECT $1, t.id, $3, $4, $5, $6, $7, $10::jsonb
       FROM threads t
       WHERE t.id = $2 AND t.user_id = $8 AND t.scope <> 'client'
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

  public async addVoiceMessage(
    id: string,
    threadId: string,
    role: "user" | "assistant",
    content: string,
    context: OwnershipContext,
    metadata: Record<string, unknown>
  ): Promise<Message> {
    await this.assertThreadMatterAccess(threadId, context);
    const createdAt = new Date().toISOString();
    const rows = await this.query(
      `INSERT INTO messages (id, thread_id, role, content, citations, steps, created_at, metadata)
       SELECT $1, t.id, $3, $4, '[]'::jsonb, NULL, $5, $8::jsonb
       FROM threads t
       WHERE t.id = $2 AND t.user_id = $6 AND t.scope <> 'client'
         AND (
           t.case_id IS NULL OR EXISTS (
             SELECT 1 FROM cases c WHERE c.id = t.case_id AND c.firm_id = $7
           )
         )
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [id, threadId, role, content, createdAt, context.userId, context.firmId, JSON.stringify(metadata)]
    );
    if (rows[0]) {
      return { ...rows[0], citations: [], steps: null, metadata };
    }
    const existing = await this.query(
      `SELECT m.* FROM messages m
       JOIN threads t ON t.id = m.thread_id
       WHERE m.id = $1 AND m.thread_id = $2 AND t.user_id = $3 AND t.scope <> 'client'
         AND (t.case_id IS NULL OR EXISTS (
           SELECT 1 FROM cases c WHERE c.id = t.case_id AND c.firm_id = $4
         ))`,
      [id, threadId, context.userId, context.firmId]
    );
    if (!existing[0]) throw new Error("Thread not found");
    const message = existing[0];
    return {
      ...message,
      citations: typeof message.citations === "string" ? JSON.parse(message.citations) : message.citations,
      steps: typeof message.steps === "string" ? JSON.parse(message.steps) : message.steps,
      metadata: typeof message.metadata === "string" ? JSON.parse(message.metadata) : message.metadata,
    };
  }

  public async updateMessage(
    id: string,
    threadId: string,
    content: string,
    context: OwnershipContext
  ): Promise<Message> {
    await this.assertThreadMatterAccess(threadId, context);
    const rows = await this.query(
      `UPDATE messages m SET content = $1
       WHERE m.id = $2 AND m.thread_id = $3
         AND EXISTS (
           SELECT 1 FROM threads t
           WHERE t.id = m.thread_id AND t.user_id = $4 AND t.scope <> 'client'
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
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
    await this.assertThreadMatterAccess(threadId, context);
    const draftId = `draft_${Date.now()}`;
    const createdAt = new Date().toISOString();

    const inserted = await this.query(
      `INSERT INTO drafts (id, thread_id, case_id, title, content, created_at, updated_at, origin)
       SELECT $1, t.id, c.id, $4, $5, $6, $6, 'Generated from conversation'
       FROM threads t
       JOIN cases c ON c.id = $3
       WHERE t.id = $2 AND t.user_id = $7 AND t.scope <> 'client'
         AND c.firm_id = $8
         AND (
           t.case_id IS NULL OR EXISTS (
             SELECT 1 FROM cases origin
             WHERE origin.id = t.case_id AND origin.firm_id = $8
           )
         )
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

  public async createAssistantDraftRevision(input: {
    threadId: string;
    sourceDraftId: string;
    caseId: string;
    title: string;
    content: string;
    ownership: OwnershipContext;
  }): Promise<Draft> {
    await this.assertMatterAccess(input.caseId, input.ownership);
    await this.assertThreadMatterAccess(input.threadId, input.ownership);
    const revisionId = `draft_${randomUUID()}`;
    const now = new Date().toISOString();
    const rows = await this.query(
      `INSERT INTO drafts
        (id, thread_id, case_id, title, content, created_at, updated_at, origin,
         parent_draft_id, revision_type)
       SELECT $1, t.id, source.case_id, $5, $6, $7, $7,
         'Assistant revision', source.id, 'Duplicate'
       FROM drafts source
       JOIN cases c ON c.id = source.case_id
       JOIN threads t ON t.id = $2
       WHERE source.id = $3
         AND source.case_id = $4
         AND c.firm_id = $9
         AND t.user_id = $8
         AND t.scope <> 'client'
         AND (
           t.case_id IS NULL OR EXISTS (
             SELECT 1 FROM cases origin
             WHERE origin.id = t.case_id AND origin.firm_id = $9
           )
         )
       RETURNING drafts.*`,
      [
        revisionId,
        input.threadId,
        input.sourceDraftId,
        input.caseId,
        input.title,
        input.content,
        now,
        input.ownership.userId,
        input.ownership.firmId,
      ]
    );
    if (!rows[0]) throw new Error("Work Product not found");
    return rows[0];
  }

  public async createManualDraft(
    caseId: string, title: string, content: string, context: OwnershipContext
  ): Promise<Draft> {
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
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
    await this.assertMatterAccess(caseId, context);
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

  public async getThreadMessageCount(
    threadId: string,
    context: OwnershipContext
  ): Promise<number> {
    await this.assertThreadMatterAccess(threadId, context);
    const rows = await this.query(
      `SELECT COUNT(m.id)::int AS message_count
       FROM threads t LEFT JOIN messages m ON m.thread_id = t.id
       WHERE t.id = $1 AND t.user_id = $2 AND t.scope <> 'client'
         AND (t.case_id IS NULL OR EXISTS (
           SELECT 1 FROM cases c WHERE c.id = t.case_id AND c.firm_id = $3
         ))
       GROUP BY t.id`,
      [threadId, context.userId, context.firmId]
    );
    return rows[0] ? Number(rows[0].message_count) : 0;
  }

  public async updateThreadMemory(
    threadId: string,
    summary: string,
    messageCount: number,
    context: OwnershipContext
  ): Promise<boolean> {
    await this.assertThreadMatterAccess(threadId, context);
    const rows = await this.query(
      `UPDATE threads t SET memory_summary = $1, memory_message_count = $2,
         memory_updated_at = $3
       WHERE t.id = $4 AND t.user_id = $5 AND t.scope <> 'client'
         AND (t.case_id IS NULL OR EXISTS (
           SELECT 1 FROM cases c WHERE c.id = t.case_id AND c.firm_id = $6
         ))
       RETURNING t.id`,
      [summary, Math.max(0, Math.trunc(messageCount)), new Date().toISOString(), threadId, context.userId, context.firmId]
    );
    return rows.length === 1;
  }

  public async searchAssistantConversationHistory(
    context: OwnershipContext,
    query: string,
    limit = 10
  ): Promise<Array<{
    thread_id: string;
    title: string;
    case_id: string | null;
    created_at: string;
    snippet: string;
  }>> {
    const normalizedLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
    const search = `%${query.trim().slice(0, 300)}%`;
    return await this.query(
      `SELECT t.id AS thread_id, t.title, t.case_id,
         COALESCE(MAX(m.created_at), t.created_at) AS created_at,
         LEFT(COALESCE(
           (ARRAY_AGG(m.content ORDER BY
             CASE WHEN m.content ILIKE $3 THEN 0 ELSE 1 END,
             m.created_at DESC
           ) FILTER (WHERE m.content IS NOT NULL))[1],
           t.title
         ), 500) AS snippet
       FROM threads t
       LEFT JOIN messages m ON m.thread_id = t.id
       WHERE t.user_id = $1 AND t.scope <> 'client'
         AND (t.case_id IS NULL OR EXISTS (
           SELECT 1 FROM cases c
           JOIN matter_user_access access
             ON access.case_id = c.id AND access.user_id = $1
           WHERE c.id = t.case_id AND c.firm_id = $2
         ))
         AND (t.title ILIKE $3 OR m.content ILIKE $3)
       GROUP BY t.id
       ORDER BY COALESCE(MAX(m.created_at), t.created_at) DESC
       LIMIT $4`,
      [context.userId, context.firmId, search, normalizedLimit]
    );
  }

  public async createAssistantDocument(
    threadId: string,
    title: string,
    content: string,
    context: OwnershipContext
  ): Promise<AssistantDocument> {
    await this.assertThreadMatterAccess(threadId, context);
    const id = `assistant_document_${randomUUID()}`;
    const now = new Date().toISOString();
    const rows = await this.query(
      `INSERT INTO assistant_documents
        (id, thread_id, user_id, firm_id, title, content, created_at, updated_at)
       SELECT $1, t.id, t.user_id, u.firm_id, $5, $6, $7, $7
       FROM threads t
       JOIN users u ON u.id = t.user_id
       WHERE t.id = $2
         AND t.user_id = $3
         AND u.firm_id = $4
         AND t.scope <> 'client'
         AND (
           t.case_id IS NULL OR EXISTS (
             SELECT 1 FROM cases origin
             WHERE origin.id = t.case_id AND origin.firm_id = $4
           )
         )
       RETURNING *`,
      [id, threadId, context.userId, context.firmId, title, content, now]
    );
    if (!rows[0]) throw new Error("Conversation not found");
    return rows[0];
  }

  public async getOrCreateAssistantDocumentForMessage(
    messageId: string,
    threadId: string,
    context: OwnershipContext
  ): Promise<AssistantDocument> {
    await this.assertThreadMatterAccess(threadId, context);
    const id = `assistant_response_${messageId}`;
    const now = new Date().toISOString();
    await this.query(
      `INSERT INTO assistant_documents
        (id, thread_id, user_id, firm_id, title, content, created_at, updated_at)
       SELECT $1, t.id, t.user_id, u.firm_id,
         LEFT(COALESCE(NULLIF(BTRIM(t.title), ''), 'Assistant Response'), 300),
         m.content, $6, $6
       FROM messages m
       JOIN threads t ON t.id = m.thread_id
       JOIN users u ON u.id = t.user_id
       WHERE m.id = $2
         AND m.thread_id = $3
         AND m.role = 'assistant'
         AND t.user_id = $4
         AND u.firm_id = $5
         AND t.scope <> 'client'
         AND (
           t.case_id IS NULL OR EXISTS (
             SELECT 1 FROM cases c
             JOIN matter_user_access access
               ON access.case_id = c.id AND access.user_id = $4
             WHERE c.id = t.case_id AND c.firm_id = $5
           )
         )
       ON CONFLICT (id) DO NOTHING`,
      [id, messageId, threadId, context.userId, context.firmId, now]
    );
    const rows = await this.query(
      `SELECT * FROM assistant_documents
       WHERE id = $1 AND thread_id = $2 AND user_id = $3 AND firm_id = $4`,
      [id, threadId, context.userId, context.firmId]
    );
    if (!rows[0]) throw new Error("Assistant response not found");
    return rows[0];
  }

  public async getAssistantDocumentById(
    id: string,
    context: OwnershipContext
  ): Promise<AssistantDocument | undefined> {
    const rows = await this.query(
      `SELECT * FROM assistant_documents
       WHERE id = $1 AND user_id = $2 AND firm_id = $3`,
      [id, context.userId, context.firmId]
    );
    return rows[0];
  }

  public async getAssistantDocuments(
    context: OwnershipContext,
    limit = 25
  ): Promise<AssistantDocument[]> {
    const normalizedLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
    return await this.query(
      `SELECT * FROM assistant_documents
       WHERE user_id = $1 AND firm_id = $2
       ORDER BY updated_at DESC LIMIT $3`,
      [context.userId, context.firmId, normalizedLimit]
    );
  }

  public async updateAssistantDocument(
    id: string,
    title: string,
    content: string,
    context: OwnershipContext
  ): Promise<AssistantDocument> {
    const rows = await this.query(
      `UPDATE assistant_documents
       SET title = $1, content = $2, updated_at = $3
       WHERE id = $4 AND user_id = $5 AND firm_id = $6
       RETURNING *`,
      [title, content, new Date().toISOString(), id, context.userId, context.firmId]
    );
    if (!rows[0]) throw new Error("Assistant document not found");
    return rows[0];
  }
}

export const db = new DatabaseService();
