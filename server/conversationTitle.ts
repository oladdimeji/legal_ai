import { callModel } from "./model.js";

const MAX_TITLE_LENGTH = 60;
const INVALID_TITLE_PREFIXES = [
  "user asks",
  "question about",
  "help with",
  "conversation about",
  "request to",
];

type TitleModelCall = typeof callModel;

export function buildConversationTitlePrompt(userRequest: string): string {
  return `Create a short title that summarizes the main topic or task in the user's request.

Rules:
- Use approximately 3 to 8 words.
- Maximum 60 characters where reasonably possible.
- Capture the actual purpose of the request.
- Ignore greetings, introductory wording, and unnecessary context.
- Do not copy the request word for word.
- Do not answer the request.
- Do not use quotation marks.
- Do not use Markdown.
- Do not add a period at the end.
- Do not begin with phrases such as “User asks”, “Question about”, “Help with”, “Conversation about”, or “Request to”.
- Return only the title.

User request:
${userRequest}`;
}

function removeSurroundingMarkers(value: string): string {
  let result = value;
  for (let index = 0; index < 2; index += 1) {
    result = result
      .replace(/^(["'“‘])([\s\S]*)(["'”’])$/, "$2")
      .replace(/^\*\*([\s\S]+)\*\*$/, "$1")
      .replace(/^__([\s\S]+)__$/, "$1")
      .trim();
  }
  return result;
}

function truncateAtWordBoundary(value: string): string {
  if (value.length <= MAX_TITLE_LENGTH) return value;
  const candidate = value.slice(0, MAX_TITLE_LENGTH + 1);
  const boundary = candidate.lastIndexOf(" ");
  return boundary > 0 ? candidate.slice(0, boundary).trimEnd() : "";
}

export function sanitizeConversationTitle(rawTitle: string): string | null {
  const firstLine = rawTitle
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;

  const cleaned = truncateAtWordBoundary(
    removeSurroundingMarkers(firstLine.replace(/^#{1,6}\s*/, ""))
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\.$/, "")
      .trim()
  );
  if (!cleaned || !/[\p{L}\p{N}]/u.test(cleaned)) return null;
  if (INVALID_TITLE_PREFIXES.some((prefix) => cleaned.toLowerCase().startsWith(prefix))) return null;
  return cleaned;
}

export async function generateConversationTitle(
  userRequest: string,
  modelCall: TitleModelCall = callModel
): Promise<string | null> {
  const result = await modelCall(
    "classify-complexity",
    [{ role: "user", content: buildConversationTitlePrompt(userRequest) }]
  );
  return sanitizeConversationTitle(result.text);
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Conversation title generation timed out")), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function tryGenerateConversationTitle(
  userRequest: string,
  saveTitle: (title: string) => Promise<boolean>,
  options: {
    modelCall?: TitleModelCall;
    timeoutMs?: number;
    logError?: (message: string, error: unknown) => void;
  } = {}
): Promise<boolean> {
  try {
    const generatedTitle = await withTimeout(
      generateConversationTitle(userRequest, options.modelCall),
      options.timeoutMs ?? 5000
    );
    if (!generatedTitle) throw new Error("Conversation title model returned invalid output");
    if (!(await saveTitle(generatedTitle))) {
      throw new Error("Conversation title could not be saved");
    }
    return true;
  } catch (error) {
    (options.logError ?? console.error)("Conversation title generation failed:", error);
    return false;
  }
}
