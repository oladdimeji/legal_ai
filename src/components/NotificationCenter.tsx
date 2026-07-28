import React, { useEffect, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { secureFetch } from "../lib/secureFetch";

type Notification = {
  id: string;
  title: string;
  actor_name?: string | null;
  deep_link: string;
  read_at: string | null;
  created_at: string;
};

export default function NotificationCenter({
  enabled,
  onNavigate,
}: {
  enabled: boolean;
  onNavigate: (path: string) => void;
}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const load = async () => {
    if (!enabled) return;
    const response = await fetch("/api/notifications", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    setItems(data.items || []);
    setUnread(data.unread || 0);
  };
  useEffect(() => {
    if (!enabled) return;
    void load();
    const interval = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(interval);
  }, [enabled]);
  if (!enabled) return null;
  const markRead = async (notification: Notification) => {
    if (!notification.read_at) {
      await secureFetch(`/api/notifications/${notification.id}/read`, { method: "PUT" });
    }
    setOpen(false);
    onNavigate(notification.deep_link);
    await load();
  };
  const markAll = async () => {
    await secureFetch("/api/notifications/read-all", { method: "PUT" });
    await load();
  };
  return <div className="absolute right-5 top-4 z-40">
    <button aria-label={`Notifications, ${unread} unread`} onClick={() => setOpen(!open)} className="relative rounded border border-zinc-200 bg-white p-2 shadow-sm hover:border-zinc-500"><Bell className="h-4 w-4" />{unread > 0 && <span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-zinc-950 px-1 text-center text-[9px] font-bold text-white">{unread}</span>}</button>
    {open && <section className="absolute right-0 mt-2 w-80 overflow-hidden rounded border border-zinc-200 bg-white shadow-xl">
      <header className="flex items-center justify-between border-b p-3"><div><h2 className="text-xs font-semibold uppercase">Notifications</h2><p className="text-[9px] font-mono uppercase text-zinc-400">{unread} unread</p></div><button onClick={() => setOpen(false)}><X className="h-4 w-4" /></button></header>
      <div className="max-h-96 overflow-y-auto">{items.length === 0 ? <p className="p-6 text-center text-xs text-zinc-500">No client activity yet.</p> : items.map((notification) => <button key={notification.id} onClick={() => void markRead(notification)} className={`block w-full border-b p-3 text-left hover:bg-zinc-50 ${notification.read_at ? "bg-white" : "bg-zinc-50"}`}><p className="text-xs font-semibold">{notification.title}</p><p className="mt-1 text-[10px] text-zinc-500">{notification.actor_name || "Client activity"} · {new Date(notification.created_at).toLocaleString()}</p></button>)}</div>
      {unread > 0 && <button onClick={() => void markAll()} className="flex w-full items-center justify-center gap-2 border-t p-3 text-[9px] font-mono font-bold uppercase"><CheckCheck className="h-3.5 w-3.5" />Mark all read</button>}
    </section>}
  </div>;
}
