const MAX_CLARIFICATION_MATCH_CHARS = 500;

const FALSE_ATTACHMENT_ACCESS_PATTERNS = [
  /\b(?:which|what)\s+matter\b[\s\S]{0,160}\b(?:file|document|attachment)\b/i,
  /\b(?:file|document|attachment)\b[\s\S]{0,160}\b(?:belong(?:s)?\s+to|associated\s+with|linked\s+to)\b[\s\S]{0,80}\bmatter\b/i,
  /\b(?:attached\s+(?:file|document)|attachment)\b[\s\S]{0,160}\b(?:where|locat(?:e|ed|ion)|find|matter|firm\s+library|document\s+library|workspace)\b/i,
  /\b(?:where|locat(?:e|ed|ion)|find)\b[\s\S]{0,160}\b(?:attached\s+(?:file|document)|attachment)\b/i,
  /\b(?:do\s+not|don't|cannot|can't|unable\s+to)\b[\s\S]{0,80}\baccess\b[\s\S]{0,120}\b(?:attached\s+(?:file|document)|attachment|this\s+file)\b/i,
  /\b(?:attached\s+(?:file|document)|attachment|this\s+file)\b[\s\S]{0,120}\b(?:do\s+not|don't|cannot|can't|unable\s+to)\b[\s\S]{0,80}\baccess\b/i,
  /\b(?:provide|identify|specify)\b[\s\S]{0,100}\b(?:document\s+library|firm\s+library|workspace\s+document(?:\s+name)?|workspace\s+location)\b[\s\S]{0,120}\b(?:attachment|file|document|locate|find)\b/i,
  /\b(?:upload|re-?upload|place|add)\b[\s\S]{0,100}\b(?:attached\s+)?(?:file|document|attachment)\b[\s\S]{0,100}\b(?:firm\s+library|document\s+library|workspace|matter)\b/i,
];

export function isFalseTemporaryAttachmentClarification(
  question: string | undefined,
  hasTemporaryFiles: boolean
): boolean {
  if (!hasTemporaryFiles || !question?.trim()) return false;
  const boundedQuestion = question.slice(0, MAX_CLARIFICATION_MATCH_CHARS);
  return FALSE_ATTACHMENT_ACCESS_PATTERNS.some((pattern) => pattern.test(boundedQuestion));
}

export function resolveAssistantClarification(input: {
  plannerNeedsClarification: boolean;
  plannerClarificationQuestion?: string;
  toolClarificationQuestion?: string;
  hasTemporaryFiles: boolean;
}): string | undefined {
  const plannerQuestion = input.plannerNeedsClarification
    ? input.plannerClarificationQuestion?.trim()
    : undefined;
  if (
    plannerQuestion &&
    !isFalseTemporaryAttachmentClarification(plannerQuestion, input.hasTemporaryFiles)
  ) {
    return plannerQuestion;
  }
  return input.toolClarificationQuestion?.trim() || undefined;
}
