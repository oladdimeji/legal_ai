import React, { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import AssistantView from "./components/AssistantView";
import AuthView from "./components/AuthView";
import ClientPortalView from "./components/ClientPortalView";
import FirmLibraryView from "./components/FirmLibraryView";
import FirmInvitationView from "./components/FirmInvitationView";
import HistoryView from "./components/HistoryView";
import ClientLayout from "./components/layouts/ClientLayout";
import PublicLayout from "./components/layouts/PublicLayout";
import MatterWorkspaceView from "./components/MatterWorkspaceView";
import MattersView from "./components/MattersView";
import PublicLandingPage from "./components/PublicLandingPage";
import SettingsView from "./components/SettingsView";
import Sidebar from "./components/Sidebar";
import { EmptyState, ErrorState, LoadingState } from "./components/ui/States";
import { disabledPublicBrowserConfig, type PublicBrowserConfig } from "./lib/publicConfig";
import { Case, Firm, FirmMembership, User } from "./types";

type Account = { user: User; firm: Firm; membership: FirmMembership };

function ClientAccountUnavailable() {
  return <div className="mx-auto max-w-lg p-6 pt-20"><EmptyState title="Client accounts are not available yet" detail="Use the secure invitation link supplied by your lawyer. Existing invitation links continue to work." /></div>;
}

export default function App() {
  const [cases, setCases] = useState<Case[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [publicConfig, setPublicConfig] = useState<PublicBrowserConfig>(disabledPublicBrowserConfig);

  useEffect(() => {
    fetch("/api/config").then((response) => response.ok ? response.json() : Promise.reject()).then(setPublicConfig).catch(() => setPublicConfig(disabledPublicBrowserConfig));
    fetch("/api/auth/me").then(async (response) => {
      if (response.ok) setAccount(await response.json());
    }).catch(() => undefined).finally(() => setAuthLoading(false));
  }, []);

  const fetchCases = async () => {
    const response = await fetch("/api/cases");
    if (response.ok) setCases(await response.json());
  };

  useEffect(() => {
    if (account) void fetchCases();
    else setCases([]);
  }, [account]);

  const logout = async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally { setAccount(null); setCases([]); }
  };

  if (authLoading) return <div className="min-h-screen bg-white"><LoadingState label="Loading secure workspace…" /></div>;

  return <Routes>
    <Route element={<PublicLayout />}>
      <Route index element={<PublicLandingPage />} />
      <Route path="login" element={account ? <Navigate to="/app" replace /> : <AuthView mode="login" onAuthenticated={setAccount} googleDriveEnabled={publicConfig.features.googleDrive} />} />
      <Route path="signup" element={account ? <Navigate to="/app" replace /> : <AuthView mode="signup" onAuthenticated={setAccount} googleDriveEnabled={false} />} />
    </Route>
    <Route path="join/:token" element={<PublicLayout />}>
      <Route index element={<FirmInvitationView enabled={publicConfig.features.firmTeams} onAccepted={setAccount} />} />
    </Route>

    <Route path="app/*" element={account
      ? <LawyerWorkspace account={account} cases={cases} fetchCases={fetchCases} logout={logout} featureFlags={publicConfig.features} />
      : <Navigate to="/login" replace />} />

    <Route path="client" element={<ClientLayout />}>
      <Route path="login" element={<ClientAccountUnavailable />} />
      <Route path="dashboard" element={<ClientAccountUnavailable />} />
      <Route path="invitations/:token" element={publicConfig.features.clientAccounts ? <ClientAccountUnavailable /> : <ClientAccountUnavailable />} />
    </Route>
    <Route path="client/:token" element={<LegacyPortalRoute />} />
    <Route path="*" element={<div className="mx-auto max-w-lg p-8 pt-24"><ErrorState title="Page not found" detail="The requested page does not exist or has moved." /></div>} />
  </Routes>;
}

function LegacyPortalRoute() {
  const { token } = useParams();
  return token ? <ClientPortalView token={token} /> : <Navigate to="/client/login" replace />;
}

interface LawyerWorkspaceProps {
  account: Account;
  cases: Case[];
  fetchCases: () => Promise<void>;
  logout: () => Promise<void>;
  featureFlags: PublicBrowserConfig["features"];
}

function LawyerWorkspace({ account, cases, fetchCases, logout, featureFlags }: LawyerWorkspaceProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [initialDraftId, setInitialDraftId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const activeTab = location.pathname.includes("/matters/") ? "matter" : location.pathname.split("/")[2] || "assistant";
  const goTo = (tab: string) => navigate(tab === "assistant" ? "/app" : `/app/${tab}`);
  const startAssistant = () => { setActiveThreadId(null); setIsSidebarCollapsed(false); navigate("/app"); };

  return <div className="flex h-screen w-screen overflow-hidden bg-white font-sans text-zinc-900">
    <a href="#lawyer-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3">Skip to workspace</a>
    <Sidebar activeTab={activeTab} setActiveTab={goTo} firmName={account.firm.name} userName={account.user.name} userEmail={account.user.email} onLogout={() => void logout().then(() => navigate("/login"))} isCollapsed={isSidebarCollapsed} setIsCollapsed={setIsSidebarCollapsed} onStartNewThread={startAssistant} />
    <main id="lawyer-content" className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <Routes>
        <Route index element={<AssistantView cases={cases} activeCaseId={activeCaseId} setActiveCaseId={setActiveCaseId} activeThreadId={activeThreadId} setActiveThreadId={setActiveThreadId} onMessagesChange={() => undefined} onNavigateToDrafts={(draftId) => { setInitialDraftId(draftId); if (activeCaseId) navigate(`/app/matters/${activeCaseId}`); }} featureFlags={featureFlags} />} />
        <Route path="assistant" element={<Navigate to="/app" replace />} />
        <Route path="matters" element={<MattersView matters={cases} onRefresh={fetchCases} onOpenMatter={(matterId) => { setActiveCaseId(matterId); setActiveThreadId(null); navigate(`/app/matters/${matterId}`); }} />} />
        <Route path="matters/:matterId" element={<MatterRoute cases={cases} onBack={() => navigate("/app/matters")} onMatterChange={(matter) => { setActiveCaseId(matter.id); void fetchCases(); }} initialDraftId={initialDraftId} clearDraft={() => setInitialDraftId(null)} googleDriveEnabled={featureFlags.googleDrive} />} />
        <Route path="library" element={<FirmLibraryView googleDriveEnabled={featureFlags.googleDrive} />} />
        <Route path="history" element={<HistoryView cases={cases} activeThreadId={activeThreadId} onSelectThread={(thread) => { setActiveCaseId(thread.case_id); setActiveThreadId(thread.id); navigate("/app"); }} />} />
        <Route path="settings" element={<SettingsView user={account.user} membership={account.membership} matters={cases} onLogout={() => void logout().then(() => navigate("/login"))} googleDriveEnabled={featureFlags.googleDrive} firmTeamsEnabled={featureFlags.firmTeams} />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </main>
    <Outlet />
  </div>;
}

function MatterRoute({ cases, onBack, onMatterChange, initialDraftId, clearDraft, googleDriveEnabled }: { cases: Case[]; onBack: () => void; onMatterChange: (matter: Case) => void; initialDraftId: string | null; clearDraft: () => void; googleDriveEnabled: boolean }) {
  const { matterId } = useParams();
  useEffect(() => {
    if (matterId && cases.some((matter) => matter.id === matterId)) return;
  }, [cases, matterId]);
  if (!matterId) return <ErrorState title="Matter unavailable" />;
  return <MatterWorkspaceView matterId={matterId} onBack={onBack} onMatterChange={onMatterChange} initialDraftId={initialDraftId} onClearInitialDraftId={clearDraft} googleDriveEnabled={googleDriveEnabled} />;
}
