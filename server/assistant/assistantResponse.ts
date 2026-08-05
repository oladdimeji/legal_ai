import type { Citation, ResearchStep } from "../../src/types.js";
import { sanitizeEvidenceText } from "./assistantEvidence.js";
import type { AssistantEvidence, AssistantPlan } from "./assistantTypes.js";
import type { AssistantToolRunResult } from "./assistantToolExecutor.js";

export function assistantCitationsForEvidence(
  evidence: readonly AssistantEvidence[],
  webCitations: readonly Citation[]
): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const item of evidence) {
    if (["account", "firm", "web"].includes(item.sourceType)) continue;
    const key = `${item.sourceType}:${item.entityId || item.title}:${item.sourceName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      id: `cit_${citations.length + 1}`,
      type: "workspace",
      title: sanitizeEvidenceText(item.title, 300),
      textSnippet: sanitizeEvidenceText(item.text, 4_000),
      sourceName: sanitizeEvidenceText(item.sourceName, 180),
    });
    if (citations.length >= 12) break;
  }
  return [...citations, ...webCitations];
}

export function evidenceWithAssistantCitationIds(
  evidence: readonly AssistantEvidence[],
  citations: readonly Citation[]
): AssistantEvidence[] {
  return evidence.map((item) => {
    const citation = citations.find((candidate) =>
      candidate.type === "workspace" &&
      candidate.title === sanitizeEvidenceText(item.title, 300) &&
      candidate.sourceName === sanitizeEvidenceText(item.sourceName, 180)
    );
    return citation ? { ...item, id: citation.id } : item;
  });
}

export function assistantUsedWorkspace(toolRun: AssistantToolRunResult): boolean {
  return toolRun.checkedLocations.some((location) => location !== "Current public web research") ||
    toolRun.evidence.some((item) => item.sourceType !== "web");
}

export function assistantResearchSteps(input: {
  plan: AssistantPlan;
  toolRun: AssistantToolRunResult;
  planningRounds: number;
  webResearchPerformed: boolean;
}): ResearchStep[] | null {
  if (input.plan.depth !== "thorough") return null;
  const locations = [...new Set(input.toolRun.checkedLocations)]
    .filter((location) => location !== "Current public web research")
    .slice(0, 7);
  const steps: ResearchStep[] = locations.map((location) => ({
    subQuestion: sanitizeEvidenceText(location, 240),
    retrievedContext: "Authorized evidence was reviewed from this location.",
    note: "Completed the permitted read-only lookup.",
  }));
  if (input.webResearchPerformed) {
    steps.push({
      subQuestion: "Current public authority",
      retrievedContext: "Google-grounded public sources were reviewed.",
      note: "Public research was kept outside the private workspace evidence boundary.",
    });
  }
  if (input.planningRounds > 1) {
    steps.push({
      subQuestion: "Follow-up evidence round",
      retrievedContext: "A second bounded read-only retrieval round was completed.",
      note: "The follow-up round used only server-authorized identifiers.",
    });
  }
  return steps.length ? steps.slice(0, 9) : null;
}
