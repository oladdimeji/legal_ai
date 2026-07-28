export type RuntimeEnvironment = "development" | "test" | "production";

export interface FeatureFlags {
  publicLanding: boolean;
  asyncIngestion: boolean;
  govInfo: boolean;
  courtListener: boolean;
  googleDrive: boolean;
  gmailSend: boolean;
  ocr: boolean;
  clientAccounts: boolean;
  firmTeams: boolean;
  privateStorage: boolean;
}

export interface ServerConfig {
  environment: RuntimeEnvironment;
  port: number;
  databaseUrl?: string;
  geminiApiKey?: string;
  encryptionKeyBase64?: string;
  features: FeatureFlags;
  providers: {
    objectStorage: {
      provider?: string;
      supabaseUrl?: string;
      supabaseSecretKey?: string;
      bucket?: string;
    };
    jobs: { provider?: string };
    malwareScanning: { provider?: string; host?: string; port: number };
    govInfo: { apiKey?: string; baseUrl: string };
    google: {
      clientId?: string;
      clientSecret?: string;
      oauthRedirectUri?: string;
      pickerApiKey?: string;
      cloudProjectId?: string;
      cloudProjectNumber?: string;
    };
    transactionalEmail: { provider?: string };
    observability: { provider?: string };
  };
}

export interface PublicBrowserConfig {
  features: Pick<
    FeatureFlags,
    "publicLanding" | "govInfo" | "courtListener" | "googleDrive" | "clientAccounts" | "firmTeams" | "privateStorage"
  >;
}

const deferredFlags = [
  "FEATURE_GOVINFO",
  "FEATURE_COURTLISTENER",
  "FEATURE_GMAIL_SEND",
  "FEATURE_OCR",
] as const;

function parseBoolean(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name];
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`${name} must be either true or false.`);
}

function requireWhen(enabled: boolean, env: NodeJS.ProcessEnv, names: readonly string[]): void {
  if (!enabled) return;
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`Enabled feature configuration is incomplete. Missing: ${missing.join(", ")}.`);
  }
}

function validateEncryptionKey(value: string | undefined): void {
  if (!value) return;
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) {
    throw new Error("APP_ENCRYPTION_KEY_BASE64 must be a canonical base64-encoded 32-byte key.");
  }
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const environmentValue = env.NODE_ENV || "development";
  if (!["development", "test", "production"].includes(environmentValue)) {
    throw new Error("NODE_ENV must be development, test, or production.");
  }
  const environment = environmentValue as RuntimeEnvironment;
  const port = env.PORT === undefined || env.PORT === "" ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const features: FeatureFlags = {
    publicLanding: parseBoolean(env, "FEATURE_PUBLIC_LANDING"),
    asyncIngestion: parseBoolean(env, "FEATURE_ASYNC_INGESTION"),
    govInfo: parseBoolean(env, "FEATURE_GOVINFO"),
    courtListener: parseBoolean(env, "FEATURE_COURTLISTENER"),
    googleDrive: parseBoolean(env, "FEATURE_GOOGLE_DRIVE"),
    gmailSend: parseBoolean(env, "FEATURE_GMAIL_SEND"),
    ocr: parseBoolean(env, "FEATURE_OCR"),
    clientAccounts: parseBoolean(env, "FEATURE_CLIENT_ACCOUNTS"),
    firmTeams: parseBoolean(env, "FEATURE_FIRM_TEAMS"),
    privateStorage: parseBoolean(env, "FEATURE_PRIVATE_STORAGE"),
  };

  requireWhen(features.privateStorage, env, [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "STORAGE_BUCKET",
  ]);
  if (features.privateStorage && env.OBJECT_STORAGE_PROVIDER !== "supabase") {
    throw new Error("FEATURE_PRIVATE_STORAGE requires OBJECT_STORAGE_PROVIDER=supabase.");
  }

  requireWhen(features.asyncIngestion, env, [
    "SUPABASE_DB_URL",
    "OBJECT_STORAGE_PROVIDER",
    "JOBS_PROVIDER",
    "MALWARE_SCANNER_PROVIDER",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "STORAGE_BUCKET",
  ]);
  if (features.asyncIngestion && env.OBJECT_STORAGE_PROVIDER !== "supabase") {
    throw new Error("FEATURE_ASYNC_INGESTION requires OBJECT_STORAGE_PROVIDER=supabase.");
  }
  if (features.asyncIngestion && env.JOBS_PROVIDER !== "pg-boss") {
    throw new Error("FEATURE_ASYNC_INGESTION requires JOBS_PROVIDER=pg-boss.");
  }
  if (features.asyncIngestion && env.MALWARE_SCANNER_PROVIDER !== "clamav") {
    throw new Error("FEATURE_ASYNC_INGESTION requires MALWARE_SCANNER_PROVIDER=clamav.");
  }
  requireWhen(features.govInfo, env, ["GOVINFO_API_KEY"]);
  requireWhen(features.googleDrive, env, [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_PICKER_API_KEY",
    "GOOGLE_CLOUD_PROJECT_ID",
    "GOOGLE_CLOUD_PROJECT_NUMBER",
    "APP_ENCRYPTION_KEY_BASE64",
  ]);
  validateEncryptionKey(env.APP_ENCRYPTION_KEY_BASE64);

  for (const flag of deferredFlags) {
    if (parseBoolean(env, flag)) {
      throw new Error(`${flag} is deferred in V1 and must remain false.`);
    }
  }

  return {
    environment,
    port,
    databaseUrl: env.SUPABASE_DB_URL,
    geminiApiKey: env.GEMINI_API_KEY,
    encryptionKeyBase64: env.APP_ENCRYPTION_KEY_BASE64,
    features,
    providers: {
      objectStorage: {
        provider: env.OBJECT_STORAGE_PROVIDER,
        supabaseUrl: env.SUPABASE_URL,
        supabaseSecretKey: env.SUPABASE_SECRET_KEY,
        bucket: env.STORAGE_BUCKET,
      },
      jobs: { provider: env.JOBS_PROVIDER },
      malwareScanning: {
        provider: env.MALWARE_SCANNER_PROVIDER,
        host: env.CLAMAV_HOST,
        port: Number(env.CLAMAV_PORT || 3310),
      },
      govInfo: {
        apiKey: env.GOVINFO_API_KEY,
        baseUrl: env.GOVINFO_BASE_URL || "https://api.govinfo.gov",
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        oauthRedirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
        pickerApiKey: env.GOOGLE_PICKER_API_KEY,
        cloudProjectId: env.GOOGLE_CLOUD_PROJECT_ID,
        cloudProjectNumber: env.GOOGLE_CLOUD_PROJECT_NUMBER,
      },
      transactionalEmail: { provider: env.TRANSACTIONAL_EMAIL_PROVIDER },
      observability: { provider: env.OBSERVABILITY_PROVIDER },
    },
  };
}

export function toPublicBrowserConfig(config: ServerConfig): PublicBrowserConfig {
  const { publicLanding, govInfo, courtListener, googleDrive, clientAccounts, firmTeams, privateStorage } =
    config.features;
  return {
    features: { publicLanding, govInfo, courtListener, googleDrive, clientAccounts, firmTeams, privateStorage },
  };
}
