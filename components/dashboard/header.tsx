"use client";

import { cn } from "@/lib/utils";
import type { Section } from "@/app/page";
import { Bell, Search, Calendar } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { User } from "@supabase/supabase-js";

interface HeaderProps {
  activeSection: Section;
  user: User;
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
  "servicios-resumen":   "Control de servicios — Resumen",
  "servicios-tabla":     "Control de servicios — Lista de seguimiento",
  "servicios-planillas": "Carga de datos",
  "servicios-carga":     "Control de servicios — Crear seguimiento",
};

export function Header({ activeSection, user }: HeaderProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [initials, setInitials] = useState(user.email?.[0]?.toUpperCase() ?? "U");

  useEffect(() => {
    supabase
      .from("profiles")
      .select("nombre, apellido")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          const i = [data.nombre, data.apellido]
            .map((s: string | null) => (s ?? "").trim()[0] ?? "")
            .join("")
            .toUpperCase();
          if (i) setInitials(i);
        }
      });
  }, [user.id]);

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

        {/* Notifications */}
        <button className="relative w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-accent rounded-full animate-pulse" />
        </button>

        {/* User avatar */}
        <button className="w-9 h-9 rounded-lg overflow-hidden bg-secondary ring-2 ring-transparent hover:ring-accent/50 transition-all duration-200">
          <div className="w-full h-full bg-gradient-to-br from-accent/80 to-chart-1 flex items-center justify-center text-xs font-semibold text-accent-foreground">
            {initials}
          </div>
        </button>
      </div>
    </header>
  );
}
