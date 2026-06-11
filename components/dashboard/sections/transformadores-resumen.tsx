"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList,
  ResponsiveContainer, PieChart, Pie, Legend, Sector,
} from "recharts";
import {
  CheckCircle2, RefreshCw, Loader2, ChevronDown,
  Bell, BellRing, Plus, Trash2, X, Package, TrendingUp, TrendingDown, Clock,
  LayoutGrid, GripVertical,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DraggableAttributes, type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

function kvasFor(relacion: string, fases: string): number[] {
  let base = relacion === "33" ? POT_33 : POT_13;
  if (fases === "mono") base = base.filter(k => MONO_KVA.has(k));
  if (fases === "tri")  base = base.filter(k => TRI_KVA.has(k));
  return base;
}

function computeStockBruto(p: PlanillaReserva, kvas: number[], relacion: string, fases: string = ""): number {
  let total = 0;
  if (relacion === "" || relacion === "13") {
    const kvas13 = kvas.filter(k => POT_13.includes(k));
    total += kvas13.reduce((s, k) => s + (p.datos.totales?.[String(k)] ?? 0), 0);
  }
  if (relacion === "" || relacion === "33") {
    const kvas33 = kvas.filter(k => POT_33.includes(k));
    total += kvas33.reduce((s, k) => {
      const r = p.datos.rel33?.[String(k)];
      if (!r) return s;
      if (fases === "mono") return s + r.mN + r.mR;
      if (fases === "tri")  return s + r.tN + r.tR;
      return s + r.tN + r.mN + r.tR + r.mR;
    }, 0);
  }
  return total;
}

function computePendientes(p: PlanillaReserva, kvas: number[], relacion: string): number {
  if (relacion === "33") return 0;
  const kvas13 = kvas.filter(k => POT_13.includes(k));
  return kvas13.reduce((s, k) => s + (p.datos.autorizados?.[String(k)] ?? 0), 0);
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

// ── Reorder persistence (drag & drop) ─────────────────────────────────────────

function useOrder(key: string, defaultOrder: string[]) {
  const [order, setOrderState] = useState<string[]>(defaultOrder);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null") as string[] | null;
      if (saved && saved.length === defaultOrder.length && defaultOrder.every(id => saved.includes(id))) {
        setOrderState(saved);
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setOrder = useCallback((updater: string[] | ((prev: string[]) => string[])) => {
    setOrderState(prev => {
      const next = typeof updater === "function" ? (updater as (p: string[]) => string[])(prev) : updater;
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, [key]);

  return [order, setOrder] as const;
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

// ── Animation utilities ───────────────────────────────────────────────────────

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function useCountUp(target: number, dur = 900, delay = 0) {
  const [v, setV] = useState(0);
  const fromRef   = useRef(0);
  useEffect(() => {
    let raf: number;
    let to: ReturnType<typeof setTimeout>;
    const from = fromRef.current;
    const start = () => {
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / dur);
        setV(from + (target - from) * easeOutCubic(p));
        if (p < 1) raf = requestAnimationFrame(step);
        else fromRef.current = target;
      };
      raf = requestAnimationFrame(step);
    };
    to = setTimeout(start, delay);
    return () => { clearTimeout(to); cancelAnimationFrame(raf); };
  }, [target, dur, delay]);
  return v;
}

// ── KpiStatCard ───────────────────────────────────────────────────────────────

type KpiTone = "neutral" | "warn" | "pos" | "delta";

const KPI_TONE: Record<KpiTone, { color: string; soft: string }> = {
  neutral: { color: "oklch(0.72 0.16 265)",  soft: "oklch(0.72 0.16 265 / 0.14)"  },
  warn:    { color: "oklch(0.80 0.15 85)",   soft: "oklch(0.80 0.15 85  / 0.14)"  },
  pos:     { color: "oklch(0.74 0.16 152)",  soft: "oklch(0.74 0.16 152 / 0.14)"  },
  delta:   { color: "oklch(0.74 0.16 152)",  soft: "oklch(0.74 0.16 152 / 0.14)"  },
};

interface DragHandle {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
}

function KpiStatCard({ label, value, tone, sub, showSign = false, idx = 0, dragHandle }: {
  label: string; value: number; tone: KpiTone; sub: string; showSign?: boolean; idx?: number;
  dragHandle?: DragHandle;
}) {
  const animated   = useCountUp(Math.abs(value), 1100, 100 + idx * 80);
  const isNeg      = value < 0;
  const resolvedTone = tone === "delta"
    ? (isNeg ? "warn" : "pos") as KpiTone
    : tone;
  const { color, soft } = KPI_TONE[resolvedTone];

  const IconEl =
    tone === "neutral"  ? Package       :
    tone === "warn"     ? Clock         :
    tone === "pos"      ? CheckCircle2  :
    isNeg               ? TrendingDown  : TrendingUp;

  const display = Math.round(animated).toLocaleString("es-AR");
  const prefix  = showSign ? (isNeg ? "−" : "+") : (isNeg ? "−" : "");

  return (
    <div
      style={{
        background: "oklch(0.19 0.015 265)",
        border: "1px solid oklch(0.30 0.020 265)",
        borderRadius: 14,
        padding: "18px 20px 20px",
        display: "flex", flexDirection: "column", gap: 0,
        position: "relative", overflow: "hidden",
        transition: "transform .25s cubic-bezier(.2,.7,.2,1), border-color .25s, box-shadow .25s",
        cursor: "default",
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform    = "translateY(-2px)";
        el.style.borderColor  = color;
        el.style.boxShadow    = `0 8px 28px -10px ${soft.replace("0.14", "0.35")}`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform   = "";
        el.style.borderColor = "";
        el.style.boxShadow   = "";
      }}
    >
      {/* top row: label + icon */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {dragHandle && (
            <span
              {...dragHandle.attributes}
              {...dragHandle.listeners}
              className="touch-none"
              style={{ display: "flex", color: "oklch(0.45 0.018 265)", cursor: "grab" }}
            >
              <GripVertical size={12} />
            </span>
          )}
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
            textTransform: "uppercase", color: "oklch(0.55 0.018 265)",
          }}>
            {label}
          </span>
        </div>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: soft, color,
          display: "grid", placeItems: "center",
          flexShrink: 0,
        }}>
          <IconEl size={14} strokeWidth={2} />
        </div>
      </div>

      {/* big number */}
      <div style={{
        fontSize: 38, fontWeight: 700, letterSpacing: "-.03em",
        color, lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
      }}>
        {prefix}{display}
      </div>

      {/* sublabel */}
      <div style={{
        marginTop: 8, fontSize: 12,
        color: "oklch(0.45 0.018 265)",
      }}>
        {sub}
      </div>

      {/* bottom accent strip */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${color}, transparent)`,
        opacity: 0.5,
      }} />
    </div>
  );
}

// ── Sortable wrapper (drag & drop reordering) ─────────────────────────────────

function SortableItem({ id, children }: {
  id: string;
  children: (handle: DragHandle) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : "auto",
        position: "relative",
      }}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

// ── KPI definitions (id, metadata) ────────────────────────────────────────────

const KPI_ORDER_KEY = "transformadores_kpi_order";

const KPI_DEFS: { id: string; label: string; tone: KpiTone; sub: string; showSign?: boolean }[] = [
  { id: "bruto",      label: "Stock Bruto",            tone: "neutral", sub: "Inventario total registrado" },
  { id: "pendientes", label: "Pendientes de Retiro",   tone: "warn",    sub: "En cola de retiro" },
  { id: "neto",       label: "Stock Neto",             tone: "pos",     sub: "Disponible neto" },
  { id: "variacion",  label: "Variación Neta Mensual", tone: "delta",   sub: "vs. planilla anterior", showSign: true },
];

const DEFAULT_KPI_ORDER = KPI_DEFS.map(k => k.id);

// ── Animated pie slice on hover ───────────────────────────────────────────────

function renderActiveSlice(props: {
  cx: number; cy: number; innerRadius: number; outerRadius: number;
  startAngle: number; endAngle: number; fill: string;
}) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <g>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 10}
        startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.95} />
      <Sector cx={cx} cy={cy} innerRadius={outerRadius + 12} outerRadius={outerRadius + 15}
        startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.35} />
    </g>
  );
}

function HoverPie({ data, colors, formatter }: {
  data: { name: string; value: number }[];
  colors: string[];
  formatter?: (v: number, n: string) => [number | string, string];
}) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={72}
          label={({ percent }: { percent: number }) => `${(percent * 100).toFixed(0)}%`}
          labelLine={false}
          activeIndex={activeIndex}
          activeShape={renderActiveSlice as React.ComponentProps<typeof Pie>["activeShape"]}
          onMouseEnter={(_: unknown, index: number) => setActiveIndex(index)}
          onMouseLeave={() => setActiveIndex(undefined)}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
          itemStyle={{ color: "#f1f5f9" }}
          formatter={formatter}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Chart panel (beast pure dark style, shared by all chart cards) ────────────

const PANEL_STYLE: React.CSSProperties = {
  background: "oklch(0.205 0.005 270)",
  border: "1px solid oklch(1 0 0 / 0.07)",
  borderRadius: 14,
};

function ChartPanel({ title, subtitle, right, dragHandle, children, className = "p-5" }: {
  title: string; subtitle?: string; right?: React.ReactNode;
  dragHandle?: DragHandle; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className} style={PANEL_STYLE}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-2 min-w-0">
          {dragHandle && (
            <span
              {...dragHandle.attributes}
              {...dragHandle.listeners}
              className="touch-none mt-0.5"
              style={{ display: "flex", color: "oklch(0.45 0.018 265)", cursor: "grab", flexShrink: 0 }}
            >
              <GripVertical size={13} />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {right && <div className="flex-shrink-0">{right}</div>}
      </div>
      {children}
    </div>
  );
}

export function TransformadoresResumenSection() {
  const [planillas, setPlanillas] = useState<PlanillaReserva[]>([]);
  const [loading, setLoading]     = useState(true);

  const [activeBarIndex, setActiveBarIndex] = useState<number | null>(null);

  // KPI drag & drop order
  const [kpiOrder, setKpiOrder] = useOrder(KPI_ORDER_KEY, DEFAULT_KPI_ORDER);
  const kpiSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const handleKpiDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setKpiOrder(prev => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, [setKpiOrder]);

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

    const { data: plans, error: e2 } = await supabase
      .from("planillas_reserva")
      .select("id,fecha,datos")
      .order("fecha", { ascending: false });

    if (e2) {
      console.error("[planillas_reserva]", e2);
      toast.error(`Planillas: ${e2.message}`);
    } else if (plans !== null && plans.length === 0) {
      console.warn("[planillas_reserva] 0 filas — verificar RLS en Supabase.");
      toast.warning("Sin datos de planillas. Verificar que RLS esté deshabilitado en la tabla planillas_reserva.", { duration: 8000 });
    }

    setPlanillas(plans ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Promedio / Gauge ─────────────────────────────────────────────────────

  const s13 = (p: PlanillaReserva) => POT_13.reduce((s, k) => s + (p.datos.totales?.[String(k)] ?? 0), 0);
  const s33 = (p: PlanillaReserva) => POT_33.reduce((s, k) => { const r = p.datos.rel33?.[String(k)]; return s + (r ? r.tN + r.mN + r.tR + r.mR : 0); }, 0);
  const autoFor = (p: PlanillaReserva) => POT_13.reduce((s, k) => s + (p.datos.autorizados?.[String(k)] ?? 0), 0);

  // ── Shared monthly snapshot (last planilla per zone per month, zones summed) ─
  const MES_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  const monthlySnapshots = (() => {
    const byZoneMonth: Record<string, PlanillaReserva> = {};
    for (const p of planillas) {
      const key = `${p.datos.deposito ?? ""}::${p.fecha.slice(0, 7)}`;
      if (!byZoneMonth[key] || p.fecha > byZoneMonth[key].fecha) byZoneMonth[key] = p;
    }
    const byMonth: Record<string, { bruto: number; auto: number; neto: number; neto13: number; neto33: number; zonas: Set<string> }> = {};
    for (const p of Object.values(byZoneMonth)) {
      const key  = p.fecha.slice(0, 7);
      const auto = autoFor(p);
      if (!byMonth[key]) byMonth[key] = { bruto: 0, auto: 0, neto: 0, neto13: 0, neto33: 0, zonas: new Set() };
      byMonth[key].bruto  += s13(p) + s33(p);
      byMonth[key].auto   += auto;
      byMonth[key].neto   += s13(p) + s33(p) - auto;
      byMonth[key].neto13 += s13(p) - auto;
      byMonth[key].neto33 += s33(p);
      if (p.datos.deposito) byMonth[key].zonas.add(p.datos.deposito);
    }
    return byMonth;
  })();

  const sortedMonths = Object.keys(monthlySnapshots).sort();

  // ── Variación neta mensual (reuses monthlySnapshots) ─────────────────────

  const variacionData = sortedMonths.map((key, i) => {
    const [y, m] = key.split("-");
    const prev   = i > 0 ? monthlySnapshots[sortedMonths[i - 1]].neto : monthlySnapshots[key].neto;
    return {
      mes:       `${MES_SHORT[Number(m) - 1]} ${y.slice(2)}`,
      bruto:     monthlySnapshots[key].bruto,
      auto:      monthlySnapshots[key].auto,
      neto:      monthlySnapshots[key].neto,
      neto13:    monthlySnapshots[key].neto13,
      neto33:    monthlySnapshots[key].neto33,
      zonas:     [...monthlySnapshots[key].zonas].join(", "),
      variacion: monthlySnapshots[key].neto - prev,
    };
  });


  // ── Alarm evaluation ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!planillas.length || !alarms.length) return;
    const latest = planillas[0];
    for (const rule of alarms) {
      const rKvas = rule.potencia
        ? [Number(rule.potencia)]
        : [...new Set([...kvasFor(rule.relacion || "13", rule.fases), ...POT_33])];
      const rZona = rule.zona;
      const relevantPlanillas = rZona
        ? planillas.filter(p => (p.datos.deposito ?? "") === rZona)
        : [latest];
      const p = relevantPlanillas[0];
      if (!p) continue;
      const bruto = computeStockBruto(p, rKvas, rule.relacion, rule.fases);
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

  const kvas = filterPotencia
    ? [Number(filterPotencia)]
    : [...new Set([...kvasFor(filterRelacion || "13", filterFases), ...POT_33])];

  // Group by fecha and take the most recent period — summing across all zones
  const fechasUnicas = [...new Set(planillasFiltradas.map(p => p.fecha))].sort((a, b) => b.localeCompare(a));
  const currentFecha = fechasUnicas[0] ?? null;
  const planillasActuales = currentFecha
    ? planillasFiltradas.filter(p => p.fecha === currentFecha)
    : [];

  // Previous period: first fecha strictly before currentFecha, from ALL planillas with zona filter only
  const todasConZona = filterZona
    ? planillas.filter(p => (p.datos.deposito ?? "") === filterZona)
    : planillas;
  const prevFecha = currentFecha
    ? ([...new Set(todasConZona.map(p => p.fecha))] as string[]).sort((a, b) => b.localeCompare(a)).find(f => f < currentFecha) ?? null
    : null;
  const planillasAnteriores = prevFecha
    ? todasConZona.filter(p => p.fecha === prevFecha)
    : [];

  const stockBruto    = planillasActuales.reduce((s, p) => s + computeStockBruto(p, kvas, filterRelacion, filterFases), 0);
  const pendientes    = planillasActuales.reduce((s, p) => s + computePendientes(p, kvas, filterRelacion), 0);
  const stockNeto     = stockBruto - pendientes;
  const prevStockNeto = planillasAnteriores.length > 0
    ? planillasAnteriores.reduce((s, p) => s + computeStockBruto(p, kvas, filterRelacion, filterFases) - computePendientes(p, kvas, filterRelacion), 0)
    : null;
  const variacion     = prevStockNeto !== null ? stockNeto - prevStockNeto : 0;

  // ── Pie: zonas (stock actual) ────────────────────────────────────────────
  const zonaPieData = (() => {
    const byZone: Record<string, number> = {};
    for (const p of planillasActuales) {
      const z = p.datos.deposito ?? "Sin zona";
      byZone[z] = (byZone[z] ?? 0) + s13(p) + s33(p);
    }
    return Object.entries(byZone).map(([name, value]) => ({ name, value }));
  })();

  const tercerosVsTaller13 = (() => {
    let terceros = 0, taller = 0;
    for (const p of planillasActuales) {
      for (const k of POT_13) {
        terceros += (p.datos.terceros?.[String(k)]?.t ?? 0) + (p.datos.terceros?.[String(k)]?.m ?? 0);
        taller   += (p.datos.taller?.[String(k)]?.t   ?? 0) + (p.datos.taller?.[String(k)]?.m   ?? 0);
      }
    }
    return [
      { name: "Nuevos / por Terceros", value: terceros },
      { name: "Reparados por Taller",  value: taller },
    ].filter(d => d.value > 0);
  })();

  const nuevosVsReparados33 = (() => {
    let nuevos = 0, reparados = 0;
    for (const p of planillasActuales) {
      for (const k of POT_33) {
        const r = p.datos.rel33?.[String(k)];
        if (!r) continue;
        nuevos    += r.tN + r.mN;
        reparados += r.tR + r.mR;
      }
    }
    return [
      { name: "Nuevos",    value: nuevos },
      { name: "Reparados", value: reparados },
    ].filter(d => d.value > 0);
  })();

  // Label for the planilla info footer
  const zonasFecha = [...new Set(planillasActuales.map(p => p.datos.deposito).filter((z): z is string => !!z))];
  const currentLabel = currentFecha
    ? `${(currentFecha as string).split("-").map((v: string, i: number) => i === 0 ? v.slice(2) : v).reverse().join("/")}${zonasFecha.length > 0 ? ` — ${zonasFecha.join(" + ")}` : ""}`
    : null;

  // ── Stock disponible por KVA (chart data) ────────────────────────────────
  const stockPorKva = (() => {
    type Row = { kva: number; relacion: "13" | "33"; disponible: number; comprometido: number; label: string };
    const map: Record<string, Row> = {};
    const showFases = filterFases;
    const onlyRel = filterRelacion;

    for (const p of planillasActuales) {
      if (onlyRel === "" || onlyRel === "13") {
        for (const k of POT_13) {
          if (filterPotencia && Number(filterPotencia) !== k) continue;
          if (showFases === "mono" && !MONO_KVA.has(k)) continue;
          if (showFases === "tri"  && !TRI_KVA.has(k))  continue;
          const total = p.datos.totales?.[String(k)] ?? 0;
          const auto  = p.datos.autorizados?.[String(k)] ?? 0;
          const disp  = total - auto;
          const key = `${k}-13`;
          if (!map[key]) map[key] = { kva: k, relacion: "13", disponible: 0, comprometido: 0, label: "" };
          map[key].disponible  += disp;
          map[key].comprometido += auto;
        }
      }
      if (onlyRel === "" || onlyRel === "33") {
        for (const k of POT_33) {
          if (filterPotencia && Number(filterPotencia) !== k) continue;
          const r = p.datos.rel33?.[String(k)];
          if (!r) continue;
          let total = 0;
          if (showFases === "mono")     total = r.mN + r.mR;
          else if (showFases === "tri") total = r.tN + r.tR;
          else                          total = r.tN + r.mN + r.tR + r.mR;
          const key = `${k}-33`;
          if (!map[key]) map[key] = { kva: k, relacion: "33", disponible: 0, comprometido: 0, label: "" };
          map[key].disponible  += total;
        }
      }
    }

    return Object.values(map)
      .filter(d => d.disponible !== 0 || d.comprometido !== 0)
      .map(d => ({
        ...d,
        label: `${d.kva} kVA${onlyRel === "" ? ` · ${d.relacion === "33" ? "33" : "13,2"}` : ""}`,
      }))
      .sort((a, b) => b.disponible - a.disponible);
  })();


  // Available options for filters
  const availableYears = [...new Set(planillas.map(p => p.fecha.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
  const availableZonas = [...new Set(planillas.map(p => p.datos.deposito ?? "").filter(Boolean))].sort();

  // KPI values keyed by id (for drag & drop ordering)
  const kpiValues: Record<string, number> = {
    bruto: stockBruto,
    pendientes,
    neto: stockNeto,
    variacion,
  };

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
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div
            className="grid place-items-center mt-0.5"
            style={{
              width: 36, height: 36, borderRadius: 9,
              background: "oklch(0.30 0.10 155 / 0.45)",
              border: "1px solid oklch(0.55 0.15 155 / 0.5)",
              color: "#86efac",
            }}
          >
            <LayoutGrid className="w-[18px] h-[18px]" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-foreground" style={{ letterSpacing: -0.4, margin: 0 }}>
              Resumen de Transformadores
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: "oklch(0.55 0 0)" }}>
              Resumen del inventario de transformadores
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-accent/40 transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* ── Filtros y Stock de Reserva ── */}
      <div
        className="px-4 py-6 sm:px-6 overflow-hidden"
        style={{
          background: "oklch(0.235 0.005 270)",
          border: "1px solid oklch(1 0 0 / 0.07)",
          borderRadius: 14,
        }}
      >
        <div className="flex items-center gap-3 mb-2">
          <div
            className="grid place-items-center"
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: "oklch(0.30 0.10 155 / 0.45)",
              border: "1px solid oklch(0.55 0.15 155 / 0.5)",
              color: "#86efac",
            }}
          >
            <Package className="w-4 h-4" strokeWidth={2} />
          </div>
          <h2 className="text-[20px] font-semibold tracking-tight text-foreground" style={{ letterSpacing: -0.3, margin: 0 }}>
            Stock de Reserva
          </h2>
        </div>
        <p className="ml-[42px] mb-7 text-[14.5px]" style={{ color: "oklch(0.58 0 0)" }}>
          Filtrá por año, mes, potencia, relación, fases o zona para ver los indicadores actuales.
        </p>

        <div className="space-y-4">

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
              <div className="absolute right-0 top-full mt-2 w-[420px] bg-card border border-border rounded-2xl shadow-2xl z-50">
                {/* Panel header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border rounded-t-2xl">
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
                <div className="px-4 py-3 space-y-3 rounded-b-2xl">
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

        {/* 4 KPI cards — drag & drop reordering */}
        <DndContext sensors={kpiSensors} collisionDetection={closestCenter} onDragEnd={handleKpiDragEnd}>
          <SortableContext items={kpiOrder} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {kpiOrder.map((id, idx) => {
                const def = KPI_DEFS.find(k => k.id === id);
                if (!def) return null;
                return (
                  <SortableItem key={id} id={id}>
                    {handle => (
                      <KpiStatCard
                        label={def.label}
                        value={kpiValues[id] ?? 0}
                        tone={def.tone}
                        sub={def.sub}
                        showSign={def.showSign}
                        idx={idx}
                        dragHandle={handle}
                      />
                    )}
                  </SortableItem>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

        {currentLabel && (
          <p className="text-[11px] text-slate-500 text-right">
            Planilla: {currentLabel}
          </p>
        )}
        </div>
      </div>

      {/* ── Gráfico de Variación Neta ── */}
      <ChartPanel title="Gráfico de Variación Neta" subtitle="Stock neto en comparación con el mes anterior">
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
      </ChartPanel>

      {/* ── Tabla de verificación ── */}
      {variacionData.length > 0 && (
        <details className="shadow-sm" style={PANEL_STYLE}>
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

      {/* ── Evolución de Stock por Tensión (dos gráficos) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Total vs 13,2 / 0,4 kV */}
        <ChartPanel title="Evolución — Total vs 13,2 / 0,4 kV" subtitle="Stock neto al cierre de cada mes">
          {variacionData.length < 2 ? (
            <p className="text-sm text-muted-foreground">Se necesitan planillas de al menos 2 meses distintos.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={variacionData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#94a3b8" }}
                  itemStyle={{ color: "#f1f5f9" }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Line type="monotone" dataKey="neto"   name="Total"         stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="neto13" name="13,2 / 0,4 kV" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        {/* Total vs 33 / 0,4 kV */}
        <ChartPanel title="Evolución — Total vs 33 / 0,4 kV" subtitle="Stock neto al cierre de cada mes">
          {variacionData.length < 2 ? (
            <p className="text-sm text-muted-foreground">Se necesitan planillas de al menos 2 meses distintos.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={variacionData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#94a3b8" }}
                  itemStyle={{ color: "#f1f5f9" }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Line type="monotone" dataKey="neto"   name="Total"       stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="neto33" name="33 / 0,4 kV" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>
      </div>

      {/* ── Pie charts ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Zonas */}
        <ChartPanel title="Stock por Zona" subtitle="Distribución actual entre depósitos">
          {zonaPieData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos.</p>
          ) : (
            <HoverPie
              data={zonaPieData}
              colors={["#6366f1","#38bdf8","#a78bfa","#34d399"]}
              formatter={(v: number, n: string) => [v, n]}
            />
          )}
        </ChartPanel>

        {/* Terceros vs Taller — 13.2 kV */}
        <ChartPanel title="Nuevos vs Reparados — 13,2 kV" subtitle="Nuevos / terceros vs reparados por taller">
          {tercerosVsTaller13.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos.</p>
          ) : (
            <HoverPie data={tercerosVsTaller13} colors={["#38bdf8","#f59e0b"]} />
          )}
        </ChartPanel>

        {/* Nuevos vs Reparados — 33 kV */}
        <ChartPanel title="Nuevos vs Reparados — 33 kV" subtitle="Composición del stock 33 / 0,4 kV">
          {nuevosVsReparados33.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos.</p>
          ) : (
            <HoverPie data={nuevosVsReparados33} colors={["#34d399","#f59e0b"]} />
          )}
        </ChartPanel>

      </div>

      {/* ── Stock Disponible por KVA ── */}
      <ChartPanel title="Stock Disponible por KVA" subtitle="Unidades libres (sin comprometer) — planilla actual">
        {stockPorKva.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin datos para la selección actual.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, stockPorKva.length * 36)}>
            <BarChart
              data={stockPorKva}
              layout="vertical"
              margin={{ top: 0, right: 48, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={110}
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "#1e293b" }}
                contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#94a3b8" }}
                itemStyle={{ color: "#f1f5f9" }}
                formatter={(v: number) => [v, "Disponibles"]}
              />
              <Bar dataKey="disponible" radius={[0, 4, 4, 0]} maxBarSize={26}>
                {stockPorKva.map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.disponible <= 0 ? "#ef4444" : d.disponible <= 3 ? "#f59e0b" : "#3b82f6"}
                  />
                ))}
                <LabelList
                  dataKey="disponible"
                  position="right"
                  style={{ fontSize: 11, fill: "#94a3b8" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartPanel>

      {/* ── Última planilla cargada ── */}
      {planillasActuales.length > 0 && planillasActuales.map(planilla => {
        const KVA_ROWS = POT_13;
        const REL33_ROWS = POT_33;
        const totTerceros = KVA_ROWS.reduce((s, k) => {
          const c = planilla.datos.terceros?.[String(k)];
          return s + (c ? c.t + c.m + c.ct : 0);
        }, 0);
        const totTaller = KVA_ROWS.reduce((s, k) => {
          const c = planilla.datos.taller?.[String(k)];
          return s + (c ? c.t + c.m + c.ct : 0);
        }, 0);
        const totAuto = KVA_ROWS.reduce((s, k) => s + (planilla.datos.autorizados?.[String(k)] ?? 0), 0);
        const totGeneral = s13(planilla) + s33(planilla);
        const totDisp = totGeneral - totAuto;
        return (
          <div key={planilla.id} className="overflow-hidden shadow-sm" style={PANEL_STYLE}>
            <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Última Planilla — {planilla.fecha.split("-").map((v,i)=>i===0?v.slice(2):v).reverse().join("/")}
                  {planilla.datos.deposito && <span className="text-slate-400 font-normal"> — {planilla.datos.deposito}</span>}
                </h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  <span className="font-semibold text-blue-400">{totGeneral}</span> total ·{" "}
                  <span className="font-semibold text-green-400">{totDisp}</span> disponibles ·{" "}
                  <span className="font-semibold text-cyan-400">{totTerceros}</span> terceros ·{" "}
                  <span className="font-semibold text-amber-400">{totTaller}</span> taller
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-x divide-slate-700">
              {/* Terceros */}
              <div className="overflow-x-auto">
                <div className="px-4 py-2 bg-blue-600/10 text-xs font-semibold text-blue-300 uppercase tracking-wide border-b border-slate-700">
                  Nuevos y Reparados por Terceros
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-slate-700/40 border-b border-slate-700">
                    <tr>
                      <th className="px-3 py-2 text-center text-slate-300">KVA</th>
                      <th className="px-3 py-2 text-center text-slate-300">T</th>
                      <th className="px-3 py-2 text-center text-slate-300">M</th>
                      <th className="px-3 py-2 text-center text-slate-300">C/T</th>
                      <th className="px-3 py-2 text-center text-slate-300">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {KVA_ROWS.map(k => {
                      const c = planilla.datos.terceros?.[String(k)] ?? { t: 0, m: 0, ct: 0 };
                      const tot = c.t + c.m + c.ct;
                      return (
                        <tr key={k} className="border-b border-slate-700/50 last:border-0">
                          <td className="px-3 py-1.5 text-center text-foreground font-medium">{k}</td>
                          <td className="px-3 py-1.5 text-center text-slate-300">{c.t || "—"}</td>
                          <td className="px-3 py-1.5 text-center text-slate-300">{c.m || "—"}</td>
                          <td className="px-3 py-1.5 text-center text-slate-300">{c.ct || "—"}</td>
                          <td className="px-3 py-1.5 text-center font-semibold text-foreground">{tot}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Taller */}
              <div className="overflow-x-auto">
                <div className="px-4 py-2 bg-amber-600/10 text-xs font-semibold text-amber-300 uppercase tracking-wide border-b border-slate-700">
                  Reparados por Taller
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-slate-700/40 border-b border-slate-700">
                    <tr>
                      <th className="px-3 py-2 text-center text-slate-300">KVA</th>
                      <th className="px-3 py-2 text-center text-slate-300">T</th>
                      <th className="px-3 py-2 text-center text-slate-300">M</th>
                      <th className="px-3 py-2 text-center text-slate-300">C/T</th>
                      <th className="px-3 py-2 text-center text-slate-300">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {KVA_ROWS.map(k => {
                      const c = planilla.datos.taller?.[String(k)] ?? { t: 0, m: 0, ct: 0 };
                      const tot = c.t + c.m + c.ct;
                      return (
                        <tr key={k} className="border-b border-slate-700/50 last:border-0">
                          <td className="px-3 py-1.5 text-center text-foreground font-medium">{k}</td>
                          <td className="px-3 py-1.5 text-center text-slate-300">{c.t || "—"}</td>
                          <td className="px-3 py-1.5 text-center text-slate-300">{c.m || "—"}</td>
                          <td className="px-3 py-1.5 text-center text-slate-300">{c.ct || "—"}</td>
                          <td className="px-3 py-1.5 text-center font-semibold text-foreground">{tot}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Totales + Relación 33 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-x divide-slate-700 border-t border-slate-700">
              {/* Totales 13.2 */}
              <div className="overflow-x-auto">
                <div className="px-4 py-2 bg-green-600/10 text-xs font-semibold text-green-300 uppercase tracking-wide border-b border-slate-700">
                  Total de Transformadores 13,2 kV
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-slate-700/40 border-b border-slate-700">
                    <tr>
                      <th className="px-3 py-2 text-center text-slate-300">KVA</th>
                      <th className="px-3 py-2 text-center text-slate-300">Total</th>
                      <th className="px-3 py-2 text-center text-slate-300">Autorizados</th>
                      <th className="px-3 py-2 text-center text-slate-300">Disponibles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {KVA_ROWS.map(k => {
                      const tot  = planilla.datos.totales?.[String(k)] ?? 0;
                      const auto = planilla.datos.autorizados?.[String(k)] ?? 0;
                      const disp = tot - auto;
                      return (
                        <tr key={k} className="border-b border-slate-700/50 last:border-0">
                          <td className="px-3 py-1.5 text-center text-foreground font-medium">{k}</td>
                          <td className="px-3 py-1.5 text-center text-foreground">{tot || "—"}</td>
                          <td className="px-3 py-1.5 text-center text-amber-400">{auto || "—"}</td>
                          <td className={`px-3 py-1.5 text-center font-semibold ${disp < 0 ? "text-red-400" : "text-green-400"}`}>{disp}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Relación 33 */}
              <div className="overflow-x-auto">
                <div className="px-4 py-2 bg-purple-600/10 text-xs font-semibold text-purple-300 uppercase tracking-wide border-b border-slate-700">
                  Relación 33 / 0,4 kV
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-slate-700/40 border-b border-slate-700">
                    <tr>
                      <th className="px-3 py-2 text-center text-slate-300">KVA</th>
                      <th className="px-3 py-2 text-center text-slate-300">T Nuevo</th>
                      <th className="px-3 py-2 text-center text-slate-300">M Nuevo</th>
                      <th className="px-3 py-2 text-center text-slate-300">T Rep.</th>
                      <th className="px-3 py-2 text-center text-slate-300">M Rep.</th>
                      <th className="px-3 py-2 text-center text-slate-300">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {REL33_ROWS.map(k => {
                      const r = planilla.datos.rel33?.[String(k)] ?? { tN: 0, mN: 0, tR: 0, mR: 0 };
                      const tot = r.tN + r.mN + r.tR + r.mR;
                      return (
                        <tr key={k} className="border-b border-slate-700/50 last:border-0">
                          <td className="px-3 py-1.5 text-center text-foreground font-medium">{k}</td>
                          <td className="px-3 py-1.5 text-center text-slate-300">{r.tN || "—"}</td>
                          <td className="px-3 py-1.5 text-center text-slate-300">{r.mN || "—"}</td>
                          <td className="px-3 py-1.5 text-center text-slate-300">{r.tR || "—"}</td>
                          <td className="px-3 py-1.5 text-center text-slate-300">{r.mR || "—"}</td>
                          <td className="px-3 py-1.5 text-center font-semibold text-foreground">{tot || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
