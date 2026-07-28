export interface PublicBrowserConfig {
  features: {
    publicLanding: boolean;
    govInfo: boolean;
    courtListener: boolean;
    googleAccount: boolean;
    googleDriveExport: boolean;
    googleDriveImport: boolean;
    clientAccounts: boolean;
    clientDashboard: boolean;
    clientNotifications: boolean;
    clientDurableUploads: boolean;
    transactionalEmail: boolean;
    firmTeams: boolean;
    privateStorage: boolean;
    resourceLifecycle: boolean;
  };
}

export const disabledPublicBrowserConfig: PublicBrowserConfig = {
  features: {
    publicLanding: false,
    govInfo: false,
    courtListener: false,
    googleAccount: false,
    googleDriveExport: false,
    googleDriveImport: false,
    clientAccounts: false,
    clientDashboard: false,
    clientNotifications: false,
    clientDurableUploads: false,
    transactionalEmail: false,
    firmTeams: false,
    privateStorage: false,
    resourceLifecycle: false,
  },
};
