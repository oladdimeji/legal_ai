import type { Citation } from "../../src/types.js";

export interface ProviderHealth {
  status: "ready" | "disabled" | "unavailable";
  detail?: string;
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
