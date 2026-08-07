import React, { useState } from "react";
import { Account, ProfessionalRole, WorkspaceType } from "../types";

interface OnboardingViewProps {
  account: Account | null;
  onCompleted?: (account: Account) => void;
  publicMode?: boolean;
  onPublicRequestSubmitted?: (email: string) => void;
}

const roles: ProfessionalRole[] = [
  "Lawyer",
  "Paralegal",
  "Legal Assistant",
  "Legal Operations",
  "Other",
];
const practiceAreaOptions = [
  "Litigation",
  "Corporate and Commercial",
  "Real Estate",
  "Employment",
  "Family Law",
  "Criminal Law",
  "Intellectual Property",
  "Tax",
  "Regulatory and Compliance",
  "Other",
];

export default function OnboardingView({
  account,
  onCompleted,
  publicMode = false,
  onPublicRequestSubmitted,
}: OnboardingViewProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState(account?.user.name || "");
  const [professionalRole, setProfessionalRole] = useState<ProfessionalRole | "">("");
  const [customProfessionalRole, setCustomProfessionalRole] = useState("");
  const [workspaceType, setWorkspaceType] = useState<WorkspaceType | "">("");
  const [invitationCode, setInvitationCode] = useState("");
  const [practiceAreas, setPracticeAreas] = useState<string[]>([]);
  const [customPracticeArea, setCustomPracticeArea] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const togglePracticeArea = (area: string) => {
    setPracticeAreas((current) =>
      current.includes(area) ? current.filter((item) => item !== area) : [...current, area]
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (publicMode) {
        const response = await fetch("/api/access/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            name,
            professionalRole,
            customProfessionalRole,
            workspaceType,
            invitationCode,
            practiceAreas,
            customPracticeArea,
          }),
        });
        const data = (await response.json()) as { error?: string; message?: string };
        if (!response.ok) {
          throw new Error(data.error || data.message || "Unable to submit your access request.");
        }
        onPublicRequestSubmitted?.(email);
        return;
      }
      const response = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          professionalRole,
          customProfessionalRole,
          workspaceType,
          invitationCode,
          practiceAreas,
          customPracticeArea,
        }),
      });
      const data = (await response.json()) as { account?: Account; error?: string };
      if (!response.ok || !data.account) {
        throw new Error(data.error || "Unable to complete onboarding.");
      }
      onCompleted?.(data.account);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to complete onboarding.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 text-zinc-950">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-tight">Exepts</p>
          <p className="mt-1 text-[10px] font-mono uppercase text-zinc-500">
            Set up your workspace
          </p>
        </div>
        <form onSubmit={submit} className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 p-7 sm:p-9">
            <h1 className="text-3xl font-semibold tracking-tight">
              {publicMode ? "Request access to Exepts" : "A few details before you begin"}
            </h1>
            <p className="mt-2 text-sm text-zinc-500">
              {publicMode
                ? "Tell us a little about how you plan to use Exepts. We’ll review your request and contact you at the email provided."
                : "This information helps configure your Exepts workspace."}
            </p>
          </div>

          <div className="space-y-8 p-7 sm:p-9">
            {publicMode && (
              <label className="block space-y-2">
                <span className="text-[10px] font-mono font-semibold uppercase text-zinc-500">
                  Email
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  placeholder="you@firm.com"
                  className="w-full rounded border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-zinc-950"
                />
              </label>
            )}

            <label className="block space-y-2">
              <span className="text-[10px] font-mono font-semibold uppercase text-zinc-500">
                Full name
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
                className="w-full rounded border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-zinc-950"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-[10px] font-mono font-semibold uppercase text-zinc-500">
                Professional role
              </span>
              <select
                value={professionalRole}
                onChange={(event) => setProfessionalRole(event.target.value as ProfessionalRole)}
                required
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-zinc-950"
              >
                <option value="">Select your role</option>
                {roles.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </label>
            {professionalRole === "Other" && (
              <input
                value={customProfessionalRole}
                onChange={(event) => setCustomProfessionalRole(event.target.value)}
                required
                maxLength={80}
                placeholder="Your professional role"
                className="w-full rounded border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-zinc-950"
              />
            )}

            <fieldset className="space-y-3">
              <legend className="text-[10px] font-mono font-semibold uppercase text-zinc-500">
                Workspace setup
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { value: "firm" as const, label: "Join an existing firm", detail: "Use a Firm invitation code." },
                  { value: "independent" as const, label: "Use Exepts independently", detail: "Create a Personal Workspace." },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded border p-4 ${
                      workspaceType === option.value ? "border-zinc-950 bg-zinc-50" : "border-zinc-200"
                    }`}
                  >
                    <input
                      type="radio"
                      name="workspaceType"
                      value={option.value}
                      checked={workspaceType === option.value}
                      onChange={() => setWorkspaceType(option.value)}
                      className="mr-2"
                      required
                    />
                    <span className="text-sm font-semibold">{option.label}</span>
                    <p className="ml-5 mt-1 text-xs text-zinc-500">{option.detail}</p>
                  </label>
                ))}
              </div>
              {workspaceType === "firm" && (
                <input
                  value={invitationCode}
                  onChange={(event) => setInvitationCode(event.target.value.toUpperCase())}
                  required
                  placeholder="Firm invitation code"
                  autoComplete="off"
                  className="w-full rounded border border-zinc-300 px-3 py-2.5 font-mono text-sm uppercase outline-none focus:border-zinc-950"
                />
              )}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-[10px] font-mono font-semibold uppercase text-zinc-500">
                Practice areas <span className="font-normal normal-case">(optional)</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {practiceAreaOptions.map((area) => (
                  <button
                    key={area}
                    type="button"
                    onClick={() => togglePracticeArea(area)}
                    className={`rounded-full border px-3 py-2 text-xs ${
                      practiceAreas.includes(area)
                        ? "border-zinc-950 bg-zinc-950 text-white"
                        : "border-zinc-300 bg-white hover:border-zinc-950"
                    }`}
                  >
                    {area}
                  </button>
                ))}
              </div>
              {practiceAreas.includes("Other") && (
                <input
                  value={customPracticeArea}
                  onChange={(event) => setCustomPracticeArea(event.target.value)}
                  required
                  maxLength={80}
                  placeholder="Other practice area"
                  className="w-full rounded border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-zinc-950"
                />
              )}
            </fieldset>

            {error && (
              <div role="alert" className="rounded border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-xs">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded bg-zinc-950 px-5 py-3 text-xs font-mono font-semibold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {submitting ? "Submitting access request..." : publicMode ? "Submit access request" : "Submit access request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
