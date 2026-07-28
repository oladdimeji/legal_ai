import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ObjectStorageProvider, ProviderHealth } from "./providers/contracts.js";

export const STORAGE_LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxBatchBytes: 500 * 1024 * 1024,
  maxFilesPerBatch: 25,
  maxWorkspaceBytes: 10 * 1024 * 1024 * 1024,
  maxWorkspaceFiles: 10_000,
} as const;

export const UPLOAD_AUTHORIZATION_TTL_MS = 2 * 60 * 60 * 1000;
export const DOWNLOAD_TTL_SECONDS = 60;

export type UploadFileRequest = {
  filename: string;
  size: number;
  contentType: string;
  checksumSha256: string;
};

export type ScopedUploadVersion = {
  firm_id: string;
  uploaded_by_user_id: string;
  upload_state: string;
  authorization_expires_at: string | Date;
  byte_size: number | string;
  checksum_sha256: string;
};

export function safeStorageFilename(filename: string): string {
  const basename = filename.replace(/\\/g, "/").split("/").pop() || "file";
  const normalized = basename.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
  const safe = normalized
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return safe && safe !== "." ? safe : "file";
}

export function buildObjectKey(
  firmId: string,
  caseId: string | null,
  documentId: string,
  versionId: string,
  filename: string,
): string {
  const resource = caseId ? `matters/${encodeURIComponent(caseId)}` : "firm-library";
  return `firms/${encodeURIComponent(firmId)}/${resource}/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/${safeStorageFilename(filename)}`;
}

export function validateUploadFiles(files: UploadFileRequest[]): void {
  if (!Array.isArray(files) || files.length === 0) throw new Error("Select at least one file.");
  if (files.length > STORAGE_LIMITS.maxFilesPerBatch) {
    throw new Error(`Upload at most ${STORAGE_LIMITS.maxFilesPerBatch} files per batch.`);
  }
  let total = 0;
  const checksums = new Set<string>();
  for (const file of files) {
    if (!file.filename || !Number.isInteger(file.size) || file.size <= 0) throw new Error("Invalid file metadata.");
    if (file.size > STORAGE_LIMITS.maxFileBytes) throw new Error("Each file must be 50 MB or smaller.");
    if (!/^[a-f0-9]{64}$/i.test(file.checksumSha256)) throw new Error("Invalid SHA-256 checksum.");
    const checksum = file.checksumSha256.toLowerCase();
    if (checksums.has(checksum)) throw new Error("Duplicate file checksum in upload batch.");
    checksums.add(checksum);
    total += file.size;
  }
  if (total > STORAGE_LIMITS.maxBatchBytes) throw new Error("Upload batch exceeds the 500 MB limit.");
}

export function assertUploadConfirmation(
  version: ScopedUploadVersion,
  object: { size: number; metadata: Record<string, string> } | null,
  now = Date.now(),
): void {
  if (version.upload_state !== "Authorized") throw new Error("Upload is not confirmable.");
  if (new Date(version.authorization_expires_at).getTime() <= now) {
    throw new Error("Upload authorization has expired.");
  }
  if (!object) throw new Error("Private original is not present.");
  if (object.size !== Number(version.byte_size)) {
    throw new Error("Uploaded object size does not match authorization.");
  }
  const storedChecksum = object.metadata.checksumSha256 || object.metadata.checksumsha256;
  if (storedChecksum && storedChecksum.toLowerCase() !== version.checksum_sha256.toLowerCase()) {
    throw new Error("Uploaded object checksum does not match authorization.");
  }
}

export function isUploadOwner(
  version: Pick<ScopedUploadVersion, "firm_id" | "uploaded_by_user_id">,
  context: { firmId: string; userId: string },
): boolean {
  return version.firm_id === context.firmId && version.uploaded_by_user_id === context.userId;
}

export function resumableEndpoint(supabaseUrl: string): string {
  const url = new URL(supabaseUrl);
  if (url.hostname.endsWith(".supabase.co")) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  url.pathname = "/storage/v1/upload/resumable";
  return url.toString();
}

export class SupabaseStorageProvider implements ObjectStorageProvider {
  private readonly client: SupabaseClient;

  constructor(
    private readonly url: string,
    private readonly secretKey: string,
    private readonly bucket: string,
  ) {
    this.client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async health(): Promise<ProviderHealth> {
    const { error } = await this.client.storage.getBucket(this.bucket);
    return error ? { status: "unavailable", detail: "Private storage bucket unavailable" } : { status: "ready" };
  }

  async createSignedUpload(key: string): Promise<{ token: string; expiresAt: string }> {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUploadUrl(key);
    if (error || !data?.token) throw new Error("Private upload authorization could not be created.");
    return {
      token: data.token,
      expiresAt: new Date(Date.now() + UPLOAD_AUTHORIZATION_TTL_MS).toISOString(),
    };
  }

  async stat(key: string): Promise<{ size: number; contentType: string | null; metadata: Record<string, string> } | null> {
    const { data, error } = await this.client.storage.from(this.bucket).info(key);
    if (error || !data) return null;
    const metadata = (data.metadata || {}) as Record<string, unknown>;
    return {
      size: Number(metadata.size ?? data.metadata?.size ?? 0),
      contentType: typeof metadata.mimetype === "string" ? metadata.mimetype : null,
      metadata: Object.fromEntries(Object.entries(metadata).map(([name, value]) => [name, String(value)])),
    };
  }

  async createSignedDownload(key: string, expiresInSeconds: number, downloadName: string): Promise<string> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(key, expiresInSeconds, { download: downloadName });
    if (error || !data?.signedUrl) throw new Error("Original download could not be authorized.");
    return data.signedUrl;
  }

  get resumableUrl(): string {
    return resumableEndpoint(this.url);
  }
}
