import type { Pool, PoolClient } from "pg";

interface Migration {
  version: number;
  name: string;
  run: (client: PoolClient) => Promise<void>;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "baseline_schema",
    async run(client) {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.query(`
        CREATE TABLE IF NOT EXISTS firm (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          firm_id TEXT REFERENCES firm(id),
          name TEXT NOT NULL,
          email TEXT NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS cases (
          id TEXT PRIMARY KEY,
          firm_id TEXT REFERENCES firm(id),
          name TEXT NOT NULL,
          description TEXT,
          created_at TEXT NOT NULL
        )
      `);
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
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS document_chunks (
          id TEXT PRIMARY KEY,
          document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
          chunk_text TEXT NOT NULL,
          embedding vector(768)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS document_chunks_hnsw_idx
        ON document_chunks USING hnsw (embedding vector_cosine_ops)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS case_documents (
          case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
          document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
          PRIMARY KEY (case_id, document_id)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS threads (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id),
          case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
          scope TEXT NOT NULL,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          citations JSONB NOT NULL DEFAULT '[]'::jsonb,
          steps JSONB,
          created_at TEXT NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS drafts (
          id TEXT PRIMARY KEY,
          thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
          case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
    },
  },
  {
    version: 2,
    name: "preserve_drafts_when_threads_are_deleted",
    async run(client) {
      await client.query(`
        ALTER TABLE drafts
        DROP CONSTRAINT IF EXISTS drafts_thread_id_fkey
      `);
      await client.query(`
        ALTER TABLE drafts
        ADD CONSTRAINT drafts_thread_id_fkey
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE SET NULL
      `);
    },
  },
  {
    version: 3,
    name: "authentication_and_sessions",
    async run(client) {
      const duplicateEmails = await client.query<{ normalized_email: string }>(`
        SELECT LOWER(BTRIM(email)) AS normalized_email
        FROM users
        GROUP BY LOWER(BTRIM(email))
        HAVING COUNT(*) > 1
        LIMIT 1
      `);
      if (duplicateEmails.rowCount) {
        throw new Error(
          "Cannot add case-insensitive email uniqueness: duplicate legacy email addresses require review."
        );
      }

      await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT");
      await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TEXT");
      await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TEXT");
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx
        ON users (LOWER(BTRIM(email)))
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          last_used_at TEXT NOT NULL
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at)
      `);
    },
  },
];

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  const lockKey = "legal_ai_schema_migrations";

  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const appliedResult = await client.query<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version"
    );
    const applied = new Set(appliedResult.rows.map((row) => row.version));

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;

      await client.query("BEGIN");
      try {
        await migration.run(client);
        await client.query(
          "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
          [migration.version, migration.name]
        );
        await client.query("COMMIT");
        console.log(`Applied migration ${migration.version}: ${migration.name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
    } finally {
      client.release();
    }
  }
}

export const migrationManifest = migrations.map(({ version, name }) => ({ version, name }));
