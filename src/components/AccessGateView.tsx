import React, { useEffect, useState } from "react";
import { Account } from "../types";

interface AccessGateViewProps {
  account: Account;
  onAccountChange: (account: Account) => void;
  onLogout: () => void;
}

export default function AccessGateView({
  account,
  onAccountChange,
  onLogout,
}: AccessGateViewProps) {
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const denied = account.user.platform_access_status === "denied";

  useEffect(() => {
    if (retryAfterSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setRetryAfterSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAfterSeconds > 0]);

  const checkStatus = async () => {
    setChecking(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to check your approval status.");
      const nextAccount = (await response.json()) as Account;
      onAccountChange(nextAccount);
      if (nextAccount.user.platform_access_status === "pending") {
        setMessage("Your access request is still awaiting review.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to check your approval status.");
    } finally {
      setChecking(false);
    }
  };

  const resend = async () => {
    setResending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/access/request-review", { method: "POST" });
      const data = (await response.json()) as {
        error?: string;
        retryAfterSeconds?: number;
      };
      if (!response.ok) {
        if (response.status === 429) {
          const seconds = Number(data.retryAfterSeconds || response.headers.get("Retry-After") || 0);
          setRetryAfterSeconds(seconds);
        }
        throw new Error(data.error || "Unable to resend the review request.");
      }
      setRetryAfterSeconds(5 * 60);
      setMessage("A fresh review request was sent to the Exepts review team.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to resend the review request.");
    } finally {
      setResending(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-12 text-zinc-950">
      <section className="w-full max-w-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Exepts access
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          {denied ? "Access not approved" : "Your access request is under review"}
        </h1>
        <p className="mt-4 text-sm leading-6 text-zinc-600">
          {denied
            ? "We are unable to approve your Exepts access request at this time."
            : "Your request has been submitted. We’ll email you once access to Exepts has been approved."}
        </p>
        <div className="mt-6 border border-zinc-200 bg-zinc-50 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Authenticated email</p>
          <p className="mt-1 text-sm font-medium">{account.user.email}</p>
        </div>
        {message && <p className="mt-4 text-sm text-zinc-700" role="status">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
        {retryAfterSeconds > 0 && !denied && (
          <p className="mt-2 text-xs text-zinc-500">
            Resend is available after the cooldown (about {Math.ceil(retryAfterSeconds / 60)} minutes).
          </p>
        )}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {!denied && (
            <>
              <button
                type="button"
                onClick={() => void checkStatus()}
                disabled={checking || resending}
                className="border border-zinc-950 bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {checking ? "Checking..." : "Check approval status"}
              </button>
              <button
                type="button"
                onClick={() => void resend()}
                disabled={checking || resending || retryAfterSeconds > 0}
                className="border border-zinc-300 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
              >
                {resending ? "Resending..." : "Resend review request"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onLogout}
            disabled={checking || resending}
            className="border border-zinc-300 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
          >
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
