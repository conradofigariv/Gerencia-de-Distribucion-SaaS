"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Loader2, X, PackageOpen, RefreshCw,
  ChevronDown, ChevronUp,
  Download, Wrench, Package, Check, HelpCircle,
  ChevronLeft, ChevronRight, ArrowRight, Lightbulb, ListChecks, Pin, Filter, FileSpreadsheet, Search,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { markUpdated } from "@/lib/notificaciones";
import { loadTableLayout, saveTableLayout } from "@/lib/tableLayout";
import { parseTSV, saveUpload, getUploads, removeUpload, COL_MAP } from "@/lib/stockStorage";
import type { ZonaUpload, CompraRow } from "@/lib/stockStorage";
import { getMatriculasInfo } from "@/lib/stockFamilies";
import type { FamilyRow, ArticuloTipo, MatriculaInfo } from "@/lib/stockFamilies";
import { getFamilyRowsCompat } from "@/lib/familias";
import { toast } from "sonner";

type Tab            = "resumen" | "cargar";
type SortDir        = "asc" | "desc";
type Density         = "compacta" | "normal" | "comoda";

// Caché de sesión del catálogo maestro (para que la 2da carga sea instantánea)
const MATRICULAS_CACHE_KEY = "stock-zona-matriculas-cache";
// Zonas elegidas + matrículas fijadas + "solo zonas con stock" (persistido) —
// estado de vista, no de layout de tabla: queda fuera de lib/tableLayout.ts.
const RESUMEN_STATE_KEY = "stock-zona-resumen-state";

// ─── Persistencia de layout de tabla (design-system.md §4.20) ─────────────────
const TABLE_ID = "stockZonaResumen";
const KNOWN_COL_IDS = new Set(["articulo", "descArticulo", "udmPrimaria", "tipo", "total", "zone"]);

// ─── Altura de fila / densidad (design-system.md §4.19) ───────────────────────
const DENSITY_ROW_H: Record<Density, number> = { compacta: 32, normal: 40, comoda: 52 };
const DENSITY_LABEL: Record<Density, string> = { compacta: "Compacta", normal: "Normal", comoda: "Cómoda" };
const DENSITY_ORDER: Density[] = ["compacta", "normal", "comoda"];
const isDensity = (v: unknown): v is Density => v === "compacta" || v === "normal" || v === "comoda";
const HEADER_H = 38;

// ─── Ajuste de ancho al viewport (design-system.md §4.17) — pisos reales por
// tipo de dato (§4.18): descArticulo es la única columna de texto largo, así
// que es la única absorbente; el resto son referencias cortas / numéricas que
// quedan en su piso. `zone` es un ancho compartido por todas las columnas de
// zona (no forma parte del reparto de sobrante, igual que antes).
const SEL_W = 36;
const NATURAL_W: Record<string, number> = {
  articulo: 130, descArticulo: 220, udmPrimaria: 70, tipo: 120, total: 90, zone: 88,
};
const ABSORBER_KEYS = new Set(["descArticulo"]);

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "resumen",  label: "Resumen de stock", icon: PackageOpen },
  { id: "cargar",   label: "Cargar datos",     icon: Download },
];

interface PivotRow {
  articulo:     string;
  descArticulo: string;
  udmPrimaria:  string;
  total:        number;
  byZona:       Record<string, number>;
}

// ─── Zone identity (paleta categórica del sistema de diseño — nunca el verde,
// reservado para valor calculado / activo / foco / botón primario) ────────────

const ZONE_CATEGORY_COLORS = ["#5B8DEF", "#B07BEB", "#4FC3D9", "#E8A33D", "#E8788F"];

function zoneCategoryColor(zona: string): string {
  let h = 0;
  for (const c of zona) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return ZONE_CATEGORY_COLORS[h % ZONE_CATEGORY_COLORS.length];
}

function ZonePill({ zona, small }: { zona: string; small?: boolean }) {
  const color = zoneCategoryColor(zona);
  return (
    <span
      className="ido-chip"
      style={{
        padding: small ? "2px 7px" : undefined,
        fontSize: small ? 11 : undefined,
        background: `${color}20`,
        color,
        border: `1px solid ${color}55`,
      }}
    >
      <span className="ido-chip-dot" style={{ background: color }} />
      {zona}
    </span>
  );
}

// Color de "fijado" — deliberadamente NO el verde de acento (design-system.md
// §1 "Regla del acento": el verde queda limitado a valor calculado / activo /
// foco / botón primario; "fijado" es una cuarta cosa distinta, así que toma
// uno de los colores categóricos en vez de competir por el mismo verde que ya
// usa la selección de fila).
const PIN_COLOR = "#5B8DEF";

// ─── Tipo (Servicio / Material) ────────────────────────────────────────────────

const TIPO_OPTIONS: { value: Exclude<ArticuloTipo, "">; label: string }[] = [
  { value: "material", label: "Material" },
  { value: "servicio", label: "Servicio" },
];

function tipoMeta(tipo: ArticuloTipo) {
  if (tipo === "servicio") return { label: "Servicio", color: "var(--ido-text)", bg: "rgba(255,255,255,.06)", border: "rgba(255,255,255,.14)", Icon: Wrench };
  if (tipo === "material") return { label: "Material", color: "var(--ido-accent)", bg: "rgba(63,207,142,.12)", border: "rgba(63,207,142,.35)", Icon: Package };
  return null;
}

function TipoPill({ tipo }: { tipo: ArticuloTipo }) {
  const m = tipoMeta(tipo);
  if (!m) return null;
  const Icon = m.Icon;
  return (
    <span className="ido-chip" style={{ background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>
      <Icon className="w-3 h-3" strokeWidth={2.2} />
      {m.label}
    </span>
  );
}

// ─── Encabezado ordenable (design-system.md §4.11) — una sola flecha que rota
// 180° según la dirección y se pone verde en la columna activa; no un ícono
// distinto por estado (eso no es lo que documenta el sistema de diseño).
function SortArrow({ active, dir, className }: { active: boolean; dir: SortDir; className?: string }) {
  return (
    <ChevronUp
      className={className}
      style={{
        transition: "transform 160ms var(--ido-ease), color 120ms var(--ido-ease), opacity 120ms var(--ido-ease)",
        transform: dir === "desc" ? "rotate(180deg)" : "none",
        color: active ? "var(--ido-accent)" : "var(--ido-text-dim)",
        opacity: active ? 1 : 0.4,
      }}
    />
  );
}

// ─── Checkbox (design-system.md §4.16) ─────────────────────────────────────────

function IdoCheckbox({
  checked, indeterminate, onClick, label,
}: { checked: boolean; indeterminate?: boolean; onClick: () => void; label: string }) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={label}
      style={{
        width: 16, height: 16, borderRadius: 4, display: "grid", placeItems: "center", flexShrink: 0,
        border: `1px solid ${on ? "var(--ido-accent)" : "rgba(255,255,255,.16)"}`,
        background: on ? "var(--ido-accent)" : "transparent",
        transition: "all 100ms var(--ido-ease)", cursor: "pointer",
      }}
    >
      {checked && !indeterminate && (
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--ido-accent-ink)" strokeWidth="2.5"><path d="M3 8l3.5 3.5L13 4.5" /></svg>
      )}
      {indeterminate && <span style={{ width: 8, height: 2, background: "var(--ido-accent-ink)", borderRadius: 1 }} />}
    </button>
  );
}

// ─── Tabs (design-system.md §4.7) ──────────────────────────────────────────────

function IdoTabsBar({ tabs, value, onChange, end }: {
  tabs: { id: Tab; label: React.ReactNode }[];
  value: Tab;
  onChange: (id: Tab) => void;
  end?: React.ReactNode;
}) {
  return (
    <div className="ido-toolbar" style={{ justifyContent: "space-between" }}>
      <div className="ido-tabs">
        {tabs.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              className={`ido-tab${active ? " is-active" : ""}`}
            >
              {active && (
                <motion.span
                  layoutId="stock-zona-tab-bubble"
                  className="ido-tab-bubble"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.35 }}
                />
              )}
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2.5">{end}</div>
    </div>
  );
}

// ─── Select / MultiSelect (design-system.md §4.2 + §4.5 — mismo menú que el
// contextual, reutilizando .ido-menu) ───────────────────────────────────────────

interface IdoOption { value: string; label: string; node?: React.ReactNode }

function useMenuCoords(open: boolean, triggerRef: React.RefObject<HTMLElement | null>, minWidth: number) {
  const [coords, setCoords] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.max(minWidth, r.width);
      const left = Math.min(r.left, window.innerWidth - w - 8);
      setCoords({ top: r.bottom + 6, left: Math.max(8, left), minWidth: w });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [open, triggerRef, minWidth]);
  return coords;
}

function IdoSelect({
  options, value, onChange, placeholder, clearable = false, minWidth = 170,
}: {
  options: IdoOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  clearable?: boolean;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const coords = useMenuCoords(open, ref, minWidth);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div style={{ flexShrink: 0 }}>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ido-field"
        style={{ minWidth, width: "auto", height: 38, display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font-sans, system-ui, sans-serif)" }}
      >
        <span className="truncate flex-1 text-left" style={{ color: selected ? "var(--ido-text)" : "var(--ido-text-faint)" }}>
          {selected ? (selected.node ?? selected.label) : placeholder}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "var(--ido-text-dim)" }} />
      </button>

      {open && coords && createPortal(
        <div ref={menuRef} className="ido-menu" style={{ top: coords.top, left: coords.left, minWidth: coords.minWidth, maxHeight: 320, overflowY: "auto" }}>
          {clearable && (
            <div className="ido-menu-item" style={{ cursor: "pointer", justifyContent: "space-between" }} onClick={() => { onChange(""); setOpen(false); }}>
              {placeholder}
              {value === "" && <Check className="w-3.5 h-3.5" style={{ color: "var(--ido-accent)" }} />}
            </div>
          )}
          {options.map((o) => (
            <div
              key={o.value}
              className="ido-menu-item"
              style={{ cursor: "pointer", justifyContent: "space-between" }}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.node ?? o.label}
              {o.value === value && <Check className="w-3.5 h-3.5" style={{ color: "var(--ido-accent)" }} />}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function IdoMultiSelect({
  options, values, onToggle, onClear, placeholder, minWidth = 200,
}: {
  options: IdoOption[];
  values: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
  placeholder: string;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const coords = useMenuCoords(open, ref, minWidth);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const selectedSet = new Set(values);
  const count = values.length;

  return (
    <div style={{ flexShrink: 0 }}>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ido-field"
        style={{ minWidth, width: "auto", height: 38, display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font-sans, system-ui, sans-serif)" }}
      >
        <span className="truncate flex-1 text-left inline-flex items-center gap-1.5" style={{ color: count === 0 ? "var(--ido-text-faint)" : "var(--ido-text)" }}>
          {count === 0
            ? placeholder
            : count <= 2
              ? values.slice().sort((a, b) => a.localeCompare(b, "es", { numeric: true })).map((z) => <ZonePill key={z} zona={z} small />)
              : <>{count} zonas</>}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "var(--ido-text-dim)" }} />
      </button>

      {open && coords && createPortal(
        <div ref={menuRef} className="ido-menu" style={{ top: coords.top, left: coords.left, minWidth: coords.minWidth, maxHeight: 340, overflowY: "auto" }}>
          <div className="ido-menu-item" style={{ cursor: "pointer", justifyContent: "space-between" }} onClick={onClear}>
            Todas las zonas
            {count === 0 && <Check className="w-3.5 h-3.5" style={{ color: "var(--ido-accent)" }} />}
          </div>
          <div className="ido-menu-sep" />
          {options.map((o) => {
            const active = selectedSet.has(o.value);
            return (
              <div key={o.value} className="ido-menu-item" style={{ cursor: "pointer" }} onClick={() => onToggle(o.value)}>
                <IdoCheckbox checked={active} onClick={() => onToggle(o.value)} label={o.label} />
                <span style={{ marginLeft: 10 }}>{o.node ?? o.label}</span>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── ZonasCargadasMenu (última carga + desplegable con detalle por zona) ───────

function ZonasCargadasMenu({
  uploads, lastUpload, deletingZona, onDelete,
}: {
  uploads: ZonaUpload[];
  lastUpload: ZonaUpload | null;
  deletingZona: string | null;
  onDelete: (zona: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const coords = useMenuCoords(open, ref, 260);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  if (!lastUpload) return null;

  const sorted = [...uploads].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  return (
    <div style={{ flexShrink: 0 }}>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ido-hint inline-flex items-center gap-1.5"
        style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, marginTop: 0 }}
      >
        Última carga: <ZonePill zona={lastUpload.zona} small />
        <span style={{ color: "var(--ido-text)" }}>{new Date(lastUpload.uploadedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && coords && createPortal(
        <div ref={menuRef} className="ido-menu" style={{ top: coords.top, left: coords.left, minWidth: coords.minWidth, maxHeight: 340, overflowY: "auto", padding: 8 }}>
          <p style={{ fontSize: 10, fontWeight: 500, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ido-text-dim)", padding: "0 6px 8px" }}>Zonas cargadas</p>
          <div className="flex flex-col gap-1">
            {sorted.map((u) => (
              <div key={u.zona} className="flex items-center gap-2" style={{ padding: "6px" }}>
                <ZonePill zona={u.zona} small />
                <span className="flex-1 whitespace-nowrap" style={{ fontSize: 11.5, color: "var(--ido-text-dim)" }}>{u.rows.length} reg.</span>
                <span className="whitespace-nowrap" style={{ fontSize: 11, color: "var(--ido-text-faint)" }}>
                  {new Date(u.uploadedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
                </span>
                <button
                  onClick={() => onDelete(u.zona)}
                  disabled={deletingZona === u.zona}
                  style={{ color: "var(--ido-text-faint)", background: "transparent", border: "none", cursor: "pointer" }}
                >
                  {deletingZona === u.zona ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                </button>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── Redimensionado de columna (design-system.md §4.15) ────────────────────────

function autoFitTextWidth(ctx: CanvasRenderingContext2D, values: string[], floor: number): number {
  let widest = 0;
  for (const v of values) {
    if (!v) continue;
    const w = ctx.measureText(v).width;
    if (w > widest) widest = w;
  }
  return Math.max(floor, Math.round(widest) + 24);
}

// ─── Main section ─────────────────────────────────────────────────────────────

export function StockZonaSection() {
  const [tab, setTab]                       = useState<Tab>("resumen");
  const [uploads, setUploads]               = useState<ZonaUpload[]>([]);
  const [loading, setLoading]               = useState(true);
  const [text, setText]                     = useState("");
  const [saving, setSaving]                 = useState(false);
  const [helpOpen, setHelpOpen]             = useState(false);
  const [deletingZona, setDeletingZona]     = useState<string | null>(null);
  const [importedAt, setImportedAt]         = useState<Date | null>(null);
  const [importedCount, setImportedCount]   = useState(0);

  // Resumen state
  const [selectedZonas, setSelectedZonas]   = useState<string[]>([]);   // [] = todas las zonas
  const [onlyZonasConStock, setOnlyZonasConStock] = useState(false);    // solo columnas de zona con stock
  const [pinnedArticulos, setPinnedArticulos] = useState<string[]>([]); // matrículas fijadas arriba
  const [filterFamilia, setFilterFamilia]   = useState("");
  const [filterTipo, setFilterTipo]         = useState<ArticuloTipo>("");
  const [filterSearch, setFilterSearch]     = useState("");
  const [sortCol, setSortCol]               = useState("articulo");
  const [sortDir, setSortDir]               = useState<SortDir>("asc");
  const [selectedRow, setSelectedRow]       = useState<string | null>(null);
  const [checkedArticulos, setCheckedArticulos] = useState<Set<string>>(new Set()); // tildadas para exportar
  const [exporting, setExporting]           = useState(false);

  // Toggle de fijar matrícula arriba
  const togglePin = useCallback((articulo: string) => {
    setPinnedArticulos((prev) =>
      prev.includes(articulo) ? prev.filter((a) => a !== articulo) : [...prev, articulo]);
  }, []);
  const toggleZonaSel = useCallback((zona: string) => {
    setSelectedZonas((prev) =>
      prev.includes(zona) ? prev.filter((z) => z !== zona) : [...prev, zona]);
  }, []);

  // Tildado de filas para exportar a Excel
  const toggleCheck = useCallback((articulo: string) => {
    setCheckedArticulos((prev) => {
      const next = new Set(prev);
      if (next.has(articulo)) next.delete(articulo); else next.add(articulo);
      return next;
    });
  }, []);

  // ── Usuario actual (namespacea la persistencia de layout por cuenta) ───────
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // ── Column resize + densidad + colapso de zonas ─────────────────────────────
  const [colW, setColW] = useState<Record<string, number>>({});
  const colWRef = useRef(colW);
  useEffect(() => { colWRef.current = colW; }, [colW]);
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizing = useRef<{ id: string; startX: number; startW: number } | null>(null);
  const autoFitCanvas = useRef<HTMLCanvasElement | null>(null);

  const [density, setDensity] = useState<Density>("normal");

  const [zonesExpanded, setZonesExpanded] = useState(true);
  const [zoneAnim, setZoneAnim] = useState<"in" | "out" | null>(null);   // animación colapso/expansión
  const zoneAnimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [resetMsg, setResetMsg] = useState(false);
  const resetMsgT = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetMsgT.current) clearTimeout(resetMsgT.current); }, []);

  // Ancho real del contenedor de la tabla (para el reparto automático de §4.17)
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Hidrata layout guardado (ancho de columna + densidad) ──────────────────
  useEffect(() => {
    if (!userId) return;
    const saved = loadTableLayout(userId, TABLE_ID);
    if (saved.colW) {
      const known: Record<string, number> = {};
      for (const [k, v] of Object.entries(saved.colW)) {
        if (KNOWN_COL_IDS.has(k) && typeof v === "number") known[k] = v;
      }
      if (Object.keys(known).length) setColW(known);
    }
    if (isDensity(saved.density)) setDensity(saved.density);
  }, [userId]);

  function cycleDensity() {
    const next = DENSITY_ORDER[(DENSITY_ORDER.indexOf(density) + 1) % DENSITY_ORDER.length];
    setDensity(next);
    if (userId) saveTableLayout(userId, TABLE_ID, { density: next });
  }

  function resetLayout() {
    setColW({});
    setDensity("normal");
    if (userId) saveTableLayout(userId, TABLE_ID, { colW: null, density: null });
    setResetMsg(true);
    if (resetMsgT.current) clearTimeout(resetMsgT.current);
    resetMsgT.current = setTimeout(() => setResetMsg(false), 1500);
  }

  // ── Persistencia de zonas elegidas / matrículas fijadas (localStorage) ──────
  const resumenStateLoaded = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RESUMEN_STATE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { selectedZonas?: string[]; pinned?: string[]; onlyConStock?: boolean };
        if (Array.isArray(saved.selectedZonas)) setSelectedZonas(saved.selectedZonas);
        if (Array.isArray(saved.pinned))        setPinnedArticulos(saved.pinned);
        if (typeof saved.onlyConStock === "boolean") setOnlyZonasConStock(saved.onlyConStock);
      }
    } catch { /* ignorar */ }
    resumenStateLoaded.current = true;
  }, []);

  useEffect(() => {
    if (!resumenStateLoaded.current) return;
    try {
      localStorage.setItem(RESUMEN_STATE_KEY, JSON.stringify({
        selectedZonas, pinned: pinnedArticulos, onlyConStock: onlyZonasConStock,
      }));
    } catch { /* ignorar */ }
  }, [selectedZonas, pinnedArticulos, onlyZonasConStock]);

  // ── Toggle de zonas con animación ───────────────────────────────────────────
  const toggleZones = useCallback(() => {
    if (zoneAnimTimer.current) clearTimeout(zoneAnimTimer.current);
    if (zonesExpanded) {
      setZoneAnim("out");
      zoneAnimTimer.current = setTimeout(() => { setZonesExpanded(false); setZoneAnim(null); }, 230);
    } else {
      setZonesExpanded(true);
      setZoneAnim("in");
      zoneAnimTimer.current = setTimeout(() => setZoneAnim(null), 260);
    }
  }, [zonesExpanded]);

  useEffect(() => () => { if (zoneAnimTimer.current) clearTimeout(zoneAnimTimer.current); }, []);

  const zoneAnimClass = zoneAnim === "in" ? "sz-zone-in" : zoneAnim === "out" ? "sz-zone-out" : "";

  // Catálogo maestro de matrículas (descripción + UDM + tipo más actualizados)
  const [matriculasInfo, setMatriculasInfo] = useState<Map<string, MatriculaInfo>>(new Map());
  const [matriculasLoading, setMatriculasLoading] = useState(false);

  // Familias: solo se leen para el filtro del Resumen. La edición/carga de
  // familias se movió a la sección Matrículas → Familias.
  const [families, setFamilies]             = useState<FamilyRow[]>([]);

  // ── Resize events (design-system.md §4.15) ──────────────────────────────────
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const r = resizing.current;
      if (!r) return;
      const floor = NATURAL_W[r.id] ?? 64;
      const w = Math.max(floor, r.startW + (e.clientX - r.startX));
      setColW((p) => ({ ...p, [r.id]: w }));
    }
    function onUp() {
      if (!resizing.current) return;
      resizing.current = null;
      setResizingCol(null);
      if (userIdRef.current) saveTableLayout(userIdRef.current, TABLE_ID, { colW: colWRef.current });
    }
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
    return () => { window.removeEventListener("mousemove", onMove, true); window.removeEventListener("mouseup", onUp, true); };
  }, []);

  function startResize(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    const startW = colW[id] ?? NATURAL_W[id] ?? 64;
    resizing.current = { id, startX: e.clientX, startW };
    setResizingCol(id);
  }

  // Doble clic ajusta al contenido más ancho (§4.15).
  function autoFitWidth(e: React.MouseEvent, id: string, values: string[]) {
    e.preventDefault();
    e.stopPropagation();
    const canvas = autoFitCanvas.current ?? (autoFitCanvas.current = document.createElement("canvas"));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.font = "13px var(--font-mono, ui-monospace, monospace)";
    const floor = NATURAL_W[id] ?? 64;
    const fitW = autoFitTextWidth(ctx, values, floor);
    setColW((p) => ({ ...p, [id]: fitW }));
    if (userIdRef.current) saveTableLayout(userIdRef.current, TABLE_ID, { colW: { ...colWRef.current, [id]: fitW } });
  }

  const Resizer = ({ id, onDoubleClick }: { id: string; onDoubleClick?: (e: React.MouseEvent) => void }) => {
    const active = resizingCol === id;
    return (
      <span
        onMouseDown={(e) => startResize(e, id)}
        onDoubleClick={onDoubleClick}
        className="group absolute top-0 right-[-4px] bottom-0 w-2 cursor-col-resize z-20 flex justify-center"
      >
        <span
          className={`w-[2px] h-full transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          style={{ background: "var(--ido-accent)", transitionDuration: "100ms", transitionTimingFunction: "var(--ido-ease)" }}
        />
      </span>
    );
  };
  const AbsorbBar = ({ id }: { id: string }) => {
    if (!ABSORBER_KEYS.has(id) || manualColsRef.current.has(id)) return null;
    return (
      <span
        title="Absorbe el sobrante"
        style={{ position: "absolute", bottom: 0, left: 12, right: 12, height: 2, background: "var(--ido-accent)", opacity: 0.5, pointerEvents: "none" }}
      />
    );
  };

  // ── Data loading ──────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setLoading(true);
    setUploads(await getUploads());
    setLoading(false);
  }, []);

  const refreshFamilies = useCallback(async () => {
    setFamilies(await getFamilyRowsCompat());
  }, []);

  const refreshMatriculas = useCallback(async () => {
    // 1) Mostrar al instante desde la caché de sesión (si existe)
    try {
      const cached = sessionStorage.getItem(MATRICULAS_CACHE_KEY);
      if (cached) setMatriculasInfo(new Map(JSON.parse(cached) as [string, MatriculaInfo][]));
    } catch { /* caché inválida: se ignora */ }
    // 2) Refrescar desde Supabase (en paralelo) en segundo plano
    setMatriculasLoading(true);
    const fresh = await getMatriculasInfo();
    setMatriculasInfo(fresh);
    setMatriculasLoading(false);
    try {
      sessionStorage.setItem(MATRICULAS_CACHE_KEY, JSON.stringify([...fresh]));
    } catch { /* sin espacio: la próxima vez se vuelve a bajar */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { refreshFamilies(); }, [refreshFamilies]);
  useEffect(() => { refreshMatriculas(); }, [refreshMatriculas]);

  // ── Sort ──────────────────────────────────────────────────────────────────

  const handleSort = (col: string) => {
    if (col === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir(col === "articulo" || col === "descArticulo" || col === "udmPrimaria" || col === "tipo" ? "asc" : "desc"); }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const zonas = useMemo(
    () => uploads.map((u) => u.zona).sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
    [uploads],
  );

  const baseZonas = useMemo(
    () => (selectedZonas.length ? zonas.filter((z) => selectedZonas.includes(z)) : zonas),
    [zonas, selectedZonas],
  );

  const lastUpload = useMemo(() => uploads.reduce<ZonaUpload | null>((latest, u) => {
    if (!latest || u.uploadedAt > latest.uploadedAt) return u;
    return latest;
  }, null), [uploads]);

  const familyMap = useMemo(() => new Map(families.map((f) => [f.articulo, f])), [families]);

  const familiasOf = useCallback(
    (articulo: string): string[] => familyMap.get(articulo)?.familias ?? [],
    [familyMap],
  );

  const tipoOf = useCallback((articulo: string): ArticuloTipo => {
    const manual = familyMap.get(articulo)?.tipo;
    if (manual) return manual;
    return matriculasInfo.get(articulo)?.tipo ?? "";
  }, [familyMap, matriculasInfo]);

  const familiasDisponibles = useMemo(
    () => [...new Set(families.flatMap((f) => f.familias))].sort((a, b) => a.localeCompare(b, "es")),
    [families],
  );

  const pivotMap = useMemo(() => {
    const m = new Map<string, PivotRow>();
    for (const upload of uploads) {
      for (const row of upload.rows) {
        if (!m.has(row.articulo)) {
          m.set(row.articulo, { articulo: row.articulo, descArticulo: row.descArticulo, udmPrimaria: row.udmPrimaria, total: 0, byZona: {} });
        }
        const pivot = m.get(row.articulo)!;
        const qty = parseFloat(String(row.enMano).replace(",", ".")) || 0;
        pivot.total += qty;
        pivot.byZona[upload.zona] = (pivot.byZona[upload.zona] ?? 0) + qty;
      }
    }
    for (const f of families) {
      if (f.familias.length > 0 && !m.has(f.articulo)) {
        m.set(f.articulo, { articulo: f.articulo, descArticulo: "", udmPrimaria: "", total: 0, byZona: {} });
      }
    }
    for (const [articulo, info] of matriculasInfo) {
      if (info.tipo === "servicio" && !m.has(articulo)) {
        m.set(articulo, { articulo, descArticulo: "", udmPrimaria: "", total: 0, byZona: {} });
      }
    }
    for (const pivot of m.values()) {
      const info = matriculasInfo.get(pivot.articulo);
      if (info) {
        if (info.descripcion) pivot.descArticulo = info.descripcion;
        if (info.udm)         pivot.udmPrimaria  = info.udm;
      }
    }
    return m;
  }, [uploads, families, matriculasInfo]);

  const searchExtraRows = useMemo(() => {
    if (!filterSearch) return [] as PivotRow[];
    const lo = filterSearch.toLowerCase();
    const extra: PivotRow[] = [];
    for (const [articulo, info] of matriculasInfo) {
      if (pivotMap.has(articulo)) continue;
      const match = articulo.toLowerCase().includes(lo) || (info.descripcion ?? "").toLowerCase().includes(lo);
      if (match) {
        extra.push({ articulo, descArticulo: info.descripcion ?? "", udmPrimaria: info.udm ?? "", total: 0, byZona: {} });
      }
    }
    return extra;
  }, [filterSearch, matriculasInfo, pivotMap]);

  const matchedRows = useMemo(() => [...pivotMap.values(), ...searchExtraRows]
    .filter((r) => {
      const familiaOk    = !filterFamilia            || familiasOf(r.articulo).includes(filterFamilia);
      const tipoOk       = !filterTipo               || tipoOf(r.articulo) === filterTipo;
      const lo           = filterSearch.toLowerCase();
      const searchOk     = !filterSearch
        || r.articulo.toLowerCase().includes(lo)
        || r.descArticulo.toLowerCase().includes(lo);
      return familiaOk && tipoOk && searchOk;
    })
    .sort((a, b) => {
      if (sortCol === "total") {
        return sortDir === "asc" ? a.total - b.total : b.total - a.total;
      }
      if (sortCol === "tipo") {
        const va = tipoOf(a.articulo);
        const vb = tipoOf(b.articulo);
        const cmp = va.localeCompare(vb, "es");
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortCol === "articulo" || sortCol === "descArticulo" || sortCol === "udmPrimaria") {
        const va = a[sortCol as keyof Pick<PivotRow, "articulo" | "descArticulo" | "udmPrimaria">];
        const vb = b[sortCol as keyof Pick<PivotRow, "articulo" | "descArticulo" | "udmPrimaria">];
        const cmp = String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" });
        return sortDir === "asc" ? cmp : -cmp;
      }
      const va = a.byZona[sortCol] ?? 0;
      const vb = b.byZona[sortCol] ?? 0;
      return sortDir === "asc" ? va - vb : vb - va;
    }), [pivotMap, searchExtraRows, familiasOf, tipoOf, filterFamilia, filterTipo, filterSearch, sortCol, sortDir]);

  const pinnedSet = useMemo(() => new Set(pinnedArticulos), [pinnedArticulos]);

  const pivotRows = useMemo(() => {
    const pinned = pinnedArticulos
      .map((a) => {
        const inPivot = pivotMap.get(a);
        if (inPivot) return inPivot;
        const info = matriculasInfo.get(a);
        if (info) return { articulo: a, descArticulo: info.descripcion ?? "", udmPrimaria: info.udm ?? "", total: 0, byZona: {} } as PivotRow;
        return undefined;
      })
      .filter((r): r is PivotRow => !!r);
    const rest = matchedRows.filter((r) => !pinnedSet.has(r.articulo));
    return [...pinned, ...rest];
  }, [pinnedArticulos, pivotMap, matriculasInfo, matchedRows, pinnedSet]);

  const pinnedCount = pinnedArticulos.filter((a) => pivotMap.has(a) || matriculasInfo.has(a)).length;

  const visibleZonas = useMemo(() => {
    if (!onlyZonasConStock) return baseZonas;
    const conStock = new Set<string>();
    for (const r of pivotRows) {
      for (const z of baseZonas) {
        if ((r.byZona[z] ?? 0) > 0) conStock.add(z);
      }
    }
    return baseZonas.filter((z) => conStock.has(z));
  }, [baseZonas, onlyZonasConStock, pivotRows]);

  const allCheckedInView = pivotRows.length > 0 && pivotRows.every((r) => checkedArticulos.has(r.articulo));
  const someCheckedInView = pivotRows.some((r) => checkedArticulos.has(r.articulo));
  const toggleCheckAll = useCallback(() => {
    setCheckedArticulos((prev) => {
      const next = new Set(prev);
      if (allCheckedInView) pivotRows.forEach((r) => next.delete(r.articulo));
      else pivotRows.forEach((r) => next.add(r.articulo));
      return next;
    });
  }, [allCheckedInView, pivotRows]);

  const handleExportSelected = async () => {
    if (checkedArticulos.size === 0) return;
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const rows = pivotRows.filter((r) => checkedArticulos.has(r.articulo));
      const data = rows.map((r) => {
        const rec: Record<string, string | number> = {
          "Matrícula":   r.articulo,
          "Descripción": r.descArticulo,
          "UDM":         r.udmPrimaria,
          "Tipo":        tipoMeta(tipoOf(r.articulo))?.label ?? "",
          "Total":       r.total,
        };
        for (const z of visibleZonas) rec[`Zona ${z}`] = r.byZona[z] ?? 0;
        return rec;
      });
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Stock");
      const fecha = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `stock-por-zona_${fecha}.xlsx`);
    } catch {
      toast.error("No se pudo generar el Excel");
    } finally {
      setExporting(false);
    }
  };

  // ── Ajuste de ancho al viewport (design-system.md §4.17) ───────────────────
  const manualCols = useMemo(() => new Set(Object.keys(colW)), [colW]);
  const manualColsRef = useRef(manualCols);
  manualColsRef.current = manualCols;
  const zoneW = colW.zone ?? NATURAL_W.zone;

  const fitted = useMemo(() => {
    const natural: Record<string, number> = {};
    for (const k of ["articulo", "descArticulo", "udmPrimaria", "tipo", "total"]) {
      natural[k] = manualCols.has(k) ? colW[k] : NATURAL_W[k];
    }
    const toggleW = zonesExpanded ? 36 : 96;
    const zonesW = zonesExpanded ? visibleZonas.length * zoneW : 0;
    const fixedSum = SEL_W + natural.articulo + natural.udmPrimaria + natural.tipo + natural.total + toggleW + zonesW;
    let rest = Math.max(0, containerW - fixedSum - natural.descArticulo);
    let descW = natural.descArticulo;
    if (ABSORBER_KEYS.has("descArticulo") && !manualCols.has("descArticulo")) {
      const cap = NATURAL_W.descArticulo * 2 - natural.descArticulo;
      const add = Math.min(rest, cap);
      descW += add;
      rest -= add;
    }
    const widths: Record<string, number> = { ...natural, descArticulo: descW };
    return { widths, pad: Math.max(0, Math.round(rest / 2)), toggleW };
  }, [colW, manualCols, containerW, zonesExpanded, visibleZonas.length, zoneW]);

  // ── Virtualización (rinde solo las filas visibles) ──────────────────────────
  const resumenScrollRef  = useRef<HTMLDivElement>(null);
  const ROW_H = DENSITY_ROW_H[density];

  const resumenVirtualizer = useVirtualizer({
    count: pivotRows.length,
    getScrollElement: () => resumenScrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 14,
  });
  // react-virtual cachea el tamaño estimado por índice — sin este remeasure
  // forzado, cambiar de densidad no mueve una fila que ya se midió antes.
  useEffect(() => { resumenVirtualizer.measure(); }, [density]); // eslint-disable-line react-hooks/exhaustive-deps

  // Column detection for Cargar tab
  const REQUIRED_COLS = Object.values(COL_MAP) as string[];
  const textLines = text.split("\n").filter((l) => l.trim());
  const textRowCount = textLines.length;
  const looksOk = textRowCount > 1 && /art.culo/i.test(text) && /organizaci.n/i.test(text);

  const detectedCols = useMemo(() => {
    if (!text.trim()) return null;
    const head = textLines[0] || "";
    return REQUIRED_COLS.map((c) => ({ name: c, found: head.includes(c) }));
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Carga handlers ────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!text.trim()) { toast.error("Pegá el texto antes de importar."); return; }
    setSaving(true);
    const { rows, error } = parseTSV(text.trim());
    if (error) { toast.error(error); setSaving(false); return; }
    const byZona = new Map<string, CompraRow[]>();
    for (const row of rows) {
      const z = row.organizacion || "Sin zona";
      if (!byZona.has(z)) byZona.set(z, []);
      byZona.get(z)!.push(row);
    }
    const errors: string[] = [];
    for (const [zona, zonaRows] of byZona) {
      const err = await saveUpload({ zona, rows: zonaRows, fileName: "pegado manual", uploadedAt: new Date().toISOString() });
      if (err) errors.push(`${zona}: ${err}`);
    }
    if (errors.length > 0) {
      toast.error(`Errores al guardar: ${errors.join(", ")}`);
    } else {
      setImportedAt(new Date());
      setImportedCount(rows.length);
      toast.success(`${rows.length} registros · ${byZona.size} zona${byZona.size > 1 ? "s" : ""}: ${[...byZona.keys()].join(", ")}`);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) await markUpdated("stock-zona", "Stock por zona", user.id).catch(() => {});
      setText(""); await refresh();
    }
    setSaving(false);
  };

  const handleDelete = async (z: string) => {
    setDeletingZona(z);
    const err = await removeUpload(z);
    if (err) toast.error(`Error al eliminar: ${err}`);
    else { toast.success(`Zona "${z}" eliminada`); await refresh(); }
    setDeletingZona(null);
  };

  const previewZonas = useMemo(() => {
    if (!text.trim()) return [] as string[];
    const { rows } = parseTSV(text.trim());
    return [...new Set(rows.map((r) => r.organizacion).filter(Boolean))];
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────

  const showSelBar = checkedArticulos.size > 0;

  return (
    <div className="ido-terminal">
      <div className="ido-card">
        <IdoTabsBar
          value={tab}
          onChange={setTab}
          tabs={TABS.map((t) => {
            const Icon = t.icon;
            return { id: t.id, label: <><Icon className="w-3.5 h-3.5" strokeWidth={1.9} />{t.label}</> };
          })}
          end={
            <>
              <ZonasCargadasMenu uploads={uploads} lastUpload={lastUpload} deletingZona={deletingZona} onDelete={handleDelete} />
              {tab === "resumen" && pivotMap.size > 0 && (
                <span className="ido-hint" style={{ marginTop: 0 }}>
                  <span style={{ color: "var(--ido-text)" }}>{matchedRows.length}</span> de {pivotMap.size} artículos
                </span>
              )}
              <button className="ido-btn ido-btn-ghost" onClick={() => setHelpOpen(true)} title="Ayuda de Stock por Zona">
                <HelpCircle className="w-3.5 h-3.5" />
                Ayuda
              </button>
              <button className="ido-btn ido-btn-ghost" onClick={() => { refresh(); refreshFamilies(); refreshMatriculas(); }} disabled={loading}>
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              </button>
            </>
          }
        />

        {/* ── RESUMEN ────────────────────────────────────────────────────────── */}
        {tab === "resumen" && (
          <div ref={containerRef}>
            {loading ? (
              <div className="ido-loading">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando datos...
              </div>
            ) : pivotMap.size === 0 ? (
              <div className="ido-loading" style={{ flexDirection: "column", gap: 12, height: 220 }}>
                <PackageOpen className="w-10 h-10" style={{ opacity: 0.2 }} />
                No hay datos cargados. Usá &quot;Cargar datos&quot; para importar.
              </div>
            ) : (
              <>
                {/* Barra de filtros (§4.8) */}
                <div className="flex items-center gap-2.5 flex-wrap" style={{ padding: "14px 20px", borderBottom: "1px solid var(--ido-line)" }}>
                  <IdoMultiSelect
                    values={selectedZonas}
                    onToggle={toggleZonaSel}
                    onClear={() => setSelectedZonas([])}
                    placeholder="Todas las zonas"
                    minWidth={180}
                    options={zonas.map((z) => ({ value: z, label: `Zona ${z}`, node: <ZonePill zona={z} /> }))}
                  />

                  <button
                    onClick={() => setOnlyZonasConStock((v) => !v)}
                    title="Mostrar solo las columnas de zona que tienen stock en lo que estás viendo"
                    className={`ido-btn ido-btn-ghost${onlyZonasConStock ? " is-on" : ""}`}
                    style={{ height: 38 }}
                  >
                    <Filter className="w-3.5 h-3.5" strokeWidth={2} />
                    Solo zonas con stock
                  </button>

                  {familiasDisponibles.length > 0 && (
                    <IdoSelect
                      options={familiasDisponibles.map((f) => ({ value: f, label: f }))}
                      value={filterFamilia}
                      onChange={setFilterFamilia}
                      placeholder="Todas las familias"
                      clearable
                    />
                  )}

                  <IdoSelect
                    options={TIPO_OPTIONS.map((t) => ({ value: t.value, label: t.label, node: <TipoPill tipo={t.value} /> }))}
                    value={filterTipo}
                    onChange={(v) => setFilterTipo(v as ArticuloTipo)}
                    placeholder="Servicio / Material"
                    minWidth={170}
                    clearable
                  />

                  <div className="relative" style={{ flex: 1, minWidth: 180 }}>
                    <Search className="w-3.5 h-3.5 absolute" style={{ left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ido-text-dim)", pointerEvents: "none" }} />
                    <input
                      value={filterSearch}
                      onChange={(e) => setFilterSearch(e.target.value)}
                      placeholder="Buscar por número o nombre…"
                      className="ido-field"
                      style={{ width: "100%", height: 38, paddingLeft: 34, fontFamily: "var(--font-sans, system-ui, sans-serif)" }}
                    />
                  </div>

                  {(pinnedCount > 0 || matriculasLoading) && (
                    <p className="ido-hint flex items-center gap-1.5" style={{ marginTop: 0 }}>
                      {pinnedCount > 0 && (
                        <span className="inline-flex items-center gap-1" style={{ color: PIN_COLOR }}>
                          <Pin className="w-3 h-3" fill={PIN_COLOR} strokeWidth={2} /> {pinnedCount} fijada{pinnedCount !== 1 ? "s" : ""}
                          <button onClick={() => setPinnedArticulos([])} className="ml-0.5 underline decoration-dotted" style={{ color: "inherit" }}>
                            limpiar
                          </button>
                        </span>
                      )}
                      {matriculasLoading && (
                        <span className="inline-flex items-center gap-1">
                          {pinnedCount > 0 && "· "}<Loader2 className="w-3 h-3 animate-spin" /> catálogo…
                        </span>
                      )}
                    </p>
                  )}

                  <div style={{ flex: "0 0 100%", height: 0 }} />

                  {resetMsg && (
                    <span className="ido-reset-confirm">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg>
                      Vista restablecida
                    </span>
                  )}
                  <button className="ido-btn ido-btn-text" onClick={resetLayout} title="Restaura el ancho de columnas y la densidad a su valor por defecto">
                    Restablecer vista
                  </button>
                  <button className="ido-btn ido-btn-text" onClick={cycleDensity} title="Altura de fila: compacta 32px · normal 40px · cómoda 52px">
                    Densidad: {DENSITY_LABEL[density]}
                  </button>
                </div>

                {/* Tabla (CSS grid, ancho ajustado al viewport — §4.11/§4.17) */}
                <div style={{ position: "relative" }}>
                  <div style={{ overflowX: "auto" }}>
                    <div style={{ padding: `0 ${fitted.pad}px`, transition: "padding 200ms var(--ido-ease)" }}>
                      <div style={{ position: "relative" }}>
                        {resizingCol && (
                          <>
                            <div
                              style={{
                                position: "absolute", top: 0, bottom: 0,
                                left: colOffsetX(resizingCol, fitted, zonesExpanded, visibleZonas, zoneW),
                                width: 1, background: "var(--ido-accent)", pointerEvents: "none", zIndex: 30,
                              }}
                            />
                            <div
                              style={{
                                position: "absolute", top: HEADER_H + 6, left: colOffsetX(resizingCol, fitted, zonesExpanded, visibleZonas, zoneW) + 6,
                                padding: "4px 8px", borderRadius: 6, background: "var(--ido-surface-hover)", border: "1px solid var(--ido-line)",
                                fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11, color: "var(--ido-text)",
                                whiteSpace: "nowrap", pointerEvents: "none", zIndex: 31,
                              }}
                            >
                              {Math.round(resizingCol === "zone" ? zoneW : fitted.widths[resizingCol] ?? NATURAL_W[resizingCol])} px
                            </div>
                          </>
                        )}

                        {/* Header */}
                        <div
                          className="flex"
                          style={{ height: HEADER_H, background: "var(--ido-surface)", borderBottom: "1px solid var(--ido-line-strong)", transition: "width 200ms var(--ido-ease)" }}
                        >
                          <div className="flex items-center justify-center" style={{ width: SEL_W, flexShrink: 0 }}>
                            <IdoCheckbox
                              checked={allCheckedInView}
                              indeterminate={!allCheckedInView && someCheckedInView}
                              onClick={toggleCheckAll}
                              label="Seleccionar todas"
                            />
                          </div>
                          {[
                            { col: "articulo", label: "Matrícula" },
                            { col: "descArticulo", label: "Descripción" },
                            { col: "udmPrimaria", label: "UDM" },
                            { col: "tipo", label: "Tipo" },
                          ].map(({ col, label }) => {
                            const active = sortCol === col;
                            return (
                              <div
                                key={col}
                                onClick={() => handleSort(col)}
                                className="relative flex items-center gap-1.5"
                                style={{
                                  width: fitted.widths[col], flexShrink: 0, padding: "0 12px", cursor: "pointer", userSelect: "none",
                                  fontSize: 10, fontWeight: 500, letterSpacing: ".1em", textTransform: "uppercase",
                                  color: active ? "var(--ido-text)" : "var(--ido-text-dim)",
                                }}
                              >
                                {label}
                                <SortArrow active={active} dir={active ? sortDir : "asc"} className="w-3 h-3 shrink-0" />
                                <Resizer id={col} onDoubleClick={(e) => autoFitWidth(e, col, pivotRows.map((r) => String(r[col as keyof Pick<PivotRow, "articulo" | "descArticulo" | "udmPrimaria">] ?? "")))} />
                                <AbsorbBar id={col} />
                              </div>
                            );
                          })}
                          <div
                            onClick={() => handleSort("total")}
                            className="relative flex items-center justify-end gap-1.5"
                            style={{
                              width: fitted.widths.total, flexShrink: 0, padding: "0 12px", cursor: "pointer", userSelect: "none",
                              fontSize: 10, fontWeight: 500, letterSpacing: ".1em", textTransform: "uppercase",
                              color: sortCol === "total" ? "var(--ido-text)" : "var(--ido-text-dim)",
                            }}
                          >
                            <SortArrow active={sortCol === "total"} dir={sortCol === "total" ? sortDir : "asc"} className="w-3 h-3 shrink-0" />
                            Total
                            <Resizer id="total" onDoubleClick={(e) => autoFitWidth(e, "total", pivotRows.map((r) => r.total.toLocaleString("es-AR")))} />
                            <AbsorbBar id="total" />
                          </div>
                          <div
                            onClick={toggleZones}
                            title={zonesExpanded ? "Colapsar zonas" : "Expandir zonas"}
                            className="flex items-center gap-1"
                            style={{ width: fitted.toggleW, flexShrink: 0, padding: "0 10px", cursor: "pointer", userSelect: "none", color: "var(--ido-text-dim)" }}
                          >
                            <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ transition: "transform 200ms var(--ido-ease)", transform: zonesExpanded ? "rotate(180deg)" : "none" }} />
                            {!zonesExpanded && zonas.length > 0 && (
                              <span style={{ fontSize: 11, textTransform: "none", letterSpacing: "normal" }}>{zonas.length} zona{zonas.length !== 1 ? "s" : ""}</span>
                            )}
                          </div>
                          {zonesExpanded && visibleZonas.map((zona, i) => {
                            const active = sortCol === zona;
                            return (
                              <div
                                key={zona}
                                onClick={() => handleSort(zona)}
                                className={`relative flex items-center justify-center gap-1.5 ${i === 0 ? "" : ""}`}
                                style={{ width: zoneW, flexShrink: 0, padding: "0 8px", cursor: "pointer", userSelect: "none", borderLeft: i === 0 ? "1px solid var(--ido-line-strong)" : undefined }}
                              >
                                <span className={zoneAnimClass}>
                                  <SortArrow active={active} dir={active ? sortDir : "asc"} className="w-3.5 h-3.5 shrink-0" />
                                </span>
                                <span className={zoneAnimClass}><ZonePill zona={zona} /></span>
                                <Resizer id="zone" onDoubleClick={(e) => autoFitWidth(e, "zone", pivotRows.map((r) => (r.byZona[zona] ?? 0).toLocaleString("es-AR")))} />
                              </div>
                            );
                          })}
                        </div>

                        {/* Filas (virtualizadas) */}
                        {pivotRows.length === 0 ? (
                          <div className="ido-loading">No hay registros que coincidan con los filtros</div>
                        ) : (
                          <div
                            key={density}
                            ref={resumenScrollRef}
                            // overflowX:"hidden", no "visible": si un eje es auto/scroll y el
                            // otro visible, el spec de CSS fuerza el "visible" a computar
                            // como "auto" igual — este div volvería a tener SU PROPIO scroll
                            // horizontal independiente del contenedor de afuera (exactamente
                            // el bug de encabezado desincronizado de las filas que reportó
                            // el usuario). "hidden" evita esa reconversión: el scroll
                            // horizontal queda gobernado únicamente por el div de afuera.
                            style={{ maxHeight: "min(70vh, 640px)", overflowY: "auto", overflowX: "hidden" }}
                          >
                            <div style={{ height: resumenVirtualizer.getTotalSize(), position: "relative" }}>
                              {resumenVirtualizer.getVirtualItems().map((vi) => {
                                const row = pivotRows[vi.index];
                                const isSelected = selectedRow === row.articulo;
                                const isPinned   = pinnedSet.has(row.articulo);
                                const isChecked  = checkedArticulos.has(row.articulo);
                                return (
                                  <div
                                    key={row.articulo}
                                    onClick={() => setSelectedRow(isSelected ? null : row.articulo)}
                                    className={`ido-table-row flex ${isChecked ? "ido-row-selected-multi" : isSelected ? "ido-row-selected" : ""}`}
                                    style={{
                                      position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`,
                                      height: ROW_H, borderBottom: "1px solid var(--ido-row-line)",
                                      background: isChecked ? undefined : isSelected ? undefined : isPinned ? `${PIN_COLOR}12` : undefined,
                                    }}
                                  >
                                    <div className="flex items-center justify-center" style={{ width: SEL_W, flexShrink: 0 }}>
                                      <IdoCheckbox checked={isChecked} onClick={() => toggleCheck(row.articulo)} label={`Seleccionar ${row.articulo}`} />
                                    </div>
                                    <div className="flex items-center gap-1.5 truncate" style={{ width: fitted.widths.articulo, flexShrink: 0, padding: "0 12px 0 8px", fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12, color: "var(--ido-accent)" }}>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); togglePin(row.articulo); }}
                                        title={isPinned ? "Quitar de fijadas" : "Fijar arriba"}
                                        className="shrink-0 grid place-items-center"
                                        style={{ width: 20, height: 20, borderRadius: 5, color: isPinned ? PIN_COLOR : "var(--ido-text-faint)", background: isPinned ? `${PIN_COLOR}20` : "transparent", border: "none", cursor: "pointer" }}
                                      >
                                        <Pin className="w-3.5 h-3.5" strokeWidth={2} fill={isPinned ? PIN_COLOR : "none"} />
                                      </button>
                                      <span className="truncate">{row.articulo}</span>
                                    </div>
                                    <div className="flex items-center truncate" style={{ width: fitted.widths.descArticulo, flexShrink: 0, padding: "0 12px", color: "var(--ido-text-dim)" }}>
                                      {row.descArticulo}
                                    </div>
                                    <div className="flex items-center truncate" style={{ width: fitted.widths.udmPrimaria, flexShrink: 0, padding: "0 12px", color: "var(--ido-text-faint)" }}>
                                      {row.udmPrimaria}
                                    </div>
                                    <div className="flex items-center" style={{ width: fitted.widths.tipo, flexShrink: 0, padding: "0 12px" }}>
                                      {(() => {
                                        const t = tipoOf(row.articulo);
                                        return t ? <TipoPill tipo={t} /> : <span style={{ opacity: 0.25 }}>—</span>;
                                      })()}
                                    </div>
                                    <div className="flex items-center justify-end" style={{ width: fitted.widths.total, flexShrink: 0, padding: "0 12px", fontWeight: 600, color: "var(--ido-text)", fontFamily: "var(--font-mono, ui-monospace, monospace)", fontVariantNumeric: "tabular-nums" }}>
                                      {row.total.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
                                    </div>
                                    <div style={{ width: fitted.toggleW, flexShrink: 0 }} />
                                    {zonesExpanded && visibleZonas.map((zona, i) => {
                                      const qty = row.byZona[zona];
                                      return (
                                        <div
                                          key={zona}
                                          className="flex items-center justify-center"
                                          style={{ width: zoneW, flexShrink: 0, padding: "0 6px", color: "var(--ido-text-dim)", fontSize: 12, fontFamily: "var(--font-mono, ui-monospace, monospace)", fontVariantNumeric: "tabular-nums", borderLeft: i === 0 ? "1px solid var(--ido-line-strong)" : undefined }}
                                        >
                                          <span className={zoneAnimClass}>
                                            {qty != null && qty > 0 ? qty.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : <span style={{ opacity: 0.25 }}>—</span>}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Barra flotante de selección en lote (§4.16) */}
                  {showSelBar && (
                    <div className="ido-selbar">
                      <span className="ido-selbar-count"><b>{checkedArticulos.size}</b> seleccionada{checkedArticulos.size !== 1 ? "s" : ""}</span>
                      <span className="ido-selbar-sep" />
                      <button className="ido-btn ido-btn-ghost" onClick={handleExportSelected} disabled={exporting}>
                        {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
                        Exportar Excel
                      </button>
                      <button className="ido-selbar-close" title="Limpiar selección" onClick={() => setCheckedArticulos(new Set())}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── CARGAR ─────────────────────────────────────────────────────────── */}
        {tab === "cargar" && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3 items-start" style={{ padding: 20 }}>
            {/* Main card */}
            <div className="ido-card" style={{ padding: 16 }}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--ido-text)" }}>Pegar datos</h3>
                  <p className="ido-note" style={{ maxWidth: 520, margin: "4px 0 0" }}>
                    Copiá el contenido desde el sistema y pegalo acá. Las zonas se detectan automáticamente desde la columna{" "}
                    <strong>Organización</strong>.
                  </p>
                </div>
                {text.trim() && (
                  <span
                    className="ido-chip shrink-0"
                    style={{
                      background: looksOk ? "rgba(63,207,142,.12)" : "rgba(245,165,36,.14)",
                      color: looksOk ? "var(--ido-accent)" : "var(--ido-warning)",
                      border: `1px solid ${looksOk ? "rgba(63,207,142,.35)" : "rgba(245,165,36,.4)"}`,
                    }}
                  >
                    <span className="ido-chip-dot" style={{ background: "currentColor" }} />
                    {looksOk ? `${textRowCount} filas detectadas` : "Revisar encabezado"}
                  </span>
                )}
              </div>

              {/* Terminal-style textarea */}
              <div style={{ borderRadius: 10, border: "1px solid var(--ido-line)", overflow: "hidden", background: "var(--ido-surface)" }}>
                <div className="flex items-center justify-end" style={{ padding: "8px 12px", borderBottom: "1px solid var(--ido-line)", background: "var(--ido-surface-hover)" }}>
                  <span style={{ fontSize: 11, color: "var(--ido-text-faint)", fontFamily: "var(--font-mono, ui-monospace, monospace)", fontVariantNumeric: "tabular-nums" }}>
                    {text.length.toLocaleString("es-AR")} car. · {textRowCount} línea{textRowCount === 1 ? "" : "s"}
                  </span>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Pegá aquí el texto copiado del sistema (Ctrl+V)…"
                  rows={7}
                  className="w-full outline-none resize-y"
                  style={{
                    padding: "14px 16px", background: "transparent", border: "none", color: "var(--ido-text)",
                    lineHeight: 1.7, fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12.5,
                  }}
                />
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2.5 mt-3">
                <button className="ido-btn ido-btn-primary" style={{ height: 38 }} onClick={handleImport} disabled={!text.trim() || saving}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {saving ? "Importando..." : "Importar"}
                </button>

                <button className="ido-btn ido-btn-ghost" style={{ height: 38 }} onClick={() => setText("")} disabled={!text}>
                  Limpiar
                </button>

                <div className="flex-1" />

                {importedAt && (
                  <div className="flex items-center gap-1.5" style={{ fontSize: 12, color: "var(--ido-accent)" }}>
                    <Check className="w-3.5 h-3.5" strokeWidth={2.4} />
                    Importado {importedAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · {importedCount} artículos
                  </div>
                )}
              </div>

              {previewZonas.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap mt-3 pt-3" style={{ borderTop: "1px solid var(--ido-line)" }}>
                  <span className="ido-hint" style={{ marginTop: 0 }}>Zonas detectadas:</span>
                  {previewZonas.map((z) => <ZonePill key={z} zona={z} small />)}
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="flex flex-col gap-3">
              <div className="ido-card" style={{ padding: 16 }}>
                <p style={{ fontSize: 11, color: "var(--ido-text-dim)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>Columnas requeridas</p>
                <div className="flex flex-col gap-1.5">
                  {REQUIRED_COLS.map((c, i) => {
                    const found = detectedCols?.[i]?.found;
                    const hasText = text.trim().length > 0;
                    return (
                      <div
                        key={c}
                        className="flex items-center gap-2"
                        style={{ padding: "8px 12px", borderRadius: 8, background: "var(--ido-surface)", border: "1px solid var(--ido-line)", fontSize: 12 }}
                      >
                        <span
                          className="flex items-center justify-center shrink-0"
                          style={{
                            width: 18, height: 18, borderRadius: 5,
                            background: found ? "rgba(63,207,142,.2)" : hasText ? "rgba(255,138,138,.18)" : "var(--ido-surface-hover)",
                            color: found ? "var(--ido-accent)" : hasText ? "var(--ido-danger)" : "var(--ido-text-dim)",
                          }}
                        >
                          {found ? <Check className="w-3 h-3" strokeWidth={2.6} /> : hasText ? <X className="w-2.5 h-2.5" strokeWidth={2.6} /> : <span style={{ width: 4, height: 4, borderRadius: 2, background: "currentColor" }} />}
                        </span>
                        <span className="flex-1" style={{ color: "var(--ido-text)", fontWeight: 500 }}>{c}</span>
                        {found && <span style={{ fontSize: 11, color: "var(--ido-accent)" }}>detectada</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {helpOpen && (
        <StockHelpModal onClose={() => setHelpOpen(false)} onGoCargar={() => { setHelpOpen(false); setTab("cargar"); }} />
      )}
    </div>
  );
}

// Offset acumulado hasta el borde derecho de una columna, para posicionar la
// guía de resize (§4.15) y su etiqueta de ancho.
function colOffsetX(
  id: string,
  fitted: { widths: Record<string, number>; toggleW: number },
  zonesExpanded: boolean,
  visibleZonas: string[],
  zoneW: number,
): number {
  const order = ["articulo", "descArticulo", "udmPrimaria", "tipo", "total"];
  let x = SEL_W;
  for (const k of order) {
    x += fitted.widths[k];
    if (k === id) return x;
  }
  x += fitted.toggleW;
  if (zonesExpanded && id === "zone" && visibleZonas.length > 0) {
    // Todas las columnas de zona comparten un único ancho/handle: la guía se
    // muestra al borde derecho de la primera (alcanza para ubicar el drag).
    return x + zoneW;
  }
  return x;
}

// ─── Centro de ayuda (réplica del diseño de Informe Técnico, paleta IDO) ──────

const STOCK_HELP_META = [
  { id: "cargar",   icon: Download,    label: "Cargar datos",     color: "#5B8DEF", subtitle: "Extraer de SIGA y pegar" },
  { id: "resumen",  icon: PackageOpen, label: "Resumen de stock", color: "var(--ido-accent)", subtitle: "Consulta consolidada" },
] as const;

function HelpTip({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 14px", borderRadius: 9, background: "rgba(63,207,142,.08)", border: "1px solid rgba(63,207,142,.22)", marginTop: 8 }}>
      <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--ido-accent)" }} />
      <span style={{ fontSize: 13, color: "var(--ido-text-dim)", lineHeight: 1.55 }}>{children}</span>
    </div>
  );
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        <ListChecks className="w-4 h-4" style={{ color: "var(--ido-text-dim)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ido-text-dim)" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function HelpAction({ label, desc }: { label: string; desc: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", paddingBottom: 8 }}>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 24, height: 22, borderRadius: 6, background: "var(--ido-surface-hover)", border: "1px solid var(--ido-line)", fontSize: 12, color: "var(--ido-text)", fontWeight: 600, paddingLeft: 7, paddingRight: 7, whiteSpace: "nowrap", marginTop: 1 }}>{label}</span>
      <span style={{ fontSize: 13, color: "var(--ido-text-dim)", lineHeight: 1.5 }}>{desc}</span>
    </div>
  );
}

function StockHelpStepContent({ step, onGoCargar }: { step: number; onGoCargar: () => void }) {
  if (step === 0) {
    const steps = [
      { n: 1, img: "/ayuda-stock/paso1.png", text: <>Ingresá tu cuenta en <strong>SIEPEC</strong> y entrá a <strong>Siga&nbsp;-&nbsp;Compras&nbsp;-&nbsp;Solicitante</strong>.</> },
      { n: 2, img: "/ayuda-stock/paso2.png", text: <>En la parte inferior del cuadro, en el título <strong>Inventario</strong>, hacé clic en <strong>«Cantidad en mano»</strong>.</> },
      { n: 3, img: "/ayuda-stock/paso3.png", text: <>Se abre una pestaña donde podés <strong>seleccionar la zona</strong> que querés consultar.</> },
      { n: 4, img: "/ayuda-stock/paso4.png", text: <>Al elegir una zona (por ej. <strong>Zona A - Córdoba Capital</strong>) se abre otra pestaña.</> },
      { n: 5, img: "/ayuda-stock/paso5.png", text: <>Presioná <strong>Encontrar</strong>. Sobre la tabla, hacé <strong>clic derecho → «Copiar todas las filas»</strong>.</> },
    ];
    return (
      <>
        <p style={{ fontSize: 14, color: "var(--ido-text-dim)", lineHeight: 1.65, marginBottom: 4 }}>
          Extraé el inventario de una zona desde <strong>SIGA</strong> y pegalo en la pestaña <strong>«Cargar datos»</strong>. La zona se detecta sola desde la columna <em>Organización</em>.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 16 }}>
          {steps.map((s) => (
            <div key={s.n} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 999, background: "#5B8DEF", color: "#07130d", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{s.n}</span>
                <span style={{ fontSize: 13.5, color: "var(--ido-text)", lineHeight: 1.55, paddingTop: 1 }}>{s.text}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, border: "1px solid var(--ido-line)", background: "var(--ido-surface)", padding: 12 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.img} alt={`Paso ${s.n}`} style={{ maxHeight: 300, maxWidth: "100%", height: "auto", display: "block", borderRadius: 6 }} />
              </div>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 999, background: "var(--ido-accent)", color: "var(--ido-accent-ink)", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>6</span>
            <span style={{ fontSize: 13.5, color: "var(--ido-text)", lineHeight: 1.55, paddingTop: 1 }}>
              Volvé acá, entrá a <strong>«Cargar datos»</strong>, <strong>pegá</strong> (Ctrl+V) la tabla y tocá <strong>Importar</strong>. Podés pegar varias zonas juntas.
            </span>
          </div>
        </div>
        <HelpTip>Pegá la información tal cual viene, sin borrar columnas ni filas: el sistema limpia y consolida solo. Volver a cargar una zona <strong>reemplaza</strong> sus datos anteriores.</HelpTip>
        <button
          onClick={onGoCargar}
          className="ido-btn ido-btn-primary"
          style={{ marginTop: 16, height: 38 }}
        >
          <Download className="w-3.5 h-3.5" /> Ir a Cargar datos
        </button>
      </>
    );
  }
  return (
    <>
      <p style={{ fontSize: 14, color: "var(--ido-text-dim)", lineHeight: 1.65, marginBottom: 4 }}>
        El Resumen consolida una fila por matrícula con el total y el detalle por zona de depósito.
      </p>
      <HelpSection title="Qué muestra">
        <HelpAction label="Columnas" desc="Matrícula, Descripción, UDM, Tipo y Total; a la derecha, una columna por cada zona cargada." />
        <HelpAction label="Servicios" desc="Aparecen aunque no tengan stock (Total 0), porque por naturaleza no se depositan en zona." />
      </HelpSection>
      <HelpSection title="Acciones">
        <HelpAction label="Colapsar" desc="La flecha del encabezado oculta/expande las columnas de zona para ver solo los totales." />
        <HelpAction label="Filtrar" desc="Por zona, por familia, por Servicio/Material y búsqueda por número o nombre de matrícula." />
        <HelpAction label="Ordenar" desc="Clic en cualquier encabezado para ordenar ascendente/descendente." />
        <HelpAction label="Redimensionar" desc="Arrastrá el borde de una columna para cambiar su ancho, o doble clic para ajustar al contenido. Se guarda para la próxima vez." />
      </HelpSection>
      <HelpTip>La descripción y la UDM salen del catálogo de «Carga de datos» (la lista de matrículas más actualizada).</HelpTip>
    </>
  );
}

function StockHelpModal({ onClose, onGoCargar }: { onClose: () => void; onGoCargar: () => void }) {
  const [step, setStep] = useState(0);
  const current = STOCK_HELP_META[step];
  const Icon = current.icon;
  const total = STOCK_HELP_META.length;

  return createPortal(
    <div
      className="ido-terminal"
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="ido-card"
        style={{ width: "100%", maxWidth: 860, height: "min(90vh, 660px)", display: "flex", flexDirection: "column" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid var(--ido-line)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 8, background: "rgba(63,207,142,.14)", border: "1px solid rgba(63,207,142,.35)", color: "var(--ido-accent)" }}>
              <HelpCircle className="w-4 h-4" />
            </div>
            <span style={{ fontSize: 17, fontWeight: 600, color: "var(--ido-text)", letterSpacing: -0.3 }}>Guía de uso — Stock por Zona</span>
          </div>
          <button onClick={onClose} className="ido-btn ido-btn-ghost" style={{ width: 30, height: 30, padding: 0, justifyContent: "center" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--ido-line)", padding: "14px 10px", overflowY: "auto", background: "var(--ido-surface)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ido-text-faint)", padding: "0 8px 10px" }}>Temas</div>
            {STOCK_HELP_META.map((s, idx) => {
              const SIcon = s.icon;
              const isActive = idx === step;
              return (
                <button
                  key={s.id}
                  onClick={() => setStep(idx)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 9, marginBottom: 2,
                    background: isActive ? `${s.color}18` : "transparent",
                    border: isActive ? `1px solid ${s.color}40` : "1px solid transparent",
                    cursor: "pointer", textAlign: "left", transition: "background .12s, border .12s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, background: isActive ? `${s.color}22` : "var(--ido-surface-hover)", border: `1px solid ${isActive ? s.color + "55" : "rgba(255,255,255,.06)"}`, flexShrink: 0, color: isActive ? s.color : "var(--ido-text-faint)" }}>
                    <SIcon className="w-3.5 h-3.5" />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: isActive ? "var(--ido-text)" : "var(--ido-text-dim)", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: isActive ? "var(--ido-text-dim)" : "var(--ido-text-faint)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.subtitle}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, paddingBottom: 18, borderBottom: "1px solid var(--ido-line)" }}>
              <div style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 10, background: `${current.color}18`, border: `1px solid ${current.color}44`, color: current.color, flexShrink: 0 }}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--ido-text-faint)" }}>Tema {step + 1} de {total}</span>
                  <ArrowRight className="w-3 h-3" style={{ color: "var(--ido-text-faint)" }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: current.color, textTransform: "uppercase", letterSpacing: "0.05em" }}>{current.subtitle}</span>
                </div>
                <div style={{ fontSize: 19, fontWeight: 700, color: "var(--ido-text)", letterSpacing: -0.3, marginTop: 2 }}>{current.label}</div>
              </div>
            </div>
            <StockHelpStepContent step={step} onGoCargar={onGoCargar} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderTop: "1px solid var(--ido-line)", flexShrink: 0 }}>
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="ido-btn ido-btn-ghost"
            style={{ height: 34 }}
          >
            <ChevronLeft className="w-4 h-4" /> Anterior
          </button>
          <div style={{ display: "flex", gap: 5 }}>
            {STOCK_HELP_META.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => setStep(idx)}
                style={{ width: idx === step ? 20 : 7, height: 7, borderRadius: 4, border: "none", background: idx === step ? current.color : "var(--ido-line-strong)", cursor: "pointer", transition: "width .2s, background .2s", padding: 0 }}
              />
            ))}
          </div>
          {step < total - 1 ? (
            <button onClick={() => setStep((s) => Math.min(total - 1, s + 1))} className="ido-btn ido-btn-ghost" style={{ height: 34, color: current.color, borderColor: `${current.color}55` }}>
              Siguiente <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={onClose} className="ido-btn ido-btn-primary" style={{ height: 34 }}>
              <Check className="w-4 h-4" /> Entendido
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
