import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadServerConfig } from "../server/config.js";
import { assertGoogleLinkAllowed, isDriveImportAccessible } from "../server/googleAuthorization.js";
import { decryptProviderSecret, encryptProviderSecret } from "../server/providerTokens.js";
import {
  GOOGLE_DRIVE_MIME_TYPES,
  GOOGLE_OAUTH_SCOPES,
  GoogleOAuthDriveProvider,
  GoogleProviderError,
  createPkcePair,
  determineDriveSyncState,
} from "../server/providers/google.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Google OAuth uses PKCE and requests only the approved V1 scopes", () => {
  const provider = new GoogleOAuthDriveProvider({
    clientId: "client",
    clientSecret: "server-secret",
    redirectUri: "https://staging.example/api/auth/google/callback",
    fetchImpl: async () => jsonResponse({}),
  });
  const pkce = createPkcePair();
  assert.notEqual(pkce.verifier, pkce.challenge);
  assert.ok(pkce.verifier.length >= 43);
  const url = new URL(provider.authorizationUrl("state-value", pkce.challenge));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("redirect_uri"), "https://staging.example/api/auth/google/callback");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("code_challenge"), pkce.challenge);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.deepEqual(url.searchParams.get("scope")?.split(" "), [...GOOGLE_OAUTH_SCOPES]);
  assert.doesNotMatch(url.toString(), /gmail/i);
  assert.equal(url.searchParams.get("include_granted_scopes"), "false");
});

test("refresh tokens are authenticated-encrypted and tampering is rejected", () => {
  const key = Buffer.alloc(32, 9).toString("base64");
  const encrypted = encryptProviderSecret("refresh-token-fixture", key);
  assert.doesNotMatch(encrypted, /refresh-token-fixture/);
  assert.equal(decryptProviderSecret(encrypted, key), "refresh-token-fixture");
  const parts = encrypted.split(".");
  parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith("a") ? "b" : "a"}`;
  assert.throws(() => decryptProviderSecret(parts.join("."), key), /unavailable/i);
});

test("Google linking conflicts and Drive imports deny cross-user, cross-firm, and cross-Matter substitution", () => {
  const context = { userId: "user-1", firmId: "firm-1" };
  assert.doesNotThrow(() => assertGoogleLinkAllowed(
    { user_id: "user-1", firm_id: "firm-1" },
    { provider_subject: "subject-1" },
    context,
    "subject-1",
  ));
  assert.throws(() => assertGoogleLinkAllowed(
    { user_id: "user-2", firm_id: "firm-2" },
    undefined,
    context,
    "subject-1",
  ), /google_connection_conflict/);
  assert.throws(() => assertGoogleLinkAllowed(
    undefined,
    { provider_subject: "subject-2" },
    context,
    "subject-1",
  ), /google_connection_conflict/);
  const record = { firm_id: "firm-1", user_id: "user-1", case_id: "matter-1" };
  assert.equal(isDriveImportAccessible(record, context, "matter-1"), true);
  assert.equal(isDriveImportAccessible(record, { ...context, userId: "user-2" }, "matter-1"), false);
  assert.equal(isDriveImportAccessible(record, { ...context, firmId: "firm-2" }, "matter-1"), false);
  assert.equal(isDriveImportAccessible(record, context, "matter-2"), false);
});

test("mocked OAuth exchange, identity, refresh, and revocation never require Gmail", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const replies = [
    jsonResponse({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      token_type: "Bearer",
      scope: GOOGLE_OAUTH_SCOPES.join(" "),
    }),
    jsonResponse({ sub: "subject-1", email: "lawyer@example.com", email_verified: true, name: "Lawyer" }),
    jsonResponse({
      access_token: "access-2",
      expires_in: 3600,
      token_type: "Bearer",
      scope: GOOGLE_OAUTH_SCOPES.join(" "),
    }),
    new Response("", { status: 200 }),
  ];
  const provider = new GoogleOAuthDriveProvider({
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://example.test/api/auth/google/callback",
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      return replies.shift()!;
    },
  });
  const exchanged = await provider.exchangeCode("authorization-code", "pkce-verifier");
  assert.equal(exchanged.refreshToken, "refresh-1");
  assert.equal((await provider.getIdentity(exchanged.accessToken)).subject, "subject-1");
  assert.equal((await provider.refreshAccessToken("refresh-1")).accessToken, "access-2");
  assert.equal(await provider.revoke("refresh-1"), true);
  assert.match(String(calls[0].init?.body), /redirect_uri=https%3A%2F%2Fexample\.test/);
  assert.doesNotMatch(JSON.stringify(calls), /gmail/i);
});

test("mocked Drive imports Google Docs as DOCX and exports Work Product bytes", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const provider = new GoogleOAuthDriveProvider({
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://example.test/callback",
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/files/file-1?") && !url.includes("upload")) {
        return jsonResponse({
          id: "file-1",
          name: "Selected memorandum",
          mimeType: GOOGLE_DRIVE_MIME_TYPES.googleDoc,
          webViewLink: "https://drive.google.com/file-1",
          modifiedTime: "2026-07-28T10:00:00.000Z",
          headRevisionId: "revision-1",
          parents: ["folder-1"],
          trashed: false,
        });
      }
      if (url.includes("/export?")) return new Response(Buffer.from("docx-fixture"), { status: 200 });
      return jsonResponse({
        id: "exported-1",
        webViewLink: "https://drive.google.com/exported-1",
        modifiedTime: "2026-07-28T11:00:00.000Z",
        headRevisionId: "revision-export",
        md5Checksum: "md5-export",
      });
    },
  });
  const metadata = await provider.getFileMetadata("file-1", "access");
  const downloaded = await provider.downloadFile(metadata, "access");
  assert.equal(downloaded.filename, "Selected memorandum.docx");
  assert.equal(downloaded.contentType, GOOGLE_DRIVE_MIME_TYPES.docx);
  assert.equal(Buffer.from(downloaded.bytes).toString(), "docx-fixture");
  const exported = await provider.createFile(
    "Work Product.docx",
    Buffer.from("private-work-product-fixture"),
    GOOGLE_DRIVE_MIME_TYPES.docx,
    "access",
  );
  assert.equal(exported.id, "exported-1");
  assert.match(calls[1].url, /\/export\?mimeType=/);
  assert.match(calls[2].url, /uploadType=multipart/);
  assert.equal(calls[2].init?.headers && (calls[2].init.headers as Record<string, string>).Authorization, "Bearer access");
});

test("Drive lifecycle distinguishes current, changed, moved, deleted, and restricted files", async () => {
  const base = {
    id: "file",
    name: "memo.txt",
    mimeType: GOOGLE_DRIVE_MIME_TYPES.text,
    webViewLink: null,
    modifiedTime: "2026-07-28T10:00:00.000Z",
    md5Checksum: "checksum-1",
    headRevisionId: "revision-1",
    parents: ["folder-1"],
    trashed: false,
    size: 10,
  };
  const tracked = {
    importedParentIds: ["folder-1"],
    driveRevisionId: "revision-1",
    driveChecksum: "checksum-1",
    driveModifiedTime: "2026-07-28T10:00:00.000Z",
  };
  assert.equal(determineDriveSyncState(tracked, base), "current");
  assert.equal(determineDriveSyncState(tracked, { ...base, headRevisionId: "revision-2" }), "changed");
  assert.equal(determineDriveSyncState(tracked, { ...base, parents: ["folder-2"] }), "moved");
  assert.equal(determineDriveSyncState(tracked, { ...base, trashed: true }), "deleted");

  const restricted = new GoogleOAuthDriveProvider({
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://example.test/callback",
    fetchImpl: async () => jsonResponse({ error: { code: 403 } }, 403),
  });
  await assert.rejects(
    restricted.getFileMetadata("restricted", "access"),
    (error: unknown) => error instanceof GoogleProviderError && error.code === "permission_restricted",
  );
});

test("Google account and export are independent of ingestion while import remains explicit", () => {
  const key = Buffer.alloc(32, 5).toString("base64");
  const google = {
    NODE_ENV: "test",
    FEATURE_GOOGLE_ACCOUNT: "true",
    FEATURE_GOOGLE_DRIVE_EXPORT: "true",
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_OAUTH_REDIRECT_URI: "https://example.test/api/auth/google/callback",
    APP_ENCRYPTION_KEY_BASE64: key,
  };
  const enabled = loadServerConfig(google);
  assert.equal(enabled.features.googleAccount, true);
  assert.equal(enabled.features.googleDriveExport, true);
  assert.equal(enabled.features.googleDriveImport, false);
  assert.equal(enabled.features.asyncIngestion, false);
  assert.equal(enabled.features.privateStorage, false);
  assert.equal(enabled.features.gmailSend, false);

  assert.throws(() => loadServerConfig({
    ...google,
    FEATURE_GOOGLE_DRIVE_IMPORT: "true",
  }), /GOOGLE_PICKER_API_KEY/);
  const importEnabled = loadServerConfig({
    ...google,
    FEATURE_GOOGLE_DRIVE_IMPORT: "true",
    GOOGLE_PICKER_API_KEY: "restricted-browser-key",
    GOOGLE_CLOUD_PROJECT_ID: "project-id",
    GOOGLE_CLOUD_PROJECT_NUMBER: "123456",
    FEATURE_PRIVATE_STORAGE: "true",
    FEATURE_ASYNC_INGESTION: "true",
    SUPABASE_DB_URL: "postgres://fixture.invalid/db",
    OBJECT_STORAGE_PROVIDER: "supabase",
    SUPABASE_URL: "https://fixture.invalid",
    SUPABASE_SECRET_KEY: "fixture",
    STORAGE_BUCKET: "private",
    JOBS_PROVIDER: "pg-boss",
    MALWARE_SCANNER_PROVIDER: "clamav",
  });
  assert.equal(importEnabled.features.googleDriveImport, true);

  const legacy = loadServerConfig({
    ...google,
    FEATURE_GOOGLE_ACCOUNT: "false",
    FEATURE_GOOGLE_DRIVE_EXPORT: "false",
    FEATURE_GOOGLE_DRIVE: "true",
  });
  assert.equal(legacy.features.googleAccount, true);
  assert.equal(legacy.features.googleDriveExport, true);
  assert.equal(legacy.features.googleDriveImport, false);
});

test("migration and scoped repository cover OAuth conflicts, Drive identity, and firm/user/Matter authorization", async () => {
  const [migrations, database, server, authorization] = await Promise.all([
    readFile("server/migrations.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
    readFile("server.ts", "utf8"),
    readFile("server/googleAuthorization.ts", "utf8"),
  ]);
  assert.match(migrations, /version: 16/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS oauth_connections/);
  assert.match(migrations, /UNIQUE \(provider, provider_subject\)/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS drive_file_imports/);
  assert.match(database, /assertGoogleLinkAllowed/);
  assert.match(authorization, /google_connection_conflict/);
  assert.match(database, /i\.firm_id = \$1 AND i\.user_id = \$2 AND i\.case_id IS NOT DISTINCT FROM \$3/);
  assert.match(database, /c\.id = i\.case_id AND c\.firm_id = \$1/);
  assert.match(server, /app\.post\("\/api\/drafts\/:id\/export\/drive"/);
  assert.match(server, /app\.post\("\/api\/cases\/:caseId\/intelligence\/export\/drive"/);
  assert.match(server, /app\.post\("\/api\/google\/connection\/refresh"/);
  assert.match(server, /config\.features\.googleDriveImport/);
  assert.match(server, /config\.features\.googleDriveExport/);
  assert.doesNotMatch(server, /gmail\.send|gmail\.compose/i);
});

test("disabled Drive import has no active UI and cannot be enabled by the legacy flag", async () => {
  const [app, library, sources, publicConfig] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/components/FirmLibraryView.tsx", "utf8"),
    readFile("src/components/MatterSources.tsx", "utf8"),
    readFile("src/lib/publicConfig.ts", "utf8"),
  ]);
  assert.match(app, /googleDriveImportEnabled=\{featureFlags\.googleDriveImport\}/);
  assert.match(library, /googleDriveImportEnabled && <GoogleDrivePanel/);
  assert.match(sources, /googleDriveImportEnabled \? \["drive"/);
  assert.match(publicConfig, /googleDriveImport: false/);
  const key = Buffer.alloc(32, 6).toString("base64");
  const legacy = loadServerConfig({
    NODE_ENV: "test",
    FEATURE_GOOGLE_DRIVE: "true",
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_OAUTH_REDIRECT_URI: "https://example.test/api/auth/google/callback",
    APP_ENCRYPTION_KEY_BASE64: key,
  });
  assert.equal(legacy.features.googleDriveImport, false);
});

test("environment-gated live Google Drive staging smoke", { skip: process.env.GOOGLE_DRIVE_LIVE_SMOKE !== "true" }, async () => {
  const required = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_DRIVE_SMOKE_REFRESH_TOKEN",
    "GOOGLE_DRIVE_SMOKE_FILE_ID",
  ] as const;
  for (const name of required) assert.ok(process.env[name], `${name} is required for the live smoke test`);
  const provider = new GoogleOAuthDriveProvider({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI!,
  });
  const tokens = await provider.refreshAccessToken(process.env.GOOGLE_DRIVE_SMOKE_REFRESH_TOKEN!);
  const metadata = await provider.getFileMetadata(process.env.GOOGLE_DRIVE_SMOKE_FILE_ID!, tokens.accessToken);
  assert.ok(metadata.id);
  assert.ok(isFinite(metadata.size ?? 0));
});
