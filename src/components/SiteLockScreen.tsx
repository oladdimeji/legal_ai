import React, { useEffect, useMemo, useState } from "react";

interface SiteLockScreenProps {
  reopensAt: string | null;
}

interface CountdownValue {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function countdownValue(target: number, now: number): CountdownValue {
  const totalSeconds = Math.max(0, Math.floor((target - now) / 1000));
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
  };
}

export default function SiteLockScreen({ reopensAt }: SiteLockScreenProps) {
  const target = useMemo(() => {
    if (!reopensAt) return null;
    const timestamp = Date.parse(reopensAt);
    return Number.isFinite(timestamp) ? timestamp : null;
  }, [reopensAt]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (target === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [target]);

  const remaining = target === null ? null : countdownValue(target, now);
  const units = remaining
    ? [
        ["Days", remaining.days],
        ["Hours", remaining.hours],
        ["Minutes", remaining.minutes],
        ["Seconds", remaining.seconds],
      ]
    : [];

  return (
    <div className="flex min-h-screen w-full flex-col bg-white px-6 text-zinc-950 sm:px-10">
      <header className="mx-auto flex h-20 w-full max-w-6xl items-center border-b border-zinc-200">
        <div>
          <p className="text-base font-semibold uppercase tracking-tight">Exepts</p>
          <p className="mt-0.5 text-[10px] font-mono uppercase tracking-wide text-zinc-500">
            Private legal workspace
          </p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 items-center py-16 sm:py-24">
        <div className="w-full max-w-4xl">
          <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Private preview
          </p>
          <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
            {remaining ? "We're almost ready." : "Launching soon."}
          </h1>
          <p className="mt-6 max-w-xl text-sm leading-6 text-zinc-600 sm:text-base sm:leading-7">
            Exepts is currently available to approved accounts while we prepare the public
            experience.
          </p>

          {remaining && (
            <div className="mt-12 grid max-w-3xl grid-cols-2 border-l border-t border-zinc-200 sm:grid-cols-4">
              {units.map(([label, value]) => (
                <div key={label} className="border-b border-r border-zinc-200 px-4 py-6 sm:px-6">
                  <p className="font-mono text-3xl font-semibold tabular-nums sm:text-4xl">
                    {String(value).padStart(2, "0")}
                  </p>
                  <p className="mt-2 text-[10px] font-mono uppercase tracking-wide text-zinc-500">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <footer className="mx-auto flex h-20 w-full max-w-6xl items-center border-t border-zinc-200">
        <a href="/auth" className="text-[10px] font-mono uppercase text-zinc-500 hover:text-zinc-950">
          Private access
        </a>
      </footer>
    </div>
  );
}
