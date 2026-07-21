import React, { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import AssistantView from "./components/AssistantView";
import WorkspaceView from "./components/WorkspaceView";
import DraftEditorView from "./components/DraftEditorView";
import HistoryView from "./components/HistoryView";
import { Case } from "./types";

export default function App() {
  const [activeTab, setActiveTab] = useState<string>("assistant");
  const [cases, setCases] = useState<Case[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  
  // Attaches profile context
  const [firmName, setFirmName] = useState("Sterling & Croft LLP");
  const [userName, setUserName] = useState("Counsel");

  // Carries a draft reference when auto-generating and navigating
  const [initialDraftId, setInitialDraftId] = useState<string | null>(null);

  // Dynamic state for active thread in assistant
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  // Dynamic collapsible sidebar state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    fetchProfile();
    fetchCases();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await fetch("/api/me");
      const data = await res.json();
      if (data.firm) setFirmName(data.firm.name);
      if (data.user) setUserName(data.user.name);
    } catch (err) {
      console.error("Error fetching attorney profile:", err);
    }
  };

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-zinc-900 font-sans">
      
      {/* Sidebar Navigation */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        firmName={firmName}
        userName={userName}
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
