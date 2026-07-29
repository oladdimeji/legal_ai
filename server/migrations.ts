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
  {
    version: 4,
    name: "context_isolation_and_legacy_work_product",
    async run(client) {
      await client.query(
        "ALTER TABLE cases ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Open'"
      );
      await client.query(
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_generated_draft_duplicate BOOLEAN NOT NULL DEFAULT FALSE"
      );
      await client.query(`
        UPDATE documents d
        SET is_generated_draft_duplicate = TRUE
        WHERE d.is_generated_draft_duplicate = FALSE
          AND EXISTS (
            SELECT 1
            FROM drafts w
            WHERE d.title = 'Draft: ' || w.title
              AND d.extracted_text = w.content
              AND d.case_id IS NOT DISTINCT FROM w.case_id
          )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS cases_firm_id_idx ON cases(firm_id)");
      await client.query(
        "CREATE INDEX IF NOT EXISTS documents_firm_case_idx ON documents(firm_id, case_id)"
      );
      await client.query("CREATE INDEX IF NOT EXISTS threads_user_case_idx ON threads(user_id, case_id)");
      await client.query("CREATE INDEX IF NOT EXISTS drafts_case_id_idx ON drafts(case_id)");
    },
  },
  {
    version: 5,
    name: "matter_core_and_sources",
    async run(client) {
      await client.query("ALTER TABLE cases ADD COLUMN IF NOT EXISTS client_name TEXT");
      await client.query("ALTER TABLE cases ADD COLUMN IF NOT EXISTS client_email TEXT");
      await client.query("ALTER TABLE cases ADD COLUMN IF NOT EXISTS matter_type TEXT");
      await client.query("ALTER TABLE cases ADD COLUMN IF NOT EXISTS jurisdiction TEXT");
      await client.query("ALTER TABLE cases ADD COLUMN IF NOT EXISTS preliminary_objectives TEXT");
      await client.query(
        "ALTER TABLE cases ADD COLUMN IF NOT EXISTS matter_type_suggested BOOLEAN NOT NULL DEFAULT FALSE"
      );
      await client.query(
        "ALTER TABLE cases ADD COLUMN IF NOT EXISTS jurisdiction_suggested BOOLEAN NOT NULL DEFAULT FALSE"
      );
      await client.query(
        "ALTER TABLE cases ADD COLUMN IF NOT EXISTS objectives_suggested BOOLEAN NOT NULL DEFAULT FALSE"
      );
      await client.query("ALTER TABLE cases ADD COLUMN IF NOT EXISTS updated_at TEXT");
      await client.query("ALTER TABLE cases ADD COLUMN IF NOT EXISTS last_activity_at TEXT");
      await client.query(`
        UPDATE cases
        SET updated_at = COALESCE(updated_at, created_at),
            last_activity_at = COALESCE(last_activity_at, created_at)
        WHERE updated_at IS NULL OR last_activity_at IS NULL
      `);

      await client.query(
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'Matter Upload'"
      );
      await client.query(
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'Lawyer'"
      );
      await client.query(
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS processing_state TEXT NOT NULL DEFAULT 'Ready'"
      );
      await client.query(`
        UPDATE documents
        SET source_type = CASE
          WHEN case_id IS NULL THEN 'Firm Library Document'
          ELSE 'Matter Upload'
        END
        WHERE source_type = 'Matter Upload'
      `);

      await client.query(
        "ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS link_origin TEXT NOT NULL DEFAULT 'Legacy Link'"
      );
      await client.query("ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS added_at TEXT");
      await client.query(`
        UPDATE case_documents cd
        SET added_at = COALESCE(cd.added_at, d.uploaded_at)
        FROM documents d
        WHERE d.id = cd.document_id AND cd.added_at IS NULL
      `);
      await client.query(
        "CREATE INDEX IF NOT EXISTS cases_firm_activity_idx ON cases(firm_id, last_activity_at DESC)"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS case_documents_case_added_idx ON case_documents(case_id, added_at DESC)"
      );
    },
  },
  {
    version: 6,
    name: "matter_work_product",
    async run(client) {
      await client.query("ALTER TABLE drafts ADD COLUMN IF NOT EXISTS updated_at TEXT");
      await client.query(
        "ALTER TABLE drafts ADD COLUMN IF NOT EXISTS shared_with_client BOOLEAN NOT NULL DEFAULT FALSE"
      );
      await client.query("ALTER TABLE drafts ADD COLUMN IF NOT EXISTS shared_at TEXT");
      await client.query(
        "ALTER TABLE drafts ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'Generated from conversation'"
      );
      await client.query("ALTER TABLE drafts ADD COLUMN IF NOT EXISTS parent_draft_id TEXT");
      await client.query(
        "ALTER TABLE drafts ADD COLUMN IF NOT EXISTS revision_type TEXT NOT NULL DEFAULT 'Lawyer Original'"
      );
      await client.query("UPDATE drafts SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL");
      const parentConstraint = await client.query(`
        SELECT 1 FROM pg_constraint WHERE conname = 'drafts_parent_draft_id_fkey'
      `);
      if (parentConstraint.rowCount === 0) {
        await client.query(`
          ALTER TABLE drafts ADD CONSTRAINT drafts_parent_draft_id_fkey
          FOREIGN KEY (parent_draft_id) REFERENCES drafts(id) ON DELETE SET NULL
        `);
      }
      await client.query(
        "CREATE INDEX IF NOT EXISTS drafts_case_updated_idx ON drafts(case_id, updated_at DESC)"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS drafts_parent_idx ON drafts(parent_draft_id) WHERE parent_draft_id IS NOT NULL"
      );
    },
  },
  {
    version: 7,
    name: "matter_intelligence",
    async run(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS matter_intelligence (
          case_id TEXT PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          source_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
          generated_at TEXT NOT NULL,
          last_edited_at TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1
        )
      `);
      await client.query(
        "CREATE INDEX IF NOT EXISTS matter_intelligence_generated_idx ON matter_intelligence(generated_at DESC)"
      );
    },
  },
  {
    version: 8,
    name: "matter_collaboration",
    async run(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS matter_client_access (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
          client_name TEXT NOT NULL,
          client_email TEXT NOT NULL,
          token_hash TEXT UNIQUE,
          invitation_status TEXT NOT NULL DEFAULT 'Pending',
          created_at TEXT NOT NULL,
          activated_at TEXT,
          revoked_at TEXT
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS collaboration_requests (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          request_type TEXT NOT NULL,
          instruction TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'Sent',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS collaboration_request_documents (
          request_id TEXT NOT NULL REFERENCES collaboration_requests(id) ON DELETE CASCADE,
          draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
          PRIMARY KEY (request_id, draft_id)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS client_responses (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL REFERENCES collaboration_requests(id) ON DELETE CASCADE,
          response_type TEXT NOT NULL,
          content TEXT,
          document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
          draft_id TEXT REFERENCES drafts(id) ON DELETE SET NULL,
          is_read BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TEXT NOT NULL
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS matter_client_access_token_idx ON matter_client_access(token_hash)");
      await client.query(
        "CREATE INDEX IF NOT EXISTS collaboration_requests_case_idx ON collaboration_requests(case_id, created_at DESC)"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS client_responses_request_idx ON client_responses(request_id, created_at DESC)"
      );
    },
  },
  {
    version: 9,
    name: "client_portal",
    async run(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS portal_comments (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      await client.query(
        "CREATE INDEX IF NOT EXISTS portal_comments_draft_idx ON portal_comments(draft_id, created_at)"
      );
    },
  },
  {
    version: 10,
    name: "assistant_message_metadata",
    async run(client) {
      await client.query(
        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS messages_thread_created_idx ON messages(thread_id, created_at)"
      );
    },
  },
  {
    version: 11,
    name: "portal_response_attachments_and_chat",
    async run(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS client_response_attachments (
          response_id TEXT NOT NULL REFERENCES client_responses(id) ON DELETE CASCADE,
          document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
          draft_id TEXT REFERENCES drafts(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (response_id, document_id, draft_id)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS client_response_attachments_response_idx
        ON client_response_attachments(response_id)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS portal_chat_messages (
          id TEXT PRIMARY KEY,
          access_id TEXT NOT NULL REFERENCES matter_client_access(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          selected_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TEXT NOT NULL
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS portal_chat_messages_access_created_idx
        ON portal_chat_messages(access_id, created_at)
      `);
    },
  },
  {
    version: 12,
    name: "client_response_attachment_nullable_targets",
    async run(client) {
      await client.query("ALTER TABLE client_response_attachments ADD COLUMN IF NOT EXISTS id TEXT");
      await client.query(`
        UPDATE client_response_attachments
        SET id = 'attachment_' || md5(
          response_id || ':' || COALESCE(document_id, '') || ':' || COALESCE(draft_id, '') || ':' || created_at
        )
        WHERE id IS NULL
      `);
      await client.query(`
        ALTER TABLE client_response_attachments
        DROP CONSTRAINT IF EXISTS client_response_attachments_pkey
      `);
      await client.query("ALTER TABLE client_response_attachments ALTER COLUMN document_id DROP NOT NULL");
      await client.query("ALTER TABLE client_response_attachments ALTER COLUMN draft_id DROP NOT NULL");
      await client.query("ALTER TABLE client_response_attachments ALTER COLUMN id SET NOT NULL");
      await client.query(`
        ALTER TABLE client_response_attachments
        ADD CONSTRAINT client_response_attachments_pkey PRIMARY KEY (id)
      `);
      await client.query(`
        ALTER TABLE client_response_attachments
        DROP CONSTRAINT IF EXISTS client_response_attachments_target_check
      `);
      await client.query(`
        ALTER TABLE client_response_attachments
        ADD CONSTRAINT client_response_attachments_target_check
        CHECK (document_id IS NOT NULL OR draft_id IS NOT NULL)
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS client_response_attachments_response_document_unique
        ON client_response_attachments(response_id, document_id)
        WHERE document_id IS NOT NULL
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS client_response_attachments_response_draft_unique
        ON client_response_attachments(response_id, draft_id)
        WHERE draft_id IS NOT NULL
      `);
    },
  },
  {
    version: 20,
    name: "passwordless_authentication_and_onboarding",
    async run(client) {
      await client.query("ALTER TABLE users ALTER COLUMN name DROP NOT NULL");
      await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT");
      await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TEXT");
      await client.query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE"
      );
      await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_role TEXT");
      await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_professional_role TEXT");
      await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS workspace_type TEXT");
      await client.query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS practice_areas JSONB NOT NULL DEFAULT '[]'::jsonb"
      );
      await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_practice_area TEXT");
      await client.query(
        "CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique_idx ON users(google_sub) WHERE google_sub IS NOT NULL"
      );
      await client.query("ALTER TABLE firm ADD COLUMN IF NOT EXISTS invitation_code TEXT");
      await client.query(
        "CREATE UNIQUE INDEX IF NOT EXISTS firm_invitation_code_unique_idx ON firm(UPPER(BTRIM(invitation_code))) WHERE invitation_code IS NOT NULL"
      );
      await client.query(`
        UPDATE users
        SET onboarding_completed = TRUE,
            workspace_type = COALESCE(workspace_type, 'firm')
        WHERE firm_id IS NOT NULL AND onboarding_completed = FALSE
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS email_otp_challenges (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          otp_hash TEXT NOT NULL,
          otp_salt TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          consumed_at TEXT
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS email_otp_challenges_email_created_idx
        ON email_otp_challenges(email, created_at DESC)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS email_otp_challenges_expiry_idx
        ON email_otp_challenges(expires_at)
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
