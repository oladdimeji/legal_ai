const DOCUMENT_TYPE_PATTERN = /\b(nda|non-disclosure(?: agreement)?|statement of work|sow|memorandum|memo|agreement|contract|policy|brief|report|notice|checklist|email|letter|document)\b/i;

export const VOICE_ACKNOWLEDGEMENT_CREATE_VARIANTS = [
  (docType: string) => `Understood. I'll prepare the ${docType} now.`,
  (docType: string) => `Got it. I'll put together the ${docType} for you.`,
  (docType: string) => `Absolutely. I'll prepare the ${docType} based on your instructions.`,
] as const;

export const VOICE_ACKNOWLEDGEMENT_REVISE_VARIANTS = [
  (docType: string) => `Understood. I'll revise the ${docType} now.`,
  (docType: string) => `Got it. I'll update the ${docType} for you.`,
  (docType: string) => `Absolutely. I'll revise the ${docType} based on your instructions.`,
] as const;

let voiceAcknowledgementVariantCounter = 0;

export function nextVoiceAcknowledgementVariantIndex(): number {
  const index = voiceAcknowledgementVariantCounter % VOICE_ACKNOWLEDGEMENT_CREATE_VARIANTS.length;
  voiceAcknowledgementVariantCounter += 1;
  return index;
}

export function resetVoiceAcknowledgementVariantCounter(): void {
  voiceAcknowledgementVariantCounter = 0;
}

export function resolveVoiceDocumentType(request: string): { docType: string; revise: boolean } {
  const text = request.replace(/\s+/g, " ").trim();
  const lower = text.toLocaleLowerCase();
  const revise = /\b(?:revise|rewrite|update|amend|shorten|expand|regenerat(?:e|ing)|redo)\b/.test(lower);
  const typeMatch = text.match(DOCUMENT_TYPE_PATTERN);
  const rawType = typeMatch?.[1] || "document";
  const docType = /^(nda|sow)$/i.test(rawType)
    ? rawType.toLocaleUpperCase()
    : rawType.replace(/\b\w/g, (char) => char.toLocaleUpperCase());
  return { docType, revise };
}

export function voiceAcknowledgementSpeech(request: string, variantIndex?: number): string {
  const { docType, revise } = resolveVoiceDocumentType(request);
  const index = variantIndex ?? nextVoiceAcknowledgementVariantIndex();
  const variants = revise ? VOICE_ACKNOWLEDGEMENT_REVISE_VARIANTS : VOICE_ACKNOWLEDGEMENT_CREATE_VARIANTS;
  return variants[index % variants.length](docType);
}

export function voiceConfirmationSpeech(request: string): string {
  const { docType, revise } = resolveVoiceDocumentType(request);
  return revise
    ? `I've finished revising the ${docType}.`
    : `I've finished preparing the ${docType}.`;
}
