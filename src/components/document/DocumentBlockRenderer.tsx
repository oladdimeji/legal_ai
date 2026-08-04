import React from "react";
import type { DocumentBlock, ListItem } from "../../../shared/document/documentTypes";
import DocumentInlineContent from "./DocumentInlineContent";
import DocumentTable from "./DocumentTable";

type ListTreeItem = ListItem & { children: ListTreeItem[] };

function listTree(items: ListItem[]): ListTreeItem[] {
  const roots: ListTreeItem[] = [];
  const stack: ListTreeItem[] = [];
  for (const item of items) {
    const node: ListTreeItem = { ...item, children: [] };
    while (stack.length > item.level) stack.pop();
    const parent = item.level > 0 ? stack[item.level - 1] : undefined;
    (parent?.children ?? roots).push(node);
    stack[item.level] = node;
    stack.length = item.level + 1;
  }
  return roots;
}

function DocumentList({ block }: { block: Extract<DocumentBlock, { type: "orderedList" | "unorderedList" }> }) {
  const renderLevel = (items: ListTreeItem[], ordered: boolean, start?: number): React.ReactNode => {
    const Tag = ordered ? "ol" : "ul";
    return <Tag start={ordered ? start : undefined}>{items.map((item, index) => <li key={index} value={item.ordered ? item.marker : undefined}><DocumentInlineContent content={item.content} />{item.children.length > 0 && renderLevel(item.children, item.children[0].ordered, item.children[0].marker)}</li>)}</Tag>;
  };
  return <>{renderLevel(listTree(block.items), block.type === "orderedList", block.type === "orderedList" ? block.start : undefined)}</>;
}

export default function DocumentBlockRenderer({ block }: { block: DocumentBlock }) {
  if (block.type === "pageBreak") return null;
  if (block.type === "table") return <DocumentTable table={block} />;
  if (block.type === "orderedList" || block.type === "unorderedList") return <DocumentList block={block} />;
  if (block.type === "paragraph") return <p><DocumentInlineContent content={block.content} /></p>;
  if (block.type === "blockquote") return <blockquote><DocumentInlineContent content={block.content} /></blockquote>;
  if (block.type === "codeBlock") return <pre data-language={block.language}><code>{block.text}</code></pre>;
  const Heading = `h${block.level}` as keyof React.JSX.IntrinsicElements;
  return <Heading><DocumentInlineContent content={block.content} /></Heading>;
}
