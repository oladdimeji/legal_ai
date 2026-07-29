import React, { useCallback, useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar";
import AssistantView from "./components/AssistantView";
import FirmLibraryView from "./components/FirmLibraryView";
import MattersView from "./components/MattersView";
import SettingsView from "./components/SettingsView";
import MatterWorkspaceView from "./components/MatterWorkspaceView";
import HistoryView from "./components/HistoryView";
import AuthView from "./components/AuthView";
import ClientPortalView from "./components/ClientPortalView";
import LandingPage from "./components/LandingPage";
import OnboardingView from "./components/OnboardingView";
import { Account, Case } from "./types";
import { parseRoute, routePath, safeReturnTo } from "./lib/routes";

const protectedRouteKinds = new Set([
  "assistant",
  "matters",
  "matter",
  "library",
  "history",
  "settings",
]);

export default function App() {
  const [locationKey, setLocationKey] = useState(
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  );
  const route = useMemo(() => parseRoute(window.location.pathname), [locationKey]);
  const [cases, setCases] = useState<Case[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(
    route.kind === "matter" ? route.matterId : null
  );
  const [account, setAccount] = useState<Account | null>(null);
  const [authLoading, setAuthLoading] = useState(route.kind !== "client");
  const [initialDraftId, setInitialDraftId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const navigate = useCallback((path: string, replace = false) => {
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` === path) {
      return;
    }
    window.history[replace ? "replaceState" : "pushState"]({}, "", path);
    setLocationKey(`${window.location.pathname}${window.location.search}${window.location.hash}`);
  }, []);

  useEffect(() => {
    const onPopState = () =>
      setLocationKey(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (route.kind === "client") {
      setAuthLoading(false);
      return;
    }
    let cancelled = false;
    const loadSession = async () => {
      try {
        const response = await fetch("/api/auth/me");
        if (!cancelled && response.ok) setAccount((await response.json()) as Account);
      } catch (error) {
        console.error("Error loading session:", error);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    };
    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [route.kind === "client"]);

  useEffect(() => {
    if (authLoading || route.kind === "client") return;
    if (!account) {
      if (protectedRouteKinds.has(route.kind)) {
        navigate(`/auth?returnTo=${encodeURIComponent(routePath(route))}`, true);
      } else if (route.kind === "onboarding") {
        navigate("/auth", true);
      } else if (route.kind === "unknown") {
        navigate("/", true);
      } else if (route.kind === "auth" && window.location.pathname !== "/auth") {
        navigate("/auth", true);
      }
      return;
    }
    if (!account.user.onboarding_completed || !account.firm) {
      if (route.kind !== "onboarding") navigate("/onboarding", true);
      return;
    }
    if (
      route.kind === "landing" ||
      route.kind === "auth" ||
      route.kind === "onboarding" ||
      route.kind === "unknown"
    ) {
      navigate("/assistant", true);
    }
  }, [account, authLoading, navigate, route]);

  const fetchCases = useCallback(async () => {
    try {
      const response = await fetch("/api/cases");
      if (!response.ok) return;
      setCases((await response.json()) as Case[]);
    } catch (error) {
      console.error("Error fetching Matters list:", error);
    }
  }, []);

  useEffect(() => {
    if (account?.user.onboarding_completed && account.firm) void fetchCases();
    else setCases([]);
  }, [account, fetchCases]);

  useEffect(() => {
    if (route.kind === "matter") {
      setActiveCaseId(route.matterId);
      setActiveThreadId(null);
    }
  }, [route]);

  const handleOpenMatter = (matterId: string) => {
    setActiveCaseId(matterId);
    setActiveThreadId(null);
    navigate(`/matters/${encodeURIComponent(matterId)}`);
  };

  const handleMatterChange = (matter: Case) => {
    setCases((current) => current.map((item) => (item.id === matter.id ? matter : item)));
  };

  const handleNavigateToDrafts = (draftId: string) => {
    setInitialDraftId(draftId);
    if (activeCaseId) navigate(`/matters/${encodeURIComponent(activeCaseId)}`);
  };

  const handleStartNewThread = () => {
    setActiveThreadId(null);
    setIsSidebarCollapsed(false);
    navigate("/assistant");
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setAccount(null);
      setActiveCaseId(null);
      setActiveThreadId(null);
      setInitialDraftId(null);
      navigate("/", true);
    }
  };

  if (route.kind === "client") return <ClientPortalView token={route.token} />;

  if (authLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white text-xs font-mono uppercase text-zinc-500">
        Loading secure workspace...
      </div>
    );
  }

  if (!account) {
    if (route.kind === "auth") {
      const params = new URLSearchParams(window.location.search);
      return (
        <AuthView
          returnTo={safeReturnTo(params.get("returnTo"))}
          initialError={params.get("authError") || ""}
          onAuthenticated={(nextAccount, redirectTo) => {
            setAccount(nextAccount);
            navigate(
              nextAccount.user.onboarding_completed
                ? safeReturnTo(redirectTo)
                : "/onboarding",
              true
            );
          }}
          onBack={() => navigate("/")}
        />
      );
    }
    return <LandingPage onAuthenticate={() => navigate("/auth")} />;
  }

  if (!account.user.onboarding_completed || !account.firm) {
    return (
      <OnboardingView
        account={account}
        onCompleted={(nextAccount) => {
          setAccount(nextAccount);
          navigate("/assistant", true);
        }}
      />
    );
  }

  const activeTab = route.kind === "matter" ? "matters" : route.kind;
  const goToTab = (tab: string) => {
    const paths: Record<string, string> = {
      assistant: "/assistant",
      matters: "/matters",
      library: "/library",
      history: "/history",
      settings: "/settings",
    };
    navigate(paths[tab] || "/assistant");
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white font-sans text-zinc-900">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={goToTab}
        firmName={account.firm.name}
        userName={account.user.name || ""}
        userEmail={account.user.email}
        onLogout={handleLogout}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        onStartNewThread={handleStartNewThread}
      />

      <main className="flex h-full flex-1 flex-col overflow-hidden">
        {route.kind === "assistant" && (
          <AssistantView
            cases={cases}
            activeCaseId={activeCaseId}
            setActiveCaseId={setActiveCaseId}
            activeThreadId={activeThreadId}
            setActiveThreadId={setActiveThreadId}
            onMessagesChange={() => undefined}
            onNavigateToDrafts={handleNavigateToDrafts}
          />
        )}
        {route.kind === "matters" && (
          <MattersView matters={cases} onRefresh={fetchCases} onOpenMatter={handleOpenMatter} />
        )}
        {route.kind === "library" && <FirmLibraryView />}
        {route.kind === "matter" && (
          <MatterWorkspaceView
            matterId={route.matterId}
            onBack={() => navigate("/matters")}
            onMatterChange={handleMatterChange}
            initialDraftId={initialDraftId}
            onClearInitialDraftId={() => setInitialDraftId(null)}
          />
        )}
        {route.kind === "history" && (
          <HistoryView
            cases={cases}
            activeThreadId={activeThreadId}
            onSelectThread={(thread) => {
              setActiveCaseId(thread.case_id);
              setActiveThreadId(thread.id);
              navigate("/assistant");
            }}
          />
        )}
        {route.kind === "settings" && (
          <SettingsView user={account.user} onLogout={handleLogout} />
        )}
      </main>
    </div>
  );
}
