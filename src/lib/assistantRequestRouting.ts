import { WorkspacePageContext } from "../types";

export type AssistantRequestMode =
  | "ui_help"
  | "general"
  | "workspace_research"
  | "deep_research"
  | "draft";

const UI_HELP_PATTERN = /\b(what (?:am i looking at|is (?:this|on this page)|does (?:this|the) (?:button|control|action) do)|what happens if i (?:click|press)|how do i use (?:this|the) (?:page|screen|button|control)|where (?:am i|is the)|explain (?:this|the) (?:page|screen|button|control)|matter intelligence|share with client)\b/i;
const WORKSPACE_PATTERN = /\b(this|the|our|my) (matter|case|client|source|document|work product|firm library|workspace|file|record)\b|\b(according to|based on|in) (?:the )?(?:matter|sources?|documents?|firm library|work product)\b/i;
const MATTER_ANALYSIS_PATTERN = /\b(analy[sz]e|assess|evaluate|review|summarize|timeline|strategy|liability|claims?|defen[cs]es?|arguments?|key facts?)\b/i;
const DEEP_PATTERN = /\b(deep research|comprehensive(?:ly)?|multi[- ]jurisdiction|compare (?:the )?laws?|survey (?:the )?authorit|conflicting authorit|all relevant cases|detailed legal research)\b/i;
const OBVIOUS_GENERAL_PATTERN = /^(?:hi|hello|hey|thanks|thank you|good (?:morning|afternoon|evening)|who are you|what can you do)[.!?\s]*$/i;

export function routeAssistantRequest({
  content,
  pageContext,
  forceDeepResearch,
  responseMode = "chat",
  hasTemporaryFiles = false,
}: {
  content: string;
  pageContext: WorkspacePageContext;
  forceDeepResearch?: boolean;
  responseMode?: "chat" | "draft";
  hasTemporaryFiles?: boolean;
}): AssistantRequestMode {
  if (responseMode === "draft") return "draft";
  if (UI_HELP_PATTERN.test(content)) return "ui_help";
  if (forceDeepResearch === true) return "deep_research";
  if (OBVIOUS_GENERAL_PATTERN.test(content)) return "general";
  const workspaceRequest = hasTemporaryFiles
    || WORKSPACE_PATTERN.test(content)
    || Boolean(pageContext.selectedItem?.id)
    || (pageContext.routeKind === "matter" && (MATTER_ANALYSIS_PATTERN.test(content) || DEEP_PATTERN.test(content)));
  if (workspaceRequest && DEEP_PATTERN.test(content)) return "deep_research";
  return workspaceRequest ? "workspace_research" : "general";
}
