import React from "react";
import { LogOut } from "lucide-react";
import { Account } from "../types";

export default function ClientSettingsView({
  account,
  onLogout,
}: {
  account: Account;
  onLogout: () => void;
}) {
  return (
    <div className="h-full flex-1 overflow-y-auto bg-white">
      <header className="border-b border-zinc-200 bg-zinc-50/50 px-6 py-6 sm:px-8">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-xs text-zinc-500">Your Client Workspace account.</p>
      </header>
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-8">
        <section className="overflow-hidden rounded border border-zinc-200">
          {[
            ["Name", account.user.name || "Not provided"],
            ["Email", account.user.email],
            ["Account type", "Client"],
          ].map(([label, value]) => (
            <div
              key={label}
              className="grid gap-1 border-b border-zinc-100 px-5 py-4 last:border-b-0 sm:grid-cols-[10rem_1fr]"
            >
              <span className="text-[10px] font-mono font-semibold uppercase text-zinc-400">
                {label}
              </span>
              <span className="text-sm text-zinc-800">{value}</span>
            </div>
          ))}
        </section>
        <button
          type="button"
          onClick={onLogout}
          className="mt-6 flex items-center gap-2 rounded border border-zinc-300 px-4 py-2.5 text-xs font-semibold hover:border-zinc-950 hover:bg-zinc-50"
        >
          <LogOut className="h-4 w-4" /> Log out
        </button>
      </div>
    </div>
  );
}
