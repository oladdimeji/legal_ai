export const ASSISTANT_PANEL_STORAGE_KEY = "exepts.assistantPanelWidth";
export const MIN_ASSISTANT_PANEL_WIDTH = 360;
export const DEFAULT_ASSISTANT_PANEL_WIDTH = MIN_ASSISTANT_PANEL_WIDTH;
export const MAX_ASSISTANT_PANEL_WIDTH = 720;
export const MIN_WORKSPACE_WIDTH = 320;

export function assistantPanelWidthBounds(viewportWidth: number): {
  min: number;
  max: number;
} {
  const available = Math.max(240, Math.floor(viewportWidth) - MIN_WORKSPACE_WIDTH);
  const max = Math.min(MAX_ASSISTANT_PANEL_WIDTH, available);
  return {
    min: Math.min(MIN_ASSISTANT_PANEL_WIDTH, max),
    max,
  };
}

export function clampAssistantPanelWidth(width: number, viewportWidth: number): number {
  const { min, max } = assistantPanelWidthBounds(viewportWidth);
  const safeWidth = Number.isFinite(width) ? width : DEFAULT_ASSISTANT_PANEL_WIDTH;
  return Math.round(Math.min(max, Math.max(min, safeWidth)));
}

export function readAssistantPanelWidth(viewportWidth: number): number {
  let storedWidth = Number.NaN;
  try {
    storedWidth = Number.parseFloat(
      window.localStorage.getItem(ASSISTANT_PANEL_STORAGE_KEY) || ""
    );
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
  return clampAssistantPanelWidth(storedWidth, viewportWidth);
}
