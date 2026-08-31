import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { splitEmbeddingBatches } from "../server/db.js";

test("document embedding batches are bounded by count and payload size", () => {
  const thirtyChunks = Array.from({ length: 30 }, (_value, index) => `paragraph ${index}`);
  const batches = splitEmbeddingBatches(thirtyChunks);
  assert.equal(batches.length, 2);
  assert.deepEqual(batches.flat(), thirtyChunks);
  assert.ok(batches.every((batch) => batch.length <= 18));

  const largeChunks = ["a".repeat(30_001), "b".repeat(30_001), "tail"];
  const payloadBatches = splitEmbeddingBatches(largeChunks);
  assert.deepEqual(payloadBatches.map((batch) => batch.length), [1, 2]);
  assert.deepEqual(payloadBatches.flat(), largeChunks);
});

test("both persistent indexing paths defer embedding until after the upload response", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const helper = database.slice(database.indexOf("async function prepareDocumentIndex"), database.indexOf("async function finalizeDocumentIndex"));
  const deferred = database.slice(database.indexOf("async function finalizeDocumentIndex"), database.indexOf("function scheduleDocumentIndex"));
  const ordinary = database.slice(database.indexOf("private async addDocumentInternal"), database.indexOf("public async createSession"));
  const portal = database.slice(database.indexOf("public async createPortalResponse"), database.indexOf("public async getPortalAssistantSources"));
  assert.match(helper, /splitEmbeddingBatches\(paragraphs\)/);
  assert.match(helper, /await embedTexts\(batch\)/);
  assert.match(helper, /falling back[\s\S]*callModel\("embedding"/);
  assert.match(deferred, /prepareDocumentIndex\(text, documentId\)/);
  assert.match(ordinary, /scheduleDocumentIndex\(docId, text, firmId/);
  assert.doesNotMatch(ordinary, /await prepareDocumentIndex\(text, docId\)/);
  assert.match(portal, /scheduleDocumentIndex\(/);
  assert.doesNotMatch(portal, /await prepareDocumentIndex\(file\.text, documentId\)/);
  assert.doesNotMatch(ordinary, /for \(let i = 0; i < paragraphs\.length/);
  assert.doesNotMatch(portal, /for \(let i = 0; i < paragraphs\.length/);
});

test("both indexing paths use the bounded multi-row chunk insert helper", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const helper = database.slice(database.indexOf("async function insertDocumentChunks"), database.indexOf("function accountFromRow"));
  const deferred = database.slice(database.indexOf("async function finalizeDocumentIndex"), database.indexOf("function scheduleDocumentIndex"));

  assert.match(database, /DOCUMENT_CHUNK_INSERT_BATCH_SIZE = 10/);
  assert.match(helper, /offset \+= DOCUMENT_CHUNK_INSERT_BATCH_SIZE/);
  assert.match(helper, /INSERT INTO document_chunks[\s\S]*VALUES \$\{values\.join/);
  assert.match(deferred, /insertDocumentChunks\(documentId, prepared\.chunks/);
  assert.doesNotMatch(deferred, /for \(const chunk of prepared\.chunks\)/);
});
