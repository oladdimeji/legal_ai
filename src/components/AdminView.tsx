import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { PlatformAccessRequest, PlatformAccessStatus } from "../types";

type AdminState = "loading" | "unauthenticated" | "authenticated" | "error";

async function responseError(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return data?.error || fallback;
}

function professionalRole(request: PlatformAccessRequest): string {
  return request.professionalRole === "Other"
    ? request.customProfessionalRole || "Other"
    : request.professionalRole;
}

function workspaceLabel(request: PlatformAccessRequest): string {
  return request.workspaceType === "independent"
    ? "Independent workspace"
    : request.firmName || "Firm workspace";
}

function practiceAreas(request: PlatformAccessRequest): string {
  return [
    ...request.practiceAreas.filter((area) => area !== "Other"),
    ...(request.customPracticeArea ? [request.customPracticeArea] : []),
  ].join(" / ") || "Not provided";
}

function statusLabel(status: PlatformAccessStatus): string {
  return status[0].toUpperCase() + status.slice(1);
}

export default function AdminView() {
  const [adminState, setAdminState] = useState<AdminState>("loading");
  const [requests, setRequests] = useState<PlatformAccessRequest[]>([]);
  const [error, setError] = useState("");
  const [decidingUserId, setDecidingUserId] = useState<string | null>(null);
  const authError = useMemo(
    () => new URLSearchParams(window.location.search).get("authError"),
    []
  );

  const loadDashboard = useCallback(async () => {
    setAdminState("loading");
    setError("");
    try {
      const statusResponse = await fetch("/api/access-admin/status");
      if (statusResponse.status === 401 || statusResponse.status === 403) {
        setRequests([]);
        setAdminState("unauthenticated");
        return;
      }
      if (!statusResponse.ok) {
        throw new Error(await responseError(statusResponse, "Unable to verify administrator access."));
      }
      const requestsResponse = await fetch("/api/access-admin/requests");
      if (!requestsResponse.ok) {
        throw new Error(await responseError(requestsResponse, "Unable to load access requests."));
      }
      const data = (await requestsResponse.json()) as { requests: PlatformAccessRequest[] };
      setRequests(data.requests);
      setAdminState("authenticated");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Exepts administration.");
      setAdminState("error");
    }
  }, []);

  useEffect(() => {
    if (authError) {
      setAdminState("unauthenticated");
      return;
    }
    void loadDashboard();
  }, [authError, loadDashboard]);

  const decide = async (
    request: PlatformAccessRequest,
    decision: "approved" | "denied"
  ) => {
    if (request.status !== "pending" || decidingUserId) return;
    if (decision === "denied" && !window.confirm(`Deny platform access for ${request.fullName}?`)) {
      return;
    }
    setError("");
    setDecidingUserId(request.userId);
    try {
      const response = await fetch(
        `/api/access-admin/requests/${encodeURIComponent(request.userId)}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        }
      );
      if (!response.ok) {
        throw new Error(await responseError(response, "Unable to save the access decision."));
      }
      setRequests((current) => current.map((item) => (
        item.userId === request.userId ? { ...item, status: decision } : item
      )));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the access decision.");
    } finally {
      setDecidingUserId(null);
    }
  };

  const logout = async () => {
    try {
      await fetch("/api/access-admin/logout", { method: "POST" });
    } finally {
      setRequests([]);
      setAdminState("unauthenticated");
      window.history.replaceState({}, "", "/admin");
    }
  };

  if (adminState === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-6 text-zinc-950">
        <p className="text-xs font-mono uppercase text-zinc-500">Loading administration...</p>
      </main>
    );
  }

  if (adminState === "unauthenticated") {
    const unauthorized = authError === "unauthorized" || authError === "unverified";
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-6 text-zinc-950">
        <section className="w-full max-w-md rounded border border-zinc-200 p-8 sm:p-10">
          <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-400">
            Exepts
          </p>
          <h1 className="mt-3 text-2xl font-bold">
            {unauthorized ? "Administrator access required" : "Exepts Administration"}
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            {unauthorized
              ? "This Google account is not authorized for Exepts administration."
              : "Platform access administration"}
          </p>
          {!unauthorized && authError && (
            <p role="alert" className="mt-4 rounded border border-zinc-300 bg-zinc-50 px-4 py-3 text-xs text-zinc-700">
              The administrator sign-in could not be completed. Please try again.
            </p>
          )}
          <a
            href="/api/admin/auth/google"
            className="mt-7 flex w-full items-center justify-center rounded bg-zinc-950 px-4 py-3 text-xs font-mono font-bold uppercase text-white hover:bg-black"
          >
            {unauthorized ? "Try another Google account" : "Continue with Google"}
          </a>
          <p className="mt-4 text-center text-xs text-zinc-500">
            Sign in with an authorized Exepts administrator Google account.
          </p>
          {unauthorized && (
            <a href="/auth" className="mt-5 block text-center text-xs underline underline-offset-4">
              Return to normal Exepts login
            </a>
          )}
        </section>
      </main>
    );
  }

  if (adminState === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-6 text-zinc-950">
        <section className="w-full max-w-md rounded border border-zinc-200 p-8 text-center">
          <h1 className="text-xl font-bold">Exepts Administration</h1>
          <p role="alert" className="mt-3 text-sm text-zinc-600">{error}</p>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="mt-6 rounded bg-zinc-950 px-4 py-2 text-xs font-mono font-bold uppercase text-white"
          >
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white px-4 py-6 text-zinc-950 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col justify-between gap-5 border-b border-zinc-200 pb-6 sm:flex-row sm:items-start">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              <h1 className="text-xl font-bold uppercase">Exepts Administration</h1>
            </div>
            <p className="mt-2 text-xs font-mono uppercase text-zinc-500">Access Requests</p>
          </div>
          <div className="flex items-center gap-3">
            <a href="/matters" className="text-xs font-mono font-bold uppercase underline underline-offset-4">
              Open Exepts
            </a>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-2 rounded border border-zinc-300 px-3 py-2 text-[10px] font-mono font-bold uppercase hover:border-zinc-950"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </header>

        {error && (
          <div role="alert" className="mt-6 rounded border border-zinc-300 bg-zinc-50 px-4 py-3 text-xs">
            {error}
          </div>
        )}

        <section className="mt-7" aria-labelledby="access-requests-heading">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="access-requests-heading" className="text-sm font-bold uppercase">Access Requests</h2>
              <p className="mt-1 text-xs text-zinc-500">Newest submitted requests appear first.</p>
            </div>
            <p className="text-[10px] font-mono uppercase text-zinc-400">
              {requests.length} {requests.length === 1 ? "request" : "requests"}
            </p>
          </div>

          {requests.length === 0 ? (
            <p className="mt-5 rounded border border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
              No submitted access requests.
            </p>
          ) : (
            <div className="mt-5 overflow-hidden rounded border border-zinc-200">
              {requests.map((request) => {
                const busy = decidingUserId === request.userId;
                return (
                  <article
                    key={request.userId}
                    className="grid gap-4 border-b border-zinc-200 p-4 last:border-b-0 lg:grid-cols-[1.2fr_1.3fr_0.9fr_auto] lg:items-center"
                  >
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold">{request.fullName}</h3>
                      <a
                        href={`mailto:${request.email}`}
                        className="mt-1 block truncate text-xs text-zinc-600 underline underline-offset-2"
                      >
                        {request.email}
                      </a>
                    </div>
                    <div className="min-w-0 text-xs text-zinc-600">
                      <p>{professionalRole(request)} / {workspaceLabel(request)}</p>
                      <p className="mt-1 truncate">{practiceAreas(request)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-mono uppercase text-zinc-400">
                        {new Date(request.submittedAt).toLocaleString()}
                      </p>
                      <span className="mt-2 inline-block rounded border border-zinc-300 px-2 py-1 text-[9px] font-mono font-bold uppercase">
                        {statusLabel(request.status)}
                      </span>
                    </div>
                    <div className="flex min-w-40 justify-start gap-2 lg:justify-end">
                      {request.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            disabled={decidingUserId !== null}
                            onClick={() => void decide(request, "approved")}
                            className="rounded bg-zinc-950 px-3 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:opacity-50"
                          >
                            {busy ? "Saving..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            disabled={decidingUserId !== null}
                            onClick={() => void decide(request, "denied")}
                            className="rounded border border-zinc-300 px-3 py-2 text-[10px] font-mono font-bold uppercase disabled:opacity-50"
                          >
                            Deny
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-zinc-400">-</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
