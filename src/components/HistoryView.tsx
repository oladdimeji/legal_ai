import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, Calendar, MessageSquare, Trash2 } from "lucide-react";
import { Case, Thread } from "../types";
import { useWorkspacePageContext } from "../lib/WorkspacePageContextProvider";

interface Props { cases: Case[]; activeThreadId: string | null; onSelectThread: (thread: Thread) => void; onRefreshThreads?: () => void; }

export default function HistoryView({ cases, activeThreadId, onSelectThread, onRefreshThreads }: Props) {
  const { publishPageContext } = useWorkspacePageContext();
  const [threads, setThreads] = useState<Thread[]>([]), [loading, setLoading] = useState(true);
  const [originFilter, setOriginFilter] = useState("all");
  const load = async () => { setLoading(true); try { const response = await fetch("/api/threads?history=true"); if (response.ok) setThreads(await response.json()); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    publishPageContext({
      routeKind: "history",
      pageTitle: "History",
      pageDescription: "Past assistant conversations ordered by recent activity and optionally filtered by their General Assistant or Matter origin.",
      activeSection: "Conversation history",
      visibleSections: [
        { id: "conversation-history", title: "Conversation history", description: "A unified collection of past conversations ordered by latest activity." },
        { id: "origin-filter", title: "Origin filter", description: "Optionally limits History to General Assistant or one Matter without changing retrieval scope." },
      ],
      visibleActions: [
        { id: "open-conversation", label: "Open", description: "Loads that conversation in the persistent assistant; Matter conversations also open their Matter." },
        { id: "delete-conversation", label: "Delete conversation", description: "Deletes the conversation while preserving associated Work Product." },
      ],
    });
  }, [publishPageContext]);
  const orderedThreads = useMemo(() => [...threads].sort((a, b) => new Date(b.last_activity_at || b.created_at).getTime() - new Date(a.last_activity_at || a.created_at).getTime()), [threads]);
  const matterById = useMemo(() => new Map(cases.map((matter) => [matter.id, matter])), [cases]);
  const matterOptions = useMemo(() => {
    const matterIds = new Set(threads.map((thread) => thread.case_id).filter((caseId): caseId is string => caseId !== null));
    return cases.filter((matter) => matterIds.has(matter.id) || originFilter === `matter:${matter.id}`);
  }, [threads, cases, originFilter]);
  const filteredThreads = useMemo(() => {
    if (originFilter === "general") return orderedThreads.filter((thread) => thread.case_id === null);
    if (originFilter.startsWith("matter:")) return orderedThreads.filter((thread) => thread.case_id === originFilter.slice(7));
    return orderedThreads;
  }, [orderedThreads, originFilter]);
  const remove = async (id: string, event: React.MouseEvent) => { event.stopPropagation(); if (!confirm("Delete this conversation? Associated Work Product will be preserved.")) return; const response = await fetch(`/api/threads/${id}`, { method: "DELETE" }); if (response.ok) { setThreads((current) => current.filter((thread) => thread.id !== id)); onRefreshThreads?.(); } };

  return <div className="flex-1 h-full overflow-y-auto bg-white"><header className="border-b bg-zinc-50/50 px-8 py-6"><h2 className="text-xl font-semibold">History</h2><p className="mt-1 text-xs text-zinc-500">Conversations ordered by latest activity</p></header><div className="mx-auto max-w-5xl space-y-5 px-8 py-8">{loading ? <p className="py-16 text-center text-xs font-mono uppercase text-zinc-400">Loading conversations…</p> : orderedThreads.length === 0 ? <div className="rounded border border-dashed p-16 text-center"><MessageSquare className="mx-auto mb-3 h-8 w-8 text-zinc-300" /><p className="text-sm font-semibold">No conversations yet</p></div> : <><div className="flex justify-end"><label className="flex items-center gap-2 text-xs text-zinc-500"><span>Show</span><select value={originFilter} onChange={(event) => setOriginFilter(event.target.value)} className="rounded border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-950"><option value="all">All Conversations</option><option value="general">General Assistant</option>{matterOptions.map((matter) => <option key={matter.id} value={`matter:${matter.id}`}>{matter.name}</option>)}</select></label></div>{filteredThreads.length === 0 ? <p className="rounded border border-dashed px-4 py-10 text-center text-xs text-zinc-500">No conversations match this filter.</p> : <div className="grid gap-3 md:grid-cols-2">{filteredThreads.map((thread) => <button key={thread.id} onClick={() => onSelectThread(thread)} className={`group rounded border p-4 text-left ${activeThreadId === thread.id ? "border-zinc-950 bg-zinc-50" : "border-zinc-200 hover:border-zinc-400"}`}><div className="flex items-start justify-between gap-3"><h4 className="line-clamp-2 text-sm font-medium">{thread.title}</h4><button onClick={(event) => void remove(thread.id, event)} title="Delete conversation" className="text-zinc-400 hover:text-red-700"><Trash2 className="h-4 w-4" /></button></div><p className="mt-2 text-[10px] font-mono uppercase tracking-wide text-zinc-400">{thread.case_id === null ? "General Assistant" : `Matter · ${matterById.get(thread.case_id)?.name || "Unavailable Matter"}`}</p><div className="mt-4 flex items-center justify-between border-t pt-3 text-[9px] font-mono uppercase text-zinc-400"><span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(thread.last_activity_at || thread.created_at).toLocaleString()}</span><span className="flex items-center gap-1 text-zinc-700">Open <ArrowRight className="h-3 w-3" /></span></div></button>)}</div>}</>}</div></div>;
}
