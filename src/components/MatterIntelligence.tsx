import React, { useEffect, useState } from "react";
import { AlertTriangle, Download, Edit, RefreshCw, Save, Sparkles } from "lucide-react";
import { MatterIntelligenceRecord } from "../types";
import FormattedMarkdown from "./FormattedMarkdown";
import RichDocumentEditor from "./RichDocumentEditor";

export default function MatterIntelligence({ matterId, googleDriveExportEnabled = false }: { matterId: string; googleDriveExportEnabled?: boolean }) {
  const [record, setRecord] = useState<MatterIntelligenceRecord | null>(null);
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const response = await fetch(`/api/cases/${matterId}/intelligence`);
    if (response.ok) {
      const data = await response.json();
      setRecord(data);
      setContent(data?.content || "");
    }
    setLoaded(true);
  };

  useEffect(() => { void load(); }, [matterId]);

  const generate = async () => {
    if (record && !confirm("Regenerate Matter Intelligence using the current active Sources?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/cases/${matterId}/intelligence/generate`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Generation failed");
      setRecord(data);
      setContent(data.content);
      setEditing(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!record || !content.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/cases/${matterId}/intelligence`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Save failed");
      setRecord({ ...data, sources_changed: record.sources_changed });
      setEditing(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const exportToDrive = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/cases/${matterId}/intelligence/export/drive`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Drive export failed.");
      if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Drive export failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <p className="py-16 text-center text-xs font-mono uppercase text-zinc-400">Loading Matter Intelligence...</p>;
  if (!record) {
    return (
      <div className="mx-auto max-w-2xl rounded border border-dashed p-16 text-center">
        <Sparkles className="mx-auto mb-4 h-8 w-8 text-zinc-300" />
        <h3 className="text-sm font-semibold uppercase">Matter Intelligence</h3>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-zinc-500">
          Generate a source-backed working analysis from the active Matter Sources when you are ready.
        </p>
        <button onClick={() => void generate()} disabled={busy} className="mt-6 rounded bg-zinc-950 px-5 py-2.5 text-[10px] font-mono font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "Generating..." : "Generate Matter Intelligence"}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {record.sources_changed && (
        <div className="flex items-center gap-2 rounded border border-zinc-300 p-3 text-xs">
          <AlertTriangle className="h-4 w-4" />
          <strong>Sources have changed since this Matter Intelligence was generated.</strong>
        </div>
      )}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase">Matter Intelligence</h3>
          <p className="mt-1 text-[9px] font-mono uppercase text-zinc-400">
            Generated {new Date(record.generated_at).toLocaleString()} · Edited {new Date(record.last_edited_at).toLocaleString()} · Internal version {record.version}
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/cases/${matterId}/intelligence/export`} className="flex items-center gap-1 rounded border px-4 py-2 text-[10px] font-mono font-bold uppercase hover:bg-zinc-50">
            <Download className="h-3.5 w-3.5" />Export .docx
          </a>
          {googleDriveExportEnabled && (
            <button onClick={() => void exportToDrive()} disabled={busy} className="flex items-center gap-1 rounded border px-4 py-2 text-[10px] font-mono font-bold uppercase hover:bg-zinc-50 disabled:opacity-50">
              <Download className="h-3.5 w-3.5" />Export to Drive
            </button>
          )}
          {editing ? (
            <button onClick={() => void save()} disabled={busy} className="flex items-center gap-1 rounded bg-zinc-950 px-4 py-2 text-[10px] font-mono font-bold uppercase text-white disabled:cursor-not-allowed disabled:opacity-50">
              <Save className="h-3.5 w-3.5" />{busy ? "Saving..." : "Save"}
            </button>
          ) : (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 rounded border px-4 py-2 text-[10px] font-mono font-bold uppercase hover:bg-zinc-50">
              <Edit className="h-3.5 w-3.5" />Edit
            </button>
          )}
          <button onClick={() => void generate()} disabled={busy} className="flex items-center gap-1 rounded border px-4 py-2 text-[10px] font-mono font-bold uppercase hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />{busy ? "Regenerating..." : "Regenerate"}
          </button>
        </div>
      </header>
      {editing ? (
        <RichDocumentEditor value={content} onChange={setContent} minHeight={650} />
      ) : (
        <article className="min-h-[500px] rounded border border-zinc-200 bg-white p-8">
          <FormattedMarkdown content={content} />
        </article>
      )}
    </div>
  );
}
