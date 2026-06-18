"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { Section } from "@/app/page";
import {
  ChevronLeft,
  X,
  Settings,
  Server,
  LayoutGrid,
  Table2,
  UploadCloud,
  Layers,
  ChevronDown,
  Network,
  GitMerge,
  Zap,
  ImagePlus,
  Package,
  Gavel,
  Gauge,
  ClipboardList,
} from "lucide-react";
import { Logo } from "@/components/logo";

interface SidebarProps {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
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
  { kind: "link", id: "servicios-planillas", label: "Carga de datos", icon: Layers },
  {
    kind: "group",
    id: "servicios",
    label: "Control de servicios",
    icon: Server,
    children: [
      { id: "servicios-resumen", label: "Resumen",             icon: LayoutGrid },
      { id: "servicios-tabla",   label: "Lista de seguimiento", icon: Table2 },
      { id: "servicios-carga",   label: "Crear seguimiento",    icon: UploadCloud },
    ],
  },
  { kind: "link", id: "stock-zona", label: "Stock por Zona", icon: Package },
  {
    kind: "group",
    id: "transformadores",
    label: "Stock de Transformadores",
    icon: Zap,
    children: [
      { id: "transformadores-resumen", label: "Resumen",           icon: LayoutGrid },
      { id: "transformadores-carga",   label: "Carga de datos",    icon: ImagePlus },
      { id: "transformadores-tabla",   label: "Informe de Reservas", icon: Table2 },
    ],
  },
  {
    kind: "group",
    id: "sic",
    label: "Proceso SIC - SIGA",
    icon: Network,
    children: [
      { id: "sic-diagrama", label: "Diagrama de flujo", icon: GitMerge },
    ],
  },
  { kind: "link", id: "informe-tecnico", label: "Informe Técnico", icon: Gavel },
  {
    kind: "group",
    id: "indice-ido",
    label: "Indice IDO",
    icon: Gauge,
    children: [
      { id: "indice-ido-resumen", label: "Resumen",        icon: LayoutGrid },
      { id: "indice-ido-carga",   label: "Carga de datos", icon: UploadCloud },
    ],
  },
  {
    kind: "group",
    id: "tablero-op",
    label: "Tablero OP",
    icon: ClipboardList,
    children: [
      { id: "tablero-op-resumen", label: "Resumen",        icon: LayoutGrid },
      { id: "tablero-op-carga",   label: "Carga de datos", icon: UploadCloud },
    ],
  },
  { kind: "link", id: "settings", label: "Configuración", icon: Settings },
];

const SERVICIOS_SECTIONS: Section[] = [
  "servicios-resumen",
  "servicios-tabla",
  "servicios-carga",
];

const SIC_SECTIONS: Section[] = ["sic-diagrama"];

const TRANSFORMADORES_SECTIONS: Section[] = [
  "transformadores-carga",
  "transformadores-tabla",
  "transformadores-resumen",
];

const INDICE_IDO_SECTIONS: Section[] = [
  "indice-ido-resumen",
  "indice-ido-carga",
];

const TABLERO_OP_SECTIONS: Section[] = [
  "tablero-op-resumen",
  "tablero-op-carga",
];

export function Sidebar({
  activeSection,
  onSectionChange,
  collapsed,
  onCollapsedChange,
  mobileOpen = false,
  onMobileOpenChange,
}: SidebarProps) {
  // Selección de sección: en mobile además cierra el drawer
  const handleSelect = (section: Section) => {
    onSectionChange(section);
    onMobileOpenChange?.(false);
  };
  const initialGroups = [
    ...(SERVICIOS_SECTIONS.includes(activeSection)      ? ["servicios"]      : []),
    ...(SIC_SECTIONS.includes(activeSection)            ? ["sic"]            : []),
    ...(TRANSFORMADORES_SECTIONS.includes(activeSection)? ["transformadores"] : []),
    ...(INDICE_IDO_SECTIONS.includes(activeSection)     ? ["indice-ido"]      : []),
    ...(TABLERO_OP_SECTIONS.includes(activeSection)     ? ["tablero-op"]      : []),
  ];
  const [expandedGroups, setExpandedGroups] = useState<string[]>(initialGroups);

  // En mobile el drawer siempre se muestra expandido (no aplica el colapso de desktop)
  const [mobileView, setMobileView] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobileView(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const c = mobileView ? false : collapsed;

  // Auto-expand group when a child section becomes active
  useEffect(() => {
    if (SERVICIOS_SECTIONS.includes(activeSection)) {
      setExpandedGroups((prev) => prev.includes("servicios") ? prev : [...prev, "servicios"]);
    }
    if (SIC_SECTIONS.includes(activeSection)) {
      setExpandedGroups((prev) => prev.includes("sic") ? prev : [...prev, "sic"]);
    }
    if (TRANSFORMADORES_SECTIONS.includes(activeSection)) {
      setExpandedGroups((prev) => prev.includes("transformadores") ? prev : [...prev, "transformadores"]);
    }
    if (INDICE_IDO_SECTIONS.includes(activeSection)) {
      setExpandedGroups((prev) => prev.includes("indice-ido") ? prev : [...prev, "indice-ido"]);
    }
    if (TABLERO_OP_SECTIONS.includes(activeSection)) {
      setExpandedGroups((prev) => prev.includes("tablero-op") ? prev : [...prev, "tablero-op"]);
    }
  }, [activeSection]);

  const toggleGroup = (groupId: string) => {
    // If sidebar is collapsed (desktop), expand it first
    if (c) {
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
    expandedGroups.includes(groupId) && !c;

  const isGroupActive = (group: NavGroup) =>
    group.children.some((c) => c.id === activeSection);

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-50 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-out flex flex-col",
        // Ancho: en mobile siempre 260; en desktop depende de colapsado
        "w-[260px]",
        collapsed ? "md:w-[72px]" : "md:w-[260px]",
        // Visibilidad: drawer en mobile (slide), siempre visible en desktop
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        "md:translate-x-0"
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <Logo className="w-9 h-9 shrink-0" />
          <span
            className={cn(
              "font-semibold text-lg text-sidebar-foreground whitespace-nowrap transition-all duration-300",
              collapsed ? "md:opacity-0 md:w-0" : "opacity-100 w-auto"
            )}
          >
            SaaS Soft
          </span>
        </div>
        {/* Cerrar (solo mobile) */}
        <button
          onClick={() => onMobileOpenChange?.(false)}
          className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          aria-label="Cerrar menú"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Botón flotante colapsar/expandir (solo desktop) */}
      <button
        onClick={() => onCollapsedChange(!collapsed)}
        className="hidden md:flex absolute -right-3 top-[72px] z-50 w-6 h-6 items-center justify-center rounded-full bg-sidebar border border-sidebar-border text-muted-foreground shadow-md hover:text-sidebar-foreground hover:border-accent/50 transition-colors"
        aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
      >
        <ChevronLeft className={cn("w-3.5 h-3.5 transition-transform duration-300 ease-out", collapsed && "rotate-180")} />
      </button>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
        {navItems.map((item) => {
          if (item.kind === "link") {
            const Icon = item.icon;
            const isActive = activeSection === item.id;

            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item.id)}
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
                    c ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
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
                    c ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
                  )}
                >
                  {item.label}
                </span>
                {!c && (
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
                  expanded ? "max-h-52 opacity-100 mt-1" : "max-h-0 opacity-0"
                )}
              >
                <div className="ml-4 pl-3 border-l border-sidebar-border space-y-1">
                  {item.children.map((child) => {
                    const ChildIcon = child.icon;
                    const isActive = activeSection === child.id;

                    return (
                      <button
                        key={child.id}
                        onClick={() => handleSelect(child.id)}
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
    </aside>
  );
}
