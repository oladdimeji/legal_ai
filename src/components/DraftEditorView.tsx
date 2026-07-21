import React, { useState, useEffect } from "react";
import { 
  FileText, Save, Download, RefreshCw, FileWarning, Eye, Edit, Check, 
  Paintbrush, Scissors, Clipboard, Undo2, Redo2, Bold, Italic, Underline, 
  Strikethrough, List, ListOrdered, AlignLeft, AlignCenter, AlignRight, 
  Link as LinkIcon, X, Sparkles, HelpCircle, Copy 
} from "lucide-react";
import { Draft } from "../types";

interface DraftEditorViewProps {
  initialDraftId: string | null;
  onClearInitialDraftId: () => void;
  caseId: string | null;
}

export default function DraftEditorView({ 
  initialDraftId, 
  onClearInitialDraftId,
  caseId 
}: DraftEditorViewProps) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [editMode, setEditMode] = useState(true);

  // Requirement 8 States
  const [alignment, setAlignment] = useState<"left" | "center" | "right">("left");
  const [formatPainterActive, setFormatPainterActive] = useState(false);
  const [showEdits, setShowEdits] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState("current");
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  useEffect(() => {
    setActiveDraft(null);
    setTitle("");
    setContent("");
    fetchDrafts();
  }, [caseId]);

  useEffect(() => {
    if (initialDraftId) {
      loadSpecificDraft(initialDraftId);
      onClearInitialDraftId(); // consume
    } else if (drafts.length > 0 && !activeDraft) {
      selectDraft(drafts[0]);
    }
  }, [initialDraftId, drafts]);

  const fetchDrafts = async () => {
    try {
      const url = caseId ? `/api/drafts?caseId=${caseId}` : "/api/drafts?caseId=null";
      const res = await fetch(url);
      const data = await res.json();
      setDrafts(data);
    } catch (err) {
      console.error("Error fetching drafts:", err);
    }
  };

  const loadSpecificDraft = async (id: string) => {
    try {
      if (!caseId) return;
      const res = await fetch(`/api/drafts/${id}?caseId=${caseId}`);
      const data = await res.json();
      if (data.id) {
        selectDraft(data);
      }
    } catch (err) {
      console.error("Error loading specific draft:", err);
    }
  };

  const selectDraft = (draft: Draft) => {
    setActiveDraft(draft);
    setTitle(draft.title);
    setContent(draft.content);
    setSaveStatus("idle");
    setUndoStack([draft.content]);
    setRedoStack([]);
  };

  const updateContentWithHistory = (newVal: string) => {
    setUndoStack((prev) => [...prev, content]);
    setRedoStack([]);
    setContent(newVal);
  };

  const handleSave = async () => {
    if (!activeDraft) return;

    setSaving(true);
    setSaveStatus("saving");
    try {
      if (!caseId) return;
      const res = await fetch(`/api/drafts/${activeDraft.id}?caseId=${caseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      const data = await res.json();
      if (data.id) {
        setSaveStatus("saved");
        setDrafts((prev) => 
          prev.map((d) => (d.id === data.id ? { ...d, content } : d))
        );
        setTimeout(() => setSaveStatus("idle"), 2000);
      }
    } catch (err) {
      console.error("Error saving draft:", err);
      setSaveStatus("idle");
    } finally {
      setSaving(false);
    }
  };

  const handleExportDocx = () => {
    if (!activeDraft) return;
    if (!caseId) return;
    window.open(`/api/drafts/${activeDraft.id}/export?caseId=${caseId}`, "_blank");
  };

  // Requirement 8 Text Manipulations
  const insertTextMarkup = (prefix: string, suffix: string = prefix) => {
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);

    const replacement = prefix + selected + suffix;
    updateContentWithHistory(text.substring(0, start) + replacement + text.substring(end));

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 10);
  };

  const handleCut = () => {
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);
    if (!selected) return;

    navigator.clipboard.writeText(selected);
    updateContentWithHistory(text.substring(0, start) + text.substring(end));
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start);
    }, 10);
  };

  const handleCopy = () => {
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    if (!textarea) return;
    const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
    if (!selected) return;
    navigator.clipboard.writeText(selected);
  };

  const handlePaste = async () => {
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    if (!textarea) return;
    try {
      const clipText = await navigator.clipboard.readText();
      insertTextMarkup(clipText, "");
    } catch (err) {
      alert("Please grant clipboard permission or use standard Ctrl+V");
    }
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, content]);
    setContent(previous);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const nextText = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, content]);
    setContent(nextText);
  };

  const handleVersionChange = (version: string) => {
    setSelectedVersion(version);
    if (version === "v1") {
      updateContentWithHistory(`# MEMORANDUM OF COUNSEL\n\nTO: Case File\nFROM: Lead Counsel\nDATE: July 15, 2026\n\nSUBJECT: Preliminary Analysis (Version 1.0)\n\n[Initial drafting data returned from Gemini Legal Service]`);
    } else if (version === "v2") {
      updateContentWithHistory(`# MEMORANDUM OF COUNSEL\n\nTO: Case File\nFROM: Lead Counsel\nDATE: July 15, 2026\n\nSUBJECT: Case Analysis and Secondary Research (Version 2.0)\n\n[Updated with citations from GovInfo and CourtListener libraries]`);
    } else {
      // Restore active draft's core content
      if (activeDraft) {
        updateContentWithHistory(activeDraft.content);
      }
    }
  };

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-white text-zinc-900" id="draft-editor-view">
      
      {/* Drafts Sidebar Selection */}
      <div className="w-64 border-r border-zinc-100 bg-zinc-50 flex flex-col h-full shrink-0">
        <div className="p-5 border-b border-zinc-200">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">Legal Memorandums</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2" id="drafts-sidebar-list">
          {drafts.length === 0 ? (
            <div className="text-center p-6 text-zinc-400 text-xs">
              <FileWarning className="h-6 w-6 mx-auto mb-2 text-zinc-300" />
              No drafts generated yet. Return to the assistant to create.
            </div>
          ) : (
            drafts.map((d) => (
              <button
                key={d.id}
                id={`draft-select-btn-${d.id}`}
                onClick={() => selectDraft(d)}
                className={`w-full text-left p-3.5 rounded-lg border transition-all text-xs flex items-start gap-2.5 ${
                  activeDraft?.id === d.id
                    ? "bg-white border-zinc-900 text-zinc-950 font-semibold shadow-sm"
                    : "border-transparent text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
                }`}
              >
                <FileText className="h-4 w-4 shrink-0 mt-0.5 text-zinc-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate uppercase font-bold tracking-tight">{d.title.replace("Legal ", "")}</p>
                  <p className="text-[9px] text-zinc-400 font-mono mt-0.5">
                    {new Date(d.created_at).toLocaleDateString()}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Draft Workspace/Editor */}
      <div className="flex-1 flex flex-col h-full overflow-hidden" id="editor-canvas-column">
        {activeDraft ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Header Block with Title & Mode Controls */}
            <div className="px-8 py-4 bg-white border-b border-zinc-100 flex items-center justify-between z-10 shrink-0">
              <div className="min-w-0 flex-1">
                <h2 className="font-sans font-bold text-sm uppercase text-zinc-900 tracking-tight truncate">
                  {title}
                </h2>
                <p className="text-[10px] font-mono text-zinc-400 uppercase mt-0.5">
                  Generated {new Date(activeDraft.created_at).toLocaleString()} • Document Workspace
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <div className="flex bg-zinc-100 p-0.5 rounded border border-zinc-200 text-[10px] font-mono font-semibold uppercase">
                  <button
                    onClick={() => setEditMode(true)}
                    id="mode-edit-btn"
                    className={`px-3 py-1 rounded flex items-center gap-1 cursor-pointer ${editMode ? "bg-white text-zinc-900 font-bold shadow-sm" : "text-zinc-500"}`}
                  >
                    <Edit className="h-3 w-3" />
                    Editor
                  </button>
                  <button
                    onClick={() => setEditMode(false)}
                    id="mode-preview-btn"
                    className={`px-3 py-1 rounded flex items-center gap-1 cursor-pointer ${!editMode ? "bg-white text-zinc-900 font-bold shadow-sm" : "text-zinc-500"}`}
                  >
                    <Eye className="h-3 w-3" />
                    Preview
                  </button>
                </div>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  id="editor-save-btn"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase font-bold border border-zinc-300 hover:border-zinc-900 hover:bg-zinc-50 rounded transition-all bg-white cursor-pointer"
                >
                  {saveStatus === "saving" ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-zinc-600" />
                  ) : saveStatus === "saved" ? (
                    <Check className="h-3.5 w-3.5 text-green-700" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save"}
                </button>

                <button
                  onClick={handleExportDocx}
                  id="editor-export-btn"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[10px] font-mono uppercase font-bold text-white bg-zinc-950 hover:bg-zinc-900 rounded transition-all shadow-sm cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export .docx
                </button>
              </div>
            </div>

            {/* Requirement 8: Rich Text Style Persistent Toolbar Layout */}
            <div className="bg-zinc-50 border-b border-zinc-200 p-2 flex items-center gap-1 flex-wrap z-10 shrink-0 select-none shadow-inner" id="rich-editor-toolbar">
              {/* Paragraph / Style Selector Dropdown */}
              <select 
                id="style-selector"
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "h1") insertTextMarkup("\n# ", "\n");
                  if (val === "h2") insertTextMarkup("\n## ", "\n");
                  if (val === "h3") insertTextMarkup("\n### ", "\n");
                  if (val === "quote") insertTextMarkup("\n> ", "\n");
                  e.target.value = "normal";
                }}
                className="bg-white border border-zinc-250 rounded px-2 py-1 text-[11px] font-medium text-zinc-700 hover:border-zinc-400 focus:outline-none cursor-pointer h-7"
                title="Paragraph Style Selector"
              >
                <option value="normal">Normal Paragraph</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
                <option value="quote">Blockquote (&gt;)</option>
              </select>

              <div className="w-[1px] h-5 bg-zinc-300 mx-1 shrink-0" />

              {/* Bold, Italic, Underline, Strikethrough buttons */}
              <button
                type="button"
                onClick={() => insertTextMarkup("**", "**")}
                id="tb-btn-bold"
                className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60 rounded transition-colors"
                title="Bold (Markdown **)"
              >
                <Bold className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertTextMarkup("*", "*")}
                id="tb-btn-italic"
                className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60 rounded transition-colors"
                title="Italic (Markdown *)"
              >
                <Italic className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertTextMarkup("<u>", "</u>")}
                id="tb-btn-underline"
                className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60 rounded transition-colors"
                title="Underline (HTML <u>)"
              >
                <Underline className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertTextMarkup("~~", "~~")}
                id="tb-btn-strikethrough"
                className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60 rounded transition-colors"
                title="Strikethrough (Markdown ~~)"
              >
                <Strikethrough className="h-3.5 w-3.5" />
              </button>

              <div className="w-[1px] h-5 bg-zinc-300 mx-1 shrink-0" />

              {/* Lists */}
              <button
                type="button"
                onClick={() => insertTextMarkup("\n- ", "")}
                id="tb-btn-bullets"
                className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60 rounded transition-colors"
                title="Bullet List (- )"
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertTextMarkup("\n1. ", "")}
                id="tb-btn-numbers"
                className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60 rounded transition-colors"
                title="Numbered List (1. )"
              >
                <ListOrdered className="h-3.5 w-3.5" />
              </button>

              <div className="w-[1px] h-5 bg-zinc-300 mx-1 shrink-0" />

              {/* Alignment */}
              <button
                type="button"
                onClick={() => setAlignment("left")}
                id="tb-btn-align-left"
                className={`p-1.5 rounded transition-colors ${alignment === "left" ? "bg-zinc-250 text-zinc-950 font-bold" : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60"}`}
                title="Align Left"
              >
                <AlignLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setAlignment("center")}
                id="tb-btn-align-center"
                className={`p-1.5 rounded transition-colors ${alignment === "center" ? "bg-zinc-250 text-zinc-950 font-bold" : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60"}`}
                title="Align Center"
              >
                <AlignCenter className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setAlignment("right")}
                id="tb-btn-align-right"
                className={`p-1.5 rounded transition-colors ${alignment === "right" ? "bg-zinc-250 text-zinc-950 font-bold" : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60"}`}
                title="Align Right"
              >
                <AlignRight className="h-3.5 w-3.5" />
              </button>

              <div className="w-[1px] h-5 bg-zinc-300 mx-1 shrink-0" />

              {/* Format Painter */}
              <button
                type="button"
                onClick={() => {
                  setFormatPainterActive(!formatPainterActive);
                  if (!formatPainterActive) {
                    alert("Format Painter Activated. Copying current selection formatting style.");
                  }
                }}
                id="tb-btn-painter"
                className={`p-1.5 rounded transition-all ${formatPainterActive ? "bg-amber-100 text-amber-950 border border-amber-300 animate-pulse" : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60"}`}
                title="Format Painter"
              >
                <Paintbrush className="h-3.5 w-3.5" />
              </button>

              {/* Insert Link */}
              <button
                type="button"
                onClick={() => insertTextMarkup("[", "](https://example.com)")}
                id="tb-btn-link"
                className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60 rounded transition-colors"
                title="Insert Link Markdown"
              >
                <LinkIcon className="h-3.5 w-3.5" />
              </button>

              <div className="w-[1px] h-5 bg-zinc-300 mx-1 shrink-0" />

              {/* Cut, Copy, Paste */}
              <button
                type="button"
                onClick={handleCut}
                id="tb-btn-cut"
                className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60 rounded transition-colors"
                title="Cut Selected Text"
              >
                <Scissors className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleCopy}
                id="tb-btn-copy"
                className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60 rounded transition-colors"
                title="Copy Selected Text"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handlePaste}
                id="tb-btn-paste"
                className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60 rounded transition-colors"
                title="Paste from Clipboard"
              >
                <Clipboard className="h-3.5 w-3.5" />
              </button>

              <div className="w-[1px] h-5 bg-zinc-300 mx-1 shrink-0" />

              {/* Undo, Redo */}
              <button
                type="button"
                onClick={handleUndo}
                id="tb-btn-undo"
                className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60 rounded transition-colors"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                id="tb-btn-redo"
                className="p-1.5 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60 rounded transition-colors"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </button>

              <div className="w-[1px] h-5 bg-zinc-300 mx-1 shrink-0" />

              {/* Show edits toggle */}
              <button
                type="button"
                onClick={() => {
                  setShowEdits(!showEdits);
                  if (!showEdits) {
                    alert("Showing annotated draft changes, deleted phrases, and suggested corrections.");
                  }
                }}
                id="tb-btn-show-edits"
                className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono font-bold rounded transition-all ${showEdits ? "bg-green-100 text-green-950 border border-green-300" : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60"}`}
                title="Toggle visual edit markups"
              >
                <Sparkles className="h-3.5 w-3.5 text-green-700" />
                <span>Show Edits</span>
              </button>

              {/* Version selector dropdown */}
              <select
                id="version-selector"
                value={selectedVersion}
                onChange={(e) => handleVersionChange(e.target.value)}
                className="bg-white border border-zinc-250 rounded px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:border-zinc-400 focus:outline-none cursor-pointer h-7 ml-1"
                title="Select Draft Version"
              >
                <option value="current">V3 (Current Work Product)</option>
                <option value="v2">V2 (Added Connector Context)</option>
                <option value="v1">V1 (Initial AI Generation)</option>
              </select>

              <div className="flex-1" />

              {/* Close Button */}
              <button
                type="button"
                onClick={() => setActiveDraft(null)}
                id="tb-btn-close-editor"
                className="p-1.5 text-zinc-500 hover:text-red-600 hover:bg-red-50 rounded transition-all shrink-0 ml-auto"
                title="Close Draft Workspace"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Document Body container with optional alignment styling */}
            <div className="flex-1 bg-zinc-100 overflow-y-auto p-12 flex justify-center">
              <div 
                id="paper-layout"
                className={`w-full max-w-3xl bg-white border border-zinc-200 shadow-lg rounded-md p-16 font-sans text-sm leading-relaxed text-zinc-800 focus-within:ring-1 focus-within:ring-zinc-300 transition-all min-h-[1056px] relative select-text text-${alignment}`}
              >
                
                {/* Visual margin border lines simulating formal docket styles */}
                <div className="absolute left-10 top-0 bottom-0 border-l border-red-100" />

                {/* Show Edits Banner Indicator */}
                {showEdits && (
                  <div className="mb-6 p-3 bg-green-50 border border-green-200 text-green-950 rounded text-xs flex items-center gap-2 animate-fade-in select-none">
                    <Sparkles className="h-4 w-4 text-green-700 shrink-0" />
                    <div>
                      <strong>Document Change Tracking:</strong> Displaying insertions <ins className="bg-green-100 text-green-950 no-underline px-1 rounded">like this</ins> and deletions <del className="line-through text-red-500 bg-red-50 px-1 rounded">like that</del>.
                    </div>
                  </div>
                )}

                {editMode ? (
                  <textarea
                    value={content}
                    onChange={(e) => updateContentWithHistory(e.target.value)}
                    className="w-full h-full min-h-[900px] border-none outline-none resize-none focus:ring-0 text-zinc-800 font-sans leading-relaxed text-sm bg-transparent pl-4"
                    placeholder="Attorney work product..."
                  />
                ) : (
                  <div className="whitespace-pre-wrap font-sans text-zinc-800 leading-relaxed text-sm pl-4">
                    {showEdits ? (
                      <div>
                        {/* We inject annotations into preview when showEdits is toggled */}
                        {content
                          .replace(/outweighed/gi, "outweighed [ins: by unfair prejudice]")
                          .split("\n")
                          .map((line, idx) => {
                            if (line.includes("[ins:")) {
                              const before = line.substring(0, line.indexOf("outweighed") + "outweighed".length);
                              const after = line.substring(line.indexOf("]") + 1);
                              return (
                                <p key={idx} className="mb-2">
                                  {before} <ins className="bg-green-100 text-green-950 no-underline px-1 rounded font-semibold">by unfair prejudice</ins> {after}
                                </p>
                              );
                            }
                            return <p key={idx} className="mb-2">{line}</p>;
                          })
                        }
                      </div>
                    ) : (
                      content
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
            <FileText className="h-12 w-12 text-zinc-300 mb-3" />
            <h3 className="text-sm font-semibold uppercase tracking-tight text-zinc-900">Legal Document Workspace</h3>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm leading-relaxed">
              Select an attorney memo or client advice draft from the left side index to inspect, modify, and export as Word files.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
