import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Case, WorkspacePageContext } from "../types";
import MatterOverview from "./MatterOverview";
import MatterSources from "./MatterSources";
import DraftEditorView from "./DraftEditorView";
import MatterIntelligence from "./MatterIntelligence";
import MatterCollaboration from "./MatterCollaboration";
import { useWorkspacePageContext } from "../lib/WorkspacePageContextProvider";

const tabs = ["Overview", "Matter Intelligence", "Sources", "Work Product", "Collaboration"] as const;

const MATTER_SECTION_DESCRIPTIONS: Record<(typeof tabs)[number], string> = {
  Overview: "Shows and edits the Matter's assignment, client, practice area, jurisdiction, objectives, and status.",
  "Matter Intelligence": "Generates and edits a source-backed working analysis from the current Matter's authorized Sources.",
  Sources: "Manages notes, direct Matter uploads, and Firm Library documents explicitly linked to this Matter.",
  "Work Product": "Creates, edits, shares, and exports documents belonging to this Matter.",
  Collaboration: "Manages the Matter's client collaborator, shared Work Product, requests, and responses.",
};

function visibleActionsForTab(tab: (typeof tabs)[number]): NonNullable<WorkspacePageContext["visibleActions"]> {
  if (tab === "Overview") return [
    { id: "edit-matter-overview", label: "Edit Overview", description: "Enables editing of the Matter name, client, jurisdiction, objectives, and status." },
    { id: "save-matter-overview", label: "Save", description: "Saves the edited Matter overview to this Matter." },
  ];
  if (tab === "Matter Intelligence") return [
    { id: "generate-matter-intelligence", label: "Generate Matter Intelligence", description: "Builds a source-backed working analysis from this Matter's current Sources." },
    { id: "regenerate-matter-intelligence", label: "Regenerate", description: "Rebuilds Matter Intelligence from the latest authorized Matter Sources." },
    { id: "edit-matter-intelligence", label: "Edit", description: "Opens Matter Intelligence for rich-text editing without changing the underlying Sources." },
    { id: "export-matter-intelligence", label: "Export .docx", description: "Downloads the current Matter Intelligence as a real Word document." },
  ];
  if (tab === "Sources") return [
    { id: "add-matter-source", label: "Add Source", description: "Adds a note, uploaded file, or authorized Firm Library link to this Matter only." },
    { id: "preview-matter-source", label: "Preview", description: "Opens the selected Matter Source in a read-only preview." },
    { id: "remove-matter-source", label: "Remove", description: "Removes a direct Matter Source or unlinks a Firm Library document after confirmation." },
  ];
  if (tab === "Work Product") return [
    { id: "new-work-product", label: "New", description: "Creates a blank editable Work Product document in this Matter." },
    { id: "share-with-client", label: "Share with client", description: "Makes the selected Matter Work Product available through this Matter's client workspace; it can be stopped later." },
    { id: "save-work-product", label: "Save", description: "Saves edits to the selected Matter Work Product." },
    { id: "export-work-product", label: "Export .docx", description: "Downloads the selected Matter Work Product as a real Word document." },
  ];
  return [
    { id: "generate-client-token", label: "Generate Token", description: "Creates or rotates the secure token for this Matter's single client collaborator." },
    { id: "send-client-request", label: "Send Request", description: "Sends the selected shared Work Product and request type to this Matter's client collaborator." },
    { id: "revoke-client-access", label: "Revoke Access", description: "Revokes the client's access to this Matter collaboration workspace." },
  ];
}

export default function MatterWorkspaceView({
  matterId,
  onBack,
  onMatterChange,
  initialDraftId,
  onClearInitialDraftId,
}: {
  matterId: string;
  onBack: () => void;
  onMatterChange: (matter: Case) => void;
  initialDraftId: string | null;
  onClearInitialDraftId: () => void;
}) {
  const { publishPageContext } = useWorkspacePageContext();
  const [matter, setMatter] = useState<Case | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>("Overview");
  const [unread, setUnread] = useState(0);
  const [collaborationDraftId, setCollaborationDraftId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<WorkspacePageContext["selectedItem"]>();

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

  useEffect(() => {
    setSelectedItem(undefined);
  }, [matterId, tab]);

  useEffect(() => {
    if (!matter) return;
    publishPageContext({
      routeKind: "matter",
      pageTitle: matter.name,
      pageDescription: "An individual Matter workspace whose tabs organize overview details, Sources, Matter Intelligence, Work Product, and client Collaboration.",
      activeSection: tab,
      visibleSections: [{
        id: tab.toLowerCase().replace(/\s+/g, "-"),
        title: tab,
        description: MATTER_SECTION_DESCRIPTIONS[tab],
      }],
      matter: {
        id: matter.id,
        name: matter.name,
        clientName: matter.client_name || null,
        status: matter.status || null,
      },
      selectedItem,
      visibleActions: visibleActionsForTab(tab),
    });
  }, [matter, publishPageContext, selectedItem, tab]);

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
        {tab === "Sources" && <MatterSources matterId={matter.id} onSelectedItemChange={setSelectedItem} />}
        {tab === "Matter Intelligence" && <MatterIntelligence matterId={matter.id} matterName={matter.name} />}
        {tab === "Work Product" && (
          <DraftEditorView
            caseId={matter.id}
            initialDraftId={initialDraftId || collaborationDraftId}
            onClearInitialDraftId={clearDraftNavigation}
            onSelectedItemChange={setSelectedItem}
          />
        )}
        {tab === "Collaboration" && (
          <MatterCollaboration matter={matter} onUnreadChange={setUnread} onOpenWorkProduct={openWorkProduct} />
        )}
      </main>
    </div>
  );
}
