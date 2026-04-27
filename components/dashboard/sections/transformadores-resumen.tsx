"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList, ResponsiveContainer,
} from "recharts";
import {
  Zap, CheckCircle2, Wrench, XCircle, RefreshCw, Loader2, ChevronDown,
  Bell, BellRing, Plus, Trash2, X, Package, Activity, TrendingUp, TrendingDown, Clock,
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

function useEnter(dur = 600, delay = 0) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf: number;
    let to: ReturnType<typeof setTimeout>;
    to = setTimeout(() => {
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        setP(k);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => { clearTimeout(to); cancelAnimationFrame(raf); };
  }, []);
  return p;
}

function useInView(threshold = 0.15) {
  const ref  = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current || seen) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setSeen(true); io.disconnect(); }
    }, { threshold });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

// ── PromedioRow ───────────────────────────────────────────────────────────────

function PromedioRow({ label, sub, value, maxVal, hue, idx = 0 }: {
  label: string; sub: string; value: number; maxVal: number; hue: number; idx?: number;
}) {
  const chip       = `oklch(0.72 0.16 ${hue})`;
  const chipSoft   = `oklch(0.72 0.16 ${hue} / 0.16)`;
  const chipBorder = `oklch(0.72 0.16 ${hue} / 0.22)`;
  const animated   = useCountUp(value, 1100, 250 + idx * 120);
  const barP       = useEnter(1000, 300 + idx * 120);
  const pct        = Math.min(100, (value / (maxVal * 1.15 || 1)) * 100);

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "40px 1fr auto",
      gap: 14, alignItems: "center",
      padding: "12px 0",
      borderBottom: "1px solid rgba(255,255,255,0.07)",
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
        background: chipSoft, color: chip,
        display: "grid", placeItems: "center",
        border: `1px solid ${chipBorder}`,
      }}>
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
          <path d="M9 1.5 3.5 9h3.5L6 14.5 12.5 7H9V1.5Z"
            stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"
            fill="currentColor" fillOpacity=".12" />
        </svg>
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "rgba(255,255,255,0.50)" }}>
            {label}
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.30)" }}>· {sub}</span>
        </div>
        <div style={{ height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 999, overflow: "hidden" }}>
          <div style={{
            width: `${pct * easeOutCubic(barP)}%`, height: "100%",
            background: `linear-gradient(90deg, ${chip}, oklch(0.78 0.16 ${hue}))`,
            borderRadius: 999,
          }} />
        </div>
      </div>

      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.02em", color: "#f1f5f9", fontVariantNumeric: "tabular-nums" }}>
          {animated.toFixed(1)}
        </div>
      </div>
    </div>
  );
}

// ── KpiStatCard ───────────────────────────────────────────────────────────────

type KpiTone = "neutral" | "warn" | "pos" | "delta";

const KPI_TONE: Record<KpiTone, { color: string; soft: string }> = {
  neutral: { color: "oklch(0.72 0.16 265)",  soft: "oklch(0.72 0.16 265 / 0.14)"  },
  warn:    { color: "oklch(0.80 0.15 85)",   soft: "oklch(0.80 0.15 85  / 0.14)"  },
  pos:     { color: "oklch(0.74 0.16 152)",  soft: "oklch(0.74 0.16 152 / 0.14)"  },
  delta:   { color: "oklch(0.74 0.16 152)",  soft: "oklch(0.74 0.16 152 / 0.14)"  },
};

function KpiStatCard({ label, value, tone, sub, showSign = false, idx = 0 }: {
  label: string; value: number; tone: KpiTone; sub: string; showSign?: boolean; idx?: number;
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
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: "oklch(0.55 0.018 265)",
        }}>
          {label}
        </span>
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
  const animated = useCountUp(ratio, 1400, 300);
  const cx = 140, cy = 128, r = 95;
  const startA = -210, endA = 30, sweep = endA - startA;
  const MAX = 150;

  const polarG = (angDeg: number, radius = r) => {
    const a = (angDeg * Math.PI) / 180;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as [number, number];
  };
  const arcG = (from: number, to: number, radius = r) => {
    const [x1, y1] = polarG(from, radius);
    const [x2, y2] = polarG(to, radius);
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    return `M${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2}`;
  };

  const clampedRatio = Math.min(Math.max(animated, 0), MAX);
  const valAngle     = startA + (clampedRatio / MAX) * sweep;

  // Three zones: 0-60% of scale = red, 60-80% = warn, 80-100% = green (mapped to 0-150%)
  const seg1 = [startA, startA + sweep * (90  / MAX)];
  const seg2 = [seg1[1], startA + sweep * (100 / MAX)];
  const seg3 = [seg2[1], endA];

  const [nx, ny] = polarG(valAngle, r - 14);

  const status = ratio < 90
    ? { label: "CRÍTICO",  color: "oklch(0.68 0.19 25)" }
    : ratio <= 100
    ? { label: "ÓPTIMO",   color: "oklch(0.74 0.16 152)" }
    : { label: "EXCESO",   color: "oklch(0.80 0.15 85)" };

  return (
    <svg viewBox="0 0 280 188" width="100%" style={{ display: "block", maxHeight: 220 }}>
      {/* Track */}
      <path d={arcG(startA, endA)} fill="none"
        stroke="oklch(0.26 0.020 265)" strokeWidth="14" strokeLinecap="round" />
      {/* Zones */}
      <path d={arcG(seg1[0], seg1[1])} fill="none"
        stroke="oklch(0.68 0.19 25)"  strokeWidth="14" strokeLinecap="round" opacity=".85" />
      <path d={arcG(seg2[0], seg2[1])} fill="none"
        stroke="oklch(0.74 0.16 152)" strokeWidth="14" opacity=".85" />
      <path d={arcG(seg3[0], seg3[1])} fill="none"
        stroke="oklch(0.80 0.15 85)"  strokeWidth="14" strokeLinecap="round" opacity=".85" />
      {/* Tick marks */}
      {Array.from({ length: 9 }).map((_, i) => {
        const a  = startA + (i / 8) * sweep;
        const [x1, y1] = polarG(a, r - 22);
        const [x2, y2] = polarG(a, r - 28);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="oklch(0.45 0.020 265)" strokeWidth="1" />;
      })}
      {/* Needle */}
      <path d={`M${cx},${cy} L${nx},${ny}`}
        stroke="oklch(0.97 0.005 265)" strokeWidth="2.5" strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 4px oklch(1 0 0 / .25))" }} />
      {/* Center cap */}
      <circle cx={cx} cy={cy} r={7}  fill="oklch(0.16 0.012 265)"
        stroke="oklch(0.97 0.005 265)" strokeWidth="2" />
      {/* Value */}
      <text x={cx} y={cy + 36} textAnchor="middle"
        fill="oklch(0.97 0.005 265)" fontFamily="Inter, system-ui, sans-serif"
        fontWeight="600" fontSize="28" letterSpacing="-1"
        style={{ fontVariantNumeric: "tabular-nums" }}>
        {animated.toFixed(1)}%
      </text>
      {/* Status */}
      <text x={cx} y={cy + 52} textAnchor="middle"
        fill={status.color} fontFamily="Inter, system-ui, sans-serif"
        fontSize="10" fontWeight="600" letterSpacing=".1em">
        {status.label}
      </text>
      {/* Legend dots */}
      <g transform={`translate(${cx - 85}, ${cy + 68})`}>
        {[
          { color: "oklch(0.68 0.19 25)",  label: "0–90% crítico" },
          { color: "oklch(0.74 0.16 152)", label: "90–100% óptimo" },
          { color: "oklch(0.80 0.15 85)",  label: "100%+ exceso" },
        ].map((s, i) => (
          <g key={i} transform={`translate(${i * 57}, 0)`}>
            <rect x={0} y={-5} width={7} height={7} rx={2} fill={s.color} />
            <text x={10} y={2} fontSize={8} fill="oklch(0.45 0.020 265)"
              fontFamily="Inter, system-ui, sans-serif">{s.label}</text>
          </g>
        ))}
      </g>
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

  const kvas = filterPotencia
    ? [Number(filterPotencia)]
    : kvasFor(filterRelacion, filterFases);

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

  const stockBruto    = planillasActuales.reduce((s, p) => s + computeStockBruto(p, kvas, filterRelacion), 0);
  const pendientes    = planillasActuales.reduce((s, p) => s + computePendientes(p, kvas, filterRelacion), 0);
  const stockNeto     = stockBruto - pendientes;
  const prevStockNeto = planillasAnteriores.length > 0
    ? planillasAnteriores.reduce((s, p) => s + computeStockBruto(p, kvas, filterRelacion) - computePendientes(p, kvas, filterRelacion), 0)
    : null;
  const variacion     = prevStockNeto !== null ? stockNeto - prevStockNeto : 0;

  // Label for the planilla info footer
  const zonasFecha = [...new Set(planillasActuales.map(p => p.datos.deposito).filter((z): z is string => !!z))];
  const currentLabel = currentFecha
    ? `${(currentFecha as string).split("-").map((v: string, i: number) => i === 0 ? v.slice(2) : v).reverse().join("/")}${zonasFecha.length > 0 ? ` — ${zonasFecha.join(" + ")}` : ""}`
    : null;


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

        {/* 4 KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiStatCard
            label="Stock Bruto"
            value={stockBruto}
            tone="neutral"
            sub="Inventario total registrado"
            idx={0}
          />
          <KpiStatCard
            label="Pendientes de Retiro"
            value={pendientes}
            tone="warn"
            sub="En cola de retiro"
            idx={1}
          />
          <KpiStatCard
            label="Stock Neto"
            value={stockNeto}
            tone="pos"
            sub="Disponible neto"
            idx={2}
          />
          <KpiStatCard
            label="Variación Neta Mensual"
            value={variacion}
            tone="delta"
            sub="vs. planilla anterior"
            showSign
            idx={3}
          />
        </div>

        {currentLabel && (
          <p className="text-[11px] text-slate-500 text-right">
            Planilla: {currentLabel}
          </p>
        )}
      </div>

      {/* ── Promedios + Gauge ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Promedios por tensión */}
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-0">
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "oklch(0.60 0.018 265)" }}>
                Promedios por tensión
              </p>
              <p style={{ fontSize: 12, color: "oklch(0.45 0.020 265)", marginTop: 3 }}>
                Stock real · promedio histórico
              </p>
            </div>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 10px", borderRadius: 999,
              background: "oklch(0.72 0.16 265 / 0.16)",
              color: "oklch(0.72 0.16 265)",
              border: "1px solid transparent",
              fontSize: 11, fontWeight: 500,
            }}>
              Móvil 12m
            </span>
          </div>
          <div className="px-5 pb-5">
            <PromedioRow label="Stock Real Promedio"  sub="Todas las tensiones" value={avgAll} maxVal={avgAll} hue={265} idx={0} />
            <PromedioRow label="Promedio 13.2 / 0.4 kV" sub="Baja tensión"    value={avg13} maxVal={avgAll} hue={230} idx={1} />
            <PromedioRow label="Promedio 33 / 0.4 kV"   sub="Alta tensión"    value={avg33} maxVal={avgAll} hue={305} idx={2} />
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, fontSize: 11, color: "oklch(0.45 0.020 265)" }}>
              {latestPlanilla && (
                <span>
                  Planilla · {latestPlanilla.fecha.split("-").map((v,i)=>i===0?v.slice(2):v).reverse().join("/")}
                </span>
              )}
              {latestPlanilla?.datos.deposito && (
                <span>{latestPlanilla.datos.deposito}</span>
              )}
            </div>
          </div>
        </div>

        {/* Gauge card */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex flex-col">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "oklch(0.60 0.018 265)" }}>
                Salud del inventario
              </p>
              <p style={{ fontSize: 12, color: "oklch(0.45 0.020 265)", marginTop: 3 }}>
                Stock actual vs. promedio histórico
              </p>
            </div>
            {gaugeRatio < 90 && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 10px", borderRadius: 999,
                background: "oklch(0.68 0.19 25 / 0.18)",
                color: "oklch(0.68 0.19 25)",
                fontSize: 11, fontWeight: 500,
              }}>
                Bajo el umbral
              </span>
            )}
          </div>
          <div className="flex-1 flex items-center justify-center">
            <GaugeChart ratio={gaugeRatio} />
          </div>
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
