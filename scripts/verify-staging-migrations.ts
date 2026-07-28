import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  throw new Error("SUPABASE_DB_URL is required.");
}

function sanitizedTarget(value: string): string {
  const parsed = new URL(value);
  return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
}

const pool = new Pool({
  connectionString,
  ssl: /supabase\.com|sslmode=require/i.test(connectionString)
    ? { rejectUnauthorized: false }
    : undefined,
});

try {
  console.log(`Database target: ${sanitizedTarget(connectionString)}`);

  const versions = await pool.query<{ version: number; name: string; applied_at: string }>(`
    SELECT version, name, applied_at::text
    FROM schema_migrations
    ORDER BY version
  `);
  console.log("Applied migrations:");
  for (const row of versions.rows) {
    console.log(`  ${String(row.version).padStart(3, "0")} ${row.name} ${row.applied_at}`);
  }

  const columns = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN (
        'firm', 'users', 'cases', 'documents', 'document_chunks', 'case_documents',
        'threads', 'messages', 'drafts', 'client_users', 'matter_client_memberships',
        'client_invitations', 'client_notifications'
      )
    ORDER BY table_name, ordinal_position
  `);
  console.log("Current schema columns:");
  for (const row of columns.rows) {
    const defaultText = row.column_default ? ` default=${row.column_default}` : "";
    console.log(`  ${row.table_name}.${row.column_name} ${row.data_type} nullable=${row.is_nullable}${defaultText}`);
  }

  const constraints = await pool.query<{
    table_name: string;
    constraint_name: string;
    constraint_type: string;
    convalidated: boolean;
  }>(`
    SELECT c.relname AS table_name, con.conname AS constraint_name,
      CASE con.contype
        WHEN 'f' THEN 'FOREIGN KEY'
        WHEN 'p' THEN 'PRIMARY KEY'
        WHEN 'u' THEN 'UNIQUE'
        WHEN 'c' THEN 'CHECK'
        ELSE con.contype::text
      END AS constraint_type,
      con.convalidated
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relname IN ('users', 'cases', 'documents')
      AND con.conname LIKE '%firm_id%'
    ORDER BY c.relname, con.conname
  `);
  console.log("Firm ownership constraints:");
  for (const row of constraints.rows) {
    console.log(`  ${row.table_name}.${row.constraint_name} ${row.constraint_type} validated=${row.convalidated}`);
  }
} finally {
  await pool.end();
}
