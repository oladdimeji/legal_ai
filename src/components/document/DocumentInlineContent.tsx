import React from "react";
import type { InlineContent } from "../../../shared/document/documentTypes";

function MarkedText({ node }: { node: Extract<InlineContent, { type: "text" }> }) {
  let result: React.ReactNode = node.text;
  if (node.code) result = <code>{result}</code>;
  if (node.underline) result = <u>{result}</u>;
  if (node.italic) result = <em>{result}</em>;
  if (node.bold) result = <strong>{result}</strong>;
  return result;
}

export default function DocumentInlineContent({ content }: { content: InlineContent[] }) {
  return content.map((node, index) => {
    if (node.type === "hardBreak") return <br key={index} />;
    if (node.type === "text") return <MarkedText key={index} node={node} />;
    return <a key={index} href={node.url} target="_blank" rel="noopener noreferrer"><DocumentInlineContent content={node.content} /></a>;
  });
}
