import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  STORAGE_LIMITS,
  assertUploadConfirmation,
  buildObjectKey,
  isUploadOwner,
  safeStorageFilename,
  validateUploadFiles,
} from "../server/storage.js";

const checksum = (character = "a") => character.repeat(64);

test("private upload authorization accepts 20 direct files and enforces batch limits", () => {
  const files = Array.from({ length: 20 }, (_, index) => ({
    filename: `evidence-${index}.pdf`,
    size: 1024,
    contentType: "application/pdf",
    checksumSha256: index.toString(16).padStart(64, "0"),
  }));
  assert.doesNotThrow(() => validateUploadFiles(files));
  assert.throws(
    () => validateUploadFiles([...files, ...files.slice(0, STORAGE_LIMITS.maxFilesPerBatch - 19)]),
    /at most 25/i,
  );
  assert.throws(
    () => validateUploadFiles([{ ...files[0], size: STORAGE_LIMITS.maxFileBytes + 1 }]),
    /50 MB/i,
  );
});

test("object keys contain firm, resource, document, version, and a traversal-safe filename", () => {
  assert.equal(safeStorageFilename("../../client memo?.pdf"), "client-memo-.pdf");
  const key = buildObjectKey("firm a", "matter/1", "doc_1", "version_1", "../../client memo?.pdf");
  assert.equal(
    key,
    "firms/firm%20a/matters/matter%2F1/documents/doc_1/versions/version_1/client-memo-.pdf",
  );
  assert.doesNotMatch(key, /(^|\/)\.\.(\/|$)/);
});

test("confirmation requires an unexpired authorization and matching private object", () => {
  const version = {
    firm_id: "firm_1",
    uploaded_by_user_id: "user_1",
    upload_state: "Authorized",
    authorization_expires_at: "2030-01-01T00:00:00.000Z",
    byte_size: 120,
    checksum_sha256: checksum(),
  };
  assert.doesNotThrow(() => assertUploadConfirmation(
    version,
    { size: 120, metadata: { checksumSha256: checksum() } },
    Date.parse("2029-01-01T00:00:00.000Z"),
  ));
  assert.throws(() => assertUploadConfirmation(version, null, Date.parse("2029-01-01")), /not present/i);
  assert.throws(
    () => assertUploadConfirmation(version, { size: 119, metadata: {} }, Date.parse("2029-01-01")),
    /size/i,
  );
  assert.throws(
    () => assertUploadConfirmation(version, { size: 120, metadata: { checksumSha256: checksum("b") } }, Date.parse("2029-01-01")),
    /checksum/i,
  );
  assert.throws(
    () => assertUploadConfirmation(version, { size: 120, metadata: {} }, Date.parse("2030-01-01")),
    /expired/i,
  );
});

test("upload ownership denies cross-firm and cross-user substitution", () => {
  const version = { firm_id: "firm_1", uploaded_by_user_id: "user_1" };
  assert.equal(isUploadOwner(version, { firmId: "firm_1", userId: "user_1" }), true);
  assert.equal(isUploadOwner(version, { firmId: "firm_2", userId: "user_1" }), false);
  assert.equal(isUploadOwner(version, { firmId: "firm_1", userId: "user_2" }), false);
});

test("duplicate checksums are rejected before storage authorization", () => {
  const file = { filename: "same.pdf", size: 10, contentType: "application/pdf", checksumSha256: checksum() };
  assert.throws(() => validateUploadFiles([file, { ...file, filename: "copy.pdf" }]), /duplicate/i);
});

test("routes and database scope confirmation and original downloads to the authenticated firm", async () => {
  const [server, database] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/db.ts", import.meta.url), "utf8"),
  ]);
  assert.match(server, /app\.post\("\/api\/uploads\/authorize"/);
  assert.match(server, /app\.post\("\/api\/uploads\/:versionId\/confirm"/);
  assert.match(server, /app\.get\("\/api\/document-versions\/:versionId\/original-download"/);
  assert.match(database, /v\.id = \$1 AND v\.firm_id = \$2 AND v\.uploaded_by_user_id = \$3/);
  assert.match(database, /v\.id = \$1 AND v\.firm_id = \$2 AND v\.upload_state = 'Uploaded'/);
  assert.match(database, /SELECT id FROM firm WHERE id = \$1 FOR UPDATE/);
  assert.match(database, /A file with the same checksum already exists in this workspace/);
});
