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
  | { kind: "client"; token: string }
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

  const matterMatch = path.match(/^\/matters\/([^/]+)$/);
  if (matterMatch) {
    const matterId = decodeSegment(matterMatch[1]);
    return matterId ? { kind: "matter", matterId } : { kind: "unknown" };
  }
  const clientMatch = path.match(/^\/client\/([^/]+)$/);
  if (clientMatch) {
    const token = decodeSegment(clientMatch[1]);
    return token ? { kind: "client", token } : { kind: "unknown" };
  }
  return { kind: "unknown" };
}

export function safeReturnTo(value: string | null, fallback = "/assistant"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    const route = parseRoute(url.pathname);
    return ["assistant", "matters", "matter", "library", "history", "settings"].includes(route.kind)
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export function routePath(route: AppRoute): string {
  if (route.kind === "matter") return `/matters/${encodeURIComponent(route.matterId)}`;
  if (route.kind === "client") return `/client/${encodeURIComponent(route.token)}`;
  if (route.kind === "landing") return "/";
  if (route.kind === "unknown") return "/";
  return `/${route.kind}`;
}
