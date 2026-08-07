import React from "react";
import { ArrowRight } from "lucide-react";

interface AccessRequestSubmittedViewProps {
  submittedEmail?: string | null;
  onReturnHome: () => void;
}

export default function AccessRequestSubmittedView({
  submittedEmail,
  onReturnHome,
}: AccessRequestSubmittedViewProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-12 text-zinc-950">
      <section className="w-full max-w-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Exepts access</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Your access request has been submitted</h1>
        <p className="mt-4 text-sm leading-6 text-zinc-600">
          Thank you for your interest in Exepts. We’ll review your request and email you once a decision has been made.
        </p>
        {submittedEmail ? (
          <div className="mt-6 border border-zinc-200 bg-zinc-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Submitted email</p>
            <p className="mt-1 text-sm font-medium">{submittedEmail}</p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onReturnHome}
          className="mt-8 inline-flex items-center gap-2 rounded bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Return to homepage <ArrowRight className="h-4 w-4" />
        </button>
      </section>
    </main>
  );
}
