import React, { useState } from "react";
import {
  Briefcase,
  History,
  LogOut,
  MessageSquare,
  Settings,
} from "lucide-react";
import { AppRoute } from "../lib/routes";
import { Account } from "../types";
import ClientAssistantView from "./ClientAssistantView";
import ClientHistoryView from "./ClientHistoryView";
import ClientSettingsView from "./ClientSettingsView";
import ClientSharedMattersView from "./ClientSharedMattersView";

interface ClientWorkspaceProps {
  account: Account;
  route: AppRoute;
  navigate: (path: string, replace?: boolean) => void;
  onLogout: () => void;
}

const navItems = [
  { id: "assistant", label: "Assistant", icon: MessageSquare, path: "/client/assistant" },
  {
    id: "shared",
    label: "Shared Matter",
    icon: Briefcase,
    path: "/client/shared-matters",
  },
  { id: "history", label: "History", icon: History, path: "/client/history" },
];

export default function ClientWorkspace({
  account,
  route,
  navigate,
  onLogout,
}: ClientWorkspaceProps) {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const activeNav =
    route.kind === "clientSharedMatters" || route.kind === "clientSharedMatter"
      ? "shared"
      : route.kind === "clientHistory"
        ? "history"
        : route.kind === "clientSettings"
          ? "settings"
          : "assistant";

  const openConversation = (threadId: string) => {
    setActiveConversationId(threadId);
    navigate("/client/assistant");
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white font-sans text-zinc-900">
      <aside className="flex w-20 shrink-0 flex-col border-r border-zinc-200 bg-white sm:w-60">
        <div className="border-b border-zinc-200 px-3 py-5 sm:px-5">
          <p className="text-center text-sm font-semibold uppercase tracking-tight sm:text-left">
            Exepts
          </p>
          <p className="mt-1 hidden text-[9px] font-mono uppercase text-zinc-400 sm:block">
            Client Workspace
          </p>
        </div>
        <nav className="flex-1 space-y-1.5 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  if (item.id === "assistant") setActiveConversationId(null);
                  navigate(item.path);
                }}
                title={item.label}
                className={`flex w-full items-center justify-center rounded px-3 py-3 text-xs font-medium uppercase sm:justify-start sm:gap-3 ${
                  activeNav === item.id
                    ? "bg-zinc-100 text-zinc-950"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="border-t border-zinc-200 p-3 sm:p-4">
          <div className="hidden min-w-0 px-2 sm:block">
            <p className="truncate text-xs font-semibold">
              {account.user.name || "Client"}
            </p>
            <p className="mt-0.5 truncate text-[9px] font-mono text-zinc-400">
              {account.user.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title="Log out"
            aria-label="Log out"
            className="mt-2 flex w-full items-center justify-center rounded p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 sm:justify-start sm:gap-2"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden text-[10px] font-mono uppercase sm:inline">Log out</span>
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {route.kind === "clientSharedMatters" ? (
          <ClientSharedMattersView
            onOpenMatter={(id) =>
              navigate(`/client/shared-matters/${encodeURIComponent(id)}`)
            }
            onBack={() => navigate("/client/shared-matters")}
          />
        ) : route.kind === "clientSharedMatter" ? (
          <ClientSharedMattersView
            accessId={route.accessId}
            onOpenMatter={(id) =>
              navigate(`/client/shared-matters/${encodeURIComponent(id)}`)
            }
            onBack={() => navigate("/client/shared-matters")}
          />
        ) : route.kind === "clientHistory" ? (
          <ClientHistoryView onOpen={openConversation} />
        ) : route.kind === "clientSettings" ? (
          <ClientSettingsView account={account} onLogout={onLogout} />
        ) : (
          <ClientAssistantView
            activeConversationId={activeConversationId}
            onConversationChange={setActiveConversationId}
          />
        )}
      </main>
    </div>
  );
}
