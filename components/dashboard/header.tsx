"use client";

import type { Section, HeaderProfile } from "@/app/page";
import { Calendar, Menu, Tag, type LucideIcon } from "lucide-react";
import { BgSelector } from "@/components/bg-selector";
import type { BgEffect } from "@/components/canvas-background";
import { ReminderBell } from "@/components/dashboard/reminder-bell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface HeaderProps {
  activeSection: Section;
  bgEffect?: BgEffect;
  onBgChange?: (v: BgEffect) => void;
  onMenuClick?: () => void;
  userEmail?: string | null;
  userProfile?: HeaderProfile | null;
  /** Texto chico y apagado junto al título (ej. "24.632 matrículas"). */
  headerExtra?: string | null;
}

// Ícono opcional por sección, mostrado junto al título en un box con acento.
const sectionIcons: Partial<Record<Section, LucideIcon>> = {
  matriculas: Tag,
};

const sectionTitles: Record<Section, string> = {
  overview: "Overview",
  pipeline: "Pipeline",
  deals: "Deals",
  customers: "Customers",
  team: "Team Performance",
  forecasting: "Forecasting",
  reports: "Reports",
  settings: "Configuraciones",
  "buscador":                 "Buscador",
  "servicios-resumen":        "Control de servicios",
  "servicios-planillas":      "Carga de datos",
  "sic-diagrama":             "Proceso SIC - SIGA",
  "transformadores-carga":    "Stock de Transformadores — Carga de datos",
  "transformadores-consumo-carga": "Consumo de Transformadores — Carga de datos",
  "transformadores-consumo":       "Consumo de Transformadores",
  "transformadores-tabla":    "Stock de Transformadores — Informe de Reservas",
  "transformadores-resumen":  "Stock de Transformadores — Resumen",
  "stock-zona":               "Stock por Zona",
  "matriculas":               "Matrículas — Catálogo",
  "matriculas-familias":      "Matrículas — Familias",
  "informe-tecnico":          "Informe Técnico",
  "indice-ido-resumen":       "Índice IDO — Resumen",
  "indice-ido-carga":         "Índice IDO — Carga de datos",
  "tablero-op-resumen":       "Tablero OP — Resumen",
  "tablero-op-carga":         "Tablero OP — Carga de datos",
  "plan-compras-resumen":     "Plan de Compras — Resumen",
  "plan-compras-carga":       "Plan de Compras — Carga de datos",
  "yerba":                    "Control de Yerba",
};

export function Header({ activeSection, bgEffect = "swirl", onBgChange, onMenuClick, userEmail, userProfile, headerExtra }: HeaderProps) {
  const initials = [userProfile?.nombre, userProfile?.apellido]
    .map(s => (s ?? "").trim()[0] ?? "")
    .join("")
    .toUpperCase() || userEmail?.[0]?.toUpperCase() || "U";

  const SectionIcon = sectionIcons[activeSection];

  return (
    <header className="h-12 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6">
      <div className="flex items-center gap-3 sm:gap-6 min-w-0">
        {/* Hamburguesa (solo mobile) */}
        <button
          onClick={onMenuClick}
          className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-accent/40 transition-colors shrink-0"
          aria-label="Abrir menú"
        >
          <Menu className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2.5 min-w-0">
          {SectionIcon && (
            <div className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
              <SectionIcon className="w-3.5 h-3.5 text-accent" />
            </div>
          )}
          <div className="flex items-baseline gap-2 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold text-foreground truncate">
              {sectionTitles[activeSection]}
            </h1>
            {headerExtra && (
              <span className="hidden sm:inline text-xs text-muted-foreground whitespace-nowrap">{headerExtra}</span>
            )}
          </div>
        </div>
        <div className="hidden lg:flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span>Last 30 days</span>
        </div>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        {/* Background selector */}
        {onBgChange && <BgSelector value={bgEffect} onChange={onBgChange} />}

        {/* Notifications */}
        <ReminderBell />

        {/* User avatar */}
        <button className="w-8 h-8 rounded-lg overflow-hidden bg-secondary ring-2 ring-transparent hover:ring-accent/50 transition-all duration-200">
          <Avatar className="w-full h-full rounded-lg">
            {userProfile?.avatar_url && (
              <AvatarImage src={userProfile.avatar_url} alt={initials} className="rounded-lg" />
            )}
            <AvatarFallback className="rounded-lg bg-gradient-to-br from-accent/80 to-chart-1 text-xs font-semibold text-accent-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </div>
    </header>
  );
}
