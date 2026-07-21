import { Document as DocxDocument, HeadingLevel, Paragraph, TextRun } from "docx";

function inlineRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) runs.push(new TextRun(text.slice(lastIndex, match.index)));
    if (match[2]) runs.push(new TextRun({ text: match[2], bold: true }));
    else if (match[3]) runs.push(new TextRun({ text: match[3], italics: true }));
    else if (match[4]) runs.push(new TextRun({ text: match[4], style: "Hyperlink" }));
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) runs.push(new TextRun(text.slice(lastIndex)));
  return runs.length ? runs : [new TextRun(text)];
}

export function markdownToDocxDocument(title: string, markdown: string): DocxDocument {
  const paragraphs: Paragraph[] = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }),
  ];

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      paragraphs.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }
    if (line.startsWith("### ")) {
      paragraphs.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } }));
    } else if (line.startsWith("## ")) {
      paragraphs.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    } else if (line.startsWith("# ")) {
      paragraphs.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }));
    } else if (/^[-*]\s+/.test(line)) {
      paragraphs.push(new Paragraph({ children: inlineRuns(line.replace(/^[-*]\s+/, "")), bullet: { level: 0 }, spacing: { after: 80 } }));
    } else if (/^\d+\.\s+/.test(line)) {
      paragraphs.push(new Paragraph({ children: inlineRuns(line.replace(/^\d+\.\s+/, "")), numbering: { reference: "numbered-list", level: 0 }, spacing: { after: 80 } }));
    } else if (line.startsWith("> ")) {
      paragraphs.push(new Paragraph({ children: inlineRuns(line.slice(2)), indent: { left: 360 }, spacing: { after: 100 } }));
    } else {
      paragraphs.push(new Paragraph({ children: inlineRuns(line), spacing: { after: 120 } }));
    }
  }

  return new DocxDocument({
    numbering: {
      config: [{
        reference: "numbered-list",
        levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "left" }],
      }],
    },
    sections: [{ children: paragraphs }],
  });
}
