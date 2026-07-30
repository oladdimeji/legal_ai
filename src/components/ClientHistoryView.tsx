import React, { useEffect, useState } from "react";
import { ArrowRight, Calendar, MessageSquare, Trash2 } from "lucide-react";
import { Thread } from "../types";

interface ClientHistoryViewProps {
  onOpen: (threadId: string) => void;
}

export default function ClientHistoryView({ onOpen }: ClientHistoryViewProps) {
  const [conversations, setConversations] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/client/assistant/conversations");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "History could not be loaded.");
      setConversations(data as Thread[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "History could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const remove = async (id: string) => {
    if (!window.confirm("Delete this conversation?")) return;
    const response = await fetch(
      `/api/client/assistant/conversations/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    if (response.ok) {
      setConversations((current) => current.filter((conversation) => conversation.id !== id));
      return;
    }
    const data = await response.json();
    setError(data.error || "Conversation could not be deleted.");
  };

  return (
    <div className="h-full flex-1 overflow-y-auto bg-white">
      <header className="border-b border-zinc-200 bg-zinc-50/50 px-6 py-6 sm:px-8">
        <h1 className="text-xl font-semibold">History</h1>
        <p className="mt-1 text-xs text-zinc-500">Your Client Assistant conversations.</p>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
        {loading ? (
          <p className="py-16 text-center text-xs font-mono uppercase text-zinc-400">
            Loading conversations…
          </p>
        ) : error ? (
          <div role="alert" className="rounded border border-zinc-300 bg-zinc-50 p-4 text-sm">
            <p>{error}</p>
            <button type="button" onClick={() => void load()} className="mt-3 text-xs underline">
              Try again
            </button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="rounded border border-dashed border-zinc-300 px-6 py-16 text-center">
            <MessageSquare className="mx-auto h-8 w-8 text-zinc-300" />
            <h2 className="mt-4 text-sm font-semibold">No conversations yet</h2>
            <p className="mt-1 text-xs text-zinc-500">New Assistant chats will appear here.</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {conversations.map((conversation) => (
              <article key={conversation.id} className="rounded border border-zinc-200 p-4">
                <div className="flex min-h-12 items-start justify-between gap-3">
                  <h2 className="line-clamp-2 text-sm font-medium">{conversation.title}</h2>
                  <button
                    type="button"
                    onClick={() => void remove(conversation.id)}
                    aria-label={`Delete ${conversation.title}`}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3">
                  <span className="flex items-center gap-1 text-[9px] font-mono uppercase text-zinc-400">
                    <Calendar className="h-3 w-3" />
                    {new Date(
                      conversation.last_activity_at || conversation.created_at
                    ).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpen(conversation.id)}
                    className="flex items-center gap-1 text-[9px] font-mono font-semibold uppercase text-zinc-700 hover:text-zinc-950"
                  >
                    Open <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
