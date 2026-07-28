import React, { useEffect, useState } from "react";
import { Cloud, RefreshCw } from "lucide-react";

declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

type DriveImport = {
  id: string;
  drive_name: string;
  sync_state: string;
  imported_at: string | null;
  canonical_url: string | null;
};

const PICKER_SCRIPT = "https://apis.google.com/js/api.js";

function loadScript(source: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${source}"]`);
  if (existing?.dataset.loaded === "true") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = existing || document.createElement("script");
    script.src = source;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("Google Picker could not be loaded."));
    if (!existing) document.head.appendChild(script);
  });
}

function pickerReady(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!window.gapi) return reject(new Error("Google Picker could not be loaded."));
    window.gapi.load("picker", { callback: resolve, onerror: reject });
  });
}

export default function GoogleDrivePanel({
  caseId,
  onImported,
  compact = false,
}: {
  caseId: string | null;
  onImported: () => void | Promise<void>;
  compact?: boolean;
}) {
  const [imports, setImports] = useState<DriveImport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const contextQuery = `caseId=${encodeURIComponent(caseId || "null")}`;
  const load = async () => {
    const response = await fetch(`/api/google/drive/imports?${contextQuery}`);
    if (response.ok) setImports(await response.json());
  };

  useEffect(() => { void load(); }, [caseId]);

  const openPicker = async () => {
    setBusy(true);
    setError("");
    try {
      const sessionResponse = await fetch("/api/google/drive/picker-session");
      const session = await sessionResponse.json();
      if (!sessionResponse.ok) throw new Error(session.error || "Connect Google in Settings first.");
      await loadScript(PICKER_SCRIPT);
      await pickerReady();
      await new Promise<void>((resolve, reject) => {
        const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
          .setIncludeFolders(false)
          .setSelectFolderEnabled(false)
          .setMimeTypes(session.mimeTypes.join(","));
        const picker = new window.google.picker.PickerBuilder()
          .setAppId(session.appId)
          .setOAuthToken(session.accessToken)
          .setDeveloperKey(session.apiKey)
          .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
          .addView(view)
          .setCallback(async (data: any) => {
            if (data.action === window.google.picker.Action.CANCEL) return resolve();
            if (data.action === window.google.picker.Action.ERROR) {
              return reject(new Error("Google Picker returned an error."));
            }
            if (data.action !== window.google.picker.Action.PICKED) return;
            try {
              const fileIds = (data.docs || [])
                .map((document: any) => document.id)
                .filter((id: unknown): id is string => typeof id === "string");
              const response = await fetch("/api/google/drive/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fileIds, caseId }),
              });
              const result = await response.json();
              if (!response.ok) throw new Error(
                result.error || result.failures?.[0]?.error || "Drive import failed.",
              );
              if (result.failures?.length) {
                setError(`${result.failures.length} selected file(s) could not be imported.`);
              }
              await load();
              await onImported();
              resolve();
            } catch (pickerError) {
              reject(pickerError);
            }
          })
          .build();
        picker.setVisible(true);
      });
    } catch (pickerError) {
      setError(pickerError instanceof Error ? pickerError.message : "Drive import failed.");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/google/drive/imports/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Drive status could not be refreshed.");
      setImports(result.imports || []);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Drive status could not be refreshed.");
    } finally {
      setBusy(false);
    }
  };

  const reimport = async (item: DriveImport) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/google/drive/imports/${item.id}/reimport`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Drive file could not be re-imported.");
      await load();
      await onImported();
    } catch (reimportError) {
      setError(reimportError instanceof Error ? reimportError.message : "Drive file could not be re-imported.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`space-y-3 rounded border border-zinc-200 bg-zinc-50 ${compact ? "p-3" : "p-4"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Cloud className="h-4 w-4" />
          <h3 className="text-[10px] font-mono font-bold uppercase">Google Drive</h3>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh()} disabled={busy} className="rounded border bg-white px-2 py-1 text-[9px] font-mono font-bold uppercase disabled:opacity-50">
            <RefreshCw className={`mr-1 inline h-3 w-3 ${busy ? "animate-spin" : ""}`} />Refresh status
          </button>
          <button type="button" onClick={() => void openPicker()} disabled={busy} className="rounded bg-zinc-950 px-3 py-1.5 text-[9px] font-mono font-bold uppercase text-white disabled:opacity-50">
            {busy ? "Working..." : "Choose from Drive"}
          </button>
        </div>
      </div>
      <p className="text-[10px] leading-relaxed text-zinc-500">
        PDF, DOCX, TXT, and Google Docs are copied into Exepts private storage before processing.
      </p>
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
      {imports.length > 0 && (
        <div className="space-y-1">
          {imports.map((item) => {
            const reimportable = ["changed", "moved_and_changed", "import_failed"].includes(item.sync_state);
            return (
              <div key={item.id} className="flex items-center gap-2 rounded border bg-white px-2 py-2 text-[10px]">
                <span className="min-w-0 flex-1 truncate font-semibold">{item.drive_name}</span>
                <span className="font-mono uppercase text-zinc-500">{item.sync_state.replaceAll("_", " ")}</span>
                {reimportable && (
                  <button type="button" disabled={busy} onClick={() => void reimport(item)} className="rounded border px-2 py-1 font-mono font-bold uppercase disabled:opacity-50">
                    Re-import
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
