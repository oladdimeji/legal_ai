import { MAX_CLOUD_FILE_SIZE_BYTES, SUPPORTED_FILE_MIME_TYPES, type CloudProviderConfiguration } from "./constants";
import {
  CloudPickerCancelled,
  assertSelectionFits,
  cloudBlobToFile,
  cloudDownloadFailure,
  sanitizeCloudFilename,
  validateCloudItemMetadata,
  type CloudFileBatchResult,
  type CloudSelectedItem,
} from "./cloudFileValidation";
import { loadExternalScript } from "./externalScriptLoader";
import type { CloudDownloadProgress } from "./googleDrivePicker";

const DROPBOX_SCRIPT_ID = "dropboxjs";
const DROPBOX_SCRIPT_SRC = "https://www.dropbox.com/static/api/2/dropins.js";

export type DropboxSelectedItem = CloudSelectedItem & { directLink: string };

function browserWindow(): Window {
  if (typeof window === "undefined") throw new Error("Dropbox could not be opened in this browser.");
  return window;
}

export async function loadDropboxChooser(appKey: string): Promise<void> {
  const currentWindow = browserWindow();
  await loadExternalScript({
    id: DROPBOX_SCRIPT_ID,
    src: DROPBOX_SCRIPT_SRC,
    attributes: { "data-app-key": appKey },
    isReady: () => Boolean(currentWindow.Dropbox?.choose),
    failureMessage: "Dropbox could not be opened in this browser.",
  });
}

export function pickDropboxItems(): Promise<DropboxSelectedItem[]> {
  const chooser = browserWindow().Dropbox;
  if (!chooser?.choose || chooser.isBrowserSupported?.() === false) {
    return Promise.reject(new Error("Dropbox could not be opened in this browser."));
  }
  return new Promise<DropboxSelectedItem[]>((resolve, reject) => {
    try {
      chooser.choose({
        success: (files) => resolve(files.map((file) => ({
          id: file.id,
          name: file.name,
          directLink: file.link,
          ...(typeof file.bytes === "number" ? { size: file.bytes } : {}),
        }))),
        cancel: () => reject(new CloudPickerCancelled()),
        linkType: "direct",
        multiselect: true,
        extensions: [".pdf", ".docx", ".txt"],
        folderselect: false,
        sizeLimit: MAX_CLOUD_FILE_SIZE_BYTES,
      });
    } catch {
      reject(new Error("Dropbox could not be opened in this browser."));
    }
  });
}

export async function downloadDropboxItem(
  item: DropboxSelectedItem,
  fetchImplementation: typeof fetch = fetch
): Promise<File> {
  const { safeName, extension } = validateCloudItemMetadata(item);
  if (!extension || !item.id || !item.directLink) throw new Error(cloudDownloadFailure("Dropbox", safeName));

  let response: Response;
  try {
    response = await fetchImplementation(item.directLink);
  } catch {
    throw new Error(cloudDownloadFailure("Dropbox", safeName));
  }
  if (!response.ok) throw new Error(cloudDownloadFailure("Dropbox", safeName));

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    throw new Error(cloudDownloadFailure("Dropbox", safeName));
  }
  return cloudBlobToFile({
    blob,
    name: safeName,
    mimeType: SUPPORTED_FILE_MIME_TYPES[extension],
    provider: "dropbox",
    providerItemId: item.id,
  });
}

export async function downloadDropboxItems(
  items: DropboxSelectedItem[],
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
      files.push(await downloadDropboxItem(item, options.fetchImplementation));
    } catch (error) {
      const fallbackName = (() => {
        try { return sanitizeCloudFilename(item.name); } catch { return "Selected file"; }
      })();
      failures.push({
        name: fallbackName,
        error: error instanceof Error ? error.message : cloudDownloadFailure("Dropbox", fallbackName),
      });
    }
  }
  return { files, failures };
}

export async function chooseDropboxFiles({
  configuration,
  maxFiles,
  selectedCount,
  onProgress,
}: {
  configuration: NonNullable<CloudProviderConfiguration["dropbox"]>;
  maxFiles: number;
  selectedCount: number;
  onProgress?: (progress: CloudDownloadProgress) => void;
}): Promise<CloudFileBatchResult> {
  await loadDropboxChooser(configuration.appKey);
  const items = await pickDropboxItems();
  return downloadDropboxItems(items, { maxFiles, selectedCount, onProgress });
}
