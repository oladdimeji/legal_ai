let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch("/api/security/csrf", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Request security could not be initialized.");
  const data = await response.json() as { token?: unknown };
  if (typeof data.token !== "string") throw new Error("Request security could not be initialized.");
  csrfToken = data.token;
  return csrfToken;
}

export async function secureFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", await getCsrfToken());
  }
  const response = await fetch(url, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: init.cache || "no-store",
  });
  if (response.status === 403 && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    csrfToken = null;
  }
  return response;
}
