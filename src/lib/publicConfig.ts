export type IntegrationStatus = "configured" | "not_configured";

export interface PublicBrowserConfig {
  integrations: {
    govInfo: { status: IntegrationStatus };
    google: {
      status: IntegrationStatus;
      capabilities: readonly ("account" | "drive_export")[];
    };
    transactionalEmail: { status: IntegrationStatus };
  };
}

export const unconfiguredPublicBrowserConfig: PublicBrowserConfig = {
  integrations: {
    govInfo: { status: "not_configured" },
    google: { status: "not_configured", capabilities: [] },
    transactionalEmail: { status: "not_configured" },
  },
};
