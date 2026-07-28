import assert from "node:assert/strict";
import net from "node:net";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ClamAvScanner } from "../server/clamav.js";
import { chunkExtractedText, chunkHash, extractStoredFile } from "../server/ingestion.js";
import { loadServerConfig } from "../server/config.js";

async function withScannerReply(reply: string, run: (port: number) => Promise<void>): Promise<void> {
  const server = net.createServer((socket) => {
    socket.on("data", () => undefined);
    socket.end(reply);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("ClamAV scanner handles clean, infected, health, and invalid outcomes", async () => {
  await withScannerReply("PONG\0", async (port) => {
    assert.equal((await new ClamAvScanner("127.0.0.1", port).health()).status, "ready");
  });
  await withScannerReply("stream: OK\0", async (port) => {
    assert.equal(await new ClamAvScanner("127.0.0.1", port).scan(Buffer.from("safe fixture")), "clean");
  });
  await withScannerReply("stream: Eicar-Signature FOUND\0", async (port) => {
    assert.equal(await new ClamAvScanner("127.0.0.1", port).scan(Buffer.from("fixture")), "infected");
  });
  await withScannerReply("stream: protocol error\0", async (port) => {
    await assert.rejects(new ClamAvScanner("127.0.0.1", port).scan(Buffer.from("fixture")), /invalid response/);
  });
});

test("text extraction and deterministic chunking are idempotent", async () => {
  const source = "First paragraph with enough content.\n\nSecond paragraph with enough content.";
  const extracted = await extractStoredFile("notes.txt", "text/plain", Buffer.from(source));
  assert.equal(extracted.text, source);
  assert.equal(extracted.scannedPdf, false);
  const first = chunkExtractedText(extracted.text, 45);
  const second = chunkExtractedText(extracted.text, 45);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map(chunkHash), second.map(chunkHash));
  assert.equal(new Set(first.map((_, index) => `document-1:${index}`)).size, first.length);
});

test("async ingestion configuration is explicit and remains default false", () => {
  assert.equal(loadServerConfig({ NODE_ENV: "test" }).features.asyncIngestion, false);
  assert.throws(
    () => loadServerConfig({ NODE_ENV: "test", FEATURE_ASYNC_INGESTION: "true" }),
    /SUPABASE_DB_URL/,
  );
  assert.doesNotThrow(() => loadServerConfig({
    NODE_ENV: "test",
    FEATURE_ASYNC_INGESTION: "true",
    SUPABASE_DB_URL: "postgres://fixture.invalid/db",
    OBJECT_STORAGE_PROVIDER: "supabase",
    SUPABASE_URL: "https://fixture.invalid",
    SUPABASE_SECRET_KEY: "fixture",
    STORAGE_BUCKET: "fixture",
    JOBS_PROVIDER: "pg-boss",
    MALWARE_SCANNER_PROVIDER: "clamav",
  }));
});

test("worker enforces scan-first, bounded retries, recovery, cancellation, and scoped idempotent indexing", async () => {
  const [worker, jobs, database, migrations, uploads] = await Promise.all([
    readFile("worker.ts", "utf8"),
    readFile("server/jobs.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
    readFile("server/migrations.ts", "utf8"),
    readFile("src/lib/durableUploads.ts", "utf8"),
  ]);
  assert.ok(worker.indexOf('transition(payload.versionId, payload.firmId, "scanning")') <
    worker.indexOf('transition(payload.versionId, payload.firmId, "extracting")'));
  assert.match(worker, /scanResult !== "clean"[\s\S]*return/);
  assert.match(worker, /processing_state IN \('scanning', 'extracting', 'indexing'\)/);
  assert.match(worker, /cancellation_requested_at/);
  assert.match(worker, /ON CONFLICT \(document_id, chunk_index\)/);
  assert.match(jobs, /retryLimit: 5/);
  assert.match(jobs, /retryBackoff: true/);
  assert.match(jobs, /retryDelayMax: 15 \* 60/);
  assert.match(database, /v\.id = \$1 AND v\.firm_id = \$2/);
  assert.match(database, /getIngestionVisibility\(context: OwnershipContext\)/);
  assert.match(migrations, /version: 14/);
  assert.match(migrations, /CREATE UNIQUE INDEX IF NOT EXISTS document_chunks_document_index_unique/);
  assert.match(uploads, /Promise\.allSettled/);
});

test("Docker topology keeps ClamAV private and separates web and worker", async () => {
  const compose = await readFile("compose.yaml", "utf8");
  assert.match(compose, /\n  web:\n/);
  assert.match(compose, /\n  worker:\n/);
  assert.match(compose, /\n  clamav:\n/);
  assert.match(compose, /expose:\s*\n\s*- "3310"/);
  assert.doesNotMatch(compose, /clamav:[\s\S]*ports:/);
});
