import React from "react";
import { FileText, X } from "lucide-react";
import { browserFileIdentity } from "../hooks/useCumulativeFileSelection";

export default function SelectedFileList({
  files,
  onRemove,
  disabled = false,
}: {
  files: File[];
  onRemove: (identity: string) => void;
  disabled?: boolean;
}) {
  if (files.length === 0) return null;
  return (
    <div className="space-y-1">
      {files.map((file) => (
        <div
          key={browserFileIdentity(file)}
          className="flex items-center gap-2 rounded border border-zinc-200 bg-white px-2 py-1 text-xs"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => onRemove(browserFileIdentity(file))}
            disabled={disabled}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`Remove ${file.name}`}
            title={`Remove ${file.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
