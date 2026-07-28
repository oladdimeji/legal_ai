import React, { useEffect, useState } from "react";
import { Cloud, LogOut, Settings } from "lucide-react";
import { User } from "../types";

type GoogleConnectionStatus = {
  connected: boolean;
  email?: string;
  revocationState?: string;
  connectedAt?: string;
};

export default function SettingsView({
  user,
  onLogout,
  googleDriveEnabled = false,
}: {
  user: User;
  onLogout: () => void;
  googleDriveEnabled?: boolean;
}) {
  const [googleStatus, setGoogleStatus] = useState<GoogleConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadGoogle = async () => {
    if (!googleDriveEnabled) return;
    const response = await fetch("/api/google/connection");
    if (response.ok) setGoogleStatus(await response.json());
  };

  useEffect(() => { void loadGoogle(); }, [googleDriveEnabled]);
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

        {googleDriveEnabled && (
          <section className="space-y-4 rounded border border-zinc-200 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2"><Cloud className="h-4 w-4" /><h3 className="text-sm font-semibold uppercase">Google account</h3></div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">Link Google for sign-in and Drive Picker/import/refresh/export. Exepts requests only profile identity and Drive files you choose or create.</p>
              </div>
              <span className="rounded border px-2 py-1 text-[9px] font-mono font-bold uppercase">{googleStatus?.connected ? "Connected" : "Not connected"}</span>
            </div>
            {googleStatus?.connected && <p className="text-xs"><strong>{googleStatus.email}</strong><br /><span className="text-zinc-500">Password login remains active.</span></p>}
            {googleStatus?.revocationState === "provider_revocation_failed" && <p className="text-xs text-amber-800">Exepts disconnected the account locally, but Google could not confirm provider revocation. Review access in your Google Account.</p>}
            {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
            {googleStatus?.connected
              ? <button onClick={() => void disconnectGoogle()} disabled={busy} className="rounded border border-zinc-300 px-4 py-2 text-[10px] font-mono font-bold uppercase disabled:opacity-50">{busy ? "Disconnecting..." : "Disconnect Google"}</button>
              : <button onClick={() => void connectGoogle()} disabled={busy} className="rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:opacity-50">{busy ? "Connecting..." : "Link Google account"}</button>}
          </section>
        )}
      </div>
    </div>
  );
}
