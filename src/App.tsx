import React, { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import AssistantView from "./components/AssistantView";
import FirmLibraryView from "./components/FirmLibraryView";
import MattersView from "./components/MattersView";
import SettingsView from "./components/SettingsView";
import MatterWorkspaceView from "./components/MatterWorkspaceView";
import HistoryView from "./components/HistoryView";
import AuthView from "./components/AuthView";
import { Case, Firm, User } from "./types";
import ClientPortalView from "./components/ClientPortalView";
import {
  disabledPublicBrowserConfig,
  type PublicBrowserConfig,
} from "./lib/publicConfig";

export default function App() {
  const portalToken = window.location.pathname.startsWith("/client/")
    ? decodeURIComponent(window.location.pathname.slice("/client/".length)) : null;
  const [activeTab, setActiveTab] = useState<string>("assistant");
  const [cases, setCases] = useState<Case[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [account, setAccount] = useState<{ user: User; firm: Firm } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [publicConfig, setPublicConfig] = useState<PublicBrowserConfig>(
    disabledPublicBrowserConfig
  );

  // Carries a draft reference when auto-generating and navigating
  const [initialDraftId, setInitialDraftId] = useState<string | null>(null);

  // Dynamic state for active thread in assistant
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  // Dynamic collapsible sidebar state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Unavailable")))
      .then((value: PublicBrowserConfig) => setPublicConfig(value))
      .catch(() => setPublicConfig(disabledPublicBrowserConfig));
  }, []);

  useEffect(() => {
    if (portalToken) { setAuthLoading(false); return; }
    const loadSession = async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) setAccount(await res.json());
      } catch (err) {
        console.error("Error loading session:", err);
      } finally {
        setAuthLoading(false);
      }
    };
    loadSession();
  }, [portalToken]);

  useEffect(() => {
    if (account) fetchCases();
    else setCases([]);
  }, [account]);

  const fetchCases = async () => {
    try {
      const res = await fetch("/api/cases");
      const data = await res.json();
      setCases(data);
    } catch (err) {
      console.error("Error fetching cases list:", err);
    }
  };

  const handleOpenMatter = (matterId: string) => {
    setActiveCaseId(matterId);
    setActiveThreadId(null);
    setActiveTab("matter");
  };

  const handleMatterChange = (matter: Case) => {
    setCases((current) => current.map((item) => item.id === matter.id ? matter : item));
  };

  const handleNavigateToDrafts = (draftId: string) => {
    setInitialDraftId(draftId);
    setActiveTab("matter");
  };

  const handleClearInitialDraftId = () => {
    setInitialDraftId(null);
  };

  const handleStartNewThread = () => {
    setActiveThreadId(null);
    setActiveTab("assistant");
    setIsSidebarCollapsed(false); // Restore sidebar when starting a completely fresh chat
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setAccount(null);
      setActiveCaseId(null);
      setActiveThreadId(null);
      setInitialDraftId(null);
      setActiveTab("assistant");
    }
  };

  if (portalToken) return <ClientPortalView token={portalToken} />;

  if (authLoading) {
    return (
      <div className="h-screen w-screen bg-white flex items-center justify-center text-xs font-mono uppercase text-zinc-500">
        Loading secure workspace...
      </div>
    );
  }

  if (!account) {
    return <AuthView onAuthenticated={setAccount} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-zinc-900 font-sans">
      
      {/* Sidebar Navigation */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        firmName={account.firm.name}
        userName={account.user.name}
        userEmail={account.user.email}
        onLogout={handleLogout}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        onStartNewThread={handleStartNewThread}
      />

      {/* Main View Area */}
      <main className="flex-1 h-full overflow-hidden flex flex-col">
        {activeTab === "assistant" && (
          <AssistantView 
            cases={cases}
            activeCaseId={activeCaseId}
            setActiveCaseId={setActiveCaseId}
            activeThreadId={activeThreadId}
            setActiveThreadId={setActiveThreadId}
            onMessagesChange={() => undefined}
            onNavigateToDrafts={handleNavigateToDrafts}
            featureFlags={publicConfig.features}
          />
        )}

        {activeTab === "matters" && <MattersView matters={cases} onRefresh={fetchCases} onOpenMatter={handleOpenMatter} />}

        {activeTab === "library" && <FirmLibraryView />}

        {activeTab === "matter" && activeCaseId && <MatterWorkspaceView matterId={activeCaseId} onBack={() => setActiveTab("matters")} onMatterChange={handleMatterChange} initialDraftId={initialDraftId} onClearInitialDraftId={handleClearInitialDraftId} />}

        {activeTab === "history" && (
          <HistoryView 
            cases={cases}
            activeThreadId={activeThreadId}
            onSelectThread={(thread) => {
              setActiveCaseId(thread.case_id);
              setActiveThreadId(thread.id);
              setActiveTab("assistant");
            }}
          />
        )}

        {activeTab === "settings" && <SettingsView user={account.user} onLogout={handleLogout} />}
      </main>
    </div>
  );
}
