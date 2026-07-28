import React, { useEffect, useState } from "react";
import { Archive, ArrowLeft, Download, RotateCcw } from "lucide-react";
import { Case } from "../types";
import MatterOverview from "./MatterOverview";
import MatterSources from "./MatterSources";
import DraftEditorView from "./DraftEditorView";
import MatterIntelligence from "./MatterIntelligence";
import MatterCollaboration from "./MatterCollaboration";

const tabs = ["Overview", "Matter Intelligence", "Sources", "Work Product", "Collaboration"] as const;

export default function MatterWorkspaceView({
  matterId,
  onBack,
  onMatterChange,
  initialDraftId,
  onClearInitialDraftId,
  googleDriveExportEnabled,
  googleDriveImportEnabled,
  clientAccountsEnabled,
  resourceLifecycleEnabled,
}: {
  matterId: string;
  onBack: () => void;
  onMatterChange: (matter: Case) => void;
  initialDraftId: string | null;
  onClearInitialDraftId: () => void;
  googleDriveExportEnabled: boolean;
  googleDriveImportEnabled: boolean;
  clientAccountsEnabled: boolean;
  resourceLifecycleEnabled: boolean;
}) {
  const [matter, setMatter] = useState<Case | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>("Overview");
  const [unread, setUnread] = useState(0);
  const [collaborationDraftId, setCollaborationDraftId] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/cases/${matterId}`).then(async (response) => {
      if (response.ok) setMatter(await response.json());
    });
  }, [matterId]);

  useEffect(() => {
    void fetch(`/api/cases/${matterId}/collaboration`).then(async (response) => {
      if (response.ok) setUnread((await response.json()).unread || 0);
    });
  }, [matterId]);

  useEffect(() => {
    if (initialDraftId) setTab("Work Product");
  }, [initialDraftId]);

  if (!matter) {
    return <div className="flex h-full items-center justify-center text-xs font-mono uppercase text-zinc-500">Loading Matter...</div>;
  }

  const update = (next: Case) => {
    setMatter(next);
    onMatterChange(next);
  };

  const openWorkProduct = (draftId: string) => {
    setCollaborationDraftId(draftId);
    setTab("Work Product");
  };

  const clearDraftNavigation = () => {
    setCollaborationDraftId(null);
    onClearInitialDraftId();
  };

  const setLifecycle = async (action: "archive" | "restore") => {
    const response = await fetch(`/api/cases/${matter.id}/${action}`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) return alert(data.error || `Matter could not be ${action}d`);
    update(data);
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="border-b px-8 py-5">
        <button onClick={onBack} className="mb-3 flex items-center gap-1 text-[9px] font-mono uppercase text-zinc-500">
          <ArrowLeft className="h-3 w-3" />All Matters
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">{matter.name}</h2>
            <p className="mt-1 text-[10px] font-mono uppercase text-zinc-400">{matter.client_name || "No client specified"} · {matter.status || "Open"}</p>
          </div>
          {resourceLifecycleEnabled && <div className="flex items-center gap-2">
            <button onClick={() => window.open(`/api/cases/${matter.id}/export-package`, "_blank")} className="inline-flex items-center gap-1 rounded border px-3 py-2 text-[9px] font-mono font-bold uppercase"><Download className="h-3.5 w-3.5" />Export package</button>
            {matter.lifecycle_state === "archived"
              ? <button onClick={() => void setLifecycle("restore")} className="inline-flex items-center gap-1 rounded border px-3 py-2 text-[9px] font-mono font-bold uppercase"><RotateCcw className="h-3.5 w-3.5" />Restore</button>
              : <button onClick={() => void setLifecycle("archive")} className="inline-flex items-center gap-1 rounded border px-3 py-2 text-[9px] font-mono font-bold uppercase"><Archive className="h-3.5 w-3.5" />Archive</button>}
          </div>}
        </div>
      </header>
      <nav className="flex gap-1 border-b px-8">
        {tabs.map((item) => (
          <button key={item} onClick={() => setTab(item)} className={`border-b-2 px-4 py-3 text-[10px] font-mono font-bold uppercase ${tab === item ? "border-zinc-950 text-zinc-950" : "border-transparent text-zinc-400"}`}>
            {item}
            {item === "Collaboration" && unread > 0 && <span className="ml-1 rounded-full bg-zinc-950 px-1.5 py-0.5 text-[8px] text-white">{unread}</span>}
          </button>
        ))}
      </nav>
      <main className={`flex-1 overflow-hidden ${tab === "Work Product" ? "p-0" : "overflow-y-auto p-8"}`}>
        {tab === "Overview" && <MatterOverview matter={matter} onChange={update} />}
        {tab === "Sources" && <MatterSources matterId={matter.id} googleDriveImportEnabled={googleDriveImportEnabled} resourceLifecycleEnabled={resourceLifecycleEnabled} />}
        {tab === "Matter Intelligence" && <MatterIntelligence matterId={matter.id} googleDriveExportEnabled={googleDriveExportEnabled} />}
        {tab === "Work Product" && (
          <DraftEditorView
            caseId={matter.id}
            initialDraftId={initialDraftId || collaborationDraftId}
            onClearInitialDraftId={clearDraftNavigation}
            googleDriveExportEnabled={googleDriveExportEnabled}
            resourceLifecycleEnabled={resourceLifecycleEnabled}
          />
        )}
        {tab === "Collaboration" && (
          <MatterCollaboration matter={matter} onUnreadChange={setUnread} onOpenWorkProduct={openWorkProduct} clientAccountsEnabled={clientAccountsEnabled} />
        )}
      </main>
    </div>
  );
}
