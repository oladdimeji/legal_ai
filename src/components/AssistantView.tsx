import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { 
  MessageSquare, Send, Sparkles, Search, AlertCircle,
  ChevronDown, ChevronUp, FileText, Check, Paperclip, RefreshCw, 
  ExternalLink, BookOpen, Copy, Pencil, X, Briefcase, 
  Folder, Globe, ThumbsUp, ThumbsDown,
  Bold, Italic, Underline, Strikethrough, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Scissors,
  Clipboard, Undo2, Redo2, Save, Link as LinkIcon
} from "lucide-react";
import { Case, Thread, Message, Citation, ResearchStep } from "../types";
import FormattedMarkdown from "./FormattedMarkdown";
import { browserFileIdentity, MAX_SELECTED_FILES } from "../hooks/useCumulativeFileSelection";
import { assistantCitationsToDisplayText } from "../lib/assistantCitations";

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
  cases: Case[];
  activeCaseId: string | null;
  setActiveCaseId: (id: string | null) => void;
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  onMessagesChange: (count: number) => void;
  onNavigateToDrafts: (draftId: string) => void;
  compact?: boolean;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "there", "their", "them", "then", "have", "has", "had", "been", "were", "are", "was", "will", "would", "could", "should", "from", "into", "about", "above", "below", "what", "how", "why", "who", "where", "when", "which", "under", "over", "between", "through", "during", "before", "after", "here", "there", "both", "each", "some", "any", "all", "most", "more", "other", "such", "only", "own", "same", "than", "too", "very", "can", "just", "should"
]);

const WORKING_ACTIVITY_DELAY_MS = 2000;

function buildWorkingActivities({
  queryText,
  hasMatter,
  hasAttachments,
  webSearchEnabled,
  deepResearchEnabled,
}: {
  queryText: string;
  hasMatter: boolean;
  hasAttachments: boolean;
  webSearchEnabled: boolean;
  deepResearchEnabled: boolean;
}): string[] {
  const activities = [
    "Understanding your request…",
    "Identifying the relevant context…",
    hasMatter ? "Reviewing Matter sources…" : "Reviewing Firm Library materials…",
  ];

  if (hasAttachments) {
    activities.push("Reviewing attached documents…");
    if (hasMatter) activities.push("Comparing the documents with the Matter…");
  }
  if (webSearchEnabled) activities.push("Searching the web…");

  if (deepResearchEnabled) {
    activities.push(
      "Breaking the question into research steps…",
      "Examining the legal issues…",
      "Checking supporting and conflicting evidence…",
      "Connecting the relevant findings…",
    );
  } else {
    activities.push(
      "Checking research depth…",
      /claim|liability|breach|cause of action/i.test(queryText)
        ? "Determining the main legal claims…"
        : "Examining the legal issues…",
    );
  }

  activities.push(
    "Organizing the supporting sources…",
    "Synthesizing the findings…",
    "Preparing citations…",
    "Drafting the response…",
    "Refining the response…",
  );

  return activities.filter((activity, index) => activity !== activities[index - 1]);
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

export default function AssistantView({ 
  cases, 
  activeCaseId, 
  setActiveCaseId,
  activeThreadId,
  setActiveThreadId,
  onMessagesChange,
  onNavigateToDrafts,
  compact = false,
}: AssistantViewProps) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [workingStages, setWorkingStages] = useState<string[]>([]);
  const [workingStageIndex, setWorkingStageIndex] = useState(0);
  const [citationPanelSource, setCitationPanelSource] = useState<Citation | null>(null);
  const [activeMessageCitations, setActiveMessageCitations] = useState<Citation[]>([]);
  const [draftingMessageId, setDraftingMessageId] = useState<string | null>(null);
  const [draftFormat, setDraftFormat] = useState<"memo" | "email" | "summary">("memo");
  const [draftInstructions, setDraftInstructions] = useState("");
  const [draftingInProgress, setDraftingInProgress] = useState(false);
  
  // Custom states for toggleable retrieval sources
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [filesAndSourcesOpen, setFilesAndSourcesOpen] = useState(false);
  const [temporaryFiles, setTemporaryFiles] = useState<TemporaryFile[]>([]);
  const [temporaryFileError, setTemporaryFileError] = useState("");
  const [improving, setImproving] = useState(false);
  const fileExtracting = temporaryFiles.some((file) => file.status === "extracting");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const workingActivityTimerRef = useRef<number | null>(null);
  const responseStreamTimerRef = useRef<number | null>(null);
  const componentMountedRef = useRef(true);

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

  // Hover citation portal state
  const [hoveredCitation, setHoveredCitation] = useState<{
    citation: Citation;
    rect: DOMRect;
    lastUserQuery: string;
  } | null>(null);

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

  // Global dismiss for citation hover card on click or scroll
  useEffect(() => {
    const handleGlobalDismiss = () => {
      setHoveredCitation(null);
    };
    window.addEventListener("click", handleGlobalDismiss);
    window.addEventListener("scroll", handleGlobalDismiss, true);
    return () => {
      window.removeEventListener("click", handleGlobalDismiss);
      window.removeEventListener("scroll", handleGlobalDismiss, true);
    };
  }, []);

  // Load threads on mount / change active case
  useEffect(() => {
    fetchThreads();
  }, [activeCaseId]);

  // Load messages when thread changes
  useEffect(() => {
    if (activeThreadId) {
      fetchMessages(activeThreadId);
    } else {
      setMessages([]);
    }
  }, [activeThreadId]);

  // Notify messages change
  useEffect(() => {
    if (onMessagesChange) {
      onMessagesChange(messages.length);
    }
  }, [messages.length, onMessagesChange]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, workingStageIndex]);

  useEffect(() => {
    if (!loading || streaming || workingStages.length < 2) return;
    const advanceActivity = () => {
      workingActivityTimerRef.current = window.setTimeout(() => {
        setWorkingStageIndex((current) => (current + 1) % workingStages.length);
        advanceActivity();
      }, WORKING_ACTIVITY_DELAY_MS);
    };
    advanceActivity();
    return () => {
      if (workingActivityTimerRef.current !== null) {
        window.clearTimeout(workingActivityTimerRef.current);
        workingActivityTimerRef.current = null;
      }
    };
  }, [loading, streaming, workingStages]);

  useEffect(() => {
    componentMountedRef.current = true;
    return () => {
      componentMountedRef.current = false;
      if (workingActivityTimerRef.current !== null) {
        window.clearTimeout(workingActivityTimerRef.current);
      }
      if (responseStreamTimerRef.current !== null) {
        window.clearTimeout(responseStreamTimerRef.current);
      }
    };
  }, []);

  const fetchThreads = async () => {
    try {
      const url = activeCaseId ? `/api/threads?caseId=${activeCaseId}` : "/api/threads?caseId=null";
      const res = await fetch(url);
      const data = await res.json();
      setThreads(data);
    } catch (err) {
      console.error("Error fetching threads:", err);
    }
  };

  const fetchMessages = async (threadId: string) => {
    try {
      const res = await fetch(`/api/threads/${threadId}/messages`);
      const data = await res.json();
      setMessages(data);
    } catch (err) {
      console.error("Error fetching messages:", err);
    }
  };

  const handleStartNewThread = async () => {
    try {
      const title = inputValue.trim() 
        ? (inputValue.trim().substring(0, 45) + "...") 
        : `Consultation on ${new Date().toLocaleDateString()}`;

      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          caseId: activeCaseId
        })
      });
      const newThread = await res.json();
      setThreads((prev) => [newThread, ...prev]);
      setActiveThreadId(newThread.id);
      return newThread.id;
    } catch (err) {
      console.error("Error creating thread:", err);
    }
  };

  const handleAsk = async (e?: React.FormEvent, customQuery?: string) => {
    if (e) e.preventDefault();
    const queryText = (customQuery || inputValue).trim();
    if (!queryText || loading) return;

    if (workingActivityTimerRef.current !== null) {
      window.clearTimeout(workingActivityTimerRef.current);
      workingActivityTimerRef.current = null;
    }
    if (responseStreamTimerRef.current !== null) {
      window.clearTimeout(responseStreamTimerRef.current);
      responseStreamTimerRef.current = null;
    }
    setLoading(true);
    setStreaming(false);
    setWorkingStageIndex(0);
    setWorkingStages(buildWorkingActivities({
      queryText,
      hasMatter: activeCaseId !== null,
      hasAttachments: temporaryFiles.some((file) => file.status === "ready"),
      webSearchEnabled: enableWebSearch,
      deepResearchEnabled,
    }));
    setInputValue("");
    setFilesAndSourcesOpen(false);

    let currentThreadId = activeThreadId;
    if (!currentThreadId) {
      currentThreadId = await handleStartNewThread();
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
      metadata: submittedAttachments.length ? { attachments: submittedAttachments } : {},
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const res = await fetch(`/api/threads/${currentThreadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: queryText,
          forceDeepResearch: deepResearchEnabled,
          enableWebSearch,
          temporaryFiles: submittedTemporaryFiles
            .map(({ filename, text }) => ({ filename, text }))
        })
      });
      
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      void fetchThreads();
      if (!componentMountedRef.current) return;
      if (workingActivityTimerRef.current !== null) {
        window.clearTimeout(workingActivityTimerRef.current);
        workingActivityTimerRef.current = null;
      }

      const savedUserMessage = data.userMessage as Message;
      const savedAssistantMessage = data.assistantMessage as Message;
      const leadingWhitespace = savedAssistantMessage.content.match(/^\s*/)?.[0] || "";
      const streamTokens = savedAssistantMessage.content.slice(leadingWhitespace.length).match(/\S+\s*/g) || [];
      const wordCount = streamTokens.length;
      const targetDuration = Math.min(8500, Math.max(3000, 2800 + wordCount * 14));
      const targetUpdates = Math.min(90, Math.max(24, Math.ceil(wordCount / 2)));
      const tokensPerStep = Math.max(1, Math.ceil(wordCount / targetUpdates));
      const streamDelay = Math.max(45, Math.round(targetDuration / Math.max(1, Math.ceil(wordCount / tokensPerStep))));
      let revealedTokenCount = 0;

      setMessages((prev) => {
        const messagesWithoutSavedCopies = prev.filter((message) =>
          message.id !== savedUserMessage.id && message.id !== savedAssistantMessage.id
        );
        return [
          ...messagesWithoutSavedCopies.map((message) => message.id === tempUserMsg.id ? savedUserMessage : message),
          { ...savedAssistantMessage, content: "" },
        ];
      });
      setStreaming(true);

      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (prefersReducedMotion || wordCount === 0) {
        setMessages((prev) => prev.map((message) =>
          message.id === savedAssistantMessage.id ? savedAssistantMessage : message
        ));
      } else {
        await new Promise<void>((resolve) => {
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
              setMessages((prev) => prev.map((message) =>
                message.id === savedAssistantMessage.id ? savedAssistantMessage : message
              ));
              resolve();
            }, streamDelay);
          };
          revealNextChunk();
        });
      }

      setTemporaryFiles([]);
    } catch (err: any) {
      if (workingActivityTimerRef.current !== null) {
        window.clearTimeout(workingActivityTimerRef.current);
        workingActivityTimerRef.current = null;
      }
      if (responseStreamTimerRef.current !== null) {
        window.clearTimeout(responseStreamTimerRef.current);
        responseStreamTimerRef.current = null;
      }
      setStreaming(false);
      console.error("Error processing request:", err);
      const errAssistantMsg: Message = {
        id: `temp_err_${Date.now()}`,
        thread_id: currentThreadId,
        role: "assistant",
        content: `❌ Error: ${err.message || "Failed to contact Exepts model service."} Please verify your GEMINI_API_KEY in Secrets.`,
        citations: [],
        steps: null,
        created_at: new Date().toISOString()
      };
      setMessages((prev) => [...prev, errAssistantMsg]);
    } finally {
      setStreaming(false);
      setLoading(false);
    }
  };

  // Enhance / Improve Prompt using AI
  const handleImprovePrompt = async () => {
    const rawPrompt = inputValue.trim();
    if (!rawPrompt || improving) return;

    setImproving(true);
    try {
      const res = await fetch("/api/improve-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: rawPrompt })
      });
      const data = await res.json();
      if (data.improved) {
        setInputValue(data.improved);
      }
    } catch (err) {
      console.error("Failed to improve prompt:", err);
    } finally {
      setImproving(false);
    }
  };

  const handleTemporaryFiles = async (files: FileList | null) => {
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

  const handleGenerateDraft = async (messageId: string) => {
    setDraftingMessageId(messageId);
    setDraftInstructions("");
  };

  const submitDraftRequest = async () => {
    if (!activeThreadId || !draftingMessageId) return;
    
    setDraftingInProgress(true);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: activeThreadId,
          format: draftFormat,
          instructions: draftInstructions
        })
      });
      const data = await res.json();
      if (data.id) {
        setDraftingMessageId(null);
        onNavigateToDrafts(data.id);
      } else {
        alert("Failed to generate draft: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      alert("Error generating draft: " + err.message);
    } finally {
      setDraftingInProgress(false);
    }
  };

  const renderMessageTextWithCitations = (text: string, citationsList: Citation[]) => {
    if (!text) return null;
    return (
      <FormattedMarkdown
        content={text}
        citations={citationsList}
        onCitationHover={(citation, rect) => {
          const lastUserQuery = [...messages].reverse().find(m => m.role === "user")?.content || "";
          setHoveredCitation({ citation, rect, lastUserQuery });
        }}
        onCitationLeave={() => setHoveredCitation(null)}
        onCitationClick={(citation, all) => {
          setCitationPanelSource(citation);
          setActiveMessageCitations(all);
        }}
      />
    );
  };  // Reusable Ask Bar Form component
  const renderAskBarForm = () => {
    return (
      <form onSubmit={handleAsk} className="w-full relative flex flex-col select-none">
        <div className="w-full border border-zinc-200 focus-within:border-zinc-400 rounded-lg bg-white p-3 transition-all flex flex-col gap-2.5">
          {/* Selected Files / Sources Chips Bar at the top of the container */}
          {(enableWebSearch || temporaryFiles.length > 0) && (
            <div className="flex flex-wrap gap-2 select-none pb-2 border-b border-zinc-100 animate-fade-in" id="attached-chips-row">
              {enableWebSearch && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-zinc-50 text-zinc-600 rounded-full text-xs font-mono border border-zinc-200 animate-fade-in">
                  <Globe className="h-3 w-3 shrink-0 text-zinc-450" />
                  <span>Web search</span>
                  <button type="button" onClick={() => setEnableWebSearch(false)} className="hover:text-zinc-900 font-bold ml-1 text-[10px] focus:outline-none cursor-pointer">✕</button>
                </span>
              )}
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
            placeholder={activeCaseId ? "Ask about Sources in the selected Matter..." : "Ask using the Firm Library and permitted external sources..."}
            className="w-full min-h-[64px] max-h-[180px] p-1.5 border-none outline-none focus:ring-0 text-sm text-zinc-900 placeholder-zinc-400 font-sans transition-all resize-none bg-white"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAsk();
              }
            }}
          />

          {/* Bottom control row inside the unified container */}
          <div className="flex flex-wrap items-center justify-between gap-2 select-none pt-2 border-t border-zinc-100 bg-white">
            <div className="flex min-w-0 flex-wrap items-center gap-2 relative">
              {/* Streamlined Workspace project selector dropdown */}
              <div className="relative inline-block">
                <select
                  value={activeCaseId || "wide"}
                  onChange={(e) => {
                    const val = e.target.value;
                    setActiveThreadId(null);
                    setActiveCaseId(val === "wide" ? null : val);
                  }}
                  className="appearance-none bg-white border border-zinc-200 text-xs font-mono font-semibold text-zinc-600 hover:text-zinc-900 px-2.5 py-1.5 pr-7 rounded focus:outline-none cursor-pointer hover:border-zinc-300 transition-all"
                >
                  <option value="wide">General Assistant</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      💼 {c.name.length > 15 ? `${c.name.substring(0, 15)}...` : c.name}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1.5 text-zinc-400">
                  <ChevronDown className="h-3 w-3" />
                </div>
              </div>

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
                  <span>Research sources</span>
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
                    
                    {/* Toggle-style selectable sources with icons inside dropdown */}
                    <div>
                      <span className="text-[10px] font-mono uppercase text-zinc-400 font-bold block mb-2 tracking-wider">Legal Data Grounding</span>
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => setEnableWebSearch(!enableWebSearch)}
                          className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-md border transition-all cursor-pointer ${
                            enableWebSearch
                              ? "bg-amber-50 text-amber-900 border-amber-200 font-semibold"
                              : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <Globe className="h-4 w-4 text-amber-600 shrink-0" />
                            <span>Web search (Google Grounding)</span>
                          </div>
                          <div className={`w-4 h-4 rounded border flex items-center justify-center ${enableWebSearch ? "bg-amber-600 border-amber-600 text-white" : "border-zinc-300 bg-white"}`}>
                            {enableWebSearch && <Check className="h-3 w-3" />}
                          </div>
                        </button>

                      </div>
                    </div>

                    <div className="border-t border-zinc-100 pt-3">
                      <span className="text-[10px] font-mono uppercase text-zinc-400 font-bold block mb-2 tracking-wider">Temporary File Attachments</span>
                      <label className="flex cursor-pointer items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950 hover:border-zinc-300 transition-all">
                        <span className="flex items-center gap-2.5"><Paperclip className="h-4 w-4" />Add PDF, DOCX, or TXT</span>
                        <input
                          type="file"
                          className="sr-only"
                          multiple
                          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                          onChange={(event) => {
                            void handleTemporaryFiles(event.target.files);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      {fileExtracting && <p className="mt-2 text-[10px] font-mono uppercase text-zinc-400">Extracting files...</p>}
                      {temporaryFileError && <p className="mt-2 text-xs text-red-700">{temporaryFileError}</p>}
                    </div>
                  </div>,
                  document.body
                )}
              </div>

              {/* Improve button */}
              <button
                type="button"
                onClick={handleImprovePrompt}
                disabled={!inputValue.trim() || improving}
                id="btn-improve-query"
                className="flex items-center gap-1 px-2 py-1 text-xs font-mono font-bold text-zinc-600 hover:text-zinc-950 border border-zinc-200 rounded-md bg-white transition-all disabled:opacity-50 cursor-pointer shadow-xs hover:border-zinc-300"
                title="Optimize query with legal-grade framing"
              >
                <Sparkles className={`h-3.5 w-3.5 text-zinc-800 ${improving ? "animate-spin" : ""}`} />
                <span>{improving ? "Improving..." : "Improve"}</span>
              </button>
            </div>

            {/* Right Side Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={deepResearchEnabled}
                  onChange={(e) => setDeepResearchEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="relative w-8 h-4.5 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:bg-zinc-950 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:after:translate-x-3.5 border border-transparent shadow-inner"></div>
                <span className="text-[11px] font-mono uppercase font-bold text-zinc-500 peer-checked:text-zinc-950">
                  Deep Research
                </span>
              </label>

              <button
                type="submit"
                disabled={!inputValue.trim() || loading || fileExtracting}
                id="btn-submit-ask"
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono uppercase font-bold text-white bg-zinc-950 hover:bg-zinc-900 border border-zinc-950 rounded shadow-xs disabled:opacity-40 transition-all cursor-pointer"
              >
                {streaming ? "Responding..." : loading ? "Sending..." : "Ask"}
                {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              </button>
            </div>
          </div>
        </div>
      </form>
    );
  };

  // Clickable source suggestions on first message
  const renderFirstMessageSuggestions = () => {
    return (
      <div className="flex flex-col items-center gap-3 w-full select-none" id="source-suggestions">
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400">Quick-Enable Grounding Sources</span>
        <div className="flex flex-wrap justify-center gap-2.5">
          <button
            type="button"
            onClick={() => setEnableWebSearch(!enableWebSearch)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-full border text-xs font-semibold transition-all cursor-pointer ${
              enableWebSearch
                ? "bg-amber-50 text-amber-900 border-amber-300 shadow-sm"
                : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300"
            }`}
          >
            <Globe className="h-4 w-4 text-amber-600" />
            <span>Web Search</span>
            {enableWebSearch && <Check className="h-3.5 w-3.5 ml-0.5 text-amber-700" />}
          </button>

        </div>
      </div>
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
        
        {messages.length > 0 ? (
          <>
            {/* Simple Thread Title Header (Only if there are messages) */}
            <div className={`${compact ? "hidden" : "flex"} px-8 py-4.5 bg-zinc-50 border-b border-zinc-100 items-center justify-between z-10 select-none shrink-0`} id="active-thread-header">
              <div>
                <span className="text-xs font-mono font-semibold uppercase text-zinc-400 tracking-wider">{activeCaseId ? `Matter Context · ${cases.find((matter) => matter.id === activeCaseId)?.name || "Matter"}` : "General Assistant Context"}</span>
                <h2 className="text-sm font-sans font-semibold text-zinc-800 line-clamp-1 mt-0.5">
                  {activeThreadId ? threads.find(t => t.id === activeThreadId)?.title || "Consultation Thread" : "New Consultation"}
                </h2>
              </div>
              
              <button 
                onClick={() => {
                  setActiveThreadId(null);
                  setMessages([]);
                  setEnableWebSearch(false);
                }}
                id="header-new-thread-btn"
                className="text-xs uppercase font-mono font-bold border border-zinc-950 text-zinc-950 px-4 py-2 rounded hover:bg-zinc-100 transition-all cursor-pointer"
              >
                + New Consultation
              </button>
            </div>

            {/* Message Thread History List */}
            <div className={`flex-1 overflow-y-auto space-y-2 ${compact ? "px-4 py-4" : "px-8 py-6"}`} id="chat-messages-scroll-area">
              {messages.map((m, index) => {
                const isLastMessage = index === messages.length - 1;
                const lastAssistantMessageId = [...messages]
                  .reverse()
                  .find((msg) => msg.role === "assistant")?.id;

                return (
                  <div key={m.id} className="w-full max-w-3xl mx-auto flex flex-col py-5 animate-fade-in" id={`message-wrapper-${m.id}`}>
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

                          {/* Body Text */}
                          <div className="font-sans font-normal leading-relaxed text-zinc-900">
                            {renderMessageTextWithCitations(m.content, m.citations)}
                          </div>

                          {/* Message Action Items */}
                          {!m.content.startsWith("❌") && (
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
                                ) : (
                                  <span className="text-xs font-mono text-zinc-400">
                                    0 sources matched
                                  </span>
                                )}

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
                                    navigator.clipboard.writeText(assistantCitationsToDisplayText(m.content, m.citations));
                                    alert("Response copied to clipboard!");
                                  }}
                                  id={`action-copy-${m.id}`}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded transition-colors"
                                  title="Copy response"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  <span>Copy</span>
                                </button>

                                {/* Rewrite action button - restricted to latest assistant message */}
                                {m.id === lastAssistantMessageId && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setInputValue(`Please rewrite the previous response to make it `);
                                      textareaRef.current?.focus();
                                    }}
                                    id={`action-rewrite-${m.id}`}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded transition-colors animate-fade-in"
                                    title="Rewrite response"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    <span>Rewrite</span>
                                  </button>
                                )}

                                <button
                                  onClick={() => {
                                    handleGenerateDraft(m.id);
                                  }}
                                  id={`action-draft-${m.id}`}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase font-semibold border border-zinc-200 hover:border-zinc-900 hover:bg-zinc-50 rounded transition-colors text-zinc-700 hover:text-zinc-950"
                                  title="Generate document draft from this response"
                                >
                                  <FileText className="h-3.5 w-3.5" />
                                  <span>Generate Draft</span>
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
                              onClick={() => handleAsk(undefined, suggestion)}
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

              {loading && (
                !streaming && (
                  <div className="flex items-start" id="chat-loading-indicator" aria-live="polite">
                    <div className="bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-3 max-w-xl flex items-center gap-3 select-none">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-zinc-400 opacity-50" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-zinc-800" />
                      </span>
                      <p className="text-xs font-mono font-medium text-zinc-700">
                        {workingStages[workingStageIndex] || "Understanding your request…"}
                      </p>
                    </div>
                  </div>
                )
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Pinned bottom-anchored Ask Bar Form wrapper */}
            <div className={`${compact ? "p-3" : "px-8 py-6"} bg-white border-t border-zinc-100 shrink-0`} id="ask-bar-container">
              {renderAskBarForm()}
            </div>
          </>
        ) : (
          <div className={`flex flex-1 flex-col overflow-y-auto bg-white ${compact ? "justify-end p-3" : "items-center justify-center px-8"}`} id="compact-empty-conversation">
            <div className={`w-full ${compact ? "space-y-3" : "max-w-3xl space-y-8 py-12"}`}>
              <div className={compact ? "rounded border border-dashed border-zinc-200 px-4 py-3" : "text-center"}>
                <p className="text-xs font-semibold text-zinc-800">Start a conversation</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                  Ask about the page you are working on, research a question, or attach a temporary file.
                </p>
              </div>
              <div className="w-full text-left">{renderAskBarForm()}</div>
              {!compact && renderFirstMessageSuggestions()}
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

      {/* Drafting Configurations Modal */}
      {draftingMessageId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" id="drafting-modal">
          <div className="bg-white border border-zinc-200 rounded-lg shadow-lg w-full max-w-lg overflow-hidden animate-fade-in text-zinc-900">
            <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-150 text-zinc-900 flex items-center justify-between select-none">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-600 font-sans">Initialize Draft Generator</h3>
              <button 
                onClick={() => setDraftingMessageId(null)}
                className="text-zinc-400 hover:text-zinc-700 font-mono text-xs cursor-pointer focus:outline-none"
              >
                [Cancel]
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase font-semibold text-zinc-500 mb-2 select-none">Drafting Format Style:</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["memo", "email", "summary"] as const).map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setDraftFormat(fmt)}
                      className={`px-3 py-2 border text-xs font-semibold rounded uppercase tracking-wide transition-all cursor-pointer ${
                        draftFormat === fmt
                          ? "bg-zinc-900 border-zinc-900 text-white"
                          : "border-zinc-200 hover:bg-zinc-50 text-zinc-700 hover:border-zinc-300"
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono uppercase font-semibold text-zinc-500 mb-2 select-none">Custom Attorney Directives:</label>
                <textarea
                  value={draftInstructions}
                  onChange={(e) => setDraftInstructions(e.target.value)}
                  placeholder="e.g., Focus primarily on CA SB 699, frame argument as defense counsel, keep the conclusion concise..."
                  className="w-full h-24 p-3 border border-zinc-200 rounded text-sm focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 text-zinc-900 resize-none font-sans"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-150 flex justify-end gap-2.5 select-none">
              <button
                onClick={() => setDraftingMessageId(null)}
                className="px-4 py-2 text-xs font-mono uppercase font-semibold border border-zinc-200 hover:bg-zinc-100 rounded cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={submitDraftRequest}
                disabled={draftingInProgress}
                className="px-4 py-2 text-xs font-mono uppercase font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded disabled:opacity-50 cursor-pointer"
              >
                {draftingInProgress ? "Drafting Document..." : "Generate & Save Draft"}
              </button>
            </div>
          </div>
        </div>
      )}

      {hoveredCitation && createPortal(
        <span 
          style={{
            position: "fixed",
            left: `${hoveredCitation.rect.left + hoveredCitation.rect.width / 2}px`,
            bottom: `${window.innerHeight - hoveredCitation.rect.top + 8}px`,
            transform: "translateX(-50%)",
          }}
          className="flex flex-col w-80 bg-white border border-zinc-200 rounded-md shadow-md p-4 z-50 text-left pointer-events-none animate-fade-in font-sans"
        >
          <span className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] font-mono font-semibold uppercase text-zinc-400">
              {hoveredCitation.citation.sourceName || "Source"}
            </span>
          </span>
          <span className="text-xs font-bold text-zinc-900 leading-snug block">
            {hoveredCitation.citation.title || "Untitled Reference"}
          </span>
          
          {hoveredCitation.citation.url ? (
            <span className="text-[10px] font-mono text-zinc-400 mt-1 truncate block animate-fade-in">
              {hoveredCitation.citation.url}
            </span>
          ) : (
            <span className="text-[10px] font-mono text-zinc-400 mt-1 block truncate animate-fade-in">
              {hoveredCitation.citation.title || "Workspace Document"}
            </span>
          )}
          
          <span className="mt-3 pt-2.5 border-t border-zinc-100 block">
            <span className="max-h-[140px] overflow-y-auto text-[11px] leading-relaxed text-zinc-600 font-mono block whitespace-pre-wrap break-words select-text">
              {(() => {
                const processed = getProcessedSnippet(hoveredCitation.citation.textSnippet || "", hoveredCitation.lastUserQuery);
                return (
                  <>
                    "{processed.element}{processed.isTruncated ? "..." : ""}"
                  </>
                );
              })()}
            </span>
          </span>
          
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white border-r border-b border-zinc-200 rotate-45 block"></span>
        </span>,
        document.body
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
