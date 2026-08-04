import React from "react";
import DocumentPreview from "./document/DocumentPreview";

export default function WorkProductDocument({ title, content, className }: { title: string; content: string; className?: string }) {
  return <DocumentPreview title={title} content={content} className={className} />;
}
