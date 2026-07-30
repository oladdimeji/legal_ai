import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, MessageSquarePlus } from "lucide-react";
import { Message } from "../types";
import FormattedMarkdown from "./FormattedMarkdown";

interface ClientAssistantViewProps {
  activeConversationId: string | null;
  onConversationChange: (id: string | null) => void;
}

const workingStages = [
  "Understanding your question…",
  "Preparing a clear response…",
  "Finishing the answer…",
];

export default function ClientAssistantView({
  activeConversationId,
  onConversationChange,
}: ClientAssistantViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [workingStage, setWorkingStage] = useState(0);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const revealTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      setLoadingConversation(false);
      return;
    }
    let cancelled = false;
    setLoadingConversation(true);
    setError("");
    void fetch(
      `/api/client/assistant/conversations/${encodeURIComponent(activeConversationId)}/messages`
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Conversation could not be loaded.");
        if (!cancelled) setMessages(data as Message[]);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "Conversation could not be loaded."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingConversation(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeConversationId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, workingStage]);

  useEffect(() => {
    if (!sending) return;
    const timer = window.setInterval(
      () => setWorkingStage((current) => (current + 1) % workingStages.length),
      1400
    );
    return () => window.clearInterval(timer);
  }, [sending]);

  useEffect(
    () => () => {
      if (revealTimerRef.current !== null) window.clearInterval(revealTimerRef.current);
    },
    []
  );

  const revealAssistantMessage = (message: Message) => {
    let visibleLength = 0;
    setMessages((current) => [...current, { ...message, content: "" }]);
    if (revealTimerRef.current !== null) window.clearInterval(revealTimerRef.current);
    revealTimerRef.current = window.setInterval(() => {
      visibleLength = Math.min(message.content.length, visibleLength + 16);
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? { ...item, content: message.content.slice(0, visibleLength) }
            : item
        )
      );
      if (visibleLength >= message.content.length && revealTimerRef.current !== null) {
        window.clearInterval(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    }, 18);
  };

  const createConversation = async () => {
    const response = await fetch("/api/client/assistant/conversations", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "A conversation could not be created.");
    onConversationChange(data.id);
    return String(data.id);
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setDraft("");
    setError("");
    setSending(true);
    setWorkingStage(0);
    const optimistic: Message = {
      id: `pending_${Date.now()}`,
      thread_id: activeConversationId || "",
      role: "user",
      content,
      citations: [],
      steps: null,
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    try {
      const conversationId = activeConversationId || (await createConversation());
      const response = await fetch("/api/client/assistant/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, content }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The Assistant could not respond.");
      setMessages((current) =>
        current
          .filter((message) => message.id !== optimistic.id)
          .concat(data.userMessage as Message)
      );
      revealAssistantMessage(data.assistantMessage as Message);
    } catch (caught) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setDraft(content);
      setError(caught instanceof Error ? caught.message : "The Assistant could not respond.");
    } finally {
      setSending(false);
    }
  };

  const newChat = () => {
    if (revealTimerRef.current !== null) window.clearInterval(revealTimerRef.current);
    revealTimerRef.current = null;
    setMessages([]);
    setDraft("");
    setError("");
    onConversationChange(null);
  };

  const composer = (
    <div className="rounded-xl border border-zinc-300 bg-white p-3 shadow-sm">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
        rows={3}
        placeholder="Ask a general question"
        aria-label="Message Client Assistant"
        className="w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-zinc-400"
      />
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-zinc-100 pt-2">
        <p className="text-[10px] leading-4 text-zinc-400">
          For Matter-specific advice, contact your lawyer.
        </p>
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
          aria-label="Send message"
          className="rounded-full bg-zinc-950 p-2 text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const hasConversation = messages.length > 0 || sending || loadingConversation;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-white">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 sm:px-8">
        <div>
          <h1 className="text-lg font-semibold">Assistant</h1>
          <p className="mt-1 text-xs text-zinc-500">General guidance, kept separate from Shared Matters.</p>
        </div>
        <button
          type="button"
          onClick={newChat}
          className="flex items-center gap-2 rounded border border-zinc-300 px-3 py-2 text-[10px] font-mono font-semibold uppercase hover:border-zinc-950"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" /> New Chat
        </button>
      </header>

      {!hasConversation ? (
        <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-12">
          <div className="w-full max-w-2xl">
            <div className="mb-7 text-center">
              <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.16em] text-zinc-400">
                Client Assistant
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                How can I help?
              </h2>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-zinc-500">
                Ask for clear, practical, general information. Your Shared Matters are not
                used in this chat.
              </p>
            </div>
            {composer}
            {error && <p role="alert" className="mt-3 text-center text-xs text-red-700">{error}</p>}
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7 sm:px-8">
            <div className="mx-auto max-w-3xl space-y-6">
              {loadingConversation && messages.length === 0 ? (
                <p className="py-16 text-center text-xs font-mono uppercase text-zinc-400">
                  Loading conversation…
                </p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={
                      message.role === "user"
                        ? "ml-auto max-w-[82%] rounded-xl bg-zinc-100 px-4 py-3 text-sm"
                        : "max-w-[92%] text-sm leading-7 text-zinc-800"
                    }
                  >
                    {message.role === "assistant" ? (
                      <FormattedMarkdown content={message.content} />
                    ) : (
                      message.content
                    )}
                  </div>
                ))
              )}
              {sending && (
                <div className="flex items-center gap-2 text-xs text-zinc-500" aria-live="polite">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-900" />
                  {workingStages[workingStage]}
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>
          <div className="border-t border-zinc-200 bg-white px-6 py-4 sm:px-8">
            <div className="mx-auto max-w-3xl">
              {composer}
              {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
