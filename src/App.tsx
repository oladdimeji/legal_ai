import React, { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import AssistantView from "./components/AssistantView";
import WorkspaceView from "./components/WorkspaceView";
import DraftEditorView from "./components/DraftEditorView";
import HistoryView from "./components/HistoryView";
import AuthView from "./components/AuthView";
import { Case, Firm, User } from "./types";

export default function App() {
  const [activeTab, setActiveTab] = useState<string>("assistant");
  const [cases, setCases] = useState<Case[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [account, setAccount] = useState<{ user: User; firm: Firm } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Carries a draft reference when auto-generating and navigating
  const [initialDraftId, setInitialDraftId] = useState<string | null>(null);

  // Dynamic state for active thread in assistant
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  // Dynamic collapsible sidebar state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
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
  }, []);

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

  const handleNavigateToDrafts = (draftId: string) => {
    setInitialDraftId(draftId);
    setActiveTab("drafts");
  };

  const handleClearInitialDraftId = () => {
    setInitialDraftId(null);
  };

  const handleStartNewThread = () => {
    setActiveThreadId(null);
    setActiveTab("assistant");
    setIsSidebarCollapsed(false); // Restore sidebar when starting a completely fresh chat
  };

  const handleMessagesChange = (count: number) => {
    if (count > 0 && activeTab === "assistant") {
      setIsSidebarCollapsed(true); // Auto-collapse once a conversation has started
    }
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
            onMessagesChange={handleMessagesChange}
            onNavigateToDrafts={handleNavigateToDrafts}
          />
        )}

        {activeTab === "workspace" && (
          <WorkspaceView 
            cases={cases}
            activeCaseId={activeCaseId}
            setActiveCaseId={setActiveCaseId}
            onRefreshCases={fetchCases}
          />
        )}

        {activeTab === "drafts" && (
          <DraftEditorView 
            initialDraftId={initialDraftId}
            onClearInitialDraftId={handleClearInitialDraftId}
            caseId={activeCaseId}
          />
        )}

        {activeTab === "history" && (
          <HistoryView 
            cases={cases}
            activeThreadId={activeThreadId}
            onSelectThread={(threadId) => {
              setActiveThreadId(threadId);
              setActiveTab("assistant");
              setIsSidebarCollapsed(true);
            }}
          />
        )}
      </main>
    </div>
  );
}
