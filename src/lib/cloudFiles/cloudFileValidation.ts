import {
  GOOGLE_NATIVE_DOCUMENT_MIME,
  MAX_CLOUD_FILE_SIZE_BYTES,
  SUPPORTED_FILE_MIME_TYPES,
  type SupportedFileExtension,
} from "./constants";

export type CloudProvider = "google-drive" | "dropbox";

export type CloudSelectedItem = {
  id: string;
  name: string;
  size?: number;
  mimeType?: string;
};

export type CloudFileFailure = {
  name: string;
  error: string;
};

export type CloudFileBatchResult = {
  files: File[];
  failures: CloudFileFailure[];
};

export class CloudPickerCancelled extends Error {
  constructor() {
    super("Cloud file selection was cancelled");
    this.name = "CloudPickerCancelled";
  }
}

export function isCloudPickerCancellation(error: unknown): boolean {
  return error instanceof CloudPickerCancelled;
}

export function sanitizeCloudFilename(name: string): string {
  const sanitized = name
    .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 180)
    .trim();
  if (!sanitized) throw new Error("The selected cloud file has no usable filename.");
  return sanitized;
}

export function supportedExtension(name: string): SupportedFileExtension | null {
  const lowerName = name.toLowerCase();
  return (Object.keys(SUPPORTED_FILE_MIME_TYPES) as SupportedFileExtension[])
    .find((extension) => lowerName.endsWith(extension)) || null;
}

function quoted(name: string): string {
  let safeName = "Selected file";
  try {
    safeName = sanitizeCloudFilename(name);
  } catch {
    // Keep a generic label when provider metadata has no safe title.
  }
  return `\u201c${safeName}\u201d`;
}

export function assertSelectionFits(selectedCount: number, incomingCount: number, maxFiles: number): void {
  const remaining = Math.max(0, maxFiles - selectedCount);
  if (incomingCount > remaining) {
    throw new Error(`Only ${remaining} more ${remaining === 1 ? "file" : "files"} can be added.`);
  }
}

export function validateCloudItemMetadata(
  item: CloudSelectedItem,
  options: { allowGoogleDocument?: boolean } = {}
): { safeName: string; extension: SupportedFileExtension | null } {
  const safeName = sanitizeCloudFilename(item.name);
  const isGoogleDocument = options.allowGoogleDocument && item.mimeType === GOOGLE_NATIVE_DOCUMENT_MIME;
  const extension = supportedExtension(safeName);

  if (!isGoogleDocument && !extension) {
    throw new Error(`${quoted(safeName)} is not supported. Choose PDF, DOCX, or TXT.`);
  }
  if (!isGoogleDocument && item.mimeType && extension && item.mimeType !== SUPPORTED_FILE_MIME_TYPES[extension]) {
    throw new Error(`${quoted(safeName)} is not supported. Choose PDF, DOCX, or TXT.`);
  }
  if (typeof item.size === "number" && item.size > MAX_CLOUD_FILE_SIZE_BYTES) {
    throw new Error(`${quoted(safeName)} exceeds the 10 MB file limit.`);
  }
  if (!isGoogleDocument && item.size === 0) {
    throw new Error(`${quoted(safeName)} is empty.`);
  }
  return { safeName, extension };
}

export function googleDocumentFilename(name: string): string {
  const safeName = sanitizeCloudFilename(name);
  return safeName.toLowerCase().endsWith(".docx") ? safeName : `${safeName}.docx`;
}

export function stableCloudLastModified(provider: CloudProvider, providerItemId: string): number {
  const source = `${provider}:${providerItemId}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return 1_600_000_000_000 + (hash >>> 0);
}

export function cloudBlobToFile({
  blob,
  name,
  mimeType,
  provider,
  providerItemId,
}: {
  blob: Blob;
  name: string;
  mimeType: string;
  provider: CloudProvider;
  providerItemId: string;
}): File {
  const safeName = sanitizeCloudFilename(name);
  if (blob.size === 0) throw new Error(`${quoted(safeName)} is empty.`);
  if (blob.size > MAX_CLOUD_FILE_SIZE_BYTES) {
    throw new Error(`${quoted(safeName)} exceeds the 10 MB file limit.`);
  }
  return new File([blob], safeName, {
    type: mimeType,
    lastModified: stableCloudLastModified(provider, providerItemId),
  });
}

export function cloudDownloadFailure(provider: "Google Drive" | "Dropbox", name: string): string {
  return `${quoted(name)} could not be downloaded from ${provider}.`;
}
