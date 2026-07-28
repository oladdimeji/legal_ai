import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Firm, FirmMembership, User } from "../types";

interface AuthViewProps {
  mode: "login" | "signup";
  onAuthenticated: (account: { user: User; firm: Firm; membership: FirmMembership }) => void;
  googleAccountEnabled: boolean;
}

export default function AuthView({ mode, onAuthenticated, googleAccountEnabled }: AuthViewProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (mode !== "login") return;
    const result = new URLSearchParams(window.location.search).get("google");
    const messages: Record<string, string> = {
      not_linked: "That Google account is not linked. Log in with your password, then link it in Settings.",
      email_unverified: "Google did not confirm a verified email for this account.",
      cancelled: "Google sign-in was cancelled.",
      invalid_state: "Google sign-in expired or could not be validated. Please try again.",
      invalid_callback: "Google sign-in callback validation failed.",
      callback_failed: "Google sign-in could not be completed.",
    };
    if (result && messages[result]) setError(messages[result]);
  }, [mode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "signup" ? { name, email, password } : { email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Authentication failed.");
      onAuthenticated(data);
    } catch (err: any) {
      setError(err.message || "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const signInWithGoogle = async () => {
    setError("");
    try {
      const response = await fetch("/api/auth/google/start");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Google sign-in could not be started.");
      window.location.assign(data.authorizationUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in could not be started.");
    }
  };

  return (
    <div className="w-full bg-white text-zinc-900 flex items-center justify-center p-6 py-16">
      <div className="w-full max-w-md border border-zinc-200 rounded-lg bg-white shadow-sm overflow-hidden">
        <div className="px-8 py-7 border-b border-zinc-200 bg-zinc-50">
          <div>
            <h1 className="text-sm font-semibold uppercase tracking-tight">Exepts</h1>
            <p className="text-[10px] font-mono uppercase text-zinc-500 mt-0.5">Private legal workspace</p>
          </div>
        </div>

        <form onSubmit={submit} className="p-8 space-y-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {mode === "login" ? "Log in" : "Create your workspace"}
            </h2>
            <p className="text-xs text-zinc-500 mt-1.5">
              {mode === "login"
                ? "Access your matters, library, conversations, and work product."
                : "A separate empty workspace will be created for your account."}
            </p>
          </div>

          {mode === "signup" && (
            <label className="block space-y-1.5">
              <span className="text-[10px] font-mono font-semibold uppercase text-zinc-500">Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
                className="w-full border border-zinc-300 rounded px-3 py-2.5 text-sm outline-none focus:border-zinc-900"
              />
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-[10px] font-mono font-semibold uppercase text-zinc-500">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              className="w-full border border-zinc-300 rounded px-3 py-2.5 text-sm outline-none focus:border-zinc-900"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[10px] font-mono font-semibold uppercase text-zinc-500">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              required
              className="w-full border border-zinc-300 rounded px-3 py-2.5 text-sm outline-none focus:border-zinc-900"
            />
          </label>

          {error && (
            <div className="border border-zinc-300 bg-zinc-50 rounded px-3 py-2.5 text-xs text-zinc-800" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-zinc-950 text-white rounded px-4 py-2.5 text-xs font-mono uppercase font-semibold hover:bg-zinc-800 disabled:opacity-50"
          >
            {submitting ? "Please wait..." : mode === "login" ? "Log in" : "Sign up"}
          </button>

          {mode === "login" && googleAccountEnabled && (
            <>
              <div className="flex items-center gap-3 text-[9px] font-mono uppercase text-zinc-400"><span className="h-px flex-1 bg-zinc-200" />Or<span className="h-px flex-1 bg-zinc-200" /></div>
              <button type="button" onClick={() => void signInWithGoogle()} className="w-full rounded border border-zinc-300 bg-white px-4 py-2.5 text-xs font-mono font-semibold uppercase hover:border-zinc-900">
                Continue with linked Google account
              </button>
              <p className="text-[10px] leading-relaxed text-zinc-500">Google sign-in works only after you link the account from Settings. Accounts are never merged by email.</p>
            </>
          )}

          <Link
            to={mode === "login" ? "/signup" : "/login"}
            className="w-full text-xs text-zinc-600 hover:text-zinc-950 underline underline-offset-4"
          >
            {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
          </Link>
        </form>
      </div>
    </div>
  );
}
