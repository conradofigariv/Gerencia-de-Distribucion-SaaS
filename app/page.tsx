"use client";

import { useState, useEffect } from "react";
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
  const [activeSection, setActiveSection]   = useState<Section>("servicios-planillas");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [bgEffect, setBgEffect]             = useState<BgEffect>("pipeline");

  useEffect(() => {
    const stored = localStorage.getItem("bgEffect") as BgEffect | null;
    if (stored) setBgEffect(stored);
  }, []);

  function handleBgChange(v: BgEffect) {
    setBgEffect(v);
    localStorage.setItem("bgEffect", v);
  }

  const renderSection = () => {
    switch (activeSection) {
      case "overview":           return <OverviewSection />;
      case "pipeline":           return <PipelineSection />;
      case "deals":              return <DealsSection />;
      case "customers":          return <CustomersSection />;
      case "team":               return <TeamSection />;
      case "forecasting":        return <ForecastingSection />;
      case "reports":            return <ReportsSection />;
      case "settings":               return <SettingsSection user={null} />;
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
    <>
      <CanvasBackground effect={bgEffect} />
      <div className="flex min-h-screen">
        <Sidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />
        <div className={`flex-1 flex flex-col transition-all duration-300 ease-out ${sidebarCollapsed ? "ml-[72px]" : "ml-[260px]"}`}>
          <Header activeSection={activeSection} bgEffect={bgEffect} onBgChange={handleBgChange} />
          <main className="flex-1 p-6 overflow-auto">
            <div key={activeSection} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {renderSection()}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
