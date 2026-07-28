import React from "react";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <div className="flex min-h-48 items-center justify-center p-8" role="status" aria-live="polite"><span className="text-xs font-mono uppercase text-zinc-500">{label}</span></div>;
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return <section className="rounded border border-dashed border-zinc-300 p-10 text-center"><h2 className="text-sm font-semibold">{title}</h2>{detail && <p className="mt-2 text-xs text-zinc-500">{detail}</p>}</section>;
}

export function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return <section className="rounded border border-zinc-300 bg-zinc-50 p-6" role="alert"><h1 className="text-sm font-semibold">{title}</h1>{detail && <p className="mt-2 text-xs text-zinc-600">{detail}</p>}</section>;
}
