import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Calendar, MessageSquare, Trash2 } from "lucide-react";
import { Case, Thread } from "../types";
import { useWorkspacePageContext } from "../lib/WorkspacePageContextProvider";

interface Props {
  cases: Case[];
  activeThreadId: string | null;
  onSelectThread: (thread: Thread) => void;
  onRefreshThreads?: () => void;
}

type SearchResult = { query: string; threads: Thread[] };

export function orderHistoryThreads(threads: Thread[]): Thread[] {
  return [...threads].sort(
    (a, b) =>
      new Date(b.last_activity_at || b.created_at).getTime() -
      new Date(a.last_activity_at || a.created_at).getTime()
  );
}

export function filterHistoryThreads(threads: Thread[], originFilter: string): Thread[] {
  if (originFilter === "general") return threads.filter((thread) => thread.case_id === null);
  if (originFilter.startsWith("matter:")) {
    return threads.filter((thread) => thread.case_id === originFilter.slice(7));
  }
  return threads;
}

export default function HistoryView({
  cases,
  activeThreadId,
  onSelectThread,
  onRefreshThreads,
}: Props) {
  const { publishPageContext } = useWorkspacePageContext();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [originFilter, setOriginFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const searchVersion = useRef(0);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/threads?history=true");
      if (response.ok) setThreads(await response.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const normalizedSearch = searchQuery.trim();
    if (!normalizedSearch) {
      searchVersion.current += 1;
      setDebouncedSearch("");
      setSearchResult(null);
      setSearching(false);
      setSearchFailed(false);
      return;
    }
    if (normalizedSearch === debouncedSearch) {
      setSearching(false);
      return;
    }
    searchVersion.current += 1;
    setSearching(true);
    setSearchFailed(false);
    const debounce = window.setTimeout(() => setDebouncedSearch(normalizedSearch), 300);
    return () => window.clearTimeout(debounce);
  }, [searchQuery]);

  useEffect(() => {
    if (!debouncedSearch) return;
    const controller = new AbortController();
    const version = searchVersion.current;
    let active = true;
    const search = async () => {
      try {
        const params = new URLSearchParams({ history: "true", search: debouncedSearch });
        const response = await fetch(`/api/threads?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error("History search failed");
        const results = await response.json();
        if (active && version === searchVersion.current) {
          setSearchResult({ query: debouncedSearch, threads: results });
        }
      } catch (error) {
        if (
          active &&
          version === searchVersion.current &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setSearchFailed(true);
        }
      } finally {
        if (active && version === searchVersion.current) setSearching(false);
      }
    };
    void search();
    return () => {
      active = false;
      controller.abort();
    };
  }, [debouncedSearch]);

  useEffect(() => {
    publishPageContext({
      routeKind: "history",
      pageTitle: "History",
      pageDescription: "Past assistant conversations ordered by recent activity and optionally searched or filtered by their General Assistant or Matter origin.",
      activeSection: "Conversation history",
      visibleSections: [
        { id: "conversation-history", title: "Conversation history", description: "A unified collection of past conversations ordered by latest activity." },
        { id: "history-search", title: "Conversation search", description: "Keyword search across authorized conversation titles and message content." },
        { id: "origin-filter", title: "Origin filter", description: "Optionally limits History to General Assistant or one Matter without changing retrieval scope." },
      ],
      visibleActions: [
        { id: "open-conversation", label: "Open", description: "Loads that conversation in the persistent assistant; Matter conversations also open their Matter." },
        { id: "delete-conversation", label: "Delete conversation", description: "Deletes the conversation while preserving associated Work Product." },
      ],
    });
  }, [publishPageContext]);

  const normalizedSearch = searchQuery.trim();
  const activeThreads = normalizedSearch && searchResult?.query === normalizedSearch
    ? searchResult.threads
    : normalizedSearch
      ? []
      : threads;
  const orderedThreads = useMemo(() => orderHistoryThreads(activeThreads), [activeThreads]);
  const matterById = useMemo(() => new Map(cases.map((matter) => [matter.id, matter])), [cases]);
  const matterOptions = useMemo(() => {
    const matterIds = new Set(
      threads.map((thread) => thread.case_id).filter((caseId): caseId is string => caseId !== null)
    );
    return cases.filter((matter) => matterIds.has(matter.id) || originFilter === `matter:${matter.id}`);
  }, [threads, cases, originFilter]);
  const filteredThreads = useMemo(
    () => filterHistoryThreads(orderedThreads, originFilter),
    [orderedThreads, originFilter]
  );

  const remove = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!confirm("Delete this conversation? Associated Work Product will be preserved.")) return;
    const response = await fetch(`/api/threads/${id}`, { method: "DELETE" });
    if (response.ok) {
      setThreads((current) => current.filter((thread) => thread.id !== id));
      setSearchResult((current) => current
        ? { ...current, threads: current.threads.filter((thread) => thread.id !== id) }
        : current);
      onRefreshThreads?.();
    }
  };

  const emptyResultMessage = normalizedSearch
    ? originFilter === "all"
      ? "No conversations match your search."
      : "No conversations match this search and filter."
    : "No conversations match this filter.";

  return (
    <div className="flex-1 h-full overflow-y-auto bg-white">
      <header className="border-b bg-zinc-50/50 px-8 py-6">
        <h2 className="text-xl font-semibold">History</h2>
        <p className="mt-1 text-xs text-zinc-500">Conversations ordered by latest activity</p>
      </header>
      <div className="mx-auto max-w-5xl space-y-5 px-8 py-8">
        {loading ? (
          <p className="py-16 text-center text-xs font-mono uppercase text-zinc-400">Loading conversations…</p>
        ) : threads.length === 0 ? (
          <div className="rounded border border-dashed p-16 text-center">
            <MessageSquare className="mx-auto mb-3 h-8 w-8 text-zinc-300" />
            <p className="text-sm font-semibold">No conversations yet</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search conversations…"
                aria-label="Search conversations"
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-950 sm:max-w-sm"
              />
              <label className="flex items-center gap-2 self-end text-xs text-zinc-500 sm:self-auto">
                <span>Show</span>
                <select
                  value={originFilter}
                  onChange={(event) => setOriginFilter(event.target.value)}
                  className="rounded border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-950"
                >
                  <option value="all">All Conversations</option>
                  <option value="general">General Assistant</option>
                  {matterOptions.map((matter) => (
                    <option key={matter.id} value={`matter:${matter.id}`}>{matter.name}</option>
                  ))}
                </select>
              </label>
            </div>
            {searching ? (
              <p className="rounded border border-dashed px-4 py-10 text-center text-xs text-zinc-500">Searching conversations…</p>
            ) : searchFailed ? (
              <p className="rounded border border-dashed px-4 py-10 text-center text-xs text-zinc-500">Unable to search conversations. Try again.</p>
            ) : filteredThreads.length === 0 ? (
              <p className="rounded border border-dashed px-4 py-10 text-center text-xs text-zinc-500">{emptyResultMessage}</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {filteredThreads.map((thread) => (
                  <button
                    key={thread.id}
                    onClick={() => onSelectThread(thread)}
                    className={`group rounded border p-4 text-left ${activeThreadId === thread.id ? "border-zinc-950 bg-zinc-50" : "border-zinc-200 hover:border-zinc-400"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="line-clamp-2 text-sm font-medium">{thread.title}</h4>
                      <button
                        onClick={(event) => void remove(thread.id, event)}
                        title="Delete conversation"
                        className="text-zinc-400 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] font-mono uppercase tracking-wide text-zinc-400">
                      {thread.case_id === null ? "General Assistant" : `Matter · ${matterById.get(thread.case_id)?.name || "Unavailable Matter"}`}
                    </p>
                    <div className="mt-4 flex items-center justify-between border-t pt-3 text-[9px] font-mono uppercase text-zinc-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(thread.last_activity_at || thread.created_at).toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1 text-zinc-700">
                        Open <ArrowRight className="h-3 w-3" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
