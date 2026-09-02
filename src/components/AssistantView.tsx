import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { 
  MessageSquare, Send, AlertCircle, AudioLines,
  ChevronDown, ChevronUp, FileText, Check, Paperclip, RefreshCw, 
  ExternalLink, BookOpen, Copy, X, Briefcase,
  Folder, ThumbsUp, ThumbsDown,
  Bold, Italic, Underline, Strikethrough, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Scissors,
  Clipboard, Undo2, Redo2, Save, Link as LinkIcon, Download
} from "lucide-react";
import { AssistantDocumentReference, Message, Citation, ResearchStep, WorkspacePageContext } from "../types";
import FormattedMarkdown from "./FormattedMarkdown";
import FileSourcePicker from "./FileSourcePicker";
import { browserFileIdentity, MAX_SELECTED_FILES } from "../hooks/useCumulativeFileSelection";
import { stripAssistantInlineCitations } from "../lib/assistantCitations";
import { isDocumentConfirmationContent } from "../lib/documentConfirmation";
import { downloadDocx } from "../lib/downloadDocx";
import {
  advanceWorkingActivityIndex,
  buildAssistantWorkingActivities,
  visibleAssistantWorkingActivities,
  type WorkingActivity,
} from "../lib/assistantWorkingActivities";
import { useVoiceMode } from "../hooks/useVoiceMode";
import {
  consumeAssistantTurnResponse,
  isAssistantNdjsonResponse,
} from "../lib/assistantMessageResponse";

type TemporaryFile = {
  id: string;
  batchId: string;
  identity: string;
  filename: string;
  text: string;
  status: "ready" | "extracting" | "error";
  error?: string;
};

interface AssistantViewProps {
  pageContext: WorkspacePageContext;
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  newConversationVersion: number;
  onMessagesChange: (count: number) => void;
  onOpenDocument: (document: AssistantDocumentReference) => void;
  compact?: boolean;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "there", "their", "them", "then", "have", "has", "had", "been", "were", "are", "was", "will", "would", "could", "should", "from", "into", "about", "above", "below", "what", "how", "why", "who", "where", "when", "which", "under", "over", "between", "through", "during", "before", "after", "here", "there", "both", "each", "some", "any", "all", "most", "more", "other", "such", "only", "own", "same", "than", "too", "very", "can", "just", "should"
]);

const WORKING_ACTIVITY_DELAY_MS = 2000;
const VOICE_WORKING_ACTIVITIES = buildAssistantWorkingActivities({
  hasAttachments: false,
});

export class AssistantServerError extends Error {}

export function friendlyAssistantClientError(error: unknown): string {
  if (error instanceof AssistantServerError && error.message.trim()) {
    return error.message.trim();
  }
  const message = error instanceof Error ? error.message : "";
  if (/failed to fetch|networkerror|network request failed/i.test(message)) {
    return "The Assistant could not connect. Please check your connection and try again.";
  }
  return "The Assistant could not complete the request. Please try again.";
}

function getProcessedSnippet(snippet: string, queryText: string, maxLen: number = 300): { element: React.ReactNode; isTruncated: boolean } {
  if (!snippet) {
    return { element: <span></span>, isTruncated: false };
  }

  // Split snippet into sentences using regex that preserves spaces and punctuation
  const sentenceRegex = /([^.!?]+[.!?]+(?:\s+|$))/g;
  const sentences = snippet.match(sentenceRegex) || [snippet];

  // Tokenize the query
  const queryWords = new Set<string>();
  const rawWords = queryText.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/);
  for (const w of rawWords) {
    if (w && w.length > 2 && !STOP_WORDS.has(w)) {
      queryWords.add(w);
    }
  }

  // Find the sentence with the highest match score
  let bestSentenceIdx = 0;
  let maxScore = -1;

  sentences.forEach((sentence, idx) => {
    const sWords = sentence.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/);
    let score = 0;
    sWords.forEach((word) => {
      if (queryWords.has(word)) {
        score += 1;
      }
    });

    if (score > maxScore) {
      maxScore = score;
      bestSentenceIdx = idx;
    }
  });

  // Reconstruct snippet around the best matching sentence, maintaining sentence boundaries, under the maxLen limit
  let keptSentences: string[] = [];
  let currentLen = 0;
  let isTruncated = false;
  let truncatedBestSentenceIdx = -1;

  // Center around best sentence
  const startIdx = Math.max(0, bestSentenceIdx - 1);
  for (let i = startIdx; i < sentences.length; i++) {
    const s = sentences[i];
    if (currentLen + s.length > maxLen) {
      isTruncated = true;
      break;
    }
    keptSentences.push(s);
    currentLen += s.length;
    if (i === bestSentenceIdx) {
      truncatedBestSentenceIdx = keptSentences.length - 1;
    }
  }

  if (truncatedBestSentenceIdx === -1) {
    keptSentences = [sentences[bestSentenceIdx]];
    currentLen = sentences[bestSentenceIdx].length;
    if (currentLen > maxLen) {
      keptSentences = [sentences[bestSentenceIdx].substring(0, maxLen - 3) + "..."];
    }
    isTruncated = true;
    truncatedBestSentenceIdx = 0;
  }

  // Render kept sentences and apply continuous highlight on the best one
  const element = (
    <>
      {keptSentences.map((sentence, idx) => {
        if (idx === truncatedBestSentenceIdx) {
          return (
            <mark key={idx} className="bg-amber-100 text-amber-950 font-semibold px-0.5 rounded border-b border-amber-200 inline">
              {sentence}
            </mark>
          );
        }
        return <span key={idx}>{sentence}</span>;
      })}
    </>
  );

  return { element, isTruncated };
}

function AssistantWorkingActivityPanel({
  activities,
  stageIndex,
}: {
  activities: WorkingActivity[];
  stageIndex: number;
}) {
  return (
    <div
      className="flex min-w-0 items-start"
      id="chat-loading-indicator"
      role="status"
      aria-live="polite"
    >
      <div className="flex w-full max-w-xl min-w-0 flex-col gap-2 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 select-none">
        {visibleAssistantWorkingActivities(activities, stageIndex).map((activity) => (
          <div
            key={activity.activeLabel}
            className={`flex min-w-0 items-start gap-2 ${
              activity.isCompleted
                ? "text-zinc-500"
                : "animate-pulse text-zinc-700 motion-reduce:animate-none"
            }`}
          >
            {activity.isCompleted ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-zinc-700"
                aria-hidden="true"
              />
            )}
            <p className="min-w-0 break-words text-xs font-mono font-medium leading-relaxed">
              {activity.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AssistantView({ 
  pageContext,
  activeThreadId,
  setActiveThreadId,
  newConversationVersion,
  onMessagesChange,
  onOpenDocument,
  compact = false,
}: AssistantViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [draftStream, setDraftStream] = useState<string | null>(null);
  const [workingActivities, setWorkingActivities] = useState<WorkingActivity[]>([]);
  const [workingStageIndex, setWorkingStageIndex] = useState(0);
  const [voiceWorkingStageIndex, setVoiceWorkingStageIndex] = useState(0);
  const [citationPanelSource, setCitationPanelSource] = useState<Citation | null>(null);
  const [activeMessageCitations, setActiveMessageCitations] = useState<Citation[]>([]);
  
  const [filesAndSourcesOpen, setFilesAndSourcesOpen] = useState(false);
  const [temporaryFiles, setTemporaryFiles] = useState<TemporaryFile[]>([]);
  const [temporaryFileError, setTemporaryFileError] = useState("");
  const [cloudFilesBusy, setCloudFilesBusy] = useState(false);
  const fileExtracting = temporaryFiles.some((file) => file.status === "extracting");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const workingActivityTimerRef = useRef<number | null>(null);
  const voiceWorkingActivityTimerRef = useRef<number | null>(null);
  const responseStreamTimerRef = useRef<number | null>(null);
  const responseStreamResolveRef = useRef<(() => void) | null>(null);
  const componentMountedRef = useRef(true);
  const messageRequestSequenceRef = useRef(0);
  const submissionSequenceRef = useRef(0);
  const conversationVersionRef = useRef(newConversationVersion);
  const activeThreadIdRef = useRef(activeThreadId);
  const skipNextMessageLoadThreadRef = useRef<string | null>(null);
  activeThreadIdRef.current = activeThreadId;
  const voiceMode = useVoiceMode({
    onTranscript: (message) => {
      if (activeThreadIdRef.current !== message.thread_id) return;
      setMessages((current) => {
        if (current.some((item) => item.id === message.id)) return current;
        const optimisticIndex = message.metadata?.voiceOptimistic
          ? -1
          : current.findIndex((item) =>
            item.metadata?.voiceOptimistic
            && item.role === message.role
            && item.content.trim() === message.content.trim()
          );
        if (optimisticIndex >= 0) {
          const stableKey = current[optimisticIndex].metadata?.voiceStableKey;
          return current.map((item, index) => (index === optimisticIndex
            ? {
                ...message,
                metadata: {
                  ...message.metadata,
                  voiceStableKey: typeof stableKey === "string" ? stableKey : message.metadata?.voiceStableKey,
                },
              }
            : item));
        }
        return [...current, message];
      });
    },
  });
  useEffect(() => {
    voiceMode.updatePageContext(pageContext);
  }, [pageContext, voiceMode.updatePageContext]);
  const liveTranscriptMessages: Message[] = useMemo(() => {
    const roles: Array<"user" | "assistant"> = voiceMode.liveDeliverable ? ["user"] : ["user", "assistant"];
    const liveMessages = roles.flatMap((role) => {
      const content = voiceMode.liveTranscripts[role].trim();
      if (!content) return [];
      return [{
        id: `voice-live-${role}`,
        thread_id: activeThreadIdRef.current || "voice-live",
        role,
        content,
        citations: [],
        steps: null,
        created_at: new Date().toISOString(),
        metadata: { liveVoiceTranscript: true },
      }];
    });
    if (!voiceMode.liveDeliverable) return liveMessages;
    return [...liveMessages, {
      id: "voice-live-deliverable",
      thread_id: activeThreadIdRef.current || "voice-live",
      role: "assistant" as const,
      content: voiceMode.liveDeliverable.content,
      citations: [],
      steps: null,
      created_at: new Date().toISOString(),
      metadata: { liveVoiceTranscript: true, ...voiceMode.liveDeliverable.metadata },
    }];
  }, [voiceMode.liveDeliverable, voiceMode.liveTranscripts]);
  const displayMessages = useMemo(() => {
    const persistedKeys = new Set(
      messages.map((message) => `${message.role}:${message.content.trim()}`)
    );
    const filteredLive = liveTranscriptMessages.filter(
      (message) => !persistedKeys.has(`${message.role}:${message.content.trim()}`)
    );
    return [...messages, ...filteredLive];
  }, [messages, liveTranscriptMessages]);

  // New docked side editor state declarations
  const [sideEditorMessageId, setSideEditorMessageId] = useState<string | null>(null);
  const [sideEditorContent, setSideEditorContent] = useState<string>("");
  const [sideEditorSaving, setSideEditorSaving] = useState(false);
  const [sideEditorSaveStatus, setSideEditorSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [sideEditorUndoStack, setSideEditorUndoStack] = useState<string[]>([]);
  const [sideEditorRedoStack, setSideEditorRedoStack] = useState<string[]>([]);
  const [sideEditorTab, setSideEditorTab] = useState<"edit" | "preview">("edit");
  const [sideEditorAlignment, setSideEditorAlignment] = useState<"left" | "center" | "right">("left");
  const sideEditorTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Thumbs up / down feedback local state
  const [messageFeedbacks, setMessageFeedbacks] = useState<Record<string, "up" | "down" | null>>({});

  // Refs and states for portal positioning & click-outside
  const filesAndSourcesTriggerRef = useRef<HTMLButtonElement>(null);
  const filesAndSourcesDropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ left: number; bottom: number } | null>(null);

  // Auto-resize search input textarea useEffect
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const scrollHeight = textarea.scrollHeight;
      const maxHeight = 200; // max-height in pixels
      textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
      textarea.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
    }
  }, [inputValue]);

  useEffect(() => {
    if (filesAndSourcesOpen && filesAndSourcesTriggerRef.current) {
      const rect = filesAndSourcesTriggerRef.current.getBoundingClientRect();
      setDropdownPosition({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
      });
    } else {
      setDropdownPosition(null);
    }
  }, [filesAndSourcesOpen]);

  useEffect(() => {
    const handleResize = () => {
      if (filesAndSourcesOpen && filesAndSourcesTriggerRef.current) {
        const rect = filesAndSourcesTriggerRef.current.getBoundingClientRect();
        setDropdownPosition({
          left: rect.left,
          bottom: window.innerHeight - rect.top + 8,
        });
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [filesAndSourcesOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        filesAndSourcesOpen &&
        filesAndSourcesTriggerRef.current &&
        !filesAndSourcesTriggerRef.current.contains(target) &&
        filesAndSourcesDropdownRef.current &&
        !filesAndSourcesDropdownRef.current.contains(target)
      ) {
        setFilesAndSourcesOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [filesAndSourcesOpen]);

  useEffect(() => {
    voiceMode.stop();
    conversationVersionRef.current = newConversationVersion;
    messageRequestSequenceRef.current += 1;
    submissionSequenceRef.current += 1;
    setMessages([]);
    setInputValue("");
    setTemporaryFiles([]);
    setTemporaryFileError("");
    setFilesAndSourcesOpen(false);
    setCitationPanelSource(null);
    setActiveMessageCitations([]);
    setLoading(false);
    setStreaming(false);
    if (workingActivityTimerRef.current !== null) {
      window.clearTimeout(workingActivityTimerRef.current);
      workingActivityTimerRef.current = null;
    }
    if (responseStreamTimerRef.current !== null) {
      window.clearTimeout(responseStreamTimerRef.current);
      responseStreamTimerRef.current = null;
    }
    responseStreamResolveRef.current?.();
    responseStreamResolveRef.current = null;
  }, [newConversationVersion]);

  useEffect(() => {
    voiceMode.stopIfThreadChanged(activeThreadId);
  }, [activeThreadId, voiceMode.stopIfThreadChanged]);

  // Load messages only for an explicitly selected active conversation. Abort stale loads.
  useEffect(() => {
    const sequence = ++messageRequestSequenceRef.current;
    if (activeThreadId && skipNextMessageLoadThreadRef.current === activeThreadId) {
      skipNextMessageLoadThreadRef.current = null;
      return;
    }
    submissionSequenceRef.current += 1;
    if (workingActivityTimerRef.current !== null) {
      window.clearTimeout(workingActivityTimerRef.current);
      workingActivityTimerRef.current = null;
    }
    if (responseStreamTimerRef.current !== null) {
      window.clearTimeout(responseStreamTimerRef.current);
      responseStreamTimerRef.current = null;
    }
    responseStreamResolveRef.current?.();
    responseStreamResolveRef.current = null;
    setLoading(false);
    setStreaming(false);
    setMessages([]);
    if (!activeThreadId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/threads/${activeThreadId}/messages`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unable to load conversation messages");
        const data = await response.json() as Message[];
        if (!controller.signal.aborted && sequence === messageRequestSequenceRef.current) {
          setMessages(data);
        }
      } catch (error) {
        if (!controller.signal.aborted) console.error("Error fetching messages:", error);
      }
    })();
    return () => controller.abort();
  }, [activeThreadId]);

  // Notify messages change
  useEffect(() => {
    if (onMessagesChange) {
      onMessagesChange(messages.length);
    }
  }, [messages.length, onMessagesChange]);

  // Scroll to bottom. Live voice transcription updates continuously, so it jumps
  // instantly instead of restarting a smooth scroll animation on every chunk.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: voiceMode.active ? "auto" : "smooth" });
  }, [messages, voiceMode.liveTranscripts, voiceMode.liveDeliverable, loading, workingStageIndex, voiceMode.working, voiceWorkingStageIndex, draftStream]);

  useEffect(() => {
    if (
      !loading ||
      streaming ||
      draftStream !== null ||
      workingActivities.length < 2 ||
      workingStageIndex >= workingActivities.length - 1
    ) return;
    workingActivityTimerRef.current = window.setTimeout(() => {
      workingActivityTimerRef.current = null;
      setWorkingStageIndex((current) =>
        advanceWorkingActivityIndex(current, workingActivities.length)
      );
    }, WORKING_ACTIVITY_DELAY_MS);
    return () => {
      if (workingActivityTimerRef.current !== null) {
        window.clearTimeout(workingActivityTimerRef.current);
        workingActivityTimerRef.current = null;
      }
    };
  }, [loading, streaming, draftStream, workingActivities, workingStageIndex]);

  useEffect(() => {
    if (!voiceMode.working) {
      setVoiceWorkingStageIndex(0);
      return;
    }
    if (voiceWorkingStageIndex >= VOICE_WORKING_ACTIVITIES.length - 1) return;
    voiceWorkingActivityTimerRef.current = window.setTimeout(() => {
      voiceWorkingActivityTimerRef.current = null;
      setVoiceWorkingStageIndex((current) =>
        advanceWorkingActivityIndex(current, VOICE_WORKING_ACTIVITIES.length)
      );
    }, WORKING_ACTIVITY_DELAY_MS);
    return () => {
      if (voiceWorkingActivityTimerRef.current !== null) {
        window.clearTimeout(voiceWorkingActivityTimerRef.current);
        voiceWorkingActivityTimerRef.current = null;
      }
    };
  }, [voiceMode.working, voiceWorkingStageIndex]);

  useEffect(() => {
    componentMountedRef.current = true;
    return () => {
      componentMountedRef.current = false;
      if (workingActivityTimerRef.current !== null) {
        window.clearTimeout(workingActivityTimerRef.current);
      }
      if (voiceWorkingActivityTimerRef.current !== null) {
        window.clearTimeout(voiceWorkingActivityTimerRef.current);
      }
      if (responseStreamTimerRef.current !== null) {
        window.clearTimeout(responseStreamTimerRef.current);
      }
      responseStreamResolveRef.current?.();
      responseStreamResolveRef.current = null;
    };
  }, []);

  const handleStartNewThread = async (
    originContext: WorkspacePageContext,
    expectedConversationVersion: number
  ) => {
    try {
      const title = inputValue.trim() 
        ? (inputValue.trim().substring(0, 45) + "...") 
        : `Consultation on ${new Date().toLocaleDateString()}`;

      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          caseId: originContext.routeKind === "matter" ? originContext.matter?.id || null : null
        })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Unable to create conversation");
      const newThread = await res.json();
      if (conversationVersionRef.current === expectedConversationVersion) {
        skipNextMessageLoadThreadRef.current = newThread.id;
        activeThreadIdRef.current = newThread.id;
        setActiveThreadId(newThread.id);
      }
      return newThread.id;
    } catch (err) {
      console.error("Error creating thread:", err);
    }
  };

  const handleVoiceToggle = async () => {
    if (voiceMode.active) {
      voiceMode.stop();
      return;
    }
    const existingThreadId = activeThreadIdRef.current;
    const threadPromise = existingThreadId
      ? Promise.resolve(existingThreadId)
      : handleStartNewThread(pageContext, conversationVersionRef.current);
    await voiceMode.start(threadPromise, pageContext);
  };

  const handleSend = async (e?: React.FormEvent, customQuery?: string) => {
    if (e) e.preventDefault();
    const queryText = (customQuery || inputValue).trim();
    if (!queryText || loading || fileExtracting || cloudFilesBusy) return;

    if (workingActivityTimerRef.current !== null) {
      window.clearTimeout(workingActivityTimerRef.current);
      workingActivityTimerRef.current = null;
    }
    if (responseStreamTimerRef.current !== null) {
      window.clearTimeout(responseStreamTimerRef.current);
      responseStreamTimerRef.current = null;
    }
    setLoading(true);
    const submissionSequence = ++submissionSequenceRef.current;
    setStreaming(false);
    setDraftStream(null);
    setWorkingStageIndex(0);
    const submittedPageContext = pageContext;
    const submittedConversationVersion = conversationVersionRef.current;
    setWorkingActivities(buildAssistantWorkingActivities({
      hasAttachments: temporaryFiles.some((file) => file.status === "ready"),
    }));
    setInputValue("");
    setFilesAndSourcesOpen(false);

    let currentThreadId = activeThreadId;
    if (!currentThreadId) {
      currentThreadId = await handleStartNewThread(
        submittedPageContext,
        submittedConversationVersion
      );
    }

    if (!currentThreadId) {
      setLoading(false);
      return;
    }
    const submittedTemporaryFiles = temporaryFiles.filter((file) => file.status === "ready");
    const submittedAttachments = Array.from(
      new Map(submittedTemporaryFiles.map((file) => [file.filename.trim().slice(0, 180), { name: file.filename.trim().slice(0, 180) }])).values()
    ).filter((attachment) => attachment.name);

    // Optimistically add user message
    const tempUserMsg: Message = {
      id: `temp_user_${Date.now()}`,
      thread_id: currentThreadId,
      role: "user",
      content: queryText,
      citations: [],
      steps: null,
      created_at: new Date().toISOString(),
      metadata: {
        ...(submittedAttachments.length ? { attachments: submittedAttachments } : {}),
        pageContext: submittedPageContext,
      },
    };
    if (conversationVersionRef.current === submittedConversationVersion) {
      setMessages((prev) => [...prev, tempUserMsg]);
    }

    try {
      const res = await fetch(`/api/threads/${currentThreadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: queryText,
          pageContext: submittedPageContext,
          temporaryFiles: submittedTemporaryFiles
            .map(({ filename, text }) => ({ filename, text }))
        })
      });
      const streamedResponse = isAssistantNdjsonResponse(res.headers.get("content-type"));
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const data = await consumeAssistantTurnResponse(res, {
        onDraftDelta: (preview) => {
          if (
            !componentMountedRef.current ||
            conversationVersionRef.current !== submittedConversationVersion ||
            activeThreadIdRef.current !== currentThreadId ||
            prefersReducedMotion
          ) return;
          setDraftStream(preview);
        },
        onDraftReset: () => {
          if (prefersReducedMotion) return;
          setDraftStream("");
        },
      });
      
      if (typeof data.error === "string" && data.error.trim()) {
        throw new AssistantServerError(data.error);
      }
      if (
        !componentMountedRef.current ||
        conversationVersionRef.current !== submittedConversationVersion ||
        activeThreadIdRef.current !== currentThreadId
      ) return;
      if (workingActivityTimerRef.current !== null) {
        window.clearTimeout(workingActivityTimerRef.current);
        workingActivityTimerRef.current = null;
      }

      const savedUserMessage = data.userMessage as Message;
      const savedAssistantMessage = data.assistantMessage as Message;
      if (!savedUserMessage?.id || !savedAssistantMessage?.id) {
        throw new AssistantServerError("The Assistant could not complete the request. Please try again.");
      }
      const leadingWhitespace = savedAssistantMessage.content.match(/^\s*/)?.[0] || "";
      const streamTokens = savedAssistantMessage.content.slice(leadingWhitespace.length).match(/\S+\s*/g) || [];
      // The answer has already arrived, so the reveal is presentation only and must
      // not hold the response back. It stays under roughly a second, and short
      // confirmations such as a created document finish almost immediately.
      const wordCount = streamTokens.length;
      const targetDuration = Math.min(1200, Math.max(200, wordCount * 6));
      const targetUpdates = Math.min(48, Math.max(8, Math.ceil(wordCount / 4)));
      const tokensPerStep = Math.max(1, Math.ceil(wordCount / targetUpdates));
      const streamDelay = Math.max(16, Math.round(targetDuration / Math.max(1, Math.ceil(wordCount / tokensPerStep))));
      let revealedTokenCount = 0;

      setStreaming(true);
      setDraftStream(null);
      setMessages((prev) => {
        const messagesWithoutSavedCopies = prev.filter((message) =>
          message.id !== savedUserMessage.id && message.id !== savedAssistantMessage.id
        );
        return [
          ...messagesWithoutSavedCopies.map((message) => message.id === tempUserMsg.id ? savedUserMessage : message),
          { ...savedAssistantMessage, content: streamedResponse ? savedAssistantMessage.content : "" },
        ];
      });

      if (streamedResponse || prefersReducedMotion || wordCount === 0) {
        setMessages((prev) => prev.map((message) =>
          message.id === savedAssistantMessage.id ? savedAssistantMessage : message
        ));
      } else {
        await new Promise<void>((resolve) => {
          responseStreamResolveRef.current = resolve;
          const revealNextChunk = () => {
            responseStreamTimerRef.current = window.setTimeout(() => {
              revealedTokenCount = Math.min(revealedTokenCount + tokensPerStep, wordCount);
              const revealedContent = leadingWhitespace + streamTokens.slice(0, revealedTokenCount).join("");
              setMessages((prev) => prev.map((message) =>
                message.id === savedAssistantMessage.id
                  ? { ...savedAssistantMessage, content: revealedContent }
                  : message
              ));
              if (revealedTokenCount < wordCount) {
                revealNextChunk();
                return;
              }
              responseStreamTimerRef.current = null;
              responseStreamResolveRef.current = null;
              setMessages((prev) => prev.map((message) =>
                message.id === savedAssistantMessage.id ? savedAssistantMessage : message
              ));
              resolve();
            }, streamDelay);
          };
          revealNextChunk();
        });
      }

      if (
        componentMountedRef.current &&
        conversationVersionRef.current === submittedConversationVersion &&
        activeThreadIdRef.current === currentThreadId
      ) {
        setTemporaryFiles([]);
      }
    } catch (err: any) {
      if (workingActivityTimerRef.current !== null) {
        window.clearTimeout(workingActivityTimerRef.current);
        workingActivityTimerRef.current = null;
      }
      if (responseStreamTimerRef.current !== null) {
        window.clearTimeout(responseStreamTimerRef.current);
        responseStreamTimerRef.current = null;
      }
      responseStreamResolveRef.current?.();
      responseStreamResolveRef.current = null;
      setStreaming(false);
      setDraftStream(null);
      console.error("Error processing request:", err);
      if (
        conversationVersionRef.current !== submittedConversationVersion ||
        activeThreadIdRef.current !== currentThreadId
      ) return;
      const errAssistantMsg: Message = {
        id: `temp_err_${Date.now()}`,
        thread_id: currentThreadId,
        role: "assistant",
        content: friendlyAssistantClientError(err),
        citations: [],
        steps: null,
        created_at: new Date().toISOString(),
        metadata: { error: true },
      };
      setMessages((prev) => [...prev, errAssistantMsg]);
    } finally {
      if (
        componentMountedRef.current &&
        submissionSequenceRef.current === submissionSequence
      ) {
        setStreaming(false);
        setDraftStream(null);
        setLoading(false);
      }
    }
  };

  const handleTemporaryFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    const existing = new Set(temporaryFiles.map((file) => file.identity));
    const seen = new Set(existing);
    const unique = selected.filter((file) => {
      const identity = browserFileIdentity(file);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
    if (temporaryFiles.length + unique.length > MAX_SELECTED_FILES) {
      setTemporaryFileError(`Select at most ${MAX_SELECTED_FILES} files. ${temporaryFiles.length} already selected; ${unique.length} more would exceed the limit.`);
      return;
    }
    if (unique.length === 0) {
      setTemporaryFileError("");
      return;
    }
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const pending: TemporaryFile[] = unique.map((file) => ({
      id: `${batchId}_${browserFileIdentity(file)}`,
      batchId,
      identity: browserFileIdentity(file),
      filename: file.name,
      text: "",
      status: "extracting" as const,
    }));
    setTemporaryFileError("");
    setTemporaryFiles((current) => [...current, ...pending]);
    const form = new FormData();
    unique.forEach((file) => form.append("files", file));
    try {
      const response = await fetch("/api/extract-files", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "File extraction failed");
      setTemporaryFiles((current) => current.map((file) => {
        if (file.batchId !== batchId) return file;
        const index = pending.findIndex((item) => item.identity === file.identity);
        const extracted = data.files?.[index] as { filename: string; text: string } | undefined;
        return extracted ? { ...file, filename: extracted.filename, text: extracted.text, status: "ready" as const, error: undefined } : file;
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "File extraction failed";
      setTemporaryFiles((current) => current.map((file) => file.batchId === batchId ? { ...file, status: "error" as const, error: message } : file));
    }
  };

  // Docked Side Editor text insertion helper
  const insertSideEditorTextMarkup = (prefix: string, suffix: string = prefix) => {
    const textarea = sideEditorTextareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);

    const replacement = prefix + selected + suffix;
    const newVal = text.substring(0, start) + replacement + text.substring(end);
    
    setSideEditorUndoStack((prev) => [...prev, sideEditorContent]);
    setSideEditorRedoStack([]);
    setSideEditorContent(newVal);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 10);
  };

  // Docked Side Editor Save Handler
  const handleSideEditorSave = async () => {
    if (!sideEditorMessageId) return;
    setSideEditorSaving(true);
    setSideEditorSaveStatus("saving");
    try {
      const res = await fetch(`/api/messages/${sideEditorMessageId}?threadId=${activeThreadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: sideEditorContent })
      });
      const data = await res.json();
      if (data.id) {
        setSideEditorSaveStatus("saved");
        setMessages((prev) =>
          prev.map((m) => (m.id === sideEditorMessageId ? { ...m, content: sideEditorContent } : m))
        );
        setTimeout(() => setSideEditorSaveStatus("idle"), 2000);
      } else {
        setSideEditorSaveStatus("error");
        setTimeout(() => setSideEditorSaveStatus("idle"), 3000);
      }
    } catch (err) {
      console.error("Error saving side editor content:", err);
      setSideEditorSaveStatus("error");
      setTimeout(() => setSideEditorSaveStatus("idle"), 3000);
    } finally {
      setSideEditorSaving(false);
    }
  };

  // Side Editor Undo Handler
  const handleSideEditorUndo = () => {
    if (sideEditorUndoStack.length <= 1) return;
    const current = sideEditorUndoStack[sideEditorUndoStack.length - 1];
    const previous = sideEditorUndoStack[sideEditorUndoStack.length - 2];
    
    setSideEditorUndoStack((prev) => prev.slice(0, -1));
    setSideEditorRedoStack((prev) => [...prev, current]);
    setSideEditorContent(previous);
  };

  // Side Editor Redo Handler
  const handleSideEditorRedo = () => {
    if (sideEditorRedoStack.length === 0) return;
    const next = sideEditorRedoStack[sideEditorRedoStack.length - 1];
    
    setSideEditorRedoStack((prev) => prev.slice(0, -1));
    setSideEditorUndoStack((prev) => [...prev, sideEditorContent]);
    setSideEditorContent(next);
  };

  // Side Editor Content Change Handler (to record to undo stack when user types)
  const handleSideEditorContentChange = (newVal: string) => {
    setSideEditorContent(newVal);
    setSideEditorUndoStack((prev) => {
      if (prev[prev.length - 1] === newVal) return prev;
      return [...prev, newVal];
    });
    setSideEditorRedoStack([]);
  };

  // Thumbs up / down feedback toggle handler
  const handleFeedback = (messageId: string, type: "up" | "down") => {
    setMessageFeedbacks((prev) => {
      const current = prev[messageId];
      return {
        ...prev,
        [messageId]: current === type ? null : type
      };
    });
  };

  const attachmentNamesForMessage = (message: Message): string[] => {
    const raw = message.metadata?.attachments;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => typeof item === "string" ? item : item && typeof item === "object" && "name" in item && typeof item.name === "string" ? item.name : "")
      .map((name) => name.trim())
      .filter(Boolean);
  };

  const documentReferenceForMessage = (message: Message): AssistantDocumentReference | null => {
    const value = message.metadata?.document;
    if (!value || typeof value !== "object") return null;
    if (typeof value.id !== "string" || typeof value.title !== "string") return null;
    if (value.kind !== "matterWorkProduct" && value.kind !== "assistantDocument") return null;
    if (value.kind === "matterWorkProduct" && typeof value.matterId !== "string") return null;
    return value;
  };

  const documentExportUrl = (document: AssistantDocumentReference): string => document.kind === "matterWorkProduct"
    ? `/api/drafts/${encodeURIComponent(document.id)}/export?caseId=${encodeURIComponent(document.matterId || "")}`
    : `/api/assistant-documents/${encodeURIComponent(document.id)}/export`;

  const ensureResponseDocument = async (message: Message): Promise<AssistantDocumentReference> => {
    const existingDocument = documentReferenceForMessage(message);
    if (existingDocument) return existingDocument;

    const response = await fetch(`/api/messages/${encodeURIComponent(message.id)}/assistant-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: message.thread_id }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof payload.error === "string" ? payload.error : "Could not prepare this response document.");
    }
    if (typeof payload.id !== "string" || typeof payload.title !== "string") {
      throw new Error("Could not prepare this response document.");
    }
    return { id: payload.id, kind: "assistantDocument", title: payload.title };
  };

  const openResponseDocument = async (message: Message) => {
    try {
      onOpenDocument(await ensureResponseDocument(message));
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not open this response document.");
    }
  };

  const downloadResponseDocument = async (message: Message) => {
    try {
      const document = await ensureResponseDocument(message);
      await downloadDocx(documentExportUrl(document));
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not download this response document.");
    }
  };

  const renderMessageTextWithCitations = (text: string, citationsList: Citation[]) => {
    if (!text) return null;
    return (
      <FormattedMarkdown
        content={stripAssistantInlineCitations(text, citationsList)}
      />
    );
  };  // Reusable unified composer
  const renderComposer = () => {
    return (
      <form onSubmit={handleSend} className="w-full relative flex flex-col select-none">
        <div className="w-full border border-zinc-200 focus-within:border-zinc-400 rounded-lg bg-white p-3 transition-all flex flex-col gap-2.5">
          {/* Selected Files / Sources Chips Bar at the top of the container */}
          {temporaryFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 select-none pb-2 border-b border-zinc-100 animate-fade-in" id="attached-chips-row">
              {temporaryFiles.map((file) => (
                <span key={file.id} className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-zinc-50 rounded-full text-xs font-mono border animate-fade-in ${file.status === "error" ? "text-red-700 border-red-200" : "text-zinc-600 border-zinc-200"}`}>
                  <FileText className={`h-3 w-3 shrink-0 ${file.status === "extracting" ? "animate-pulse" : ""}`} />
                  <span className="max-w-44 truncate">{file.status === "extracting" ? `Extracting ${file.filename}` : file.status === "error" ? file.error || file.filename : file.filename}</span>
                  <button type="button" onClick={() => { setTemporaryFiles((current) => current.filter((item) => item.id !== file.id)); setTemporaryFileError(""); }} className="hover:text-zinc-900 font-bold ml-1 text-[10px] focus:outline-none cursor-pointer" aria-label={`Remove ${file.filename}`} title={`Remove ${file.filename}`}>X</button>
                </span>
              ))}
            </div>
          )}

          {/* Textarea inside the container */}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={pageContext.routeKind === "matter" ? "Ask about this Matter, create a document, or request anything else…" : "Ask about this page, your workspace, or anything else…"}
            className="w-full min-h-[64px] max-h-[180px] p-1.5 border-none outline-none focus:ring-0 text-sm text-zinc-900 placeholder-zinc-400 font-sans transition-all resize-none bg-white"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />

          {/* Bottom control row inside the unified container */}
          <div className="flex flex-wrap items-center justify-between gap-2 select-none pt-2 border-t border-zinc-100 bg-white">
            <div className="flex min-w-0 flex-wrap items-center gap-2 relative">
              {/* Redesigned Files and Sources Dropdown Menu */}
              <div className="relative">
                <button
                  ref={filesAndSourcesTriggerRef}
                  type="button"
                  onClick={() => setFilesAndSourcesOpen(!filesAndSourcesOpen)}
                  id="files-and-sources-picker"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono font-semibold text-zinc-600 hover:text-zinc-900 border border-zinc-200 rounded bg-white transition-all cursor-pointer hover:border-zinc-300"
                  title="Choose permitted research sources"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0" />
                  <span>Sources</span>
                  <ChevronDown className="h-3 w-3 shrink-0" />
                </button>
                
                {filesAndSourcesOpen && dropdownPosition && createPortal(
                  <div 
                    ref={filesAndSourcesDropdownRef}
                    style={{
                      position: "fixed",
                      left: `${dropdownPosition.left}px`,
                      bottom: `${dropdownPosition.bottom}px`,
                    }}
                    className="w-80 bg-white border border-zinc-200 rounded shadow-md p-4 z-50 flex flex-col gap-3.5 animate-fade-in text-zinc-900 font-sans"
                  >
                    <div>
                      <p className="mb-3 text-xs leading-relaxed text-zinc-500">Files attached here remain available to this conversation.</p>
                      <span className="text-[10px] font-mono uppercase text-zinc-400 font-bold block mb-2 tracking-wider">Temporary File Attachments</span>
                      <FileSourcePicker
                        disabled={loading}
                        maxFiles={MAX_SELECTED_FILES}
                        selectedCount={temporaryFiles.length}
                        compact
                        onFilesSelected={handleTemporaryFiles}
                        onError={setTemporaryFileError}
                        onBusyChange={setCloudFilesBusy}
                      />
                      {fileExtracting && <p className="mt-2 text-[10px] font-mono uppercase text-zinc-400">Extracting files...</p>}
                      {temporaryFileError && <p className="mt-2 text-xs text-red-700">{temporaryFileError}</p>}
                    </div>
                  </div>,
                  document.body
                )}
              </div>

            </div>

            {/* Right Side Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleVoiceToggle()}
                onPointerEnter={() => {
                  const threadId = activeThreadIdRef.current;
                  if (threadId && !voiceMode.active) voiceMode.prefetchToken(threadId, pageContext);
                }}
                id="btn-voice-mode"
                aria-label={voiceMode.active ? "Turn off Voice Agent" : "Start Voice Conversation"}
                aria-pressed={voiceMode.active}
                title={voiceMode.active ? "Turn off Voice Agent" : "Start Voice Conversation"}
                ref={voiceMode.voiceControlRef}
                data-voice-state={voiceMode.state}
                data-voice-working={voiceMode.working ? "true" : "false"}
                className={`voice-mode-control inline-flex items-center gap-2 px-2.5 py-1.5 text-xs font-mono font-semibold border rounded transition-colors cursor-pointer ${voiceMode.active ? "border-zinc-950 bg-zinc-950 text-white" : voiceMode.state === "error" ? "border-red-300 bg-white text-red-700" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 hover:text-zinc-950"}`}
              >
                <span className="voice-mode-presence" aria-hidden="true">
                  <span className="voice-mode-ring" />
                  <AudioLines className="voice-mode-icon h-3.5 w-3.5" />
                </span>
                <span>Voice Agent</span>
                <span className="sr-only" aria-live="polite">{voiceMode.working ? "Voice Agent working" : voiceMode.state}</span>
              </button>
              <button
                type="submit"
                disabled={!inputValue.trim() || loading || fileExtracting || cloudFilesBusy}
                id="btn-submit-send"
                aria-label="Send message"
                title="Send message"
                className="inline-flex h-8 w-8 items-center justify-center text-white bg-zinc-950 hover:bg-zinc-900 border border-zinc-950 rounded shadow-xs disabled:opacity-40 transition-all cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
          {voiceMode.error && (
            <p className="text-xs text-red-700" role="status">{voiceMode.error}</p>
          )}
        </div>
      </form>
    );
  };

  // Persistent Citation Metadata Panel helper
  const renderCitationPanel = () => {
    if (!citationPanelSource) return null;
    return (
      <div className="fixed inset-6 z-50 flex max-w-2xl flex-col overflow-hidden rounded border border-zinc-200 bg-white shadow-2xl animate-fade-in sm:left-auto sm:w-[min(38rem,calc(100vw-3rem))]" id="citation-panel">
        <div className="p-4.5 border-b border-zinc-200 flex items-center justify-between select-none">
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-500 font-sans">Source Citations</span>
          <button
            onClick={() => {
              setCitationPanelSource(null);
              setActiveMessageCitations([]);
            }}
            className="text-xs font-mono text-zinc-400 hover:text-zinc-900 uppercase focus:outline-none cursor-pointer"
          >
            [Close]
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-5 text-sm">
          {/* Quick-navigation tabs for multiple sources referenced in this message */}
          {activeMessageCitations && activeMessageCitations.length > 1 && (
            <div className="pb-4 border-b border-zinc-200 select-none">
              <span className="text-[10px] font-mono text-zinc-400 uppercase block mb-2 tracking-wider font-semibold">References in this response:</span>
              <div className="flex flex-wrap gap-2">
                {activeMessageCitations.map((cit) => (
                  <button
                    key={cit.id}
                    type="button"
                    onClick={() => setCitationPanelSource(cit)}
                    className={`px-2.5 py-1 text-xs font-mono font-medium rounded border cursor-pointer transition-all focus:outline-none ${
                      citationPanelSource.id === cit.id
                        ? "bg-zinc-900 text-white border-zinc-900"
                        : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900"
                    }`}
                    title={`${cit.sourceName}: ${cit.title}`}
                  >
                    {cit.id.replace("cit_", "")}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <span className="text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider select-none">
              {citationPanelSource.sourceName}
            </span>
            <h4 className="font-sans font-bold text-zinc-900 mt-2 leading-relaxed text-base select-text">
              {citationPanelSource.title}
            </h4>
          </div>

          {citationPanelSource.url && (
            <div>
              <span className="text-[10px] font-mono text-zinc-400 uppercase block mb-1.5 select-none font-semibold">Direct URL Link:</span>
              <a
                href={citationPanelSource.url}
                target="_blank"
                rel="noreferrer"
                className="text-zinc-900 font-mono text-xs underline hover:text-zinc-650 flex items-center gap-1.5 inline-flex break-all"
              >
                {citationPanelSource.url}
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            </div>
          )}

          <div className="pt-4 border-t border-zinc-200">
            <span className="text-[10px] font-mono text-zinc-400 uppercase block mb-1.5 select-none font-semibold">Verbatim Snippet / Context:</span>
            <p className="font-mono text-xs leading-relaxed text-zinc-600 bg-zinc-50 p-4 border border-zinc-200 rounded-md whitespace-pre-wrap select-text">
              "{citationPanelSource.textSnippet}"
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden bg-white text-zinc-900" id="assistant-view-container" data-compact={compact ? "true" : "false"}>
      {/* Central Consultation Screen */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative border-r border-zinc-100">
        
        {displayMessages.length > 0 ? (
          <>
            {/* Simple Thread Title Header (Only if there are messages) */}
            <div className={`${compact ? "hidden" : "flex"} px-8 py-4.5 bg-zinc-50 border-b border-zinc-100 items-center justify-between z-10 select-none shrink-0`} id="active-thread-header">
              <div>
                <span className="text-xs font-mono font-semibold uppercase text-zinc-400 tracking-wider">{pageContext.routeKind === "matter" ? `Matter Context · ${pageContext.matter?.name || "Matter"}` : `${pageContext.pageTitle} Context`}</span>
                <h2 className="text-sm font-sans font-semibold text-zinc-800 line-clamp-1 mt-0.5">
                  {activeThreadId ? "Consultation Thread" : "New Consultation"}
                </h2>
              </div>
              
              <button 
                onClick={() => {
                  setActiveThreadId(null);
                  activeThreadIdRef.current = null;
                  setMessages([]);
                  setTemporaryFiles([]);
                }}
                id="header-new-thread-btn"
                className="text-xs uppercase font-mono font-bold border border-zinc-950 text-zinc-950 px-4 py-2 rounded hover:bg-zinc-100 transition-all cursor-pointer"
              >
                + New Consultation
              </button>
            </div>

            {/* Message Thread History List */}
            <div className={`flex-1 overflow-y-auto space-y-2 ${compact ? "px-4 py-4" : "px-8 py-6"}`} id="chat-messages-scroll-area">
              {displayMessages.map((m, index) => {
                const isLastMessage = index === displayMessages.length - 1;
                const isLiveVoiceMessage = m.metadata?.liveVoiceTranscript === true;
                const liveDocumentReady = isLiveVoiceMessage && Boolean(documentReferenceForMessage(m));
                const showMessageActions = (!isLiveVoiceMessage || liveDocumentReady
                  || (m.role === "assistant" && m.content.trim().length > 0))
                  && m.metadata?.error !== true;
                const messageStableKey = typeof m.metadata?.voiceStableKey === "string"
                  ? m.metadata.voiceStableKey
                  : m.id;
                const shouldAnimateEntry = !isLiveVoiceMessage
                  && !m.metadata?.voiceOptimistic
                  && typeof m.metadata?.voiceStableKey !== "string";
                return (
                  <div key={messageStableKey} className={`w-full max-w-3xl mx-auto flex flex-col py-5${shouldAnimateEntry ? " animate-fade-in" : ""}`} id={`message-wrapper-${m.id}`}>
                    <div className={`w-full flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      {m.role === "user" ? (
                        <div id={`message-bubble-${m.id}`} className="bg-zinc-100 text-zinc-900 rounded-2xl px-5 py-3 max-w-[75%] text-sm leading-relaxed">
                          {/* Speaker Label */}
                          <div className="flex items-center gap-2 mb-1 select-none">
                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
                              You
                            </span>
                            <span className="text-[9px] font-mono text-zinc-300">
                              {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className="whitespace-pre-wrap font-sans font-normal text-zinc-900">
                            {m.content}
                          </div>
                          {attachmentNamesForMessage(m).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {attachmentNamesForMessage(m).map((name) => (
                                <span key={name} title={name} className="inline-flex max-w-48 items-center gap-1 rounded border border-zinc-200 bg-white/70 px-2 py-0.5 text-[10px] font-mono text-zinc-500">
                                  <Paperclip className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{name}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div id={`message-bubble-${m.id}`} className="w-full text-sm leading-relaxed text-zinc-950">
                          {/* Speaker Label */}
                          <div className="flex items-center gap-2 mb-2 select-none">
                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">
                              AI Legal Assistant
                            </span>
                            <span className="text-[9px] font-mono text-zinc-450">
                              {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          {/* Multi-step Deep Research Steps Panel */}
                          {m.steps && m.steps.length > 0 && (
                            <CollapsibleSteps steps={m.steps} />
                          )}

                          {(() => {
                            const document = documentReferenceForMessage(m);
                            const confirmationOnly = Boolean(document && isDocumentConfirmationContent(m.content));
                            return (
                              <>
                                {!confirmationOnly && (
                                  <div className="font-sans font-normal leading-relaxed text-zinc-900">
                                    {renderMessageTextWithCitations(m.content, m.citations)}
                                  </div>
                                )}

                                {document && (() => {
                                  const exportUrl = documentExportUrl(document);
                                  return (
                                    <div className={`${confirmationOnly ? "" : "mt-4 "}rounded-lg border border-zinc-200 bg-zinc-50 p-3`} id={`assistant-document-card-${m.id}`}>
                                      <div className="flex min-w-0 items-start gap-2.5">
                                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                                        <div className="min-w-0 flex-1">
                                          {confirmationOnly ? (
                                            <div className="font-sans font-normal leading-relaxed text-zinc-900">
                                              {renderMessageTextWithCitations(m.content, m.citations)}
                                            </div>
                                          ) : (
                                            <p className="truncate text-xs font-semibold text-zinc-900">{document.title}</p>
                                          )}
                                          <p className="mt-0.5 text-[9px] font-mono uppercase text-zinc-400">{document.kind === "matterWorkProduct" ? "Matter Work Product" : "Private assistant document"}</p>
                                        </div>
                                      </div>
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        <button type="button" onClick={() => onOpenDocument(document)} className="rounded bg-zinc-950 px-3 py-1.5 text-[10px] font-mono font-bold uppercase text-white">Open</button>
                                        <button type="button" onClick={() => void downloadDocx(exportUrl)} className="inline-flex items-center gap-1 rounded border border-zinc-300 bg-white px-3 py-1.5 text-[10px] font-mono font-bold uppercase text-zinc-800"><Download className="h-3.5 w-3.5" />Download .docx</button>
                                      </div>
                                    </div>
                                  );
                                })()}
                              </>
                            );
                          })()}

                          {/* Message Action Items — show as soon as a live Voice document card is ready */}
                          {showMessageActions && (
                            <div className="mt-5 pt-3.5 border-t border-zinc-100 flex items-center justify-between flex-wrap gap-2.5 select-none">
                              <div className="flex items-center gap-3">
                                {m.citations && m.citations.length > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCitationPanelSource(m.citations[0]);
                                      setActiveMessageCitations(m.citations);
                                    }}
                                    id={`refs-indicator-${m.id}`}
                                    className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 px-2 py-1 rounded transition-colors"
                                  >
                                    <BookOpen className="h-3.5 w-3.5 text-zinc-400" />
                                    {m.citations.length} {m.citations.length === 1 ? "Source" : "Sources"} Referenced
                                  </button>
                                ) : null}

                                {/* Thumbs Feedback Controls */}
                                <div className="flex items-center gap-1 border-l border-zinc-200 pl-3">
                                  <button
                                    type="button"
                                    onClick={() => handleFeedback(m.id, "up")}
                                    className={`p-1 rounded transition-all cursor-pointer border ${
                                      messageFeedbacks[m.id] === "up"
                                        ? "bg-zinc-100 border-zinc-200 text-zinc-900 shadow-none"
                                        : "border-transparent text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50"
                                    }`}
                                    title="Thumbs Up"
                                  >
                                    <ThumbsUp className={`h-3.5 w-3.5 ${messageFeedbacks[m.id] === "up" ? "fill-zinc-600 text-zinc-700" : ""}`} />
                                  </button>
                                  
                                  <button
                                    type="button"
                                    onClick={() => handleFeedback(m.id, "down")}
                                    className={`p-1 rounded transition-all cursor-pointer border ${
                                      messageFeedbacks[m.id] === "down"
                                        ? "bg-zinc-100 border-zinc-200 text-zinc-900 shadow-none"
                                        : "border-transparent text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50"
                                    }`}
                                    title="Thumbs Down"
                                  >
                                    <ThumbsDown className={`h-3.5 w-3.5 ${messageFeedbacks[m.id] === "down" ? "fill-zinc-600 text-zinc-700" : ""}`} />
                                  </button>
                                </div>
                              </div>
                              
                              {/* Action buttons row */}
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(stripAssistantInlineCitations(m.content, m.citations));
                                    alert("Response copied to clipboard!");
                                  }}
                                  id={`action-copy-${m.id}`}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded transition-colors"
                                  title="Copy response"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  <span>Copy</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => void openResponseDocument(m)}
                                  id={`action-open-${m.id}`}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded transition-colors"
                                  title="Open response document"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  <span>Open</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => void downloadResponseDocument(m)}
                                  id={`action-download-${m.id}`}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded transition-colors"
                                  title="Download response document"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  <span>Download</span>
                                </button>

                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Follow-up Suggestions (Pills) - Lifecycle restricted to latest assistant response */}
                    {isLastMessage && m.role === "assistant" && !loading && Array.isArray(m.metadata?.suggestions) && m.metadata.suggestions.length > 0 && (
                      <div className="mt-4 flex flex-col gap-2 pl-2 animate-fade-in select-none" id="follow-up-suggestions-container">
                        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-zinc-400">Suggested Follow-ups:</span>
                        <div className="flex flex-wrap gap-2">
                          {m.metadata.suggestions.map((suggestion, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleSend(undefined, suggestion)}
                              className="px-3 py-1 text-xs text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100 bg-white border border-zinc-200 rounded-full transition-all cursor-pointer text-left shadow-2xs"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {loading && !streaming && draftStream === null ? (
                <AssistantWorkingActivityPanel
                  activities={workingActivities}
                  stageIndex={workingStageIndex}
                />
              ) : voiceMode.working ? (
                <AssistantWorkingActivityPanel
                  activities={VOICE_WORKING_ACTIVITIES}
                  stageIndex={voiceWorkingStageIndex}
                />
              ) : null}

              {draftStream !== null ? (
                <div className="w-full max-w-3xl mx-auto flex flex-col py-5" id="assistant-draft-stream" role="status" aria-live="polite">
                  <div className="w-full text-sm leading-relaxed text-zinc-950">
                    <div className="flex items-center gap-2 mb-2 select-none">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">
                        AI Legal Assistant
                      </span>
                    </div>
                    <div className="font-sans font-normal leading-relaxed text-zinc-900">
                      {draftStream ? <FormattedMarkdown content={draftStream} /> : null}
                    </div>
                  </div>
                </div>
              ) : null}

              <div ref={messagesEndRef} />
            </div>

            {/* Pinned bottom-anchored composer wrapper */}
            <div className={`${compact ? "p-3" : "px-8 py-6"} bg-white border-t border-zinc-100 shrink-0`} id="assistant-composer-container">
              {renderComposer()}
            </div>
          </>
        ) : (
          <div className={`flex flex-1 flex-col overflow-y-auto bg-white ${compact ? "justify-end p-3" : "items-center justify-center px-8"}`} id="compact-empty-conversation">
            <div className={`w-full ${compact ? "space-y-3" : "max-w-3xl space-y-8 py-12"}`}>
              <div className={compact ? "rounded border border-dashed border-zinc-200 px-4 py-3" : "text-center"}>
                <p className="text-xs font-semibold text-zinc-800">Start a conversation</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                  Ask a question, work with your workspace, create a document, or attach research sources.
                </p>
              </div>
              <div className="w-full text-left">{renderComposer()}</div>
            </div>
          </div>
        )}
      </div>

      {/* Persistent Citation Metadata Panel */}
      {renderCitationPanel()}

      {/* Docked Response Editor Panel */}
      {sideEditorMessageId && (
        <div className="fixed inset-6 z-50 flex flex-col overflow-hidden rounded border border-zinc-200 bg-white shadow-2xl animate-fade-in" id="response-editor-panel" role="dialog" aria-modal="true" aria-label="Response editor">
          <div className="p-4 border-b border-zinc-200 flex items-center justify-between select-none bg-zinc-50">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-zinc-600" />
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-500 font-sans">Response Editor</span>
            </div>
            <button
              onClick={() => {
                setSideEditorMessageId(null);
                setSideEditorContent("");
                setSideEditorUndoStack([]);
                setSideEditorRedoStack([]);
              }}
              className="text-xs font-mono font-medium text-zinc-400 hover:text-zinc-900 uppercase focus:outline-none cursor-pointer"
            >
              [Close]
            </button>
          </div>

          {/* Editor Header Toolbar */}
          <div className="px-5 py-3 bg-white border-b border-zinc-200 flex items-center justify-between select-none">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleSideEditorUndo}
                disabled={sideEditorUndoStack.length <= 1}
                className="p-1.5 rounded border border-zinc-200 hover:bg-zinc-50 disabled:opacity-40 text-zinc-600 hover:text-zinc-900 transition-all cursor-pointer"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleSideEditorRedo}
                disabled={sideEditorRedoStack.length === 0}
                className="p-1.5 rounded border border-zinc-200 hover:bg-zinc-50 disabled:opacity-40 text-zinc-600 hover:text-zinc-900 transition-all cursor-pointer"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Edit / Preview Tabs */}
            <div className="flex bg-zinc-100 p-0.5 rounded border border-zinc-200">
              <button
                type="button"
                onClick={() => setSideEditorTab("edit")}
                className={`px-3 py-1 text-xs font-semibold rounded transition-all cursor-pointer ${
                  sideEditorTab === "edit"
                    ? "bg-white text-zinc-900 font-bold"
                    : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setSideEditorTab("preview")}
                className={`px-3 py-1 text-xs font-semibold rounded transition-all cursor-pointer ${
                  sideEditorTab === "preview"
                    ? "bg-white text-zinc-900 font-bold"
                    : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                Preview
              </button>
            </div>
          </div>

          {/* Main Workspace Area of Response Editor */}
          <div className="flex-1 overflow-hidden flex flex-col bg-white">
            {sideEditorTab === "edit" ? (
              <textarea
                value={sideEditorContent}
                onChange={(e) => handleSideEditorContentChange(e.target.value)}
                placeholder="Edit legal response content here (Supports standard Markdown formatting)..."
                className="flex-1 w-full p-6 text-sm leading-relaxed border-none outline-none focus:ring-0 text-zinc-900 font-mono placeholder-zinc-400 bg-white resize-none overflow-y-auto"
              />
            ) : (
              <div className="flex-1 p-6 overflow-y-auto prose prose-zinc max-w-none text-sm select-text">
                <FormattedMarkdown content={sideEditorContent} />
              </div>
            )}
          </div>

          {/* Footer Save Row */}
          <div className="px-5 py-3.5 bg-zinc-50 border-t border-zinc-200 flex items-center justify-between select-none shrink-0">
            <span className="text-[10px] font-mono text-zinc-400 font-semibold uppercase">
              {sideEditorContent.length} chars
            </span>
            <div className="flex items-center gap-2">
              {sideEditorSaveStatus === "saved" && (
                <span className="text-xs text-green-700 font-medium flex items-center gap-1 animate-fade-in mr-2">
                  <Check className="h-3.5 w-3.5 shrink-0" />
                  Saved
                </span>
              )}
              {sideEditorSaveStatus === "error" && (
                <span className="text-xs text-red-600 font-medium flex items-center gap-1 animate-fade-in mr-2">
                  Error saving
                </span>
              )}
              <button
                type="button"
                onClick={handleSideEditorSave}
                disabled={sideEditorSaveStatus === "saving"}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-mono uppercase font-bold text-white bg-zinc-950 hover:bg-zinc-900 border border-zinc-950 rounded shadow-sm disabled:opacity-55 transition-all cursor-pointer"
              >
                {sideEditorSaveStatus === "saving" ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Collapsible Deep Research steps rendering subcomponent
function CollapsibleSteps({ steps }: { steps: ResearchStep[] }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-4 text-zinc-850 select-none">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 font-mono font-medium py-1 transition-colors cursor-pointer focus:outline-none"
      >
        {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {isOpen ? "Hide Thinking Process" : "Show Thinking Process"} ({steps.length} steps)
      </button>

      {isOpen && (
        <ul className="pl-4 mt-2 space-y-2.5 border-l border-zinc-200 text-xs text-zinc-600 font-sans">
          {steps.map((step, idx) => (
            <li key={idx} className="relative">
              <div className="font-semibold text-zinc-800">
                Step {idx + 1}: {step.subQuestion}
              </div>
              {step.note && (
                <p className="text-zinc-500 mt-0.5 pl-2 border-l border-zinc-100 italic">
                  {step.note}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
