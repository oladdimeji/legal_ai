import { createHash, randomBytes } from "node:crypto";
import type { GoogleDriveProvider, ProviderHealth } from "./contracts.js";

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
] as const;

export const GOOGLE_DRIVE_MIME_TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const REVOCATION_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

export type GoogleTokenResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
  scopes: string[];
};

export type GoogleIdentity = {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
};

export class GoogleProviderError extends Error {
  constructor(
    public readonly code: "unauthorized" | "permission_restricted" | "not_found" | "rate_limited" | "unavailable" | "invalid_response",
    message: string,
  ) {
    super(message);
  }
}

type GoogleProviderOptions = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
};

function parseTokenResponse(payload: unknown): GoogleTokenResponse {
  const value = payload as Record<string, unknown>;
  if (typeof value.access_token !== "string" || !value.access_token) {
    throw new GoogleProviderError("invalid_response", "Google did not return a usable access token.");
  }
  const expiresIn = Number(value.expires_in);
  return {
    accessToken: value.access_token,
    refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : undefined,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
    tokenType: typeof value.token_type === "string" ? value.token_type : "Bearer",
    scopes: typeof value.scope === "string" ? value.scope.split(/\s+/).filter(Boolean) : [...GOOGLE_OAUTH_SCOPES],
  };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new GoogleProviderError("invalid_response", "Google returned an invalid response.");
  }
}

function driveError(response: Response): GoogleProviderError {
  if (response.status === 401) return new GoogleProviderError("unauthorized", "Google authorization has expired.");
  if (response.status === 403) return new GoogleProviderError("permission_restricted", "Google Drive permission is restricted.");
  if (response.status === 404) return new GoogleProviderError("not_found", "Google Drive file is unavailable.");
  if (response.status === 429) return new GoogleProviderError("rate_limited", "Google Drive is temporarily rate limited.");
  return new GoogleProviderError("unavailable", "Google Drive is temporarily unavailable.");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function assertGoogleScopes(scopes: string[]): void {
  const normalized = new Set(scopes);
  if (GOOGLE_OAUTH_SCOPES.some((scope) => !normalized.has(scope))) {
    throw new GoogleProviderError("unauthorized", "Required Google permissions were not granted.");
  }
  if (scopes.some((scope) => /gmail/i.test(scope))) {
    throw new GoogleProviderError("unauthorized", "Unexpected Google permissions were returned.");
  }
}

export class GoogleOAuthDriveProvider implements GoogleDriveProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GoogleProviderOptions) {
    this.fetchImpl = options.fetchImpl || fetch;
  }

  authorizationUrl(state: string, codeChallenge: string): string {
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      response_type: "code",
      scope: GOOGLE_OAUTH_SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<GoogleTokenResponse> {
    const response = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        redirect_uri: this.options.redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }),
    });
    if (!response.ok) throw new GoogleProviderError("unauthorized", "Google authorization could not be completed.");
    const tokens = parseTokenResponse(await safeJson(response));
    assertGoogleScopes(tokens.scopes);
    return tokens;
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
    const response = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) throw new GoogleProviderError("unauthorized", "Google authorization has been revoked.");
    const tokens = parseTokenResponse(await safeJson(response));
    assertGoogleScopes(tokens.scopes);
    return tokens;
  }

  async getIdentity(accessToken: string): Promise<GoogleIdentity> {
    const response = await this.fetchImpl(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw driveError(response);
    const value = await safeJson(response) as Record<string, unknown>;
    if (typeof value.sub !== "string" || typeof value.email !== "string") {
      throw new GoogleProviderError("invalid_response", "Google identity could not be verified.");
    }
    return {
      subject: value.sub,
      email: value.email,
      emailVerified: value.email_verified === true,
      name: typeof value.name === "string" ? value.name : null,
    };
  }

  async revoke(token: string): Promise<boolean> {
    const response = await this.fetchImpl(REVOCATION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    return response.ok;
  }

  async health(): Promise<ProviderHealth> {
    return { status: "ready" };
  }

  async createFile(
    name: string,
    content: Uint8Array,
    contentType: string,
    accessToken: string,
  ): Promise<{ id: string; webViewLink: string | null; modifiedTime: string | null; revisionId: string | null; checksum: string | null }> {
    const boundary = `exepts_${randomBytes(18).toString("hex")}`;
    const metadata = Buffer.from(JSON.stringify({ name }), "utf8");
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
      metadata,
      Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
      Buffer.from(content),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const fields = "id,webViewLink,modifiedTime,headRevisionId,md5Checksum";
    const response = await this.fetchImpl(
      `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=${encodeURIComponent(fields)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (!response.ok) throw driveError(response);
    const value = await safeJson(response) as Record<string, unknown>;
    if (typeof value.id !== "string") throw new GoogleProviderError("invalid_response", "Drive export response is invalid.");
    return {
      id: value.id,
      webViewLink: typeof value.webViewLink === "string" ? value.webViewLink : null,
      modifiedTime: typeof value.modifiedTime === "string" ? value.modifiedTime : null,
      revisionId: typeof value.headRevisionId === "string" ? value.headRevisionId : null,
      checksum: typeof value.md5Checksum === "string" ? value.md5Checksum : null,
    };
  }

}
