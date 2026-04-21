"use client";

import { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { LoginPage } from "@/components/auth/login";
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
import { SicDiagramaSection } from "@/components/dashboard/sections/sic-diagrama";
import { TransformadoresCargaSection } from "@/components/dashboard/sections/transformadores-carga";
import { TransformadoresTablaSection } from "@/components/dashboard/sections/transformadores-tabla";
import { TransformadoresResumenSection } from "@/components/dashboard/sections/transformadores-resumen";

export type Section =
  | "overview"
  | "pipeline"
  | "deals"
  | "customers"
  | "team"
  | "forecasting"
  | "reports"
  | "settings"
  | "servicios-resumen"
  | "servicios-tabla"
  | "servicios-carga"
  | "servicios-planillas"
  | "sic-diagrama"
  | "transformadores-carga"
  | "transformadores-tabla"
  | "transformadores-resumen";

export default function Dashboard() {
  const [user, setUser]                     = useState<User | null>(null);
  const [loading, setLoading]               = useState(true);
  const [activeSection, setActiveSection]   = useState<Section>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    // Sesión inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Escuchar cambios (login / logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Pantalla de carga inicial
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

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
      default:                       return <OverviewSection />;
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      />
      <div className={`flex-1 flex flex-col transition-all duration-300 ease-out ${sidebarCollapsed ? "ml-[72px]" : "ml-[260px]"}`}>
        <Header activeSection={activeSection} />
        <main className="flex-1 p-6 overflow-auto">
          <div key={activeSection} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {renderSection()}
          </div>
        </main>
      </div>
    </div>
  );
}
