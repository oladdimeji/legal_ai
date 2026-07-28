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
    version: 13,
    name: "private_original_uploads",
    async run(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS upload_batches (
          id TEXT PRIMARY KEY,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE CASCADE,
          case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
          created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          upload_source TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'Authorized',
          file_count INTEGER NOT NULL,
          total_bytes BIGINT NOT NULL,
          authorization_expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS document_versions (
          id TEXT PRIMARY KEY,
          document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
          reserved_document_id TEXT NOT NULL UNIQUE,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE CASCADE,
          case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
          upload_batch_id TEXT NOT NULL REFERENCES upload_batches(id) ON DELETE RESTRICT,
          version_number INTEGER NOT NULL DEFAULT 1,
          original_filename TEXT NOT NULL,
          safe_filename TEXT NOT NULL,
          object_key TEXT NOT NULL UNIQUE,
          storage_bucket TEXT NOT NULL,
          content_type TEXT NOT NULL,
          byte_size BIGINT NOT NULL,
          checksum_sha256 TEXT NOT NULL,
          upload_source TEXT NOT NULL,
          uploaded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          upload_state TEXT NOT NULL DEFAULT 'Authorized',
          authorization_expires_at TIMESTAMPTZ NOT NULL,
          confirmed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (firm_id, checksum_sha256)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS upload_batches_firm_created_idx
        ON upload_batches(firm_id, created_at DESC)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS document_versions_firm_state_idx
        ON document_versions(firm_id, upload_state, created_at DESC)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS document_versions_document_idx
        ON document_versions(document_id, version_number DESC)
      `);
    },
  },
  {
    version: 14,
    name: "durable_async_ingestion",
    async run(client) {
      await client.query(`
        ALTER TABLE document_versions
          ADD COLUMN IF NOT EXISTS processing_state TEXT NOT NULL DEFAULT 'uploaded',
          ADD COLUMN IF NOT EXISTS scan_result TEXT,
          ADD COLUMN IF NOT EXISTS ingestion_job_id TEXT,
          ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS processing_error_code TEXT,
          ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS processing_heartbeat_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS processing_completed_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ
      `);
      await client.query(`
        UPDATE document_versions
        SET processing_state = CASE
          WHEN upload_state = 'Uploaded' THEN 'uploaded'
          ELSE 'cancelled'
        END
        WHERE processing_state NOT IN
          ('uploaded', 'scanning', 'extracting', 'needs_ocr', 'indexing', 'ready', 'failed', 'cancelled')
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS ingestion_events (
          id BIGSERIAL PRIMARY KEY,
          version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE CASCADE,
          state TEXT NOT NULL,
          attempt INTEGER NOT NULL DEFAULT 0,
          error_code TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        ALTER TABLE document_chunks
          ADD COLUMN IF NOT EXISTS chunk_index INTEGER,
          ADD COLUMN IF NOT EXISTS content_hash TEXT
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS document_chunks_document_index_unique
        ON document_chunks(document_id, chunk_index)
        WHERE chunk_index IS NOT NULL
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS document_versions_processing_recovery_idx
        ON document_versions(processing_state, processing_heartbeat_at)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS ingestion_events_firm_version_idx
        ON ingestion_events(firm_id, version_id, created_at DESC)
      `);
    },
  },
  {
    version: 15,
    name: "govinfo_research_traceability",
    async run(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS retrieved_legal_sources (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          provider_source_id TEXT NOT NULL,
          title TEXT NOT NULL,
          canonical_url TEXT NOT NULL,
          publication_date TEXT,
          retrieved_at TIMESTAMPTZ NOT NULL,
          content TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          UNIQUE (provider, provider_source_id, content_hash)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS research_runs (
          id TEXT PRIMARY KEY,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE RESTRICT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE RESTRICT,
          case_id TEXT REFERENCES cases(id) ON DELETE RESTRICT,
          provider TEXT NOT NULL,
          normalized_query TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS research_run_sources (
          id TEXT PRIMARY KEY,
          research_run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
          retrieved_source_id TEXT NOT NULL REFERENCES retrieved_legal_sources(id) ON DELETE RESTRICT,
          title_snapshot TEXT NOT NULL,
          canonical_url_snapshot TEXT NOT NULL,
          publication_date_snapshot TEXT,
          retrieved_at_snapshot TIMESTAMPTZ NOT NULL,
          supporting_passage TEXT NOT NULL,
          metadata_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
          attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (research_run_id, retrieved_source_id, supporting_passage)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS research_runs_firm_user_thread_idx
        ON research_runs(firm_id, user_id, thread_id, created_at DESC)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS research_run_sources_run_idx
        ON research_run_sources(research_run_id, attached_at)
      `);
      await client.query(`
        CREATE OR REPLACE FUNCTION reject_research_trace_mutation()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'Research trace rows are immutable';
        END
        $$
      `);
      for (const table of ["research_runs", "research_run_sources"]) {
        await client.query(`DROP TRIGGER IF EXISTS ${table}_immutable_update_delete ON ${table}`);
        await client.query(`
          CREATE TRIGGER ${table}_immutable_update_delete
          BEFORE UPDATE OR DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION reject_research_trace_mutation()
        `);
      }
    },
  },
  {
    version: 16,
    name: "google_oauth_and_drive_file_lifecycle",
    async run(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS oauth_connections (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          provider_subject TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE CASCADE,
          provider_email TEXT,
          scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
          encrypted_refresh_token TEXT,
          token_type TEXT,
          access_token_expires_at TIMESTAMPTZ,
          token_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          revocation_state TEXT NOT NULL DEFAULT 'active',
          connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMPTZ,
          last_error_code TEXT,
          UNIQUE (provider, provider_subject),
          UNIQUE (provider, user_id)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS oauth_authorization_states (
          state_hash TEXT PRIMARY KEY,
          browser_binding_hash TEXT NOT NULL,
          provider TEXT NOT NULL,
          mode TEXT NOT NULL,
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          firm_id TEXT REFERENCES firm(id) ON DELETE CASCADE,
          redirect_uri TEXT NOT NULL,
          encrypted_code_verifier TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          consumed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CHECK (
            (mode = 'link' AND user_id IS NOT NULL AND firm_id IS NOT NULL)
            OR (mode = 'signin' AND user_id IS NULL AND firm_id IS NULL)
          )
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx
        ON oauth_authorization_states(expires_at)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS drive_file_imports (
          id TEXT PRIMARY KEY,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          oauth_connection_id TEXT NOT NULL REFERENCES oauth_connections(id) ON DELETE RESTRICT,
          case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
          document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
          document_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
          drive_file_id TEXT NOT NULL,
          drive_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          canonical_url TEXT,
          drive_modified_time TIMESTAMPTZ,
          current_drive_modified_time TIMESTAMPTZ,
          imported_at TIMESTAMPTZ,
          drive_revision_id TEXT,
          current_drive_revision_id TEXT,
          drive_checksum TEXT,
          current_drive_checksum TEXT,
          stored_checksum_sha256 TEXT,
          imported_parent_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          current_parent_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          sync_state TEXT NOT NULL DEFAULT 'importing',
          last_checked_at TIMESTAMPTZ,
          last_error_code TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        ALTER TABLE drive_file_imports
          ADD COLUMN IF NOT EXISTS current_drive_modified_time TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS current_drive_revision_id TEXT,
          ADD COLUMN IF NOT EXISTS current_drive_checksum TEXT
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS drive_imports_connection_file_library_unique
        ON drive_file_imports(oauth_connection_id, drive_file_id)
        WHERE case_id IS NULL
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS drive_imports_connection_file_matter_unique
        ON drive_file_imports(oauth_connection_id, drive_file_id, case_id)
        WHERE case_id IS NOT NULL
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS drive_imports_firm_user_context_idx
        ON drive_file_imports(firm_id, user_id, case_id, updated_at DESC)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS drive_exports (
          id TEXT PRIMARY KEY,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          oauth_connection_id TEXT NOT NULL REFERENCES oauth_connections(id) ON DELETE RESTRICT,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          drive_file_id TEXT NOT NULL,
          drive_name TEXT NOT NULL,
          canonical_url TEXT,
          drive_modified_time TIMESTAMPTZ,
          drive_revision_id TEXT,
          drive_checksum TEXT,
          exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS drive_exports_firm_user_case_idx
        ON drive_exports(firm_id, user_id, case_id, exported_at DESC)
      `);
    },
  },
  {
    version: 17,
    name: "firm_memberships_invitations_and_matter_assignments",
    async run(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS firm_memberships (
          id TEXT PRIMARY KEY,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE RESTRICT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          role TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          invited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          activated_at TIMESTAMPTZ,
          suspended_at TIMESTAMPTZ,
          removed_at TIMESTAMPTZ,
          removed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (firm_id, user_id),
          CHECK (role IN ('firm_admin', 'lawyer', 'staff', 'read_only')),
          CHECK (status IN ('active', 'suspended', 'removed'))
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS firm_invitations (
          id TEXT PRIMARY KEY,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE RESTRICT,
          email TEXT NOT NULL,
          normalized_email TEXT NOT NULL,
          role TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'pending',
          invited_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          accepted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          accepted_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CHECK (role IN ('firm_admin', 'lawyer', 'staff', 'read_only')),
          CHECK (status IN ('pending', 'accepted', 'expired', 'revoked'))
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS firm_invitations_pending_email_unique
        ON firm_invitations(firm_id, normalized_email)
        WHERE status = 'pending'
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS firm_invitation_matter_assignments (
          invitation_id TEXT NOT NULL REFERENCES firm_invitations(id) ON DELETE CASCADE,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          PRIMARY KEY (invitation_id, case_id)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS firm_invitations_expiry_idx
        ON firm_invitations(status, expires_at)
      `);
      await client.query(`
        ALTER TABLE cases
        ADD COLUMN IF NOT EXISTS created_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS matter_assignments (
          id TEXT PRIMARY KEY,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE RESTRICT,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          status TEXT NOT NULL DEFAULT 'active',
          assigned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          removed_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (case_id, user_id),
          CHECK (status IN ('active', 'removed'))
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS firm_memberships_user_status_idx
        ON firm_memberships(user_id, firm_id, status)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS matter_assignments_user_case_idx
        ON matter_assignments(firm_id, user_id, status, case_id)
      `);

      // Existing users become active administrators of their current firm. This
      // preserves every single-user workspace and does not infer a fallback user.
      await client.query(`
        INSERT INTO firm_memberships
          (id, firm_id, user_id, role, status, activated_at, created_at, updated_at)
        SELECT 'membership_' || md5(u.firm_id || ':' || u.id), u.firm_id, u.id,
          'firm_admin', 'active', NOW(), NOW(), NOW()
        FROM users u
        WHERE u.firm_id IS NOT NULL
        ON CONFLICT (firm_id, user_id) DO NOTHING
      `);
      // Preserve direct Matter access for every legacy firm user. Administrators
      // already have firm-wide policy access; these rows also preserve ownership
      // if a legacy member is later changed to an assignment-bound role.
      await client.query(`
        INSERT INTO matter_assignments
          (id, firm_id, case_id, user_id, status, assigned_by_user_id, assigned_at, updated_at)
        SELECT 'assignment_' || md5(c.id || ':' || u.id), c.firm_id, c.id, u.id,
          'active', u.id, NOW(), NOW()
        FROM cases c
        JOIN users u ON u.firm_id = c.firm_id
        ON CONFLICT (case_id, user_id) DO NOTHING
      `);
    },
  },
  {
    version: 18,
    name: "resource_lifecycle_versions_retention_and_deletion_queue",
    async run(client) {
      await client.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'active'`);
      await client.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS archived_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL`);
      await client.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS retention_state TEXT NOT NULL DEFAULT 'standard'`);
      await client.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ`);
      await client.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS retention_reason TEXT`);
      await client.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS retention_updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL`);
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE cases ADD CONSTRAINT cases_lifecycle_state_check
            CHECK (lifecycle_state IN ('active', 'archived', 'deletion_pending', 'deleted'));
        EXCEPTION WHEN duplicate_object THEN NULL; END $$
      `);
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE cases ADD CONSTRAINT cases_retention_state_check
            CHECK (retention_state IN ('standard', 'held'));
        EXCEPTION WHEN duplicate_object THEN NULL; END $$
      `);

      await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'active'`);
      await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS archived_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL`);
      await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_path TEXT NOT NULL DEFAULT '/'`);
      await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::text[]`);
      await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS originating_draft_id TEXT REFERENCES drafts(id) ON DELETE SET NULL`);
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE documents ADD CONSTRAINT documents_lifecycle_state_check
            CHECK (lifecycle_state IN ('active', 'archived', 'deletion_pending'));
        EXCEPTION WHEN duplicate_object THEN NULL; END $$
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS documents_firm_lifecycle_idx ON documents(firm_id, case_id, lifecycle_state, uploaded_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS documents_firm_folder_idx ON documents(firm_id, folder_path) WHERE case_id IS NULL`);
      await client.query(`CREATE INDEX IF NOT EXISTS documents_tags_gin_idx ON documents USING GIN(tags)`);

      await client.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'active'`);
      await client.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS archived_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL`);
      await client.query(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS last_edited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL`);
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE drafts ADD CONSTRAINT drafts_lifecycle_state_check
            CHECK (lifecycle_state IN ('active', 'archived', 'deletion_pending'));
        EXCEPTION WHEN duplicate_object THEN NULL; END $$
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS drafts_case_lifecycle_idx ON drafts(case_id, lifecycle_state, updated_at DESC)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS document_resource_versions (
          id TEXT PRIMARY KEY,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE RESTRICT,
          document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          title TEXT NOT NULL,
          extracted_text TEXT NOT NULL,
          section TEXT NOT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          original_document_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
          change_type TEXT NOT NULL,
          created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(document_id, version_number),
          CHECK (change_type IN ('created', 'replacement', 'metadata', 'restored'))
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS document_resource_versions_scope_idx ON document_resource_versions(firm_id, document_id, version_number DESC)`);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS document_resource_versions_original_unique
        ON document_resource_versions(original_document_version_id)
        WHERE original_document_version_id IS NOT NULL
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS work_product_versions (
          id TEXT PRIMARY KEY,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE RESTRICT,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          revision_lane TEXT NOT NULL,
          change_type TEXT NOT NULL,
          created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(draft_id, version_number),
          CHECK (revision_lane IN ('lawyer', 'client')),
          CHECK (change_type IN ('created', 'autosave', 'saved', 'renamed', 'restored'))
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS work_product_versions_scope_idx ON work_product_versions(firm_id, case_id, draft_id, version_number DESC)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS work_product_source_links (
          id TEXT PRIMARY KEY,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE RESTRICT,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE RESTRICT,
          document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
          created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(draft_id, document_id)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS resource_audit_events (
          id TEXT PRIMARY KEY,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE RESTRICT,
          actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          case_id TEXT,
          action TEXT NOT NULL,
          details JSONB NOT NULL DEFAULT '{}'::jsonb,
          occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS resource_audit_events_scope_idx ON resource_audit_events(firm_id, case_id, resource_type, resource_id, occurred_at DESC)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS permanent_deletion_requests (
          id TEXT PRIMARY KEY,
          firm_id TEXT NOT NULL REFERENCES firm(id) ON DELETE RESTRICT,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          case_id TEXT,
          requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          confirmation_digest TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          not_before TIMESTAMPTZ NOT NULL,
          dependency_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          safe_error_code TEXT,
          requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          CHECK (resource_type IN ('matter', 'document', 'work_product')),
          CHECK (status IN ('pending', 'processing', 'blocked', 'completed', 'cancelled'))
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS permanent_deletion_requests_active_unique
        ON permanent_deletion_requests(firm_id, resource_type, resource_id)
        WHERE status IN ('pending', 'processing')
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS permanent_deletion_requests_worker_idx ON permanent_deletion_requests(status, not_before)`);

      // Immutable histories and audit rows remain append-only even when current
      // content changes. Permanent-deletion processing explicitly removes version
      // rows in the same transaction; audit references are intentionally strings.
      for (const table of ["document_resource_versions", "work_product_versions", "resource_audit_events"]) {
        await client.query(`
          CREATE OR REPLACE FUNCTION prevent_${table}_mutation()
          RETURNS trigger AS $$
          BEGIN
            RAISE EXCEPTION '${table} is append-only';
          END;
          $$ LANGUAGE plpgsql
        `);
        await client.query(`DROP TRIGGER IF EXISTS ${table}_immutable_update ON ${table}`);
        await client.query(`
          CREATE TRIGGER ${table}_immutable_update
          BEFORE UPDATE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION prevent_${table}_mutation()
        `);
      }

      // Backfill a first immutable version without rewriting current resources.
      await client.query(`
        INSERT INTO document_resource_versions
          (id, firm_id, document_id, version_number, title, extracted_text, section,
           metadata, change_type, created_by_user_id, created_at)
        SELECT 'doc_resource_version_' || md5(d.id || ':1'), d.firm_id, d.id, 1,
          d.title, d.extracted_text, d.section, d.metadata, 'created',
          c.created_by_user_id, d.uploaded_at::timestamptz
        FROM documents d
        LEFT JOIN cases c ON c.id = d.case_id
        ON CONFLICT (document_id, version_number) DO NOTHING
      `);
      await client.query(`
        INSERT INTO work_product_versions
          (id, firm_id, case_id, draft_id, version_number, title, content,
           revision_lane, change_type, created_by_user_id, created_at)
        SELECT 'work_product_version_' || md5(d.id || ':1'), c.firm_id, d.case_id, d.id, 1,
          d.title, d.content,
          CASE WHEN d.revision_type IN ('Client Revision', 'Client Response') THEN 'client' ELSE 'lawyer' END,
          'created', COALESCE(d.last_edited_by_user_id, c.created_by_user_id),
          d.created_at::timestamptz
        FROM drafts d
        JOIN cases c ON c.id = d.case_id
        ON CONFLICT (draft_id, version_number) DO NOTHING
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
