import React, { useEffect, useMemo, useState } from "react";
import { Eye, FileText, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { Document } from "../types";
import SelectedFileList from "./SelectedFileList";
import { useCumulativeFileSelection } from "../hooks/useCumulativeFileSelection";
import { PRIVATE_UPLOAD_MAX_FILES, uploadPrivateFiles } from "../lib/durableUploads";
import GoogleDrivePanel from "./GoogleDrivePanel";

export default function MatterSources({ matterId, googleDriveEnabled = false }: { matterId: string; googleDriveEnabled?: boolean }) {
  const [sources, setSources] = useState<Document[]>([]);
  const [library, setLibrary] = useState<Document[]>([]);
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [preview, setPreview] = useState<Document | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [type, setType] = useState<"note" | "upload" | "library" | "drive">("note");
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const fileSelection = useCumulativeFileSelection(PRIVATE_UPLOAD_MAX_FILES);

  const load = async () => {
    const [sourceResponse, libraryResponse] = await Promise.all([
      fetch(`/api/cases/${matterId}/sources`),
      fetch("/api/documents?caseId=null"),
    ]);
    if (sourceResponse.ok) setSources(await sourceResponse.json());
    if (libraryResponse.ok) setLibrary(await libraryResponse.json());
  };

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(interval);
  }, [matterId]);

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
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setProcessing(true);
    setError("");
    try {
      let response: Response;
      if (type === "upload") {
        if (fileSelection.files.length === 0) return;
        if (await uploadPrivateFiles(fileSelection.files, matterId)) {
          resetAddForm();
          setShowAdd(false);
          await load();
          return;
        }
        const form = new FormData();
        if (fileSelection.files.length === 1 && title.trim()) form.append("title", title.trim());
        fileSelection.files.forEach((file) => form.append("files", file));
        response = await fetch(`/api/cases/${matterId}/sources`, { method: "POST", body: form });
      } else {
        const body = type === "library"
          ? { libraryDocumentIds: selectedLibraryIds }
          : { title, text, sourceType: "Starting Instruction" };
        response = await fetch(`/api/cases/${matterId}/sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Source could not be added");
        return;
      }
      setShowAdd(false);
      resetAddForm();
      await load();
    } catch (err) {
      await load();
      setError(err instanceof Error ? err.message : "Source could not be added");
    } finally {
      setProcessing(false);
    }
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
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded bg-zinc-950 px-4 text-[10px] font-mono font-bold uppercase text-white">
          <Plus className="h-4 w-4" />Add Source
        </button>
      </div>

      <div className="overflow-hidden rounded border">
        {visible.length === 0 ? <p className="p-10 text-center text-xs text-zinc-500">No Sources match this view.</p> : visible.map((source) => (
          <div key={source.id} className="grid grid-cols-[1fr_150px_120px_110px_70px] items-center gap-3 border-t px-4 py-3 first:border-t-0">
            <button onClick={() => setPreview(source)} className="flex min-w-0 items-center gap-2 text-left">
              <FileText className="h-4 w-4 text-zinc-400" />
              <span className="truncate text-xs font-semibold">{source.title}</span>
            </button>
            <span className="text-[9px] font-mono uppercase">{source.case_id === null ? "Linked Firm Library" : source.source_type || "Matter Upload"}{source.link_origin === "AI Suggested" && <em className="block not-italic text-zinc-400">AI Suggested</em>}</span>
            <span className="text-[10px] text-zinc-500">{source.origin || "Lawyer"}</span>
            <span className="text-[9px] font-mono uppercase">{(source.processing_state || "ready").replaceAll("_", " ")}</span>
            <span className="flex gap-3"><button onClick={() => setPreview(source)}><Eye className="h-4 w-4" /></button><button onClick={() => void remove(source)}><Trash2 className="h-4 w-4 text-zinc-400" /></button></span>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <form onSubmit={add} className="w-full max-w-lg space-y-4 rounded border bg-white p-6">
            <h3 className="text-sm font-semibold uppercase">Add Matter Source</h3>
            <div className="flex gap-2">
              {(["note", "upload", "library", ...(googleDriveEnabled ? ["drive" as const] : [])] as const).map((item) => (
                <button type="button" key={item} onClick={() => { setType(item); setError(""); }} className={`rounded border px-3 py-2 text-[9px] font-mono uppercase ${type === item ? "bg-zinc-900 text-white" : ""}`}>{item === "library" ? "Firm Library" : item}</button>
              ))}
            </div>
            {type === "drive" ? (
              <GoogleDrivePanel caseId={matterId} onImported={load} />
            ) : type === "library" ? (
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
                  <input type="file" multiple className="sr-only" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => { fileSelection.addFiles(event.target.files); event.currentTarget.value = ""; }} />
                </label>
                {fileSelection.fileError && <p className="text-xs text-red-700">{fileSelection.fileError}</p>}
                <SelectedFileList files={fileSelection.files} onRemove={fileSelection.removeFile} />
                <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded border px-3 py-2 text-xs" placeholder="Optional title for one-file upload only" />
              </div>
            ) : (
              <>
                <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded border px-3 py-2 text-xs" placeholder="Note title (optional)" />
                <textarea value={text} onChange={(event) => setText(event.target.value)} className="h-32 w-full rounded border px-3 py-2 text-xs" placeholder="Write Source note" />
              </>
            )}
            {error && <p className="text-xs text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { resetAddForm(); setShowAdd(false); }} className="rounded border px-4 py-2 text-[10px] uppercase">Cancel</button>
              {type !== "drive" && <button disabled={processing || (type === "library" ? selectedLibraryIds.length === 0 : type === "upload" ? fileSelection.files.length === 0 : !text.trim())} className="rounded bg-zinc-950 px-4 py-2 text-[10px] font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-40">{processing ? "Processing..." : "Add Source"}</button>}
            </div>
          </form>
        </div>
      )}

      {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"><div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded border bg-white p-6"><button onClick={() => setPreview(null)} className="float-right"><X className="h-4 w-4" /></button><h3 className="font-semibold">{preview.title}</h3><p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">{preview.extracted_text}</p></div></div>}
    </div>
  );
}
