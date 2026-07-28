import React, { useEffect, useState } from "react";
import { Archive, Check, Copy, Download, Edit, Eye, FileText, FileWarning, History, Plus, RefreshCw, Save } from "lucide-react";
import { Draft, ResourceVersion } from "../types";
import RichDocumentEditor from "./RichDocumentEditor";
import WorkProductDocument from "./WorkProductDocument";

interface DraftEditorViewProps {
  initialDraftId: string | null;
  onClearInitialDraftId: () => void;
  caseId: string | null;
  googleDriveExportEnabled?: boolean;
  resourceLifecycleEnabled?: boolean;
}

export default function DraftEditorView({ initialDraftId, onClearInitialDraftId, caseId, googleDriveExportEnabled = false, resourceLifecycleEnabled = false }: DraftEditorViewProps) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [editMode, setEditMode] = useState(true);
  const [sharingBusy, setSharingBusy] = useState<"sharing" | "stopping" | null>(null);
  const [versions, setVersions] = useState<ResourceVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const dirty = Boolean(activeDraft && (title !== activeDraft.title || content !== activeDraft.content));

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

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!resourceLifecycleEnabled || !dirty || !activeDraft || !caseId || saving) return;
    const timer = window.setTimeout(() => void saveWorkProduct(true), 2_000);
    return () => window.clearTimeout(timer);
  }, [resourceLifecycleEnabled, dirty, title, content, activeDraft?.id, caseId]);

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
    if (dirty && activeDraft?.id !== draft.id && !confirm("Discard unsaved changes and open another Work Product?")) return;
    setActiveDraft(draft);
    setTitle(draft.title);
    setContent(draft.content);
    setSaveStatus("idle");
  };

  const saveWorkProduct = async (autosave: boolean) => {
    if (!activeDraft || !caseId) return;
    setSaving(true);
    if (!autosave) setSaveStatus("saving");
    try {
      const response = await fetch(`/api/drafts/${activeDraft.id}?caseId=${caseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, autosave }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Work Product could not be saved");
      setSaveStatus("saved");
      setActiveDraft(data);
      setTitle(data.title);
      setContent(data.content);
      setDrafts((current) => current.map((draft) => draft.id === data.id ? data : draft));
      window.setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (error) {
      if (!autosave) alert(error instanceof Error ? error.message : "Work Product could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    await saveWorkProduct(false);
  };

  const loadVersions = async () => {
    if (!activeDraft || !caseId) return;
    const response = await fetch(`/api/drafts/${activeDraft.id}/versions?caseId=${caseId}`);
    if (response.ok) setVersions(await response.json());
    setShowVersions(true);
  };

  const restoreVersion = async (version: ResourceVersion) => {
    if (!activeDraft || !caseId || !confirm(`Restore version ${version.version_number} as a new current version?`)) return;
    const response = await fetch(`/api/drafts/${activeDraft.id}/versions/${version.id}/restore?caseId=${caseId}`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) return alert(data.error || "Version could not be restored");
    selectDraft(data);
    await loadVersions();
  };

  const archiveActive = async () => {
    if (!activeDraft || !caseId || !confirm(`Archive "${activeDraft.title}"?`)) return;
    const response = await fetch(`/api/drafts/${activeDraft.id}/archive?caseId=${caseId}`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) return alert(data.error || "Work Product could not be archived");
    setActiveDraft(null);
    await fetchDrafts();
  };

  const addAsSource = async () => {
    if (!activeDraft || !caseId || !confirm("Add the current Work Product as a new Matter Source?")) return;
    if (dirty) await saveWorkProduct(false);
    const response = await fetch(`/api/drafts/${activeDraft.id}/add-as-source?caseId=${caseId}`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) alert(data.error || "Matter Source could not be created");
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

  const exportToDrive = async () => {
    if (!caseId || !activeDraft) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/drafts/${activeDraft.id}/export/drive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Drive export failed.");
      if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Drive export failed.");
    } finally {
      setSaving(false);
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
                <p className="truncate font-bold uppercase tracking-tight">{draft.title.replace("Legal ", "")}</p>
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
                {resourceLifecycleEnabled && editMode
                  ? <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Work Product title" className="w-full border-b border-transparent text-sm font-bold uppercase tracking-tight text-zinc-900 outline-none focus:border-zinc-300" />
                  : <h2 className="whitespace-normal break-words text-sm font-bold uppercase tracking-tight text-zinc-900">{title}</h2>}
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
                {resourceLifecycleEnabled && <><button onClick={() => caseId && window.open(`/api/drafts/${activeDraft.id}/export/pdf?caseId=${caseId}`, "_blank")} className="inline-flex items-center gap-1.5 rounded border border-zinc-300 px-3.5 py-1.5 text-[10px] font-mono font-bold uppercase"><Download className="h-3.5 w-3.5" />PDF</button><button onClick={() => void loadVersions()} className="inline-flex items-center gap-1.5 rounded border border-zinc-300 px-3 py-1.5 text-[10px] font-mono font-bold uppercase"><History className="h-3.5 w-3.5" />History</button><button onClick={() => void addAsSource()} className="inline-flex items-center gap-1.5 rounded border border-zinc-300 px-3 py-1.5 text-[10px] font-mono font-bold uppercase"><Plus className="h-3.5 w-3.5" />Add as Source</button><button onClick={() => void archiveActive()} className="inline-flex items-center gap-1.5 rounded border border-zinc-300 px-3 py-1.5 text-[10px] font-mono font-bold uppercase"><Archive className="h-3.5 w-3.5" />Archive</button></>}
                {googleDriveExportEnabled && <button onClick={() => void exportToDrive()} disabled={saving} className="inline-flex items-center gap-1.5 rounded border border-zinc-300 px-3.5 py-1.5 text-[10px] font-mono font-bold uppercase hover:bg-zinc-50 disabled:opacity-50"><Download className="h-3.5 w-3.5" />Export to Drive</button>}
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
      {showVersions && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"><div className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded border bg-white p-5"><div className="flex items-center justify-between"><h3 className="text-sm font-bold uppercase">Immutable version history</h3><button onClick={() => setShowVersions(false)} className="text-xs uppercase">Close</button></div><div className="mt-4 space-y-2">{versions.map((version) => <div key={version.id} className="flex items-center justify-between rounded border p-3"><div><p className="text-xs font-semibold">Version {version.version_number} · {version.change_type} · {version.revision_lane}</p><p className="mt-1 text-[9px] font-mono uppercase text-zinc-500">{version.actor_name || "Legacy actor unavailable"} · {new Date(version.created_at).toLocaleString()}</p></div><button onClick={() => void restoreVersion(version)} className="rounded border px-3 py-1 text-[9px] font-mono uppercase">Restore as new version</button></div>)}</div></div></div>}
    </div>
  );
}
