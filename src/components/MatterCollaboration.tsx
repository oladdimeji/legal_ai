import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, Clipboard, FileText, KeyRound, Send, UserPlus, XCircle } from "lucide-react";
import { Case, ClientAccess, CollaborationRequest, Draft } from "../types";

interface SharedDraft extends Draft { client_comments?: Array<{ id: string; content: string; created_at: string }>; }
interface Data { matter: Case; access: ClientAccess | null; shared: SharedDraft[]; requests: CollaborationRequest[]; unread: number; }
const requestTypes = ["Review", "Comment", "Confirm information", "Upload a document", "Edit and return a copy", "Provide a written response"];

export default function MatterCollaboration({
  matter,
  onUnreadChange,
  onOpenWorkProduct,
}: {
  matter: Case;
  onUnreadChange: (count: number) => void;
  onOpenWorkProduct: (draftId: string) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [name, setName] = useState(matter.client_name || "");
  const [email, setEmail] = useState(matter.client_email || "");
  const [type, setType] = useState(requestTypes[0]);
  const [instruction, setInstruction] = useState("");
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<"creating" | "invite" | "revoke" | "send" | null>(null);
  const [notice, setNotice] = useState("");
  const [collaborationToken, setCollaborationToken] = useState("");
  const [sharedOpen, setSharedOpen] = useState(false);

  const load = async () => {
    const response = await fetch(`/api/cases/${matter.id}/collaboration`);
    if (response.ok) {
      const next = await response.json();
      setData(next);
      onUnreadChange(next.unread);
    }
  };
  useEffect(() => { void load(); }, [matter.id]);

  const saveClient = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy("creating");
    try {
      const response = await fetch(`/api/cases/${matter.id}/collaboration/client`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Client could not be saved");
      setBusy("invite");
      await generateToken();
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Client could not be saved");
    } finally {
      setBusy(null);
    }
  };

  const generateToken = async () => {
    const response = await fetch(`/api/cases/${matter.id}/collaboration/token`, { method: "POST" });
    const next = await response.json();
    if (!response.ok) throw new Error(next.error || "Collaboration token could not be generated");
    setCollaborationToken(String(next.token));
    setNotice("A fresh collaboration token was generated. Older tokens are now invalid.");
  };

  const generateTokenClick = async () => {
    if (busy) return;
    setBusy("invite");
    try {
      await generateToken();
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Collaboration token could not be generated");
    } finally {
      setBusy(null);
    }
  };

  const copyToken = async () => {
    if (!collaborationToken) return;
    try {
      await navigator.clipboard.writeText(collaborationToken);
      setNotice("Collaboration token copied.");
    } catch {
      alert("Collaboration token could not be copied.");
    }
  };

  const copyLink = async () => {
    if (!data?.access?.id) return;
    const clientAccessLink = `${window.location.origin}/client/access/${encodeURIComponent(data.access.id)}`;
    try {
      await navigator.clipboard.writeText(clientAccessLink);
      setNotice("Client access link copied.");
    } catch {
      alert("Client access link could not be copied.");
    }
  };

  const revoke = async () => {
    if (!confirm("Revoke client access immediately?")) return;
    setBusy("revoke");
    try {
      const response = await fetch(`/api/cases/${matter.id}/collaboration/revoke`, { method: "POST" });
      const next = response.ok ? null : await response.json();
      if (!response.ok) throw new Error(next?.error || "Access could not be revoked");
      setCollaborationToken("");
      setNotice("Client access revoked.");
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Access could not be revoked");
    } finally {
      setBusy(null);
    }
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || draftIds.length === 0) return;
    setBusy("send");
    try {
      const response = await fetch(`/api/cases/${matter.id}/collaboration/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, instruction, draftIds }),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Request could not be sent");
      setInstruction("");
      setDraftIds([]);
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Request could not be sent");
    } finally {
      setBusy(null);
    }
  };

  const markRead = async (id: string) => {
    await fetch(`/api/cases/${matter.id}/collaboration/responses/${id}/read`, { method: "PUT" });
    await load();
  };

  const openAttachment = async (responseId: string, draftId: string, isRead: boolean) => {
    if (!isRead) await markRead(responseId);
    onOpenWorkProduct(draftId);
  };

  const attachmentLabel = (attachment: any) => {
    if (attachment.revision_type === "Client Response") return "Client Response";
    if (attachment.revision_type === "Client Revision") return "Client Revision";
    return "Shared Work Product";
  };

  const sortedRequests = useMemo(() => data?.requests || [], [data]);
  if (!data) return <p className="py-16 text-center text-xs font-mono uppercase text-zinc-400">Loading Collaboration...</p>;

  if (!data.access) {
    return (
      <div className="mx-auto flex min-h-[55vh] max-w-xl items-center justify-center">
        <form onSubmit={saveClient} className="w-full space-y-4 text-center">
          <UserPlus className="mx-auto h-8 w-8 text-zinc-300" />
          <div>
            <h3 className="text-sm font-semibold uppercase">Invite Client Collaborator</h3>
            <p className="mt-2 text-xs text-zinc-500">Create one secure portal collaborator for this Matter.</p>
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" placeholder="Client name" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" placeholder="Client email" />
          <button disabled={busy !== null || !name.trim() || !email.trim()} className="w-full rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50">
            {busy === "creating" ? "Creating..." : busy === "invite" ? "Generating token..." : "Create Collaborator & Generate Token"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase">{data.access.client_name}</h3>
          <p className="mt-1 text-xs text-zinc-500">{data.access.client_email} · {data.access.invitation_status}</p>
          {notice && <p className="mt-1 text-xs text-zinc-500">{notice}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => void generateTokenClick()} disabled={busy !== null} className="flex items-center gap-1 rounded border px-3 py-2 text-[10px] font-mono font-bold uppercase hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"><KeyRound className="h-3.5 w-3.5" />{busy === "invite" ? "Generating..." : data.access.invitation_status === "Active" ? "Regenerate Token" : "Generate Token"}</button>
          <button onClick={() => void revoke()} disabled={busy !== null} className="flex items-center gap-1 rounded border px-3 py-2 text-[10px] font-mono font-bold uppercase text-red-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"><XCircle className="h-3.5 w-3.5" />{busy === "revoke" ? "Revoking..." : "Revoke Access"}</button>
        </div>
      </header>

        {data.access.invitation_status === "Active" && (
          <section className="rounded border border-zinc-300 bg-zinc-50 p-4">
            <p className="text-[9px] font-mono font-bold uppercase tracking-[0.12em] text-zinc-500">
              Client access link
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="min-w-0 flex-1 break-all rounded bg-white px-3 py-2 text-sm font-semibold tracking-wide">
                {`${window.location.origin}/client/access/${encodeURIComponent(data.access.id)}`}
              </code>
              <button type="button" onClick={() => void copyLink()} className="flex items-center gap-1 rounded border border-zinc-300 bg-white px-3 py-2 text-[10px] font-mono font-bold uppercase hover:border-zinc-950">
                <Clipboard className="h-3.5 w-3.5" /> Copy link
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Share this access link and collaboration token with the client. The link identifies this Shared Matter; the token securely activates access.
            </p>
          </section>
        )}

        {collaborationToken && (
        <section className="rounded border border-zinc-300 bg-zinc-50 p-4">
          <p className="text-[9px] font-mono font-bold uppercase tracking-[0.12em] text-zinc-500">
            Collaboration token
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-3 py-2 text-sm font-semibold tracking-wide">
              {collaborationToken}
            </code>
            <button type="button" onClick={() => void copyToken()} className="flex items-center gap-1 rounded border border-zinc-300 bg-white px-3 py-2 text-[10px] font-mono font-bold uppercase hover:border-zinc-950">
              <Clipboard className="h-3.5 w-3.5" /> Copy token
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Share this token with the client. For security, it is shown only until you leave this page.
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase">Send Request</h3>
        <form onSubmit={send} className="space-y-3">
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded border bg-white px-3 py-2 text-xs">{requestTypes.map((item) => <option key={item}>{item}</option>)}</select>
          <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} className="h-20 w-full rounded border px-3 py-2 text-xs" placeholder="Optional comment or instruction" />
          <fieldset className="space-y-2">
            <legend className="mb-2 text-[9px] font-mono font-bold uppercase text-zinc-500">Connected Work Product</legend>
            {data.shared.map((draft) => <label key={draft.id} className="flex gap-2 text-xs"><input type="checkbox" checked={draftIds.includes(draft.id)} onChange={(e) => setDraftIds((current) => e.target.checked ? [...current, draft.id] : current.filter((id) => id !== draft.id))} />{draft.title}</label>)}
          </fieldset>
          <button disabled={busy !== null || draftIds.length === 0} className="flex items-center gap-2 rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-3.5 w-3.5" />{busy === "send" ? "Sending..." : "Send Request"}</button>
        </form>
      </section>

      <section>
        <button onClick={() => setSharedOpen(!sharedOpen)} className="flex w-full items-center justify-between rounded border px-4 py-3 text-left text-xs font-semibold uppercase hover:bg-zinc-50">
          <span>Shared Documents ({data.shared.length})</span><ChevronDown className={`h-4 w-4 transition-transform ${sharedOpen ? "rotate-180" : ""}`} />
        </button>
        {sharedOpen && <div className="mt-2 space-y-2">{data.shared.map((draft) => <div key={draft.id} className="rounded bg-zinc-50 px-3 py-2 text-xs"><div className="flex items-center gap-2"><FileText className="h-4 w-4" />{draft.title}<span className="ml-auto text-[9px] font-mono uppercase">{draft.shared_with_client ? "Shared" : "Private"}</span></div>{draft.client_comments?.slice(0, 1).map((comment) => <p key={comment.id} className="mt-2 text-zinc-500">Latest client comment: {comment.content}</p>)}</div>)}</div>}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase">Requests and Responses</h3>
        {sortedRequests.length === 0 ? <p className="text-xs text-zinc-500">No requests sent.</p> : sortedRequests.map((request) => (
          <article key={request.id} className="rounded border border-zinc-200 p-4">
            <div className="flex justify-between gap-3"><div><strong className="text-xs uppercase">{request.request_type}</strong><p className="mt-1 text-[10px] font-mono uppercase text-zinc-400">Sent {new Date(request.created_at).toLocaleString()}</p></div><span className="text-[9px] font-mono uppercase">{request.status}</span></div>
            <p className="mt-2 text-xs text-zinc-600">{request.instruction || "No additional instruction."}</p>
            <div className="mt-3 flex flex-wrap gap-2">{request.documents.map((draft) => <span key={draft.id} className="rounded bg-zinc-100 px-2 py-1 text-xs">{draft.title}</span>)}</div>
            {request.responses.length === 0 ? <p className="mt-3 text-xs text-zinc-400">No client response yet.</p> : request.responses.map((response) => (
              <article key={response.id} className={`mt-3 rounded p-3 text-xs ${response.is_read ? "bg-zinc-50" : "border border-zinc-900 bg-white font-semibold"}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[9px] font-mono uppercase">{response.response_type}{!response.is_read && " · Unread"}</span>
                  {!response.is_read && <button onClick={() => void markRead(response.id)} className="rounded border px-2 py-1 text-[9px] font-mono uppercase hover:bg-zinc-50">Mark read</button>}
                </div>
                <p className="mt-1">{response.content || "Attached response"}</p>
                {response.attachments?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {response.attachments.map((item: any) => item.draft_id ? (
                      <button
                        key={item.id || `${response.id}-${item.draft_id}`}
                        type="button"
                        onClick={() => void openAttachment(response.id, item.draft_id, response.is_read)}
                        className="rounded border border-zinc-200 bg-white px-2 py-1 text-left text-[10px] hover:bg-zinc-50"
                      >
                        <span className="mr-2 font-mono uppercase text-zinc-400">{attachmentLabel(item)}</span>
                        {item.draft_title || item.document_title || "Attached Work Product"}
                      </button>
                    ) : (
                      <span key={item.id || `${response.id}-${item.document_id}`} className="rounded border border-zinc-200 bg-white px-2 py-1 text-[10px] text-zinc-500">
                        {item.document_title || "Attached file"}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </article>
        ))}
      </section>
    </div>
  );
}
