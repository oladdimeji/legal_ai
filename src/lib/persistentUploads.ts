import { browserFileIdentity } from "../hooks/useCumulativeFileSelection";

export type PersistentUploadPhase = "uploading" | "succeeded" | "failed";

export interface PersistentUploadProgress {
  file: File;
  identity: string;
  current: number;
  total: number;
  phase: PersistentUploadPhase;
  error?: string;
}

export interface PersistentUploadFailure {
  file: File;
  identity: string;
  error: string;
}

export interface PersistentUploadResult {
  successfulFiles: File[];
  failedFiles: PersistentUploadFailure[];
}

type UploadFile = (file: File) => Promise<void>;
type ProgressCallback = (progress: PersistentUploadProgress) => void;

const PERSISTENT_UPLOAD_CONCURRENCY = 2;

function uploadErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Upload failed";
}

export async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json() as { error?: unknown };
    if (typeof data.error === "string" && data.error.trim()) return data.error;
  } catch {
    // The response did not contain a JSON error payload.
  }
  return fallback;
}

export async function uploadPersistentFilesSequentially(
  files: readonly File[],
  uploadFile: UploadFile,
  onProgress?: ProgressCallback
): Promise<PersistentUploadResult> {
  const orderedFiles = [...files];
  const successfulFiles: Array<File | undefined> = new Array(orderedFiles.length);
  const failedFiles: Array<PersistentUploadFailure | undefined> = new Array(orderedFiles.length);
  let nextIndex = 0;

  const uploadNext = async (): Promise<void> => {
    while (nextIndex < orderedFiles.length) {
      const index = nextIndex;
      nextIndex += 1;
      const file = orderedFiles[index];
      const identity = browserFileIdentity(file);
      const progress = { file, identity, current: index + 1, total: orderedFiles.length };
      onProgress?.({ ...progress, phase: "uploading" });
      try {
        await uploadFile(file);
        successfulFiles[index] = file;
        onProgress?.({ ...progress, phase: "succeeded" });
      } catch (error) {
        const message = uploadErrorMessage(error);
        failedFiles[index] = { file, identity, error: message };
        onProgress?.({ ...progress, phase: "failed", error: message });
      }
    }
  };

  const workerCount = Math.min(PERSISTENT_UPLOAD_CONCURRENCY, orderedFiles.length);
  await Promise.all(Array.from({ length: workerCount }, () => uploadNext()));

  return {
    successfulFiles: successfulFiles.filter((file): file is File => file !== undefined),
    failedFiles: failedFiles.filter((failure): failure is PersistentUploadFailure => failure !== undefined),
  };
}

export function persistentUploadSummary(successful: number, failed: number): string {
  if (failed === 0) return "All selected documents were uploaded successfully.";
  const successfulLabel = successful === 1 ? "document" : "documents";
  const failedLabel = failed === 1 ? "document needs" : "documents need";
  return `${successful} ${successfulLabel} uploaded; ${failed} ${failedLabel} attention.`;
}
