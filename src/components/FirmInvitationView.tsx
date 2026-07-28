import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ErrorState, LoadingState } from "./ui/States";

type Invitation = {
  email: string;
  firmName: string;
  role: string;
  expiresAt: string;
};

export default function FirmInvitationView({
  enabled,
  onAccepted,
}: {
  enabled: boolean;
  onAccepted: (account: any) => void;
}) {
  const { token } = useParams();
  const navigate = useNavigate();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled || !token) {
      setLoading(false);
      return;
    }
    fetch(`/api/team/invitations/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Invitation is unavailable.");
        setInvitation(data);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Invitation is unavailable."))
      .finally(() => setLoading(false));
  }, [enabled, token]);

  if (!enabled) return <ErrorState title="Firm invitations are not enabled" detail="Ask your firm administrator to confirm that team access has been activated." />;
  if (loading) return <LoadingState label="Checking invitation…" />;
  if (!invitation || !token) return <ErrorState title="Invitation unavailable" detail={error || "This invitation is invalid or expired."} />;

  const accept = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/team/invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Invitation could not be accepted.");
      onAccepted(data);
      navigate("/app", { replace: true });
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Invitation could not be accepted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md rounded border border-zinc-200 bg-white p-6">
      <h1 className="text-lg font-bold uppercase">Join {invitation.firmName}</h1>
      <p className="mt-2 text-sm text-zinc-600">
        {invitation.email} has been invited as {invitation.role.replace("_", " ")}.
      </p>
      <form onSubmit={accept} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-[10px] font-mono font-bold uppercase text-zinc-500">Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-[10px] font-mono font-bold uppercase text-zinc-500">Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required minLength={8} className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
        </label>
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        <button disabled={busy} className="w-full rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:opacity-50">
          {busy ? "Joining…" : "Accept invitation"}
        </button>
      </form>
    </div>
  );
}
