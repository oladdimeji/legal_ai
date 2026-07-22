export function cleanMatterIntelligenceContent(content: string): string {
  return content
    .replace(/[ \t]*\[\s*Source\s*:\s*[^\]\n]{1,240}\s*\]/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
