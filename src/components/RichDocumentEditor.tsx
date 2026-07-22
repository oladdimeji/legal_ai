import React, { useLayoutEffect, useRef } from "react";
import { Bold, Italic, Link as LinkIcon, List, ListOrdered, Redo2, Type, Underline, Undo2 } from "lucide-react";
import { editorHtmlToMarkdown, markdownToEditorHtml } from "../lib/richMarkdown";

interface Props {
  value: string;
  onChange: (markdown: string) => void;
  minHeight?: number;
}

export default function RichDocumentEditor({ value, onChange, minHeight = 520 }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!editorRef.current || value === lastValueRef.current) return;
    editorRef.current.innerHTML = markdownToEditorHtml(value);
    lastValueRef.current = value;
  }, [value]);

  const emitChange = () => {
    if (!editorRef.current) return;
    const markdown = editorHtmlToMarkdown(editorRef.current.innerHTML);
    lastValueRef.current = markdown;
    onChange(markdown);
  };

  const command = (name: string, argument?: string) => {
    editorRef.current?.focus();
    document.execCommand(name, false, argument);
    emitChange();
  };

  const addLink = () => {
    const url = window.prompt("Link URL");
    if (!url || !/^(https?:\/\/|mailto:)/i.test(url)) return;
    command("createLink", url);
  };

  return (
    <div className="min-h-full rounded border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 bg-zinc-50 p-2">
        <select
          className="h-8 rounded border border-zinc-300 bg-white px-2 text-xs"
          title="Paragraph style"
          onChange={(event) => {
            const value = event.target.value;
            if (value) command("formatBlock", value);
            event.target.value = "";
          }}
        >
          <option value="">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="blockquote">Quote</option>
        </select>
        <ToolbarButton title="Bold" onClick={() => command("bold")}><Bold className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton title="Italic" onClick={() => command("italic")}><Italic className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton title="Underline" onClick={() => command("underline")}><Underline className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton title="Bulleted list" onClick={() => command("insertUnorderedList")}><List className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton title="Numbered list" onClick={() => command("insertOrderedList")}><ListOrdered className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton title="Link" onClick={addLink}><LinkIcon className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton title="Undo" onClick={() => command("undo")}><Undo2 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton title="Redo" onClick={() => command("redo")}><Redo2 className="h-4 w-4" /></ToolbarButton>
        <span className="ml-auto hidden items-center gap-1 text-[10px] font-mono uppercase text-zinc-400 sm:flex"><Type className="h-3.5 w-3.5" />Document editor</span>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={emitChange}
        onBlur={emitChange}
        onPaste={() => window.setTimeout(emitChange, 0)}
        className="rich-document-editor prose prose-zinc max-w-none overflow-y-auto bg-white p-8 text-sm leading-relaxed text-zinc-900 outline-none"
        style={{ minHeight }}
      />
    </div>
  );
}

function ToolbarButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="rounded border border-zinc-300 bg-white p-1.5 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
    >
      {children}
    </button>
  );
}
