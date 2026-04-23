"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  Zap, CheckCircle2, Wrench, XCircle, RefreshCw, Loader2,
} from "lucide-react";

const POT_13 = [5,10,16,25,50,63,80,100,125,160,200,250,315,500,630,800,1000];
const POT_33 = [25,63,160,250,315,500,630];
const MONO_KVA = new Set([5,10,16,25]);
const TRI_KVA  = new Set([50,63,80,100,125,160,200,250,315,500,630,800,1000]);

const MONTHS = [
  { value: "01", label: "Enero" },   { value: "02", label: "Febrero" },
  { value: "03", label: "Marzo" },   { value: "04", label: "Abril" },
  { value: "05", label: "Mayo" },    { value: "06", label: "Junio" },
  { value: "07", label: "Julio" },   { value: "08", label: "Agosto" },
  { value: "09", label: "Septiembre" }, { value: "10", label: "Octubre" },
  { value: "11", label: "Noviembre" }, { value: "12", label: "Diciembre" },
];

interface DatosPlanilla {
  terceros:   Record<string, { t: number; m: number; ct: number }>;
  taller:     Record<string, { t: number; m: number; ct: number }>;
  autorizados: Record<string, number>;
  totales:    Record<string, number>;
  rel33:      Record<string, { tN: number; mN: number; tR: number; mR: number }>;
  deposito?:  string;
}

interface PlanillaReserva {
  id:     number;
  fecha:  string;
  datos:  DatosPlanilla;
}

interface Transformador {
  id:         string;
  numero:     string;
  tipo:       string | null;
  potencia:   string | null;
  tension:    string | null;
  estado:     string | null;
  ubicacion:  string | null;
  imagen_url: string | null;
}

interface KpiCard {
  label:   string;
  value:   number;
  color:   string;
}

const ESTADO_BADGE: Record<string, string> = {
  "Disponible":    "bg-green-500/15 text-green-400",
  "En servicio":   "bg-blue-500/15 text-blue-400",
  "En reparación": "bg-amber-500/15 text-amber-400",
  "Baja":          "bg-red-500/15 text-red-400",
};

function kvasFor(relacion: string, fases: string): number[] {
  let base = relacion === "33" ? POT_33 : POT_13;
  if (fases === "mono") base = base.filter(k => MONO_KVA.has(k));
  if (fases === "tri")  base = base.filter(k => TRI_KVA.has(k));
  return base;
}

function computeStockBruto(p: PlanillaReserva, kvas: number[], relacion: string): number {
  if (relacion === "33") {
    return kvas.reduce((s, k) => {
      const r = p.datos.rel33?.[String(k)];
      return s + (r ? r.tN + r.mN + r.tR + r.mR : 0);
    }, 0);
  }
  return kvas.reduce((s, k) => s + (p.datos.totales?.[String(k)] ?? 0), 0);
}

function computePendientes(p: PlanillaReserva, kvas: number[], relacion: string): number {
  if (relacion === "33") return 0;
  return kvas.reduce((s, k) => s + (p.datos.autorizados?.[String(k)] ?? 0), 0);
}

const SEL = "px-2.5 py-1.5 rounded-lg bg-card border border-border text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-accent";

// ── Gauge helpers ─────────────────────────────────────────────────────────────

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arc(cx: number, cy: number, r: number, a1: number, a2: number) {
  const s = polar(cx, cy, r, a1), e = polar(cx, cy, r, a2);
  return `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} A ${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${e.x.toFixed(1)} ${e.y.toFixed(1)}`;
}

function GaugeChart({ ratio }: { ratio: number }) {
  const cx = 150, cy = 150, r = 108, sw = 28;
  const START = 135, SWEEP = 270, MAX = 150;
  const angleFor = (p: number) => START + (p / MAX) * SWEEP;
  const clamped = Math.min(Math.max(ratio, 0), MAX);
  const tip = polar(cx, cy, r - 14, angleFor(clamped));

  const zones = [
    { from: 0, to: 90, color: "#ef4444" },
    { from: 90, to: 100, color: "#22c55e" },
    { from: 100, to: 150, color: "#eab308" },
  ];

  const tickLabels = [
    { pct: 0, text: "0%", anchor: "end" as const },
    { pct: 50, text: "50%", anchor: "end" as const },
    { pct: 100, text: "100%", anchor: "start" as const },
    { pct: 150, text: "150%", anchor: "start" as const },
  ];

  return (
    <svg viewBox="0 0 300 225" className="w-full max-w-xs mx-auto">
      <path d={arc(cx, cy, r, START, START + SWEEP)} fill="none" stroke="#1e293b" strokeWidth={sw} />
      {zones.map(z => (
        <path key={z.from} d={arc(cx, cy, r, angleFor(z.from), angleFor(z.to))} fill="none" stroke={z.color} strokeWidth={sw} />
      ))}
      {tickLabels.map(l => {
        const pos = polar(cx, cy, r + 20, angleFor(l.pct));
        return <text key={l.pct} x={pos.x} y={pos.y + 3} textAnchor={l.anchor} fontSize={9} fill="#64748b">{l.text}</text>;
      })}
      <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke="#f1f5f9" strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={6} fill="#f1f5f9" />
      <text x={cx} y={cy + 52} textAnchor="middle" fontSize={26} fontWeight="bold" fill="#f1f5f9">{ratio.toFixed(2)}%</text>
      <text x={cx} y={cy + 67} textAnchor="middle" fontSize={8} fill="#64748b">Stock mes actual / promedio histórico</text>
    </svg>
  );
}

export function TransformadoresResumenSection() {
  const [rows, setRows]           = useState<Transformador[]>([]);
  const [planillas, setPlanillas] = useState<PlanillaReserva[]>([]);
  const [loading, setLoading]     = useState(true);

  // Filters
  const [filterAno,      setFilterAno]      = useState("");
  const [filterMes,      setFilterMes]      = useState("");
  const [filterPotencia, setFilterPotencia] = useState("");
  const [filterRelacion, setFilterRelacion] = useState("");
  const [filterFases,    setFilterFases]    = useState("");
  const [filterZona,     setFilterZona]     = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: trafos, error: e1 }, { data: plans, error: e2 }] = await Promise.all([
      supabase.from("transformadores").select("*"),
      supabase.from("planillas_reserva").select("id,fecha,datos").order("fecha", { ascending: false }),
    ]);
    if (e1) toast.error(e1.message);
    if (e2) toast.error(e2.message);
    setRows(trafos ?? []);
    setPlanillas(plans ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Promedio / Gauge ─────────────────────────────────────────────────────

  const s13 = (p: PlanillaReserva) => POT_13.reduce((s, k) => s + (p.datos.totales?.[String(k)] ?? 0), 0);
  const s33 = (p: PlanillaReserva) => POT_33.reduce((s, k) => { const r = p.datos.rel33?.[String(k)]; return s + (r ? r.tN + r.mN + r.tR + r.mR : 0); }, 0);

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const all13  = planillas.map(s13);
  const all33  = planillas.map(s33);
  const avgAll = avg(planillas.map((p, i) => all13[i] + all33[i]));
  const avg13  = avg(all13);
  const avg33  = avg(all33);

  const latestPlanilla = planillas[0];
  const currentStock   = latestPlanilla ? s13(latestPlanilla) + s33(latestPlanilla) : 0;
  const gaugeRatio     = avgAll > 0 ? (currentStock / avgAll) * 100 : 0;

  // ── KPI computation ───────────────────────────────────────────────────────

  const planillasFiltradas = planillas.filter(p => {
    const [y, m] = p.fecha.split("-");
    if (filterAno  && y !== filterAno)  return false;
    if (filterMes  && m !== filterMes)  return false;
    if (filterZona && (p.datos.deposito ?? "") !== filterZona) return false;
    return true;
  });

  const current = planillasFiltradas[0];
  const prev    = planillasFiltradas[1];

  const kvas = filterPotencia
    ? [Number(filterPotencia)]
    : kvasFor(filterRelacion, filterFases);

  const stockBruto     = current ? computeStockBruto(current,  kvas, filterRelacion) : 0;
  const pendientes     = current ? computePendientes(current,  kvas, filterRelacion) : 0;
  const stockNeto      = stockBruto - pendientes;
  const prevStockNeto  = prev
    ? computeStockBruto(prev, kvas, filterRelacion) - computePendientes(prev, kvas, filterRelacion)
    : null;
  const variacion      = prevStockNeto !== null ? stockNeto - prevStockNeto : 0;

  const kpis: KpiCard[] = [
    { label: "STOCK BRUTO",           value: stockBruto, color: "text-foreground" },
    { label: "PENDIENTES DE RETIRO",  value: pendientes, color: pendientes > 0 ? "text-red-400" : "text-red-400" },
    { label: "STOCK NETO",            value: stockNeto,  color: "text-green-400" },
    { label: "VARIACIÓN NETA MENSUAL",value: variacion,  color: variacion >= 0 ? "text-green-400" : "text-red-400" },
  ];

  // ── Transformadores KPIs (existing) ──────────────────────────────────────

  const total       = rows.length;
  const disponibles = rows.filter(r => r.estado === "Disponible").length;
  const enServicio  = rows.filter(r => r.estado === "En servicio").length;
  const reparacion  = rows.filter(r => r.estado === "En reparación").length;
  const baja        = rows.filter(r => r.estado === "Baja").length;

  const existingKpis = [
    { label: "Total registrados", value: total,       icon: Zap,         color: "text-accent",     bgColor: "bg-accent/10" },
    { label: "Disponibles",       value: disponibles, icon: CheckCircle2, color: "text-green-400", bgColor: "bg-green-500/10" },
    { label: "En servicio",       value: enServicio,  icon: Zap,         color: "text-blue-400",  bgColor: "bg-blue-500/10" },
    { label: "En reparación",     value: reparacion,  icon: Wrench,      color: "text-amber-400", bgColor: "bg-amber-500/10" },
    { label: "Bajas",             value: baja,        icon: XCircle,     color: "text-red-400",   bgColor: "bg-red-500/10" },
  ];

  const byTipo = rows.reduce<Record<string, number>>((acc, r) => {
    const key = r.tipo ?? "Sin tipo";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const byUbicacion = rows.reduce<Record<string, number>>((acc, r) => {
    const key = r.ubicacion ?? "Sin ubicación";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const topUbicaciones = Object.entries(byUbicacion).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Available options for filters
  const availableYears = [...new Set(planillas.map(p => p.fecha.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
  const availableZonas = [...new Set(planillas.map(p => p.datos.deposito ?? "").filter(Boolean))].sort();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Cargando datos…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Resumen del inventario de transformadores</p>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Actualizar
        </button>
      </div>

      {/* ── Filters + Reserve KPIs ── */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-4">

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-2">
          <select value={filterAno} onChange={e => setFilterAno(e.target.value)} className={SEL}>
            <option value="">AÑO</option>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          <select value={filterMes} onChange={e => setFilterMes(e.target.value)} className={SEL}>
            <option value="">Mes y Año</option>
            {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>

          <select value={filterPotencia} onChange={e => setFilterPotencia(e.target.value)} className={SEL}>
            <option value="">Potencia</option>
            {(filterRelacion === "33" ? POT_33 : POT_13).map(k => (
              <option key={k} value={k}>{k} kVA</option>
            ))}
          </select>

          <select value={filterRelacion} onChange={e => { setFilterRelacion(e.target.value); setFilterPotencia(""); }} className={SEL}>
            <option value="">Relacion</option>
            <option value="13">13,2/0,4 kV</option>
            <option value="33">33/0,4 kV</option>
          </select>

          <select value={filterFases} onChange={e => setFilterFases(e.target.value)} className={SEL}>
            <option value="">Cant. de Fases</option>
            <option value="mono">Monofásico</option>
            <option value="tri">Trifásico</option>
          </select>

          <select value={filterZona} onChange={e => setFilterZona(e.target.value)} className={SEL}>
            <option value="">Zona</option>
            {availableZonas.map(z => <option key={z} value={z}>{z}</option>)}
          </select>

          {(filterAno || filterMes || filterPotencia || filterRelacion || filterFases || filterZona) && (
            <button
              onClick={() => { setFilterAno(""); setFilterMes(""); setFilterPotencia(""); setFilterRelacion(""); setFilterFases(""); setFilterZona(""); }}
              className="px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-colors"
            >
              Limpiar
            </button>
          )}
        </div>

        {/* 4 KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map(k => (
            <div key={k.label} className="bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 flex flex-col items-center gap-1 shadow-sm">
              <span className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase text-center">{k.label}</span>
              <span className={`text-3xl font-bold ${k.color}`}>{k.value >= 0 ? k.value : k.value}</span>
            </div>
          ))}
        </div>

        {current && (
          <p className="text-[11px] text-slate-500 text-right">
            Planilla: {current.fecha.split("-").map((v,i)=>i===0?v.slice(2):v).reverse().join("/")}
            {current.datos.deposito ? ` — ${current.datos.deposito}` : ""}
          </p>
        )}
      </div>

      {/* ── Promedios + Gauge ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          {[
            { label: "STOCK REAL PROMEDIO",  value: avgAll },
            { label: "PROMEDIO DE 13,2/0,4", value: avg13  },
            { label: "PROMEDIO DE 33/0,4",   value: avg33  },
          ].map(k => (
            <div key={k.label} className="bg-card border border-border rounded-xl px-5 py-4 shadow-sm">
              <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-1">{k.label}</p>
              <p className="text-4xl font-bold text-foreground">{k.value.toFixed(1)}</p>
            </div>
          ))}
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col">
          <p className="text-sm font-semibold text-foreground mb-2">Salud del Inventario</p>
          <div className="flex-1 flex items-center justify-center">
            <GaugeChart ratio={gaugeRatio} />
          </div>
          {latestPlanilla && (
            <p className="text-[11px] text-muted-foreground text-center mt-1">
              Planilla actual: {latestPlanilla.fecha.split("-").map((v,i)=>i===0?v.slice(2):v).reverse().join("/")}
              {latestPlanilla.datos.deposito ? ` — ${latestPlanilla.datos.deposito}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* Existing inventory KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {existingKpis.map(kpi => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col gap-2">
              <div className={`w-9 h-9 rounded-lg ${kpi.bgColor} flex items-center justify-center`}>
                <Icon className={`w-5 h-5 ${kpi.color}`} />
              </div>
              <p className="text-2xl font-bold text-foreground">{kpi.value}</p>
              <p className="text-xs text-muted-foreground leading-tight">{kpi.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4">Distribución por tipo</h3>
          {Object.keys(byTipo).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(byTipo).sort((a, b) => b[1] - a[1]).map(([tipo, count]) => (
                <div key={tipo}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-foreground truncate">{tipo}</span>
                    <span className="text-muted-foreground ml-4 shrink-0">{count}</span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${(count / total) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4">Top ubicaciones</h3>
          {topUbicaciones.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos</p>
          ) : (
            <div className="space-y-3">
              {topUbicaciones.map(([ubic, count]) => (
                <div key={ubic}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-foreground truncate">{ubic}</span>
                    <span className="text-muted-foreground ml-4 shrink-0">{count}</span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-chart-1 rounded-full transition-all duration-500" style={{ width: `${(count / total) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground mb-4">Últimos registros</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay transformadores registrados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="pb-2 text-left font-medium">Número</th>
                  <th className="pb-2 text-left font-medium">Tipo</th>
                  <th className="pb-2 text-left font-medium">Potencia</th>
                  <th className="pb-2 text-left font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map(r => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="py-2 font-mono font-semibold text-foreground">{r.numero}</td>
                    <td className="py-2 text-muted-foreground">{r.tipo ?? "—"}</td>
                    <td className="py-2 text-muted-foreground">{r.potencia ? `${r.potencia} kVA` : "—"}</td>
                    <td className="py-2">
                      {r.estado ? (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_BADGE[r.estado] ?? "bg-secondary text-muted-foreground"}`}>
                          {r.estado}
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
