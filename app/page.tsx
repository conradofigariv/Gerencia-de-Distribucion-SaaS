"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { Sidebar, SIDEBAR_SECTIONS } from "@/components/dashboard/sidebar";
import { puedeVerSeccion } from "@/lib/sectionAccess";
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
import { ServiciosPlanillasSection } from "@/components/dashboard/sections/servicios-planillas";
import { TransformadoresCargaSection } from "@/components/dashboard/sections/transformadores-carga";
import { TransformadoresConsumoCargaSection } from "@/components/dashboard/sections/transformadores-consumo-carga";
import { TransformadoresConsumoSection } from "@/components/dashboard/sections/transformadores-consumo";
import { TransformadoresTablaSection } from "@/components/dashboard/sections/transformadores-tabla";
import { TransformadoresResumenSection } from "@/components/dashboard/sections/transformadores-resumen";
import { StockZonaSection } from "@/components/dashboard/sections/stock-zona";
import { MatriculasSection } from "@/components/dashboard/sections/matriculas";
import { MatriculasFamiliasSection } from "@/components/dashboard/sections/matriculas-familias";
import { InformeTecnicoSection } from "@/components/dashboard/sections/informe-tecnico";
import { IndiceIdoResumenSection } from "@/components/dashboard/sections/indice-ido-resumen";
import { IndiceIdoCargaSection } from "@/components/dashboard/sections/indice-ido-carga";
import { TableroOpResumenSection } from "@/components/dashboard/sections/tablero-op-resumen";
import { TableroOpCargaSection } from "@/components/dashboard/sections/tablero-op-carga";
import { PlanComprasResumenSection } from "@/components/dashboard/sections/plan-compras-resumen";
import { PlanComprasCargaSection } from "@/components/dashboard/sections/plan-compras-carga";
import { BuscadorSection } from "@/components/dashboard/sections/buscador";
import { YerbaSection } from "@/components/dashboard/sections/yerba";
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
  | "servicios-resumen" | "servicios-planillas"
  | "sic-diagrama"
  | "transformadores-carga" | "transformadores-tabla" | "transformadores-resumen"
  | "transformadores-consumo-carga" | "transformadores-consumo"
  | "stock-zona"
  | "matriculas" | "matriculas-familias"
  | "informe-tecnico"
  | "indice-ido-resumen" | "indice-ido-carga"
  | "tablero-op-resumen" | "tablero-op-carga"
  | "plan-compras-resumen" | "plan-compras-carga"
  | "buscador"
  | "yerba";

export interface HeaderProfile {
  nombre:     string;
  apellido:   string;
  avatar_url: string;
}

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeSection, setActiveSection]   = useState<Section>("servicios-planillas");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [bgEffect, setBgEffect]             = useState<BgEffect>("swirl");
  const [headerProfile, setHeaderProfile]   = useState<HeaderProfile | null>(null);
  // Texto chico junto al título del header global (ej. "24.632 matrículas").
  const [matriculasSummary, setMatriculasSummary] = useState<string | null>(null);
  // Permisos de sección del usuario actual — null mientras no se conoce
  // todavía (evita un parpadeo mandando a "settings" antes de tener la data).
  const [accessInfo, setAccessInfo] = useState<{ nivelAcceso: string | null; secciones: string[] | null } | null>(null);

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

  // Carga el perfil (nombre/apellido/avatar) para el avatar del header, y de
  // paso el nivel de acceso + secciones permitidas para el sidebar.
  useEffect(() => {
    if (!user) { setHeaderProfile(null); setAccessInfo(null); return; }
    supabase
      .from("profiles")
      .select("nombre, apellido, avatar_url, nivel_acceso, secciones_permitidas")
      .eq("id", user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          // Si `secciones_permitidas` todavía no existe en la base (falta
          // correr supabase/profile_secciones.sql), este select entero falla
          // y ANTES se perdía en silencio: nombre/apellido/foto quedaban
          // vacíos en el header sin ningún aviso — parecía un bug de sesión.
          console.error("No se pudo cargar el perfil del header:", error.message);
          toast.error(`No se pudo cargar tu perfil: ${error.message}`);
          return;
        }
        setHeaderProfile({
          nombre: data?.nombre ?? "",
          apellido: data?.apellido ?? "",
          avatar_url: data?.avatar_url ?? "",
        });
        setAccessInfo({
          nivelAcceso: data?.nivel_acceso ?? null,
          secciones:   data?.secciones_permitidas ?? null,
        });
      });
  }, [user]);

  const puedeVer = useCallback(
    (section: Section) => puedeVerSeccion(accessInfo?.nivelAcceso, accessInfo?.secciones, section),
    [accessInfo]
  );

  // Si la sección activa deja de estar permitida (login inicial en una
  // restringida, o el admin le sacó acceso mientras navegaba), saltar a la
  // primera que sí puede ver. Se espera a tener `accessInfo` cargado — sin
  // eso, puedeVer() todavía no sabe la respuesta real y mandaría a todos a
  // "settings" por un instante en cada carga de página.
  useEffect(() => {
    if (!accessInfo) return;
    if (puedeVer(activeSection)) return;
    const primera = SIDEBAR_SECTIONS.find((s) => puedeVer(s.id));
    setActiveSection(primera?.id ?? "settings");
  }, [accessInfo, activeSection, puedeVer]);

  useEffect(() => {
    const stored = localStorage.getItem("bgEffect") as BgEffect | null;
    if (stored && ["swirl", "coalesce", "shift", "nebula", "none"].includes(stored)) setBgEffect(stored);
  }, []);

  // Restaurar preferencia de sidebar colapsado
  useEffect(() => {
    if (localStorage.getItem("sidebar-collapsed") === "true") setSidebarCollapsed(true);
  }, []);

  function handleBgChange(v: BgEffect) {
    setBgEffect(v);
    localStorage.setItem("bgEffect", v);
  }

  function handleCollapsedChange(v: boolean) {
    setSidebarCollapsed(v);
    localStorage.setItem("sidebar-collapsed", String(v));
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
      case "settings":               return <SettingsSection user={user} onProfileUpdate={p => setHeaderProfile(prev => ({ ...(prev ?? { nombre: "", apellido: "", avatar_url: "" }), ...p }))} />;
      case "servicios-resumen":      return <ServiciosResumenSection />;
      case "servicios-planillas":    return <ServiciosPlanillasSection />;
      case "sic-diagrama":           return <SicDiagramaSection />;
      case "transformadores-carga":  return <TransformadoresCargaSection />;
      case "transformadores-consumo-carga": return <TransformadoresConsumoCargaSection />;
      case "transformadores-consumo": return <TransformadoresConsumoSection />;
      case "transformadores-tabla":  return <TransformadoresTablaSection />;
      case "transformadores-resumen": return <TransformadoresResumenSection />;
      case "stock-zona":              return <StockZonaSection />;
      case "matriculas":              return <MatriculasSection onSummaryChange={setMatriculasSummary} />;
      case "matriculas-familias":     return <MatriculasFamiliasSection />;
      case "informe-tecnico":         return <InformeTecnicoSection />;
      case "indice-ido-resumen":      return <IndiceIdoResumenSection />;
      case "indice-ido-carga":        return <IndiceIdoCargaSection />;
      case "tablero-op-resumen":      return <TableroOpResumenSection />;
      case "tablero-op-carga":        return <TableroOpCargaSection />;
      case "plan-compras-resumen":    return <PlanComprasResumenSection />;
      case "plan-compras-carga":      return <PlanComprasCargaSection />;
      case "buscador":                return <BuscadorSection />;
      case "yerba":                   return <YerbaSection />;
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
          onCollapsedChange={handleCollapsedChange}
          mobileOpen={mobileSidebarOpen}
          onMobileOpenChange={setMobileSidebarOpen}
          userProfile={headerProfile}
          userEmail={user.email}
          puedeVer={puedeVer}
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
            userEmail={user.email}
            userProfile={headerProfile}
            headerExtra={activeSection === "matriculas" ? matriculasSummary : null}
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
