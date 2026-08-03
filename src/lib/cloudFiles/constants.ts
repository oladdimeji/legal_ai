export const MAX_CLOUD_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_NATIVE_DOCUMENT_MIME = "application/vnd.google-apps.document";
export const GOOGLE_PICKER_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  GOOGLE_NATIVE_DOCUMENT_MIME,
] as const;

export const SUPPORTED_FILE_MIME_TYPES = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
} as const;

export type SupportedFileExtension = keyof typeof SUPPORTED_FILE_MIME_TYPES;

export type CloudProviderConfiguration = {
  googleDrive?: {
    clientId: string;
    apiKey: string;
    appId: string;
  };
  dropbox?: {
    appKey: string;
  };
};

type PickerEnvironment = Partial<Pick<
  ImportMetaEnv,
  | "VITE_GOOGLE_DRIVE_CLIENT_ID"
  | "VITE_GOOGLE_DRIVE_API_KEY"
  | "VITE_GOOGLE_DRIVE_APP_ID"
  | "VITE_DROPBOX_APP_KEY"
>>;

function configuredValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readCloudProviderConfiguration(
  environment: PickerEnvironment = (import.meta as ImportMeta & { env?: PickerEnvironment }).env || {}
): CloudProviderConfiguration {
  const clientId = configuredValue(environment.VITE_GOOGLE_DRIVE_CLIENT_ID);
  const apiKey = configuredValue(environment.VITE_GOOGLE_DRIVE_API_KEY);
  const appId = configuredValue(environment.VITE_GOOGLE_DRIVE_APP_ID);
  const appKey = configuredValue(environment.VITE_DROPBOX_APP_KEY);

  return {
    ...(clientId && apiKey && appId ? { googleDrive: { clientId, apiKey, appId } } : {}),
    ...(appKey ? { dropbox: { appKey } } : {}),
  };
}

export function cloudProviderAvailability(environment: PickerEnvironment = {}): {
  googleDrive: boolean;
  dropbox: boolean;
} {
  const configuration = readCloudProviderConfiguration(environment);
  return {
    googleDrive: Boolean(configuration.googleDrive),
    dropbox: Boolean(configuration.dropbox),
  };
}
