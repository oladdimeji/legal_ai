import React, { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Copy,
  LogOut,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  Account,
  FirmAdminMember,
  FirmAdminSettings,
  PlatformAccessRequest,
} from "../types";
import { useWorkspacePageContext } from "../lib/WorkspacePageContextProvider";

interface SettingsViewProps {
  account: Account;
  onAccountUpdated: (account: Account) => void;
  onLogout: () => void;
}

function professionalRole(
  role: string | null,
  customRole: string | null
): string {
  if (role === "Other") return customRole || "Other";
  return role || "Not provided";
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return data?.error || fallback;
}

export default function SettingsView({
  account,
  onAccountUpdated,
  onLogout,
}: SettingsViewProps) {
  const { publishPageContext } = useWorkspacePageContext();
  const isAdmin = account.user.firm_role === "admin";
  const [firmName, setFirmName] = useState(account.firm?.name || "");
  const [members, setMembers] = useState<FirmAdminMember[]>([]);
  const [invitationCode, setInvitationCode] = useState<string | null>(null);
  const [adminLoading, setAdminLoading] = useState(isAdmin);
  const [adminLoaded, setAdminLoaded] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [saving, setSaving] = useState(false);
  const [firmError, setFirmError] = useState("");
  const [generatingCode, setGeneratingCode] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [copied, setCopied] = useState(false);
  const [isAccessReviewAdmin, setIsAccessReviewAdmin] = useState(false);
  const [accessRequests, setAccessRequests] = useState<PlatformAccessRequest[]>([]);
  const [accessAdminLoading, setAccessAdminLoading] = useState(false);
  const [accessAdminError, setAccessAdminError] = useState("");
  const [decidingUserId, setDecidingUserId] = useState<string | null>(null);

  useEffect(() => {
    publishPageContext({
      routeKind: "settings",
      pageTitle: "Settings",
      pageDescription: "Account, Firm, and session settings for the authenticated lawyer.",
      activeSection: isAdmin ? "Account and Firm administration" : "Account",
      visibleSections: [
        {
          id: "account",
          title: "Account",
          description: "Shows the authenticated lawyer's account and professional information, including name, email, professional role, Firm role, and workspace name.",
        },
        ...(isAdmin ? [{
          id: "firm-administration",
          title: "Firm administration",
          description: "Allows a Firm administrator to review and update the Firm name, view Firm members, and generate or rotate the lawyer invitation code.",
        }] : [{
          id: "firm-details",
          title: "Firm details",
          description: "Shows the shared Firm workspace name. Firm administration controls are available only to administrators.",
        }]),
        ...(isAccessReviewAdmin ? [{
          id: "platform-access-administration",
          title: "Platform access administration",
          description: "Allows an authorized platform reviewer to approve or deny pending lawyer access requests.",
        }] : []),
        {
          id: "session",
          title: "Session",
          description: "Log out ends the current authenticated session.",
        },
      ],
      visibleActions: [
        ...(isAdmin ? [
          { id: "save-firm-name", label: "Save Firm name", description: "Updates the Firm name for this workspace." },
          ...(adminLoaded ? [{
            id: "regenerate-invitation-code",
            label: invitationCode ? "Regenerate code" : "Generate code",
            description: invitationCode ? "Rotates the lawyer invitation code for this Firm." : "Generates a lawyer invitation code for this Firm.",
          }] : []),
          ...(adminLoaded && invitationCode ? [{ id: "copy-invitation-code", label: "Copy", description: "Copies the currently displayed invitation code without placing its value in assistant page context." }] : []),
        ] : []),
        ...(isAccessReviewAdmin ? accessRequests.flatMap((request) => [
          { id: `approve-access-${request.userId}`, label: "Approve", description: `Approves platform access for ${request.fullName}.` },
          { id: `deny-access-${request.userId}`, label: "Deny", description: `Denies platform access for ${request.fullName}.` },
        ]) : []),
        { id: "logout-settings", label: "Log out", description: "Ends the current authenticated session." },
      ],
    });
  }, [accessRequests, adminLoaded, invitationCode, isAccessReviewAdmin, isAdmin, publishPageContext]);

  useEffect(() => {
    setFirmName(account.firm?.name || "");
  }, [account.firm?.name]);

  const loadAdminSettings = useCallback(async () => {
    if (!isAdmin) return;
    setAdminLoading(true);
    setAdminError("");
    try {
      const response = await fetch("/api/settings/firm-admin");
      if (!response.ok) {
        throw new Error(await responseError(response, "Unable to load Firm administration."));
      }
      const data = (await response.json()) as FirmAdminSettings;
      setMembers(data.members);
      setInvitationCode(data.firm.invitationCode);
      setFirmName(data.firm.name);
      setAdminLoaded(true);
    } catch (caught) {
      setAdminError(
        caught instanceof Error ? caught.message : "Unable to load Firm administration."
      );
      setAdminLoaded(false);
    } finally {
      setAdminLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadAdminSettings();
  }, [loadAdminSettings, account.firm?.id]);

  const loadAccessAdministration = useCallback(async () => {
    setAccessAdminError("");
    try {
      const statusResponse = await fetch("/api/access-admin/status");
      if (!statusResponse.ok) return;
      const status = (await statusResponse.json()) as { isAccessReviewAdmin: boolean };
      setIsAccessReviewAdmin(status.isAccessReviewAdmin);
      if (!status.isAccessReviewAdmin) {
        setAccessRequests([]);
        return;
      }
      setAccessAdminLoading(true);
      const requestsResponse = await fetch("/api/access-admin/requests");
      if (!requestsResponse.ok) {
        throw new Error(await responseError(requestsResponse, "Unable to load access requests."));
      }
      const data = (await requestsResponse.json()) as { requests: PlatformAccessRequest[] };
      setAccessRequests(data.requests);
    } catch (caught) {
      setAccessAdminError(
        caught instanceof Error ? caught.message : "Unable to load access requests."
      );
    } finally {
      setAccessAdminLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccessAdministration();
  }, [account.user.id, loadAccessAdministration]);

  const decideAccessRequest = async (
    request: PlatformAccessRequest,
    decision: "approved" | "denied"
  ) => {
    if (decidingUserId) return;
    if (
      decision === "denied" &&
      !window.confirm(`Deny platform access for ${request.fullName}?`)
    ) {
      return;
    }
    setAccessAdminError("");
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
      setAccessRequests((current) => current.filter((item) => item.userId !== request.userId));
    } catch (caught) {
      setAccessAdminError(
        caught instanceof Error ? caught.message : "Unable to save the access decision."
      );
    } finally {
      setDecidingUserId(null);
    }
  };

  const saveFirmName = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isAdmin || saving) return;
    const name = firmName.trim();
    const previousName = account.firm?.name || "";
    setFirmError("");
    if (!name) {
      setFirmError("Firm name is required.");
      return;
    }
    if (name.length > 120) {
      setFirmError("Firm name must be 120 characters or fewer.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/settings/firm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "Unable to save the Firm name."));
      }
      const firm = (await response.json()) as { id: string; name: string };
      setFirmName(firm.name);
      onAccountUpdated({
        ...account,
        firm: { ...account.firm!, id: firm.id, name: firm.name },
      });
    } catch (caught) {
      setFirmName(previousName);
      setFirmError(caught instanceof Error ? caught.message : "Unable to save the Firm name.");
    } finally {
      setSaving(false);
    }
  };

  const generateInvitationCode = async () => {
    if (!isAdmin || generatingCode || !adminLoaded) return;
    setCodeError("");
    setCopied(false);
    if (
      invitationCode &&
      !window.confirm(
        "Regenerating the invitation code will prevent new users from joining with the previous code. Continue?"
      )
    ) {
      return;
    }
    setGeneratingCode(true);
    try {
      const response = await fetch("/api/settings/firm/invitation-code", { method: "POST" });
      if (!response.ok) {
        throw new Error(await responseError(response, "Unable to generate an invitation code."));
      }
      const data = (await response.json()) as { invitationCode: string };
      setInvitationCode(data.invitationCode);
    } catch (caught) {
      setCodeError(
        caught instanceof Error ? caught.message : "Unable to generate an invitation code."
      );
    } finally {
      setGeneratingCode(false);
    }
  };

  const copyInvitationCode = async () => {
    if (!invitationCode) return;
    setCodeError("");
    try {
      await navigator.clipboard.writeText(invitationCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCodeError("Unable to copy the invitation code.");
    }
  };

  return (
    <div className="h-full flex-1 overflow-y-auto bg-white p-5 sm:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            <h2 className="text-lg font-bold uppercase">Settings</h2>
          </div>
          <p className="mt-1 text-[11px] font-mono uppercase text-zinc-400">
            Account and Firm details
          </p>
        </header>

        <section className="space-y-4 rounded border border-zinc-200 p-5 sm:p-6">
          <div>
            <h3 className="text-xs font-bold uppercase">Account</h3>
            <p className="mt-1 text-xs text-zinc-500">Your Exepts account information.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["Name", account.user.name || ""],
              ["Email", account.user.email],
              [
                "Professional role",
                professionalRole(
                  account.user.professional_role,
                  account.user.custom_professional_role
                ),
              ],
              ["Firm role", isAdmin ? "Admin" : "Member"],
              ["Workspace / Firm name", account.firm?.name || ""],
            ].map(([label, value]) => (
              <label key={label} className="block">
                <span className="text-[10px] font-mono font-bold uppercase text-zinc-500">
                  {label}
                </span>
                <input
                  readOnly
                  value={value}
                  className="mt-1 w-full rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2 rounded border border-zinc-300 px-4 py-2 text-[10px] font-mono font-bold uppercase hover:border-zinc-900"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </section>

        <section className="space-y-4 rounded border border-zinc-200 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            <div>
              <h3 className="text-xs font-bold uppercase">Firm details</h3>
              <p className="mt-1 text-xs text-zinc-500">
                {isAdmin ? "Manage the shared Firm name." : "Your shared Firm workspace."}
              </p>
            </div>
          </div>
          {isAdmin ? (
            <form onSubmit={saveFirmName} className="space-y-3">
              <label className="block">
                <span className="text-[10px] font-mono font-bold uppercase text-zinc-500">
                  Firm name
                </span>
                <input
                  value={firmName}
                  maxLength={120}
                  onChange={(event) => setFirmName(event.target.value)}
                  className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950"
                />
              </label>
              {firmError && <p role="alert" className="text-xs text-red-700">{firmError}</p>}
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? "Saving..." : "Save Firm name"}
              </button>
            </form>
          ) : (
            <label className="block">
              <span className="text-[10px] font-mono font-bold uppercase text-zinc-500">
                Firm name
              </span>
              <input
                readOnly
                value={account.firm?.name || ""}
                className="mt-1 w-full rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
              />
            </label>
          )}
        </section>

        {isAccessReviewAdmin && (
          <section className="space-y-4 rounded border border-zinc-200 p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              <div>
                <h3 className="text-xs font-bold uppercase">Platform access administration</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Review completed lawyer access requests awaiting a platform decision.
                </p>
              </div>
            </div>
            {accessAdminLoading ? (
              <p className="text-xs text-zinc-500">Loading pending access requests...</p>
            ) : accessRequests.length === 0 ? (
              <p className="rounded border border-zinc-200 bg-zinc-50 px-3 py-4 text-xs text-zinc-500">
                No pending access requests.
              </p>
            ) : (
              <div className="space-y-3">
                {accessRequests.map((request) => {
                  const role = professionalRole(
                    request.professionalRole,
                    request.customProfessionalRole
                  );
                  const workspace = request.workspaceType === "independent"
                    ? "Independent workspace"
                    : request.firmName || "Firm workspace";
                  const practices = [
                    ...request.practiceAreas.filter((area) => area !== "Other"),
                    ...(request.customPracticeArea ? [request.customPracticeArea] : []),
                  ].join(" / ") || "Practice areas not provided";
                  const busy = decidingUserId === request.userId;
                  return (
                    <article key={request.userId} className="rounded border border-zinc-200 p-4">
                      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                        <div className="min-w-0 space-y-1">
                          <h4 className="text-sm font-semibold">{request.fullName}</h4>
                          <a
                            href={`mailto:${request.email}`}
                            className="block truncate text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-950"
                          >
                            {request.email}
                          </a>
                          <p className="text-xs text-zinc-600">{role} · {workspace}</p>
                          <p className="text-xs text-zinc-600">{practices}</p>
                          <p className="pt-1 text-[10px] font-mono uppercase text-zinc-400">
                            Submitted {new Date(request.submittedAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            disabled={decidingUserId !== null}
                            onClick={() => void decideAccessRequest(request, "approved")}
                            className="rounded bg-zinc-950 px-3 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {busy ? "Saving..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            disabled={decidingUserId !== null}
                            onClick={() => void decideAccessRequest(request, "denied")}
                            className="rounded border border-zinc-300 px-3 py-2 text-[10px] font-mono font-bold uppercase hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Deny
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {accessAdminError && (
              <div role="alert" className="flex items-center justify-between gap-4 rounded border border-zinc-300 bg-zinc-50 px-4 py-3 text-xs">
                <span>{accessAdminError}</span>
                <button
                  type="button"
                  disabled={accessAdminLoading || decidingUserId !== null}
                  onClick={() => void loadAccessAdministration()}
                  className="shrink-0 rounded border border-zinc-300 px-3 py-2 text-[9px] font-mono font-bold uppercase hover:border-zinc-900 disabled:opacity-50"
                >
                  Retry
                </button>
              </div>
            )}
          </section>
        )}

        {isAdmin && (
          <>
            <section className="space-y-4 rounded border border-zinc-200 p-5 sm:p-6">
              <div>
                <h3 className="text-xs font-bold uppercase">Firm invitation code</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Share this code with users who should join this Firm as Members.
                </p>
              </div>
              {adminLoading ? (
                <p className="text-xs text-zinc-500">Loading invitation code...</p>
              ) : adminLoaded ? (
                <>
                  <label className="block">
                    <span className="text-[10px] font-mono font-bold uppercase text-zinc-500">
                      Current code
                    </span>
                    <input
                      readOnly
                      value={invitationCode || "No invitation code"}
                      className="mt-1 w-full rounded border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-sm"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {invitationCode && (
                      <button
                        type="button"
                        onClick={copyInvitationCode}
                        className="inline-flex items-center gap-2 rounded border border-zinc-300 px-4 py-2 text-[10px] font-mono font-bold uppercase hover:border-zinc-900"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copied ? "Copied" : "Copy"}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={generatingCode}
                      onClick={generateInvitationCode}
                      className="inline-flex items-center gap-2 rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${generatingCode ? "animate-spin" : ""}`} />
                      {generatingCode
                        ? "Generating..."
                        : invitationCode
                          ? "Regenerate code"
                          : "Generate code"}
                    </button>
                  </div>
                </>
              ) : null}
              {codeError && <p role="alert" className="text-xs text-red-700">{codeError}</p>}
            </section>

            <section className="space-y-4 rounded border border-zinc-200 p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <div>
                  <h3 className="text-xs font-bold uppercase">Firm members</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Users with access to this Firm workspace.
                  </p>
                </div>
              </div>
              {adminLoading ? (
                <p className="text-xs text-zinc-500">Loading Firm members...</p>
              ) : adminLoaded ? (
                <div className="overflow-x-auto rounded border border-zinc-200">
                  <table className="w-full min-w-[620px] text-left text-xs">
                    <thead className="border-b border-zinc-200 bg-zinc-50 font-mono text-[9px] uppercase text-zinc-500">
                      <tr>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Email</th>
                        <th className="px-3 py-2">Professional role</th>
                        <th className="px-3 py-2">Firm role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member) => (
                        <tr key={member.id} className="border-b border-zinc-100 last:border-0">
                          <td className="px-3 py-2.5">{member.name || "—"}</td>
                          <td className="px-3 py-2.5">{member.email}</td>
                          <td className="px-3 py-2.5">
                            {professionalRole(
                              member.professionalRole,
                              member.customProfessionalRole
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {member.firmRole === "admin" ? "Admin" : "Member"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {members.length === 0 && (
                    <p className="px-3 py-5 text-center text-xs text-zinc-500">
                      No Firm users were found.
                    </p>
                  )}
                </div>
              ) : null}
            </section>
          </>
        )}

        {isAdmin && adminError && (
          <div role="alert" className="flex items-center justify-between gap-4 rounded border border-zinc-300 bg-zinc-50 px-4 py-3 text-xs">
            <span>{adminError}</span>
            <button
              type="button"
              disabled={adminLoading}
              onClick={() => void loadAdminSettings()}
              className="shrink-0 rounded border border-zinc-300 px-3 py-2 text-[9px] font-mono font-bold uppercase hover:border-zinc-900 disabled:opacity-50"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
