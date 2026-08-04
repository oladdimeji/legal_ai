import React, { useMemo } from "react";
import { compileDocument } from "../../../shared/document/compileDocument";
import { DOCUMENT_THEME } from "../../../shared/document/documentTheme";
import { groupDocumentSections } from "../../../shared/document/documentSections";
import type { DocumentBlock, DocumentOrientation } from "../../../shared/document/documentTypes";
import DocumentSection from "./DocumentSection";

export interface DocumentPreviewProps { title: string; content: string; className?: string; ariaLabel?: string }
type PreviewSection = { orientation: DocumentOrientation; blocks: DocumentBlock[] };

export function previewDocumentSections(blocks: DocumentBlock[]): PreviewSection[] {
  const result: PreviewSection[] = [];
  for (const group of groupDocumentSections(blocks)) {
    let current: PreviewSection = { orientation: group.orientation, blocks: [] };
    const push = () => {
      if (current.blocks.length || result.length === 0) result.push(current);
      current = { orientation: group.orientation, blocks: [] };
    };
    for (const { block } of group.entries) {
      if (block.type === "pageBreak") { push(); continue; }
      if (block.type !== "table" && "pageBreakBefore" in block && block.pageBreakBefore && current.blocks.length) push();
      current.blocks.push(block);
    }
    if (current.blocks.length) result.push(current);
  }
  return result.length ? result : [{ orientation: "portrait", blocks: [] }];
}

export default function DocumentPreview({ title, content, className = "", ariaLabel }: DocumentPreviewProps) {
  const compiled = useMemo(() => compileDocument(title, content), [title, content]);
  const sections = useMemo(() => previewDocumentSections(compiled.blocks), [compiled.blocks]);
  const variables = {
    "--document-font": DOCUMENT_THEME.font.bodyFamily,
    "--document-mono-font": DOCUMENT_THEME.font.monospaceFamily,
    "--document-body-size": `${DOCUMENT_THEME.font.bodySizePt}pt`,
    "--document-canvas": `#${DOCUMENT_THEME.page.canvasColor}`,
    "--document-border": `#${DOCUMENT_THEME.page.borderColor}`,
    "--document-text": `#${DOCUMENT_THEME.color.text}`,
    "--document-muted": `#${DOCUMENT_THEME.color.muted}`,
    "--document-fill": `#${DOCUMENT_THEME.color.subtleFill}`,
    "--document-link": `#${DOCUMENT_THEME.color.link}`,
  } as React.CSSProperties;
  return <article className={`document-preview ${className}`.trim()} aria-label={ariaLabel ?? `${compiled.title} document preview`} style={variables}>{sections.map((section, index) => <DocumentSection key={index} title={compiled.title} orientation={section.orientation} blocks={section.blocks} showTitle={index === 0} />)}</article>;
}
