import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_NATIVE_DOCUMENT_MIME,
  GOOGLE_PICKER_MIME_TYPES,
  SUPPORTED_FILE_MIME_TYPES,
  type CloudProviderConfiguration,
} from "./constants";
import {
  CloudPickerCancelled,
  assertSelectionFits,
  cloudBlobToFile,
  cloudDownloadFailure,
  googleDocumentFilename,
  sanitizeCloudFilename,
  validateCloudItemMetadata,
  type CloudFileBatchResult,
  type CloudSelectedItem,
} from "./cloudFileValidation";
import { loadExternalScript } from "./externalScriptLoader";

const GOOGLE_IDENTITY_SCRIPT_ID = "exepts-google-identity-services";
const GOOGLE_API_SCRIPT_ID = "exepts-google-api";
const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const GOOGLE_API_SCRIPT_SRC = "https://apis.google.com/js/api.js";
const GOOGLE_DOCX_MIME = SUPPORTED_FILE_MIME_TYPES[".docx"];

let inMemoryAccessToken = "";
let inMemoryAccessTokenExpiresAt = 0;

export type CloudDownloadProgress = {
  current: number;
  total: number;
};

function browserWindow(): Window {
  if (typeof window === "undefined") throw new Error("Google Drive could not be opened. Try again.");
  return window;
}

export function clearGoogleDriveAccessToken(): void {
  inMemoryAccessToken = "";
  inMemoryAccessTokenExpiresAt = 0;
}

export async function loadGoogleDrivePickerScripts(): Promise<void> {
  const currentWindow = browserWindow();
  await Promise.all([
    loadExternalScript({
      id: GOOGLE_IDENTITY_SCRIPT_ID,
      src: GOOGLE_IDENTITY_SCRIPT_SRC,
      isReady: () => Boolean(currentWindow.google?.accounts?.oauth2),
      failureMessage: "Google Drive could not be opened. Try again.",
    }),
    loadExternalScript({
      id: GOOGLE_API_SCRIPT_ID,
      src: GOOGLE_API_SCRIPT_SRC,
      isReady: () => Boolean(currentWindow.gapi),
      failureMessage: "Google Drive could not be opened. Try again.",
    }),
  ]);

  if (currentWindow.google?.picker) return;
  await new Promise<void>((resolve, reject) => {
    const gapi = currentWindow.gapi;
    if (!gapi) {
      reject(new Error("Google Drive could not be opened. Try again."));
      return;
    }
    gapi.load("picker", {
      callback: resolve,
      onerror: () => reject(new Error("Google Drive could not be opened. Try again.")),
      timeout: 10_000,
      ontimeout: () => reject(new Error("Google Drive could not be opened. Try again.")),
    });
  });
  if (!currentWindow.google?.picker) throw new Error("Google Drive could not be opened. Try again.");
}

export function requestGoogleDriveAccessToken(clientId: string): Promise<string> {
  if (inMemoryAccessToken && Date.now() < inMemoryAccessTokenExpiresAt) {
    return Promise.resolve(inMemoryAccessToken);
  }

  const oauth2 = browserWindow().google?.accounts?.oauth2;
  if (!oauth2) return Promise.reject(new Error("Google Drive could not be opened. Try again."));

  return new Promise<string>((resolve, reject) => {
    const tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      callback: (response) => {
        if (!response.access_token || response.error) {
          clearGoogleDriveAccessToken();
          reject(new Error("Google Drive access was not granted."));
          return;
        }
        inMemoryAccessToken = response.access_token;
        const lifetimeSeconds = Math.max(60, Number(response.expires_in) || 3600);
        inMemoryAccessTokenExpiresAt = Date.now() + Math.max(0, lifetimeSeconds - 60) * 1000;
        resolve(inMemoryAccessToken);
      },
      error_callback: (error) => {
        clearGoogleDriveAccessToken();
        if (error.type === "popup_closed") {
          reject(new CloudPickerCancelled());
          return;
        }
        reject(new Error("Google Drive access was not granted."));
      },
    });
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

function pickerValue(document: GooglePickerResponse, key: string): unknown {
  return document[key];
}

export function pickGoogleDriveItems(
  configuration: NonNullable<CloudProviderConfiguration["googleDrive"]>,
  accessToken: string
): Promise<CloudSelectedItem[]> {
  const currentWindow = browserWindow();
  const google = currentWindow.google;
  if (!google?.picker) return Promise.reject(new Error("Google Drive could not be opened. Try again."));

  return new Promise<CloudSelectedItem[]>((resolve, reject) => {
    try {
      const picker = google.picker;
      const view = new picker.DocsView(picker.ViewId.DOCS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false)
        .setMimeTypes(GOOGLE_PICKER_MIME_TYPES.join(","));
      let builder = new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken)
        .setDeveloperKey(configuration.apiKey)
        .setAppId(configuration.appId)
        .enableFeature(picker.Feature.MULTISELECT_ENABLED)
        .setCallback((response) => {
          const action = response[picker.Response.ACTION];
          if (action === picker.Action.CANCEL) {
            reject(new CloudPickerCancelled());
            return;
          }
          if (action !== picker.Action.PICKED) return;
          const documents = response[picker.Response.DOCUMENTS];
          const selected = Array.isArray(documents) ? documents as GooglePickerResponse[] : [];
          resolve(selected.map((document) => {
            const rawSize = pickerValue(document, picker.Document.SIZE_BYTES);
            const parsedSize = typeof rawSize === "number" ? rawSize : Number(rawSize);
            return {
              id: String(pickerValue(document, picker.Document.ID) || ""),
              name: String(pickerValue(document, picker.Document.NAME) || ""),
              mimeType: String(pickerValue(document, picker.Document.MIME_TYPE) || ""),
              ...(Number.isFinite(parsedSize) ? { size: parsedSize } : {}),
            };
          }));
        });
      if (builder.setOrigin) builder = builder.setOrigin(currentWindow.location.origin);
      builder.build().setVisible(true);
    } catch {
      reject(new Error("Google Drive could not be opened. Try again."));
    }
  });
}

function googleDownloadUrl(item: CloudSelectedItem): string {
  const encodedId = encodeURIComponent(item.id);
  if (item.mimeType === GOOGLE_NATIVE_DOCUMENT_MIME) {
    return `https://www.googleapis.com/drive/v3/files/${encodedId}/export?mimeType=${encodeURIComponent(GOOGLE_DOCX_MIME)}`;
  }
  return `https://www.googleapis.com/drive/v3/files/${encodedId}?alt=media`;
}

export async function downloadGoogleDriveItem(
  item: CloudSelectedItem,
  accessToken: string,
  fetchImplementation: typeof fetch = fetch
): Promise<File> {
  const isGoogleDocument = item.mimeType === GOOGLE_NATIVE_DOCUMENT_MIME;
  const { safeName, extension } = validateCloudItemMetadata(item, { allowGoogleDocument: true });
  if (!item.id) throw new Error(cloudDownloadFailure("Google Drive", safeName));
  const outputName = isGoogleDocument ? googleDocumentFilename(safeName) : safeName;
  const outputMimeType = isGoogleDocument ? GOOGLE_DOCX_MIME : extension ? SUPPORTED_FILE_MIME_TYPES[extension] : "";

  let response: Response;
  try {
    response = await fetchImplementation(googleDownloadUrl(item), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new Error(cloudDownloadFailure("Google Drive", safeName));
  }
  if (!response.ok) {
    clearGoogleDriveAccessToken();
    throw new Error(cloudDownloadFailure("Google Drive", safeName));
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    throw new Error(cloudDownloadFailure("Google Drive", safeName));
  }
  return cloudBlobToFile({
    blob,
    name: outputName,
    mimeType: outputMimeType,
    provider: "google-drive",
    providerItemId: item.id,
  });
}

export async function downloadGoogleDriveItems(
  items: CloudSelectedItem[],
  accessToken: string,
  options: {
    maxFiles: number;
    selectedCount: number;
    onProgress?: (progress: CloudDownloadProgress) => void;
    fetchImplementation?: typeof fetch;
  }
): Promise<CloudFileBatchResult> {
  assertSelectionFits(options.selectedCount, items.length, options.maxFiles);
  const files: File[] = [];
  const failures: CloudFileBatchResult["failures"] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    options.onProgress?.({ current: index + 1, total: items.length });
    try {
      files.push(await downloadGoogleDriveItem(item, accessToken, options.fetchImplementation));
    } catch (error) {
      const fallbackName = (() => {
        try { return sanitizeCloudFilename(item.name); } catch { return "Selected file"; }
      })();
      failures.push({
        name: fallbackName,
        error: error instanceof Error ? error.message : cloudDownloadFailure("Google Drive", fallbackName),
      });
    }
  }
  return { files, failures };
}

export async function chooseGoogleDriveFiles({
  configuration,
  maxFiles,
  selectedCount,
  onProgress,
}: {
  configuration: NonNullable<CloudProviderConfiguration["googleDrive"]>;
  maxFiles: number;
  selectedCount: number;
  onProgress?: (progress: CloudDownloadProgress) => void;
}): Promise<CloudFileBatchResult> {
  await loadGoogleDrivePickerScripts();
  const accessToken = await requestGoogleDriveAccessToken(configuration.clientId);
  const items = await pickGoogleDriveItems(configuration, accessToken);
  return downloadGoogleDriveItems(items, accessToken, { maxFiles, selectedCount, onProgress });
}
