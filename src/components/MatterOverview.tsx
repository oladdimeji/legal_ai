import React, { useEffect, useState } from "react";
import { Case } from "../types";

export default function MatterOverview({ matter, onChange }: { matter: Case; onChange: (matter: Case) => void }) {
  const [form, setForm] = useState(matter);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => { setForm(matter); setEditing(false); }, [matter]);

  const set = (key: keyof Case, value: string | boolean | null) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    setStatus("idle");
    try {
      const response = await fetch(`/api/cases/${matter.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      onChange(data);
      setEditing(false);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1800);
    } catch (error) {
      setStatus("error");
      alert(error instanceof Error ? error.message : "Matter could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setForm(matter);
    setEditing(false);
    setStatus("idle");
  };

  const suggestion = (flag: "matter_type_suggested" | "jurisdiction_suggested" | "objectives_suggested") =>
    Boolean(form[flag]) ? <span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 text-[9px] font-mono uppercase text-zinc-500">Suggested</span> : null;

  if (!editing) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase">Matter Overview</h3>
            {status === "saved" && <p className="mt-1 text-xs text-zinc-500">Overview saved.</p>}
          </div>
          <button onClick={() => setEditing(true)} className="rounded border px-4 py-2 text-[10px] font-mono font-bold uppercase hover:bg-zinc-50 cursor-pointer">Edit Overview</button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Value label="Matter name" value={matter.name} />
          <Value label="Client" value={matter.client_name || "-"} />
          <Value label="Matter type or practice area" value={matter.matter_type || "-"} extra={suggestion("matter_type_suggested")} />
          <Value label="Jurisdiction" value={matter.jurisdiction || "-"} extra={suggestion("jurisdiction_suggested")} />
          <Value label="Matter status" value={matter.status || "Open"} />
          <Value label="Assignment description" value={matter.description || "-"} />
          <Value label="Preliminary objectives" value={matter.preliminary_objectives || "-"} extra={suggestion("objectives_suggested")} wide />
        </div>
      </div>
    );
  }

  const suggestionControls = (field: "matter_type" | "jurisdiction" | "preliminary_objectives", flag: "matter_type_suggested" | "jurisdiction_suggested" | "objectives_suggested") =>
    Boolean(form[flag]) && form[field] ? <div className="mt-2 flex items-center gap-2 text-[9px] font-mono uppercase"><span className="rounded bg-zinc-100 px-2 py-1">AI suggested</span><button type="button" onClick={() => set(flag, false)} className="underline cursor-pointer">Confirm</button><button type="button" onClick={() => { set(field, null); set(flag, false); }} className="underline cursor-pointer">Remove</button></div> : null;

  return <div className="mx-auto max-w-3xl space-y-5"><div className="grid gap-4 md:grid-cols-2"><Field label="Matter name" value={form.name} onChange={(v) => set("name", v)} /><Field label="Client" value={form.client_name || ""} onChange={(v) => set("client_name", v)} /><Field label="Matter type or practice area" value={form.matter_type || ""} onChange={(v) => { set("matter_type", v); set("matter_type_suggested", false); }} extra={suggestionControls("matter_type", "matter_type_suggested")} /><Field label="Jurisdiction" value={form.jurisdiction || ""} onChange={(v) => { set("jurisdiction", v); set("jurisdiction_suggested", false); }} extra={suggestionControls("jurisdiction", "jurisdiction_suggested")} /><label className="md:col-span-2 text-[10px] font-mono font-bold uppercase text-zinc-500">Preliminary objectives<textarea value={form.preliminary_objectives || ""} onChange={(e) => { set("preliminary_objectives", e.target.value); set("objectives_suggested", false); }} className="mt-1 h-28 w-full rounded border px-3 py-2 text-sm font-sans font-normal normal-case" />{suggestionControls("preliminary_objectives", "objectives_suggested")}</label><label className="text-[10px] font-mono font-bold uppercase text-zinc-500">Status<select value={form.status || "Open"} onChange={(e) => set("status", e.target.value)} className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm font-sans font-normal normal-case"><option>Open</option><option>Waiting for Client</option><option>On Hold</option><option>Closed</option></select></label></div><div className="flex items-center justify-between"><span className="text-xs text-zinc-500">{status === "error" ? "Save failed." : ""}</span><div className="flex gap-2"><button onClick={cancel} disabled={saving} className="rounded border px-4 py-2 text-[10px] font-mono font-bold uppercase hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">Cancel</button><button onClick={() => void save()} disabled={saving} className="rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving..." : "Save"}</button></div></div></div>;
}

function Value({ label, value, extra, wide }: { label: string; value: string; extra?: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? "md:col-span-2" : ""}><p className="text-[10px] font-mono font-bold uppercase text-zinc-500">{label}{extra}</p><p className="mt-1 rounded border border-zinc-200 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-850">{value}</p></div>;
}
function Field({ label, value, onChange, extra }: { label: string; value: string; onChange: (value: string) => void; extra?: React.ReactNode }) { return <label className="text-[10px] font-mono font-bold uppercase text-zinc-500">{label}<input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded border px-3 py-2 text-sm font-sans font-normal normal-case" />{extra}</label>; }
