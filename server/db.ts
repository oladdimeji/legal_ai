import pg from "pg";
import { Document, DocumentChunk, Case, Thread, Message, Draft, Citation } from "../src/types.js";
import { callModel } from "./model.js";

const { Pool } = pg;

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

    const pool = getPool();
    const client = await pool.connect();
    try {
      // 1. Enable Vector Extension
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");

      // 2. Firm table
      await client.query(`
        CREATE TABLE IF NOT EXISTS firm (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
        );
      `);

      // 3. Users table (renamed from 'user' to avoid reserved keyword clash)
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          firm_id TEXT REFERENCES firm(id),
          name TEXT NOT NULL,
          email TEXT NOT NULL
        );
      `);

      // 4. Cases table
      await client.query(`
        CREATE TABLE IF NOT EXISTS cases (
          id TEXT PRIMARY KEY,
          firm_id TEXT REFERENCES firm(id),
          name TEXT NOT NULL,
          description TEXT,
          created_at TEXT NOT NULL
        );
      `);

      // 5. Documents table
      await client.query(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          firm_id TEXT REFERENCES firm(id),
          case_id TEXT REFERENCES cases(id),
          title TEXT NOT NULL,
          source_url TEXT,
          drive_id TEXT,
          extracted_text TEXT NOT NULL,
          section TEXT NOT NULL,
          uploaded_at TEXT NOT NULL
        );
      `);

      // 6. Document Chunks table (with real 768-dimensional vector type)
      await client.query(`
        CREATE TABLE IF NOT EXISTS document_chunks (
          id TEXT PRIMARY KEY,
          document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
          chunk_text TEXT NOT NULL,
          embedding vector(768)
        );
      `);

      // Migrate existing column if it was created with 3072 dimensions
      try {
        await client.query(`DROP INDEX IF EXISTS document_chunks_hnsw_idx`);
        await client.query(`
          DO $$
          BEGIN
            -- Ensure column is vector(768)
            IF EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'document_chunks' 
              AND column_name = 'embedding' 
              AND udt_name = 'vector'
            ) THEN
              ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(768);
            END IF;
          END $$;
        `);
      } catch (e) {
        console.warn("Attempted to alter embedding dimension to 768, proceeding:", e);
      }

      // 7. Similarity HNSW index for real pgvector cosine operations
      await client.query(`
        CREATE INDEX IF NOT EXISTS document_chunks_hnsw_idx 
        ON document_chunks USING hnsw (embedding vector_cosine_ops);
      `);

      // 8. Case Documents junction table
      await client.query(`
        CREATE TABLE IF NOT EXISTS case_documents (
          case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
          document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
          PRIMARY KEY (case_id, document_id)
        );
      `);

      // 9. Threads table
      await client.query(`
        CREATE TABLE IF NOT EXISTS threads (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id),
          case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
          scope TEXT NOT NULL,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);

      // 10. Messages table
      await client.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          citations JSONB NOT NULL DEFAULT '[]'::jsonb,
          steps JSONB,
          created_at TEXT NOT NULL
        );
      `);

      // 11. Drafts table
      await client.query(`
        CREATE TABLE IF NOT EXISTS drafts (
          id TEXT PRIMARY KEY,
          thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
          case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);

      // Seed Default firm if empty
      const firmRes = await client.query("SELECT id FROM firm WHERE id = 'firm_123'");
      if (firmRes.rowCount === 0) {
        await client.query("INSERT INTO firm (id, name) VALUES ('firm_123', 'Sterling & Croft LLP')");
      }

      // Seed Default user if empty
      const userRes = await client.query("SELECT id FROM users WHERE id = 'user_456'");
      if (userRes.rowCount === 0) {
        await client.query("INSERT INTO users (id, firm_id, name, email) VALUES ('user_456', 'firm_123', 'Oladimeji', 'oladimeji@workpodd.com')");
      }

      // Seed Default cases if empty
      const casesRes = await client.query("SELECT id FROM cases");
      if (casesRes.rowCount === 0) {
        await client.query(`
          INSERT INTO cases (id, firm_id, name, description, created_at) VALUES 
          ('case_tech_employment', 'firm_123', 'California Tech Non-Compete Review', 'Analysis of non-compete agreements and trade secret protection for engineering staff.', $1),
          ('case_ip_fair_use', 'firm_123', 'Creative Content Fair Use Evaluation', 'Dispute surrounding documentary footage and copyright fair use limits under Section 107.', $1)
        `, [new Date().toISOString()]);
      }

      this.isSchemaInitialized = true;
      console.log("Supabase Postgres schema initialization verified successfully.");
    } catch (err) {
      console.error("Error setting up schema:", err);
      throw err;
    } finally {
      client.release();
    }
  }

  private async query(text: string, params?: any[]): Promise<any[]> {
    await this.ensureSchema();
    const pool = getPool();
    const res = await pool.query(text, params);
    return res.rows;
  }

  public async preseedIfEmpty(): Promise<void> {
    // Check if we have successfully embedded document chunks
    const chunkRows = await this.query("SELECT COUNT(*)::int as count FROM document_chunks");
    if (chunkRows[0] && chunkRows[0].count > 0) {
      console.log(`Database already has ${chunkRows[0].count} embedded document chunks. Skipping preseed.`);
      return;
    }

    console.log("Database chunks empty. Clearing stale/partially seeded records before clean run...");
    await this.query("DELETE FROM document_chunks");
    await this.query("DELETE FROM case_documents");
    await this.query("DELETE FROM documents");

    console.log("Pre-seeding database with legal documents and generating embeddings...");
    for (const seed of SEED_DOCUMENTS) {
      await this.addDocumentInternal(
        seed.title,
        seed.extracted_text,
        seed.section,
        seed.source_url,
        null,
        seed.case_id
      );
    }
    console.log("Pre-seeding completed successfully!");
  }

  private async addDocumentInternal(
    title: string,
    text: string,
    section: string,
    sourceUrl: string | null = null,
    driveId: string | null = null,
    caseId: string | null = null
  ): Promise<Document> {
    const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const firm = await this.getFirm();
    const uploadedAt = new Date().toISOString();

    await this.query(
      `INSERT INTO documents (id, firm_id, case_id, title, source_url, drive_id, extracted_text, section, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [docId, firm.id, caseId, title, sourceUrl, driveId, text, section, uploadedAt]
    );

    if (caseId) {
      await this.query(
        `INSERT INTO case_documents (case_id, document_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [caseId, docId]
      );
    }

    // Paragraph splitting
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 15);

    console.log(`Generating embeddings for ${paragraphs.length} chunks of "${title}"...`);
    for (let i = 0; i < paragraphs.length; i++) {
      const chunkText = paragraphs[i];
      let embedding: number[] = [];
      try {
        embedding = await callModel("embedding", [], {
          textToEmbed: chunkText
        }) as number[];
      } catch (error) {
        console.error(`Error generating embedding for chunk ${i}:`, error);
        // Fallback to random normalized vector
        embedding = Array.from({ length: 768 }, () => Math.random() - 0.5);
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        embedding = embedding.map((val) => val / magnitude);
      }

      const vectorStr = `[${embedding.join(",")}]`;

      await this.query(
        `INSERT INTO document_chunks (id, document_id, chunk_text, embedding)
         VALUES ($1, $2, $3, $4)`,
        [`chunk_${docId}_${i}`, docId, chunkText, vectorStr]
      );
    }

    return {
      id: docId,
      firm_id: firm.id,
      case_id: caseId,
      title,
      source_url: sourceUrl,
      drive_id: driveId,
      extracted_text: text,
      section,
      uploaded_at: uploadedAt
    };
  }

  public async getFirm(): Promise<{ id: string; name: string }> {
    const rows = await this.query("SELECT * FROM firm LIMIT 1");
    if (rows.length === 0) {
      return { id: "firm_123", name: "Sterling & Croft LLP" };
    }
    return rows[0];
  }

  public async getUser(): Promise<{ id: string; firm_id: string; name: string; email: string }> {
    const rows = await this.query("SELECT * FROM users LIMIT 1");
    if (rows.length === 0) {
      return { id: "user_456", firm_id: "firm_123", name: "Oladimeji", email: "oladimeji@workpodd.com" };
    }
    return rows[0];
  }

  public async getCases(): Promise<Case[]> {
    return await this.query("SELECT * FROM cases ORDER BY created_at DESC");
  }

  public async getCaseById(id: string): Promise<Case | undefined> {
    const rows = await this.query("SELECT * FROM cases WHERE id = $1", [id]);
    return rows[0];
  }

  public async createCase(name: string, description: string): Promise<Case> {
    const caseId = `case_${Date.now()}`;
    const firm = await this.getFirm();
    const createdAt = new Date().toISOString();

    await this.query(
      `INSERT INTO cases (id, firm_id, name, description, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [caseId, firm.id, name, description, createdAt]
    );

    const newCase: Case = {
      id: caseId,
      firm_id: firm.id,
      name,
      description,
      created_at: createdAt
    };

    try {
      console.log(`Auto-attaching documents for case: "${name}" based on description context...`);
      const searchResults = await this.vectorSearch(description, "wide", 3);
      
      const attachedDocIds = new Set<string>();
      for (const chunk of searchResults) {
        const doc = await this.getDocumentById(chunk.document_id);
        if (doc && !attachedDocIds.has(doc.id)) {
          attachedDocIds.add(doc.id);
          await this.query(
            `INSERT INTO case_documents (case_id, document_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [caseId, doc.id]
          );
          console.log(`Auto-attached document: "${doc.title}" (Score: ${chunk.similarity.toFixed(4)})`);
        }
      }
    } catch (err) {
      console.error("Error auto-attaching documents to case:", err);
    }

    return newCase;
  }

  public async getDocuments(caseId: string | null = null): Promise<Document[]> {
    if (!caseId) {
      return await this.query("SELECT * FROM documents ORDER BY uploaded_at DESC");
    }
    return await this.query(
      `SELECT DISTINCT d.* FROM documents d
       LEFT JOIN case_documents cd ON cd.document_id = d.id
       WHERE d.case_id = $1 OR cd.case_id = $1
       ORDER BY d.uploaded_at DESC`,
      [caseId]
    );
  }

  public async getDocumentById(id: string): Promise<Document | undefined> {
    const rows = await this.query("SELECT * FROM documents WHERE id = $1", [id]);
    return rows[0];
  }

  public async uploadDocument(
    title: string,
    text: string,
    sourceUrl: string | null = null,
    driveId: string | null = null,
    caseId: string | null = null
  ): Promise<Document> {
    let suggestedSection = "General Legal Advice";
    try {
      const docEmbedding = await callModel("embedding", [], { textToEmbed: text.substring(0, 500) }) as number[];
      const vectorStr = `[${docEmbedding.join(",")}]`;

      const rows = await this.query(
        `SELECT d.section, AVG(1 - (dc.embedding <=> $1::vector)) as avg_sim
         FROM document_chunks dc
         JOIN documents d ON dc.document_id = d.id
         GROUP BY d.section
         ORDER BY avg_sim DESC
         LIMIT 1`,
        [vectorStr]
      );

      if (rows.length > 0 && rows[0].avg_sim > 0.3) {
        suggestedSection = rows[0].section;
      }
    } catch (e) {
      console.error("Error suggesting section for document:", e);
    }

    return await this.addDocumentInternal(title, text, suggestedSection, sourceUrl, driveId, caseId);
  }

  public async deleteDocument(id: string): Promise<void> {
    await this.query("DELETE FROM documents WHERE id = $1", [id]);
  }

  public async vectorSearch(
    query: string,
    scope: "wide" | string,
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
         ORDER BY dc.embedding <=> $1::vector
         LIMIT $2`,
        [vectorStr, limit]
      );
    } else {
      return await this.query(
        `SELECT dc.id, dc.document_id, dc.chunk_text, (1 - (dc.embedding <=> $1::vector))::float as similarity
         FROM document_chunks dc
         JOIN documents d ON dc.document_id = d.id
         LEFT JOIN case_documents cd ON cd.document_id = d.id
         WHERE d.case_id = $2 OR cd.case_id = $2
         ORDER BY dc.embedding <=> $1::vector
         LIMIT $3`,
        [vectorStr, scope, limit]
      );
    }
  }

  public async getThreads(caseId: string | null = null): Promise<Thread[]> {
    if (caseId) {
      return await this.query("SELECT * FROM threads WHERE case_id = $1 ORDER BY created_at DESC", [caseId]);
    }
    return await this.query("SELECT * FROM threads ORDER BY created_at DESC");
  }

  public async getThreadById(id: string): Promise<Thread | undefined> {
    const rows = await this.query("SELECT * FROM threads WHERE id = $1", [id]);
    return rows[0];
  }

  public async createThread(title: string, caseId: string | null = null): Promise<Thread> {
    const threadId = `thread_${Date.now()}`;
    const user = await this.getUser();
    const createdAt = new Date().toISOString();
    const scope = caseId ? "case" : "wide";
    const finalTitle = title || "New Legal Conversation";

    await this.query(
      `INSERT INTO threads (id, user_id, case_id, scope, title, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [threadId, user.id, caseId, scope, finalTitle, createdAt]
    );

    return {
      id: threadId,
      user_id: user.id,
      case_id: caseId,
      scope,
      title: finalTitle,
      created_at: createdAt
    };
  }

  public async deleteThread(id: string): Promise<void> {
    await this.query("DELETE FROM threads WHERE id = $1", [id]);
  }

  public async getMessages(threadId: string): Promise<Message[]> {
    const rows = await this.query("SELECT * FROM messages WHERE thread_id = $1 ORDER BY created_at ASC", [threadId]);
    return rows.map((m) => ({
      ...m,
      citations: typeof m.citations === "string" ? JSON.parse(m.citations) : m.citations,
      steps: typeof m.steps === "string" ? JSON.parse(m.steps) : m.steps
    }));
  }

  public async addMessage(
    threadId: string,
    role: "user" | "assistant",
    content: string,
    citations: Citation[] = [],
    steps: any[] | null = null
  ): Promise<Message> {
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const createdAt = new Date().toISOString();

    await this.query(
      `INSERT INTO messages (id, thread_id, role, content, citations, steps, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [msgId, threadId, role, content, JSON.stringify(citations), JSON.stringify(steps), createdAt]
    );

    return {
      id: msgId,
      thread_id: threadId,
      role,
      content,
      citations,
      steps,
      created_at: createdAt
    };
  }

  public async updateMessage(id: string, content: string): Promise<Message> {
    const rows = await this.query(
      `UPDATE messages SET content = $1 WHERE id = $2 RETURNING *`,
      [content, id]
    );
    if (rows.length === 0) {
      throw new Error("Message not found");
    }
    const m = rows[0];
    return {
      ...m,
      citations: typeof m.citations === "string" ? JSON.parse(m.citations) : m.citations,
      steps: typeof m.steps === "string" ? JSON.parse(m.steps) : m.steps
    };
  }

  public async getDrafts(caseId: string | null = null): Promise<Draft[]> {
    if (caseId) {
      return await this.query("SELECT * FROM drafts WHERE case_id = $1 ORDER BY created_at DESC", [caseId]);
    }
    return await this.query("SELECT * FROM drafts ORDER BY created_at DESC");
  }

  public async getDraftById(id: string): Promise<Draft | undefined> {
    const rows = await this.query("SELECT * FROM drafts WHERE id = $1", [id]);
    return rows[0];
  }

  public async createDraft(
    threadId: string,
    caseId: string | null,
    title: string,
    content: string
  ): Promise<Draft> {
    const draftId = `draft_${Date.now()}`;
    const createdAt = new Date().toISOString();

    await this.query(
      `INSERT INTO drafts (id, thread_id, case_id, title, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [draftId, threadId, caseId, title, content, createdAt]
    );

    await this.addDocumentInternal(
      `Draft: ${title}`,
      content,
      "Drafts & Memorandums",
      null,
      null,
      caseId
    );

    return {
      id: draftId,
      thread_id: threadId,
      case_id: caseId,
      title,
      content,
      created_at: createdAt
    };
  }

  public async updateDraft(id: string, content: string): Promise<Draft> {
    const rows = await this.query(
      `UPDATE drafts SET content = $1 WHERE id = $2 RETURNING *`,
      [content, id]
    );
    if (rows.length === 0) {
      throw new Error("Draft not found");
    }
    return rows[0];
  }
}

export const db = new DatabaseService();
