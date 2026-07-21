import React from "react";
import { Scale, MessageSquare, Briefcase, FileText, History, ChevronLeft, ChevronRight } from "lucide-react";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  firmName: string;
  userName: string;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  onStartNewThread: () => void;
}

export default function Sidebar({ 
  activeTab, 
  setActiveTab, 
  firmName, 
  userName,
  isCollapsed,
  setIsCollapsed,
  onStartNewThread
}: SidebarProps) {
  const collapsedActual = isCollapsed;

  const navItems = [
    { id: "assistant", label: "Legal Assistant", icon: MessageSquare },
    { id: "workspace", label: "Workspace & Library", icon: Briefcase },
    { id: "drafts", label: "Drafts & Documents", icon: FileText },
    { id: "history", label: "History", icon: History },
  ];

  return (
    <div 
      id="sidebar-container"
      className={`bg-white text-zinc-900 border-r border-zinc-200 flex flex-col h-full shrink-0 transition-all duration-300 ${
        collapsedActual ? "w-16" : "w-64"
      }`}
    >
      {/* Brand Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        id="sidebar-brand-toggle"
        className={`w-full p-6 border-b border-zinc-200 flex items-center hover:bg-zinc-50 transition-all text-left outline-none cursor-pointer ${
          collapsedActual ? "justify-center" : "gap-3"
        }`}
        title={collapsedActual ? "Expand Sidebar" : "Collapse Sidebar"}
      >
        <Scale className="h-6 w-6 text-zinc-900 shrink-0" />
        {!collapsedActual && (
          <div className="min-w-0 flex-1">
            <h1 className="font-sans font-semibold text-sm tracking-tight text-zinc-900 uppercase truncate">Legal AI</h1>
            <p className="text-[10px] font-mono text-zinc-500 truncate">{firmName || "Sterling & Croft LLP"}</p>
          </div>
        )}
      </button>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1.5" id="sidebar-navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              id={`nav-btn-${item.id}`}
              onClick={() => {
                if (item.id === "assistant") {
                  onStartNewThread();
                } else {
                  setActiveTab(item.id);
                }
              }}
              title={collapsedActual ? item.label : undefined}
              className={`w-full flex items-center ${
                collapsedActual ? "justify-center px-2 py-3" : "gap-3 px-4 py-3"
              } rounded-md text-xs font-medium tracking-wide transition-all uppercase duration-150 ${
                isActive
                  ? "bg-zinc-100 text-zinc-950 font-semibold"
                  : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsedActual && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* User info footer */}
      <div className="p-4 border-t border-zinc-200" id="sidebar-footer">
        <div className={`flex items-center ${collapsedActual ? "justify-center px-0 py-1" : "gap-3 px-2 py-1.5"}`}>
          <div className="w-7 h-7 rounded-full bg-zinc-100 flex items-center justify-center font-mono text-[10px] text-zinc-700 border border-zinc-200 shrink-0">
            {userName ? userName.charAt(0).toUpperCase() : "U"}
          </div>
          {!collapsedActual && (
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-zinc-900 truncate">{userName || "Counsel"}</p>
              <p className="text-[9px] font-mono text-zinc-500 truncate uppercase">Firm Attorney</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
