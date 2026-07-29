import React, { useEffect, useMemo, useState } from "react";
import { Briefcase, Check, ChevronDown, Grid2X2, List, Plus, Search, Upload, X } from "lucide-react";
import { Case, Document } from "../types";
import SelectedFileList from "./SelectedFileList";
import { useCumulativeFileSelection } from "../hooks/useCumulativeFileSelection";

interface Props { matters: Case[]; onRefresh: () => Promise<void> | void; onOpenMatter: (id: string) => void; }
type Sort = "activity" | "created" | "name";

export default function MattersView({ matters, onRefresh, onOpenMatter }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("activity");
  const [view, setView] = useState<"cards" | "list">("cards");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [library, setLibrary] = useState<Document[]>([]);
  const [selectedLibrary, setSelectedLibrary] = useState<string[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [lifecycleMatters, setLifecycleMatters] = useState<Case[]>(matters);
  const fileSelection = useCumulativeFileSelection();

  useEffect(() => {
    if (!showArchived) return setLifecycleMatters(matters);
    void fetch("/api/cases?includeArchived=true").then(async (response) => {
      if (response.ok) setLifecycleMatters(await response.json());
    });
  }, [matters, showArchived]);

  const shown = useMemo(() => lifecycleMatters.filter((matter) => `${matter.name} ${matter.client_name || ""}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    const field = sort === "created" ? "created_at" : "last_activity_at";
    return new Date((b[field] || b.created_at) as string).getTime() - new Date((a[field] || a.created_at) as string).getTime();
  }), [lifecycleMatters, query, sort]);

  const openCreate = async () => {
    const response = await fetch("/api/documents?caseId=null");
    setLibrary(response.ok ? await response.json() : []);
    setShowCreate(true);
  };

  const reset = () => {
    setName("");
    setDescription("");
    setSelectedLibrary([]);
    fileSelection.clearFiles();
    setStatus("");
    setLibraryOpen(false);
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !description.trim() || saving) return;
    setSaving(true);
    setStatus("Creating...");
    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("description", description.trim());
      form.append("libraryDocumentIds", JSON.stringify(selectedLibrary));
      fileSelection.files.forEach((file) => form.append("files", file));
      if (fileSelection.files.length || selectedLibrary.length) setStatus("Uploading sources...");
      const response = await fetch("/api/cases", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Matter could not be created");
      await onRefresh();
      setShowCreate(false);
      reset();
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        alert(`Matter created, but an optional source needs attention: ${data.warnings.join(" ")}`);
      }
      onOpenMatter(data.id);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Matter could not be created");
    } finally {
      setSaving(false);
      setStatus("");
    }
  };

  return <div className="flex-1 h-full overflow-y-auto bg-white p-8"><div className="mx-auto max-w-6xl space-y-6">
    <header className="flex items-center justify-between"><div><div className="flex items-center gap-2"><Briefcase className="h-5 w-5" /><h2 className="text-lg font-bold uppercase">Matters</h2></div><p className="mt-1 text-[11px] font-mono uppercase text-zinc-400">Matter workspaces and assignments</p></div><div className="flex items-center gap-3"><label className="text-[9px] font-mono uppercase"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="mr-1" />Show archived</label><button onClick={() => void openCreate()} className="flex items-center gap-2 rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white hover:bg-zinc-800 cursor-pointer"><Plus className="h-4 w-4" />Create Matter</button></div></header>
    <div className="flex flex-wrap gap-2 rounded border border-zinc-200 bg-zinc-50 p-3"><div className="flex min-w-64 flex-1 items-center gap-2 rounded border bg-white px-3"><Search className="h-4 w-4 text-zinc-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} className="w-full py-2 text-xs outline-none" placeholder="Search Matter name or client" /></div><select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded border border-zinc-300 bg-white px-3 text-[10px] font-mono uppercase"><option value="activity">Last activity</option><option value="created">Created date</option><option value="name">Name</option></select><button onClick={() => setView("cards")} className={`rounded border p-2 cursor-pointer ${view === "cards" ? "bg-zinc-900 text-white" : "bg-white hover:bg-zinc-50"}`}><Grid2X2 className="h-4 w-4" /></button><button onClick={() => setView("list")} className={`rounded border p-2 cursor-pointer ${view === "list" ? "bg-zinc-900 text-white" : "bg-white hover:bg-zinc-50"}`}><List className="h-4 w-4" /></button></div>
    {shown.length === 0 ? <div className="rounded border border-dashed p-16 text-center text-xs text-zinc-500">No Matters match this view.</div> : view === "cards" ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{shown.map((m) => <button key={m.id} onClick={() => onOpenMatter(m.id)} className="rounded border border-zinc-200 p-5 text-left hover:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-400 cursor-pointer"><div className="flex justify-between gap-3"><h3 className="text-sm font-semibold">{m.name}</h3><Status value={m.status || "Open"} /></div>{m.client_name && <p className="mt-2 text-xs text-zinc-600">{m.client_name}</p>}<p className="mt-4 text-[9px] font-mono uppercase text-zinc-400">Last activity {new Date(m.last_activity_at || m.created_at).toLocaleDateString()}</p></button>)}</div> : <div className="overflow-hidden rounded border border-zinc-200"><div className="grid grid-cols-[2fr_1.2fr_1fr_1.2fr_1fr_1fr] gap-3 bg-zinc-50 px-4 py-3 text-[9px] font-mono font-bold uppercase text-zinc-500"><span>Matter</span><span>Client</span><span>Status</span><span>Practice area</span><span>Last activity</span><span>Created</span></div>{shown.map((m) => <button key={m.id} onClick={() => onOpenMatter(m.id)} className="grid w-full grid-cols-[2fr_1.2fr_1fr_1.2fr_1fr_1fr] gap-3 border-t px-4 py-3 text-left text-xs hover:bg-zinc-50 cursor-pointer"><strong>{m.name}</strong><span>{m.client_name || "-"}</span><Status value={m.status || "Open"} /><span>{m.matter_type || "-"}</span><span>{new Date(m.last_activity_at || m.created_at).toLocaleDateString()}</span><span>{new Date(m.created_at).toLocaleDateString()}</span></button>)}</div>}
  </div>{showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-5"><form onSubmit={create} className="max-h-[92vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded border border-zinc-300 bg-white p-6 shadow-xl"><div className="flex items-start justify-between"><div><h3 className="text-sm font-semibold uppercase">Create Matter</h3><p className="mt-1 text-xs text-zinc-500">Matter name and assignment description are required.</p></div><button type="button" onClick={() => setShowCreate(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"><X className="h-4 w-4" /></button></div><Input label="Matter name *" value={name} onChange={setName} /><label className="block text-[10px] font-mono font-bold uppercase text-zinc-500">Assignment description *<textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 h-28 w-full rounded border px-3 py-2 text-xs font-sans font-normal normal-case focus:outline-none focus:ring-1 focus:ring-zinc-400" /></label><div className="grid gap-3 md:grid-cols-2"><label className="flex cursor-pointer items-center justify-between rounded border border-zinc-200 px-3 py-2 text-xs hover:bg-zinc-50"><span className="flex items-center gap-2"><Upload className="h-4 w-4" />Optional files</span><span className="text-[10px] text-zinc-500">{fileSelection.files.length ? fileSelection.selectedLabel : ""}</span><input type="file" className="sr-only" multiple accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => { fileSelection.addFiles(event.target.files); event.currentTarget.value = ""; }} /></label><div className="relative"><button type="button" onClick={() => setLibraryOpen(!libraryOpen)} className="flex w-full items-center justify-between rounded border border-zinc-200 px-3 py-2 text-xs hover:bg-zinc-50"><span>{selectedLibrary.length ? `${selectedLibrary.length} Firm Library selected` : "Optional Firm Library"}</span><ChevronDown className="h-4 w-4" /></button>{libraryOpen && <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border bg-white p-2 shadow-lg">{library.length === 0 ? <p className="p-3 text-xs text-zinc-400">No Firm Library documents.</p> : library.map((document) => <label key={document.id} className="flex items-center gap-2 rounded px-2 py-2 text-xs hover:bg-zinc-50"><input type="checkbox" checked={selectedLibrary.includes(document.id)} onChange={(e) => setSelectedLibrary((current) => e.target.checked ? Array.from(new Set([...current, document.id])) : current.filter((id) => id !== document.id))} />{document.title}</label>)}</div>}</div></div>{fileSelection.fileError && <p className="text-xs text-red-700">{fileSelection.fileError}</p>}<SelectedFileList files={fileSelection.files} onRemove={fileSelection.removeFile} /><div className="flex items-center justify-between gap-2"><span className="text-xs text-zinc-500">{status}</span><div className="flex gap-2"><button type="button" onClick={() => { reset(); setShowCreate(false); }} className="rounded border px-4 py-2 text-[10px] font-mono uppercase hover:bg-zinc-50">Cancel</button><button disabled={saving || !name.trim() || !description.trim()} className="inline-flex items-center gap-2 rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-40">{saving && <Check className="h-3.5 w-3.5 animate-pulse" />}{saving ? status || "Creating..." : "Create Matter"}</button></div></div></form></div>}</div>;
}

function Status({ value }: { value: string }) { return <span className="h-fit rounded border border-zinc-300 px-2 py-1 text-[9px] font-mono uppercase">{value}</span>; }
function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="text-[10px] font-mono font-bold uppercase text-zinc-500">{label}<input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded border px-3 py-2 text-xs font-sans font-normal normal-case focus:outline-none focus:ring-1 focus:ring-zinc-400" /></label>; }
