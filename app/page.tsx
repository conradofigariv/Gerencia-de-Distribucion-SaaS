"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { CanvasBackground } from "@/components/canvas-background";
import type { BgEffect } from "@/components/canvas-background";
import { OverviewSection } from "@/components/dashboard/sections/overview";
import { PipelineSection } from "@/components/dashboard/sections/pipeline";
import { DealsSection } from "@/components/dashboard/sections/deals";
import { CustomersSection } from "@/components/dashboard/sections/customers";
import { TeamSection } from "@/components/dashboard/sections/team";
import { ForecastingSection } from "@/components/dashboard/sections/forecasting";
import { ReportsSection } from "@/components/dashboard/sections/reports";
import { SettingsSection } from "@/components/dashboard/sections/settings";
import { ServiciosResumenSection } from "@/components/dashboard/sections/servicios-resumen";
import { ServiciosTablaSection } from "@/components/dashboard/sections/servicios-tabla";
import { ServiciosCargaSection } from "@/components/dashboard/sections/servicios-carga";
import { ServiciosPlanillasSection } from "@/components/dashboard/sections/servicios-planillas";
import { TransformadoresCargaSection } from "@/components/dashboard/sections/transformadores-carga";
import { TransformadoresTablaSection } from "@/components/dashboard/sections/transformadores-tabla";
import { TransformadoresResumenSection } from "@/components/dashboard/sections/transformadores-resumen";
import { StockZonaSection } from "@/components/dashboard/sections/stock-zona";
import { InformeTecnicoSection } from "@/components/dashboard/sections/informe-tecnico";
import { IndiceIdoResumenSection } from "@/components/dashboard/sections/indice-ido-resumen";
import { IndiceIdoCargaSection } from "@/components/dashboard/sections/indice-ido-carga";
import { TableroOpResumenSection } from "@/components/dashboard/sections/tablero-op-resumen";
import { TableroOpCargaSection } from "@/components/dashboard/sections/tablero-op-carga";
import { LoginPage } from "@/components/auth/login";
import { Loader2 } from "lucide-react";

// @xyflow/react uses browser-only APIs — disable SSR to prevent hydration crash
const SicDiagramaSection = dynamic(
  () => import("@/components/dashboard/sections/sic-diagrama").then(m => ({ default: m.SicDiagramaSection })),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-96 text-muted-foreground text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" />Cargando diagrama...</div> }
);

export type Section =
  | "overview" | "pipeline" | "deals" | "customers" | "team"
  | "forecasting" | "reports" | "settings"
  | "servicios-resumen" | "servicios-tabla" | "servicios-carga" | "servicios-planillas"
  | "sic-diagrama"
  | "transformadores-carga" | "transformadores-tabla" | "transformadores-resumen"
  | "stock-zona"
  | "informe-tecnico"
  | "indice-ido-resumen" | "indice-ido-carga"
  | "tablero-op-resumen" | "tablero-op-carga";

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeSection, setActiveSection]   = useState<Section>("servicios-planillas");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [bgEffect, setBgEffect]             = useState<BgEffect>("swirl");

  // Auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("bgEffect") as BgEffect | null;
    if (stored && ["swirl", "coalesce", "shift", "nebula", "none"].includes(stored)) setBgEffect(stored);
  }, []);

  function handleBgChange(v: BgEffect) {
    setBgEffect(v);
    localStorage.setItem("bgEffect", v);
  }

  // Loading splash
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not logged in
  if (!user) return <><CanvasBackground effect="swirl" /><LoginPage /></>;

  const renderSection = () => {
    switch (activeSection) {
      case "overview":           return <OverviewSection />;
      case "pipeline":           return <PipelineSection />;
      case "deals":              return <DealsSection />;
      case "customers":          return <CustomersSection />;
      case "team":               return <TeamSection />;
      case "forecasting":        return <ForecastingSection />;
      case "reports":            return <ReportsSection />;
      case "settings":               return <SettingsSection user={user} />;
      case "servicios-resumen":      return <ServiciosResumenSection />;
      case "servicios-tabla":        return <ServiciosTablaSection />;
      case "servicios-carga":        return <ServiciosCargaSection />;
      case "servicios-planillas":    return <ServiciosPlanillasSection />;
      case "sic-diagrama":           return <SicDiagramaSection />;
      case "transformadores-carga":  return <TransformadoresCargaSection />;
      case "transformadores-tabla":  return <TransformadoresTablaSection />;
      case "transformadores-resumen": return <TransformadoresResumenSection />;
      case "stock-zona":              return <StockZonaSection />;
      case "informe-tecnico":         return <InformeTecnicoSection />;
      case "indice-ido-resumen":      return <IndiceIdoResumenSection />;
      case "indice-ido-carga":        return <IndiceIdoCargaSection />;
      case "tablero-op-resumen":      return <TableroOpResumenSection />;
      case "tablero-op-carga":        return <TableroOpCargaSection />;
      default:                       return <OverviewSection />;
    }
  };

  return (
    <>
      <CanvasBackground effect={bgEffect} />
      <div className="flex min-h-screen">
        <Sidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          mobileOpen={mobileSidebarOpen}
          onMobileOpenChange={setMobileSidebarOpen}
        />

        {/* Backdrop del drawer (solo mobile) */}
        {mobileSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden
          />
        )}

        <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ease-out ml-0 ${sidebarCollapsed ? "md:ml-[72px]" : "md:ml-[260px]"}`}>
          <Header
            activeSection={activeSection}
            bgEffect={bgEffect}
            onBgChange={handleBgChange}
            onMenuClick={() => setMobileSidebarOpen(true)}
          />
          <main className="flex-1 p-4 sm:p-6 overflow-auto">
            <div key={activeSection} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {renderSection()}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
