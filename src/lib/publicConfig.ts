export interface PublicBrowserConfig {
  features: {
    publicLanding: boolean;
    govInfo: boolean;
    courtListener: boolean;
    googleDrive: boolean;
    clientAccounts: boolean;
    firmTeams: boolean;
    privateStorage: boolean;
  };
}

export const disabledPublicBrowserConfig: PublicBrowserConfig = {
  features: {
    publicLanding: false,
    govInfo: false,
    courtListener: false,
    googleDrive: false,
    clientAccounts: false,
    firmTeams: false,
    privateStorage: false,
  },
};
