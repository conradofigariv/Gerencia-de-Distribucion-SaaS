"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  MapPin,
  BarChart3,
  XCircle,
  CalendarClock,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { supabase } from "@/lib/supabaseClient";

const consumoMensual = [
  { mes: "Ene", kwh: 420000 },
  { mes: "Feb", kwh: 390000 },
  { mes: "Mar", kwh: 410000 },
  { mes: "Abr", kwh: 375000 },
  { mes: "May", kwh: 350000 },
  { mes: "Jun", kwh: 480000 },
  { mes: "Jul", kwh: 510000 },
  { mes: "Ago", kwh: 495000 },
  { mes: "Sep", kwh: 430000 },
  { mes: "Oct", kwh: 400000 },
  { mes: "Nov", kwh: 445000 },
  { mes: "Dic", kwh: 530000 },
];

const serviciosPorZona = [
  { zona: "Norte", activos: 1240, color: "oklch(0.7 0.18 220)" },
  { zona: "Sur", activos: 980, color: "oklch(0.7 0.18 145)" },
  { zona: "Este", activos: 1105, color: "oklch(0.75 0.18 55)" },
  { zona: "Oeste", activos: 870, color: "oklch(0.7 0.15 300)" },
  { zona: "Centro", activos: 1560, color: "oklch(0.65 0.2 25)" },
];

const alertasRecientes = [
  { id: 1, tipo: "Corte", direccion: "Av. Colón 1234", zona: "Centro", tiempo: "Hace 15 min", severity: "high" },
  { id: 2, tipo: "Baja tensión", direccion: "Bv. San Juan 567", zona: "Norte", tiempo: "Hace 1h", severity: "medium" },
  { id: 3, tipo: "Medidor falla", direccion: "Calle Lima 890", zona: "Sur", tiempo: "Hace 2h", severity: "medium" },
  { id: 4, tipo: "Reconexión", direccion: "Av. Vélez 2310", zona: "Este", tiempo: "Hace 3h", severity: "low" },
];


const FILTROS_VENCER  = [3, 4]   as const;
const FILTROS_CONSUMO = [30, 40] as const;
type FiltroVencer  = typeof FILTROS_VENCER[number];
type FiltroConsumo = typeof FILTROS_CONSUMO[number];

export function ServiciosResumenSection() {
  const [activos,        setActivos]        = useState<number | null>(null);
  const [vencidos,       setVencidos]       = useState<number | null>(null);
  const [porVencer,      setPorVencer]      = useState<number | null>(null);
  const [porConsumirse,  setPorConsumirse]  = useState<number | null>(null);
  const [filtroVencer,   setFiltroVencer]   = useState<FiltroVencer>(3);
  const [filtroConsumo,  setFiltroConsumo]  = useState<FiltroConsumo>(30);

  // Activos y Vencidos
  useEffect(() => {
    (async () => {
      const [actRes, venRes] = await Promise.all([
        supabase.from("seguimiento").select("*", { count: "exact", head: true }).eq("revision", "OK"),
        supabase.from("seguimiento").select("*", { count: "exact", head: true }).eq("estado_plazo", "VENCIDA"),
      ]);
      setActivos(actRes.count ?? 0);
      setVencidos(venRes.count ?? 0);
    })();
  }, []);

  // Por vencer — re-ejecuta cuando cambia el filtro
  useEffect(() => {
    (async () => {
      setPorVencer(null);
      const today  = new Date();
      const limite = new Date(today);
      limite.setMonth(limite.getMonth() + filtroVencer);
      const { count } = await supabase
        .from("seguimiento")
        .select("*", { count: "exact", head: true })
        .gte("fecha_pactada", today.toISOString().split("T")[0])
        .lte("fecha_pactada", limite.toISOString().split("T")[0]);
      setPorVencer(count ?? 0);
    })();
  }, [filtroVencer]);

  // Por consumirse — trae saldo_linea y cantidad, filtra client-side
  useEffect(() => {
    (async () => {
      setPorConsumirse(null);
      const PAGE = 1000;
      const rows: { saldo_linea: unknown; cantidad: unknown }[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("seguimiento")
          .select("saldo_linea, cantidad")
          .range(from, from + PAGE - 1);
        if (error || !data?.length) break;
        rows.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      const pct = filtroConsumo / 100;
      const count = rows.filter(r => {
        const cantidad = Number(r.cantidad);
        const saldo    = Number(r.saldo_linea);
        if (cantidad === 0) return false;
        return saldo / cantidad <= pct;
      }).length;
      setPorConsumirse(count);
    })();
  }, [filtroConsumo]);

  const cycleVencer  = () => { const i = FILTROS_VENCER.indexOf(filtroVencer);   setFiltroVencer(FILTROS_VENCER[(i + 1) % FILTROS_VENCER.length]);   };
  const cycleConsumo = () => { const i = FILTROS_CONSUMO.indexOf(filtroConsumo); setFiltroConsumo(FILTROS_CONSUMO[(i + 1) % FILTROS_CONSUMO.length]); };

  const fmt = (n: number | null) => n === null ? "—" : n.toLocaleString("es-AR");

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ animationFillMode: "both" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Activos</span>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-success/10">
              <CheckCircle2 className="w-5 h-5 text-success" />
            </div>
          </div>
          <p className="text-2xl font-bold text-foreground">{fmt(activos)}</p>
        </div>

        {/* Por vencer — clickeable */}
        <button
          onClick={cycleVencer}
          className="bg-card border border-border rounded-xl p-5 text-left transition-all hover:border-warning/50 hover:bg-warning/5 animate-in fade-in slide-in-from-bottom-4 duration-500"
          style={{ animationDelay: "75ms", animationFillMode: "both" }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Por vencer</span>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-warning/10">
              <CalendarClock className="w-5 h-5 text-warning" />
            </div>
          </div>
          <p className="text-2xl font-bold text-foreground">{fmt(porVencer)}</p>
          <p className="text-xs text-warning mt-1.5 font-medium">
            Próximos {filtroVencer} meses · clic para cambiar
          </p>
        </button>

        {/* Por Consumirse — clickeable */}
        <button
          onClick={cycleConsumo}
          className="bg-card border border-border rounded-xl p-5 text-left transition-all hover:border-orange-400/50 hover:bg-orange-400/5 animate-in fade-in slide-in-from-bottom-4 duration-500"
          style={{ animationDelay: "150ms", animationFillMode: "both" }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Por Consumirse</span>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-orange-400/10">
              <TrendingDown className="w-5 h-5 text-orange-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-foreground">{fmt(porConsumirse)}</p>
          <p className="text-xs text-orange-400 mt-1.5 font-medium">
            {filtroConsumo}% restante o menos · clic para cambiar
          </p>
        </button>

        {/* Vencidos */}
        <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: "225ms", animationFillMode: "both" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Vencidos</span>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-destructive/10">
              <XCircle className="w-5 h-5 text-destructive" />
            </div>
          </div>
          <p className="text-2xl font-bold text-foreground">{fmt(vencidos)}</p>
        </div>

      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Consumo mensual */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
          <div className="mb-5">
            <h3 className="text-base font-semibold text-foreground">Consumo mensual</h3>
            <p className="text-sm text-muted-foreground mt-0.5">kWh distribuidos por mes</p>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={consumoMensual} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="consumoGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.7 0.18 220)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="oklch(0.7 0.18 220)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.005 260)" vertical={false} />
                <XAxis
                  dataKey="mes"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "oklch(0.65 0 0)", fontSize: 12 }}
                  dy={8}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "oklch(0.65 0 0)", fontSize: 12 }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  dx={-8}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "oklch(0.12 0.005 260)",
                    border: "1px solid oklch(0.22 0.005 260)",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  labelStyle={{ color: "oklch(0.95 0 0)", fontWeight: 600 }}
                  formatter={(v: number) => [`${v.toLocaleString()} kWh`, "Consumo"]}
                />
                <Area
                  type="monotone"
                  dataKey="kwh"
                  stroke="oklch(0.7 0.18 220)"
                  strokeWidth={2}
                  fill="url(#consumoGrad)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Servicios por zona */}
        <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
          <div className="mb-5">
            <h3 className="text-base font-semibold text-foreground">Servicios por zona</h3>
            <p className="text-sm text-muted-foreground mt-0.5">Distribución geográfica</p>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serviciosPorZona} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.005 260)" horizontal={false} />
                <XAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "oklch(0.65 0 0)", fontSize: 11 }}
                />
                <YAxis
                  dataKey="zona"
                  type="category"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "oklch(0.65 0 0)", fontSize: 12 }}
                  width={50}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "oklch(0.12 0.005 260)",
                    border: "1px solid oklch(0.22 0.005 260)",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  formatter={(v: number) => [v.toLocaleString(), "Servicios activos"]}
                />
                <Bar dataKey="activos" radius={[0, 4, 4, 0]}>
                  {serviciosPorZona.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Alertas recientes */}
      <div className="bg-card border border-border rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 delay-400">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-foreground">Alertas recientes</h3>
            <p className="text-sm text-muted-foreground mt-0.5">Últimas incidencias del servicio</p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-destructive font-medium bg-destructive/10 px-2.5 py-1 rounded-full">
            <AlertTriangle className="w-3 h-3" />
            {alertasRecientes.filter((a) => a.severity === "high").length} críticas
          </span>
        </div>
        <div className="divide-y divide-border">
          {alertasRecientes.map((alerta, i) => (
            <div
              key={alerta.id}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-secondary/30 transition-colors duration-150 animate-in fade-in slide-in-from-left-2"
              style={{ animationDelay: `${(i + 6) * 50}ms`, animationFillMode: "both" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    alerta.severity === "high"
                      ? "bg-destructive"
                      : alerta.severity === "medium"
                      ? "bg-warning"
                      : "bg-success"
                  )}
                />
                <div>
                  <p className="text-sm font-medium text-foreground">{alerta.tipo}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <MapPin className="w-3 h-3" />
                    {alerta.direccion} · Zona {alerta.zona}
                  </div>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">{alerta.tiempo}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
