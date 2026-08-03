import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Account } from "../types";

interface AuthViewProps {
  returnTo: string;
  accountMode?: "lawyer" | "client";
  initialError?: string;
  onAuthenticated: (account: Account, redirectTo: string) => void;
  onBack: () => void;
}

interface ApiError {
  error?: string;
  retryAfterSeconds?: number;
}

export default function AuthView({
  returnTo,
  accountMode = "lawyer",
  initialError = "",
  onAuthenticated,
  onBack,
}: AuthViewProps) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const requestCode = async () => {
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/email/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, accountType: accountMode }),
      });
      const data = (await response.json()) as ApiError;
      if (!response.ok) {
        if (data.retryAfterSeconds) setCooldown(data.retryAfterSeconds);
        throw new Error(data.error || "Unable to send a verification code.");
      }
      setStep("code");
      setCooldown(data.retryAfterSeconds || 60);
      setCode("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send a verification code.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    await requestCode();
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/email/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, returnTo }),
      });
      const data = (await response.json()) as {
        account?: Account;
        redirectTo?: string;
        error?: string;
      };
      if (!response.ok || !data.account) {
        throw new Error(data.error || "Unable to verify the code.");
      }
      onAuthenticated(data.account, data.redirectTo || "/matters");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to verify the code.");
    } finally {
      setSubmitting(false);
    }
  };

  const changeEmail = () => {
    setStep("email");
    setCode("");
    setError("");
  };

  return (
    <div className="min-h-screen w-full bg-zinc-50 px-6 py-10 text-zinc-950">
      <button
        type="button"
        onClick={onBack}
        className="mx-auto flex w-full max-w-md items-center gap-2 text-xs text-zinc-600 hover:text-zinc-950"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Exepts
      </button>
      <div className="mx-auto mt-12 w-full max-w-md overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 bg-zinc-50 px-8 py-7">
          <h1 className="text-sm font-semibold uppercase tracking-tight">Exepts</h1>
          <p className="mt-0.5 text-[10px] font-mono uppercase text-zinc-500">
            Private legal workspace
          </p>
        </div>

        <div className="space-y-6 p-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {accountMode === "client" ? "Access Client Portal" : "Sign in to Exepts"}
            </h2>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              Continue securely with Google or a one-time code sent to your email.
            </p>
          </div>

          <a
            href={`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}&accountType=${accountMode}`}
            className="flex w-full items-center justify-center rounded border border-zinc-300 px-4 py-2.5 text-xs font-semibold hover:border-zinc-950 hover:bg-zinc-50"
          >
            Continue with Google
          </a>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-zinc-200" />
            <span className="text-[10px] font-mono uppercase text-zinc-400">or</span>
            <div className="h-px flex-1 bg-zinc-200" />
          </div>

          {step === "email" ? (
            <form onSubmit={submitEmail} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-[10px] font-mono font-semibold uppercase text-zinc-500">
                  Email
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  autoFocus
                  required
                  placeholder={accountMode === "client" ? "you@example.com" : "you@firm.com"}
                  className="w-full rounded border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-zinc-950"
                />
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded bg-zinc-950 px-4 py-2.5 text-xs font-mono font-semibold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {submitting ? "Sending..." : "Continue with Email"}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-4">
              <div>
                <p className="text-xs font-semibold">Enter the code sent to</p>
                <p className="mt-1 text-xs text-zinc-500">{email}</p>
              </div>
              <label className="block space-y-1.5">
                <span className="text-[10px] font-mono font-semibold uppercase text-zinc-500">
                  Six-digit code
                </span>
                <input
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  autoFocus
                  required
                  className="w-full rounded border border-zinc-300 px-3 py-3 text-center font-mono text-xl tracking-[0.35em] outline-none focus:border-zinc-950"
                />
              </label>
              <button
                type="submit"
                disabled={submitting || code.length !== 6}
                className="w-full rounded bg-zinc-950 px-4 py-2.5 text-xs font-mono font-semibold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {submitting ? "Verifying..." : "Verify and Continue"}
              </button>
              <div className="flex items-center justify-between text-xs">
                <button type="button" onClick={changeEmail} className="text-zinc-600 hover:text-zinc-950">
                  Change email
                </button>
                <button
                  type="button"
                  onClick={requestCode}
                  disabled={submitting || cooldown > 0}
                  className="text-zinc-600 hover:text-zinc-950 disabled:text-zinc-400"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}

          {error && (
            <div
              role="alert"
              className="rounded border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-800"
            >
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
