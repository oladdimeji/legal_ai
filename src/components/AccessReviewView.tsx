import React, { useEffect, useState } from "react";

type Decision = "approved" | "denied";
type ReviewState =
  | { state: "loading" }
  | { state: "invalid" }
  | { state: "completed"; decision: Decision }
  | {
      state: "pending";
      expiresAt: string;
      applicant: {
        userId: string;
        fullName: string;
        email: string;
        professionalRole: string;
        customProfessionalRole: string | null;
        workspaceType: string;
        firmName: string | null;
        practiceAreas: string[];
        customPracticeArea: string | null;
        submittedAt: string;
      };
    };

export default function AccessReviewView({ token }: { token: string }) {
  const [review, setReview] = useState<ReviewState>({ state: "loading" });
  const [confirming, setConfirming] = useState<Decision | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/access-reviews/${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as ReviewState;
        if (!cancelled) setReview(response.ok ? data : { state: "invalid" });
      } catch {
        if (!cancelled) setReview({ state: "invalid" });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async () => {
    if (!confirming) return;
    const decision = confirming;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(
        `/api/access-reviews/${encodeURIComponent(token)}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        }
      );
      const data = (await response.json()) as { state?: string; decision?: Decision; error?: string };
      if (!response.ok && response.status !== 409) {
        throw new Error(data.error || "The access decision could not be saved.");
      }
      setReview({ state: "completed", decision: data.decision || decision });
      setConfirming(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The access decision could not be saved.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-white px-6 py-12 text-zinc-950">
      <section className="mx-auto w-full max-w-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Exepts access review
        </p>
        {review.state === "loading" && <p className="mt-6 text-sm text-zinc-600">Loading request...</p>}
        {review.state === "invalid" && (
          <>
            <h1 className="mt-4 text-3xl font-semibold">Request unavailable</h1>
            <p className="mt-4 text-sm text-zinc-600">
              This review request is invalid, expired, or has been superseded.
            </p>
          </>
        )}
        {review.state === "completed" && (
          <>
            <h1 className="mt-4 text-3xl font-semibold">Review completed</h1>
            <p className="mt-4 text-sm text-zinc-600">
              This request was already {review.decision === "approved" ? "approved" : "denied"}. No further action is available.
            </p>
          </>
        )}
        {review.state === "pending" && (
          <>
            <h1 className="mt-4 text-3xl font-semibold">Review access request</h1>
            <dl className="mt-6 divide-y divide-zinc-200 border-y border-zinc-200 text-sm">
              {[
                ["Full name", review.applicant.fullName],
                ["Verified email", review.applicant.email],
                ["Professional role", review.applicant.professionalRole],
                ["Custom professional role", review.applicant.customProfessionalRole],
                ["Workspace type", review.applicant.workspaceType],
                ["Firm name", review.applicant.firmName],
                ["Practice areas", review.applicant.practiceAreas.join(", ")],
                ["Custom practice area", review.applicant.customPracticeArea],
                ["Submission timestamp", review.applicant.submittedAt],
                ["Internal user ID", review.applicant.userId],
              ].filter(([, value]) => Boolean(value)).map(([label, value]) => (
                <div key={label as string} className="grid gap-1 py-3 sm:grid-cols-[180px_1fr]">
                  <dt className="text-zinc-500">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
            {!confirming ? (
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button type="button" onClick={() => setConfirming("approved")} className="bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white">
                  Approve access
                </button>
                <button type="button" onClick={() => setConfirming("denied")} className="border border-zinc-300 px-4 py-2.5 text-sm font-medium">
                  Deny access
                </button>
              </div>
            ) : (
              <div className="mt-8 border border-zinc-300 bg-zinc-50 p-4">
                <p className="text-sm font-medium">
                  Confirm that you want to {confirming === "approved" ? "approve" : "deny"} this account.
                </p>
                <div className="mt-4 flex gap-3">
                  <button type="button" onClick={() => void submit()} disabled={submitting} className="bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                    {submitting ? "Saving..." : `Confirm ${confirming === "approved" ? "approval" : "denial"}`}
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} disabled={submitting} className="border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-50">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
