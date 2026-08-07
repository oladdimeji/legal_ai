import React, { useEffect, useState } from "react";

export default function ClientInviteAccessView({
  accessId,
  onRedeemed,
  onCancel,
}: {
  accessId: string;
  onRedeemed?: (account: any, redirectTo?: string) => void;
  onCancel?: () => void;
}) {
  const [preview, setPreview] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/client/access/${encodeURIComponent(accessId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Invitation not found.");
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Invitation could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [accessId]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");
    const candidate = token.trim();
    if (!candidate) return setError("Enter the collaboration token provided by your lawyer.");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/client/access/${encodeURIComponent(accessId)}/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: candidate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Token could not be redeemed.");
      if (onRedeemed) onRedeemed(data.account || null, data.redirectTo || undefined);
      else if (data.redirectTo) window.location.href = data.redirectTo;
      else window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Token could not be redeemed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-lg font-semibold">Shared Matter invitation</h1>
      {loading ? (
        <p className="mt-6 text-xs font-mono uppercase text-zinc-400">Loading invitation…</p>
      ) : error ? (
        <div role="alert" className="mt-6 rounded border border-zinc-300 bg-zinc-50 p-4 text-sm">{error}</div>
      ) : preview ? (
        <div className="mt-4 space-y-4">
          <div className="rounded border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-sm font-semibold">{preview.matter_name || preview.matterName || "Shared Matter"}</p>
            <p className="text-xs text-zinc-500">{preview.firm_name || preview.firmName || preview.firm || "Shared by your lawyer"}</p>
            <p className="mt-2 text-xs text-zinc-500">Invitation for: {preview.client_name || preview.clientName || "Client"}</p>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-xs font-semibold text-zinc-600">Collaboration token</label>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="MAT-...."
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              aria-label="Collaboration token"
            />
            {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={onCancel} className="rounded border px-4 py-2 text-xs">Back</button>
              <button type="submit" disabled={submitting} className="rounded bg-zinc-950 px-4 py-2 text-xs font-semibold text-white">{submitting ? "Joining…" : "Join Matter"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
