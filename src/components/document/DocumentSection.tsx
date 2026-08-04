import React from "react";
import type { DocumentBlock, DocumentOrientation } from "../../../shared/document/documentTypes";
import DocumentBlockRenderer from "./DocumentBlockRenderer";

export default function DocumentSection({ title, orientation, blocks, showTitle }: { title: string; orientation: DocumentOrientation; blocks: DocumentBlock[]; showTitle: boolean }) {
  return (
    <section className={`document-paper document-paper-${orientation}`} data-orientation={orientation}>
      {showTitle && <h1 className="document-title">{title}</h1>}
      <div className="document-body">{blocks.map((block, index) => <DocumentBlockRenderer key={index} block={block} />)}</div>
    </section>
  );
}
