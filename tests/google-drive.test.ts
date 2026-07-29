import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadServerConfig } from "../server/config.js";
import { assertGoogleLinkAllowed } from "../server/googleAuthorization.js";
import { decryptProviderSecret, encryptProviderSecret } from "../server/providerTokens.js";
import {
  GOOGLE_DRIVE_MIME_TYPES,
  GOOGLE_OAUTH_SCOPES,
  GoogleOAuthDriveProvider,
  createPkcePair,
} from "../server/providers/google.js";

const encryptionKey = Buffer.alloc(32, 9).toString("base64");

test("Google activates only from the complete account and Drive-export credential set", () => {
  const configured = loadServerConfig({
    NODE_ENV: "test",
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    GOOGLE_OAUTH_REDIRECT_URI: "https://exepts.example/api/auth/google/callback",
    APP_ENCRYPTION_KEY_BASE64: encryptionKey,
  });
  assert.equal(configured.integrations.google.status, "configured");
  assert.deepEqual(configured.integrations.google.capabilities, ["account", "drive_export"]);
  assert.throws(
    () => loadServerConfig({ NODE_ENV: "test", GOOGLE_CLIENT_ID: "client-id" }),
    /GOOGLE_CLIENT_SECRET/,
  );
});

test("Google OAuth uses PKCE, excludes Gmail, and provider tokens encrypt round-trip", () => {
  const provider = new GoogleOAuthDriveProvider({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://exepts.example/api/auth/google/callback",
  });
  const pkce = createPkcePair();
  assert.ok(pkce.verifier.length > 40);
  const authorization = new URL(provider.authorizationUrl("state", pkce.challenge));
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.deepEqual(authorization.searchParams.get("scope")?.split(" "), [...GOOGLE_OAUTH_SCOPES]);
  assert.doesNotMatch(authorization.toString(), /gmail/i);
  const encrypted = encryptProviderSecret("refresh-token", encryptionKey);
  assert.notEqual(encrypted, "refresh-token");
  assert.equal(decryptProviderSecret(encrypted, encryptionKey), "refresh-token");
});

test("Google account linking rejects cross-user and cross-firm conflicts", () => {
  assert.throws(() => assertGoogleLinkAllowed(
    { user_id: "other-user", firm_id: "firm-a" },
    undefined,
    { userId: "user-a", firmId: "firm-a" },
    "subject",
  ), /google_connection_conflict/);
  assert.throws(() => assertGoogleLinkAllowed(
    { user_id: "user-a", firm_id: "firm-b" },
    undefined,
    { userId: "user-a", firmId: "firm-a" },
    "subject",
  ), /google_connection_conflict/);
  assert.doesNotThrow(() => assertGoogleLinkAllowed(
    { user_id: "user-a", firm_id: "firm-a" },
    { provider_subject: "subject" },
    { userId: "user-a", firmId: "firm-a" },
    "subject",
  ));
});

test("Drive export uploads DOCX bytes and import APIs are absent", async () => {
  let requestUrl = "";
  let requestBody = "";
  const provider = new GoogleOAuthDriveProvider({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://exepts.example/api/auth/google/callback",
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestBody = Buffer.from(init?.body as Uint8Array).toString("utf8");
      return new Response(JSON.stringify({
        id: "drive-file",
        webViewLink: "https://drive.google.com/file/d/drive-file/view",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await provider.createFile(
    "Work Product.docx",
    new TextEncoder().encode("docx bytes"),
    GOOGLE_DRIVE_MIME_TYPES.docx,
    "access-token",
  );
  assert.equal(result.id, "drive-file");
  assert.match(requestUrl, /upload\/drive\/v3\/files/);
  assert.match(requestBody, /Work Product\.docx/);
  assert.match(requestBody, /docx bytes/);

  const [server, providerSource] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("server/providers/google.ts", "utf8"),
  ]);
  assert.doesNotMatch(server, /picker-session|drive\/imports|drive\/import/);
  assert.doesNotMatch(providerSource, /downloadFile|getFileMetadata|google-apps\.document/);
});
