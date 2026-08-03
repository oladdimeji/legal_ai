import React, { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Account } from "../types";
import {
  ASSISTANT_PANEL_STORAGE_KEY,
  DEFAULT_ASSISTANT_PANEL_WIDTH,
  MAX_ASSISTANT_PANEL_WIDTH,
  MIN_ASSISTANT_PANEL_WIDTH,
  clampAssistantPanelWidth,
  readAssistantPanelWidth,
} from "../lib/assistantPanelWidth";

export const LAWYER_TOP_NAVIGATION = [
  { id: "matters", label: "Matters", path: "/matters" },
  { id: "library", label: "Firm Library", path: "/library" },
  { id: "history", label: "History", path: "/history" },
  { id: "settings", label: "Settings", path: "/settings" },
] as const;

interface LawyerWorkspaceShellProps {
  account: Account;
  activeNavigation: "matters" | "library" | "history" | "settings" | null;
  assistantContextLabel: string;
  assistant: React.ReactNode;
  children: React.ReactNode;
  navigate: (path: string) => void;
  onStartNewConversation: () => void;
}

export default function LawyerWorkspaceShell({
  account,
  activeNavigation,
  assistantContextLabel,
  assistant,
  children,
  navigate,
  onStartNewConversation,
}: LawyerWorkspaceShellProps) {
  const [panelWidth, setPanelWidth] = useState(() =>
    readAssistantPanelWidth(window.innerWidth)
  );
  const resizeStartRef = useRef<{ clientX: number; width: number } | null>(null);

  const updateWidth = (nextWidth: number) => {
    const clamped = clampAssistantPanelWidth(nextWidth, window.innerWidth);
    setPanelWidth(clamped);
    try {
      window.localStorage.setItem(ASSISTANT_PANEL_STORAGE_KEY, String(clamped));
    } catch {
      // The panel remains resizable even when storage is unavailable.
    }
  };

  useEffect(() => {
    const handleWindowResize = () => {
      setPanelWidth((current) => clampAssistantPanelWidth(current, window.innerWidth));
    };
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeStartRef.current) return;
      updateWidth(
        resizeStartRef.current.width + event.clientX - resizeStartRef.current.clientX
      );
    };
    const handlePointerUp = () => {
      resizeStartRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  });

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white font-sans text-zinc-900">
      <aside
        className="flex h-full min-w-0 shrink-0 flex-col bg-white"
        style={{ width: panelWidth }}
        aria-label="Exepts assistant panel"
        data-panel-width={panelWidth}
      >
        <header className="shrink-0 border-b border-zinc-200 px-4 py-3">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold uppercase tracking-tight">Exepts</p>
              <p className="truncate font-mono text-[10px] text-zinc-500">
                {account.firm?.name}
              </p>
            </div>
            <button
              type="button"
              onClick={onStartNewConversation}
              className="inline-flex shrink-0 items-center gap-1.5 rounded border border-zinc-300 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase text-zinc-700 hover:border-zinc-950 hover:text-zinc-950"
              title="Start a new conversation in the current context"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New conversation</span>
            </button>
          </div>
          <div
            className="mt-2 truncate rounded bg-zinc-100 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-600"
            title={assistantContextLabel}
            aria-label={`Assistant context: ${assistantContextLabel}`}
          >
            Context · {assistantContextLabel}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">{assistant}</div>

      </aside>

      <div
        role="separator"
        aria-label="Resize assistant panel"
        aria-orientation="vertical"
        aria-valuemin={MIN_ASSISTANT_PANEL_WIDTH}
        aria-valuemax={MAX_ASSISTANT_PANEL_WIDTH}
        aria-valuenow={panelWidth}
        tabIndex={0}
        onPointerDown={(event) => {
          resizeStartRef.current = { clientX: event.clientX, width: panelWidth };
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          if (event.key === "Home") updateWidth(MIN_ASSISTANT_PANEL_WIDTH);
          else if (event.key === "End") updateWidth(MAX_ASSISTANT_PANEL_WIDTH);
          else updateWidth(panelWidth + (event.key === "ArrowRight" ? 16 : -16));
        }}
        onDoubleClick={() => updateWidth(DEFAULT_ASSISTANT_PANEL_WIDTH)}
        className="group relative z-30 w-1.5 shrink-0 cursor-col-resize bg-zinc-100 outline-none hover:bg-zinc-300 focus:bg-zinc-400"
      >
        <span className="sr-only">Use the arrow keys to resize the assistant panel.</span>
      </div>

      <section className="flex h-full min-w-[320px] flex-1 flex-col overflow-hidden">
        <nav
          className="flex h-14 shrink-0 items-end gap-1 border-b border-zinc-200 bg-white px-6"
          aria-label="Lawyer workspace"
        >
          {LAWYER_TOP_NAVIGATION.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.path)}
              className={`h-full border-b-2 px-4 text-xs font-semibold uppercase tracking-wide transition-colors ${
                activeNavigation === item.id
                  ? "border-zinc-950 text-zinc-950"
                  : "border-transparent text-zinc-500 hover:text-zinc-900"
              }`}
              aria-current={activeNavigation === item.id ? "page" : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </section>
    </div>
  );
}
