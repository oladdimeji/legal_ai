export const VOICE_DOCUMENT_DRAFTING_TOOL_ACK =
  "IN_PROGRESS";

/** Time to allow normal confirmation audio before forcing listen-mode recovery. */
export const VOICE_DOC_CONFIRM_FAILSAFE_MS = 4_500;

/** Maximum time a ready document may wait for acknowledgement playback to drain. */
export const VOICE_DOC_HANDOFF_FAILSAFE_MS = 6_500;

/** @deprecated Confirmation is delivered through sendClientContent, not tool responses. */
export const VOICE_DOCUMENT_COMPLETED_TOOL_ACK =
  "COMPLETED";

/** @deprecated Use {@link VOICE_DOCUMENT_DRAFTING_TOOL_ACK} for tool responses. */
export const VOICE_DOCUMENT_SAVED_TOOL_ACK = VOICE_DOCUMENT_DRAFTING_TOOL_ACK;

export function voiceDocumentAcknowledgementClientPrompt(acknowledgementSpeech: string): string {
  const spoken = acknowledgementSpeech.replace(/\s+/g, " ").trim();
  return [
    "Internal Voice Mode document acknowledgement — not part of the user conversation.",
    `Speak immediately in audio. Say exactly once: "${spoken}"`,
    "Do not add, change, or follow this with any other words or questions. After speaking, call use_assistant_capabilities if you have not already done so, then remain silent while drafting is in progress.",
  ].join(" ");
}

export function voiceDocumentConfirmationClientPrompt(confirmationSpeech: string): string {
  const spoken = confirmationSpeech.replace(/\s+/g, " ").trim();
  return [
    "Internal Voice Mode document deliverable — not part of the user conversation.",
    `The document is ready. Speak immediately in audio. Say exactly once: "${spoken}"`,
    "Do not add any other words before or after. After speaking, remain silent until the user speaks.",
  ].join(" ");
}

export function voiceDocumentDraftingFailedClientPrompt(): string {
  return [
    "Internal Voice Mode notice — not part of the user conversation.",
    "Document drafting failed. Apologize briefly that the document could not be created and suggest trying again.",
    "Do not claim a document was created. Speak immediately in audio, then remain silent until the user speaks.",
  ].join(" ");
}
