"use client";

import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList,
  ResponsiveContainer, PieChart, Pie, Legend, Sector,
} from "recharts";
import {
  CheckCircle2, Check, RefreshCw, Loader2, ChevronDown,
  Bell, BellRing, Plus, Trash2, X, Package, TrendingUp, TrendingDown, Clock,
  LayoutGrid, GripVertical, GripHorizontal,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DraggableAttributes, type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, rectSortingStrategy, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
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

function FilterSelect({ value, onChange, placeholder, options, fullWidth = false }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const reposition = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 6, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  const current = options.find(o => o.value === value);

  return (
    <div ref={wrapRef} className={`relative ${fullWidth ? "w-full" : ""}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2 pl-3.5 pr-3 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200 justify-between ${fullWidth ? "w-full" : "min-w-[110px]"} ${
          value
            ? "bg-accent/10 border-accent/40 text-accent hover:bg-accent/15"
            : "bg-card border-border text-foreground hover:bg-secondary hover:border-border/80"
        }`}
      >
        <span>{current?.label ?? placeholder}</span>
        <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && coords && createPortal(
        <div
          ref={menuRef}
          className="bg-card border border-border rounded-xl shadow-2xl py-1 overflow-y-auto"
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            minWidth: coords.width,
            maxHeight: "min(320px, 60vh)",
            zIndex: 1000,
          }}
        >
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
        </div>,
        document.body
      )}
    </div>
  );
}

// ── MultiSelect (multi-selección, mismo estilo, portal) ──────────────────────

function MultiSelect({ values, onChange, options, placeholder, noun }: {
  values: string[];
  onChange: (v: string[]) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  noun: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const reposition = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 6, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  const toggle = (v: string) =>
    onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v]);

  const active = values.length > 0;
  const label = values.length === 0 ? placeholder
    : values.length === 1 ? (options.find(o => o.value === values[0])?.label ?? `1 ${noun}`)
    : `${values.length} ${noun}`;

  return (
    <div ref={wrapRef} className="relative w-full">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2 pl-3.5 pr-3 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200 justify-between w-full ${
          active
            ? "bg-accent/10 border-accent/40 text-accent hover:bg-accent/15"
            : "bg-card border-border text-foreground hover:bg-secondary hover:border-border/80"
        }`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform duration-200 shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && coords && createPortal(
        <div
          ref={menuRef}
          className="bg-card border border-border rounded-xl shadow-2xl py-1 overflow-y-auto"
          style={{ position: "fixed", top: coords.top, left: coords.left, minWidth: coords.width, maxHeight: "min(320px, 60vh)", zIndex: 1000 }}
        >
          {options.map(o => {
            const sel = values.includes(o.value);
            return (
              <button
                key={o.value}
                onClick={() => toggle(o.value)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${sel ? "text-accent font-semibold bg-accent/8" : "text-foreground hover:bg-secondary"}`}
              >
                <span
                  className="grid place-items-center rounded shrink-0"
                  style={{
                    width: 15, height: 15,
                    border: `1.5px solid ${sel ? "hsl(var(--accent))" : "oklch(1 0 0 / 0.2)"}`,
                    background: sel ? "hsl(var(--accent))" : "transparent",
                  }}
                >
                  {sel && <Check className="w-3 h-3 text-accent-foreground" strokeWidth={3} />}
                </span>
                {o.label}
              </button>
            );
          })}
          {active && (
            <>
              <div className="h-px bg-border/50 mx-2 my-0.5" />
              <button
                onClick={() => onChange([])}
                className="w-full text-left px-3.5 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                Limpiar meses
              </button>
            </>
          )}
        </div>,
        document.body
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

// ── Chart block definitions (drag & drop order) ───────────────────────────────

const BLOCK_ORDER_KEY = "transformadores_block_order";

const DEFAULT_BLOCK_ORDER = ["filtros", "stockReserva", "variacion", "evolucion", "distribucion", "stockKva", "ultimaPlanilla"];

function SortableBlock({ id, children }: { id: string; children: React.ReactNode }) {
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
      <div className="flex justify-center mb-1.5">
        <span
          {...attributes}
          {...listeners}
          className="touch-none flex items-center justify-center w-10 h-4 rounded-full"
          style={{ cursor: "grab", color: "oklch(0.45 0.018 265)", background: "var(--panel)", border: "1px solid var(--hairline)" }}
        >
          <GripHorizontal size={12} />
        </span>
      </div>
      {children}
    </div>
  );
}

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
  background: "var(--panel-2)",
  border: "1px solid var(--hairline)",
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

  // Chart block drag & drop order
  const [blockOrder, setBlockOrder] = useOrder(BLOCK_ORDER_KEY, DEFAULT_BLOCK_ORDER);
  const blockSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const handleBlockDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBlockOrder(prev => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, [setBlockOrder]);

  // Filters
  const [filterAnos,     setFilterAnos]     = useState<string[]>([]);
  const [filterMeses,    setFilterMeses]    = useState<string[]>([]);
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

  // ── Shared snapshot por período (último por zona, zonas sumadas) ──────────
  // Granularidad mensual por defecto; semanal cuando hay meses seleccionados.
  // Respeta los filtros: zona, año, mes(es), potencia, relación y fases.
  const MES_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  // KVAs seleccionados por relación según los filtros (potencia / relación / fases)
  const potNum = filterPotencia ? Number(filterPotencia) : null;
  const kvas13Sel = filterRelacion === "33" ? []
    : potNum != null ? (POT_13.includes(potNum) ? [potNum] : [])
    : kvasFor("13", filterFases);
  const kvas33Sel = filterRelacion === "13" ? []
    : potNum != null ? (POT_33.includes(potNum) ? [potNum] : [])
    : POT_33;

  // Granularidad: semanal si hay al menos un mes seleccionado
  const weekly = filterMeses.length > 0;

  // ── Ventana temporal (rango continuo) ────────────────────────────────────
  // Años: multi-selección interpretada como rango [min..max].
  // Meses: multi-selección interpretada como rango [min..max] dentro de UN solo
  // año (el mayor seleccionado, o el último con datos si Año = Todos). Esto
  // evita comparar el mismo mes entre años distintos.
  const selYears = filterAnos.map(Number);
  const selMeses = filterMeses.map(Number);
  const minM = selMeses.length ? Math.min(...selMeses) : null;
  const maxM = selMeses.length ? Math.max(...selMeses) : null;
  const minY = selYears.length ? Math.min(...selYears) : null;
  const maxY = selYears.length ? Math.max(...selYears) : null;

  // Año objetivo cuando hay meses seleccionados (un único año)
  const targetYear = (() => {
    if (!selMeses.length) return null;
    if (selYears.length) return maxY;
    // último año con datos dentro del rango de meses
    let best: number | null = null;
    for (const p of planillas) {
      const [yy, mm] = p.fecha.split("-").map(Number);
      if (mm >= (minM as number) && mm <= (maxM as number)) best = best === null ? yy : Math.max(best, yy);
    }
    return best;
  })();

  const inWindow = (fecha: string): boolean => {
    const [yy, mm] = fecha.split("-").map(Number);
    if (selMeses.length) {
      if (targetYear === null) return false;
      return yy === targetYear && mm >= (minM as number) && mm <= (maxM as number);
    }
    if (selYears.length) {
      return yy >= (minY as number) && yy <= (maxY as number);
    }
    return true;
  };

  // Bucket (clave de orden + etiqueta) para una fecha según la granularidad
  // Clave de bucket (para agrupar/ordenar) según la granularidad
  const bucketKey = (fecha: string): string => {
    if (!weekly) return fecha.slice(0, 7); // YYYY-MM
    const d = new Date(`${fecha}T00:00:00`);
    // Semana ISO (el jueves define el año)
    const t = new Date(d);
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
    const week1  = new Date(t.getFullYear(), 0, 4);
    const weekNo = 1 + Math.round(((t.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    return `${t.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  };

  // Etiquetas (año a 2 dígitos). Semanal usa la fecha real del informe.
  const fmtDay   = (fecha: string) => { const [y, m, d] = fecha.split("-"); return `${d}/${m}/${y.slice(2)}`; };
  const fmtMonth = (ym: string)    => { const [y, m] = ym.split("-"); return `${MES_SHORT[Number(m) - 1]} ${y.slice(2)}`; };

  const periodSnapshots = (() => {
    const source = planillas.filter(p => {
      if (filterZona && (p.datos.deposito ?? "") !== filterZona) return false;
      if (!inWindow(p.fecha)) return false;
      return true;
    });
    // Último planilla por zona y bucket
    const byZoneBucket: Record<string, PlanillaReserva> = {};
    for (const p of source) {
      const zk = `${p.datos.deposito ?? ""}::${bucketKey(p.fecha)}`;
      if (!byZoneBucket[zk] || p.fecha > byZoneBucket[zk].fecha) byZoneBucket[zk] = p;
    }
    const byBucket: Record<string, { maxFecha: string; bruto: number; auto: number; neto: number; neto13: number; neto33: number; zonas: Set<string> }> = {};
    for (const p of Object.values(byZoneBucket)) {
      const key = bucketKey(p.fecha);
      const bruto13 = computeStockBruto(p, kvas13Sel, "13");
      const bruto33 = computeStockBruto(p, kvas33Sel, "33", filterFases);
      const auto    = computePendientes(p, kvas13Sel, "13");
      if (!byBucket[key]) byBucket[key] = { maxFecha: p.fecha, bruto: 0, auto: 0, neto: 0, neto13: 0, neto33: 0, zonas: new Set() };
      const b = byBucket[key];
      if (p.fecha > b.maxFecha) b.maxFecha = p.fecha;
      b.bruto  += bruto13 + bruto33;
      b.auto   += auto;
      b.neto   += bruto13 + bruto33 - auto;
      b.neto13 += bruto13 - auto;
      b.neto33 += bruto33;
      if (p.datos.deposito) b.zonas.add(p.datos.deposito);
    }
    return byBucket;
  })();

  const sortedBuckets = Object.keys(periodSnapshots).sort();

  // ── Variación neta por período (mensual o semanal) ───────────────────────

  const variacionData = sortedBuckets.map((key, i) => {
    const snap = periodSnapshots[key];
    const prev = i > 0 ? periodSnapshots[sortedBuckets[i - 1]].neto : snap.neto;
    return {
      mes:       weekly ? fmtDay(snap.maxFecha) : fmtMonth(key),
      bruto:     snap.bruto,
      auto:      snap.auto,
      neto:      snap.neto,
      neto13:    snap.neto13,
      neto33:    snap.neto33,
      zonas:     [...snap.zonas].join(", "),
      variacion: snap.neto - prev,
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
    if (!inWindow(p.fecha)) return false;
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

  // ── Reorderable chart blocks ──────────────────────────────────────────────
  const blockContent: Record<string, React.ReactNode> = {
    filtros: (
      <div
        className="px-4 py-6 sm:px-6 overflow-hidden"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--hairline)",
          borderRadius: 14,
        }}
      >
        <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className="grid place-items-center"
              style={{
                width: 30, height: 30, borderRadius: 8,
                background: "color-mix(in oklab, var(--accent-emerald-deep) 45%, transparent)",
                border: "1px solid color-mix(in oklab, var(--accent-emerald) 50%, transparent)",
                color: "#86efac",
              }}
            >
              <Package className="w-4 h-4" strokeWidth={2} />
            </div>
            <h2 className="text-[20px] font-semibold tracking-tight text-foreground" style={{ letterSpacing: -0.3, margin: 0 }}>
              Filtros
            </h2>
          </div>

          {/* Alarm button */}
          <div ref={alarmsRef} className="relative">
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
        <p className="ml-[42px] mb-7 text-[14.5px]" style={{ color: "oklch(0.58 0 0)" }}>
          Filtrá por año, mes, potencia, relación, fases o zona para ver los indicadores actuales.
        </p>

        <div className="space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <MultiSelect
            placeholder="Año"
            noun="años"
            values={filterAnos}
            onChange={setFilterAnos}
            options={availableYears.map(y => ({ value: y, label: y }))}
          />
          <MultiSelect
            placeholder="Mes"
            noun="meses"
            values={filterMeses}
            onChange={setFilterMeses}
            options={MONTHS.map(m => ({ value: m.value, label: m.label }))}
          />
          <FilterSelect
            fullWidth
            value={filterPotencia}
            onChange={setFilterPotencia}
            placeholder="Potencia"
            options={(filterRelacion === "33" ? POT_33 : POT_13).map(k => ({ value: String(k), label: `${k} kVA` }))}
          />
          <FilterSelect
            fullWidth
            value={filterRelacion}
            onChange={v => { setFilterRelacion(v); setFilterPotencia(""); }}
            placeholder="Relación"
            options={[{ value: "13", label: "13,2/0,4 kV" }, { value: "33", label: "33/0,4 kV" }]}
          />
          <FilterSelect
            fullWidth
            value={filterFases}
            onChange={setFilterFases}
            placeholder="Fases"
            options={[{ value: "mono", label: "Monofásico" }, { value: "tri", label: "Trifásico" }]}
          />
          <FilterSelect
            fullWidth
            value={filterZona}
            onChange={setFilterZona}
            placeholder="Zona"
            options={availableZonas.map(z => ({ value: z, label: z }))}
          />
          </div>

          {(filterAnos.length || filterMeses.length || filterPotencia || filterRelacion || filterFases || filterZona) && (
            <button
              onClick={() => { setFilterAnos([]); setFilterMeses([]); setFilterPotencia(""); setFilterRelacion(""); setFilterFases(""); setFilterZona(""); }}
              className="px-3.5 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-colors"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>
    ),
    stockReserva: (
      <div
        className="px-4 py-6 sm:px-6 overflow-hidden"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--hairline)",
          borderRadius: 14,
        }}
      >
        <div className="flex items-center gap-3 mb-2">
          <div
            className="grid place-items-center"
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: "color-mix(in oklab, var(--accent-emerald-deep) 45%, transparent)",
              border: "1px solid color-mix(in oklab, var(--accent-emerald) 50%, transparent)",
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
          Indicadores actuales de stock de transformadores en reserva.
        </p>

        <div className="space-y-4">

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
          <p className="text-[11px] text-muted-foreground text-right">
            Planilla: {currentLabel}
          </p>
        )}
        </div>
      </div>
    ),
    variacion: (
      <div className="space-y-6">
        <ChartPanel title="Gráfico de Variación Neta" subtitle={`Stock neto en comparación con ${weekly ? "la semana anterior" : "el mes anterior"}`}>
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

        {variacionData.length > 0 && (
          <details className="shadow-sm" style={PANEL_STYLE}>
            <summary className="px-5 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
              Ver detalle del cálculo
            </summary>
            <div className="overflow-x-auto px-5 pb-4">
              <table className="w-full text-xs mt-2">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="pb-2 text-left font-medium">{weekly ? "Semana" : "Mes"}</th>
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
      </div>
    ),

    evolucion: (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartPanel title="Evolución — 13,2 / 0,4 kV" subtitle={`Stock neto al cierre de cada ${weekly ? "semana" : "mes"} (según filtros)`}>
          {variacionData.length < 2 ? (
            <p className="text-sm text-muted-foreground">Se necesitan al menos 2 {weekly ? "semanas" : "meses"} con datos.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={variacionData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#94a3b8" }}
                  itemStyle={{ color: "#f1f5f9" }}
                />
                <Line type="monotone" dataKey="neto13" name="13,2 / 0,4 kV" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        <ChartPanel title="Evolución — 33 / 0,4 kV" subtitle={`Stock neto al cierre de cada ${weekly ? "semana" : "mes"} (según filtros)`}>
          {variacionData.length < 2 ? (
            <p className="text-sm text-muted-foreground">Se necesitan al menos 2 {weekly ? "semanas" : "meses"} con datos.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={variacionData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#94a3b8" }}
                  itemStyle={{ color: "#f1f5f9" }}
                />
                <Line type="monotone" dataKey="neto33" name="33 / 0,4 kV" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>
      </div>
    ),

    distribucion: (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

        <ChartPanel title="Nuevos vs Reparados — 13,2 kV" subtitle="Nuevos / terceros vs reparados por taller">
          {tercerosVsTaller13.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos.</p>
          ) : (
            <HoverPie data={tercerosVsTaller13} colors={["#38bdf8","#f59e0b"]} />
          )}
        </ChartPanel>

        <ChartPanel title="Nuevos vs Reparados — 33 kV" subtitle="Composición del stock 33 / 0,4 kV">
          {nuevosVsReparados33.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos.</p>
          ) : (
            <HoverPie data={nuevosVsReparados33} colors={["#34d399","#f59e0b"]} />
          )}
        </ChartPanel>
      </div>
    ),

    stockKva: (
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
    ),

    ultimaPlanilla: planillasActuales.length === 0 ? null : (
      <div className="space-y-6">
        {planillasActuales.map(planilla => {
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
              <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-foreground">
                    Última Planilla — {planilla.fecha.split("-").map((v,i)=>i===0?v.slice(2):v).reverse().join("/")}
                    {planilla.datos.deposito && <span className="text-muted-foreground font-normal"> — {planilla.datos.deposito}</span>}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    <span className="font-semibold text-accent-green">{totGeneral}</span> total ·{" "}
                    <span className="font-semibold text-green-400">{totDisp}</span> disponibles ·{" "}
                    <span className="font-semibold text-cyan-400">{totTerceros}</span> terceros ·{" "}
                    <span className="font-semibold text-amber-400">{totTaller}</span> taller
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-x divide-border">
                {/* Terceros */}
                <div className="overflow-x-auto">
                  <div className="px-4 py-2 bg-accent/10 text-xs font-semibold text-accent-green uppercase tracking-wide border-b border-border">
                    Nuevos y Reparados por Terceros
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/40 border-b border-border">
                      <tr>
                        <th className="px-3 py-2 text-center text-muted-foreground">KVA</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">T</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">M</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">C/T</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {KVA_ROWS.map(k => {
                        const c = planilla.datos.terceros?.[String(k)] ?? { t: 0, m: 0, ct: 0 };
                        const tot = c.t + c.m + c.ct;
                        return (
                          <tr key={k} className="border-b border-border/50 last:border-0">
                            <td className="px-3 py-1.5 text-center text-foreground font-medium">{k}</td>
                            <td className="px-3 py-1.5 text-center text-muted-foreground">{c.t || "—"}</td>
                            <td className="px-3 py-1.5 text-center text-muted-foreground">{c.m || "—"}</td>
                            <td className="px-3 py-1.5 text-center text-muted-foreground">{c.ct || "—"}</td>
                            <td className="px-3 py-1.5 text-center font-semibold text-foreground">{tot}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Taller */}
                <div className="overflow-x-auto">
                  <div className="px-4 py-2 bg-amber-600/10 text-xs font-semibold text-amber-300 uppercase tracking-wide border-b border-border">
                    Reparados por Taller
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/40 border-b border-border">
                      <tr>
                        <th className="px-3 py-2 text-center text-muted-foreground">KVA</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">T</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">M</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">C/T</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {KVA_ROWS.map(k => {
                        const c = planilla.datos.taller?.[String(k)] ?? { t: 0, m: 0, ct: 0 };
                        const tot = c.t + c.m + c.ct;
                        return (
                          <tr key={k} className="border-b border-border/50 last:border-0">
                            <td className="px-3 py-1.5 text-center text-foreground font-medium">{k}</td>
                            <td className="px-3 py-1.5 text-center text-muted-foreground">{c.t || "—"}</td>
                            <td className="px-3 py-1.5 text-center text-muted-foreground">{c.m || "—"}</td>
                            <td className="px-3 py-1.5 text-center text-muted-foreground">{c.ct || "—"}</td>
                            <td className="px-3 py-1.5 text-center font-semibold text-foreground">{tot}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Totales + Relación 33 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-x divide-border border-t border-border">
                {/* Totales 13.2 */}
                <div className="overflow-x-auto">
                  <div className="px-4 py-2 bg-green-600/10 text-xs font-semibold text-green-300 uppercase tracking-wide border-b border-border">
                    Total de Transformadores 13,2 kV
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/40 border-b border-border">
                      <tr>
                        <th className="px-3 py-2 text-center text-muted-foreground">KVA</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">Total</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">Autorizados</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">Disponibles</th>
                      </tr>
                    </thead>
                    <tbody>
                      {KVA_ROWS.map(k => {
                        const tot  = planilla.datos.totales?.[String(k)] ?? 0;
                        const auto = planilla.datos.autorizados?.[String(k)] ?? 0;
                        const disp = tot - auto;
                        return (
                          <tr key={k} className="border-b border-border/50 last:border-0">
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
                  <div className="px-4 py-2 bg-purple-600/10 text-xs font-semibold text-purple-300 uppercase tracking-wide border-b border-border">
                    Relación 33 / 0,4 kV
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/40 border-b border-border">
                      <tr>
                        <th className="px-3 py-2 text-center text-muted-foreground">KVA</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">T Nuevo</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">M Nuevo</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">T Rep.</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">M Rep.</th>
                        <th className="px-3 py-2 text-center text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {REL33_ROWS.map(k => {
                        const r = planilla.datos.rel33?.[String(k)] ?? { tN: 0, mN: 0, tR: 0, mR: 0 };
                        const tot = r.tN + r.mN + r.tR + r.mR;
                        return (
                          <tr key={k} className="border-b border-border/50 last:border-0">
                            <td className="px-3 py-1.5 text-center text-foreground font-medium">{k}</td>
                            <td className="px-3 py-1.5 text-center text-muted-foreground">{r.tN || "—"}</td>
                            <td className="px-3 py-1.5 text-center text-muted-foreground">{r.mN || "—"}</td>
                            <td className="px-3 py-1.5 text-center text-muted-foreground">{r.tR || "—"}</td>
                            <td className="px-3 py-1.5 text-center text-muted-foreground">{r.mR || "—"}</td>
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
    ),
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div
            className="grid place-items-center mt-0.5"
            style={{
              width: 36, height: 36, borderRadius: 9,
              background: "color-mix(in oklab, var(--accent-emerald-deep) 45%, transparent)",
              border: "1px solid color-mix(in oklab, var(--accent-emerald) 50%, transparent)",
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

      {/* ── Bloques reordenables (filtros, KPIs y gráficos) ── */}
      <DndContext sensors={blockSensors} collisionDetection={closestCenter} onDragEnd={handleBlockDragEnd}>
        <SortableContext items={blockOrder} strategy={verticalListSortingStrategy}>
          <div className="space-y-6">
            {blockOrder.map(id => {
              const content = blockContent[id];
              if (!content) return null;
              return (
                <SortableBlock key={id} id={id}>
                  {content}
                </SortableBlock>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
