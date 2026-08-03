import React, { useEffect, useRef, useState } from "react";
import { Cloud, HardDrive } from "lucide-react";
import { readCloudProviderConfiguration } from "../lib/cloudFiles/constants";
import { isCloudPickerCancellation, type CloudFileBatchResult } from "../lib/cloudFiles/cloudFileValidation";
import { chooseDropboxFiles } from "../lib/cloudFiles/dropboxChooser";
import { chooseGoogleDriveFiles } from "../lib/cloudFiles/googleDrivePicker";

export type FileSourcePickerProps = {
  disabled?: boolean;
  maxFiles: number;
  selectedCount: number;
  compact?: boolean;
  onFilesSelected: (files: File[]) => void | Promise<void>;
  onError: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
};

type ActiveProvider = "google-drive" | "dropbox" | null;

const FILE_ACCEPT = ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

export default function FileSourcePicker({
  disabled = false,
  maxFiles,
  selectedCount,
  compact = false,
  onFilesSelected,
  onError,
  onBusyChange,
}: FileSourcePickerProps) {
  const configuration = readCloudProviderConfiguration();
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeProvider, setActiveProvider] = useState<ActiveProvider>(null);
  const [busyLabel, setBusyLabel] = useState("");
  const busy = activeProvider !== null;
  const atLimit = selectedCount >= maxFiles;

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  const deliverResult = async (result: CloudFileBatchResult) => {
    if (result.files.length > 0) {
      setBusyLabel("Adding files...");
      await onFilesSelected(result.files);
    }
    onError(result.failures.map((failure) => failure.error).join(" "));
  };

  const chooseGoogleDrive = async () => {
    if (!configuration.googleDrive || busy || disabled || atLimit) return;
    onError("");
    setActiveProvider("google-drive");
    setBusyLabel("Opening Google Drive...");
    try {
      const result = await chooseGoogleDriveFiles({
        configuration: configuration.googleDrive,
        maxFiles,
        selectedCount,
        onProgress: ({ current, total }) => setBusyLabel(`Downloading ${current} of ${total} from Google Drive...`),
      });
      await deliverResult(result);
    } catch (error) {
      if (!isCloudPickerCancellation(error)) {
        onError(error instanceof Error ? error.message : "Google Drive could not be opened. Try again.");
      }
    } finally {
      setActiveProvider(null);
      setBusyLabel("");
    }
  };

  const chooseDropbox = async () => {
    if (!configuration.dropbox || busy || disabled || atLimit) return;
    onError("");
    setActiveProvider("dropbox");
    setBusyLabel("Opening Dropbox...");
    try {
      const result = await chooseDropboxFiles({
        configuration: configuration.dropbox,
        maxFiles,
        selectedCount,
        onProgress: ({ current, total }) => setBusyLabel(`Downloading ${current} of ${total} from Dropbox...`),
      });
      await deliverResult(result);
    } catch (error) {
      if (!isCloudPickerCancellation(error)) {
        onError(error instanceof Error ? error.message : "Dropbox could not be opened in this browser.");
      }
    } finally {
      setActiveProvider(null);
      setBusyLabel("");
    }
  };

  const buttonClass = compact
    ? "inline-flex items-center gap-2 rounded border border-zinc-200 bg-white px-2.5 py-2 text-xs text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
    : "inline-flex items-center justify-center gap-2 rounded border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-700 hover:border-zinc-500 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" aria-label="Choose file source">
        <button
          type="button"
          className={buttonClass}
          disabled={disabled || busy || atLimit}
          onClick={() => inputRef.current?.click()}
        >
          <HardDrive className="h-3.5 w-3.5" />Device
        </button>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          multiple
          disabled={disabled || busy || atLimit}
          accept={FILE_ACCEPT}
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            if (files.length > 0) void onFilesSelected(files);
            event.currentTarget.value = "";
          }}
        />
        {configuration.googleDrive && (
          <button type="button" className={buttonClass} disabled={disabled || busy || atLimit} onClick={() => void chooseGoogleDrive()}>
            <Cloud className="h-3.5 w-3.5" />Google Drive
          </button>
        )}
        {configuration.dropbox && (
          <button type="button" className={buttonClass} disabled={disabled || busy || atLimit} onClick={() => void chooseDropbox()}>
            <Cloud className="h-3.5 w-3.5" />Dropbox
          </button>
        )}
      </div>
      {busyLabel && <p className="text-[10px] font-mono uppercase text-zinc-500" aria-live="polite">{busyLabel}</p>}
    </div>
  );
}
