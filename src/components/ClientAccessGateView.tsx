import React, { FormEvent, useState } from "react";
import { Account } from "../types";

interface ClientAccessGateViewProps {
  account: Account;
  onAccountChange: (account: Account) => void;
  navigate: (path: string, replace?: boolean) => void;
  onLogout: () => void;
}

export default function ClientAccessGateView({
  account,
  onAccountChange,
  navigate,
  onLogout,
}: ClientAccessGateViewProps) {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const redeem = async (event: FormEvent) => {
    event.preventDefault();
    const candidate = token.trim();
    if (!candidate) {
      setError("Enter the collaboration token supplied by your lawyer.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/client/shared-matters/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: candidate }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "The collaboration token could not be redeemed.");
      const accountResponse = await fetch("/api/auth/me", { cache: "no-store" });
      if (!accountResponse.ok) throw new Error("Your Client Workspace access could not be refreshed.");
      const nextAccount = (await accountResponse.json()) as Account;
      if (!nextAccount.user.client_access_granted) {
        throw new Error("Your collaboration is not active. Please contact your lawyer.");
      }
      onAccountChange(nextAccount);
      navigate("/client/shared-matters", true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The collaboration token could not be redeemed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-12 text-zinc-950">
      <section className="w-full max-w-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Client access</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Connect a Shared Matter</h1>
        <p className="mt-4 text-sm leading-6 text-zinc-600">
          A valid collaboration token from your lawyer is required before you can use the Client Workspace.
        </p>
        <p className="mt-3 text-xs text-zinc-500">Signed in as {account.user.email}</p>
        <form className="mt-7" onSubmit={(event) => void redeem(event)}>
          <label htmlFor="collaboration-token" className="text-sm font-medium">Collaboration token</label>
          <input
            id="collaboration-token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={submitting}
            autoComplete="off"
            className="mt-2 w-full border border-zinc-300 px-3 py-3 font-mono text-sm outline-none focus:border-zinc-950"
            placeholder="MAT-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          />
          {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="submit" disabled={submitting} className="bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
              {submitting ? "Connecting..." : "Connect Shared Matter"}
            </button>
            <button type="button" onClick={onLogout} disabled={submitting} className="border border-zinc-300 px-4 py-2.5 text-sm font-medium disabled:opacity-50">
              Sign out
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
