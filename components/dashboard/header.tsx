"use client";

import { cn } from "@/lib/utils";
import type { Section } from "@/app/page";
import { Search, Calendar } from "lucide-react";
import { useState } from "react";
import { BgSelector } from "@/components/bg-selector";
import type { BgEffect } from "@/components/canvas-background";
import { ReminderBell } from "@/components/dashboard/reminder-bell";

interface HeaderProps {
  activeSection: Section;
  bgEffect?: BgEffect;
  onBgChange?: (v: BgEffect) => void;
}

const sectionTitles: Record<Section, string> = {
  overview: "Overview",
  pipeline: "Pipeline",
  deals: "Deals",
  customers: "Customers",
  team: "Team Performance",
  forecasting: "Forecasting",
  reports: "Reports",
  settings: "Settings",
  "servicios-resumen":        "Control de servicios — Resumen",
  "servicios-tabla":          "Control de servicios — Lista de seguimiento",
  "servicios-planillas":      "Carga de datos",
  "servicios-carga":          "Control de servicios — Crear seguimiento",
  "sic-diagrama":             "Proceso SIC - SIGA",
  "transformadores-carga":    "Stock de Transformadores — Carga de datos",
  "transformadores-tabla":    "Stock de Transformadores — Informe de Reservas",
  "transformadores-resumen":  "Stock de Transformadores — Resumen",
  "stock-zona":               "Stock por Zona",
  "informe-tecnico":          "Informe Técnico",
  "indice-ido-resumen":       "Índice IDO — Resumen",
  "indice-ido-carga":         "Índice IDO — Carga de datos",
  "tablero-op-resumen":       "Tablero OP — Resumen",
  "tablero-op-carga":         "Tablero OP — Carga de datos",
};

export function Header({ activeSection, bgEffect = "swirl", onBgChange }: HeaderProps) {
  const [searchFocused, setSearchFocused] = useState(false);

  return (
    <header className="h-16 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-30 flex items-center justify-between px-6">
      <div className="flex items-center gap-6">
        <h1 className="text-xl font-semibold text-foreground">
          {sectionTitles[activeSection]}
        </h1>
        <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span>Last 30 days</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Search */}
        <div
          className={cn(
            "relative flex items-center transition-all duration-300",
            searchFocused ? "w-64" : "w-48"
          )}
        >
          <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search..."
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="w-full h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
          />
        </div>

        {/* Background selector */}
        {onBgChange && <BgSelector value={bgEffect} onChange={onBgChange} />}

        {/* Notifications */}
        <ReminderBell />

        {/* User avatar */}
        <button className="w-9 h-9 rounded-lg overflow-hidden bg-secondary ring-2 ring-transparent hover:ring-accent/50 transition-all duration-200">
          <div className="w-full h-full bg-gradient-to-br from-accent/80 to-chart-1 flex items-center justify-center text-xs font-semibold text-accent-foreground">
            JD
          </div>
        </button>
      </div>
    </header>
  );
}
