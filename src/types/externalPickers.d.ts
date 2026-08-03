export {};

declare global {
  interface ImportMetaEnv {
    readonly VITE_GOOGLE_DRIVE_CLIENT_ID?: string;
    readonly VITE_GOOGLE_DRIVE_API_KEY?: string;
    readonly VITE_GOOGLE_DRIVE_APP_ID?: string;
    readonly VITE_DROPBOX_APP_KEY?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(configuration: GoogleTokenClientConfiguration): GoogleTokenClient;
        };
      };
      picker: GooglePickerNamespace;
    };
    gapi?: {
      load(api: string, configuration: GoogleApiLoadConfiguration): void;
    };
    Dropbox?: DropboxChooserApi;
  }

  type GoogleTokenResponse = {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };

  type GoogleTokenClientConfiguration = {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
  };

  type GoogleTokenClient = {
    requestAccessToken(options?: { prompt?: string }): void;
  };

  type GoogleApiLoadConfiguration = {
    callback: () => void;
    onerror: () => void;
    timeout: number;
    ontimeout: () => void;
  };

  type GooglePickerResponse = Record<string, unknown>;

  interface GooglePickerBuilder {
    addView(view: GooglePickerDocsView): GooglePickerBuilder;
    setAppId(appId: string): GooglePickerBuilder;
    setCallback(callback: (response: GooglePickerResponse) => void): GooglePickerBuilder;
    setDeveloperKey(apiKey: string): GooglePickerBuilder;
    setOAuthToken(token: string): GooglePickerBuilder;
    setOrigin?(origin: string): GooglePickerBuilder;
    enableFeature(feature: string): GooglePickerBuilder;
    build(): { setVisible(visible: boolean): void };
  }

  interface GooglePickerDocsView {
    setIncludeFolders(include: boolean): GooglePickerDocsView;
    setMimeTypes(mimeTypes: string): GooglePickerDocsView;
    setSelectFolderEnabled(enabled: boolean): GooglePickerDocsView;
  }

  interface GooglePickerNamespace {
    Action: { PICKED: string; CANCEL: string };
    Document: { ID: string; NAME: string; MIME_TYPE: string; SIZE_BYTES: string; LAST_EDITED_UTC: string };
    Feature: { MULTISELECT_ENABLED: string };
    Response: { ACTION: string; DOCUMENTS: string };
    ViewId: { DOCS: string };
    DocsView: new (viewId: string) => GooglePickerDocsView;
    PickerBuilder: new () => GooglePickerBuilder;
  }

  type DropboxChooserFile = {
    id: string;
    name: string;
    link: string;
    bytes?: number;
  };

  type DropboxChooserOptions = {
    success: (files: DropboxChooserFile[]) => void;
    cancel: () => void;
    linkType: "direct";
    multiselect: boolean;
    extensions: string[];
    folderselect: boolean;
    sizeLimit: number;
  };

  interface DropboxChooserApi {
    choose(options: DropboxChooserOptions): void;
    isBrowserSupported?(): boolean;
  }
}
