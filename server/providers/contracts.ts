import type { Citation } from "../../src/types.js";

export interface ProviderHealth {
  status: "ready" | "disabled" | "unavailable";
  detail?: string;
}

export interface ObjectStorageProvider {
  health(): Promise<ProviderHealth>;
  createSignedUpload(key: string): Promise<{ token: string; expiresAt: string }>;
  upload(key: string, content: Uint8Array, contentType: string, metadata?: Record<string, string>): Promise<void>;
  stat(key: string): Promise<{ size: number; contentType: string | null; metadata: Record<string, string> } | null>;
  download(key: string): Promise<Uint8Array>;
  remove(keys: string[]): Promise<void>;
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
  authorizationUrl(state: string, codeChallenge: string): string;
  exchangeCode(code: string, codeVerifier: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    tokenType: string;
    scopes: string[];
  }>;
  refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    tokenType: string;
    scopes: string[];
  }>;
  getIdentity(accessToken: string): Promise<{
    subject: string;
    email: string;
    emailVerified: boolean;
    name: string | null;
  }>;
  revoke(token: string): Promise<boolean>;
  getFileMetadata(fileId: string, accessToken: string): Promise<{
    id: string;
    name: string;
    mimeType: string;
    webViewLink: string | null;
    modifiedTime: string | null;
    md5Checksum: string | null;
    headRevisionId: string | null;
    parents: string[];
    trashed: boolean;
    size: number | null;
  }>;
  downloadFile(
    metadata: {
      id: string;
      name: string;
      mimeType: string;
      webViewLink: string | null;
      modifiedTime: string | null;
      md5Checksum: string | null;
      headRevisionId: string | null;
      parents: string[];
      trashed: boolean;
      size: number | null;
    },
    accessToken: string,
  ): Promise<{ bytes: Uint8Array; filename: string; contentType: string }>;
  createFile(
    name: string,
    content: Uint8Array,
    contentType: string,
    accessToken: string,
  ): Promise<{
    id: string;
    webViewLink: string | null;
    modifiedTime: string | null;
    revisionId: string | null;
    checksum: string | null;
  }>;
}

export interface TransactionalEmailProvider {
  health(): Promise<ProviderHealth>;
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export interface ObservabilityProvider {
  health(): Promise<ProviderHealth>;
  capture(error: unknown, context?: Record<string, string | number | boolean>): void;
}
