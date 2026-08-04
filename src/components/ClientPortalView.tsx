import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, FileText, MessageSquare, Send, X } from "lucide-react";
import { CollaborationRequest, Draft } from "../types";
import FormattedMarkdown from "./FormattedMarkdown";
import RichDocumentEditor from "./RichDocumentEditor";
import SelectedFileList from "./SelectedFileList";
import WorkProductDocument from "./WorkProductDocument";
import { appendUniqueFiles, browserFileIdentity } from "../hooks/useCumulativeFileSelection";

type Tab = "Shared Documents" | "Requests" | "Assistant";
type ResponseState = { type: string; text: string; draftIds: string[]; files: File[]; sending: boolean; error: string; fileError: string };
interface PortalChatMessage { id: string; role: "user" | "assistant"; content: string; created_at: string; selected_sources?: Array<{ id: string; title: string }>; }
interface Summary {
  access: { client_name: string; matter_name: string };
  shared: Draft[];
  revisions: Draft[];
  requests: CollaborationRequest[];
  portalDocuments: Array<{ id: string; title: string; processing_state: string }>;
  chatMessages: PortalChatMessage[];
}

const responseOptions = ["Acknowledgement", "Comment", "Upload files", "Shared files"];
const emptyState: ResponseState = { type: "Acknowledgement", text: "", draftIds: [], files: [], sending: false, error: "", fileError: "" };

export default function ClientPortalView({ token }: { token: string }) {
  const base = `/api/portal/${encodeURIComponent(token)}`;
  const [data, setData] = useState<Summary | null>(null);
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState<Tab>("Shared Documents");
  const [open, setOpen] = useState<Draft | null>(null);
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [editContent, setEditContent] = useState("");
  const [savingRevision, setSavingRevision] = useState(false);
  const [responses, setResponses] = useState<Record<string, ResponseState>>({});
  const [assistantIds, setAssistantIds] = useState<string[]>([]);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);

  const load = async () => {
    const response = await fetch(base);
    if (!response.ok) { setDenied(true); return; }
    setData(await response.json());
  };
  useEffect(() => { void load(); }, [token]);

  const permittedDrafts = useMemo(() => {
    const map = new Map<string, Draft>();
    for (const draft of [...(data?.shared || []), ...(data?.revisions || [])]) map.set(draft.id, draft);
    for (const request of data?.requests || []) for (const draft of request.documents) map.set(draft.id, draft);
    return [...map.values()];
  }, [data]);

  const requestState = (requestId: string): ResponseState => responses[requestId] || emptyState;
  const setRequestState = (requestId: string, patch: Partial<ResponseState>) => setResponses((current) => ({ ...current, [requestId]: { ...requestState(requestId), ...patch } }));

  const addResponseFiles = (requestId: string, files: FileList | null) => {
    const state = requestState(requestId);
    const next = appendUniqueFiles(state.files, Array.from(files || []));
    setRequestState(requestId, { files: next.files, fileError: next.error, error: "" });
  };

  const removeResponseFile = (requestId: string, identity: string) => {
    const state = requestState(requestId);
    setRequestState(requestId, { files: state.files.filter((file) => browserFileIdentity(file) !== identity), fileError: "" });
  };

  const viewDraft = async (id: string) => {
    const response = await fetch(`${base}/work-product/${id}`);
    if (response.ok) setOpen(await response.json());
  };

  const addComment = async () => {
    if (!open || !comment.trim()) return;
    const response = await fetch(`${base}/work-product/${open.id}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: comment }),
    });
    if (response.ok) setComment("");
  };

  const saveCopy = async () => {
    if (!editing || savingRevision) return;
    setSavingRevision(true);
    try {
      const response = await fetch(`${base}/work-product/${editing.id}/edit-copy`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: editContent }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Revision could not be saved");
      setEditing(null);
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Revision could not be saved");
    } finally {
      setSavingRevision(false);
    }
  };

  const respond = async (requestId: string) => {
    const state = requestState(requestId);
    if (state.sending) return;
    if (state.type === "Comment" && !state.text.trim()) return setRequestState(requestId, { error: "Comment text is required." });
    if (state.type === "Upload files" && state.files.length === 0) return setRequestState(requestId, { error: "Choose at least one file." });
    if (state.type === "Shared files" && state.draftIds.length === 0) return setRequestState(requestId, { error: "Choose at least one shared file." });
    setRequestState(requestId, { sending: true, error: "" });
    try {
      const form = new FormData();
      form.append("type", state.type);
      form.append("content", state.text);
      form.append("draftIds", JSON.stringify(state.draftIds));
      state.files.forEach((file) => form.append("files", file));
      const response = await fetch(`${base}/requests/${requestId}/responses`, { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.json()).error || "Response could not be sent");
      setResponses((current) => {
        const next = { ...current };
        delete next[requestId];
        return next;
      });
      await load();
    } catch (error) {
      setRequestState(requestId, { sending: false, error: error instanceof Error ? error.message : "Response could not be sent" });
    }
  };

  const ask = async () => {
    if (assistantBusy || !question.trim() || assistantIds.length === 0) return;
    const localQuestion = question;
    setQuestion("");
    setAssistantBusy(true);
    const optimistic: PortalChatMessage = { id: `temp_${Date.now()}`, role: "user", content: localQuestion, created_at: new Date().toISOString() };
    setData((current) => current ? { ...current, chatMessages: [...(current.chatMessages || []), optimistic] } : current);
    try {
      const draftIds = assistantIds.filter((id) => permittedDrafts.some((draft) => draft.id === id));
      const documentIds = assistantIds.filter((id) => data?.portalDocuments.some((document) => document.id === id));
      const response = await fetch(`${base}/assistant`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: localQuestion, draftIds, documentIds }),
      });
      const next = await response.json();
      if (!response.ok) throw Error(next.error);
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Assistant request failed");
      await load();
    } finally {
      setAssistantBusy(false);
    }
  };

  if (denied) return <div className="flex min-h-screen items-center justify-center bg-white p-8 text-center"><div><h1 className="text-lg font-semibold uppercase">Client Portal unavailable</h1><p className="mt-2 text-sm text-zinc-500">This invitation is invalid or has been revoked. Contact your lawyer for a new link.</p></div></div>;
  if (!data) return <div className="flex min-h-screen items-center justify-center text-xs font-mono uppercase text-zinc-500">Loading Client Portal...</div>;

  const allSelectable = [...permittedDrafts.map((draft) => ({ id: draft.id, title: draft.title })), ...data.portalDocuments.map((document) => ({ id: document.id, title: document.title }))];

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <header className="px-6 py-5"><div className="mx-auto max-w-5xl"><p className="text-[10px] font-mono font-bold uppercase text-zinc-400">Secure Client Portal</p><h1 className="mt-1 text-lg font-semibold">{data.access.matter_name}</h1><p className="mt-1 text-xs text-zinc-500">Client: {data.access.client_name}</p></div></header>
      <nav className="mx-auto flex max-w-5xl gap-2 px-6">{(["Shared Documents", "Requests", "Assistant"] as Tab[]).map((item) => <button key={item} onClick={() => setTab(item)} className={`border-b-2 px-4 py-3 text-[10px] font-mono font-bold uppercase hover:text-zinc-950 ${tab === item ? "border-zinc-950" : "border-transparent text-zinc-400"}`}>{item}</button>)}</nav>
      <main className="mx-auto max-w-5xl p-6">
        {tab === "Shared Documents" && <section className="space-y-3"><h2 className="text-sm font-semibold uppercase">Shared Documents</h2>{data.shared.length === 0 ? <p className="rounded border border-dashed p-10 text-center text-xs text-zinc-500">No Work Product is currently shared.</p> : data.shared.map((draft) => <div key={draft.id} className="flex items-center gap-3 rounded border border-zinc-200 p-4"><FileText className="h-4 w-4" /><button onClick={() => void viewDraft(draft.id)} className="flex-1 text-left text-sm font-medium hover:underline">{draft.title}{draft.revision_type === "Client Revision" && <span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 text-[9px] font-mono uppercase">Client Revision</span>}</button><a href={`${base}/work-product/${draft.id}/download`} className="rounded border p-2 hover:bg-zinc-50" title="Download"><Download className="h-4 w-4" /></a><button onClick={() => { setEditing(draft); setEditContent(draft.content); }} className="rounded border px-3 py-2 text-[9px] font-mono font-bold uppercase hover:bg-zinc-50">Edit a Copy</button></div>)}</section>}
        {tab === "Requests" && <section className="space-y-4"><h2 className="text-sm font-semibold uppercase">Requests</h2>{data.requests.map((request) => {
          const state = requestState(request.id);
          const latest = request.responses[0];
          return <article key={request.id} className="rounded border border-zinc-200 p-5"><div className="flex justify-between"><div><strong className="text-sm">{request.request_type}</strong><p className="mt-1 text-[10px] font-mono uppercase text-zinc-400">Sent {new Date(request.created_at).toLocaleString()}</p></div><span className="text-[9px] font-mono uppercase">{request.status}</span></div><p className="mt-2 text-sm text-zinc-600">{request.instruction || "No additional instruction."}</p><div className="mt-3 flex flex-wrap gap-2">{request.documents.map((draft) => <button key={draft.id} onClick={() => void viewDraft(draft.id)} className="rounded bg-zinc-100 px-3 py-2 text-xs hover:bg-zinc-200">{draft.title}</button>)}</div>{latest && <div className="mt-4 rounded bg-zinc-50 p-3 text-xs"><strong>Most recent response: {latest.response_type}</strong><p>{latest.content || "Files attached"}</p>{latest.attachments?.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{latest.attachments.map((item: any) => <span key={item.id || item.draft_id || item.document_id} className="rounded border border-zinc-200 bg-white px-2 py-1 text-[10px]">{item.draft_title || item.document_title || "Attachment"}</span>)}</div>}</div>}<div className="mt-4 grid gap-2 md:grid-cols-[160px_1fr_auto]"><select value={state.type} onChange={(event) => setRequestState(request.id, { type: event.target.value, error: "" })} className="rounded border bg-white px-2 py-2 text-xs">{responseOptions.map((item) => <option key={item}>{item}</option>)}</select><input value={state.text} onChange={(event) => setRequestState(request.id, { text: event.target.value })} disabled={state.type !== "Comment"} className="rounded border px-3 py-2 text-xs disabled:bg-zinc-50" placeholder={state.type === "Comment" ? "Comment" : "No text required"} /><button onClick={() => void respond(request.id)} disabled={state.sending} className="flex items-center gap-1 rounded bg-zinc-950 px-4 py-2 text-[9px] font-mono font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-3.5 w-3.5" />{state.sending ? "Sending..." : "Send"}</button></div>{state.type === "Upload files" && <div className="mt-2 space-y-2"><label className="block rounded border px-3 py-2 text-xs hover:bg-zinc-50">Choose attachments <span className="ml-2 text-[10px] font-mono uppercase text-zinc-500">{state.files.length ? `${state.files.length} files selected` : "No files selected"}</span><input type="file" className="sr-only" multiple accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => { addResponseFiles(request.id, event.target.files); event.currentTarget.value = ""; }} /></label>{state.fileError && <p className="text-xs text-red-700">{state.fileError}</p>}<SelectedFileList files={state.files} onRemove={(identity) => removeResponseFile(request.id, identity)} /></div>}{state.type === "Shared files" && <div className="mt-2 max-h-36 overflow-y-auto rounded border p-2">{permittedDrafts.map((draft) => <label key={draft.id} className="flex gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-50"><input type="checkbox" checked={state.draftIds.includes(draft.id)} onChange={(event) => setRequestState(request.id, { draftIds: event.target.checked ? Array.from(new Set([...state.draftIds, draft.id])) : state.draftIds.filter((id) => id !== draft.id) })} />{draft.title}</label>)}</div>}{state.error && <p className="mt-2 text-xs text-red-700">{state.error}</p>}</article>;
        })}</section>}
        {tab === "Assistant" && <section className="space-y-4"><div><h2 className="text-sm font-semibold uppercase">Client Assistant</h2><p className="mt-1 text-xs text-zinc-500">Ask questions about the selected shared documents.</p></div><div className="relative inline-block w-72"><button onClick={() => setSelectorOpen(!selectorOpen)} className="flex w-full items-center justify-between rounded border px-3 py-2 text-xs hover:bg-zinc-50"><span>{assistantIds.length ? `${assistantIds.length} selected` : "Select documents"}</span><ChevronDown className="h-4 w-4" /></button>{selectorOpen && <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded border bg-white p-2 shadow-lg">{allSelectable.map((item) => <label key={item.id} className="flex gap-2 rounded px-2 py-2 text-xs hover:bg-zinc-50"><input type="checkbox" checked={assistantIds.includes(item.id)} onChange={(event) => setAssistantIds((current) => event.target.checked ? Array.from(new Set([...current, item.id])) : current.filter((id) => id !== item.id))} />{item.title}</label>)}</div>}</div>{assistantIds.length > 0 && <div className="flex flex-wrap gap-2">{assistantIds.map((id) => <span key={id} className="rounded-full border px-2 py-1 text-[10px] font-mono">{allSelectable.find((item) => item.id === id)?.title || id}</span>)}</div>}<div className="h-[420px] overflow-y-auto rounded border border-zinc-200 p-4">{(data.chatMessages || []).length === 0 ? <p className="text-center text-xs text-zinc-400">No Client Assistant messages yet.</p> : data.chatMessages.map((message) => <div key={message.id} className={`mb-4 ${message.role === "user" ? "ml-auto max-w-[75%] rounded bg-zinc-100 p-3 text-sm" : "max-w-[85%] text-sm"}`}>{message.role === "assistant" ? <FormattedMarkdown content={message.content} /> : message.content}</div>)}</div><div className="flex gap-2"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} className="h-20 flex-1 rounded border px-3 py-2 text-sm" placeholder="Ask about the selected documents" /><button onClick={() => void ask()} disabled={assistantBusy || !question.trim() || assistantIds.length === 0} className="self-end rounded bg-zinc-950 px-5 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-40">{assistantBusy ? "Sending..." : "Send"}</button></div></section>}
      </main>

      {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"><div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded border bg-white"><div className="shrink-0 bg-white p-6 pb-3"><button onClick={() => setOpen(null)} className="float-right rounded p-1 hover:bg-zinc-100"><X className="h-4 w-4" /></button><h3 className="font-semibold">{open.title}</h3></div><div className="min-h-0 flex-1 overflow-y-auto bg-white px-6 py-3"><WorkProductDocument title={open.title} content={open.content} /></div><div className="shrink-0 bg-white p-6 pt-3"><div className="flex gap-2"><input value={comment} onChange={(event) => setComment(event.target.value)} className="flex-1 rounded border px-3 py-2 text-xs" placeholder="Add a comment" /><button onClick={() => void addComment()} className="flex items-center gap-1 rounded border px-4 py-2 text-[9px] font-mono font-bold uppercase hover:bg-zinc-50"><MessageSquare className="h-3.5 w-3.5" />Comment</button></div></div></div></div>}
      {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded border bg-white p-6"><h3 className="font-semibold">Edit a Copy</h3><p className="mt-1 text-xs text-zinc-500">The lawyer's original will remain unchanged.</p><div className="mt-4"><RichDocumentEditor value={editContent} onChange={setEditContent} minHeight={430} /></div><div className="mt-3 flex justify-end gap-2"><button onClick={() => setEditing(null)} className="rounded border px-4 py-2 text-[9px] uppercase hover:bg-zinc-50">Cancel</button><button onClick={() => void saveCopy()} disabled={savingRevision} className="rounded bg-zinc-950 px-4 py-2 text-[9px] font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-50">{savingRevision ? "Saving..." : "Save Client Revision"}</button></div></div></div>}
    </div>
  );
}
