import "dotenv/config";
import pg from "pg";
import { loadServerConfig } from "./server/config.js";
import { runMigrations } from "./server/migrations.js";
import { SupabaseStorageProvider } from "./server/storage.js";
import { ClamAvScanner } from "./server/clamav.js";
import { PgBossJobsProvider } from "./server/jobs.js";
import {
  INGESTION_QUEUE,
  chunkExtractedText,
  chunkHash,
  extractStoredFile,
  type IngestionJob,
  type IngestionState,
} from "./server/ingestion.js";
import { callModel } from "./server/model.js";

const { Pool } = pg;
const config = loadServerConfig();
if (!config.features.asyncIngestion) throw new Error("FEATURE_ASYNC_INGESTION must be true for the worker.");
if (config.providers.jobs.provider !== "pg-boss") throw new Error("JOBS_PROVIDER must be pg-boss.");
if (config.providers.malwareScanning.provider !== "clamav") {
  throw new Error("MALWARE_SCANNER_PROVIDER must be clamav.");
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
});
const storage = new SupabaseStorageProvider(
  config.providers.objectStorage.supabaseUrl!,
  config.providers.objectStorage.supabaseSecretKey!,
  config.providers.objectStorage.bucket!,
);
const scanner = new ClamAvScanner(
  process.env.CLAMAV_HOST || "clamav",
  Number(process.env.CLAMAV_PORT || 3310),
);
const jobs = new PgBossJobsProvider(config.databaseUrl!);

async function transition(
  versionId: string,
  firmId: string,
  state: IngestionState,
  errorCode: string | null = null,
): Promise<void> {
  const result = await pool.query(
    `UPDATE document_versions
     SET processing_state = $3,
         processing_error_code = $4,
         processing_heartbeat_at = NOW(),
         processing_started_at = COALESCE(processing_started_at, NOW()),
         processing_completed_at = CASE WHEN $3 IN ('ready', 'needs_ocr', 'failed', 'cancelled') THEN NOW() ELSE NULL END
     WHERE id = $1 AND firm_id = $2
     RETURNING id`,
    [versionId, firmId, state, errorCode],
  );
  if (result.rowCount !== 1) throw new Error("ingestion_scope_invalid");
  await pool.query(
    `INSERT INTO ingestion_events(version_id, firm_id, state, attempt, error_code)
     SELECT id, firm_id, $3, processing_attempts, $4
     FROM document_versions WHERE id = $1 AND firm_id = $2`,
    [versionId, firmId, state, errorCode],
  );
  await pool.query(
    `UPDATE documents d SET processing_state = $3
     FROM document_versions v
     WHERE v.id = $1 AND v.firm_id = $2 AND d.id = v.document_id AND d.firm_id = v.firm_id`,
    [versionId, firmId, state],
  );
}

async function isCancelled(versionId: string, firmId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT cancellation_requested_at IS NOT NULL AS cancelled
     FROM document_versions WHERE id = $1 AND firm_id = $2`,
    [versionId, firmId],
  );
  return result.rows[0]?.cancelled === true;
}

async function recordDocumentResourceVersion(version: any): Promise<void> {
  await pool.query(
    `INSERT INTO document_resource_versions
      (id, firm_id, document_id, version_number, title, extracted_text, section,
       metadata, original_document_version_id, change_type, created_by_user_id)
     SELECT 'doc_resource_version_' || md5(v.id), v.firm_id, d.id,
       COALESCE((SELECT MAX(existing.version_number) + 1
         FROM document_resource_versions existing WHERE existing.document_id = d.id), 1),
       d.title, d.extracted_text, d.section, d.metadata, v.id,
       CASE WHEN EXISTS (SELECT 1 FROM document_resource_versions existing
         WHERE existing.document_id = d.id) THEN 'replacement' ELSE 'created' END,
       v.uploaded_by_user_id
     FROM document_versions v JOIN documents d ON d.id = v.document_id AND d.firm_id = v.firm_id
     WHERE v.id = $1 AND v.firm_id = $2
     ON CONFLICT (original_document_version_id) WHERE original_document_version_id IS NOT NULL
     DO NOTHING`,
    [version.id, version.firm_id],
  );
}

export async function processIngestionJob(payload: IngestionJob): Promise<void> {
  const claimed = await pool.query(
    `UPDATE document_versions
     SET processing_attempts = processing_attempts + 1, processing_heartbeat_at = NOW()
     WHERE id = $1 AND firm_id = $2 AND upload_state = 'Uploaded'
       AND processing_state NOT IN ('ready', 'needs_ocr', 'cancelled')
     RETURNING *`,
    [payload.versionId, payload.firmId],
  );
  const version = claimed.rows[0];
  if (!version) return;
  try {
    if (await isCancelled(payload.versionId, payload.firmId)) {
      await transition(payload.versionId, payload.firmId, "cancelled");
      return;
    }
    await transition(payload.versionId, payload.firmId, "scanning");
    const bytes = await storage.download(version.object_key);
    const scanResult = await scanner.scan(bytes);
    await pool.query(
      "UPDATE document_versions SET scan_result = $3 WHERE id = $1 AND firm_id = $2",
      [payload.versionId, payload.firmId, scanResult],
    );
    if (scanResult !== "clean") {
      await transition(payload.versionId, payload.firmId, "failed", "malware_detected");
      return;
    }
    if (await isCancelled(payload.versionId, payload.firmId)) {
      await transition(payload.versionId, payload.firmId, "cancelled");
      return;
    }
    await transition(payload.versionId, payload.firmId, "extracting");
    const extracted = await extractStoredFile(version.original_filename, version.content_type, bytes);
    if (extracted.scannedPdf) {
      await recordDocumentResourceVersion(version);
      await transition(payload.versionId, payload.firmId, "needs_ocr", "ocr_deferred_v1");
      return;
    }
    if (!extracted.text) {
      await transition(payload.versionId, payload.firmId, "failed", "empty_extraction");
      return;
    }
    await pool.query(
      `UPDATE documents d SET extracted_text = $3
       FROM document_versions v
       WHERE v.id = $1 AND v.firm_id = $2 AND d.id = v.document_id AND d.firm_id = v.firm_id`,
      [payload.versionId, payload.firmId, extracted.text],
    );
    await transition(payload.versionId, payload.firmId, "indexing");
    const chunks = chunkExtractedText(extracted.text);
    for (let index = 0; index < chunks.length; index += 1) {
      if (await isCancelled(payload.versionId, payload.firmId)) {
        await transition(payload.versionId, payload.firmId, "cancelled");
        return;
      }
      const embedding = await callModel("embedding", [], { textToEmbed: chunks[index] }) as number[];
      await pool.query(
        `INSERT INTO document_chunks(id, document_id, chunk_text, embedding, chunk_index, content_hash)
         VALUES ($1, $2, $3, $4::vector, $5, $6)
         ON CONFLICT (document_id, chunk_index) WHERE chunk_index IS NOT NULL
         DO UPDATE SET chunk_text = EXCLUDED.chunk_text, embedding = EXCLUDED.embedding,
           content_hash = EXCLUDED.content_hash`,
        [
          `chunk_${version.document_id}_${index}`,
          version.document_id,
          chunks[index],
          `[${embedding.join(",")}]`,
          index,
          chunkHash(chunks[index]),
        ],
      );
    }
    await pool.query(
      "DELETE FROM document_chunks WHERE document_id = $1 AND chunk_index >= $2",
      [version.document_id, chunks.length],
    );
    await recordDocumentResourceVersion(version);
    await transition(payload.versionId, payload.firmId, "ready");
  } catch (error) {
    await transition(payload.versionId, payload.firmId, "failed", "retryable_processing_error");
    throw error;
  }
}

async function recoverStaleJobs(): Promise<void> {
  const stale = await pool.query(
    `UPDATE document_versions
     SET processing_state = 'uploaded', processing_error_code = 'worker_restart_recovery'
     WHERE upload_state = 'Uploaded'
       AND processing_state IN ('scanning', 'extracting', 'indexing')
       AND COALESCE(processing_heartbeat_at, processing_started_at, confirmed_at) < NOW() - INTERVAL '20 minutes'
     RETURNING id, firm_id`,
  );
  for (const row of stale.rows) {
    const jobId = await jobs.enqueueIngestion({ versionId: row.id, firmId: row.firm_id });
    await pool.query(
      "UPDATE document_versions SET ingestion_job_id = $3 WHERE id = $1 AND firm_id = $2",
      [row.id, row.firm_id, jobId],
    );
  }
  const unqueued = await pool.query(
    `SELECT id, firm_id FROM document_versions
     WHERE upload_state = 'Uploaded' AND processing_state = 'uploaded'
       AND ingestion_job_id IS NULL AND cancellation_requested_at IS NULL`,
  );
  for (const row of unqueued.rows) {
    const jobId = await jobs.enqueueIngestion({ versionId: row.id, firmId: row.firm_id });
    await pool.query(
      "UPDATE document_versions SET ingestion_job_id = $3 WHERE id = $1 AND firm_id = $2",
      [row.id, row.firm_id, jobId],
    );
  }
}

export async function processPendingPermanentDeletion(): Promise<boolean> {
  if (!config.features.resourceLifecycle) return false;
  const claimed = await pool.query(
    `UPDATE permanent_deletion_requests SET status = 'processing',
       started_at = NOW(), attempt_count = attempt_count + 1, safe_error_code = NULL
     WHERE id = (
       SELECT id FROM permanent_deletion_requests
       WHERE status = 'pending' AND not_before <= NOW()
       ORDER BY not_before FOR UPDATE SKIP LOCKED LIMIT 1
     )
     RETURNING *`,
  );
  const request = claimed.rows[0];
  if (!request) return false;
  try {
    const objects = request.resource_type === "matter"
      ? await pool.query(
          `SELECT object_key FROM document_versions
           WHERE firm_id = $1 AND case_id = $2 AND upload_state = 'Uploaded'`,
          [request.firm_id, request.resource_id],
        )
      : request.resource_type === "document"
        ? await pool.query(
            `SELECT object_key FROM document_versions
             WHERE firm_id = $1 AND document_id = $2 AND upload_state = 'Uploaded'`,
            [request.firm_id, request.resource_id],
          )
        : { rows: [] };
    await storage.remove(objects.rows.map((row) => row.object_key));

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (request.resource_type === "document") {
        const removed = await client.query(
          `DELETE FROM documents WHERE id = $1 AND firm_id = $2
             AND lifecycle_state = 'deletion_pending' RETURNING id`,
          [request.resource_id, request.firm_id],
        );
        if (removed.rowCount !== 1) throw new Error("deletion_scope_invalid");
      } else if (request.resource_type === "work_product") {
        const removed = await client.query(
          `DELETE FROM drafts d USING cases c
           WHERE d.id = $1 AND d.case_id = c.id AND c.firm_id = $2
             AND d.lifecycle_state = 'deletion_pending' RETURNING d.id`,
          [request.resource_id, request.firm_id],
        );
        if (removed.rowCount !== 1) throw new Error("deletion_scope_invalid");
      } else {
        const matter = await client.query(
          `SELECT id FROM cases WHERE id = $1 AND firm_id = $2
             AND lifecycle_state = 'deletion_pending' FOR UPDATE`,
          [request.resource_id, request.firm_id],
        );
        if (matter.rowCount !== 1) throw new Error("deletion_scope_invalid");
        await client.query(`DELETE FROM work_product_source_links WHERE firm_id = $1 AND case_id = $2`, [request.firm_id, request.resource_id]);
        await client.query(`DELETE FROM drive_exports WHERE firm_id = $1 AND case_id = $2`, [request.firm_id, request.resource_id]);
        await client.query(`DELETE FROM drive_file_imports WHERE firm_id = $1 AND case_id = $2`, [request.firm_id, request.resource_id]);
        await client.query(`DELETE FROM matter_intelligence WHERE case_id = $1`, [request.resource_id]);
        await client.query(`DELETE FROM collaboration_requests WHERE case_id = $1`, [request.resource_id]);
        await client.query(`DELETE FROM matter_client_access WHERE case_id = $1`, [request.resource_id]);
        await client.query(`DELETE FROM threads WHERE case_id = $1`, [request.resource_id]);
        await client.query(`DELETE FROM drafts WHERE case_id = $1`, [request.resource_id]);
        await client.query(`DELETE FROM document_versions WHERE firm_id = $1 AND case_id = $2`, [request.firm_id, request.resource_id]);
        await client.query(`DELETE FROM documents WHERE firm_id = $1 AND case_id = $2`, [request.firm_id, request.resource_id]);
        await client.query(`DELETE FROM case_documents WHERE case_id = $1`, [request.resource_id]);
        await client.query(`DELETE FROM upload_batches WHERE firm_id = $1 AND case_id = $2`, [request.firm_id, request.resource_id]);
        await client.query(`DELETE FROM matter_assignments WHERE firm_id = $1 AND case_id = $2`, [request.firm_id, request.resource_id]);
        await client.query(`DELETE FROM firm_invitation_matter_assignments WHERE case_id = $1`, [request.resource_id]);
        // Research traces and audit rows deliberately retain the opaque Matter id.
        // The Matter row becomes a non-confidential tombstone so their immutable
        // foreign-key references remain auditable without retaining Matter content.
        await client.query(
          `UPDATE cases SET name = '[Permanently deleted Matter]', description = '',
             client_name = NULL, client_email = NULL, matter_type = NULL,
             jurisdiction = NULL, preliminary_objectives = NULL,
             retention_reason = NULL, lifecycle_state = 'deleted', updated_at = NOW()
           WHERE id = $1 AND firm_id = $2`,
          [request.resource_id, request.firm_id],
        );
      }
      await client.query(
        `INSERT INTO resource_audit_events
          (id, firm_id, actor_user_id, resource_type, resource_id, case_id, action, details)
         VALUES ('audit_' || md5(random()::text || clock_timestamp()::text), $1, $2, $3, $4,
           $5, 'permanent_deletion_completed', jsonb_build_object('requestId', $6))`,
        [request.firm_id, request.requested_by_user_id, request.resource_type,
          request.resource_id, request.case_id, request.id],
      );
      await client.query(
        `UPDATE permanent_deletion_requests SET status = 'completed', completed_at = NOW()
         WHERE id = $1 AND firm_id = $2`,
        [request.id, request.firm_id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return true;
  } catch {
    await pool.query(
      `UPDATE permanent_deletion_requests SET status = 'blocked',
         safe_error_code = 'dependency_or_storage_failure'
       WHERE id = $1 AND firm_id = $2`,
      [request.id, request.firm_id],
    );
    return false;
  }
}

async function main(): Promise<void> {
  await runMigrations(pool);
  await jobs.start();
  if ((await scanner.health()).status !== "ready") throw new Error("Malware scanner is unavailable.");
  await recoverStaleJobs();
  if (config.features.resourceLifecycle) {
    await processPendingPermanentDeletion();
    const deletionTimer = setInterval(() => void processPendingPermanentDeletion(), 30_000);
    deletionTimer.unref();
  }
  await jobs.boss.work<IngestionJob>(INGESTION_QUEUE, { batchSize: 1 }, async ([job]) => {
    await processIngestionJob(job.data);
  });
  const shutdown = async () => {
    await jobs.stop();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error("Ingestion worker failed with a safe startup error.");
    process.exit(1);
  });
}
