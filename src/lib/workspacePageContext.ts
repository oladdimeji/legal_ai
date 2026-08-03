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

function cleanId(value: unknown): string {
  const id = cleanString(value, 160);
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(id) ? id : "";
}

export function sanitizeWorkspacePageContext(value: unknown): WorkspacePageContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!ROUTE_KINDS.has(input.routeKind as WorkspacePageContext["routeKind"])) return null;
  const routeKind = input.routeKind as WorkspacePageContext["routeKind"];
  const pageTitle = cleanString(input.pageTitle, 160);
  if (!pageTitle) return null;

  const result: WorkspacePageContext = { routeKind, pageTitle };
  const activeSection = cleanString(input.activeSection, 100);
  if (activeSection) result.activeSection = activeSection;

  if (input.matter && typeof input.matter === "object" && !Array.isArray(input.matter)) {
    const rawMatter = input.matter as Record<string, unknown>;
    const id = cleanId(rawMatter.id);
    const name = cleanString(rawMatter.name, 160);
    if (id && name) {
      result.matter = {
        id,
        name,
        clientName: cleanString(rawMatter.clientName, 160) || null,
        status: cleanString(rawMatter.status, 80) || null,
      };
    }
  }
  if (routeKind === "matter" && !result.matter) return null;
  if (routeKind !== "matter" && result.matter) return null;

  if (input.selectedItem && typeof input.selectedItem === "object" && !Array.isArray(input.selectedItem)) {
    const rawItem = input.selectedItem as Record<string, unknown>;
    const kind = rawItem.kind as NonNullable<WorkspacePageContext["selectedItem"]>["kind"];
    const title = cleanString(rawItem.title, 180);
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
      const label = cleanString(rawAction.label, 100);
      const description = cleanString(rawAction.description, 320);
      return id && label && description ? [{ id, label, description }] : [];
    });
    if (visibleActions.length) result.visibleActions = visibleActions;
  }
  return result;
}

export function pageContextKey(context: WorkspacePageContext): string {
  return context.routeKind === "matter" && context.matter
    ? `matter:${context.matter.id}`
    : "general";
}

