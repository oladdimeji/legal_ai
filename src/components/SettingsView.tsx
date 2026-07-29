import React, { useEffect, useState } from "react";
import { Cloud, Copy, LogOut, Settings, Users } from "lucide-react";
import { Case, FirmMembership, FirmRole, User } from "../types";
import type { PublicBrowserConfig } from "../lib/publicConfig";

type GoogleConnectionStatus = {
  connected: boolean;
  email?: string;
  revocationState?: string;
  connectedAt?: string;
};

export default function SettingsView({
  user,
  membership,
  matters,
  onLogout,
  integrations,
}: {
  user: User;
  membership: FirmMembership;
  matters: Case[];
  onLogout: () => void;
  integrations: PublicBrowserConfig["integrations"];
}) {
  const [googleStatus, setGoogleStatus] = useState<GoogleConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadGoogle = async () => {
    if (integrations.google.status !== "configured") return;
    const response = await fetch("/api/google/connection");
    if (response.ok) setGoogleStatus(await response.json());
  };

  useEffect(() => { void loadGoogle(); }, [integrations.google.status]);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("google");
    const messages: Record<string, string> = {
      connected: "",
      connection_conflict: "This Google account is already linked elsewhere, or this Exepts user has a different Google account linked. No accounts were merged.",
      offline_access_required: "Google did not provide offline access. Please retry linking and approve the requested Drive access.",
      email_unverified: "Google did not confirm a verified email for this account.",
      cancelled: "Google account linking was cancelled.",
      invalid_state: "Google account linking expired or could not be validated. Please try again.",
      invalid_callback: "Google callback validation failed.",
      callback_failed: "Google account linking could not be completed.",
    };
    if (result && messages[result]) setError(messages[result]);
  }, []);

  const connectGoogle = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/google/oauth/start", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Google linking could not be started.");
      window.location.assign(data.authorizationUrl);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Google linking could not be started.");
      setBusy(false);
    }
  };

  const disconnectGoogle = async () => {
    if (!confirm("Disconnect Google? Password login and imported Exepts copies will remain available.")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/google/connection", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Google could not be disconnected.");
      setGoogleStatus({ connected: false, revocationState: data.providerRevoked ? "disconnected" : "provider_revocation_failed" });
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Google could not be disconnected.");
    } finally {
      setBusy(false);
    }
  };

  const refreshGoogle = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/google/connection/refresh", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Google authorization could not be refreshed.");
      setGoogleStatus((current) => ({ ...current, ...data }));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Google authorization could not be refreshed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-white p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <div className="flex items-center gap-2"><Settings className="h-5 w-5" /><h2 className="text-lg font-bold uppercase">Settings</h2></div>
          <p className="mt-1 text-[11px] font-mono uppercase text-zinc-400">Account details and connections</p>
        </header>
        <div className="space-y-4 rounded border border-zinc-200 p-6">
          <label className="block"><span className="text-[10px] font-mono font-bold uppercase text-zinc-500">Name</span><input readOnly value={user.name} className="mt-1 w-full rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm" /></label>
          <label className="block"><span className="text-[10px] font-mono font-bold uppercase text-zinc-500">Email</span><input readOnly value={user.email} className="mt-1 w-full rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm" /></label>
          <button onClick={onLogout} className="flex items-center gap-2 rounded border border-zinc-300 px-4 py-2 text-[10px] font-mono font-bold uppercase hover:border-zinc-900"><LogOut className="h-4 w-4" />Log out</button>
        </div>

        {membership.role === "firm_admin" && (
          <TeamSettings currentUser={user} matters={matters} />
        )}

        {integrations.google.status === "configured" ? (
          <section className="space-y-4 rounded border border-zinc-200 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2"><Cloud className="h-4 w-4" /><h3 className="text-sm font-semibold uppercase">Google account</h3></div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">Link Google for linked-account sign-in and Drive export. Exepts requests only profile identity and access to Drive files it creates.</p>
              </div>
              <span className="rounded border px-2 py-1 text-[9px] font-mono font-bold uppercase">{googleStatus?.connected ? "Connected" : "Not connected"}</span>
            </div>
            {googleStatus?.connected && <p className="text-xs"><strong>{googleStatus.email}</strong><br /><span className="text-zinc-500">Password login remains active.</span></p>}
            {googleStatus?.revocationState === "provider_revocation_failed" && <p className="text-xs text-amber-800">Exepts disconnected the account locally, but Google could not confirm provider revocation. Review access in your Google Account.</p>}
            {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
            {googleStatus?.connected
              ? <div className="flex flex-wrap gap-2"><button onClick={() => void refreshGoogle()} disabled={busy} className="rounded border border-zinc-300 px-4 py-2 text-[10px] font-mono font-bold uppercase disabled:opacity-50">{busy ? "Working..." : "Refresh authorization"}</button><button onClick={() => void disconnectGoogle()} disabled={busy} className="rounded border border-zinc-300 px-4 py-2 text-[10px] font-mono font-bold uppercase disabled:opacity-50">{busy ? "Working..." : "Disconnect Google"}</button></div>
              : <button onClick={() => void connectGoogle()} disabled={busy} className="rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:opacity-50">{busy ? "Connecting..." : "Link Google account"}</button>}
          </section>
        ) : <section className="rounded border border-zinc-200 p-6"><div className="flex items-center gap-2"><Cloud className="h-4 w-4" /><h3 className="text-sm font-semibold uppercase">Google integration</h3></div><p className="mt-2 text-xs text-zinc-500">Not configured. Account linking and Drive export appear automatically when the server has the complete Google credential set.</p></section>}

        <section className="rounded border border-zinc-200 p-6">
          <h3 className="text-sm font-semibold uppercase">Optional integrations</h3>
          <dl className="mt-3 grid gap-2 text-xs">
            <div className="flex justify-between"><dt>GovInfo</dt><dd className="font-mono uppercase">{integrations.govInfo.status.replace("_", " ")}</dd></div>
            <div className="flex justify-between"><dt>Transactional email</dt><dd className="font-mono uppercase">{integrations.transactionalEmail.status.replace("_", " ")}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}

type TeamMember = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: FirmRole;
  status: "active" | "suspended" | "removed";
  matter_ids: string[];
};

type TeamInvitation = {
  id: string;
  email: string;
  role: FirmRole;
  status: string;
  expires_at: string;
};

function TeamSettings({ currentUser, matters }: { currentUser: User; matters: Case[] }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<FirmRole>("lawyer");
  const [matterIds, setMatterIds] = useState<string[]>([]);
  const [invitationUrl, setInvitationUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const response = await fetch("/api/team/members");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Team could not be loaded.");
    setMembers(data.members);
    setInvitations(data.invitations);
  };

  useEffect(() => { void load().catch((loadError) => setError(loadError.message)); }, []);

  const request = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Team update failed.");
      await load();
      return data;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Team update failed.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    const data = await request("/api/team/invitations", "POST", { email, role, matterIds });
    setInvitationUrl(data?.invitationUrl || "");
    setEmail("");
    setMatterIds([]);
  };

  const toggleAssignment = async (member: TeamMember, matterId: string) => {
    const next = member.matter_ids.includes(matterId)
      ? member.matter_ids.filter((id) => id !== matterId)
      : [...member.matter_ids, matterId];
    await request(`/api/team/members/${member.id}/assignments`, "PUT", { matterIds: next });
  };

  return (
    <section className="space-y-5 rounded border border-zinc-200 p-6">
      <div className="flex items-center gap-2"><Users className="h-4 w-4" /><h3 className="text-sm font-semibold uppercase">Firm team</h3></div>
      <p className="text-xs leading-relaxed text-zinc-500">Invite firm members, set their role, and assign Matters. Email is sent when configured; otherwise the one-time invitation link is shown once for authorized delivery.</p>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}

      <form onSubmit={invite} className="space-y-3 border-t border-zinc-100 pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <input aria-label="Invite email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="colleague@example.com" className="rounded border border-zinc-300 px-3 py-2 text-sm" />
          <select aria-label="Invite role" value={role} onChange={(event) => setRole(event.target.value as FirmRole)} className="rounded border border-zinc-300 px-3 py-2 text-sm">
            <option value="firm_admin">Firm admin</option>
            <option value="lawyer">Lawyer</option>
            <option value="staff">Staff</option>
            <option value="read_only">Read only</option>
          </select>
        </div>
        {role !== "firm_admin" && matters.length > 0 && (
          <fieldset>
            <legend className="text-[10px] font-mono font-bold uppercase text-zinc-500">Initial Matter assignments</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {matters.map((matter) => <label key={matter.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={matterIds.includes(matter.id)} onChange={() => setMatterIds((current) => current.includes(matter.id) ? current.filter((id) => id !== matter.id) : [...current, matter.id])} />{matter.name}</label>)}
            </div>
          </fieldset>
        )}
        <button disabled={busy} className="rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:opacity-50">Create invitation</button>
      </form>

      {invitationUrl && <div className="rounded border border-zinc-200 bg-zinc-50 p-3"><p className="break-all text-xs">{invitationUrl}</p><button type="button" onClick={() => void navigator.clipboard.writeText(invitationUrl)} className="mt-2 flex items-center gap-1 text-[10px] font-mono font-bold uppercase"><Copy className="h-3 w-3" />Copy link</button></div>}

      <div className="space-y-3 border-t border-zinc-100 pt-4">
        {members.map((member) => (
          <article key={member.id} className="rounded border border-zinc-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-sm font-semibold">{member.name}</p><p className="text-xs text-zinc-500">{member.email} · {member.status}</p></div>
              <div className="flex gap-2">
                <select aria-label={`Role for ${member.name}`} value={member.role} disabled={busy || member.status === "removed"} onChange={(event) => void request(`/api/team/members/${member.id}/role`, "PUT", { role: event.target.value })} className="rounded border border-zinc-300 px-2 py-1 text-xs">
                  <option value="firm_admin">Firm admin</option><option value="lawyer">Lawyer</option><option value="staff">Staff</option><option value="read_only">Read only</option>
                </select>
                {member.user_id !== currentUser.id && member.status !== "removed" && <>
                  <button type="button" disabled={busy} onClick={() => void request(`/api/team/members/${member.id}/status`, "PUT", { status: member.status === "active" ? "suspended" : "active" })} className="rounded border border-zinc-300 px-2 py-1 text-[9px] font-mono font-bold uppercase">{member.status === "active" ? "Suspend" : "Activate"}</button>
                  <button type="button" disabled={busy} onClick={() => confirm(`Remove ${member.name}? Their Matter ownership will transfer to you.`) && void request(`/api/team/members/${member.id}`, "DELETE", { reassignToUserId: currentUser.id })} className="rounded border border-zinc-300 px-2 py-1 text-[9px] font-mono font-bold uppercase">Remove</button>
                </>}
              </div>
            </div>
            {member.role !== "firm_admin" && member.status !== "removed" && <div className="mt-3 grid gap-2 sm:grid-cols-2">{matters.map((matter) => <label key={matter.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={member.matter_ids.includes(matter.id)} onChange={() => void toggleAssignment(member, matter.id)} />{matter.name}</label>)}</div>}
          </article>
        ))}
      </div>

      {invitations.some((invitation) => invitation.status === "pending") && <div className="border-t border-zinc-100 pt-4"><p className="text-[10px] font-mono font-bold uppercase text-zinc-500">Pending invitations</p>{invitations.filter((invitation) => invitation.status === "pending").map((invitation) => <div key={invitation.id} className="mt-2 flex items-center justify-between gap-3 text-xs"><span>{invitation.email} · {invitation.role.replace("_", " ")}</span><button disabled={busy} onClick={() => void request(`/api/team/invitations/${invitation.id}`, "DELETE")} className="font-mono text-[9px] font-bold uppercase">Revoke</button></div>)}</div>}
    </section>
  );
}
