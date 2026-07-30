import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileText,
  Grid2X2,
  List,
  Plus,
  Send,
  X,
} from "lucide-react";
import { CollaborationRequest, Draft } from "../types";
import RichDocumentEditor from "./RichDocumentEditor";
import WorkProductDocument from "./WorkProductDocument";

interface SharedMatterListItem {
  id: string;
  matter_name: string;
  firm_name: string | null;
  active_request_count: number;
  shared_document_count: number;
  last_shared_activity_at: string | null;
}

interface SharedMatterSummary {
  access: {
    id: string;
    client_name: string;
    matter_name: string;
    firm_name: string | null;
  };
  shared: Draft[];
  revisions: Draft[];
  requests: CollaborationRequest[];
}

interface ResponseState {
  type: "Acknowledgement" | "Comment" | "Upload files" | "Shared files";
  text: string;
  files: File[];
  draftIds: string[];
  sending: boolean;
  error: string;
}

const initialResponseState: ResponseState = {
  type: "Acknowledgement",
  text: "",
  files: [],
  draftIds: [],
  sending: false,
  error: "",
};

export default function ClientSharedMattersView({
  accessId,
  onOpenMatter,
  onBack,
}: {
  accessId?: string;
  onOpenMatter: (id: string) => void;
  onBack: () => void;
}) {
  if (accessId) return <SharedMatterDetail accessId={accessId} onBack={onBack} />;
  return <SharedMattersList onOpenMatter={onOpenMatter} />;
}

function SharedMattersList({ onOpenMatter }: { onOpenMatter: (id: string) => void }) {
  const [matters, setMatters] = useState<SharedMatterListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [layout, setLayout] = useState<"card" | "list">("card");
  const [adding, setAdding] = useState(false);
  const [token, setToken] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [success, setSuccess] = useState("");

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    if (!quiet) setError("");
    try {
      const response = await fetch("/api/client/shared-matters");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Shared Matters could not be loaded.");
      setMatters(data as SharedMatterListItem[]);
    } catch (caught) {
      if (!quiet) {
        setError(
          caught instanceof Error ? caught.message : "Shared Matters could not be loaded."
        );
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const claim = async (event: React.FormEvent) => {
    event.preventDefault();
    const submittedToken = token.trim();
    if (!submittedToken || claiming) return;
    setClaiming(true);
    setClaimError("");
    try {
      const response = await fetch("/api/client/shared-matters/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: submittedToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The Shared Matter could not be added.");
      setMatters((current) =>
        current.some((matter) => matter.id === String(data.id))
          ? current
          : [
              {
                id: String(data.id),
                matter_name: String(data.matterName),
                firm_name: data.firmName ? String(data.firmName) : null,
                active_request_count: 0,
                shared_document_count: 0,
                last_shared_activity_at: new Date().toISOString(),
              },
              ...current,
            ]
      );
      setAdding(false);
      setToken("");
      setSuccess(`${String(data.matterName)} was added to Shared Matters.`);
      void load(true);
    } catch (caught) {
      setClaimError(
        caught instanceof Error ? caught.message : "The Shared Matter could not be added."
      );
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="h-full flex-1 overflow-y-auto bg-white">
      <header className="border-b border-zinc-200 bg-zinc-50/50 px-6 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Shared Matters</h1>
            <p className="mt-1 text-xs text-zinc-500">
              Matters your lawyer has actively shared with you.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded border border-zinc-300 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setLayout("card")}
                aria-label="Card view"
                className={`rounded p-2 ${layout === "card" ? "bg-zinc-100" : "text-zinc-400"}`}
              >
                <Grid2X2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setLayout("list")}
                aria-label="List view"
                className={`rounded p-2 ${layout === "list" ? "bg-zinc-100" : "text-zinc-400"}`}
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setClaimError("");
                setSuccess("");
              }}
              className="flex items-center gap-2 rounded bg-zinc-950 px-4 py-2.5 text-[10px] font-mono font-semibold uppercase text-white hover:bg-zinc-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add Shared Matter
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8 sm:px-8">
        {success && (
          <div role="status" className="mb-5 rounded border border-zinc-300 bg-zinc-50 px-4 py-3 text-xs">
            {success}
          </div>
        )}
        {loading ? (
          <p className="py-16 text-center text-xs font-mono uppercase text-zinc-400">
            Loading Shared Matters…
          </p>
        ) : error ? (
          <div role="alert" className="rounded border border-zinc-300 bg-zinc-50 p-4 text-sm">
            <p>{error}</p>
            <button type="button" onClick={() => void load()} className="mt-3 text-xs underline">
              Try again
            </button>
          </div>
        ) : matters.length === 0 ? (
          <div className="rounded border border-dashed border-zinc-300 px-6 py-16 text-center">
            <FileText className="mx-auto h-8 w-8 text-zinc-300" />
            <h2 className="mt-4 text-sm font-semibold">No Shared Matters yet</h2>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-zinc-500">
              Add a secure collaboration token provided by your lawyer.
            </p>
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setSuccess("");
              }}
              className="mt-5 rounded border border-zinc-300 px-4 py-2 text-xs font-semibold hover:border-zinc-950"
            >
              Add Shared Matter
            </button>
          </div>
        ) : (
          <div className={layout === "card" ? "grid gap-4 md:grid-cols-2 xl:grid-cols-3" : "space-y-3"}>
            {matters.map((matter) => (
              <button
                type="button"
                key={matter.id}
                onClick={() => onOpenMatter(matter.id)}
                className={`rounded border border-zinc-200 text-left hover:border-zinc-500 hover:bg-zinc-50 ${
                  layout === "card" ? "min-h-48 p-5" : "w-full p-4"
                }`}
              >
                <div className={layout === "list" ? "flex flex-wrap items-center gap-5" : ""}>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold">{matter.matter_name}</h2>
                    <p className="mt-1 truncate text-xs text-zinc-500">
                      {matter.firm_name || "Shared by your lawyer"}
                    </p>
                  </div>
                  <div className={layout === "card" ? "mt-8 grid grid-cols-2 gap-3" : "flex gap-5"}>
                    <div>
                      <p className="text-lg font-semibold">{matter.shared_document_count}</p>
                      <p className="text-[9px] font-mono uppercase text-zinc-400">Documents</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{matter.active_request_count}</p>
                      <p className="text-[9px] font-mono uppercase text-zinc-400">Open requests</p>
                    </div>
                  </div>
                  <p className={`${layout === "card" ? "mt-6" : "ml-auto"} text-[9px] font-mono uppercase text-zinc-400`}>
                    {matter.last_shared_activity_at
                      ? `Updated ${new Date(matter.last_shared_activity_at).toLocaleString()}`
                      : "Active"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <form onSubmit={claim} className="w-full max-w-md rounded border border-zinc-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">Add Shared Matter</h2>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Enter the collaboration token your lawyer provided.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdding(false)}
                aria-label="Close"
                className="rounded p-1 hover:bg-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoFocus
              placeholder="Collaboration token"
              aria-label="Lawyer-provided collaboration token"
              className="mt-5 w-full rounded border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-zinc-950"
            />
            {claimError && <p role="alert" className="mt-3 text-xs text-red-700">{claimError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded border border-zinc-300 px-4 py-2 text-xs hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!token.trim() || claiming}
                className="rounded bg-zinc-950 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {claiming ? "Adding…" : "Add Matter"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function SharedMatterDetail({ accessId, onBack }: { accessId: string; onBack: () => void }) {
  const [summary, setSummary] = useState<SharedMatterSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"Shared Documents" | "Requests">("Shared Documents");
  const [openDraft, setOpenDraft] = useState<Draft | null>(null);
  const [opening, setOpening] = useState(false);
  const [editingDraft, setEditingDraft] = useState<Draft | null>(null);
  const [editContent, setEditContent] = useState("");
  const [preparingRevisionId, setPreparingRevisionId] = useState<string | null>(null);
  const [savingRevision, setSavingRevision] = useState(false);
  const [revisionError, setRevisionError] = useState("");
  const [revisionSuccess, setRevisionSuccess] = useState("");
  const [responseStates, setResponseStates] = useState<Record<string, ResponseState>>({});

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/client/shared-matters/${encodeURIComponent(accessId)}`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Shared Matter could not be loaded.");
      setSummary(data as SharedMatterSummary);
    } catch (caught) {
      setSummary(null);
      setError(
        caught instanceof Error ? caught.message : "Shared Matter could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessId]);

  const permittedDrafts = useMemo(() => {
    if (!summary) return [];
    const drafts = [...summary.shared, ...summary.revisions];
    for (const request of summary.requests) drafts.push(...request.documents);
    const unique = new Map<string, Draft>();
    for (const draft of drafts) {
      const existing = unique.get(draft.id);
      unique.set(draft.id, existing ? { ...draft, ...existing } : draft);
    }
    return Array.from(unique.values()).sort(
      (left, right) =>
        new Date(right.updated_at || right.created_at).getTime() -
        new Date(left.updated_at || left.created_at).getTime()
    );
  }, [summary]);

  const open = async (draftId: string) => {
    setOpening(true);
    setError("");
    try {
      const response = await fetch(
        `/api/client/shared-matters/${encodeURIComponent(accessId)}/work-products/${encodeURIComponent(draftId)}`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Shared document could not be opened.");
      setOpenDraft(data as Draft);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Shared document could not be opened."
      );
    } finally {
      setOpening(false);
    }
  };

  const beginEditCopy = async (draft: Draft) => {
    if (draft.revision_type === "Client Revision" || preparingRevisionId) return;
    setPreparingRevisionId(draft.id);
    setRevisionError("");
    setRevisionSuccess("");
    try {
      const response = await fetch(
        `/api/client/shared-matters/${encodeURIComponent(accessId)}/work-products/${encodeURIComponent(draft.id)}`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Shared document could not be opened.");
      const currentDraft = data as Draft;
      setEditingDraft(currentDraft);
      setEditContent(currentDraft.content);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Shared document could not be opened."
      );
    } finally {
      setPreparingRevisionId(null);
    }
  };

  const cancelRevision = () => {
    if (savingRevision) return;
    setEditingDraft(null);
    setEditContent("");
    setRevisionError("");
  };

  const saveRevision = async () => {
    if (!editingDraft || savingRevision) return;
    setSavingRevision(true);
    setRevisionError("");
    try {
      const response = await fetch(
        `/api/client/shared-matters/${encodeURIComponent(accessId)}/work-products/${encodeURIComponent(editingDraft.id)}/edit-copy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: editContent }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Client Revision could not be saved.");
      const revision = data as Draft;
      setSummary((current) =>
        current
          ? {
              ...current,
              revisions: [
                revision,
                ...current.revisions.filter((draft) => draft.id !== revision.id),
              ],
            }
          : current
      );
      setEditingDraft(null);
      setEditContent("");
      setRevisionSuccess("Client Revision saved. The lawyer’s original remains unchanged.");
    } catch (caught) {
      setRevisionError(
        caught instanceof Error ? caught.message : "Client Revision could not be saved."
      );
    } finally {
      setSavingRevision(false);
    }
  };

  const stateFor = (requestId: string) =>
    responseStates[requestId] || initialResponseState;

  const updateState = (requestId: string, patch: Partial<ResponseState>) => {
    setResponseStates((current) => ({
      ...current,
      [requestId]: { ...stateFor(requestId), ...patch },
    }));
  };

  const respond = async (requestId: string) => {
    const state = stateFor(requestId);
    updateState(requestId, { sending: true, error: "" });
    const form = new FormData();
    form.set("type", state.type);
    form.set("content", state.text);
    form.set("draftIds", JSON.stringify(state.draftIds));
    state.files.forEach((file) => form.append("files", file));
    try {
      const response = await fetch(
        `/api/client/shared-matters/${encodeURIComponent(accessId)}/requests/${encodeURIComponent(requestId)}/responses`,
        { method: "POST", body: form }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Response could not be sent.");
      setResponseStates((current) => {
        const next = { ...current };
        delete next[requestId];
        return next;
      });
      await load();
    } catch (caught) {
      updateState(requestId, {
        sending: false,
        error: caught instanceof Error ? caught.message : "Response could not be sent.",
      });
    }
  };

  if (loading) {
    return (
      <p className="py-20 text-center text-xs font-mono uppercase text-zinc-400">
        Loading Shared Matter…
      </p>
    );
  }

  if (!summary) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <h1 className="text-lg font-semibold">Shared Matter unavailable</h1>
        <p role="alert" className="mt-2 text-sm text-zinc-500">
          {error || "This Matter is no longer shared with your account."}
        </p>
        <button type="button" onClick={onBack} className="mt-5 text-xs underline">
          Return to Shared Matters
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex-1 overflow-y-auto bg-white">
      <header className="border-b border-zinc-200 bg-zinc-50/50 px-6 py-5 sm:px-8">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-[10px] font-mono font-semibold uppercase text-zinc-500 hover:text-zinc-950"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Shared Matters
        </button>
        <h1 className="mt-4 text-xl font-semibold">{summary.access.matter_name}</h1>
        <p className="mt-1 text-xs text-zinc-500">
          {summary.access.firm_name || "Shared by your lawyer"}
        </p>
        <div className="mt-5 flex gap-5">
          {(["Shared Documents", "Requests"] as const).map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => setTab(item)}
              className={`border-b-2 pb-2 text-xs font-semibold ${
                tab === item
                  ? "border-zinc-950 text-zinc-950"
                  : "border-transparent text-zinc-400 hover:text-zinc-700"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
        {error && (
          <div role="alert" className="mb-5 rounded border border-zinc-300 bg-zinc-50 p-3 text-xs">
            {error}
          </div>
        )}
        {revisionSuccess && (
          <div role="status" className="mb-5 rounded border border-zinc-300 bg-zinc-50 p-3 text-xs">
            {revisionSuccess}
          </div>
        )}
        {tab === "Shared Documents" ? (
          permittedDrafts.length === 0 ? (
            <div className="rounded border border-dashed border-zinc-300 px-6 py-14 text-center">
              <FileText className="mx-auto h-7 w-7 text-zinc-300" />
              <p className="mt-3 text-sm font-semibold">No documents are shared yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {permittedDrafts.map((draft) => (
                <article
                  key={draft.id}
                  className="flex flex-wrap items-center gap-4 rounded border border-zinc-200 p-4"
                >
                  <FileText className="h-5 w-5 text-zinc-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-medium">{draft.title}</h2>
                      {draft.revision_type === "Client Revision" && (
                        <span className="rounded bg-zinc-100 px-2 py-0.5 text-[9px] font-mono uppercase text-zinc-500">
                          Client Revision
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[9px] font-mono uppercase text-zinc-400">
                      Shared {new Date(draft.updated_at || draft.created_at).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void open(draft.id)}
                    disabled={opening}
                    className="rounded border border-zinc-300 px-3 py-2 text-[10px] font-mono font-semibold uppercase hover:border-zinc-950 disabled:opacity-40"
                  >
                    Open
                  </button>
                  <a
                    href={`/api/client/shared-matters/${encodeURIComponent(accessId)}/work-products/${encodeURIComponent(draft.id)}/download`}
                    className="flex items-center gap-1 rounded border border-zinc-300 px-3 py-2 text-[10px] font-mono font-semibold uppercase hover:border-zinc-950"
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                  {draft.revision_type !== "Client Revision" && (
                    <button
                      type="button"
                      onClick={() => void beginEditCopy(draft)}
                      disabled={preparingRevisionId !== null}
                      className="rounded border border-zinc-300 px-3 py-2 text-[10px] font-mono font-semibold uppercase hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {preparingRevisionId === draft.id ? "Opening…" : "Edit a Copy"}
                    </button>
                  )}
                </article>
              ))}
            </div>
          )
        ) : summary.requests.length === 0 ? (
          <div className="rounded border border-dashed border-zinc-300 px-6 py-14 text-center">
            <p className="text-sm font-semibold">No requests from your lawyer</p>
          </div>
        ) : (
          <div className="space-y-4">
            {summary.requests.map((request) => {
              const state = stateFor(request.id);
              return (
                <article key={request.id} className="rounded border border-zinc-200 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">{request.request_type}</h2>
                      <p className="mt-1 text-[9px] font-mono uppercase text-zinc-400">
                        {new Date(request.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span className="rounded bg-zinc-100 px-2 py-1 text-[9px] font-mono uppercase">
                      {request.status}
                    </span>
                  </div>
                  {request.instruction && (
                    <p className="mt-3 text-sm leading-6 text-zinc-600">{request.instruction}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {request.documents.map((draft) => (
                      <button
                        type="button"
                        key={draft.id}
                        onClick={() => void open(draft.id)}
                        className="rounded bg-zinc-100 px-2.5 py-1.5 text-xs hover:bg-zinc-200"
                      >
                        {draft.title}
                      </button>
                    ))}
                  </div>
                  {request.responses.length > 0 && (
                    <div className="mt-4 space-y-2 border-t border-zinc-100 pt-4">
                      <p className="text-[9px] font-mono font-semibold uppercase text-zinc-400">
                        Your responses
                      </p>
                      {request.responses.map((response) => (
                        <div key={response.id} className="rounded bg-zinc-50 px-3 py-2 text-xs">
                          <span className="font-mono text-[9px] uppercase text-zinc-400">
                            {response.response_type}
                          </span>
                          {response.content && <p className="mt-1">{response.content}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 border-t border-zinc-100 pt-4">
                    <label className="block text-[9px] font-mono font-semibold uppercase text-zinc-400">
                      Respond
                      <select
                        value={state.type}
                        onChange={(event) =>
                          updateState(request.id, {
                            type: event.target.value as ResponseState["type"],
                            text: "",
                            files: [],
                            draftIds: [],
                            error: "",
                          })
                        }
                        className="mt-2 block w-full rounded border border-zinc-300 bg-white px-3 py-2 text-xs normal-case text-zinc-900"
                      >
                        <option>Acknowledgement</option>
                        <option>Comment</option>
                        <option>Upload files</option>
                        <option>Shared files</option>
                      </select>
                    </label>
                    {state.type === "Comment" && (
                      <textarea
                        value={state.text}
                        onChange={(event) => updateState(request.id, { text: event.target.value })}
                        placeholder="Your response"
                        className="mt-2 h-20 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                      />
                    )}
                    {state.type === "Upload files" && (
                      <input
                        type="file"
                        multiple
                        accept=".pdf,.docx,.txt"
                        onChange={(event) =>
                          updateState(request.id, {
                            files: Array.from(event.target.files || []),
                          })
                        }
                        className="mt-2 block w-full text-xs"
                      />
                    )}
                    {state.type === "Shared files" && (
                      <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded border border-zinc-200 p-2">
                        {permittedDrafts.map((draft) => (
                          <label key={draft.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-50">
                            <input
                              type="checkbox"
                              checked={state.draftIds.includes(draft.id)}
                              onChange={(event) =>
                                updateState(request.id, {
                                  draftIds: event.target.checked
                                    ? Array.from(new Set([...state.draftIds, draft.id]))
                                    : state.draftIds.filter((id) => id !== draft.id),
                                })
                              }
                            />
                            {draft.title}
                          </label>
                        ))}
                      </div>
                    )}
                    {state.error && <p role="alert" className="mt-2 text-xs text-red-700">{state.error}</p>}
                    <button
                      type="button"
                      onClick={() => void respond(request.id)}
                      disabled={
                        state.sending ||
                        (state.type === "Comment" && !state.text.trim()) ||
                        (state.type === "Upload files" && state.files.length === 0) ||
                        (state.type === "Shared files" && state.draftIds.length === 0)
                      }
                      className="mt-3 flex items-center gap-2 rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-semibold uppercase text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Send className="h-3.5 w-3.5" />
                      {state.sending ? "Sending…" : "Submit Response"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {openDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded border border-zinc-200 bg-white shadow-xl">
            <header className="flex items-start justify-between gap-4 border-b border-zinc-100 px-6 py-4">
              <div>
                <h2 className="font-semibold">{openDraft.title}</h2>
                <p className="mt-1 text-[9px] font-mono uppercase text-zinc-400">
                  Read-only shared document
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenDraft(null)}
                aria-label="Close document"
                className="rounded p-1 hover:bg-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto bg-white px-6 py-5">
              <WorkProductDocument content={openDraft.content} />
            </div>
          </div>
        </div>
      )}

      {editingDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded border border-zinc-200 bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold">Edit a Copy</h2>
            <p className="mt-1 text-xs text-zinc-500">
              The lawyer’s original will remain unchanged.
            </p>
            <div className="mt-4">
              <RichDocumentEditor
                value={editContent}
                onChange={setEditContent}
                minHeight={430}
              />
            </div>
            {revisionError && (
              <p role="alert" className="mt-3 rounded bg-zinc-50 p-3 text-xs text-red-700">
                {revisionError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelRevision}
                disabled={savingRevision}
                className="rounded border border-zinc-300 px-4 py-2 text-[10px] font-mono font-semibold uppercase hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveRevision()}
                disabled={savingRevision}
                className="rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-semibold uppercase text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {savingRevision ? "Saving…" : "Save Client Revision"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
