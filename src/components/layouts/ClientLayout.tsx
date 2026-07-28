import React from "react";
import { Link, Outlet } from "react-router-dom";

export default function ClientLayout() {
  return <div className="min-h-screen bg-white text-zinc-950">
    <a href="#client-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3">Skip to content</a>
    <header className="border-b border-zinc-200 px-5 py-5"><div className="mx-auto flex max-w-5xl items-center justify-between"><Link to="/" className="text-sm font-semibold uppercase">Exepts</Link><span className="text-[10px] font-mono uppercase text-zinc-500">Secure client access</span></div></header>
    <main id="client-content"><Outlet /></main>
  </div>;
}
