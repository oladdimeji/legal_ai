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

export function normalizeVoiceSpokenContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function normalizeVoiceSpokenMatch(content: string): string {
  return normalizeVoiceSpokenContent(content)
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

function matchesExpectedVoiceDocumentSpeech(spoken: string, expected: string): boolean {
  if (!spoken || !expected) return false;
  if (spoken === expected || spoken.startsWith(expected) || expected.startsWith(spoken)) return true;
  const spokenMatch = normalizeVoiceSpokenMatch(spoken);
  const expectedMatch = normalizeVoiceSpokenMatch(expected);
  if (!spokenMatch || !expectedMatch) return false;
  // Gemini can emit output transcription after playback drain as a final fragment
  // such as "now.". Match any bounded contiguous fragment of the exact scripted
  // sentence while its document-speech guard is active.
  return spokenMatch.length >= 3 && expectedMatch.includes(spokenMatch);
}

const VOICE_ACKNOWLEDGEMENT_SPEECH_PATTERN =
  /^(?:Understood|Got it|Absolutely)\.\s+I(?:'ll| will) (?:(?:prepare|put together) the |revise the |update the ).+?(?:now|for you|based on your instructions)\.?$/i;

const VOICE_ACKNOWLEDGEMENT_SPEECH_PREFIX =
  /^(?:Understood|Got it|Absolutely)\.\s+I(?:'ll| will) (?:(?:prepare|put together)|revise|update) the/i;

const VOICE_CONFIRMATION_SPEECH_PATTERN =
  /^I've finished (?:preparing|revising) (?:the )?.+\.?$/i;

const VOICE_CONFIRMATION_SPEECH_PREFIX = /^I've finished (?:preparing|revising)(?: the)?/i;

export function isVoiceDocumentAcknowledgementContent(content: string): boolean {
  const spoken = normalizeVoiceSpokenContent(content);
  if (!spoken) return false;
  if (VOICE_ACKNOWLEDGEMENT_SPEECH_PATTERN.test(spoken)) return true;
  return spoken.length >= 16 && VOICE_ACKNOWLEDGEMENT_SPEECH_PREFIX.test(spoken);
}

export function isVoiceDocumentConfirmationSpeechContent(content: string): boolean {
  const spoken = normalizeVoiceSpokenContent(content);
  if (!spoken) return false;
  if (VOICE_CONFIRMATION_SPEECH_PATTERN.test(spoken)) return true;
  return spoken.length >= 20 && VOICE_CONFIRMATION_SPEECH_PREFIX.test(spoken);
}

export function isVoiceDocumentSpokenContent(
  content: string,
  expectedConfirmationSpeech?: string | null,
  expectedAcknowledgementSpeech?: string | null
): boolean {
  const spoken = normalizeVoiceSpokenContent(content);
  if (!spoken) return false;
  if (isVoiceDocumentAcknowledgementContent(spoken)) return true;
  if (isVoiceDocumentConfirmationSpeechContent(spoken)) return true;
  const expectedAck = expectedAcknowledgementSpeech ? normalizeVoiceSpokenContent(expectedAcknowledgementSpeech) : "";
  if (matchesExpectedVoiceDocumentSpeech(spoken, expectedAck)) {
    return true;
  }
  const expected = expectedConfirmationSpeech ? normalizeVoiceSpokenContent(expectedConfirmationSpeech) : "";
  if (!expected) return false;
  return matchesExpectedVoiceDocumentSpeech(spoken, expected);
}
