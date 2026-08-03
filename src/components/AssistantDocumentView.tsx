import React, { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { AssistantDocument } from "../types";
import { useWorkspacePageContext } from "../lib/WorkspacePageContextProvider";
import DocumentEditorSurface, { DocumentSaveStatus } from "./DocumentEditorSurface";

export default function AssistantDocumentView({ documentId }: { documentId: string }) {
  const { publishPageContext } = useWorkspacePageContext();
  const [document, setDocument] = useState<AssistantDocument | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<DocumentSaveStatus>("idle");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetch(`/api/assistant-documents/${encodeURIComponent(documentId)}`).then(async (response) => {
      const data = await response.json();
      if (cancelled) return;
      if (!response.ok) {
        setError(data.error || "Document could not be loaded");
      } else {
        setDocument(data);
        setTitle(data.title);
        setContent(data.content);
      }
      setLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setError("Document could not be loaded");
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    publishPageContext({
      routeKind: "assistantDocument",
      pageTitle: document?.title || "Assistant document",
      activeSection: "Document editor",
      selectedItem: document ? { kind: "assistantDocument", id: document.id, title: document.title } : undefined,
      visibleActions: [
        { id: "save-assistant-document", label: "Save", description: "Saves title and content edits to this private assistant document." },
        { id: "preview-assistant-document", label: "Preview", description: "Shows a read-only formatted preview of the current document content." },
        { id: "download-assistant-document", label: "Download .docx", description: "Downloads this document as a genuine Microsoft Word .docx file." },
      ],
    });
  }, [document, publishPageContext]);

  const save = async () => {
    if (!document || !title.trim()) return;
    setSaving(true);
    setSaveStatus("saving");
    try {
      const response = await fetch(`/api/assistant-documents/${encodeURIComponent(document.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Document could not be saved");
      setDocument(data);
      setTitle(data.title);
      setContent(data.content);
      setSaveStatus("saved");
      window.setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex h-full items-center justify-center text-xs font-mono uppercase text-zinc-500">Loading document...</div>;
  if (!document || error) {
    return <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"><FileText className="h-10 w-10 text-zinc-300" /><p className="text-sm font-semibold text-zinc-900">Document unavailable</p><p className="text-xs text-zinc-500">{error || "This document could not be found."}</p></div>;
  }

  return (
    <DocumentEditorSurface
      title={title}
      onTitleChange={setTitle}
      content={content}
      onContentChange={setContent}
      updatedAt={document.updated_at}
      detail="Private assistant document"
      onSave={() => void save()}
      saving={saving}
      saveStatus={saveStatus}
      exportUrl={`/api/assistant-documents/${encodeURIComponent(document.id)}/export`}
      idPrefix="assistant-document"
    />
  );
}
