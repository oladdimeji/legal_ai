import React, { useEffect, useState } from "react";
import { Thread, Case } from "../types";
import { Calendar, MessageSquare, ArrowRight, Trash2, ShieldAlert } from "lucide-react";

interface HistoryViewProps {
  cases: Case[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onRefreshThreads?: () => void;
}

export default function HistoryView({ 
  cases, 
  activeThreadId, 
  onSelectThread,
  onRefreshThreads 
}: HistoryViewProps) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAllThreads = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/threads");
      const data = await res.json();
      // Sort threads by created_at descending
      const sorted = data.sort((a: Thread, b: Thread) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setThreads(sorted);
    } catch (err) {
      console.error("Error fetching threads in history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllThreads();
  }, []);

  const handleDeleteThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent clicking the thread
    if (!confirm("Are you sure you want to delete this thread from your history?")) {
      return;
    }
    try {
      await fetch(`/api/threads/${threadId}`, { method: "DELETE" });
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (onRefreshThreads) {
        onRefreshThreads();
      }
    } catch (err) {
      console.error("Failed to delete thread:", err);
    }
  };

  const getCaseName = (caseId: string | null) => {
    if (!caseId) return "Wide Library Context";
    const c = cases.find((item) => item.id === caseId);
    return c ? `Case: ${c.name}` : "Workspace Case";
  };

  // Group threads by recency
  const getGroupedThreads = () => {
    const now = new Date();
    const today: Thread[] = [];
    const yesterday: Thread[] = [];
    const thisWeek: Thread[] = [];
    const older: Thread[] = [];

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const startOfThisWeek = new Date(startOfToday);
    startOfThisWeek.setDate(startOfThisWeek.getDate() - now.getDay());

    threads.forEach((t) => {
      const date = new Date(t.created_at);
      if (date >= startOfToday) {
        today.push(t);
      } else if (date >= startOfYesterday) {
        yesterday.push(t);
      } else if (date >= startOfThisWeek) {
        thisWeek.push(t);
      } else {
        older.push(t);
      }
    });

    return { today, yesterday, thisWeek, older };
  };

  const { today, yesterday, thisWeek, older } = getGroupedThreads();

  const renderThreadGroup = (title: string, groupThreads: Thread[]) => {
    if (groupThreads.length === 0) return null;

    return (
      <div className="mb-8" id={`group-${title.toLowerCase().replace(/\s+/g, "-")}`}>
        <h3 className="text-xs font-mono font-medium text-zinc-400 uppercase tracking-widest mb-3 border-b border-zinc-100 pb-1">
          {title} ({groupThreads.length})
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groupThreads.map((thread) => {
            const isCurrent = thread.id === activeThreadId;
            return (
              <div
                key={thread.id}
                id={`thread-card-${thread.id}`}
                onClick={() => onSelectThread(thread.id)}
                className={`p-5 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between group ${
                  isCurrent
                    ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-950"
                    : "border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50"
                }`}
              >
                <div>
                  <div className="flex justify-between items-start gap-4 mb-2">
                    <span className="text-[10px] font-mono uppercase bg-zinc-100 px-2 py-0.5 rounded text-zinc-500 font-semibold tracking-wider">
                      {getCaseName(thread.case_id)}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400">
                      {new Date(thread.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <h4 className="font-sans font-medium text-sm text-zinc-800 line-clamp-2 leading-snug mb-3 pr-6">
                    {thread.title}
                  </h4>
                </div>
                
                <div className="flex items-center justify-between border-t border-zinc-100 pt-3 mt-1">
                  <span className="text-[10px] font-mono text-zinc-400 flex items-center gap-1.5">
                    <Calendar className="h-3 w-3" />
                    {new Date(thread.created_at).toLocaleDateString()}
                  </span>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => handleDeleteThread(thread.id, e)}
                      id={`delete-btn-${thread.id}`}
                      className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Delete Thread"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-xs font-mono font-semibold text-zinc-800 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      Open <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-white" id="history-view-container">
      {/* View Header */}
      <div className="border-b border-zinc-100 py-6 px-8 flex justify-between items-center bg-zinc-50/50">
        <div>
          <h2 className="text-xl font-sans font-semibold tracking-tight text-zinc-950">Consultation History</h2>
          <p className="text-xs text-zinc-500 mt-1">Review, delete, or load your previous legal research consultations</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20" id="history-loading">
            <div className="animate-pulse flex space-x-2 items-center">
              <div className="w-2.5 h-2.5 bg-zinc-800 rounded-full animate-bounce"></div>
              <div className="w-2.5 h-2.5 bg-zinc-800 rounded-full animate-bounce [animation-delay:0.2s]"></div>
              <div className="w-2.5 h-2.5 bg-zinc-800 rounded-full animate-bounce [animation-delay:0.4s]"></div>
            </div>
            <p className="text-xs font-mono text-zinc-400 mt-4 uppercase tracking-wider">Loading past conversations...</p>
          </div>
        ) : threads.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-zinc-200 rounded-xl max-w-md mx-auto mt-8" id="history-empty">
            <MessageSquare className="h-8 w-8 text-zinc-300 mx-auto mb-4" />
            <h3 className="font-sans font-medium text-sm text-zinc-800 mb-1">No Past Conversations</h3>
            <p className="text-xs text-zinc-500 max-w-xs mx-auto mb-6">
              Your research threads will automatically be saved here once you begin consulting the Legal Assistant.
            </p>
          </div>
        ) : (
          <div id="history-groups-list">
            {renderThreadGroup("Today", today)}
            {renderThreadGroup("Yesterday", yesterday)}
            {renderThreadGroup("This Week", thisWeek)}
            {renderThreadGroup("Older", older)}
          </div>
        )}
      </div>
    </div>
  );
}
