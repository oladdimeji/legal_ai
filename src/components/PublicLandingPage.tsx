import React from "react";
import { Link } from "react-router-dom";

const capabilities = [
  ["Matter-centered", "Keep sources, analysis, Work Product, and collaboration attached to the right Matter."],
  ["Private by design", "Authenticated firm workspaces and scoped retrieval protect client and Matter boundaries."],
  ["Built for legal work", "Research, document understanding, drafting, and review live in one focused workspace."],
];

export default function PublicLandingPage() {
  return <>
    <section className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 md:grid-cols-[1.25fr_.75fr] md:py-28">
      <div><p className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500">Private legal workspace</p><h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">Legal work, grounded in the Matter.</h1><p className="mt-6 max-w-2xl text-base leading-7 text-zinc-600">Exepts brings firm knowledge, Matter Intelligence, Work Product, and secure client collaboration into one disciplined workspace.</p><div className="mt-8 flex flex-wrap gap-3"><Link to="/signup" className="rounded bg-zinc-950 px-5 py-3 text-xs font-semibold uppercase text-white hover:bg-zinc-800">Create workspace</Link><Link to="/login" className="rounded border border-zinc-300 px-5 py-3 text-xs font-semibold uppercase hover:bg-zinc-50">Log in</Link></div></div>
      <aside className="border-l border-zinc-200 pl-6 md:self-end"><p className="text-xs leading-6 text-zinc-600">Purpose-built for counsel who need useful AI assistance without losing control of context, source boundaries, or the final work.</p></aside>
    </section>
    <section aria-labelledby="capabilities-heading" className="border-t border-zinc-200 bg-zinc-50"><div className="mx-auto max-w-6xl px-5 py-16 sm:px-8"><h2 id="capabilities-heading" className="text-sm font-semibold uppercase">A focused working system</h2><div className="mt-8 grid gap-px overflow-hidden rounded border border-zinc-200 bg-zinc-200 md:grid-cols-3">{capabilities.map(([title, detail]) => <article key={title} className="bg-white p-6"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-3 text-xs leading-5 text-zinc-600">{detail}</p></article>)}</div></div></section>
  </>;
}
