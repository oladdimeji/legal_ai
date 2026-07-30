export type WorkProductFormat = "memo" | "email" | "summary";

const FORMAT_INSTRUCTIONS: Record<WorkProductFormat, string> = {
  memo: `Create a legal memorandum.
Use appropriate memorandum sections from the following where relevant:
- To
- From
- Date
- Subject
- Question Presented
- Brief Answer
- Statement of Facts
- Discussion
- Conclusion`,
  email: `Create a professional legal email using:
- Subject
- Greeting
- Clear explanatory body
- Relevant legal analysis
- Practical next steps
- Professional closing

Do not format this as a legal memorandum.
Do not use memorandum headings such as Question Presented, Brief Answer, Statement of Facts, Discussion, or Conclusion.
Do not begin with "LEGAL MEMORANDUM".
Do not add To, From, and Firm fields as a memorandum header.`,
  summary: `Create a clear legal summary using an appropriate structure such as:
- Concise overview
- Relevant facts or documents
- Key legal issues
- Analysis
- Recommendations or next steps

Do not format this as a legal memorandum.
Do not format this as an email.
Do not begin with "LEGAL MEMORANDUM".
Do not use To, From, Question Presented, or Brief Answer memorandum fields.`,
};

export function isWorkProductFormat(value: unknown): value is WorkProductFormat {
  return value === "memo" || value === "email" || value === "summary";
}

export function getWorkProductFormatInstructions(format: WorkProductFormat): string {
  return FORMAT_INSTRUCTIONS[format];
}
