"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList, ResponsiveContainer,
} from "recharts";
import {
  Zap, CheckCircle2, Wrench, XCircle, RefreshCw, Loader2, ChevronDown,
  Bell, BellRing, Plus, Trash2, X,
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

// ── Alarm system ──────────────────────────────────────────────────────────────

interface AlarmRule {
  id:        string;
  potencia:  string;
  relacion:  string;
  fases:     string;
  zona:      string;
  threshold: number;
}

const ALARM_KEY = "transformadores_alarms";

function loadAlarms(): AlarmRule[] {
  try { return JSON.parse(localStorage.getItem(ALARM_KEY) ?? "[]"); } catch { return []; }
}
function saveAlarms(rules: AlarmRule[]) {
  localStorage.setItem(ALARM_KEY, JSON.stringify(rules));
}

// ── FilterSelect ──────────────────────────────────────────────────────────────

function FilterSelect({ value, onChange, placeholder, options }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const current = options.find(o => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2 pl-3.5 pr-3 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200 min-w-[110px] justify-between ${
          value
            ? "bg-accent/10 border-accent/40 text-accent hover:bg-accent/15"
            : "bg-card border-border text-foreground hover:bg-secondary hover:border-border/80"
        }`}
      >
        <span>{current?.label ?? placeholder}</span>
        <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 min-w-full bg-card border border-border rounded-xl shadow-2xl z-50 py-1 overflow-hidden">
          <button
            onClick={() => { onChange(""); setOpen(false); }}
            className={`w-full text-left px-3.5 py-2 text-sm transition-colors ${!value ? "text-accent font-medium bg-accent/8" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
          >
            {placeholder}
          </button>
          <div className="h-px bg-border/50 mx-2 my-0.5" />
          {options.map(o => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-3.5 py-2 text-sm transition-colors ${o.value === value ? "text-accent font-semibold bg-accent/8" : "text-foreground hover:bg-secondary"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Custom bar label (negative bars get label below) ─────────────────────────

function VariacionLabel(props: { x?: string | number; y?: string | number; width?: string | number; height?: string | number; value?: string | number }) {
  const x      = Number(props.x      ?? 0);
  const y      = Number(props.y      ?? 0);
  const width  = Number(props.width  ?? 0);
  const height = Number(props.height ?? 0);
  const value  = Number(props.value  ?? 0);
  if (!value) return null;
  const isNeg = value < 0;
  return (
    <text
      x={x + width / 2}
      y={isNeg ? y + Math.abs(height) + 13 : y - 5}
      textAnchor="middle"
      fontSize={10}
      fill="#94a3b8"
    >
      {value}
    </text>
  );
}

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

  const [activeBarIndex, setActiveBarIndex] = useState<number | null>(null);

  // Filters
  const [filterAno,      setFilterAno]      = useState("");
  const [filterMes,      setFilterMes]      = useState("");
  const [filterPotencia, setFilterPotencia] = useState("");
  const [filterRelacion, setFilterRelacion] = useState("");
  const [filterFases,    setFilterFases]    = useState("");
  const [filterZona,     setFilterZona]     = useState("");

  // Alarms
  const [showAlarms, setShowAlarms]   = useState(false);
  const [alarms, setAlarms]           = useState<AlarmRule[]>([]);
  const [newAlarm, setNewAlarm]       = useState<Omit<AlarmRule, "id">>({ potencia: "", relacion: "", fases: "", zona: "", threshold: 5 });
  const alarmsRef                     = useRef<HTMLDivElement>(null);

  useEffect(() => { setAlarms(loadAlarms()); }, []);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (alarmsRef.current && !alarmsRef.current.contains(e.target as Node)) setShowAlarms(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: trafos, error: e1 }, { data: plans, error: e2 }] = await Promise.all([
      supabase.from("transformadores").select("*"),
      supabase.from("planillas_reserva").select("id,fecha,datos").order("fecha", { ascending: false }),
    ]);
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

  // ── Variación neta mensual ────────────────────────────────────────────────

  const MES_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  const variacionData = (() => {
    const byMonth: Record<string, { bruto: number; auto: number; neto: number; zonas: string[] }> = {};
    for (const p of planillas) {
      const key = p.fecha.slice(0, 7);
      const bruto = s13(p) + s33(p);
      const auto  = POT_13.reduce((s, k) => s + (p.datos.autorizados?.[String(k)] ?? 0), 0);
      const neto  = bruto - auto;
      const zona  = p.datos.deposito ?? "sin zona";
      if (!byMonth[key]) byMonth[key] = { bruto: 0, auto: 0, neto: 0, zonas: [] };
      byMonth[key].bruto += bruto;
      byMonth[key].auto  += auto;
      byMonth[key].neto  += neto;
      byMonth[key].zonas.push(zona);
    }
    const sorted = Object.keys(byMonth).sort();
    return sorted.map((key, i) => {
      const [y, m] = key.split("-");
      const prev = i > 0 ? byMonth[sorted[i - 1]].neto : byMonth[key].neto;
      return {
        mes: `${MES_SHORT[Number(m) - 1]} ${y}`,
        bruto: byMonth[key].bruto,
        auto:  byMonth[key].auto,
        neto:  byMonth[key].neto,
        zonas: byMonth[key].zonas.join(", "),
        variacion: byMonth[key].neto - prev,
      };
    });
  })();

  // ── Alarm evaluation ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!planillas.length || !alarms.length) return;
    const latest = planillas[0];
    for (const rule of alarms) {
      const rKvas = rule.potencia
        ? [Number(rule.potencia)]
        : kvasFor(rule.relacion, rule.fases);
      const rZona = rule.zona;
      const relevantPlanillas = rZona
        ? planillas.filter(p => (p.datos.deposito ?? "") === rZona)
        : [latest];
      const p = relevantPlanillas[0];
      if (!p) continue;
      const bruto = computeStockBruto(p, rKvas, rule.relacion);
      const pend  = computePendientes(p, rKvas, rule.relacion);
      const neto  = bruto - pend;
      if (neto <= rule.threshold) {
        const label = [rule.potencia && `${rule.potencia} kVA`, rule.relacion && `${rule.relacion === "33" ? "33/0,4" : "13,2/0,4"} kV`, rule.fases && (rule.fases === "mono" ? "Monofásico" : "Trifásico"), rule.zona].filter(Boolean).join(" · ") || "General";
        toast.warning(`⚠ Stock bajo: ${label} — Neto: ${neto} (umbral: ${rule.threshold})`, { duration: 6000 });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planillas, alarms]);

  // ── Alarm helpers ─────────────────────────────────────────────────────────

  function addAlarm() {
    const rule: AlarmRule = { ...newAlarm, id: crypto.randomUUID() };
    const updated = [...alarms, rule];
    setAlarms(updated);
    saveAlarms(updated);
    setNewAlarm({ potencia: "", relacion: "", fases: "", zona: "", threshold: 5 });
  }

  function removeAlarm(id: string) {
    const updated = alarms.filter(a => a.id !== id);
    setAlarms(updated);
    saveAlarms(updated);
  }

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
          <FilterSelect
            value={filterAno}
            onChange={setFilterAno}
            placeholder="Año"
            options={availableYears.map(y => ({ value: y, label: y }))}
          />
          <FilterSelect
            value={filterMes}
            onChange={setFilterMes}
            placeholder="Mes"
            options={MONTHS.map(m => ({ value: m.value, label: m.label }))}
          />
          <FilterSelect
            value={filterPotencia}
            onChange={setFilterPotencia}
            placeholder="Potencia"
            options={(filterRelacion === "33" ? POT_33 : POT_13).map(k => ({ value: String(k), label: `${k} kVA` }))}
          />
          <FilterSelect
            value={filterRelacion}
            onChange={v => { setFilterRelacion(v); setFilterPotencia(""); }}
            placeholder="Relación"
            options={[{ value: "13", label: "13,2/0,4 kV" }, { value: "33", label: "33/0,4 kV" }]}
          />
          <FilterSelect
            value={filterFases}
            onChange={setFilterFases}
            placeholder="Fases"
            options={[{ value: "mono", label: "Monofásico" }, { value: "tri", label: "Trifásico" }]}
          />
          <FilterSelect
            value={filterZona}
            onChange={setFilterZona}
            placeholder="Zona"
            options={availableZonas.map(z => ({ value: z, label: z }))}
          />

          {(filterAno || filterMes || filterPotencia || filterRelacion || filterFases || filterZona) && (
            <button
              onClick={() => { setFilterAno(""); setFilterMes(""); setFilterPotencia(""); setFilterRelacion(""); setFilterFases(""); setFilterZona(""); }}
              className="px-3.5 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-colors"
            >
              Limpiar
            </button>
          )}

          {/* Alarm button */}
          <div ref={alarmsRef} className="relative ml-auto">
            <button
              onClick={() => setShowAlarms(v => !v)}
              className={`flex items-center gap-2 pl-3 pr-3.5 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200 ${
                alarms.length > 0
                  ? "bg-amber-500/10 border-amber-500/40 text-amber-400 hover:bg-amber-500/15"
                  : "bg-card border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {alarms.length > 0 ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
              <span>Alarmas</span>
              {alarms.length > 0 && (
                <span className="w-5 h-5 rounded-full bg-amber-500 text-[10px] font-bold text-black flex items-center justify-center">
                  {alarms.length}
                </span>
              )}
            </button>

            {showAlarms && (
              <div className="absolute right-0 top-full mt-2 w-[420px] bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden">
                {/* Panel header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <BellRing className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-semibold text-foreground">Configurar alarmas de stock</span>
                  </div>
                  <button onClick={() => setShowAlarms(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Existing alarms */}
                {alarms.length > 0 && (
                  <div className="px-4 py-3 space-y-2 border-b border-border max-h-52 overflow-y-auto">
                    {alarms.map(a => {
                      const parts = [
                        a.potencia && `${a.potencia} kVA`,
                        a.relacion && (a.relacion === "33" ? "33/0,4 kV" : "13,2/0,4 kV"),
                        a.fases && (a.fases === "mono" ? "Mono" : "Tri"),
                        a.zona,
                      ].filter(Boolean);
                      return (
                        <div key={a.id} className="flex items-center justify-between gap-2 bg-secondary/50 rounded-lg px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">
                              {parts.length ? parts.join(" · ") : "Todos"}
                            </p>
                            <p className="text-[11px] text-muted-foreground">Umbral: stock neto ≤ {a.threshold}</p>
                          </div>
                          <button onClick={() => removeAlarm(a.id)} className="text-muted-foreground hover:text-red-400 transition-colors shrink-0">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* New alarm form */}
                <div className="px-4 py-3 space-y-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Nueva alarma</p>
                  <div className="grid grid-cols-2 gap-2">
                    <FilterSelect value={newAlarm.potencia} onChange={v => setNewAlarm(p => ({ ...p, potencia: v }))} placeholder="Potencia" options={(newAlarm.relacion === "33" ? POT_33 : POT_13).map(k => ({ value: String(k), label: `${k} kVA` }))} />
                    <FilterSelect value={newAlarm.relacion} onChange={v => setNewAlarm(p => ({ ...p, relacion: v, potencia: "" }))} placeholder="Relación" options={[{ value: "13", label: "13,2/0,4 kV" }, { value: "33", label: "33/0,4 kV" }]} />
                    <FilterSelect value={newAlarm.fases} onChange={v => setNewAlarm(p => ({ ...p, fases: v }))} placeholder="Fases" options={[{ value: "mono", label: "Monofásico" }, { value: "tri", label: "Trifásico" }]} />
                    <FilterSelect value={newAlarm.zona} onChange={v => setNewAlarm(p => ({ ...p, zona: v }))} placeholder="Zona" options={availableZonas.map(z => ({ value: z, label: z }))} />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 flex-1 bg-secondary/50 border border-border rounded-xl px-3 py-2">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">Stock neto ≤</span>
                      <input
                        type="number"
                        min={1}
                        value={newAlarm.threshold}
                        onChange={e => setNewAlarm(p => ({ ...p, threshold: Number(e.target.value) }))}
                        className="flex-1 bg-transparent text-sm font-semibold text-foreground focus:outline-none w-0 min-w-0"
                      />
                    </div>
                    <button
                      onClick={addAlarm}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/90 transition-colors shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Agregar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
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

      {/* ── Gráfico de Variación Neta ── */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <p className="text-sm font-semibold text-foreground">Gráfico de Variación Neta</p>
        <p className="text-xs text-blue-400 mb-4">Stock neto en comparación con el mes anterior</p>
        {variacionData.length < 2 ? (
          <p className="text-sm text-muted-foreground">Se necesitan al menos 2 planillas para calcular la variación.</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={variacionData} margin={{ top: 28, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} label={{ value: "Variación neta", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: "#64748b" } }} />
              <Tooltip
                cursor={false}
                contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#94a3b8" }}
                itemStyle={{ color: "#f1f5f9" }}
                formatter={(v: number) => [v, "Variación"]}
              />
              <Bar
                dataKey="variacion"
                radius={[3, 3, 0, 0]}
                maxBarSize={48}
                activeBar={false}
                onMouseEnter={(_: unknown, index: number) => setActiveBarIndex(index)}
                onMouseLeave={() => setActiveBarIndex(null)}
              >
                <LabelList dataKey="variacion" content={VariacionLabel} />
                {variacionData.map((d, i) => {
                  const baseColor = d.variacion >= 0 ? "#16a34a" : "#dc2626";
                  const isActive  = activeBarIndex === i;
                  const isDimmed  = activeBarIndex !== null && !isActive;
                  return (
                    <Cell
                      key={i}
                      fill={baseColor}
                      fillOpacity={isDimmed ? 0.35 : 1}
                      style={isActive ? { filter: "brightness(1.45)" } : undefined}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Tabla de verificación ── */}
      {variacionData.length > 0 && (
        <details className="bg-card border border-border rounded-xl shadow-sm">
          <summary className="px-5 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
            Ver detalle del cálculo
          </summary>
          <div className="overflow-x-auto px-5 pb-4">
            <table className="w-full text-xs mt-2">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="pb-2 text-left font-medium">Mes</th>
                  <th className="pb-2 text-right font-medium">Stock Bruto</th>
                  <th className="pb-2 text-right font-medium">Autorizados</th>
                  <th className="pb-2 text-right font-medium">Stock Neto</th>
                  <th className="pb-2 text-right font-medium">Variación</th>
                  <th className="pb-2 text-left font-medium pl-4">Zonas incluidas</th>
                </tr>
              </thead>
              <tbody>
                {variacionData.map((d, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 text-foreground font-medium">{d.mes}</td>
                    <td className="py-1.5 text-right text-foreground">{d.bruto}</td>
                    <td className="py-1.5 text-right text-amber-400">{d.auto}</td>
                    <td className="py-1.5 text-right text-foreground">{d.neto}</td>
                    <td className={`py-1.5 text-right font-semibold ${d.variacion > 0 ? "text-green-400" : d.variacion < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                      {i === 0 ? "—" : d.variacion > 0 ? `+${d.variacion}` : d.variacion}
                    </td>
                    <td className="py-1.5 text-muted-foreground pl-4">{d.zonas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

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
