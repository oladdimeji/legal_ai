export const VOICE_DOCUMENT_DRAFTING_TOOL_ACK =
  "Document drafting is in progress. Remain silent until follow-up confirmation guidance arrives.";

/** @deprecated Use {@link VOICE_DOCUMENT_DRAFTING_TOOL_ACK} for immediate tool responses. */
export const VOICE_DOCUMENT_SAVED_TOOL_ACK = VOICE_DOCUMENT_DRAFTING_TOOL_ACK;

export function voiceDocumentConfirmationClientPrompt(confirmationSpeech: string): string {
  const spoken = confirmationSpeech.replace(/\s+/g, " ").trim();
  return [
    "Internal Voice Mode document deliverable — not part of the user conversation.",
    `The document was created successfully. Speak to the user now in this turn: first confirm the document was created or revised, then give a brief review in your own words. Use "created" or "generated" for new documents — never say "saved". Use this guidance but do not read or quote any document text aloud: ${spoken}`,
    "Speak immediately in audio. After speaking, remain silent until the user speaks.",
  ].join(" ");
}

export function voiceDocumentDraftingFailedClientPrompt(): string {
  return [
    "Internal Voice Mode notice — not part of the user conversation.",
    "Document drafting failed. Apologize briefly that the document could not be created and suggest trying again.",
    "Do not claim a document was created. Speak immediately in audio, then remain silent until the user speaks.",
  ].join(" ");
}

export function voiceDocumentSavedToolResponse(confirmationSpeech: string): string {
  return voiceDocumentConfirmationClientPrompt(confirmationSpeech);
}
