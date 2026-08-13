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
import AccessGateView from "./components/AccessGateView";
import AccessReviewView from "./components/AccessReviewView";
import AccessRequestSubmittedView from "./components/AccessRequestSubmittedView";
import ClientAccessGateView from "./components/ClientAccessGateView";
import ClientInviteAccessView from "./components/ClientInviteAccessView";
import AdminView from "./components/AdminView";
import { Account, AssistantDocumentReference, Case, WorkspacePageContext } from "./types";
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
  "accessGate",
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

function assistantContextForRoute(
  route: ReturnType<typeof parseRoute>,
  published: WorkspacePageContext,
  matters: Case[]
): WorkspacePageContext {
  if (route.kind === "matter") {
    if (published.routeKind === "matter" && published.matter?.id === route.matterId) {
      return published;
    }
    const matter = matters.find((item) => item.id === route.matterId);
    return {
      routeKind: "matter",
      pageTitle: matter?.name || "Matter",
      pageDescription: "The current Matter workspace. Its tabs organize overview details, Sources, Matter Intelligence, Work Product, and Collaboration.",
      activeSection: "Overview",
      matter: {
        id: route.matterId,
        name: matter?.name || "Matter",
        clientName: matter?.client_name || null,
        status: matter?.status || null,
      },
    };
  }
  if (route.kind === "assistantDocument") {
    if (
      published.routeKind === "assistantDocument" &&
      published.selectedItem?.kind === "assistantDocument" &&
      published.selectedItem.id === route.documentId
    ) {
      return published;
    }
    return {
      routeKind: "assistantDocument",
      pageTitle: "Assistant document",
      pageDescription: "A private standalone document created by the assistant.",
      activeSection: "Document editor",
      selectedItem: {
        kind: "assistantDocument",
        id: route.documentId,
        title: "Assistant document",
      },
    };
  }
  const routeDefaults: Partial<Record<typeof route.kind, WorkspacePageContext>> = {
    matters: { routeKind: "matters", pageTitle: "Matters", pageDescription: "The Firm's Matter list and Matter creation workspace." },
    library: { routeKind: "library", pageTitle: "Firm Library", pageDescription: "The Firm's reusable document library and search workspace." },
    history: { routeKind: "history", pageTitle: "History", pageDescription: "Past assistant conversations ordered by recent activity and filterable by origin." },
    settings: { routeKind: "settings", pageTitle: "Settings", pageDescription: "Account, Firm, and session settings for the authenticated lawyer." },
  };
  const expected = routeDefaults[route.kind];
  return expected && published.routeKind !== expected.routeKind ? expected : published;
}

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
  const isAdminRoute = route.kind === "admin";
  const [cases, setCases] = useState<Case[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [siteStatus, setSiteStatus] = useState<PublicSiteStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [requestedEmail, setRequestedEmail] = useState<string | null>(null);
  const [initialDraftId, setInitialDraftId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [newConversationVersion, setNewConversationVersion] = useState(0);
  const { pageContext } = useWorkspacePageContext();
  const assistantPageContext = assistantContextForRoute(route, pageContext, cases);

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
    if (isAdminRoute) return;
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
  }, [isAdminRoute]);

  useEffect(() => {
    if (isAdminRoute || !siteStatus) return;
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
  }, [isAdminRoute, siteStatus]);

  useEffect(() => {
    if (route.kind === "admin") return;
    if (authLoading || !siteStatus) return;
    if (route.kind === "accessReview") return;
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
        if (clientRouteKinds.has(route.kind)) {
          navigate("/", true);
        } else {
          navigate(`/auth?returnTo=${encodeURIComponent(routePath(route))}`, true);
        }
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
      if (!account.user.client_access_granted) {
        if (route.kind !== "clientSharedMatters") navigate("/client/shared-matters", true);
      } else if (!clientRouteKinds.has(route.kind)) {
        navigate("/client/shared-matters", true);
      }
      return;
    }
    if (clientRouteKinds.has(route.kind)) {
      navigate(
        !account.user.onboarding_completed || !account.firm
          ? "/onboarding"
          : account.user.platform_access_status === "approved"
            ? "/matters"
            : "/access",
        true
      );
      return;
    }
    if (!account.user.onboarding_completed || !account.firm) {
      if (route.kind !== "onboarding") navigate("/onboarding", true);
      return;
    }
    if (account.user.platform_access_status !== "approved") {
      if (route.kind !== "accessGate") navigate("/access", true);
      return;
    }
    if (
      route.kind === "landing" ||
      route.kind === "auth" ||
      route.kind === "onboarding" ||
      route.kind === "accessGate" ||
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
      account.firm &&
      account.user.platform_access_status === "approved"
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
    setNewConversationVersion((current) => current + 1);
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setAccount(null);
      setActiveThreadId(null);
      setNewConversationVersion((current) => current + 1);
      setInitialDraftId(null);
      navigate("/", true);
    }
  };

  if (route.kind === "admin") {
    return <AdminView />;
  }

  if (route.kind === "accessReview") {
    return <AccessReviewView token={route.token} />;
  }

  if (authLoading || !siteStatus) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white text-xs font-mono uppercase text-zinc-500">
        Loading secure workspace...
      </div>
    );
  }

  if (!account && siteStatus.locked && route.kind !== "auth" && route.kind !== "requestDemo" && route.kind !== "accessRequested") {
    return <SiteLockScreen reopensAt={siteStatus.reopensAt} />;
  }

  if (!account) {
    if (route.kind === "auth") {
      const params = new URLSearchParams(window.location.search);
      const accountMode = "lawyer";
      return (
        <AuthView
          accountMode={accountMode}
          returnTo={safeReturnTo(params.get("returnTo"), "/matters")}
          initialError={params.get("authError") || ""}
          onAuthenticated={(nextAccount, redirectTo) => {
            setAccount(nextAccount);
            navigate(
              nextAccount.user.account_type === "client"
                ? nextAccount.user.client_access_granted
                  ? safeReturnTo(redirectTo, "/client/shared-matters")
                  : "/client/shared-matters"
                : !nextAccount.user.onboarding_completed || !nextAccount.firm
                  ? "/onboarding"
                  : nextAccount.user.platform_access_status === "approved"
                    ? safeReturnTo(redirectTo, "/matters")
                    : "/access",
              true
            );
          }}
          onBack={() => navigate("/")}
        />
      );
    }
    if (route.kind === "requestDemo") {
      return (
        <OnboardingView
          account={null}
          publicMode
          onPublicRequestSubmitted={(email) => {
            setRequestedEmail(email);
            navigate("/access-requested", true);
          }}
        />
      );
    }
    if (route.kind === "clientAccess") {
      return (
        <ClientInviteAccessView
          accessId={route.accessId}
          onRedeemed={(nextAccount, redirectTo) => {
            if (nextAccount) setAccount(nextAccount);
            navigate(redirectTo || "/client/shared-matters", true);
          }}
          onCancel={() => navigate("/", true)}
        />
      );
    }
    if (route.kind === "accessRequested") {
      return (
        <AccessRequestSubmittedView
          submittedEmail={requestedEmail}
          onReturnHome={() => navigate("/", true)}
        />
      );
    }
    return (
      <LandingPage
        onAuthenticate={() => navigate("/auth")}
        onRequestDemo={() => navigate("/request-demo")}
      />
    );
  }

  if (account.user.account_type === "client") {
    if (!account.user.client_access_granted) {
      return (
        <ClientAccessGateView
          account={account}
          onAccountChange={setAccount}
          navigate={navigate}
          onLogout={handleLogout}
        />
      );
    }
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
          navigate("/access", true);
        }}
      />
    );
  }

  if (account.user.platform_access_status !== "approved") {
    return (
      <AccessGateView
        account={account}
        onAccountChange={setAccount}
        onLogout={handleLogout}
      />
    );
  }

  const activeNavigation = route.kind === "matter"
    ? "matters"
    : route.kind === "matters" || route.kind === "library" || route.kind === "history" || route.kind === "settings"
      ? route.kind
      : null;
  const assistantContextLabel = assistantPageContext.matter
    ? `Matter · ${assistantPageContext.matter.name}${assistantPageContext.activeSection ? ` · ${assistantPageContext.activeSection}` : ""}`
    : `${assistantPageContext.pageTitle}${assistantPageContext.activeSection ? ` · ${assistantPageContext.activeSection}` : ""}`;

  return (
    <LawyerWorkspaceShell
      account={account}
      activeNavigation={activeNavigation}
      assistantContextLabel={assistantContextLabel}
      navigate={navigate}
      onStartNewConversation={handleStartNewThread}
      assistant={
        <AssistantView
          pageContext={assistantPageContext}
          activeThreadId={activeThreadId}
          setActiveThreadId={setActiveThreadId}
          newConversationVersion={newConversationVersion}
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
          key={route.matterId}
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
            setActiveThreadId(thread.id);
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
