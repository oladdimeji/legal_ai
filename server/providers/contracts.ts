import type { Citation } from "../../src/types.js";

export interface ProviderHealth {
  status: "ready" | "disabled" | "unavailable";
  detail?: string;
}

export interface ObjectStorageProvider {
  health(): Promise<ProviderHealth>;
  createSignedUpload(key: string): Promise<{ token: string; expiresAt: string }>;
  stat(key: string): Promise<{ size: number; contentType: string | null; metadata: Record<string, string> } | null>;
  createSignedDownload(key: string, expiresInSeconds: number, downloadName: string): Promise<string>;
}

export interface JobsProvider {
  health(): Promise<ProviderHealth>;
  enqueue<T>(name: string, payload: T): Promise<string>;
}

export interface MalwareScanningProvider {
  health(): Promise<ProviderHealth>;
  scan(content: Uint8Array): Promise<"clean" | "infected">;
}

export interface GovInfoProvider {
  health(): Promise<ProviderHealth>;
  query(searchTerm: string): Promise<Citation[]>;
}

export interface GoogleDriveProvider {
  health(): Promise<ProviderHealth>;
  importFile(fileId: string, userId: string): Promise<Uint8Array>;
  exportFile(name: string, content: Uint8Array, userId: string): Promise<string>;
}

export interface TransactionalEmailProvider {
  health(): Promise<ProviderHealth>;
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export interface ObservabilityProvider {
  health(): Promise<ProviderHealth>;
  capture(error: unknown, context?: Record<string, string | number | boolean>): void;
}
