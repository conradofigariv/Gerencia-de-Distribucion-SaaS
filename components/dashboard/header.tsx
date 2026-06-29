"use client";

import { cn } from "@/lib/utils";
import type { Section, HeaderProfile } from "@/app/page";
import { Search, Calendar, Menu } from "lucide-react";
import { useState } from "react";
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
  "matriculas":               "Matrículas",
  "informe-tecnico":          "Informe Técnico",
  "indice-ido-resumen":       "Índice IDO — Resumen",
  "indice-ido-carga":         "Índice IDO — Carga de datos",
  "tablero-op-resumen":       "Tablero OP — Resumen",
  "tablero-op-carga":         "Tablero OP — Carga de datos",
};

export function Header({ activeSection, bgEffect = "swirl", onBgChange, onMenuClick, userEmail, userProfile }: HeaderProps) {
  const [searchFocused, setSearchFocused] = useState(false);

  const initials = [userProfile?.nombre, userProfile?.apellido]
    .map(s => (s ?? "").trim()[0] ?? "")
    .join("")
    .toUpperCase() || userEmail?.[0]?.toUpperCase() || "U";

  return (
    <header className="h-16 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6">
      <div className="flex items-center gap-3 sm:gap-6 min-w-0">
        {/* Hamburguesa (solo mobile) */}
        <button
          onClick={onMenuClick}
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-accent/40 transition-colors shrink-0"
          aria-label="Abrir menú"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-lg sm:text-xl font-semibold text-foreground truncate">
          {sectionTitles[activeSection]}
        </h1>
        <div className="hidden lg:flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span>Last 30 days</span>
        </div>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        {/* Search */}
        <div
          className={cn(
            "relative hidden md:flex items-center transition-all duration-300",
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
