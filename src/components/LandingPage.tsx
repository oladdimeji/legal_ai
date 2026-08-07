import React from "react";
import { ArrowRight, BookOpen, Briefcase, FileText, MessageSquare, Users } from "lucide-react";

interface LandingPageProps {
  onAuthenticate: () => void;
  onRequestDemo: () => void;
  onClientPortal: () => void;
}

const capabilities = [
  {
    title: "Assistant",
    description: "Research, reason, and draft with context from the workspace you choose.",
    icon: MessageSquare,
  },
  {
    title: "Matters",
    description: "Keep instructions, sources, intelligence, and work product together.",
    icon: Briefcase,
  },
  {
    title: "Firm Library",
    description: "Maintain reusable firm knowledge outside individual Matters.",
    icon: BookOpen,
  },
  {
    title: "Work Product",
    description: "Develop and refine substantive documents inside the legal workflow.",
    icon: FileText,
  },
  {
    title: "Client Collaboration",
    description: "Share selected work and collect focused client responses.",
    icon: Users,
  },
];

export default function LandingPage({ onAuthenticate, onRequestDemo, onClientPortal }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-white text-zinc-950">
      <header className="border-b border-zinc-200">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-10">
          <div>
            <p className="text-base font-semibold uppercase tracking-tight">Exepts</p>
            <p className="mt-0.5 text-[10px] font-mono uppercase tracking-wide text-zinc-500">
              Legal workspace
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClientPortal}
              className="px-4 py-2 text-xs font-semibold text-zinc-700 hover:text-zinc-950"
            >
              Client Portal
            </button>
            <button
              type="button"
              onClick={onAuthenticate}
              className="px-4 py-2 text-xs font-semibold text-zinc-700 hover:text-zinc-950"
            >
              Login
            </button>
            <button
              type="button"
              onClick={onRequestDemo}
              className="rounded bg-zinc-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-zinc-800"
            >
              Request a Demo
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-zinc-200">
          <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1.2fr_0.8fr] lg:px-10 lg:py-28">
            <div className="max-w-3xl">
              <p className="mb-6 text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-zinc-500">
                One private place for legal work
              </p>
              <h1 className="text-5xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
                Move legal work forward with context intact.
              </h1>
              <p className="mt-7 max-w-2xl text-base leading-7 text-zinc-600 sm:text-lg">
                Exepts brings legal assistance, Matter knowledge, firm resources, work product,
                and client collaboration into one focused workspace.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onRequestDemo}
                  className="inline-flex items-center gap-2 rounded bg-zinc-950 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800"
                >
                  Request a Demo <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onAuthenticate}
                  className="rounded border border-zinc-300 px-5 py-3 text-sm font-semibold hover:border-zinc-950"
                >
                  Login
                </button>
              </div>
            </div>
            <div className="flex min-h-72 items-end rounded-lg border border-zinc-200 bg-zinc-50 p-7 sm:p-9">
              <div>
                <div className="mb-8 grid grid-cols-3 gap-2">
                  <div className="h-20 rounded border border-zinc-200 bg-white" />
                  <div className="h-20 rounded border border-zinc-300 bg-zinc-900" />
                  <div className="h-20 rounded border border-zinc-200 bg-white" />
                </div>
                <p className="text-xs font-mono uppercase text-zinc-500">Structured by Matter</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">
                  The right context, kept within the right workspace.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="mb-10 max-w-2xl">
            <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-zinc-500">
              A connected legal workflow
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Core work, without scattered context.
            </h2>
          </div>
          <div className="grid border-l border-t border-zinc-200 sm:grid-cols-2 lg:grid-cols-5">
            {capabilities.map(({ title, description, icon: Icon }) => (
              <article key={title} className="min-h-60 border-b border-r border-zinc-200 p-6">
                <Icon className="h-5 w-5" />
                <h3 className="mt-12 text-sm font-semibold">{title}</h3>
                <p className="mt-3 text-xs leading-5 text-zinc-600">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="bg-zinc-950 text-white">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-6 py-16 sm:flex-row sm:items-center lg:px-10">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-zinc-400">
                Start securely
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                Bring your legal workspace together.
              </h2>
            </div>
            <button
              type="button"
              onClick={onRequestDemo}
              className="inline-flex items-center gap-2 rounded bg-white px-5 py-3 text-sm font-semibold text-zinc-950 hover:bg-zinc-200"
            >
              Request a Demo <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
