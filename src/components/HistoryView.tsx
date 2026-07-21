import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, Calendar, MessageSquare, Trash2 } from "lucide-react";
import { Case, Thread } from "../types";

interface Props { cases: Case[]; activeThreadId: string | null; onSelectThread: (thread: Thread) => void; onRefreshThreads?: () => void; }

export default function HistoryView({ cases, activeThreadId, onSelectThread, onRefreshThreads }: Props) {
  const [threads, setThreads] = useState<Thread[]>([]), [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); try { const response = await fetch("/api/threads?history=true"); if (response.ok) setThreads(await response.json()); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const groups = useMemo(() => {
    const ordered = [...threads].sort((a, b) => new Date(b.last_activity_at || b.created_at).getTime() - new Date(a.last_activity_at || a.created_at).getTime());
    const result: { id: string; title: string; threads: Thread[] }[] = [{ id: "general", title: "General Assistant", threads: ordered.filter((thread) => thread.case_id === null) }];
    for (const matter of cases) { const items = ordered.filter((thread) => thread.case_id === matter.id); if (items.length) result.push({ id: matter.id, title: matter.name, threads: items }); }
    return result.filter((group) => group.threads.length);
  }, [threads, cases]);
  const remove = async (id: string, event: React.MouseEvent) => { event.stopPropagation(); if (!confirm("Delete this conversation? Associated Work Product will be preserved.")) return; const response = await fetch(`/api/threads/${id}`, { method: "DELETE" }); if (response.ok) { setThreads((current) => current.filter((thread) => thread.id !== id)); onRefreshThreads?.(); } };
  return <div className="flex-1 h-full overflow-y-auto bg-white"><header className="border-b bg-zinc-50/50 px-8 py-6"><h2 className="text-xl font-semibold">History</h2><p className="mt-1 text-xs text-zinc-500">Conversations grouped by General Assistant and Matter context</p></header><div className="mx-auto max-w-5xl space-y-8 px-8 py-8">{loading ? <p className="py-16 text-center text-xs font-mono uppercase text-zinc-400">Loading conversations…</p> : groups.length === 0 ? <div className="rounded border border-dashed p-16 text-center"><MessageSquare className="mx-auto mb-3 h-8 w-8 text-zinc-300" /><p className="text-sm font-semibold">No conversations yet</p></div> : groups.map((group) => <section key={group.id}><h3 className="mb-3 border-b pb-2 text-xs font-mono font-bold uppercase tracking-wider">{group.title} <span className="text-zinc-400">({group.threads.length})</span></h3><div className="grid gap-3 md:grid-cols-2">{group.threads.map((thread) => <button key={thread.id} onClick={() => onSelectThread(thread)} className={`group rounded border p-4 text-left ${activeThreadId === thread.id ? "border-zinc-950 bg-zinc-50" : "border-zinc-200 hover:border-zinc-400"}`}><div className="flex items-start justify-between gap-3"><h4 className="line-clamp-2 text-sm font-medium">{thread.title}</h4><button onClick={(event) => void remove(thread.id, event)} title="Delete conversation" className="text-zinc-400 hover:text-red-700"><Trash2 className="h-4 w-4" /></button></div><div className="mt-4 flex items-center justify-between border-t pt-3 text-[9px] font-mono uppercase text-zinc-400"><span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(thread.last_activity_at || thread.created_at).toLocaleString()}</span><span className="flex items-center gap-1 text-zinc-700">Open <ArrowRight className="h-3 w-3" /></span></div></button>)}</div></section>)}</div></div>;
}
