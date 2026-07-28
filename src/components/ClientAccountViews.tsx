import React, { useEffect, useMemo, useState } from "react";
import { Download, FileText, LogOut, MessageSquare, RefreshCw, Send } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import FormattedMarkdown from "./FormattedMarkdown";
import RichDocumentEditor from "./RichDocumentEditor";
import { EmptyState, ErrorState, LoadingState } from "./ui/States";
import { secureFetch } from "../lib/secureFetch";

async function responseData(response: Response): Promise<any> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

export function ClientLoginView({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "reset" | "verify">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!enabled) return <ClientUnavailable />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode !== "login") {
        const data = await responseData(await secureFetch(
          mode === "reset"
            ? "/api/client/password-reset/request"
            : "/api/client/verification/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, ...(mode === "verify" ? { password } : {}) }),
        }));
        setMessage(data.message);
      } else {
        await responseData(await secureFetch("/api/client/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        }));
        navigate("/client/dashboard", { replace: true });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="mx-auto w-full max-w-md py-14">
    <div className="rounded border border-zinc-200 bg-white p-7 shadow-sm">
      <h1 className="text-xl font-semibold">
        {mode === "reset" ? "Reset client password"
          : mode === "verify" ? "Resend email verification" : "Client login"}
      </h1>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">
        {mode === "reset" ? "Enter your verified client email."
          : mode === "verify" ? "Confirm your credentials to request a new one-time verification link."
            : "Access only the Matters explicitly shared with your client account."}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block text-[10px] font-mono font-semibold uppercase text-zinc-500">Email
          <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded border px-3 py-2.5 text-sm font-sans normal-case" />
        </label>
        {mode !== "reset" && <label className="block text-[10px] font-mono font-semibold uppercase text-zinc-500">Password
          <input type="password" minLength={12} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded border px-3 py-2.5 text-sm font-sans normal-case" />
        </label>}
        {message && <p role="alert" className="rounded border bg-zinc-50 p-3 text-xs">{message}</p>}
        <button disabled={busy} className="w-full rounded bg-zinc-950 px-4 py-2.5 text-[10px] font-mono font-bold uppercase text-white disabled:opacity-50">{busy ? "Please wait..." : mode === "reset" ? "Send reset instructions" : mode === "verify" ? "Send verification link" : "Log in"}</button>
      </form>
      <div className="mt-4 flex gap-4">
        {mode !== "login" && <button type="button" onClick={() => { setMode("login"); setMessage(""); }} className="text-xs underline underline-offset-4">Return to client login</button>}
        {mode === "login" && <button type="button" onClick={() => { setMode("reset"); setMessage(""); }} className="text-xs underline underline-offset-4">Forgot password?</button>}
        {mode === "login" && <button type="button" onClick={() => { setMode("verify"); setMessage(""); }} className="text-xs underline underline-offset-4">Resend verification</button>}
      </div>
    </div>
  </div>;
}

export function ClientInvitationView({ enabled }: { enabled: boolean }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const [invitation, setInvitation] = useState<any | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    if (!enabled || !token) return;
    fetch(`/api/client/invitations/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(responseData)
      .then((data) => { setInvitation(data); setName(data.clientName || ""); })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setBusy(false));
  }, [enabled, token]);
  if (!enabled) return <ClientUnavailable />;
  if (!token) return <Navigate to="/client/login" replace />;
  if (busy) return <LoadingState label="Loading invitation…" />;
  if (!invitation) return <ErrorState title="Invitation unavailable" detail={error} />;

  const accept = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await responseData(await secureFetch(
        `/api/client/invitations/${encodeURIComponent(token)}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, password }),
        },
      ));
      if (data.verificationRequired) {
        setInvitation({ ...invitation, accepted: true, verificationDelivery: data.delivery });
      } else {
        navigate("/client/dashboard", { replace: true });
      }
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Invitation could not be accepted.");
    } finally {
      setBusy(false);
    }
  };

  if (invitation.accepted) {
    return <div className="mx-auto max-w-lg py-16"><EmptyState
      title={invitation.verificationDelivery === "failed" ? "Verification email was not delivered" : "Check your email"}
      detail={invitation.verificationDelivery === "failed"
        ? "Go to client login and use Resend verification. Your Matter access remains unavailable until verification succeeds."
        : "Use the one-time verification link sent to your invited email, then return to client login."}
    /><Link className="mt-4 inline-block text-xs underline" to="/client/login">Go to client login</Link></div>;
  }
  return <div className="mx-auto w-full max-w-lg py-12">
    <div className="rounded border bg-white p-7">
      <p className="text-[10px] font-mono uppercase text-zinc-500">{invitation.firmName}</p>
      <h1 className="mt-2 text-xl font-semibold">Activate client access</h1>
      <p className="mt-2 text-sm">You were invited to <strong>{invitation.matterName}</strong> as {invitation.email}.</p>
      <form onSubmit={accept} className="mt-6 space-y-4">
        <label className="block text-xs">Name<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded border px-3 py-2.5" /></label>
        <label className="block text-xs">Create or confirm password<input type="password" minLength={12} required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded border px-3 py-2.5" /></label>
        <p className="text-xs text-zinc-500">Use at least 12 characters. Existing client accounts must enter their current password; access is never granted from an email match alone.</p>
        {error && <p role="alert" className="rounded border p-3 text-xs">{error}</p>}
        <button disabled={busy} className="rounded bg-zinc-950 px-5 py-2.5 text-[10px] font-mono font-bold uppercase text-white disabled:opacity-50">{busy ? "Activating..." : "Activate account"}</button>
      </form>
    </div>
  </div>;
}

export function ClientVerifyView({ enabled }: { enabled: boolean }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<"working" | "failed">("working");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled || !token) return;
    void secureFetch(`/api/client/verify/${encodeURIComponent(token)}`, { method: "POST" })
      .then(responseData)
      .then(() => navigate("/client/dashboard", { replace: true }))
      .catch((verifyError) => { setError(verifyError.message); setState("failed"); });
  }, [enabled, token]);
  if (!enabled) return <ClientUnavailable />;
  return state === "working" ? <LoadingState label="Verifying client account…" />
    : <ErrorState title="Verification unavailable" detail={error} />;
}

export function ClientResetPasswordView({ enabled }: { enabled: boolean }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  if (!enabled) return <ClientUnavailable />;
  if (!token) return <Navigate to="/client/login" replace />;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await responseData(await secureFetch(`/api/client/password-reset/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }));
      navigate("/client/login", { replace: true });
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Password could not be reset.");
    }
  };
  return <div className="mx-auto w-full max-w-md py-14"><form onSubmit={submit} className="space-y-4 rounded border bg-white p-7"><h1 className="text-xl font-semibold">Choose a new password</h1><input type="password" minLength={12} maxLength={200} required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded border px-3 py-2.5" />{error && <p role="alert" className="text-xs">{error}</p>}<button className="rounded bg-zinc-950 px-5 py-2.5 text-[10px] font-mono font-bold uppercase text-white">Reset password</button></form></div>;
}

type Matter = { id: string; name: string; description: string; status: string; firm_name: string };
type SharedDocument = { id: string; case_id: string; title: string; content: string; revision_type: string; updated_at: string };

export function ClientDashboardView({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate();
  const [data, setData] = useState<any | null>(null);
  const [account, setAccount] = useState<any | null>(null);
  const [selectedMatterId, setSelectedMatterId] = useState("");
  const [openDocument, setOpenDocument] = useState<SharedDocument | null>(null);
  const [revisionContent, setRevisionContent] = useState("");
  const [comment, setComment] = useState("");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [sessions, setSessions] = useState<any[]>([]);
  const [preferences, setPreferences] = useState({ in_app_enabled: true, email_enabled: true });
  const [error, setError] = useState("");
  const load = async () => {
    try {
      const [me, dashboard, sessionData, preferenceData] = await Promise.all([
        responseData(await fetch("/api/client/me", { cache: "no-store" })),
        responseData(await fetch("/api/client/dashboard", { cache: "no-store" })),
        responseData(await fetch("/api/client/sessions", { cache: "no-store" })),
        responseData(await fetch("/api/client/preferences", { cache: "no-store" })),
      ]);
      setAccount(me);
      setData(dashboard);
      setSessions(sessionData);
      setPreferences(preferenceData);
      setSelectedMatterId((current) => current || dashboard.matters[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Dashboard could not be loaded.");
    }
  };
  useEffect(() => { if (enabled) void load(); }, [enabled]);
  const documents = useMemo(
    () => (data?.sharedDocuments || []).filter((document: SharedDocument) => document.case_id === selectedMatterId),
    [data, selectedMatterId],
  );
  const requests = useMemo(
    () => (data?.requests || []).filter((request: any) => request.case_id === selectedMatterId),
    [data, selectedMatterId],
  );
  if (!enabled) return <ClientUnavailable />;
  if (!data && !error) return <LoadingState label="Loading client dashboard…" />;
  if (!data) return <div className="mx-auto max-w-lg py-16"><ErrorState title="Client dashboard unavailable" detail={error} /><Link className="mt-4 inline-block text-xs underline" to="/client/login">Return to login</Link></div>;
  if (data.accessState === "suspended") return <ErrorState title="Client access suspended" detail="Contact your lawyer if you believe this is unexpected." />;
  if (data.accessState === "removed") return <ErrorState title="Matter access removed" detail="This account currently has no active Matter access." />;
  if (!data.matters.length) return <EmptyState title="No Matters shared" detail="Your client account is active, but no Matter has been explicitly assigned." />;

  const selectedMatter = data.matters.find((matter: Matter) => matter.id === selectedMatterId) || data.matters[0];
  const write = async (url: string, body: unknown) => {
    setError("");
    try {
      await responseData(await secureFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
      await load();
    } catch (writeError) {
      setError(writeError instanceof Error ? writeError.message : "Update failed.");
    }
  };
  const logout = async () => {
    await secureFetch("/api/client/logout", { method: "POST" });
    navigate("/client/login", { replace: true });
  };

  return <div className="mx-auto w-full max-w-6xl py-8">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
      <div><p className="text-[10px] font-mono uppercase text-zinc-500">Client dashboard</p><h1 className="mt-1 text-xl font-semibold">{account?.client?.name}</h1></div>
      <button onClick={() => void logout()} className="flex items-center gap-2 rounded border px-3 py-2 text-[10px] font-mono font-bold uppercase"><LogOut className="h-4 w-4" />Log out</button>
    </header>
    <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside className="space-y-2"><p className="text-[10px] font-mono font-bold uppercase text-zinc-500">Authorized Matters</p>{data.matters.map((matter: Matter) => <button key={matter.id} onClick={() => { setSelectedMatterId(matter.id); setOpenDocument(null); }} className={`w-full rounded border p-3 text-left text-xs ${matter.id === selectedMatterId ? "border-zinc-950 bg-zinc-50 font-semibold" : "border-zinc-200"}`}><span className="block">{matter.name}</span><span className="mt-1 block text-[9px] font-mono uppercase text-zinc-400">{matter.firm_name}</span></button>)}<section className="mt-5 space-y-2 border-t pt-4"><p className="text-[10px] font-mono font-bold uppercase text-zinc-500">Account security</p>{sessions.map((session) => <div key={session.id} className="rounded border p-2 text-[9px]"><p>{session.current ? "Current session" : `Last used ${new Date(session.last_used_at).toLocaleDateString()}`}</p>{!session.revoked_at && <button onClick={() => void secureFetch(`/api/client/sessions/${session.id}`, { method: "DELETE" }).then(load)} className="mt-1 font-mono font-bold uppercase">Revoke</button>}</div>)}<label className="flex items-center gap-2 text-[10px]"><input type="checkbox" checked={preferences.in_app_enabled} onChange={(event) => { const next = { ...preferences, in_app_enabled: event.target.checked }; setPreferences(next); void secureFetch("/api/client/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inAppEnabled: next.in_app_enabled, emailEnabled: next.email_enabled }) }); }} />In-app notifications</label><label className="flex items-center gap-2 text-[10px]"><input type="checkbox" checked={preferences.email_enabled} onChange={(event) => { const next = { ...preferences, email_enabled: event.target.checked }; setPreferences(next); void secureFetch("/api/client/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inAppEnabled: next.in_app_enabled, emailEnabled: next.email_enabled }) }); }} />Email notifications</label></section></aside>
      <main className="min-w-0 space-y-7">
        <section><h2 className="text-lg font-semibold">{selectedMatter.name}</h2><p className="mt-1 text-xs text-zinc-500">{selectedMatter.description || "No Matter description supplied."}</p></section>
        {(data.notifications || []).some((item: any) => !item.read_at && item.case_id === selectedMatterId) && <div className="rounded border bg-zinc-50 p-3 text-xs">New activity is available in this Matter.</div>}
        {error && <p role="alert" className="rounded border p-3 text-xs">{error}</p>}
        <section className="space-y-3"><h3 className="text-sm font-semibold uppercase">Shared documents and revisions</h3>{documents.length === 0 ? <p className="text-xs text-zinc-500">No Work Product is shared yet.</p> : documents.map((document: SharedDocument) => <article key={document.id} className="rounded border p-4"><div className="flex items-center gap-2"><FileText className="h-4 w-4" /><button onClick={() => { setOpenDocument(document); setRevisionContent(document.content); }} className="text-left text-sm font-semibold underline-offset-4 hover:underline">{document.title}</button><a className="ml-auto flex items-center gap-1 text-[9px] font-mono uppercase" href={`/api/client/matters/${selectedMatterId}/documents/${document.id}/download`}><Download className="h-3.5 w-3.5" />Download</a></div><p className="mt-1 text-[9px] font-mono uppercase text-zinc-400">{document.revision_type}</p></article>)}</section>
        {openDocument && <section className="space-y-4 rounded border p-5"><div className="flex items-center justify-between"><h3 className="font-semibold">{openDocument.title}</h3><button onClick={() => setOpenDocument(null)} className="text-[9px] font-mono uppercase">Close</button></div><FormattedMarkdown content={openDocument.content} /><div className="border-t pt-4"><label className="text-[10px] font-mono font-bold uppercase">Private comment to lawyer<textarea value={comment} onChange={(event) => setComment(event.target.value)} className="mt-2 h-20 w-full rounded border p-3 text-xs font-sans normal-case" /></label><button disabled={!comment.trim()} onClick={() => void write(`/api/client/matters/${selectedMatterId}/documents/${openDocument.id}/comments`, { content: comment }).then(() => setComment(""))} className="mt-2 rounded border px-3 py-2 text-[9px] font-mono font-bold uppercase disabled:opacity-40"><MessageSquare className="mr-1 inline h-3.5 w-3.5" />Leave comment</button></div><div className="border-t pt-4"><p className="mb-2 text-[10px] font-mono font-bold uppercase">Create a private revision</p><RichDocumentEditor value={revisionContent} onChange={setRevisionContent} minHeight={240} /><button onClick={() => void write(`/api/client/matters/${selectedMatterId}/documents/${openDocument.id}/revisions`, { content: revisionContent })} className="mt-2 rounded border px-3 py-2 text-[9px] font-mono font-bold uppercase"><RefreshCw className="mr-1 inline h-3.5 w-3.5" />Submit revision</button></div></section>}
        <section className="space-y-3"><h3 className="text-sm font-semibold uppercase">Lawyer requests</h3>{requests.length === 0 ? <p className="text-xs text-zinc-500">No requests are waiting.</p> : requests.map((request: any) => <article key={request.id} className="rounded border p-4"><div className="flex justify-between gap-3"><strong className="text-xs uppercase">{request.request_type}</strong><span className="text-[9px] font-mono uppercase">{request.status}</span></div><p className="mt-2 text-xs text-zinc-600">{request.instruction || "No additional instruction."}</p><div className="mt-3 flex flex-wrap gap-2">{(request.documents || []).map((document: any) => <span key={document.id} className="rounded bg-zinc-100 px-2 py-1 text-[10px]">{document.title}</span>)}</div><textarea aria-label={`Response to ${request.request_type}`} value={responses[request.id] || ""} onChange={(event) => setResponses((current) => ({ ...current, [request.id]: event.target.value }))} className="mt-3 h-20 w-full rounded border p-3 text-xs" placeholder="Write a response" /><button disabled={!responses[request.id]?.trim()} onClick={() => void write(`/api/client/matters/${selectedMatterId}/requests/${request.id}/responses`, { content: responses[request.id] }).then(() => setResponses((current) => ({ ...current, [request.id]: "" })))} className="mt-2 flex items-center gap-1 rounded bg-zinc-950 px-3 py-2 text-[9px] font-mono font-bold uppercase text-white disabled:opacity-40"><Send className="h-3.5 w-3.5" />Send response</button></article>)}</section>
      </main>
    </div>
  </div>;
}

export function ClientUnavailable() {
  return <div className="mx-auto max-w-lg py-16"><EmptyState title="Client accounts are not available yet" detail="Use the secure invitation link supplied by your lawyer. Existing legacy invitation links continue to work." /></div>;
}
