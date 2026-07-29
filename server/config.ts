export type RuntimeEnvironment = "development" | "test" | "production";
export type IntegrationStatus = "configured" | "not_configured";

export interface ServerConfig {
  environment: RuntimeEnvironment;
  port: number;
  databaseUrl?: string;
  geminiApiKey?: string;
  encryptionKeyBase64?: string;
  appBaseUrl?: string;
  integrations: {
    govInfo: { status: IntegrationStatus; configured: boolean };
    google: { status: IntegrationStatus; configured: boolean; capabilities: readonly ["account", "drive_export"] | readonly [] };
    transactionalEmail: { status: IntegrationStatus; configured: boolean };
  };
  providers: {
    govInfo: { apiKey?: string; baseUrl: string };
    google: {
      clientId?: string;
      clientSecret?: string;
      oauthRedirectUri?: string;
    };
    transactionalEmail: {
      apiKey?: string;
      senderEmail?: string;
      senderName?: string;
      apiBaseUrl?: string;
    };
  };
}

export interface PublicBrowserConfig {
  integrations: {
    govInfo: { status: IntegrationStatus };
    google: {
      status: IntegrationStatus;
      capabilities: readonly ["account", "drive_export"] | readonly [];
    };
    transactionalEmail: { status: IntegrationStatus };
  };
}

function supplied(env: NodeJS.ProcessEnv, name: string): boolean {
  return Boolean(env[name]?.trim());
}

function requireCompleteGroup(
  env: NodeJS.ProcessEnv,
  label: string,
  names: readonly string[],
): boolean {
  const present = names.filter((name) => supplied(env, name));
  if (present.length === 0) return false;
  const missing = names.filter((name) => !supplied(env, name));
  if (missing.length) {
    throw new Error(`${label} configuration is incomplete. Missing: ${missing.join(", ")}.`);
  }
  return true;
}

function validateEncryptionKey(value: string | undefined): void {
  if (!value) return;
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) {
    throw new Error("APP_ENCRYPTION_KEY_BASE64 must be a canonical base64-encoded 32-byte key.");
  }
}

function validateUrl(name: string, value: string | undefined, protocols: readonly string[]): void {
  if (!value) return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(" or ")}.`);
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

  if (environment === "production") {
    const missing = ["SUPABASE_DB_URL", "GEMINI_API_KEY", "APP_BASE_URL"]
      .filter((name) => !supplied(env, name));
    if (missing.length) {
      throw new Error(`Required application configuration is incomplete. Missing: ${missing.join(", ")}.`);
    }
  }

  validateUrl("SUPABASE_DB_URL", env.SUPABASE_DB_URL, ["postgres:", "postgresql:"]);
  validateUrl("APP_BASE_URL", env.APP_BASE_URL, ["http:", "https:"]);
  validateUrl("GOVINFO_BASE_URL", env.GOVINFO_BASE_URL, ["https:"]);
  validateUrl("GOOGLE_OAUTH_REDIRECT_URI", env.GOOGLE_OAUTH_REDIRECT_URI, ["http:", "https:"]);
  validateUrl("BREVO_API_BASE_URL", env.BREVO_API_BASE_URL, ["https:"]);
  validateEncryptionKey(env.APP_ENCRYPTION_KEY_BASE64);

  const govInfoConfigured = supplied(env, "GOVINFO_API_KEY");
  const googleConfigured = requireCompleteGroup(env, "Google", [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "APP_ENCRYPTION_KEY_BASE64",
  ]);
  const transactionalEmailConfigured = requireCompleteGroup(env, "Brevo transactional email", [
    "BREVO_API_KEY",
    "BREVO_SENDER_EMAIL",
    "BREVO_SENDER_NAME",
    "BREVO_API_BASE_URL",
    "APP_BASE_URL",
  ]);
  return {
    environment,
    port,
    databaseUrl: env.SUPABASE_DB_URL,
    geminiApiKey: env.GEMINI_API_KEY,
    encryptionKeyBase64: env.APP_ENCRYPTION_KEY_BASE64,
    appBaseUrl: env.APP_BASE_URL,
    integrations: {
      govInfo: {
        status: govInfoConfigured ? "configured" : "not_configured",
        configured: govInfoConfigured,
      },
      google: {
        status: googleConfigured ? "configured" : "not_configured",
        configured: googleConfigured,
        capabilities: googleConfigured ? ["account", "drive_export"] : [],
      },
      transactionalEmail: {
        status: transactionalEmailConfigured ? "configured" : "not_configured",
        configured: transactionalEmailConfigured,
      },
    },
    providers: {
      govInfo: {
        apiKey: env.GOVINFO_API_KEY,
        baseUrl: env.GOVINFO_BASE_URL || "https://api.govinfo.gov",
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        oauthRedirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
      },
      transactionalEmail: {
        apiKey: env.BREVO_API_KEY,
        senderEmail: env.BREVO_SENDER_EMAIL,
        senderName: env.BREVO_SENDER_NAME,
        apiBaseUrl: env.BREVO_API_BASE_URL,
      },
    },
  };
}

export function toPublicBrowserConfig(config: ServerConfig): PublicBrowserConfig {
  return {
    integrations: {
      govInfo: { status: config.integrations.govInfo.status },
      google: {
        status: config.integrations.google.status,
        capabilities: config.integrations.google.capabilities,
      },
      transactionalEmail: { status: config.integrations.transactionalEmail.status },
    },
  };
}
