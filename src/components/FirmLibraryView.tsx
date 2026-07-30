import React, { useEffect, useMemo, useState } from "react";
import { Database, Eye, FileText, FolderOpen, Search, Trash2, Upload, X } from "lucide-react";
import { Document } from "../types";
import SelectedFileList from "./SelectedFileList";
import WorkProductDocument from "./WorkProductDocument";
import { useCumulativeFileSelection } from "../hooks/useCumulativeFileSelection";

export default function FirmLibraryView() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [semantic, setSemantic] = useState(true);
  const [section, setSection] = useState<string | null>(null);
  const [preview, setPreview] = useState<Document | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileSelection = useCumulativeFileSelection();

  const load = async () => {
    const response = await fetch("/api/documents?caseId=null");
    if (response.ok) setDocuments(await response.json());
  };

  useEffect(() => { void load(); }, []);

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
      const form = new FormData();
      fileSelection.files.forEach((file) => form.append("files", file));
      const response = await fetch("/api/documents", { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.json()).error || "Upload failed");
      fileSelection.clearFiles();
      await load();
    } catch (error) {
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

  return (
    <div className="flex-1 h-full overflow-y-auto bg-white p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-2"><Database className="h-5 w-5" /><h2 className="text-lg font-bold uppercase">Firm Library</h2></div>
            <p className="mt-1 text-[11px] font-mono uppercase text-zinc-400">Reusable workspace documents and semantic search</p>
          </div>
          <span className="text-[10px] font-mono uppercase text-zinc-500">{documents.length} documents</span>
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
            {visible.length === 0 ? <div className="rounded border border-dashed border-zinc-300 p-10 text-center text-xs text-zinc-500">No Firm Library documents match this view.</div> : visible.map((document) => (
              <div key={document.id} className="flex items-start gap-3 rounded border border-zinc-200 p-4 hover:border-zinc-400">
                <FileText className="mt-0.5 h-4 w-4 text-zinc-400" />
                <button onClick={() => setPreview(document)} className="min-w-0 flex-1 text-left cursor-pointer"><p className="truncate text-xs font-semibold">{document.title}</p><p className="mt-1 text-[10px] font-mono uppercase text-zinc-400">{document.section} · {new Date(document.uploaded_at).toLocaleDateString()}</p></button>
                <button onClick={() => setPreview(document)} title="Preview" className="rounded p-1 hover:bg-zinc-100 cursor-pointer"><Eye className="h-4 w-4 text-zinc-500" /></button>
                <button onClick={() => void remove(document)} title="Remove" className="rounded p-1 hover:bg-zinc-100 cursor-pointer"><Trash2 className="h-4 w-4 text-zinc-400 hover:text-red-700" /></button>
              </div>
            ))}
          </section>

          <form onSubmit={upload} className="h-fit space-y-3 rounded border border-zinc-200 bg-zinc-50 p-4">
            <div className="flex items-center gap-2"><Upload className="h-4 w-4" /><h3 className="text-[10px] font-mono font-bold uppercase">Add Firm Library Document</h3></div>
            <label className="block rounded border border-dashed border-zinc-300 bg-white px-3 py-5 text-center text-xs text-zinc-500 hover:bg-zinc-50 cursor-pointer">
              <span className="block">Choose PDF, DOCX, or TXT</span>
              <span className="mt-1 block text-[10px] font-mono uppercase">{fileSelection.files.length ? fileSelection.selectedLabel : "No files selected"}</span>
              <input type="file" multiple className="sr-only" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => { fileSelection.addFiles(event.target.files); event.currentTarget.value = ""; }} />
            </label>
            {fileSelection.fileError && <p className="text-xs text-red-700">{fileSelection.fileError}</p>}
            <SelectedFileList files={fileSelection.files} onRemove={fileSelection.removeFile} />
            {uploadError && <p className="text-xs text-red-700">{uploadError}</p>}
            <button disabled={uploading || fileSelection.files.length === 0} className="w-full rounded bg-zinc-950 px-3 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-40">{uploading ? "Processing..." : "Upload and index"}</button>
          </form>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded border bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-100 px-6 py-4">
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{preview.title}</h3>
                <p className="text-[10px] font-mono uppercase text-zinc-400">Firm Library · {preview.section}</p>
              </div>
              <button onClick={() => setPreview(null)} aria-label="Close Firm Library preview" className="shrink-0 rounded p-1 hover:bg-zinc-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50 px-6 py-8">
              <div className="mx-auto min-h-full max-w-3xl rounded border border-zinc-100 bg-white px-8 py-10 shadow-sm">
                {preview.extracted_text?.trim()
                  ? <WorkProductDocument content={preview.extracted_text} />
                  : <p className="text-sm text-zinc-500">No extracted content is available for this Firm Library document.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
