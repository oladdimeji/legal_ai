import React, { useEffect, useMemo, useState } from "react";
import { Database, Eye, FileText, FolderOpen, Search, Trash2, Upload, X } from "lucide-react";
import { Document } from "../types";
import SelectedFileList from "./SelectedFileList";
import { useCumulativeFileSelection } from "../hooks/useCumulativeFileSelection";
import { PRIVATE_UPLOAD_MAX_FILES, uploadPrivateFiles } from "../lib/durableUploads";
import GoogleDrivePanel from "./GoogleDrivePanel";

export default function FirmLibraryView({ googleDriveImportEnabled = false, resourceLifecycleEnabled = false }: { googleDriveImportEnabled?: boolean; resourceLifecycleEnabled?: boolean }) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [semantic, setSemantic] = useState(true);
  const [section, setSection] = useState<string | null>(null);
  const [preview, setPreview] = useState<Document | null>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const fileSelection = useCumulativeFileSelection(PRIVATE_UPLOAD_MAX_FILES);

  const load = async () => {
    const response = await fetch(`/api/documents?caseId=null${resourceLifecycleEnabled && showArchived ? "&includeArchived=true" : ""}`);
    if (response.ok) setDocuments(await response.json());
  };

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(interval);
  }, [showArchived, resourceLifecycleEnabled]);

  const sections = useMemo(() => Array.from(new Set(documents.map((document) => document.section))).sort(), [documents]);
  const visible = documents.filter((document) => {
    if (section && document.section !== section) return false;
    if (!query.trim() || results.length > 0) return results.length === 0 || results.includes(document.id);
    const needle = query.toLowerCase();
    return document.title.toLowerCase().includes(needle) || document.extracted_text.toLowerCase().includes(needle);
  });

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return setResults([]);
    if (!semantic) return setResults([]);
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, scope: "wide" }),
    });
    const data = response.ok ? await response.json() : [];
    setResults(Array.from(new Set(data.map((item: { document_id: string }) => item.document_id))));
  };

  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (fileSelection.files.length === 0) return;
    setUploading(true);
    setUploadError("");
    try {
      if (await uploadPrivateFiles(fileSelection.files, null)) {
        setTitle("");
        fileSelection.clearFiles();
        await load();
        return;
      }
      const form = new FormData();
      if (fileSelection.files.length === 1 && title.trim()) form.append("title", title.trim());
      fileSelection.files.forEach((file) => form.append("files", file));
      const response = await fetch("/api/documents", { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.json()).error || "Upload failed");
      setTitle("");
      fileSelection.clearFiles();
      await load();
    } catch (error) {
      await load();
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (document: Document) => {
    if (!confirm(`Remove "${document.title}" from the Firm Library?`)) return;
    const response = await fetch(`/api/documents/${document.id}?caseId=null`, { method: "DELETE" });
    if (response.ok) {
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      if (preview?.id === document.id) setPreview(null);
    }
  };

  const bulkUpdate = async (input: Record<string, unknown>) => {
    const response = await fetch("/api/documents/bulk-lifecycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: selectedIds, ...input }),
    });
    const data = await response.json();
    if (!response.ok) return alert(data.error || "Documents could not be updated");
    setSelectedIds([]);
    await load();
  };

  const editDocument = async (document: Document, lifecycleState?: "active" | "archived") => {
    const nextTitle = lifecycleState ? undefined : prompt("Document title", document.title)?.trim();
    if (!lifecycleState && !nextTitle) return;
    const response = await fetch(`/api/documents/${document.id}?caseId=null`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lifecycleState ? { lifecycleState } : { title: nextTitle }),
    });
    const data = await response.json();
    if (!response.ok) return alert(data.error || "Document could not be updated");
    setPreview(data);
    await load();
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-white p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-2"><Database className="h-5 w-5" /><h2 className="text-lg font-bold uppercase">Firm Library</h2></div>
            <p className="mt-1 text-[11px] font-mono uppercase text-zinc-400">Reusable workspace documents and semantic search</p>
          </div>
          <div className="flex items-center gap-3"><span className="text-[10px] font-mono uppercase text-zinc-500">{documents.length} documents</span>{resourceLifecycleEnabled && <label className="text-[9px] font-mono uppercase"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="mr-1" />Show archived</label>}</div>
        </header>

        <form onSubmit={search} className="flex gap-2 rounded border border-zinc-200 bg-zinc-50 p-3">
          <Search className="h-4 w-4 self-center text-zinc-400" />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setResults([]); }} className="flex-1 bg-transparent text-xs outline-none" placeholder="Search the Firm Library" />
          <button type="button" onClick={() => { setSemantic(!semantic); setResults([]); }} className="rounded border border-zinc-300 bg-white px-3 text-[9px] font-mono uppercase hover:bg-zinc-50 cursor-pointer">{semantic ? "Semantic" : "Keyword"}</button>
          <button className="rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white hover:bg-zinc-800 cursor-pointer">Search</button>
        </form>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr_300px]">
          <aside className="rounded border border-zinc-200 p-4">
            <p className="mb-3 text-[10px] font-mono font-bold uppercase text-zinc-500">Sections</p>
            <button onClick={() => setSection(null)} className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs cursor-pointer ${section === null ? "bg-zinc-100 font-semibold" : "hover:bg-zinc-50"}`}><FolderOpen className="h-3.5 w-3.5" />All documents</button>
            {sections.map((item) => <button key={item} onClick={() => setSection(item)} className={`mb-1 block w-full rounded px-2 py-2 text-left text-xs cursor-pointer ${section === item ? "bg-zinc-100 font-semibold" : "hover:bg-zinc-50"}`}>{item}</button>)}
          </aside>

          <section className="space-y-2">
            {resourceLifecycleEnabled && selectedIds.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded border bg-zinc-50 p-3 text-[9px] font-mono uppercase"><strong>{selectedIds.length} selected</strong><button onClick={() => { const folderPath = prompt("Move to folder", "/"); if (folderPath) void bulkUpdate({ folderPath }); }} className="rounded border bg-white px-2 py-1">Move</button><button onClick={() => { const tags = prompt("Tags, comma-separated"); if (tags) void bulkUpdate({ addTags: tags.split(",") }); }} className="rounded border bg-white px-2 py-1">Tag</button><button onClick={() => void bulkUpdate({ lifecycleState: "archived" })} className="rounded border bg-white px-2 py-1">Archive</button><button onClick={() => void bulkUpdate({ lifecycleState: "active" })} className="rounded border bg-white px-2 py-1">Restore</button></div>}
            {visible.length === 0 ? <div className="rounded border border-dashed border-zinc-300 p-10 text-center text-xs text-zinc-500">No Firm Library documents match this view.</div> : visible.map((document) => (
              <div key={document.id} className="flex items-start gap-3 rounded border border-zinc-200 p-4 hover:border-zinc-400">
                {resourceLifecycleEnabled && <input type="checkbox" checked={selectedIds.includes(document.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, document.id] : current.filter((id) => id !== document.id))} />}
                <FileText className="mt-0.5 h-4 w-4 text-zinc-400" />
                <button onClick={() => setPreview(document)} className="min-w-0 flex-1 text-left cursor-pointer"><p className="truncate text-xs font-semibold">{document.title}</p><p className="mt-1 text-[10px] font-mono uppercase text-zinc-400">{document.section} · {new Date(document.uploaded_at).toLocaleDateString()} · {(document.processing_state || "ready").replaceAll("_", " ")}</p></button>
                <button onClick={() => setPreview(document)} title="Preview" className="rounded p-1 hover:bg-zinc-100 cursor-pointer"><Eye className="h-4 w-4 text-zinc-500" /></button>
                <button onClick={() => void remove(document)} title="Remove" className="rounded p-1 hover:bg-zinc-100 cursor-pointer"><Trash2 className="h-4 w-4 text-zinc-400 hover:text-red-700" /></button>
              </div>
            ))}
          </section>

          <div className="h-fit space-y-3">
          <form onSubmit={upload} className="space-y-3 rounded border border-zinc-200 bg-zinc-50 p-4">
            <div className="flex items-center gap-2"><Upload className="h-4 w-4" /><h3 className="text-[10px] font-mono font-bold uppercase">Add Firm Library Document</h3></div>
            <label className="block rounded border border-dashed border-zinc-300 bg-white px-3 py-5 text-center text-xs text-zinc-500 hover:bg-zinc-50 cursor-pointer">
              <span className="block">Choose PDF, DOCX, or TXT</span>
              <span className="mt-1 block text-[10px] font-mono uppercase">{fileSelection.files.length ? fileSelection.selectedLabel : "No files selected"}</span>
              <input type="file" multiple className="sr-only" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => { fileSelection.addFiles(event.target.files); event.currentTarget.value = ""; }} />
            </label>
            {fileSelection.fileError && <p className="text-xs text-red-700">{fileSelection.fileError}</p>}
            <SelectedFileList files={fileSelection.files} onRemove={fileSelection.removeFile} />
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-xs" placeholder="Optional title for one-file upload only" />
            {uploadError && <p className="text-xs text-red-700">{uploadError}</p>}
            <button disabled={uploading || fileSelection.files.length === 0} className="w-full rounded bg-zinc-950 px-3 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-40">{uploading ? "Uploading..." : "Upload for processing"}</button>
          </form>
          {googleDriveImportEnabled && <GoogleDrivePanel caseId={null} onImported={load} compact />}
          </div>
        </div>
      </div>

      {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"><div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded border border-zinc-300 bg-white shadow-xl"><header className="flex items-center justify-between border-b p-4"><div><h3 className="text-sm font-semibold">{preview.title}</h3><p className="text-[10px] font-mono uppercase text-zinc-400">Firm Library · {preview.section} · {preview.folder_path || "/"}</p>{resourceLifecycleEnabled && <p className="mt-1 text-[9px] font-mono uppercase text-zinc-500">{preview.tags?.join(", ") || "No tags"} · {preview.lifecycle_state || "active"}</p>}</div><div className="flex gap-2">{resourceLifecycleEnabled && <><button onClick={() => void editDocument(preview)} className="rounded border px-2 py-1 text-[9px] font-mono uppercase">Rename</button><button onClick={() => void editDocument(preview, preview.lifecycle_state === "archived" ? "active" : "archived")} className="rounded border px-2 py-1 text-[9px] font-mono uppercase">{preview.lifecycle_state === "archived" ? "Restore" : "Archive"}</button></>}<button onClick={() => setPreview(null)} className="rounded p-1 hover:bg-zinc-100"><X className="h-4 w-4" /></button></div></header><div className="overflow-y-auto whitespace-pre-wrap p-6 text-sm leading-relaxed text-zinc-700">{preview.extracted_text}</div></div></div>}
    </div>
  );
}
