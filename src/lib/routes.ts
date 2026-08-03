export type AppRoute =
  | { kind: "landing" }
  | { kind: "auth" }
  | { kind: "onboarding" }
  | { kind: "assistant" }
  | { kind: "matters" }
  | { kind: "matter"; matterId: string }
  | { kind: "library" }
  | { kind: "history" }
  | { kind: "settings" }
  | { kind: "clientAssistant" }
  | { kind: "clientSharedMatters" }
  | { kind: "clientSharedMatter"; accessId: string }
  | { kind: "clientHistory" }
  | { kind: "clientSettings" }
  | { kind: "unknown" };

function decodeSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded && !decoded.includes("/") ? decoded : null;
  } catch {
    return null;
  }
}

export function parseRoute(pathname: string): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { kind: "landing" };
  if (path === "/auth" || path === "/login" || path === "/signup") return { kind: "auth" };
  if (path === "/onboarding") return { kind: "onboarding" };
  if (path === "/assistant") return { kind: "assistant" };
  if (path === "/matters") return { kind: "matters" };
  if (path === "/library") return { kind: "library" };
  if (path === "/history") return { kind: "history" };
  if (path === "/settings") return { kind: "settings" };
  if (path === "/client" || path === "/client/assistant") {
    return { kind: "clientAssistant" };
  }
  if (path === "/client/shared-matters") return { kind: "clientSharedMatters" };
  if (path === "/client/history") return { kind: "clientHistory" };
  if (path === "/client/settings") return { kind: "clientSettings" };

  const sharedMatterMatch = path.match(/^\/client\/shared-matters\/([^/]+)$/);
  if (sharedMatterMatch) {
    const accessId = decodeSegment(sharedMatterMatch[1]);
    return accessId ? { kind: "clientSharedMatter", accessId } : { kind: "unknown" };
  }

  const matterMatch = path.match(/^\/matters\/([^/]+)$/);
  if (matterMatch) {
    const matterId = decodeSegment(matterMatch[1]);
    return matterId ? { kind: "matter", matterId } : { kind: "unknown" };
  }
  return { kind: "unknown" };
}

export function safeReturnTo(value: string | null, fallback = "/matters"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    const route = parseRoute(url.pathname);
    return [
      "assistant",
      "matters",
      "matter",
      "library",
      "history",
      "settings",
      "clientAssistant",
      "clientSharedMatters",
      "clientSharedMatter",
      "clientHistory",
      "clientSettings",
    ].includes(route.kind)
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export function routePath(route: AppRoute): string {
  if (route.kind === "matter") return `/matters/${encodeURIComponent(route.matterId)}`;
  if (route.kind === "clientAssistant") return "/client/assistant";
  if (route.kind === "clientSharedMatters") return "/client/shared-matters";
  if (route.kind === "clientSharedMatter") {
    return `/client/shared-matters/${encodeURIComponent(route.accessId)}`;
  }
  if (route.kind === "clientHistory") return "/client/history";
  if (route.kind === "clientSettings") return "/client/settings";
  if (route.kind === "landing") return "/";
  if (route.kind === "unknown") return "/";
  return `/${route.kind}`;
}
