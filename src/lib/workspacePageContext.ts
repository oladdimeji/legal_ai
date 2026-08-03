import { WorkspacePageContext } from "../types";

const ROUTE_KINDS = new Set<WorkspacePageContext["routeKind"]>([
  "matters",
  "matter",
  "library",
  "history",
  "settings",
  "assistantDocument",
]);
const ITEM_KINDS = new Set<NonNullable<WorkspacePageContext["selectedItem"]>["kind"]>([
  "matter",
  "source",
  "workProduct",
  "libraryDocument",
  "assistantDocument",
]);

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function cleanVisibleText(value: unknown, maxLength: number): string {
  return cleanString(value, maxLength)
    .replace(/https?:\/\/\S+/gi, "[link removed]")
    .replace(/\b(password|oauth token|access token|refresh token|api key|invitation code)\s*[:=]\s*\S+/gi, "$1: [secret removed]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?\b/g, "[token removed]");
}

function cleanId(value: unknown): string {
  const id = cleanString(value, 160);
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(id) ? id : "";
}

export function sanitizeWorkspacePageContext(value: unknown): WorkspacePageContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!ROUTE_KINDS.has(input.routeKind as WorkspacePageContext["routeKind"])) return null;
  const routeKind = input.routeKind as WorkspacePageContext["routeKind"];
  const pageTitle = cleanVisibleText(input.pageTitle, 160);
  if (!pageTitle) return null;

  const result: WorkspacePageContext = { routeKind, pageTitle };
  const pageDescription = cleanVisibleText(input.pageDescription, 600);
  if (pageDescription) result.pageDescription = pageDescription;
  const activeSection = cleanVisibleText(input.activeSection, 100);
  if (activeSection) result.activeSection = activeSection;

  if (Array.isArray(input.visibleSections)) {
    const visibleSections = input.visibleSections.slice(0, 10).flatMap((section) => {
      if (!section || typeof section !== "object" || Array.isArray(section)) return [];
      const rawSection = section as Record<string, unknown>;
      const id = cleanId(rawSection.id);
      const title = cleanVisibleText(rawSection.title, 120);
      const description = cleanVisibleText(rawSection.description, 500);
      return id && title && description ? [{ id, title, description }] : [];
    });
    if (visibleSections.length) result.visibleSections = visibleSections;
  }

  if (input.matter && typeof input.matter === "object" && !Array.isArray(input.matter)) {
    const rawMatter = input.matter as Record<string, unknown>;
    const id = cleanId(rawMatter.id);
    const name = cleanVisibleText(rawMatter.name, 160);
    if (id && name) {
      result.matter = {
        id,
        name,
        clientName: cleanVisibleText(rawMatter.clientName, 160) || null,
        status: cleanVisibleText(rawMatter.status, 80) || null,
      };
    }
  }
  if (routeKind === "matter" && !result.matter) return null;
  if (routeKind !== "matter" && result.matter) return null;

  if (input.selectedItem && typeof input.selectedItem === "object" && !Array.isArray(input.selectedItem)) {
    const rawItem = input.selectedItem as Record<string, unknown>;
    const kind = rawItem.kind as NonNullable<WorkspacePageContext["selectedItem"]>["kind"];
    const title = cleanVisibleText(rawItem.title, 180);
    if (ITEM_KINDS.has(kind) && title) {
      const id = cleanId(rawItem.id);
      result.selectedItem = { kind, title, ...(id ? { id } : {}) };
    }
  }

  if (Array.isArray(input.visibleActions)) {
    const visibleActions = input.visibleActions.slice(0, 12).flatMap((action) => {
      if (!action || typeof action !== "object" || Array.isArray(action)) return [];
      const rawAction = action as Record<string, unknown>;
      const id = cleanId(rawAction.id);
      const label = cleanVisibleText(rawAction.label, 100);
      const description = cleanVisibleText(rawAction.description, 320);
      return id && label && description ? [{ id, label, description }] : [];
    });
    if (visibleActions.length) result.visibleActions = visibleActions;
  }
  return result;
}
