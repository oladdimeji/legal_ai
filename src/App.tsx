import React, { useCallback, useEffect, useMemo, useState } from "react";
import AssistantView from "./components/AssistantView";
import LawyerWorkspaceShell from "./components/LawyerWorkspaceShell";
import FirmLibraryView from "./components/FirmLibraryView";
import MattersView from "./components/MattersView";
import SettingsView from "./components/SettingsView";
import MatterWorkspaceView from "./components/MatterWorkspaceView";
import HistoryView from "./components/HistoryView";
import AssistantDocumentView from "./components/AssistantDocumentView";
import AuthView from "./components/AuthView";
import ClientWorkspace from "./components/ClientWorkspace";
import LandingPage from "./components/LandingPage";
import OnboardingView from "./components/OnboardingView";
import SiteLockScreen from "./components/SiteLockScreen";
import { Account, AssistantDocumentReference, Case } from "./types";
import { parseRoute, routePath, safeReturnTo } from "./lib/routes";
import {
  WorkspacePageContextProvider,
  useWorkspacePageContext,
} from "./lib/WorkspacePageContextProvider";

interface PublicSiteStatus {
  locked: boolean;
  reopensAt: string | null;
}

const protectedRouteKinds = new Set([
  "assistant",
  "matters",
  "matter",
  "library",
  "history",
  "settings",
  "assistantDocument",
  "clientAssistant",
  "clientSharedMatters",
  "clientSharedMatter",
  "clientHistory",
  "clientSettings",
]);

const clientRouteKinds = new Set([
  "clientAssistant",
  "clientSharedMatters",
  "clientSharedMatter",
  "clientHistory",
  "clientSettings",
]);

export default function App() {
  return (
    <WorkspacePageContextProvider>
      <AppContent />
    </WorkspacePageContextProvider>
  );
}

function AppContent() {
  const [locationKey, setLocationKey] = useState(
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  );
  const route = useMemo(() => parseRoute(window.location.pathname), [locationKey]);
  const [cases, setCases] = useState<Case[]>([]);
  const activeCaseId = route.kind === "matter" ? route.matterId : null;
  const [account, setAccount] = useState<Account | null>(null);
  const [siteStatus, setSiteStatus] = useState<PublicSiteStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [initialDraftId, setInitialDraftId] = useState<string | null>(null);
  const [activeThreadIds, setActiveThreadIds] = useState<Record<string, string>>({});
  const { pageContext } = useWorkspacePageContext();
  const assistantContextKey = activeCaseId ? `matter:${activeCaseId}` : "general";
  const activeThreadId = activeThreadIds[assistantContextKey] || null;
  const setActiveThreadId = useCallback((id: string | null) => {
    setActiveThreadIds((current) => {
      if (!id) {
        const next = { ...current };
        delete next[assistantContextKey];
        return next;
      }
      return { ...current, [assistantContextKey]: id };
    });
  }, [assistantContextKey]);

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
    let cancelled = false;
    const loadSiteStatus = async () => {
      try {
        const response = await fetch("/api/site-status");
        if (!response.ok) throw new Error("Unable to load site status.");
        const data = (await response.json()) as Partial<PublicSiteStatus>;
        if (typeof data.locked !== "boolean") throw new Error("Invalid site status response.");
        if (!cancelled) {
          setSiteStatus({
            locked: data.locked,
            reopensAt: typeof data.reopensAt === "string" ? data.reopensAt : null,
          });
        }
      } catch (error) {
        console.error("Error loading site status:", error);
        if (!cancelled) setSiteStatus({ locked: true, reopensAt: null });
      }
    };
    void loadSiteStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!siteStatus) return;
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
  }, [siteStatus]);

  useEffect(() => {
    if (authLoading || !siteStatus) return;
    if (!account) {
      if (siteStatus.locked) {
        if (route.kind === "auth" && window.location.pathname !== "/auth") {
          navigate("/auth", true);
        } else if (route.kind !== "auth" && route.kind !== "landing") {
          navigate("/", true);
        }
        return;
      }
      if (protectedRouteKinds.has(route.kind)) {
        const mode = clientRouteKinds.has(route.kind) ? "&mode=client" : "";
        navigate(`/auth?returnTo=${encodeURIComponent(routePath(route))}${mode}`, true);
      } else if (route.kind === "onboarding") {
        navigate("/auth", true);
      } else if (route.kind === "unknown") {
        navigate("/", true);
      } else if (route.kind === "auth" && window.location.pathname !== "/auth") {
        navigate("/auth", true);
      }
      return;
    }
    if (account.user.account_type === "client") {
      if (!clientRouteKinds.has(route.kind)) navigate("/client/assistant", true);
      return;
    }
    if (clientRouteKinds.has(route.kind)) {
      navigate(
        account.user.onboarding_completed && account.firm ? "/matters" : "/onboarding",
        true
      );
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
      route.kind === "unknown" ||
      route.kind === "assistant"
    ) {
      navigate("/matters", true);
    }
  }, [account, authLoading, navigate, route, siteStatus]);

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
    if (
      account?.user.account_type === "lawyer" &&
      account.user.onboarding_completed &&
      account.firm
    ) {
      void fetchCases();
    } else {
      setCases([]);
    }
  }, [account, fetchCases]);

  const handleOpenMatter = (matterId: string) => {
    navigate(`/matters/${encodeURIComponent(matterId)}`);
  };

  const handleMatterChange = (matter: Case) => {
    setCases((current) => current.map((item) => (item.id === matter.id ? matter : item)));
  };

  const handleOpenAssistantDocument = (document: AssistantDocumentReference) => {
    if (document.kind === "matterWorkProduct" && document.matterId) {
      setInitialDraftId(document.id);
      navigate(`/matters/${encodeURIComponent(document.matterId)}`);
      return;
    }
    if (document.kind === "assistantDocument") {
      navigate(`/documents/${encodeURIComponent(document.id)}`);
    }
  };

  const handleStartNewThread = () => {
    setActiveThreadId(null);
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setAccount(null);
      setActiveThreadIds({});
      setInitialDraftId(null);
      navigate("/", true);
    }
  };

  if (authLoading || !siteStatus) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white text-xs font-mono uppercase text-zinc-500">
        Loading secure workspace...
      </div>
    );
  }

  if (!account && siteStatus.locked && route.kind !== "auth") {
    return <SiteLockScreen reopensAt={siteStatus.reopensAt} />;
  }

  if (!account) {
    if (route.kind === "auth") {
      const params = new URLSearchParams(window.location.search);
      const accountMode = params.get("mode") === "client" ? "client" : "lawyer";
      return (
        <AuthView
          accountMode={accountMode}
          returnTo={safeReturnTo(
            params.get("returnTo"),
            accountMode === "client" ? "/client/assistant" : "/matters"
          )}
          initialError={params.get("authError") || ""}
          onAuthenticated={(nextAccount, redirectTo) => {
            setAccount(nextAccount);
            navigate(
              nextAccount.user.account_type === "client"
                ? safeReturnTo(redirectTo, "/client/assistant")
                : nextAccount.user.onboarding_completed
                  ? safeReturnTo(redirectTo, "/matters")
                  : "/onboarding",
              true
            );
          }}
          onBack={() => navigate("/")}
        />
      );
    }
    return (
      <LandingPage
        onAuthenticate={() => navigate("/auth")}
        onClientPortal={() =>
          navigate("/auth?mode=client&returnTo=%2Fclient%2Fshared-matters")
        }
      />
    );
  }

  if (account.user.account_type === "client") {
    return (
      <ClientWorkspace
        account={account}
        route={route}
        navigate={navigate}
        onLogout={handleLogout}
      />
    );
  }

  if (!account.user.onboarding_completed || !account.firm) {
    return (
      <OnboardingView
        account={account}
        onCompleted={(nextAccount) => {
          setAccount(nextAccount);
          navigate("/matters", true);
        }}
      />
    );
  }

  const activeNavigation = route.kind === "matter"
    ? "matters"
    : route.kind === "matters" || route.kind === "library" || route.kind === "history"
      ? route.kind
      : null;
  const assistantContextLabel = pageContext.matter
    ? `Matter · ${pageContext.matter.name}${pageContext.activeSection ? ` · ${pageContext.activeSection}` : ""}`
    : `${pageContext.pageTitle}${pageContext.activeSection ? ` · ${pageContext.activeSection}` : ""}`;

  return (
    <LawyerWorkspaceShell
      account={account}
      activeNavigation={activeNavigation}
      assistantContextLabel={assistantContextLabel}
      navigate={navigate}
      onLogout={handleLogout}
      onStartNewConversation={handleStartNewThread}
      assistant={
        <AssistantView
          cases={cases}
          activeCaseId={activeCaseId}
          activeThreadId={activeThreadId}
          setActiveThreadId={setActiveThreadId}
          onMessagesChange={() => undefined}
          onOpenDocument={handleOpenAssistantDocument}
          compact
        />
      }
    >
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
            const key = thread.case_id ? `matter:${thread.case_id}` : "general";
            setActiveThreadIds((current) => ({ ...current, [key]: thread.id }));
            if (thread.case_id) navigate(`/matters/${encodeURIComponent(thread.case_id)}`);
          }}
        />
      )}
      {route.kind === "settings" && (
        <SettingsView
          account={account}
          onAccountUpdated={setAccount}
          onLogout={handleLogout}
        />
      )}
      {route.kind === "assistantDocument" && (
        <AssistantDocumentView documentId={route.documentId} />
      )}
    </LawyerWorkspaceShell>
  );
}
