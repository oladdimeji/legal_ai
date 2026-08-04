import type { DocumentBlock, DocumentOrientation } from "./documentTypes.js";

export type DocumentSectionGroup = {
  orientation: DocumentOrientation;
  entries: Array<{ block: DocumentBlock; index: number }>;
};

export function groupDocumentSections(blocks: DocumentBlock[]): DocumentSectionGroup[] {
  const groups: DocumentSectionGroup[] = [{ orientation: "portrait", entries: [] }];
  for (const [index, block] of blocks.entries()) {
    const orientation = block.type === "table" ? block.orientation : "portrait";
    let current = groups[groups.length - 1];
    if (orientation === "landscape" && current.orientation === "portrait") {
      const previous = current.entries[current.entries.length - 1];
      const moveHeading = previous?.block.type === "heading" && !previous.block.pageBreakBefore
        ? current.entries.pop()
        : undefined;
      current = { orientation: "landscape", entries: moveHeading ? [moveHeading] : [] };
      groups.push(current);
    } else if (orientation === "portrait" && current.orientation === "landscape") {
      current = { orientation: "portrait", entries: [] };
      groups.push(current);
    }
    current.entries.push({ block, index });
  }
  return groups.filter((group, index) => index === 0 || group.entries.length > 0);
}
