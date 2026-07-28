export interface PublicBrowserConfig {
  features: {
    publicLanding: boolean;
    govInfo: boolean;
    courtListener: boolean;
    googleAccount: boolean;
    googleDriveExport: boolean;
    googleDriveImport: boolean;
    clientAccounts: boolean;
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
    firmTeams: false,
    privateStorage: false,
    resourceLifecycle: false,
  },
};
