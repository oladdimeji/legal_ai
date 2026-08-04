import React from "react";
import type { TableBlock } from "../../../shared/document/documentTypes";
import DocumentInlineContent from "./DocumentInlineContent";

export function tableColumnPercentages(columns: TableBlock["columns"]): number[] {
  if (!columns.length) return [];
  const weights = columns.map((column) => Math.max(Number.EPSILON, column.widthWeight));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const exact = weights.map((weight) => weight / total * 10_000);
  const units = exact.map(Math.floor);
  let remaining = 10_000 - units.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let cursor = 0; remaining > 0; cursor += 1, remaining -= 1) units[order[cursor % order.length].index] += 1;
  return units.map((value) => value / 100);
}

export default function DocumentTable({ table }: { table: TableBlock }) {
  const widths = tableColumnPercentages(table.columns);
  const headerRows = table.signatureLayout ? 0 : Math.min(table.headerRows, table.rows.length);
  const renderRows = (rows: TableBlock["rows"], offset: number, header: boolean) => rows.map((row, rowIndex) => (
    <tr key={offset + rowIndex}>
      {Array.from({ length: table.columns.length }, (_, columnIndex) => {
        const Tag = header ? "th" : "td";
        const column = table.columns[columnIndex];
        return <Tag key={columnIndex} scope={header ? "col" : undefined} className={`document-table-cell document-table-align-${column.alignment}`} data-column-kind={column.kind}><DocumentInlineContent content={row.cells[columnIndex] ?? [{ type: "text", text: "" }]} /></Tag>;
      })}
    </tr>
  ));
  return (
    <div className="document-table-scroll">
      <table className={`document-table document-table-${table.layout}${table.signatureLayout ? " document-table-signature" : ""}`} data-layout={table.layout} data-orientation={table.orientation} data-signature-layout={table.signatureLayout ? "true" : "false"}>
        <colgroup>{widths.map((width, index) => <col key={index} style={{ width: `${width.toFixed(2)}%` }} />)}</colgroup>
        {headerRows > 0 && <thead>{renderRows(table.rows.slice(0, headerRows), 0, true)}</thead>}
        <tbody>{renderRows(table.rows.slice(headerRows), headerRows, false)}</tbody>
      </table>
    </div>
  );
}
