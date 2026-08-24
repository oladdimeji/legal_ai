const DIAGRAM_FENCE_LANGUAGE = /^(?:mermaid|graphviz|dot|plantuml|puml|uml|flow|flowchart|sequence|sequencediagram|statediagram|classdiagram|erdiagram|gantt|journey|mindmap|pie|quadrantchart|timeline|nomnoml|svgbob|ditaa|asciiflow|blockdiag|seqdiag|actdiag|nwdiag|wavedrom|vega|vegalite|plotly|chart|chartjs|diagram)$/i;

const DIAGRAM_OPENER = /^(?:graph\s+(?:TD|TB|BT|RL|LR)|flowchart(?:\s+\S+)?|sequenceDiagram|classDiagram|erDiagram|stateDiagram(?:-v2)?|mindmap(?:\s|$)|gitGraph|quadrantChart|requirementDiagram|C4Context|journey\s+title|gantt\s+title|pie\s+(?:showData|title)|@start(?:uml|mindmap|gantt|json|yaml|ditaa)\b|(?:strict\s+)?(?:di)?graph\s+\S*\s*\{)/i;

export function isDiagramFenceLanguage(language: string | undefined | null): boolean {
  return Boolean(language && DIAGRAM_FENCE_LANGUAGE.test(language.trim()));
}

export function isDiagramMarkup(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (DIAGRAM_OPENER.test(trimmed)) return true;
  const compactAll = trimmed.replace(/\s/g, "");
  if (compactAll.length >= 8) {
    const drawing = compactAll.replace(/[^\u2500-\u257F]/g, "");
    if (drawing.length / compactAll.length >= 0.65) return true;
  }
  const artLines = trimmed.split("\n").filter((line) => {
    const compact = line.replace(/\s/g, "");
    if (compact.length < 4) return false;
    const drawing = compact.replace(/[^\u2500-\u257F]/g, "");
    return drawing.length / compact.length >= 0.65;
  });
  return artLines.length >= 2;
}

export function isDiagramCodeBlock(language: string | undefined | null, text: string): boolean {
  return isDiagramFenceLanguage(language) || isDiagramMarkup(text);
}
