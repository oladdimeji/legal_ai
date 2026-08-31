export const VOICE_DOCUMENT_SAVED_TOOL_ACK = "The document was saved successfully.";

export function voiceDocumentConfirmationClientPrompt(confirmationSpeech: string): string {
  const spoken = confirmationSpeech.replace(/\s+/g, " ").trim();
  return [
    "Internal Voice Mode document deliverable — not part of the user conversation.",
    `The document was saved successfully. Speak to the user now in this turn: first confirm the document was created or revised, then give a brief review in your own words. Use this guidance but do not read or quote any document text aloud: ${spoken}`,
    "Speak immediately in audio. After speaking, remain silent until the user speaks.",
  ].join(" ");
}

export function voiceDocumentSavedToolResponse(confirmationSpeech: string): string {
  return voiceDocumentConfirmationClientPrompt(confirmationSpeech);
}
