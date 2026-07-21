import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Case } from "../types";
import MatterOverview from "./MatterOverview";
import MatterSources from "./MatterSources";
import DraftEditorView from "./DraftEditorView";
import MatterIntelligence from "./MatterIntelligence";

const tabs = ["Overview", "Matter Intelligence", "Sources", "Work Product", "Collaboration"] as const;
export default function MatterWorkspaceView({ matterId, onBack, onMatterChange, initialDraftId, onClearInitialDraftId }: { matterId: string; onBack: () => void; onMatterChange: (matter: Case) => void; initialDraftId: string | null; onClearInitialDraftId: () => void }) {
  const [matter, setMatter] = useState<Case | null>(null), [tab, setTab] = useState<(typeof tabs)[number]>("Overview");
  useEffect(() => { void fetch(`/api/cases/${matterId}`).then(async (r) => { if (r.ok) setMatter(await r.json()); }); }, [matterId]);
  useEffect(() => { if (initialDraftId) setTab("Work Product"); }, [initialDraftId]);
  if (!matter) return <div className="flex h-full items-center justify-center text-xs font-mono uppercase text-zinc-500">Loading Matter…</div>;
  const update = (next: Case) => { setMatter(next); onMatterChange(next); };
  return <div className="flex h-full flex-col bg-white"><header className="border-b px-8 py-5"><button onClick={onBack} className="mb-3 flex items-center gap-1 text-[9px] font-mono uppercase text-zinc-500"><ArrowLeft className="h-3 w-3" />All Matters</button><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">{matter.name}</h2><p className="mt-1 text-[10px] font-mono uppercase text-zinc-400">{matter.client_name || "No client specified"} · {matter.status || "Open"}</p></div></div></header><nav className="flex gap-1 border-b px-8">{tabs.map((item) => <button key={item} onClick={() => setTab(item)} className={`border-b-2 px-4 py-3 text-[10px] font-mono font-bold uppercase ${tab === item ? "border-zinc-950 text-zinc-950" : "border-transparent text-zinc-400"}`}>{item}</button>)}</nav><main className={`flex-1 overflow-hidden ${tab === "Work Product" ? "p-0" : "overflow-y-auto p-8"}`}>{tab === "Overview" && <MatterOverview matter={matter} onChange={update} />}{tab === "Sources" && <MatterSources matterId={matter.id} />}{tab === "Matter Intelligence" && <MatterIntelligence matterId={matter.id} />}{tab === "Work Product" && <DraftEditorView caseId={matter.id} initialDraftId={initialDraftId} onClearInitialDraftId={onClearInitialDraftId} />}{tab === "Collaboration" && <Placeholder title="Collaboration" text="Client collaboration is introduced in Phase 8." />}</main></div>;
}
function Placeholder({ title, text }: { title: string; text: string }) { return <div className="rounded border border-dashed p-12 text-center"><h3 className="text-sm font-semibold uppercase">{title}</h3><p className="mt-2 text-xs text-zinc-500">{text}</p></div>; }
