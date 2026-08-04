import type { Document as DocxDocument } from "docx";
import { compileDocument } from "../shared/document/compileDocument.js";
import { renderDocx } from "./docx/renderDocx.js";

export function markdownToDocxDocument(title: string, markdown: string): DocxDocument {
  return renderDocx(compileDocument(title, markdown));
}
