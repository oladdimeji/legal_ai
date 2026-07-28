import React from "react";
import { Link, Outlet } from "react-router-dom";

export default function PublicLayout() {
  return <div className="min-h-screen bg-white text-zinc-950">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3">Skip to content</a>
    <header className="border-b border-zinc-200"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
      <Link to="/" className="text-sm font-semibold uppercase tracking-tight" aria-label="Exepts home">Exepts</Link>
      <nav aria-label="Public navigation" className="flex items-center gap-2"><Link to="/login" className="rounded px-3 py-2 text-xs font-medium uppercase hover:bg-zinc-100">Log in</Link><Link to="/signup" className="rounded bg-zinc-950 px-4 py-2 text-xs font-medium uppercase text-white hover:bg-zinc-800">Sign up</Link></nav>
    </div></header>
    <main id="main-content"><Outlet /></main>
  </div>;
}
