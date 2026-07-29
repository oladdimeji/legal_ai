import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, Clipboard, FileText, Link, Send, UserPlus, XCircle } from "lucide-react";
import { Case, ClientAccess, CollaborationRequest, Draft } from "../types";
import { secureFetch } from "../lib/secureFetch";

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
      await rotateAndCopyInvite();
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Client could not be saved");
    } finally {
      setBusy(null);
    }
  };

  const rotateAndCopyInvite = async () => {
    const response = await fetch(`/api/cases/${matter.id}/collaboration/invite`, { method: "POST" });
    const next = await response.json();
    if (!response.ok) throw new Error(next.error || "Invite link could not be generated");
    await navigator.clipboard.writeText(`${location.origin}${next.invitePath}`);
    setNotice("Fresh invite link copied. Older links are now invalid.");
  };

  const copyInvite = async () => {
    if (busy) return;
    setBusy("invite");
    try {
      await rotateAndCopyInvite();
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Invite link could not be copied");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    if (!confirm("Revoke client access immediately?")) return;
    setBusy("revoke");
    try {
      const response = await fetch(`/api/cases/${matter.id}/collaboration/revoke`, { method: "POST" });
      const next = response.ok ? null : await response.json();
      if (!response.ok) throw new Error(next?.error || "Access could not be revoked");
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
      <div className="mx-auto max-w-3xl space-y-8">
        <MatterClientAccounts matterId={matter.id} />
        <div className="flex min-h-[45vh] items-center justify-center border-t pt-8">
        <form onSubmit={saveClient} className="w-full space-y-4 text-center">
          <UserPlus className="mx-auto h-8 w-8 text-zinc-300" />
          <div>
            <h3 className="text-sm font-semibold uppercase">Invite Client Collaborator</h3>
            <p className="mt-2 text-xs text-zinc-500">Create one legacy token-portal collaborator for compatibility.</p>
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" placeholder="Client name" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" placeholder="Client email" />
          <button disabled={busy !== null || !name.trim() || !email.trim()} className="w-full rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50">
            {busy === "creating" ? "Creating..." : busy === "invite" ? "Generating invite..." : "Create Collaborator & Invite"}
          </button>
        </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <MatterClientAccounts matterId={matter.id} />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase">{data.access.client_name}</h3>
          <p className="mt-1 text-xs text-zinc-500">{data.access.client_email} · {data.access.invitation_status}</p>
          {notice && <p className="mt-1 text-xs text-zinc-500">{notice}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => void copyInvite()} disabled={busy !== null} className="flex items-center gap-1 rounded border px-3 py-2 text-[10px] font-mono font-bold uppercase hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"><Clipboard className="h-3.5 w-3.5" />{busy === "invite" ? "Copying..." : "Copy Invite Link"}</button>
          <button onClick={() => void revoke()} disabled={busy !== null} className="flex items-center gap-1 rounded border px-3 py-2 text-[10px] font-mono font-bold uppercase text-red-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"><XCircle className="h-3.5 w-3.5" />{busy === "revoke" ? "Revoking..." : "Revoke Access"}</button>
        </div>
      </header>

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

type ClientAccountAccess = {
  memberships: Array<{ id: string; name: string; email: string; status: "active" | "suspended" | "removed" }>;
  invitations: Array<{ id: string; client_name: string; email: string; status: string; expires_at: string }>;
};

function MatterClientAccounts({ matterId }: { matterId: string }) {
  const [data, setData] = useState<ClientAccountAccess>({ memberships: [], invitations: [] });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [invitationUrl, setInvitationUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const response = await fetch(`/api/cases/${matterId}/client-accounts`, { cache: "no-store" });
    if (response.ok) setData(await response.json());
  };
  useEffect(() => { void load(); }, [matterId]);
  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setInvitationUrl("");
    try {
      const response = await secureFetch(`/api/cases/${matterId}/client-accounts/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Invitation could not be created.");
      if (next.invitationUrl) setInvitationUrl(next.invitationUrl);
      if (next.delivery === "failed") {
        setError("The invitation was created, but transactional email was not delivered. Revoke it before creating a replacement.");
      }
      setName("");
      setEmail("");
      await load();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Invitation could not be created.");
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = async (
    membershipId: string,
    status: "active" | "suspended" | "removed",
  ) => {
    if (status === "removed" && !confirm("Remove this client's Matter access?")) return;
    await secureFetch(
      `/api/cases/${matterId}/client-accounts/memberships/${membershipId}/status`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    await load();
  };
  const revokeInvitation = async (invitationId: string) => {
    await secureFetch(
      `/api/cases/${matterId}/client-accounts/invitations/${invitationId}`,
      { method: "DELETE" },
    );
    await load();
  };
  return <section className="space-y-4 rounded border border-zinc-200 p-5">
    <div><h3 className="text-sm font-semibold uppercase">Client accounts</h3><p className="mt-1 text-xs text-zinc-500">Invite multiple contacts. Each contact receives only explicit active membership in this Matter.</p></div>
    <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Client name" className="rounded border px-3 py-2 text-xs" />
      <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="client@example.com" className="rounded border px-3 py-2 text-xs" />
      <button disabled={busy} className="rounded bg-zinc-950 px-4 py-2 text-[9px] font-mono font-bold uppercase text-white disabled:opacity-50">{busy ? "Inviting..." : "Invite client"}</button>
    </form>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {invitationUrl && <div className="rounded border bg-zinc-50 p-3"><p className="text-[10px] font-mono font-bold uppercase">Internal preview — one-time invitation link</p><p className="mt-1 break-all text-xs">{invitationUrl}</p><button onClick={() => void navigator.clipboard.writeText(invitationUrl)} className="mt-2 text-[9px] font-mono font-bold uppercase">Copy link</button></div>}
    {data.memberships.map((membership) => <div key={membership.id} className="flex flex-wrap items-center justify-between gap-3 rounded bg-zinc-50 p-3"><div><p className="text-xs font-semibold">{membership.name}</p><p className="text-[10px] text-zinc-500">{membership.email} · {membership.status}</p></div><div className="flex gap-2">{membership.status === "active" ? <button onClick={() => void changeStatus(membership.id, "suspended")} className="rounded border bg-white px-2 py-1 text-[9px] font-mono uppercase">Suspend</button> : membership.status === "suspended" ? <button onClick={() => void changeStatus(membership.id, "active")} className="rounded border bg-white px-2 py-1 text-[9px] font-mono uppercase">Restore</button> : null}{membership.status !== "removed" && <button onClick={() => void changeStatus(membership.id, "removed")} className="rounded border bg-white px-2 py-1 text-[9px] font-mono uppercase">Remove</button>}</div></div>)}
    {data.invitations.filter((invitation) => invitation.status === "pending").map((invitation) => <div key={invitation.id} className="flex items-center justify-between gap-3 text-xs text-zinc-500"><p>Pending: {invitation.client_name} · {invitation.email}</p><button onClick={() => void revokeInvitation(invitation.id)} className="rounded border bg-white px-2 py-1 text-[9px] font-mono uppercase">Revoke</button></div>)}
  </section>;
}
