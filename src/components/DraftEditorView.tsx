import React, { useEffect, useState } from "react";
import { Check, Copy, Download, Edit, Eye, FileText, FileWarning, RefreshCw, Save } from "lucide-react";
import { Draft, WorkspacePageContext } from "../types";
import RichDocumentEditor from "./RichDocumentEditor";
import WorkProductDocument from "./WorkProductDocument";

interface DraftEditorViewProps {
  initialDraftId: string | null;
  onClearInitialDraftId: () => void;
  caseId: string | null;
  onSelectedItemChange?: (item: WorkspacePageContext["selectedItem"]) => void;
}

export default function DraftEditorView({ initialDraftId, onClearInitialDraftId, caseId, onSelectedItemChange }: DraftEditorViewProps) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [editMode, setEditMode] = useState(true);
  const [sharingBusy, setSharingBusy] = useState<"sharing" | "stopping" | null>(null);

  useEffect(() => {
    onSelectedItemChange?.(activeDraft ? { kind: "workProduct", id: activeDraft.id, title: activeDraft.title } : undefined);
  }, [activeDraft, onSelectedItemChange]);

  useEffect(() => {
    setActiveDraft(null);
    setTitle("");
    setContent("");
    void fetchDrafts();
  }, [caseId]);

  useEffect(() => {
    if (initialDraftId) {
      void loadSpecificDraft(initialDraftId);
      onClearInitialDraftId();
    } else if (drafts.length > 0 && !activeDraft) {
      selectDraft(drafts[0]);
    }
  }, [initialDraftId, drafts]);

  const fetchDrafts = async () => {
    if (!caseId) return setDrafts([]);
    const response = await fetch(`/api/cases/${caseId}/work-product`);
    if (response.ok) setDrafts(await response.json());
  };

  const loadSpecificDraft = async (id: string) => {
    if (!caseId) return;
    const response = await fetch(`/api/drafts/${id}?caseId=${caseId}`);
    const data = await response.json();
    if (data.id) selectDraft(data);
  };

  const selectDraft = (draft: Draft) => {
    setActiveDraft(draft);
    setTitle(draft.title);
    setContent(draft.content);
    setSaveStatus("idle");
  };

  const handleSave = async () => {
    if (!activeDraft || !caseId) return;
    setSaving(true);
    setSaveStatus("saving");
    try {
      const response = await fetch(`/api/drafts/${activeDraft.id}?caseId=${caseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await response.json();
      if (data.id) {
        setSaveStatus("saved");
        setActiveDraft(data);
        setContent(data.content);
        setDrafts((current) => current.map((draft) => draft.id === data.id ? data : draft));
        window.setTimeout(() => setSaveStatus("idle"), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCreateWorkProduct = async () => {
    if (!caseId) return;
    const newTitle = prompt("Work Product title");
    if (!newTitle?.trim()) return;
    const response = await fetch(`/api/cases/${caseId}/work-product`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim(), content: "" }),
    });
    const data = await response.json();
    if (!response.ok) return alert(data.error || "Work Product could not be created");
    setDrafts((current) => [data, ...current]);
    selectDraft(data);
  };

  const handleDuplicate = async () => {
    if (!caseId || !activeDraft) return;
    const response = await fetch(`/api/drafts/${activeDraft.id}/duplicate?caseId=${caseId}`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) return alert(data.error || "Work Product could not be duplicated");
    setDrafts((current) => [data, ...current]);
    selectDraft(data);
  };

  const handleSharing = async () => {
    if (!caseId || !activeDraft || sharingBusy) return;
    const nextShared = !activeDraft.shared_with_client;
    setSharingBusy(nextShared ? "sharing" : "stopping");
    try {
      const response = await fetch(`/api/drafts/${activeDraft.id}/sharing?caseId=${caseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shared: nextShared }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sharing could not be updated");
      setActiveDraft(data);
      setContent(data.content);
      setDrafts((current) => current.map((draft) => draft.id === data.id ? data : draft));
    } catch (error) {
      alert(error instanceof Error ? error.message : "Sharing could not be updated");
    } finally {
      setSharingBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-1 overflow-hidden bg-white text-zinc-900" id="draft-editor-view">
      <div className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-100 bg-zinc-50">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 p-5">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">Work Product</span>
          <button onClick={() => void handleCreateWorkProduct()} className="rounded bg-zinc-900 px-2 py-1 text-[9px] font-mono font-bold uppercase text-white">New</button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4" id="drafts-sidebar-list">
          {drafts.length === 0 ? (
            <div className="p-6 text-center text-xs text-zinc-400">
              <FileWarning className="mx-auto mb-2 h-6 w-6 text-zinc-300" />
              No Work Product yet. Create one here or generate one from a Matter conversation.
            </div>
          ) : drafts.map((draft) => (
            <button
              key={draft.id}
              id={`draft-select-btn-${draft.id}`}
              onClick={() => selectDraft(draft)}
              className={`flex w-full items-start gap-2.5 rounded-lg border p-3.5 text-left text-xs transition-all ${
                activeDraft?.id === draft.id
                  ? "border-zinc-900 bg-white font-semibold text-zinc-950 shadow-sm"
                  : "border-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold uppercase tracking-tight">{draft.title}</p>
                <p className="mt-0.5 text-[9px] font-mono text-zinc-400">
                  {new Date(draft.updated_at || draft.created_at).toLocaleDateString()} · {draft.shared_with_client ? "Shared" : "Private"}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex h-full flex-1 flex-col overflow-hidden" id="editor-canvas-column">
        {activeDraft ? (
          <>
            <div className="z-10 shrink-0 border-b border-zinc-100 bg-white px-8 py-4">
              <div className="min-w-0">
                <h2 className="whitespace-normal break-words text-sm font-bold uppercase tracking-tight text-zinc-900">{title}</h2>
                <p className="mt-0.5 text-[10px] font-mono uppercase text-zinc-400">
                  Updated {new Date(activeDraft.updated_at || activeDraft.created_at).toLocaleString()} · {activeDraft.origin || "Work Product"} · {activeDraft.shared_with_client ? "Shared with client" : "Private"}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button onClick={() => void handleDuplicate()} className="inline-flex items-center gap-1 rounded border border-zinc-300 px-3 py-1.5 text-[10px] font-mono font-bold uppercase"><Copy className="h-3.5 w-3.5" />Duplicate</button>
                <button onClick={() => void handleSharing()} disabled={Boolean(sharingBusy)} className="rounded border border-zinc-300 px-3 py-1.5 text-[10px] font-mono font-bold uppercase hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">{sharingBusy === "sharing" ? "Sharing..." : sharingBusy === "stopping" ? "Stopping..." : activeDraft.shared_with_client ? "Stop sharing" : "Share with client"}</button>
                <div className="flex rounded border border-zinc-200 bg-zinc-100 p-0.5 text-[10px] font-mono font-semibold uppercase">
                  <button onClick={() => setEditMode(true)} id="mode-edit-btn" className={`flex items-center gap-1 rounded px-3 py-1 ${editMode ? "bg-white font-bold text-zinc-900 shadow-sm" : "text-zinc-500"}`}><Edit className="h-3 w-3" />Editor</button>
                  <button onClick={() => setEditMode(false)} id="mode-preview-btn" className={`flex items-center gap-1 rounded px-3 py-1 ${!editMode ? "bg-white font-bold text-zinc-900 shadow-sm" : "text-zinc-500"}`}><Eye className="h-3 w-3" />Preview</button>
                </div>
                <button onClick={() => void handleSave()} disabled={saving} id="editor-save-btn" className="inline-flex items-center gap-1.5 rounded border border-zinc-300 bg-white px-3 py-1.5 text-[10px] font-mono font-bold uppercase hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
                  {saveStatus === "saving" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : saveStatus === "saved" ? <Check className="h-3.5 w-3.5 text-green-700" /> : <Save className="h-3.5 w-3.5" />}
                  {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save"}
                </button>
                <button onClick={() => caseId && window.open(`/api/drafts/${activeDraft.id}/export?caseId=${caseId}`, "_blank")} id="editor-export-btn" className="inline-flex items-center gap-1.5 rounded bg-zinc-950 px-3.5 py-1.5 text-[10px] font-mono font-bold uppercase text-white hover:bg-zinc-900"><Download className="h-3.5 w-3.5" />Export .docx</button>
              </div>
            </div>

            <div className="h-full min-h-0 flex-1 overflow-y-auto bg-white" id="work-product-document-scroll">
              <div id="paper-layout" className="mx-auto min-h-full w-full max-w-4xl bg-white px-8 py-10">
                {editMode ? <RichDocumentEditor value={content} onChange={setContent} minHeight={900} /> : <WorkProductDocument content={content} />}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
            <FileText className="mb-3 h-12 w-12 text-zinc-300" />
            <h3 className="text-sm font-semibold uppercase tracking-tight text-zinc-900">Matter Work Product</h3>
            <p className="mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">Select an attorney memo or client advice draft from the left side index to inspect, modify, and export as Word files.</p>
          </div>
        )}
      </div>
    </div>
  );
}
