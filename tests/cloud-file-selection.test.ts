import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { appendUniqueFiles } from "../src/hooks/useCumulativeFileSelection.js";
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_NATIVE_DOCUMENT_MIME,
  GOOGLE_PICKER_MIME_TYPES,
  MAX_CLOUD_FILE_SIZE_BYTES,
  SUPPORTED_FILE_MIME_TYPES,
  cloudProviderAvailability,
} from "../src/lib/cloudFiles/constants.js";
import {
  stableCloudLastModified,
  validateCloudItemMetadata,
} from "../src/lib/cloudFiles/cloudFileValidation.js";
import {
  downloadGoogleDriveItem,
  downloadGoogleDriveItems,
  clearGoogleDriveAccessToken,
  pickGoogleDriveItems,
  requestGoogleDriveAccessToken,
} from "../src/lib/cloudFiles/googleDrivePicker.js";
import {
  downloadDropboxItem,
  downloadDropboxItems,
  pickDropboxItems,
} from "../src/lib/cloudFiles/dropboxChooser.js";
import {
  loadExternalScript,
  resetExternalScriptLoaderForTests,
} from "../src/lib/cloudFiles/externalScriptLoader.js";

function cloudItem(overrides: Partial<{ id: string; name: string; size: number; mimeType: string }> = {}) {
  return {
    id: "provider-item-1",
    name: "Agreement.pdf",
    size: 5,
    mimeType: "application/pdf",
    ...overrides,
  };
}

function responseWithBytes(bytes: number, type = "application/octet-stream"): Response {
  return new Response(new Blob([new Uint8Array(bytes)], { type }), { status: 200 });
}

function replaceWindow(value: Partial<Window>): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value });
  return () => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else delete (globalThis as { window?: Window }).window;
  };
}

test("Device stays available while incompletely configured cloud providers stay hidden", async () => {
  assert.deepEqual(cloudProviderAvailability({}), { googleDrive: false, dropbox: false });
  assert.deepEqual(cloudProviderAvailability({
    VITE_GOOGLE_DRIVE_CLIENT_ID: "client",
    VITE_GOOGLE_DRIVE_API_KEY: "key",
  }), { googleDrive: false, dropbox: false });
  assert.deepEqual(cloudProviderAvailability({ VITE_DROPBOX_APP_KEY: "dropbox" }), {
    googleDrive: false,
    dropbox: true,
  });

  const picker = await readFile("src/components/FileSourcePicker.tsx", "utf8");
  assert.match(picker, /\/>Device/);
  assert.match(picker, /configuration\.googleDrive &&/);
  assert.match(picker, /configuration\.dropbox &&/);
});

test("external provider scripts deduplicate concurrent and repeated loads", async () => {
  resetExternalScriptLoaderForTests();
  let ready = false;
  let appended = 0;
  const scripts = new Map<string, FakeScript>();
  class FakeScript extends EventTarget {
    id = "";
    src = "";
    async = false;
    attributes = new Map<string, string>();
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getAttribute(name: string) { return this.attributes.get(name) || null; }
    remove() { scripts.delete(this.id); }
  }
  const documentRef = {
    createElement: () => new FakeScript(),
    getElementById: (id: string) => scripts.get(id) || null,
    head: {
      appendChild: (script: FakeScript) => {
        appended += 1;
        scripts.set(script.id, script);
        return script;
      },
    },
  } as unknown as Document;
  const options = {
    id: "provider-script",
    src: "https://provider.invalid/picker.js",
    isReady: () => ready,
    failureMessage: "Provider unavailable",
    documentRef,
  };

  const first = loadExternalScript(options);
  const concurrent = loadExternalScript(options);
  assert.equal(first, concurrent);
  assert.equal(appended, 1);
  ready = true;
  scripts.get("provider-script")?.dispatchEvent(new Event("load"));
  await Promise.all([first, concurrent]);
  await loadExternalScript(options);
  assert.equal(appended, 1);
});

test("Google authorization requests only drive.file and never touches browser storage", async () => {
  clearGoogleDriveAccessToken();
  let requestedScope = "";
  let requestedPrompt: string | undefined;
  let storageTouched = false;
  const restoreWindow = replaceWindow({
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (configuration) => {
            requestedScope = configuration.scope;
            return {
              requestAccessToken: (options) => {
                requestedPrompt = options?.prompt;
                configuration.callback({ access_token: "temporary-token", expires_in: 3600 });
              },
            };
          },
        },
      },
      picker: {} as GooglePickerNamespace,
    },
    get localStorage(): Storage { storageTouched = true; throw new Error("local storage must not be read"); },
    get sessionStorage(): Storage { storageTouched = true; throw new Error("session storage must not be read"); },
  } as Partial<Window>);
  try {
    assert.equal(await requestGoogleDriveAccessToken("browser-client-id"), "temporary-token");
    assert.equal(requestedScope, GOOGLE_DRIVE_FILE_SCOPE);
    assert.equal(requestedPrompt, "");
    assert.equal(storageTouched, false);
  } finally {
    clearGoogleDriveAccessToken();
    restoreWindow();
  }
});

test("Google Picker shows folders for navigation without allowing folder selection", async () => {
  let includeFolders: boolean | undefined;
  let selectFolderEnabled: boolean | undefined;
  let mimeTypes: string | undefined;
  let pickerCallback: ((response: GooglePickerResponse) => void) | undefined;

  class FakeDocsView implements GooglePickerDocsView {
    constructor(_viewId: string) {}
    setIncludeFolders(include: boolean) { includeFolders = include; return this; }
    setSelectFolderEnabled(enabled: boolean) { selectFolderEnabled = enabled; return this; }
    setMimeTypes(value: string) { mimeTypes = value; return this; }
  }

  class FakePickerBuilder implements GooglePickerBuilder {
    addView(_view: GooglePickerDocsView) { return this; }
    setAppId(_appId: string) { return this; }
    setCallback(callback: (response: GooglePickerResponse) => void) { pickerCallback = callback; return this; }
    setDeveloperKey(_apiKey: string) { return this; }
    setOAuthToken(_token: string) { return this; }
    setOrigin(_origin: string) { return this; }
    enableFeature(_feature: string) { return this; }
    build() {
      return {
        setVisible: () => pickerCallback?.({ action: "cancel" }),
      };
    }
  }

  const restoreWindow = replaceWindow({
    location: { origin: "https://app.example" } as Location,
    google: {
      accounts: { oauth2: {} as NonNullable<Window["google"]>["accounts"]["oauth2"] },
      picker: {
        Action: { PICKED: "picked", CANCEL: "cancel" },
        Document: { ID: "id", NAME: "name", MIME_TYPE: "mimeType", SIZE_BYTES: "size", LAST_EDITED_UTC: "lastEdited" },
        Feature: { MULTISELECT_ENABLED: "multiselect" },
        Response: { ACTION: "action", DOCUMENTS: "documents" },
        ViewId: { DOCS: "docs" },
        DocsView: FakeDocsView,
        PickerBuilder: FakePickerBuilder,
      },
    },
  } as Partial<Window>);

  try {
    await assert.rejects(
      pickGoogleDriveItems({ clientId: "client", apiKey: "key", appId: "app" }, "token"),
      { name: "CloudPickerCancelled" }
    );
    assert.equal(includeFolders, true);
    assert.equal(selectFolderEnabled, false);
    assert.equal(mimeTypes, GOOGLE_PICKER_MIME_TYPES.join(","));
  } finally {
    restoreWindow();
  }
});

test("Google PDF and DOCX downloads become ordinary validated browser Files", async () => {
  const pdf = await downloadGoogleDriveItem(
    cloudItem(),
    "memory-only-token",
    async () => responseWithBytes(5, "application/pdf")
  );
  const docx = await downloadGoogleDriveItem(
    cloudItem({ id: "docx-1", name: "Brief.docx", mimeType: SUPPORTED_FILE_MIME_TYPES[".docx"] }),
    "memory-only-token",
    async () => responseWithBytes(7, SUPPORTED_FILE_MIME_TYPES[".docx"])
  );
  assert.equal(pdf.name, "Agreement.pdf");
  assert.equal(pdf.type, SUPPORTED_FILE_MIME_TYPES[".pdf"]);
  assert.equal(docx.name, "Brief.docx");
  assert.equal(docx.type, SUPPORTED_FILE_MIME_TYPES[".docx"]);
});

test("native Google Docs export as DOCX without a doubled extension", async () => {
  const requests: string[] = [];
  const exported = await downloadGoogleDriveItem(
    cloudItem({ id: "google-doc-1", name: "Witness Statement.docx", mimeType: GOOGLE_NATIVE_DOCUMENT_MIME, size: undefined }),
    "memory-only-token",
    async (input) => {
      requests.push(String(input));
      return responseWithBytes(9, SUPPORTED_FILE_MIME_TYPES[".docx"]);
    }
  );
  assert.equal(exported.name, "Witness Statement.docx");
  assert.equal(exported.type, SUPPORTED_FILE_MIME_TYPES[".docx"]);
  assert.match(requests[0], /\/export\?mimeType=/);
});

test("Google Sheets and Slides are excluded and safely rejected without downloading", async () => {
  assert.doesNotMatch(GOOGLE_PICKER_MIME_TYPES.join(","), /spreadsheet|presentation/);
  let fetches = 0;
  const result = await downloadGoogleDriveItems([
    cloudItem({ name: "Budget", mimeType: "application/vnd.google-apps.spreadsheet", size: undefined }),
    cloudItem({ id: "slide-1", name: "Hearing", mimeType: "application/vnd.google-apps.presentation", size: undefined }),
  ], "token", {
    maxFiles: 5,
    selectedCount: 0,
    fetchImplementation: async () => { fetches += 1; return responseWithBytes(1); },
  });
  assert.equal(fetches, 0);
  assert.equal(result.files.length, 0);
  assert.equal(result.failures.length, 2);
});

test("Dropbox Chooser uses direct multiselect with supported extensions and the server file-size limit", async () => {
  let captured: DropboxChooserOptions | undefined;
  const restoreWindow = replaceWindow({
    Dropbox: {
      isBrowserSupported: () => true,
      choose: (options) => {
        captured = options;
        options.success([{ id: "dbid:1", name: "Notes.txt", link: "https://temporary.invalid/file", bytes: 5 }]);
      },
    },
  });
  try {
    const selected = await pickDropboxItems();
    assert.equal(selected.length, 1);
    assert.equal(captured?.linkType, "direct");
    assert.equal(captured?.multiselect, true);
    assert.equal(captured?.folderselect, false);
    assert.deepEqual(captured?.extensions, [".pdf", ".docx", ".txt"]);
    assert.equal(captured?.sizeLimit, MAX_CLOUD_FILE_SIZE_BYTES);
  } finally {
    restoreWindow();
  }
});

test("Dropbox direct-link bytes become a File and the URL is never part of multipart upload data", async () => {
  const directLink = "https://temporary.invalid/private-download";
  const file = await downloadDropboxItem({
    id: "dbid:document",
    name: "Notes.txt",
    size: 5,
    directLink,
  }, async (input) => {
    assert.equal(String(input), directLink);
    return responseWithBytes(5, "text/plain");
  });
  const form = new FormData();
  form.append("files", file);
  assert.equal(file.name, "Notes.txt");
  assert.equal(file.type, "text/plain");
  assert.equal(form.get("files"), file);
  assert.doesNotMatch(String(form.get("files")), /temporary\.invalid/);
});

test("cloud validation rejects unsupported, oversized, and empty downloads", async () => {
  assert.throws(
    () => validateCloudItemMetadata(cloudItem({ name: "Evidence.zip", mimeType: "application/zip" })),
    /is not supported/
  );
  await assert.rejects(
    downloadDropboxItem({ id: "large", name: "Bundle.pdf", size: 10, directLink: "https://temporary.invalid/large" }, async () => responseWithBytes(MAX_CLOUD_FILE_SIZE_BYTES + 1)),
    /exceeds the 10 MB file limit/
  );
  await assert.rejects(
    downloadGoogleDriveItem(cloudItem({ id: "empty" }), "token", async () => responseWithBytes(0)),
    /is empty/
  );
});

test("partial cloud batches preserve successes without automatic retries", async () => {
  const attempts: string[] = [];
  const result = await downloadDropboxItems([
    { id: "good", name: "Good.txt", size: 4, directLink: "https://temporary.invalid/good" },
    { id: "bad", name: "Bad.txt", size: 4, directLink: "https://temporary.invalid/bad" },
  ], {
    maxFiles: 5,
    selectedCount: 0,
    fetchImplementation: async (input) => {
      attempts.push(String(input));
      return String(input).endsWith("/good") ? responseWithBytes(4, "text/plain") : new Response(null, { status: 500 });
    },
  });
  assert.deepEqual(attempts, ["https://temporary.invalid/good", "https://temporary.invalid/bad"]);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].name, "Good.txt");
  assert.equal(result.failures.length, 1);
});

test("too many cloud selections download nothing and leave cumulative limits authoritative", async () => {
  let fetches = 0;
  await assert.rejects(
    downloadGoogleDriveItems([cloudItem(), cloudItem({ id: "second", name: "Second.pdf" })], "token", {
      maxFiles: 5,
      selectedCount: 4,
      fetchImplementation: async () => { fetches += 1; return responseWithBytes(5); },
    }),
    /Only 1 more file can be added/
  );
  assert.equal(fetches, 0);

  const local = new File(["local"], "Local.txt", { type: "text/plain", lastModified: 1 });
  const cloud = new File(["cloud"], "Cloud.txt", { type: "text/plain", lastModified: 2 });
  const combined = appendUniqueFiles([local], [cloud], 2);
  assert.deepEqual(combined.files, [local, cloud]);
});

test("stable provider-derived File identity deduplicates the same cloud item", async () => {
  const first = await downloadGoogleDriveItem(cloudItem(), "token", async () => responseWithBytes(5));
  const second = await downloadGoogleDriveItem(cloudItem(), "token", async () => responseWithBytes(5));
  assert.equal(first.lastModified, stableCloudLastModified("google-drive", "provider-item-1"));
  assert.equal(second.lastModified, first.lastModified);
  assert.equal(appendUniqueFiles([first], [second], 5).files.length, 1);
});

test("lawyer integrations reuse existing upload flows while server and client portal remain provider-agnostic", async () => {
  const [assistant, sources, matters, library, picker, portal, server, extractor, google] = await Promise.all([
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("src/components/MatterSources.tsx", "utf8"),
    readFile("src/components/MattersView.tsx", "utf8"),
    readFile("src/components/FirmLibraryView.tsx", "utf8"),
    readFile("src/components/FileSourcePicker.tsx", "utf8"),
    readFile("src/components/ClientPortalView.tsx", "utf8"),
    readFile("server.ts", "utf8"),
    readFile("server/fileExtraction.ts", "utf8"),
    readFile("src/lib/cloudFiles/googleDrivePicker.ts", "utf8"),
  ]);

  for (const lawyerSurface of [assistant, sources, matters, library]) {
    assert.match(lawyerSurface, /FileSourcePicker/);
  }
  assert.match(assistant, /FileList \| File\[\] \| null/);
  assert.match(assistant, /fetch\("\/api\/extract-files", \{ method: "POST", body: form \}\)/);
  assert.match(sources, /uploadPersistentFilesSequentially/);
  assert.match(matters, /const uploadSourcesAfterCreation = selectedFiles\.length > 5/);
  assert.equal((matters.match(/fetch\("\/api\/cases", \{ method: "POST", body: form \}\)/g) || []).length, 1);
  assert.match(library, /uploadPersistentFilesSequentially/);
  assert.match(picker, /\/>Device/);
  assert.doesNotMatch(portal, /FileSourcePicker|Google Drive|Dropbox/);
  assert.match(extractor, /MAX_FILE_COUNT = 5/);
  assert.match(extractor, /MAX_FILE_SIZE_BYTES = 10 \* 1024 \* 1024/);
  assert.doesNotMatch(server, /api\/(?:google-drive|dropbox|cloud-files)/);
  assert.doesNotMatch(google, /localStorage|sessionStorage|indexedDB|document\.cookie/);
});
