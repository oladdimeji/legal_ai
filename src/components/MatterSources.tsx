import React, { useEffect, useMemo, useState } from "react";
import { Eye, FileText, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { Document, WorkspacePageContext } from "../types";
import SelectedFileList from "./SelectedFileList";
import WorkProductDocument from "./WorkProductDocument";
import { MAX_PERSISTENT_UPLOAD_FILES, useCumulativeFileSelection } from "../hooks/useCumulativeFileSelection";
import {
  persistentUploadSummary,
  responseErrorMessage,
  uploadPersistentFilesSequentially,
  type PersistentUploadFailure,
  type PersistentUploadProgress,
} from "../lib/persistentUploads";

export default function MatterSources({ matterId, onSelectedItemChange }: { matterId: string; onSelectedItemChange?: (item: WorkspacePageContext["selectedItem"]) => void }) {
  const [sources, setSources] = useState<Document[]>([]);
  const [library, setLibrary] = useState<Document[]>([]);
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [preview, setPreview] = useState<Document | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [type, setType] = useState<"note" | "upload" | "library">("note");
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [uploadFailures, setUploadFailures] = useState<PersistentUploadFailure[]>([]);
  const [uploadProgress, setUploadProgress] = useState<PersistentUploadProgress | null>(null);
  const [uploadSummary, setUploadSummary] = useState("");
  const fileSelection = useCumulativeFileSelection(MAX_PERSISTENT_UPLOAD_FILES);

  const load = async () => {
    const [sourceResponse, libraryResponse] = await Promise.all([
      fetch(`/api/cases/${matterId}/sources`),
      fetch("/api/documents?caseId=null"),
    ]);
    if (sourceResponse.ok) setSources(await sourceResponse.json());
    if (libraryResponse.ok) setLibrary(await libraryResponse.json());
  };

  useEffect(() => { void load(); }, [matterId]);
  useEffect(() => {
    onSelectedItemChange?.(preview ? { kind: "source", id: preview.id, title: preview.title } : undefined);
  }, [onSelectedItemChange, preview]);

  const visible = useMemo(
    () => sources.filter((source) => `${source.title} ${source.source_type} ${source.origin}`.toLowerCase().includes(query.toLowerCase())),
    [sources, query]
  );

  const resetAddForm = () => {
    setTitle("");
    setText("");
    setSelectedLibraryIds([]);
    fileSelection.clearFiles();
    setError("");
    setUploadFailures([]);
    setUploadProgress(null);
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (processing) return;
    setProcessing(true);
    setError("");
    setUploadFailures([]);
    setUploadSummary("");
    try {
      if (type === "upload") {
        if (fileSelection.files.length === 0) return;
        const files = [...fileSelection.files];
        const customTitle = files.length === 1 ? title.trim() : "";
        const result = await uploadPersistentFilesSequentially(
          files,
          async (file) => {
            const form = new FormData();
            if (customTitle) form.append("title", customTitle);
            form.append("files", file);
            const response = await fetch(`/api/cases/${matterId}/sources`, { method: "POST", body: form });
            if (!response.ok) throw new Error(await responseErrorMessage(response, "Source could not be added"));
          },
          (progress) => {
            setUploadProgress(progress);
            if (progress.phase === "succeeded") fileSelection.removeFile(progress.identity);
          }
        );
        setUploadFailures(result.failedFiles);
        setUploadSummary(persistentUploadSummary(result.successfulFiles.length, result.failedFiles.length));
        await load();
        if (result.failedFiles.length === 0) {
          setShowAdd(false);
          resetAddForm();
        }
        return;
      }

      const body = type === "library"
        ? { libraryDocumentIds: selectedLibraryIds }
        : { title, text, sourceType: "Starting Instruction" };
      const response = await fetch(`/api/cases/${matterId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Source could not be added");
        return;
      }
      setShowAdd(false);
      resetAddForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Source could not be added");
    } finally {
      setProcessing(false);
      setUploadProgress(null);
    }
  };

  const removePendingFile = (identity: string) => {
    fileSelection.removeFile(identity);
    setUploadFailures((current) => current.filter((failure) => failure.identity !== identity));
    setUploadSummary("");
  };

  const remove = async (source: Document) => {
    const linked = source.case_id === null;
    if (!confirm(linked ? "Remove this Firm Library link from the Matter? The library document will be preserved." : "Remove this direct Matter Source?")) return;
    const response = await fetch(`/api/cases/${matterId}/sources/${source.id}`, { method: "DELETE" });
    if (response.ok) await load();
  };

  const selectedLibraryNames = selectedLibraryIds
    .map((id) => library.find((document) => document.id === id)?.title)
    .filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="flex flex-1 items-center gap-2 rounded border px-3">
          <Search className="h-4 w-4 text-zinc-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full py-2 text-xs outline-none" placeholder="Search Matter Sources" />
        </div>
        <button onClick={() => { setUploadSummary(""); setShowAdd(true); }} className="flex items-center gap-2 rounded bg-zinc-950 px-4 text-[10px] font-mono font-bold uppercase text-white">
          <Plus className="h-4 w-4" />Add Source
        </button>
      </div>
      {uploadSummary && <p className="text-xs text-zinc-700">{uploadSummary}</p>}

      <div className="overflow-hidden rounded border">
        {visible.length === 0 ? <p className="p-10 text-center text-xs text-zinc-500">No Sources match this view.</p> : visible.map((source) => (
          <div key={source.id} className="grid grid-cols-[1fr_150px_120px_110px_70px] items-center gap-3 border-t px-4 py-3 first:border-t-0">
            <button onClick={() => setPreview(source)} className="flex min-w-0 items-center gap-2 text-left">
              <FileText className="h-4 w-4 text-zinc-400" />
              <span className="truncate text-xs font-semibold">{source.title}</span>
            </button>
            <span className="text-[9px] font-mono uppercase">{source.case_id === null ? "Linked Firm Library" : source.source_type || "Matter Upload"}{source.link_origin === "AI Suggested" && <em className="block not-italic text-zinc-400">AI Suggested</em>}</span>
            <span className="text-[10px] text-zinc-500">{source.origin || "Lawyer"}</span>
            <span className="text-[9px] font-mono uppercase">{source.processing_state || "Ready"}</span>
            <span className="flex gap-3"><button onClick={() => setPreview(source)}><Eye className="h-4 w-4" /></button><button onClick={() => void remove(source)}><Trash2 className="h-4 w-4 text-zinc-400" /></button></span>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <form onSubmit={add} className="w-full max-w-lg space-y-4 rounded border bg-white p-6">
            <h3 className="text-sm font-semibold uppercase">Add Matter Source</h3>
            <div className="flex gap-2">
              {(["note", "upload", "library"] as const).map((item) => (
                <button type="button" disabled={processing} key={item} onClick={() => { setType(item); setError(""); }} className={`rounded border px-3 py-2 text-[9px] font-mono uppercase disabled:cursor-not-allowed disabled:opacity-40 ${type === item ? "bg-zinc-900 text-white" : ""}`}>{item === "library" ? "Firm Library" : item}</button>
              ))}
            </div>
            {type === "library" ? (
              <div className="space-y-2">
                <div className="max-h-48 overflow-y-auto rounded border p-2">
                  {library.length === 0 ? <p className="p-3 text-xs text-zinc-400">No Firm Library documents.</p> : library.map((document) => (
                    <label key={document.id} className="flex items-center gap-2 rounded px-2 py-2 text-xs hover:bg-zinc-50">
                      <input
                        type="checkbox"
                        checked={selectedLibraryIds.includes(document.id)}
                        onChange={(event) => setSelectedLibraryIds((current) => event.target.checked ? Array.from(new Set([...current, document.id])) : current.filter((id) => id !== document.id))}
                      />
                      {document.title}
                    </label>
                  ))}
                </div>
                <p className="text-[10px] font-mono uppercase text-zinc-500">{selectedLibraryIds.length} selected</p>
                {selectedLibraryNames.length > 0 && <div className="flex flex-wrap gap-1">{selectedLibraryNames.map((name) => <span key={name} className="rounded border px-2 py-1 text-[10px]">{name}</span>)}</div>}
              </div>
            ) : type === "upload" ? (
              <div className="space-y-2">
                <label className="flex cursor-pointer items-center justify-between rounded border border-dashed p-5 text-xs text-zinc-500 hover:bg-zinc-50">
                  <span className="flex items-center gap-2"><Upload className="h-4 w-4" />Choose PDF, DOCX, or TXT</span>
                  <span>{fileSelection.files.length ? fileSelection.selectedLabel : ""}</span>
                  <input type="file" multiple disabled={processing} className="sr-only" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => { fileSelection.addFiles(event.target.files); event.currentTarget.value = ""; }} />
                </label>
                {fileSelection.fileError && <p className="text-xs text-red-700">{fileSelection.fileError}</p>}
                <SelectedFileList files={fileSelection.files} onRemove={removePendingFile} disabled={processing} />
                <input value={title} disabled={processing} onChange={(event) => setTitle(event.target.value)} className="w-full rounded border px-3 py-2 text-xs disabled:bg-zinc-50" placeholder="Optional title for one-file upload only" />
              </div>
            ) : (
              <>
                <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded border px-3 py-2 text-xs" placeholder="Note title (optional)" />
                <textarea value={text} onChange={(event) => setText(event.target.value)} className="h-32 w-full rounded border px-3 py-2 text-xs" placeholder="Write Source note" />
              </>
            )}
            {uploadProgress && <p className="text-xs text-zinc-600">Uploading and indexing {uploadProgress.current} of {uploadProgress.total}: {uploadProgress.file.name}</p>}
            {uploadFailures.map((failure) => <p key={failure.identity} className="text-xs text-red-700">{failure.file.name}: {failure.error}</p>)}
            {type === "upload" && uploadSummary && <p className="text-xs text-zinc-700">{uploadSummary}</p>}
            {error && <p className="text-xs text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={processing} onClick={() => { resetAddForm(); setShowAdd(false); }} className="rounded border px-4 py-2 text-[10px] uppercase disabled:cursor-not-allowed disabled:opacity-40">Cancel</button>
              <button disabled={processing || (type === "library" ? selectedLibraryIds.length === 0 : type === "upload" ? fileSelection.files.length === 0 : !text.trim())} className="rounded bg-zinc-950 px-4 py-2 text-[10px] font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-40">{processing ? "Processing..." : "Add Source"}</button>
            </div>
          </form>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded border bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-100 px-6 py-4">
              <h3 className="min-w-0 truncate font-semibold">{preview.title}</h3>
              <button onClick={() => setPreview(null)} aria-label="Close Source preview" className="shrink-0 rounded p-1 hover:bg-zinc-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50 px-6 py-8">
              <div className="mx-auto min-h-full max-w-3xl rounded border border-zinc-100 bg-white px-8 py-10 shadow-sm">
                {preview.extracted_text?.trim()
                  ? <WorkProductDocument content={preview.extracted_text} />
                  : <p className="text-sm text-zinc-500">No extracted content is available for this Source.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
