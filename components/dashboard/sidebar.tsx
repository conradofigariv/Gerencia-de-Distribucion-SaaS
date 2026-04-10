"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { Section } from "@/app/page";
import {
  LayoutDashboard,
  GitBranch,
  Handshake,
  Users,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Building2,
  TrendingUp,
  Settings,
  Server,
  LayoutGrid,
  Table2,
  UploadCloud,
  ChevronDown,
} from "lucide-react";
import { Logo } from "@/components/logo";

interface SidebarProps {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

type NavLink = {
  kind: "link";
  id: Section;
  label: string;
  icon: React.ElementType;
};

type NavGroup = {
  kind: "group";
  id: string;
  label: string;
  icon: React.ElementType;
  children: { id: Section; label: string; icon: React.ElementType }[];
};

type NavItemDef = NavLink | NavGroup;

const navItems: NavItemDef[] = [
  {
    kind: "group",
    id: "servicios",
    label: "Control de servicios",
    icon: Server,
    children: [
      { id: "servicios-resumen", label: "Resumen", icon: LayoutGrid },
      { id: "servicios-tabla", label: "Base de datos", icon: Table2 },
      { id: "servicios-carga", label: "Carga de datos", icon: UploadCloud },
    ],
  },
  { kind: "link", id: "overview", label: "Overview", icon: LayoutDashboard },
  { kind: "link", id: "pipeline", label: "Pipeline", icon: GitBranch },
  { kind: "link", id: "deals", label: "Deals", icon: Handshake },
  { kind: "link", id: "customers", label: "Customers", icon: Building2 },
  { kind: "link", id: "team", label: "Team", icon: Users },
  { kind: "link", id: "forecasting", label: "Forecasting", icon: TrendingUp },
  { kind: "link", id: "reports", label: "Reports", icon: BarChart3 },
  { kind: "link", id: "settings", label: "Settings", icon: Settings },
];

const SERVICIOS_SECTIONS: Section[] = [
  "servicios-resumen",
  "servicios-tabla",
  "servicios-carga",
];

export function Sidebar({
  activeSection,
  onSectionChange,
  collapsed,
  onCollapsedChange,
}: SidebarProps) {
  const [expandedGroups, setExpandedGroups] = useState<string[]>(
    SERVICIOS_SECTIONS.includes(activeSection) ? ["servicios"] : []
  );

  // Auto-expand group when a child section becomes active
  useEffect(() => {
    if (SERVICIOS_SECTIONS.includes(activeSection)) {
      setExpandedGroups((prev) =>
        prev.includes("servicios") ? prev : [...prev, "servicios"]
      );
    }
  }, [activeSection]);

  const toggleGroup = (groupId: string) => {
    // If sidebar is collapsed, expand it first
    if (collapsed) {
      onCollapsedChange(false);
      setExpandedGroups((prev) =>
        prev.includes(groupId) ? prev : [...prev, groupId]
      );
      return;
    }
    setExpandedGroups((prev) =>
      prev.includes(groupId)
        ? prev.filter((g) => g !== groupId)
        : [...prev, groupId]
    );
  };

  const isGroupExpanded = (groupId: string) =>
    expandedGroups.includes(groupId) && !collapsed;

  const isGroupActive = (group: NavGroup) =>
    group.children.some((c) => c.id === activeSection);

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-out flex flex-col",
        collapsed ? "w-[72px]" : "w-[260px]"
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <Logo className="w-9 h-9 shrink-0" />
          <span
            className={cn(
              "font-semibold text-lg text-sidebar-foreground whitespace-nowrap transition-all duration-300",
              collapsed ? "opacity-0 w-0" : "opacity-100 w-auto"
            )}
          >
            SaaS Soft
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => {
          if (item.kind === "link") {
            const Icon = item.icon;
            const isActive = activeSection === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onSectionChange(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
              >
                <span
                  className={cn(
                    "absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-accent transition-all duration-300",
                    isActive ? "opacity-100" : "opacity-0"
                  )}
                />
                <Icon
                  className={cn(
                    "w-5 h-5 shrink-0 transition-transform duration-200",
                    isActive ? "text-accent" : "group-hover:scale-110"
                  )}
                />
                <span
                  className={cn(
                    "whitespace-nowrap transition-all duration-300",
                    collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
                  )}
                >
                  {item.label}
                </span>
              </button>
            );
          }

          // NavGroup
          const Icon = item.icon;
          const expanded = isGroupExpanded(item.id);
          const groupActive = isGroupActive(item);

          return (
            <div key={item.id}>
              {/* Group header */}
              <button
                onClick={() => toggleGroup(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative",
                  groupActive
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
              >
                <span
                  className={cn(
                    "absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-accent transition-all duration-300",
                    groupActive ? "opacity-100" : "opacity-0"
                  )}
                />
                <Icon
                  className={cn(
                    "w-5 h-5 shrink-0 transition-transform duration-200",
                    groupActive ? "text-accent" : "group-hover:scale-110"
                  )}
                />
                <span
                  className={cn(
                    "flex-1 text-left whitespace-nowrap transition-all duration-300",
                    collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
                  )}
                >
                  {item.label}
                </span>
                {!collapsed && (
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 shrink-0 transition-transform duration-200",
                      expanded ? "rotate-180" : "rotate-0"
                    )}
                  />
                )}
              </button>

              {/* Children */}
              <div
                className={cn(
                  "overflow-hidden transition-all duration-300 ease-out",
                  expanded ? "max-h-40 opacity-100 mt-1" : "max-h-0 opacity-0"
                )}
              >
                <div className="ml-4 pl-3 border-l border-sidebar-border space-y-1">
                  {item.children.map((child) => {
                    const ChildIcon = child.icon;
                    const isActive = activeSection === child.id;

                    return (
                      <button
                        key={child.id}
                        onClick={() => onSectionChange(child.id)}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all duration-200",
                          isActive
                            ? "bg-accent/15 text-accent"
                            : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                        )}
                      >
                        <ChildIcon className="w-4 h-4 shrink-0" />
                        <span className="whitespace-nowrap">{child.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Collapse button */}
      <div className="p-3 border-t border-sidebar-border">
        <button
          onClick={() => onCollapsedChange(!collapsed)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-200"
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <>
              <ChevronLeft className="w-5 h-5" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
