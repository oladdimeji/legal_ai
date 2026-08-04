import React, { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Braces, Code, Columns2, Link as LinkIcon,
  List, ListOrdered, Minus, Plus, Quote, Redo2, Rows3, Table2, Trash2, Type, Underline as UnderlineIcon, Undo2,
} from "lucide-react";
import {
  markdownToEditorDocument, normalizeEditorMarkdown, shouldApplyExternalEditorValue,
  isSafeDocumentUrl,
} from "../lib/documentEditorCodec";
import { documentEditorExtensions, readableCellPaste, setSelectedTableColumnAlignment } from "../lib/documentEditorExtensions";

interface Props { title: string; value: string; onChange: (markdown: string) => void; minHeight?: number; ariaLabel?: string }

export default function RichDocumentEditor({ title, value, onChange, minHeight = 520, ariaLabel = "Document editor" }: Props) {
  const onChangeRef = useRef(onChange);
  const titleRef = useRef(title);
  const lastEmittedRef = useRef<string | null>(null);
  const applyingExternalRef = useRef(false);
  onChangeRef.current = onChange;
  titleRef.current = title;

  const editor = useEditor({
    extensions: documentEditorExtensions,
    content: markdownToEditorDocument(title, value),
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: "document-editor-root", "aria-label": ariaLabel },
      handleDrop: (_view, event) => {
        if (!event.dataTransfer?.files.length) return false;
        event.preventDefault();
        return true;
      },
      handlePaste: (view, event) => {
        const $from = view.state.selection.$from;
        const inCell = Array.from({ length: $from.depth + 1 }, (_, offset) => $from.node($from.depth - offset).type.spec.tableRole).some((role) => role === "cell" || role === "header_cell");
        if (!inCell) return false;
        const text = event.clipboardData?.getData("text/plain");
        if (text == null) return false;
        event.preventDefault();
        editor?.chain().focus().insertContent(readableCellPaste(text)).run();
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      if (applyingExternalRef.current) return;
      const markdown = normalizeEditorMarkdown(titleRef.current, current.getJSON());
      if (markdown === lastEmittedRef.current) return;
      lastEmittedRef.current = markdown;
      onChangeRef.current(markdown);
    },
  }, []);

  useEffect(() => {
    if (!editor) return;
    const currentValue = normalizeEditorMarkdown(title, editor.getJSON());
    if (!shouldApplyExternalEditorValue(value, lastEmittedRef.current, currentValue)) return;
    applyingExternalRef.current = true;
    const selection = editor.state.selection;
    editor.commands.setContent(markdownToEditorDocument(title, value), { emitUpdate: false });
    const maximum = editor.state.doc.content.size;
    if (selection.from <= maximum && selection.to <= maximum) editor.commands.setTextSelection({ from: selection.from, to: selection.to });
    lastEmittedRef.current = null;
    applyingExternalRef.current = false;
  }, [editor, title, value]);

  if (!editor) return <div className="document-editor-shell" style={{ minHeight }} aria-label={ariaLabel} />;
  const chain = () => editor.chain().focus();
  const addLink = () => {
    const current = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL (http, https, or mailto)", current ?? "https://");
    if (url === null) return;
    if (!url.trim()) { chain().extendMarkRange("link").unsetLink().run(); return; }
    if (!isSafeDocumentUrl(url)) return;
    chain().extendMarkRange("link").setLink({ href: url }).run();
  };
  const inTable = editor.isActive("table");

  return (
    <div className="document-editor-shell">
      <div className="document-editor-toolbar" role="toolbar" aria-label="Document formatting">
        <select aria-label="Block style" className="document-editor-select" value={editor.isActive("heading") ? `h${editor.getAttributes("heading").level}` : editor.isActive("blockquote") ? "blockquote" : editor.isActive("codeBlock") ? "codeBlock" : "paragraph"} onChange={(event) => {
          const style = event.target.value;
          if (style.startsWith("h")) chain().setHeading({ level: Number(style.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
          else if (style === "blockquote") chain().toggleBlockquote().run();
          else if (style === "codeBlock") chain().toggleCodeBlock().run();
          else chain().setParagraph().run();
        }}>
          <option value="paragraph">Paragraph</option>{[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={`h${level}`}>Heading {level}</option>)}<option value="blockquote">Blockquote</option><option value="codeBlock">Code block</option>
        </select>
        <ToolbarButton label="Bold" active={editor.isActive("bold")} disabled={!editor.can().chain().focus().toggleBold().run()} onClick={() => chain().toggleBold().run()}><Bold /></ToolbarButton>
        <ToolbarButton label="Italic" active={editor.isActive("italic")} disabled={!editor.can().chain().focus().toggleItalic().run()} onClick={() => chain().toggleItalic().run()}><Type /></ToolbarButton>
        <ToolbarButton label="Underline" active={editor.isActive("underline")} disabled={!editor.can().chain().focus().toggleUnderline().run()} onClick={() => chain().toggleUnderline().run()}><UnderlineIcon /></ToolbarButton>
        <ToolbarButton label="Inline code" active={editor.isActive("code")} disabled={!editor.can().chain().focus().toggleCode().run()} onClick={() => chain().toggleCode().run()}><Code /></ToolbarButton>
        <ToolbarButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}><List /></ToolbarButton>
        <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}><ListOrdered /></ToolbarButton>
        <ToolbarButton label="Blockquote" active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()}><Quote /></ToolbarButton>
        <ToolbarButton label="Code block" active={editor.isActive("codeBlock")} onClick={() => chain().toggleCodeBlock().run()}><Braces /></ToolbarButton>
        <ToolbarButton label="Add or edit link" active={editor.isActive("link")} onClick={addLink}><LinkIcon /></ToolbarButton>
        <ToolbarButton label="Remove link" disabled={!editor.isActive("link")} onClick={() => chain().extendMarkRange("link").unsetLink().run()}><Minus /></ToolbarButton>
        <ToolbarButton label="Insert table" disabled={inTable} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 /></ToolbarButton>
        <ToolbarButton label="Undo" disabled={!editor.can().chain().focus().undo().run()} onClick={() => chain().undo().run()}><Undo2 /></ToolbarButton>
        <ToolbarButton label="Redo" disabled={!editor.can().chain().focus().redo().run()} onClick={() => chain().redo().run()}><Redo2 /></ToolbarButton>
      </div>
      {inTable && <div className="document-editor-table-toolbar" role="toolbar" aria-label="Table editing">
        <ToolbarButton label="Add row above" onClick={() => chain().addRowBefore().run()}><Rows3 /><Plus /></ToolbarButton>
        <ToolbarButton label="Add row below" onClick={() => chain().addRowAfter().run()}><Rows3 /><Plus /></ToolbarButton>
        <ToolbarButton label="Delete row" onClick={() => chain().deleteRow().run()}><Rows3 /><Trash2 /></ToolbarButton>
        <ToolbarButton label="Add column left" onClick={() => chain().addColumnBefore().run()}><Columns2 /><Plus /></ToolbarButton>
        <ToolbarButton label="Add column right" onClick={() => chain().addColumnAfter().run()}><Columns2 /><Plus /></ToolbarButton>
        <ToolbarButton label="Delete column" onClick={() => chain().deleteColumn().run()}><Columns2 /><Trash2 /></ToolbarButton>
        <ToolbarButton label="Toggle header row" onClick={() => chain().toggleHeaderRow().run()}><Rows3 /></ToolbarButton>
        <ToolbarButton label="Align selected column left" onClick={() => setSelectedTableColumnAlignment(editor, "left")}><AlignLeft /></ToolbarButton>
        <ToolbarButton label="Align selected column centre" onClick={() => setSelectedTableColumnAlignment(editor, "center")}><AlignCenter /></ToolbarButton>
        <ToolbarButton label="Align selected column right" onClick={() => setSelectedTableColumnAlignment(editor, "right")}><AlignRight /></ToolbarButton>
        <ToolbarButton label="Delete table" onClick={() => chain().deleteTable().run()}><Trash2 /></ToolbarButton>
      </div>}
      <EditorContent editor={editor} className="document-editor-content" style={{ minHeight }} />
    </div>
  );
}

function ToolbarButton({ label, onClick, active = false, disabled = false, children }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled} onClick={onClick} className={`document-editor-button${active ? " is-active" : ""}`}>{children}</button>;
}
