import React, { createContext, useContext, useMemo, useState } from "react";
import { WorkspacePageContext } from "../types";

type WorkspacePageContextValue = {
  pageContext: WorkspacePageContext;
  publishPageContext: (context: WorkspacePageContext) => void;
};

const DEFAULT_CONTEXT: WorkspacePageContext = {
  routeKind: "matters",
  pageTitle: "Matters",
};

const PageContext = createContext<WorkspacePageContextValue | null>(null);

export function WorkspacePageContextProvider({ children }: { children: React.ReactNode }) {
  const [pageContext, publishPageContext] = useState<WorkspacePageContext>(DEFAULT_CONTEXT);
  const value = useMemo(() => ({ pageContext, publishPageContext }), [pageContext]);
  return <PageContext.Provider value={value}>{children}</PageContext.Provider>;
}

export function useWorkspacePageContext(): WorkspacePageContextValue {
  const value = useContext(PageContext);
  if (!value) throw new Error("WorkspacePageContextProvider is required");
  return value;
}

