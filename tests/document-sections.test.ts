import assert from "node:assert/strict";
import test from "node:test";
import { groupDocumentSections } from "../shared/document/documentSections.js";
import type { DocumentBlock, TableBlock } from "../shared/document/documentTypes.js";

const landscapeTable: TableBlock = {
  type: "table", headerRows: 1, headerRow: true, signatureLayout: false, layout: "wide", orientation: "landscape",
  columns: [{ alignment: "left", kind: "text", widthWeight: 1 }], rows: [{ cells: [[{ type: "text", text: "A" }]] }],
};

test("section grouping moves an immediately preceding heading with a landscape table", () => {
  const blocks: DocumentBlock[] = [{ type: "heading", level: 2, text: "Wide analysis", content: [{ type: "text", text: "Wide analysis" }] }, landscapeTable];
  const groups = groupDocumentSections(blocks);
  assert.equal(groups[1].orientation, "landscape");
  assert.deepEqual(groups[1].entries.map(({ block }) => block.type), ["heading", "table"]);
});

test("section grouping preserves portrait content around landscape tables and heading page breaks", () => {
  const blocks: DocumentBlock[] = [
    { type: "paragraph", content: [{ type: "text", text: "Opening." }] },
    { type: "heading", level: 2, text: "Wide analysis", content: [{ type: "text", text: "Wide analysis" }] },
    landscapeTable,
    { type: "paragraph", content: [{ type: "text", text: "Closing." }] },
  ];
  const groups = groupDocumentSections(blocks);
  assert.deepEqual(groups.map((group) => group.orientation), ["portrait", "landscape", "portrait"]);
  assert.deepEqual(groups[0].entries.map(({ block }) => block.type), ["paragraph"]);
  assert.deepEqual(groups[2].entries.map(({ block }) => block.type), ["paragraph"]);
});

test("an empty document retains the initial portrait section", () => {
  assert.deepEqual(groupDocumentSections([]), [{ orientation: "portrait", entries: [] }]);
});
