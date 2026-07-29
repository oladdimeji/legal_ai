import type { Pool } from "pg";
import { hashPassword } from "./auth.js";
import { createHash } from "node:crypto";

const LEGACY_ENV_KEYS = [
  "LEGACY_OWNER_USER_ID",
  "LEGACY_OWNER_FIRM_ID",
  "LEGACY_OWNER_INITIAL_PASSWORD",
] as const;

export async function migrateLegacyOwnerFromEnvironment(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const pending = await client.query<{ id: string }>(
      `SELECT id FROM users
       WHERE password_hash IS NULL
         AND onboarding_completed = FALSE
         AND firm_id IS NOT NULL
       ORDER BY id`
    );
    if (pending.rowCount === 0) return;

    const supplied = LEGACY_ENV_KEYS.map((key) => process.env[key]);
    if (supplied.some((value) => !value)) {
      throw new Error(
        `Legacy authentication migration requires ${LEGACY_ENV_KEYS.join(", ")} when passwordless users exist.`
      );
    }

    const [userId, firmId, initialPassword] = supplied as [string, string, string];
    if (pending.rowCount !== 1 || pending.rows[0].id !== userId) {
      throw new Error("Legacy owner is missing or ambiguous; no ownership or password changes were applied.");
    }

    await client.query("BEGIN");
    try {
      const owner = await client.query<{ id: string; firm_id: string }>(
        `SELECT u.id, u.firm_id
         FROM users u
         JOIN firm f ON f.id = u.firm_id
         WHERE u.id = $1 AND f.id = $2
         FOR UPDATE`,
        [userId, firmId]
      );
      if (owner.rowCount !== 1 || owner.rows[0].firm_id !== firmId) {
        throw new Error("Supplied legacy User and Firm IDs are missing or inconsistent.");
      }

      const crossMatterLinks = await client.query(`
        SELECT 1
        FROM case_documents cd
        JOIN cases c ON c.id = cd.case_id
        JOIN documents d ON d.id = cd.document_id
        WHERE c.firm_id IS NOT NULL
          AND d.firm_id IS NOT NULL
          AND c.firm_id <> d.firm_id
        LIMIT 1
      `);
      const inconsistentDirectDocuments = await client.query(`
        SELECT 1
        FROM documents d
        JOIN cases c ON c.id = d.case_id
        WHERE d.firm_id IS NOT NULL
          AND c.firm_id IS NOT NULL
          AND d.firm_id <> c.firm_id
        LIMIT 1
      `);
      if (crossMatterLinks.rowCount || inconsistentDirectDocuments.rowCount) {
        throw new Error("Legacy Matter/document ownership is inconsistent; migration was not applied.");
      }

      await client.query("UPDATE cases SET firm_id = $1 WHERE firm_id IS NULL", [firmId]);
      await client.query("UPDATE documents SET firm_id = $1 WHERE firm_id IS NULL", [firmId]);
      await client.query("UPDATE threads SET user_id = $1 WHERE user_id IS NULL", [userId]);

      const passwordHash = await hashPassword(initialPassword);
      const now = new Date().toISOString();
      await client.query(
        `UPDATE users
         SET password_hash = $1,
             created_at = COALESCE(created_at, $2),
             updated_at = $2
         WHERE id = $3 AND firm_id = $4 AND password_hash IS NULL`,
        [passwordHash, now, userId, firmId]
      );
      await client.query("COMMIT");
      console.log(`Legacy authentication owner verified and migrated for user ${userId}.`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

export async function migrateLegacyDraftsFromEnvironment(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const nullMatterDrafts = await client.query<{ id: string; user_id: string | null }>(`
      SELECT d.id, t.user_id
      FROM drafts d
      LEFT JOIN threads t ON t.id = d.thread_id
      WHERE d.case_id IS NULL
      ORDER BY d.id
    `);
    if (nullMatterDrafts.rowCount === 0) return;

    const userId = process.env.LEGACY_OWNER_USER_ID;
    const firmId = process.env.LEGACY_OWNER_FIRM_ID;
    if (!userId || !firmId) {
      throw new Error(
        "Null-Matter legacy Work Product exists; LEGACY_OWNER_USER_ID and LEGACY_OWNER_FIRM_ID are required."
      );
    }

    const foreignDraft = nullMatterDrafts.rows.find(
      (draft) => draft.user_id !== null && draft.user_id !== userId
    );
    if (foreignDraft) {
      throw new Error("Null-Matter Work Product ownership is ambiguous; no drafts were reassigned.");
    }

    await client.query("BEGIN");
    try {
      const owner = await client.query(
        `SELECT 1
         FROM users u
         JOIN firm f ON f.id = u.firm_id
         WHERE u.id = $1 AND f.id = $2 AND u.password_hash IS NOT NULL
         FOR UPDATE`,
        [userId, firmId]
      );
      if (owner.rowCount !== 1) {
        throw new Error("Legacy owner is not authenticated or does not belong to the supplied Firm.");
      }

      const importedMatterId = `case_imported_${createHash("sha256")
        .update(firmId)
        .digest("hex")
        .slice(0, 16)}`;
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO cases (id, firm_id, name, description, created_at, status)
         VALUES ($1, $2, 'Imported Legacy Work Product',
           'Preserved Work Product imported from conversations that did not have a Matter.', $3, 'On Hold')
         ON CONFLICT (id) DO NOTHING`,
        [importedMatterId, firmId, now]
      );
      const importedMatter = await client.query(
        "SELECT 1 FROM cases WHERE id = $1 AND firm_id = $2 AND name = 'Imported Legacy Work Product'",
        [importedMatterId, firmId]
      );
      if (importedMatter.rowCount !== 1) {
        throw new Error("Imported Legacy Work Product Matter ID conflicts with an existing record.");
      }

      await client.query(
        `UPDATE drafts d
         SET case_id = $1
         WHERE d.case_id IS NULL
           AND (
             d.thread_id IS NULL OR EXISTS (
               SELECT 1 FROM threads t WHERE t.id = d.thread_id AND t.user_id = $2
             )
           )`,
        [importedMatterId, userId]
      );
      await client.query("COMMIT");
      console.log(`Legacy null-Matter Work Product assigned to ${importedMatterId}.`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}
