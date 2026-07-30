import React, { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Copy,
  LogOut,
  RefreshCw,
  Save,
  Settings,
  Users,
} from "lucide-react";
import { Account, FirmAdminMember, FirmAdminSettings } from "../types";

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
