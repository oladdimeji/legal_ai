import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronDown, FileText, MessageSquarePlus, Paperclip, X } from "lucide-react";
import { Message } from "../types";
import FormattedMarkdown from "./FormattedMarkdown";

interface ClientAssistantViewProps {
  activeConversationId: string | null;
  onConversationChange: (id: string | null) => void;
}

interface ClientAssistantDocument {
  id: string;
  title: string;
  matter_name: string;
  processing_state: "Ready";
  file_type: "Work Product";
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
  const [documents, setDocuments] = useState<ClientAssistantDocument[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState("");
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

  const loadDocuments = async () => {
    setDocumentsLoading(true);
    setDocumentsError("");
    try {
      const response = await fetch("/api/client/assistant/documents");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Shared documents could not be loaded.");
      const available = data as ClientAssistantDocument[];
      setDocuments(available);
      const availableIds = new Set(available.map((document) => document.id));
      setSelectedDocumentIds((current) => current.filter((id) => availableIds.has(id)));
    } catch (caught) {
      setDocumentsError(
        caught instanceof Error ? caught.message : "Shared documents could not be loaded."
      );
    } finally {
      setDocumentsLoading(false);
    }
  };

  const groupedDocuments = useMemo(() => {
    const groups = new Map<string, ClientAssistantDocument[]>();
    for (const document of documents) {
      const group = groups.get(document.matter_name) || [];
      group.push(document);
      groups.set(document.matter_name, group);
    }
    return Array.from(groups.entries());
  }, [documents]);

  const selectedDocuments = selectedDocumentIds
    .map((id) => documents.find((document) => document.id === id))
    .filter((document): document is ClientAssistantDocument => Boolean(document));

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
    const documentIdsForMessage = [...selectedDocumentIds];
    const documentsForMessage = [...selectedDocuments];
    setDraft("");
    setError("");
    setSending(true);
    setWorkingStage(0);
    setDocumentPickerOpen(false);
    const optimistic: Message = {
      id: `pending_${Date.now()}`,
      thread_id: activeConversationId || "",
      role: "user",
      content,
      citations: [],
      steps: null,
      created_at: new Date().toISOString(),
      metadata: documentsForMessage.length
        ? {
            selectedDocuments: documentsForMessage.map((document) => ({
              id: document.id,
              title: document.title,
              matterName: document.matter_name,
            })),
          }
        : {},
    };
    setMessages((current) => [...current, optimistic]);
    try {
      const conversationId = activeConversationId || (await createConversation());
      const response = await fetch("/api/client/assistant/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          content,
          documentIds: documentIdsForMessage,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The Assistant could not respond.");
      setMessages((current) =>
        current
          .filter((message) => message.id !== optimistic.id)
          .concat(data.userMessage as Message)
      );
      revealAssistantMessage(data.assistantMessage as Message);
      setSelectedDocumentIds([]);
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
    setSelectedDocumentIds([]);
    setDocumentPickerOpen(false);
    onConversationChange(null);
  };

  const composer = (
    <div className="relative rounded-xl border border-zinc-300 bg-white p-3 shadow-sm">
      {selectedDocuments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5 px-1">
          {selectedDocuments.map((document) => (
            <span key={document.id} className="flex max-w-full items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-[10px]">
              <FileText className="h-3 w-3 shrink-0" />
              <span className="max-w-48 truncate">{document.title}</span>
              <button
                type="button"
                onClick={() =>
                  setSelectedDocumentIds((current) =>
                    current.filter((id) => id !== document.id)
                  )
                }
                aria-label={`Remove ${document.title}`}
                className="rounded-full p-0.5 hover:bg-zinc-200"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
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
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              const opening = !documentPickerOpen;
              setDocumentPickerOpen(opening);
              if (opening) void loadDocuments();
            }}
            aria-expanded={documentPickerOpen}
            disabled={sending}
            className="flex items-center gap-1.5 rounded px-2 py-1.5 text-[10px] font-mono font-semibold uppercase text-zinc-600 hover:bg-zinc-100"
          >
            <Paperclip className="h-3.5 w-3.5" />
            Attach documents
            <ChevronDown className={`h-3 w-3 transition-transform ${documentPickerOpen ? "rotate-180" : ""}`} />
          </button>
          {documentPickerOpen && (
            <div className="absolute bottom-full left-0 z-30 mb-2 max-h-72 w-[min(22rem,calc(100vw-5rem))] overflow-y-auto rounded border border-zinc-200 bg-white p-3 shadow-xl">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-mono font-semibold uppercase text-zinc-500">
                  Shared documents
                </p>
                <button type="button" onClick={() => setDocumentPickerOpen(false)} aria-label="Close document picker" className="rounded p-1 hover:bg-zinc-100">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {documentsLoading ? (
                <p className="py-8 text-center text-xs text-zinc-400">Loading documents…</p>
              ) : documentsError ? (
                <div role="alert" className="py-5 text-xs text-red-700">
                  <p>{documentsError}</p>
                  <button type="button" onClick={() => void loadDocuments()} className="mt-2 underline">
                    Try again
                  </button>
                </div>
              ) : groupedDocuments.length === 0 ? (
                <p className="py-8 text-center text-xs text-zinc-500">
                  No shared documents are available.
                </p>
              ) : (
                <div className="mt-3 space-y-4">
                  {groupedDocuments.map(([matterName, matterDocuments]) => (
                    <fieldset key={matterName}>
                      <legend className="mb-1.5 text-[9px] font-mono font-semibold uppercase text-zinc-400">
                        {matterName}
                      </legend>
                      <div className="space-y-1">
                        {matterDocuments.map((document) => (
                          <label key={document.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-xs hover:bg-zinc-50">
                            <input
                              type="checkbox"
                              disabled={sending}
                              checked={selectedDocumentIds.includes(document.id)}
                              onChange={(event) =>
                                setSelectedDocumentIds((current) =>
                                  event.target.checked
                                    ? [...current, document.id]
                                    : current.filter((id) => id !== document.id)
                                )
                              }
                              className="mt-0.5"
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{document.title}</span>
                              <span className="mt-0.5 block text-[9px] font-mono uppercase text-zinc-400">
                                {document.file_type} · {document.processing_state}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
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
                Ask for clear, practical information. Shared documents are used only when
                you attach them to a message.
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
                      <div>
                        <p>{message.content}</p>
                        {Array.isArray(message.metadata?.selectedDocuments) && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {(message.metadata.selectedDocuments as Array<{ id: string; title: string }>).map((document) => (
                              <span key={document.id} className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[9px] text-zinc-500">
                                {document.title}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
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
