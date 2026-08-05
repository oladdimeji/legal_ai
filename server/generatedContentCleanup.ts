const BOILERPLATE_PATTERNS = [
  /^(?:this\s+)?(?:response|answer|information)\s+is\s+for\s+informational\s+purposes\s+only\.?$/i,
  /^this\s+is\s+not\s+legal\s+advice\.?$/i,
  /^this\s+(?:is\s+)?(?:not\s+)?(?:a\s+)?(?:substitute|replacement)\s+for\s+(?:professional\s+)?legal\s+advice\.?$/i,
  /^consult\s+(?:a|an)\s+(?:qualified\s+)?(?:lawyer|attorney|legal\s+professional)(?:\s+for\s+advice)?\.?$/i,
  /^please\s+consult\s+(?:a|an)\s+(?:qualified\s+)?(?:lawyer|attorney|legal\s+professional).*\.?$/i,
  /^this\s+ai(?:-generated)?\s+(?:response|content|answer)\s+may\s+(?:contain\s+errors|make\s+mistakes)\.?$/i,
  /^ai(?:-generated)?\s+(?:content|responses?)\s+(?:may\s+make\s+mistakes|requires?\s+lawyer\s+review)\.?$/i,
];

function isGenericBoilerplateParagraph(paragraph: string): boolean {
  const normalized = paragraph
    .replace(/^>\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;
  if (/^#{1,6}\s+disclaimer of warranties/i.test(paragraph)) return false;
  if (/disclaimer of warranties|disclaimer clause|warranty disclaimer/i.test(normalized)) return false;
  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.length > 0 && sentences.every((sentence) => BOILERPLATE_PATTERNS.some((pattern) => pattern.test(sentence.trim())));
}

export function cleanGeneratedBoilerplate(content: string): string {
  const paragraphs = content.replace(/\r\n/g, "\n").split(/\n{2,}/);
  while (paragraphs.length && isGenericBoilerplateParagraph(paragraphs[0])) paragraphs.shift();
  while (paragraphs.length && isGenericBoilerplateParagraph(paragraphs[paragraphs.length - 1])) paragraphs.pop();
  return paragraphs.join("\n\n").trim();
}

export function cleanGeneratedWorkProductContent(content: string): string {
  return stripInternalCitationsForWorkProduct(cleanGeneratedBoilerplate(content), {
    stripNumberedMarkers: true,
  });
}

export function cleanClientAssistantContent(content: string): string {
  return cleanGeneratedBoilerplate(content)
    .replace(/\[+\s*sources?\s*:\s*[^\]\n]{1,240}\]+/gi, "")
    .replace(
      /(?:^|\n{2,})(?:#{1,6}\s*)?(?:Sources|References)\s*:?\s*\n(?:[-*]\s*)?[^\n]+(?:\n(?:[-*]\s*)?[^\n]+){0,12}\s*$/i,
      ""
    )
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
import { stripInternalCitationsForWorkProduct } from "../src/lib/assistantCitations.js";
