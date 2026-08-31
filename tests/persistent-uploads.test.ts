import assert from "node:assert/strict";
import type { Express } from "express";
import { Readable } from "node:stream";
import test from "node:test";
import {
  appendUniqueFiles,
  browserFileIdentity,
  MAX_PERSISTENT_UPLOAD_FILES,
  MAX_SELECTED_FILES,
} from "../src/hooks/useCumulativeFileSelection.js";
import {
  responseErrorMessage,
  uploadPersistentFilesSequentially,
} from "../src/lib/persistentUploads.js";
import {
  extractUploads,
  MAX_FILE_COUNT,
  MAX_FILE_SIZE_BYTES,
  MAX_TOTAL_EXTRACTED_CHARS,
  validateUploadFile,
} from "../server/fileExtraction.js";

function file(name: string, lastModified = 1): File {
  return new File([name], name, { type: "text/plain", lastModified });
}

test("persistent selections allow 25 files while the restricted default remains five", () => {
  assert.equal(MAX_PERSISTENT_UPLOAD_FILES, 25);
  assert.equal(MAX_SELECTED_FILES, 5);

  const firstFive = Array.from({ length: 5 }, (_, index) => file(`restricted-${index}.txt`));
  assert.equal(appendUniqueFiles([], firstFive).files.length, 5);
  const restrictedOverflow = appendUniqueFiles(firstFive, [file("restricted-6.txt")]);
  assert.equal(restrictedOverflow.files.length, 5);
  assert.match(restrictedOverflow.error, /at most 5 files/);

  const firstTwentyFive = Array.from({ length: 25 }, (_, index) => file(`persistent-${index}.txt`));
  assert.equal(appendUniqueFiles([], firstTwentyFive, MAX_PERSISTENT_UPLOAD_FILES).files.length, 25);
  const persistentOverflow = appendUniqueFiles(firstTwentyFive, [file("persistent-26.txt")], MAX_PERSISTENT_UPLOAD_FILES);
  assert.equal(persistentOverflow.files.length, 25);
  assert.match(persistentOverflow.error, /at most 25 files/);
});

test("cumulative persistent selections still prevent duplicate browser files", () => {
  const original = file("same.txt", 123);
  const duplicate = file("same.txt", 123);
  const distinct = file("same.txt", 456);
  const result = appendUniqueFiles([original], [duplicate, distinct], MAX_PERSISTENT_UPLOAD_FILES);

  assert.deepEqual(result.files.map(browserFileIdentity), [
    browserFileIdentity(original),
    browserFileIdentity(distinct),
  ]);
  assert.equal(result.error, "");
});

test("persistent uploads run two at a time, retain input-ordered results, and continue after a failure", async () => {
  const files = [file("first.txt"), file("broken.txt"), file("last.txt")];
  const attempts: string[] = [];
  const formFileCounts: number[] = [];
  const progress: string[] = [];
  let activeUploads = 0;
  let maximumActiveUploads = 0;

  const result = await uploadPersistentFilesSequentially(
    files,
    async (currentFile) => {
      attempts.push(currentFile.name);
      const form = new FormData();
      form.append("files", currentFile);
      formFileCounts.push(form.getAll("files").length);
      activeUploads += 1;
      maximumActiveUploads = Math.max(maximumActiveUploads, activeUploads);
      try {
        await new Promise((resolve) => setTimeout(resolve, currentFile.name === "first.txt" ? 10 : 1));
        if (currentFile.name === "broken.txt") throw new Error("server rejected this document");
      } finally {
        activeUploads -= 1;
      }
    },
    (update) => progress.push(`${update.phase}:${update.current}:${update.file.name}`)
  );

  assert.deepEqual(attempts, ["first.txt", "broken.txt", "last.txt"]);
  assert.deepEqual(formFileCounts, [1, 1, 1]);
  assert.equal(maximumActiveUploads, 2);
  assert.deepEqual(result.successfulFiles, [files[0], files[2]]);
  assert.equal(result.failedFiles.length, 1);
  assert.equal(result.failedFiles[0].file, files[1]);
  assert.equal(result.failedFiles[0].identity, browserFileIdentity(files[1]));
  assert.equal(result.failedFiles[0].error, "server rejected this document");
  assert.deepEqual(progress.slice(0, 2), ["uploading:1:first.txt", "uploading:2:broken.txt"]);
  assert.ok(progress.indexOf("uploading:3:last.txt") > progress.indexOf("failed:2:broken.txt"));
  assert.ok(progress.indexOf("uploading:3:last.txt") < progress.indexOf("succeeded:1:first.txt"));
  assert.deepEqual(new Set(progress), new Set([
    "uploading:1:first.txt",
    "succeeded:1:first.txt",
    "uploading:2:broken.txt",
    "failed:2:broken.txt",
    "uploading:3:last.txt",
    "succeeded:3:last.txt",
  ]));
});

test("server-provided upload errors are preserved without automatic retries", async () => {
  const currentFile = file("oversized.txt");
  let attempts = 0;
  const reason = await responseErrorMessage(
    new Response(JSON.stringify({ error: "Extracted text exceeds the request limit." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }),
    "Upload failed"
  );
  const result = await uploadPersistentFilesSequentially([currentFile], async () => {
    attempts += 1;
    throw new Error(reason);
  });

  assert.equal(attempts, 1);
  assert.equal(result.successfulFiles.length, 0);
  assert.equal(result.failedFiles[0].file, currentFile);
  assert.equal(result.failedFiles[0].error, "Extracted text exceeds the request limit.");
});

test("pdf uploads accept application/octet-stream when the extension is .pdf", () => {
  const buffer = Buffer.from("sample");
  const upload = {
    fieldname: "files",
    originalname: "contract.pdf",
    encoding: "7bit",
    mimetype: "application/octet-stream",
    size: buffer.length,
    destination: "",
    filename: "",
    path: "",
    buffer,
    stream: Readable.from(buffer),
  } satisfies Express.Multer.File;

  assert.equal(validateUploadFile(upload), ".pdf");
});

test("backend upload safeguards remain unchanged", () => {
  assert.equal(MAX_FILE_COUNT, 5);
  assert.equal(MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_TOTAL_EXTRACTED_CHARS, 120_000);
});

test("an oversized extracted document is rejected instead of silently truncated", async () => {
  const buffer = Buffer.from("x".repeat(MAX_TOTAL_EXTRACTED_CHARS + 1));
  const upload = {
    fieldname: "files",
    originalname: "too-long.txt",
    encoding: "7bit",
    mimetype: "text/plain",
    size: buffer.length,
    destination: "",
    filename: "",
    path: "",
    buffer,
    stream: Readable.from(buffer),
  } satisfies Express.Multer.File;

  await assert.rejects(
    extractUploads([upload]),
    /Extracted text exceeds the request limit\. Upload fewer or shorter documents\./
  );
});
