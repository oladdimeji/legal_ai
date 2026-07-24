import React, { useState } from "react";
import { Firm, User } from "../types";

interface AuthViewProps {
  onAuthenticated: (account: { user: User; firm: Firm }) => void;
}

export default function AuthView({ onAuthenticated }: AuthViewProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  const switchMode = (nextMode: "login" | "signup") => {
    setMode(nextMode);
    setError("");
    setPassword("");
  };

  return (
    <div className="min-h-screen w-full bg-white text-zinc-900 flex items-center justify-center p-6">
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

          <button
            type="button"
            onClick={() => switchMode(mode === "login" ? "signup" : "login")}
            className="w-full text-xs text-zinc-600 hover:text-zinc-950 underline underline-offset-4"
          >
            {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
