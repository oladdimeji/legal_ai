import React from "react";
import { LogOut, Settings } from "lucide-react";
import { User } from "../types";

export default function SettingsView({ user, onLogout }: { user: User; onLogout: () => void }) {
  return <div className="flex-1 h-full overflow-y-auto bg-white p-8"><div className="mx-auto max-w-2xl space-y-6"><header><div className="flex items-center gap-2"><Settings className="h-5 w-5" /><h2 className="text-lg font-bold uppercase">Settings</h2></div><p className="mt-1 text-[11px] font-mono uppercase text-zinc-400">Account details</p></header><div className="space-y-4 rounded border border-zinc-200 p-6"><label className="block"><span className="text-[10px] font-mono font-bold uppercase text-zinc-500">Name</span><input readOnly value={user.name} className="mt-1 w-full rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm" /></label><label className="block"><span className="text-[10px] font-mono font-bold uppercase text-zinc-500">Email</span><input readOnly value={user.email} className="mt-1 w-full rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm" /></label><button onClick={onLogout} className="flex items-center gap-2 rounded border border-zinc-300 px-4 py-2 text-[10px] font-mono font-bold uppercase hover:border-zinc-900"><LogOut className="h-4 w-4" />Log out</button></div></div></div>;
}
