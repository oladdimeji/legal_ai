const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();

  const target = await client.query(`
    SELECT
      current_database() AS database,
      current_user AS database_user,
      current_schema() AS schema,
      current_setting('search_path') AS search_path
  `);

  console.log("DOCKER DATABASE TARGET:");
  console.table(target.rows);

  await client.query(`
    BEGIN;

    CREATE TABLE IF NOT EXISTS public.firm (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    ALTER TABLE IF EXISTS public.users
      ADD COLUMN IF NOT EXISTS firm_id TEXT;

    ALTER TABLE IF EXISTS public.cases
      ADD COLUMN IF NOT EXISTS firm_id TEXT;

    ALTER TABLE IF EXISTS public.documents
      ADD COLUMN IF NOT EXISTS firm_id TEXT;

    COMMIT;
  `);

  const columns = await client.query(`
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('users', 'cases', 'documents')
      AND column_name = 'firm_id'
    ORDER BY table_name
  `);

  console.log("FIRM_ID COLUMNS:");
  console.table(columns.rows);

  await client.end();
})().catch((error) => {
  console.error("DATABASE REPAIR FAILED:", error);
  process.exit(1);
});
