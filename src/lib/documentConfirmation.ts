export const DOCUMENT_CONFIRMATION_MAX_CHARS = 300;

export function assistantDocumentConfirmationContent(
  documentAction: "create" | "revise" | undefined,
  title: string
): string {
  return documentAction === "revise"
    ? `I have created a revised version of **${title}**.`
    : `I have created the **${title}**.`;
}

export function documentConfirmationSpeech(content: string): string | null {
  const spoken = content.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (!spoken || spoken.length > DOCUMENT_CONFIRMATION_MAX_CHARS || /[\r\n]/.test(spoken)) return null;
  if (!/^I have created (?:a revised version of )?(?:the )?.+\.$/.test(spoken)) return null;
  return spoken;
}

export function isDocumentConfirmationContent(content: string): boolean {
  return documentConfirmationSpeech(content) !== null;
}
