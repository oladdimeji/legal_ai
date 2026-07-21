import React, { useState } from "react";
import { Briefcase, Plus } from "lucide-react";
import { Case } from "../types";

interface MattersViewProps {
  matters: Case[];
  onRefresh: () => void;
  onOpenMatter: (id: string) => void;
}

export default function MattersView({ matters, onRefresh, onOpenMatter }: MattersViewProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const createMatter = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description }) });
      if (!response.ok) throw new Error((await response.json()).error || "Matter could not be created");
      const matter = await response.json();
      await onRefresh();
      setShowCreate(false); setName(""); setDescription(""); onOpenMatter(matter.id);
    } catch (error) { alert(error instanceof Error ? error.message : "Matter could not be created"); }
    finally { setSaving(false); }
  };

  return <div className="flex-1 h-full overflow-y-auto bg-white p-8"><div className="mx-auto max-w-6xl space-y-6">
    <header className="flex items-center justify-between"><div><div className="flex items-center gap-2"><Briefcase className="h-5 w-5" /><h2 className="text-lg font-bold uppercase">Matters</h2></div><p className="mt-1 text-[11px] font-mono uppercase text-zinc-400">Matter workspaces and assignments</p></div><button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white"><Plus className="h-4 w-4" />Create Matter</button></header>
    {matters.length === 0 ? <div className="rounded border border-dashed border-zinc-300 p-16 text-center"><Briefcase className="mx-auto mb-3 h-8 w-8 text-zinc-300" /><p className="text-sm font-semibold">No Matters yet</p><p className="mt-1 text-xs text-zinc-500">Create a Matter to organize Sources, Work Product, and collaboration.</p></div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{matters.map((matter) => <button key={matter.id} onClick={() => onOpenMatter(matter.id)} className="rounded border border-zinc-200 p-5 text-left hover:border-zinc-900"><div className="flex items-start justify-between gap-3"><h3 className="text-sm font-semibold">{matter.name}</h3><span className="rounded border border-zinc-300 px-2 py-1 text-[9px] font-mono uppercase">{matter.status || "Open"}</span></div><p className="mt-3 line-clamp-3 text-xs leading-relaxed text-zinc-500">{matter.description || "No assignment description."}</p><p className="mt-4 text-[9px] font-mono uppercase text-zinc-400">Created {new Date(matter.created_at).toLocaleDateString()}</p></button>)}</div>}
  </div>{showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"><form onSubmit={createMatter} className="w-full max-w-lg space-y-4 rounded border border-zinc-300 bg-white p-6 shadow-xl"><div><h3 className="text-sm font-semibold uppercase">Create Matter</h3><p className="mt-1 text-xs text-zinc-500">Matter starting-input validation is expanded in Phase 4.</p></div><input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border border-zinc-300 px-3 py-2 text-xs" placeholder="Matter name" /><textarea value={description} onChange={(e) => setDescription(e.target.value)} className="h-28 w-full rounded border border-zinc-300 px-3 py-2 text-xs" placeholder="Assignment description" /><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="rounded border px-4 py-2 text-[10px] font-mono uppercase">Cancel</button><button disabled={saving || !name.trim()} className="rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:opacity-40">{saving ? "Creating…" : "Create Matter"}</button></div></form></div>}</div>;
}
