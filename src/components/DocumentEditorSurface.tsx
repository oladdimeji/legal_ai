import React, { useState } from "react";
import { Check, Download, Edit, Eye, RefreshCw, Save } from "lucide-react";
import RichDocumentEditor from "./RichDocumentEditor";
import WorkProductDocument from "./WorkProductDocument";

export type DocumentSaveStatus = "idle" | "saving" | "saved" | "error";

interface DocumentEditorSurfaceProps {
  title: string;
  onTitleChange?: (title: string) => void;
  content: string;
  onContentChange: (content: string) => void;
  updatedAt: string;
  detail: string;
  onSave: () => void;
  saving: boolean;
  saveStatus: DocumentSaveStatus;
  exportUrl: string;
  actions?: React.ReactNode;
  idPrefix?: string;
}

export default function DocumentEditorSurface({
  title,
  onTitleChange,
  content,
  onContentChange,
  updatedAt,
  detail,
  onSave,
  saving,
  saveStatus,
  exportUrl,
  actions,
  idPrefix = "editor",
}: DocumentEditorSurfaceProps) {
  const [editMode, setEditMode] = useState(true);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="z-10 shrink-0 border-b border-zinc-100 bg-white px-8 py-4">
        <div className="min-w-0">
          {onTitleChange ? (
            <input
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              maxLength={300}
              aria-label="Document title"
              className="w-full border-0 bg-transparent p-0 text-sm font-bold uppercase tracking-tight text-zinc-900 outline-none focus:ring-0"
            />
          ) : (
            <h2 className="whitespace-normal break-words text-sm font-bold uppercase tracking-tight text-zinc-900">{title}</h2>
          )}
          <p className="mt-0.5 text-[10px] font-mono uppercase text-zinc-400">
            Updated {new Date(updatedAt).toLocaleString()} · {detail}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {actions}
          <div className="flex rounded border border-zinc-200 bg-zinc-100 p-0.5 text-[10px] font-mono font-semibold uppercase">
            <button onClick={() => setEditMode(true)} id={idPrefix === "editor" ? "mode-edit-btn" : `${idPrefix}-mode-edit-btn`} className={`flex items-center gap-1 rounded px-3 py-1 ${editMode ? "bg-white font-bold text-zinc-900 shadow-sm" : "text-zinc-500"}`}><Edit className="h-3 w-3" />Editor</button>
            <button onClick={() => setEditMode(false)} id={idPrefix === "editor" ? "mode-preview-btn" : `${idPrefix}-mode-preview-btn`} className={`flex items-center gap-1 rounded px-3 py-1 ${!editMode ? "bg-white font-bold text-zinc-900 shadow-sm" : "text-zinc-500"}`}><Eye className="h-3 w-3" />Preview</button>
          </div>
          <button onClick={onSave} disabled={saving || !title.trim()} id={idPrefix === "editor" ? "editor-save-btn" : `${idPrefix}-save-btn`} className="inline-flex items-center gap-1.5 rounded border border-zinc-300 bg-white px-3 py-1.5 text-[10px] font-mono font-bold uppercase hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
            {saveStatus === "saving" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : saveStatus === "saved" ? <Check className="h-3.5 w-3.5 text-green-700" /> : <Save className="h-3.5 w-3.5" />}
            {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : saveStatus === "error" ? "Retry save" : "Save"}
          </button>
          <button onClick={() => window.open(exportUrl, "_blank")} id={idPrefix === "editor" ? "editor-export-btn" : `${idPrefix}-export-btn`} className="inline-flex items-center gap-1.5 rounded bg-zinc-950 px-3.5 py-1.5 text-[10px] font-mono font-bold uppercase text-white hover:bg-zinc-900"><Download className="h-3.5 w-3.5" />Download .docx</button>
        </div>
      </div>

      <div className="h-full min-h-0 flex-1 overflow-y-auto bg-white" id={idPrefix === "editor" ? "work-product-document-scroll" : `${idPrefix}-document-scroll`}>
        <div id={idPrefix === "editor" ? "paper-layout" : `${idPrefix}-paper-layout`} className="min-h-full w-full bg-white">
          {editMode ? <div className="mx-auto max-w-4xl px-8 py-10"><RichDocumentEditor title={title} value={content} onChange={onContentChange} minHeight={900} /></div> : <WorkProductDocument title={title} content={content} />}
        </div>
      </div>
    </div>
  );
}
