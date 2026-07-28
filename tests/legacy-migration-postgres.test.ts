import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { runMigrations } from "../server/migrations.js";

const { Pool } = pg;

const connectionString = process.env.LEGACY_MIGRATION_TEST_DATABASE_URL || process.env.SUPABASE_DB_URL;
const shouldRun = process.env.RUN_LEGACY_MIGRATION_TEST === "true";

function sslFor(connection: string | undefined): pg.PoolConfig["ssl"] {
  if (!connection) return undefined;
  return /supabase\.com|sslmode=require/i.test(connection)
    ? { rejectUnauthorized: false }
    : undefined;
}

async function queryJson(pool: pg.Pool, sql: string): Promise<unknown[]> {
  const result = await pool.query(sql);
  return result.rows.map((row) => row.row_data);
}

test("legacy schemas with migrations 1-3 recorded receive firm_id compatibility before migration 4", {
  skip: shouldRun ? false : "set RUN_LEGACY_MIGRATION_TEST=true with a PostgreSQL test database",
}, async () => {
  assert.ok(connectionString, "LEGACY_MIGRATION_TEST_DATABASE_URL or SUPABASE_DB_URL is required");

  const schema = `legacy_migration_${randomUUID().replaceAll("-", "_")}`;
  const admin = new Pool({ connectionString, ssl: sslFor(connectionString) });
  let pool: pg.Pool | undefined;

  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString,
      ssl: sslFor(connectionString),
      options: `-c search_path=${schema}`,
    });

    await pool.query(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE cases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        case_id TEXT,
        title TEXT NOT NULL,
        source_url TEXT,
        drive_id TEXT,
        extracted_text TEXT NOT NULL,
        section TEXT NOT NULL,
        uploaded_at TEXT NOT NULL
      );
      CREATE TABLE document_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT,
        chunk_text TEXT NOT NULL
      );
      CREATE TABLE case_documents (
        case_id TEXT,
        document_id TEXT,
        PRIMARY KEY (case_id, document_id)
      );
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        case_id TEXT,
        scope TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        citations JSONB NOT NULL DEFAULT '[]'::jsonb,
        steps JSONB,
        created_at TEXT NOT NULL
      );
      CREATE TABLE drafts (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        case_id TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO schema_migrations (version, name)
      VALUES
        (1, 'baseline_schema'),
        (2, 'preserve_drafts_when_threads_are_deleted'),
        (3, 'authentication_and_sessions');
      INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
      VALUES ('legacy_user', 'Legacy User', 'legacy@example.com', 'hash', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
      INSERT INTO cases (id, name, description, created_at)
      VALUES ('legacy_case', 'Legacy Matter', 'Preserve this matter', '2024-01-02T00:00:00.000Z');
      INSERT INTO documents (id, case_id, title, source_url, drive_id, extracted_text, section, uploaded_at)
      VALUES ('legacy_doc', 'legacy_case', 'Legacy Source', NULL, NULL, 'Original text', 'Evidence', '2024-01-03T00:00:00.000Z');
      INSERT INTO case_documents (case_id, document_id) VALUES ('legacy_case', 'legacy_doc');
      INSERT INTO threads (id, user_id, case_id, scope, title, created_at)
      VALUES ('legacy_thread', 'legacy_user', 'legacy_case', 'case', 'Legacy Thread', '2024-01-04T00:00:00.000Z');
      INSERT INTO messages (id, thread_id, role, content, created_at)
      VALUES ('legacy_message', 'legacy_thread', 'user', 'Please preserve me', '2024-01-05T00:00:00.000Z');
      INSERT INTO drafts (id, thread_id, case_id, title, content, created_at)
      VALUES ('legacy_draft', 'legacy_thread', 'legacy_case', 'Legacy Draft', 'Draft body', '2024-01-06T00:00:00.000Z');
    `);

    const beforeCases = await queryJson(
      pool,
      "SELECT to_jsonb(row(id, name, description, created_at)) AS row_data FROM cases ORDER BY id",
    );
    const beforeDocuments = await queryJson(
      pool,
      "SELECT to_jsonb(row(id, case_id, title, source_url, drive_id, extracted_text, section, uploaded_at)) AS row_data FROM documents ORDER BY id",
    );

    await runMigrations(pool);

    const versions = await pool.query<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version"
    );
    assert.deepEqual(versions.rows.map((row) => row.version), [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);

    const columns = await pool.query<{ table_name: string; column_name: string; is_nullable: string }>(`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name IN ('users', 'cases', 'documents')
        AND column_name = 'firm_id'
      ORDER BY table_name
    `, [schema]);
    assert.deepEqual(
      columns.rows.map((row) => [row.table_name, row.column_name, row.is_nullable]),
      [
        ["cases", "firm_id", "YES"],
        ["documents", "firm_id", "YES"],
        ["users", "firm_id", "YES"],
      ],
    );

    const constraints = await pool.query<{ conname: string; convalidated: boolean }>(`
      SELECT conname, convalidated
      FROM pg_constraint
      WHERE conrelid IN ('users'::regclass, 'cases'::regclass, 'documents'::regclass)
        AND conname IN ('users_firm_id_fkey', 'cases_firm_id_fkey', 'documents_firm_id_fkey')
      ORDER BY conname
    `);
    assert.deepEqual(
      constraints.rows.map((row) => [row.conname, row.convalidated]),
      [
        ["cases_firm_id_fkey", false],
        ["documents_firm_id_fkey", false],
        ["users_firm_id_fkey", false],
      ],
    );

    assert.deepEqual(
      await queryJson(
        pool,
        "SELECT to_jsonb(row(id, name, description, created_at)) AS row_data FROM cases ORDER BY id",
      ),
      beforeCases,
    );
    assert.deepEqual(
      await queryJson(
        pool,
        "SELECT to_jsonb(row(id, case_id, title, source_url, drive_id, extracted_text, section, uploaded_at)) AS row_data FROM documents ORDER BY id",
      ),
      beforeDocuments,
    );
    assert.deepEqual(
      (await pool.query("SELECT id FROM users WHERE firm_id IS NULL")).rows,
      [{ id: "legacy_user" }],
    );
    assert.deepEqual(
      (await pool.query("SELECT id FROM cases WHERE firm_id IS NULL")).rows,
      [{ id: "legacy_case" }],
    );
    assert.deepEqual(
      (await pool.query("SELECT id FROM documents WHERE firm_id IS NULL")).rows,
      [{ id: "legacy_doc" }],
    );

    await runMigrations(pool);
    const rerunVersions = await pool.query<{ version: number; count: string }>(`
      SELECT version, COUNT(*) AS count
      FROM schema_migrations
      GROUP BY version
      ORDER BY version
    `);
    assert.ok(rerunVersions.rows.every((row) => row.count === "1"));
    assert.equal(rerunVersions.rows.at(-1)?.version, 19);
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
