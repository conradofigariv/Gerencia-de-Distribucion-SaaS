"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { DirectionAwareTabs } from "@/components/ui/direction-aware-tabs";
import {
  Loader2, X, PackageOpen, RefreshCw,
  ChevronDown, ChevronUp, ChevronsUpDown, ChevronRight,
  Download, Sparkles, Wrench, Package, Check, HelpCircle,
  ChevronLeft, ArrowRight, Lightbulb, ListChecks, Pin, Filter,
} from "lucide-react";
import { CheckIcon } from "lucide-react";
import { SearchInput } from "@/components/ui/floating-input";
import { Button } from "@/components/ui/button";
import { parseTSV, saveUpload, getUploads, removeUpload, COL_MAP } from "@/lib/stockStorage";
import type { ZonaUpload, CompraRow } from "@/lib/stockStorage";
import { getMatriculasInfo } from "@/lib/stockFamilies";
import type { FamilyRow, ArticuloTipo, MatriculaInfo } from "@/lib/stockFamilies";
import { getFamilyRowsCompat } from "@/lib/familias";
import { toast } from "sonner";

type Tab            = "resumen" | "cargar";
type SortDir        = "asc" | "desc";

// Caché de sesión del catálogo maestro (para que la 2da carga sea instantánea)
const MATRICULAS_CACHE_KEY = "stock-zona-matriculas-cache";
// Ancho de columnas persistido (para que la lista se vea igual al volver)
const COLWIDTHS_KEY = "stock-zona-colwidths";
// Zonas elegidas + matrículas fijadas + "solo zonas con stock" (persistido)
const RESUMEN_STATE_KEY = "stock-zona-resumen-state";

const TABS: { id: Tab; label: string; icon: React.ElementType; desc: string }[] = [
  { id: "resumen",  label: "Resumen de stock", icon: PackageOpen, desc: "Stock consolidado por artículo y zona de depósito." },
  { id: "cargar",   label: "Cargar datos",     icon: Download,    desc: "Importá stock pegando los datos directamente desde el sistema." },
];

interface PivotRow {
  articulo:     string;
  descArticulo: string;
  udmPrimaria:  string;
  total:        number;
  byZona:       Record<string, number>;
}

// ─── Zone color system (beast aesthetic — oklch hue per zone) ─────────────────

const ZONE_HUES: Record<string, number> = {
  "2A": 152, "2B": 195, "2C": 30,  "2D": 295,
  "2E": 340, "2F": 270, "2G": 70,  "2H": 140, "2I": 50,
};

function getZoneHue(zona: string): number {
  if (zona in ZONE_HUES) return ZONE_HUES[zona];
  let h = 0;
  for (const c of zona) h = (h * 37 + c.charCodeAt(0)) & 0xfff;
  return (h * 137) % 360;
}

function zoneStyles(zona: string) {
  const hue = getZoneHue(zona);
  return {
    bg:     `oklch(0.28 0.05 ${hue} / 0.6)`,
    text:   `oklch(0.82 0.12 ${hue})`,
    border: `oklch(0.70 0.07 ${hue} / 0.45)`,
    dot:    `oklch(0.72 0.10 ${hue})`,
  };
}

function ZonePill({ zona, small }: { zona: string; small?: boolean }) {
  const s = zoneStyles(zona);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: small ? "2px 7px" : "3px 9px",
      borderRadius: 999,
      background: s.bg,
      color: s.text,
      border: `1px solid ${s.border}`,
      fontSize: small ? 11 : 11.5,
      fontWeight: 600,
      letterSpacing: 0.2,
      whiteSpace: "nowrap",
      flexShrink: 0,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 3, background: s.dot, flexShrink: 0 }} />
      {zona}
    </span>
  );
}

// ─── Tipo (Servicio / Material) ────────────────────────────────────────────────

const TIPO_OPTIONS: { value: Exclude<ArticuloTipo, "">; label: string }[] = [
  { value: "material", label: "Material" },
  { value: "servicio", label: "Servicio" },
];

function tipoMeta(tipo: ArticuloTipo) {
  if (tipo === "servicio") return { label: "Servicio", color: "#7dd3fc", bg: "oklch(0.28 0.08 230 / 0.5)", border: "oklch(0.70 0.10 230 / 0.45)", Icon: Wrench };
  if (tipo === "material") return { label: "Material", color: "var(--accent-green)", bg: "color-mix(in oklab, var(--accent-emerald-deep) 45%, transparent)", border: "color-mix(in oklab, var(--accent-emerald) 50%, transparent)", Icon: Package };
  return null;
}

function TipoPill({ tipo }: { tipo: ArticuloTipo }) {
  const m = tipoMeta(tipo);
  if (!m) return null;
  const Icon = m.Icon;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 9px", borderRadius: 999,
      background: m.bg, color: m.color, border: `1px solid ${m.border}`,
      fontSize: 11.5, fontWeight: 600, letterSpacing: 0.2, whiteSpace: "nowrap", flexShrink: 0,
    }}>
      <Icon className="w-3 h-3" strokeWidth={2.2} />
      {m.label}
    </span>
  );
}

// ─── Resize handle ────────────────────────────────────────────────────────────

function ResizeHandle({ onStart }: { onStart: (e: MouseEvent) => void }) {
  return (
    <div
      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none group/rh"
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onStart(e.nativeEvent); }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute right-0 top-1/4 h-1/2 w-px bg-border group-hover/rh:bg-accent/60 transition-colors" />
    </div>
  );
}

// ─── BeastSelect (dropdown unificado — mismo estilo que Informe Técnico) ───────

interface BeastOption { value: string; label: string; node?: React.ReactNode }

function BeastSelect({
  options, value, onChange, placeholder, clearable = false, minWidth = 170, align = "left", portal = false,
}: {
  options: BeastOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  clearable?: boolean;   // si true, agrega una opción que limpia (value "")
  minWidth?: number;
  align?: "left" | "right";
  portal?: boolean;      // si true, renderiza el menú en document.body (escapa contenedores con overflow)
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left?: number; right?: number; minWidth: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open || !portal) return;
    const update = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.max(minWidth, r.width);
      // Anclar a la derecha si abrir a la izquierda se saldría del viewport
      const overflowsRight = r.left + w > window.innerWidth - 8;
      const anchorRight = align === "right" || overflowsRight;
      setCoords({
        top: r.bottom + 6,
        ...(anchorRight ? { right: Math.max(8, window.innerWidth - r.right) } : { left: r.left }),
        minWidth: w,
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [open, portal, align, minWidth]);

  const selected = options.find(o => o.value === value);
  const showPlaceholder = !selected;

  const renderItem = (label: string, node: React.ReactNode | undefined, isActive: boolean, onClick: () => void, key: string) => (
    <button
      key={key}
      onClick={onClick}
      className="w-full text-left flex items-center gap-2.5 transition-colors"
      style={{
        padding: "8px 10px", borderRadius: 7, border: "none",
        background: isActive ? "oklch(0.27 0.005 270)" : "transparent", cursor: "pointer",
      }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.25 0.005 270)"; }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    >
      <span className="flex-1 truncate text-[13px]" style={{ color: isActive ? "oklch(0.97 0 0)" : "oklch(0.82 0 0)", fontWeight: isActive ? 500 : 400 }}>
        {node ?? label}
      </span>
      {isActive && <CheckIcon className="w-3.5 h-3.5 shrink-0" style={{ color: "#8B5CF6" }} strokeWidth={2.6} />}
    </button>
  );

  const menuItems = (
    <>
      {clearable && renderItem(placeholder, undefined, value === "", () => { onChange(""); setOpen(false); }, "__clear__")}
      {options.map(o => renderItem(o.label, o.node, o.value === value, () => { onChange(o.value); setOpen(false); }, o.value))}
    </>
  );

  const menuStyle: React.CSSProperties = {
    background: "var(--panel-2)",
    border: "1px solid var(--hairline)",
    borderRadius: 10,
    boxShadow: "0 14px 32px -16px rgba(0,0,0,0.6), 0 0 0 1px oklch(1 0 0 / 0.02) inset",
    padding: 4,
    maxHeight: 320, overflowY: "auto",
  };

  return (
    <div ref={ref} className="relative" style={{ flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2"
        style={{
          height: 38, padding: "0 12px", borderRadius: 9, minWidth, width: "100%",
          background: "var(--panel-input)",
          border: `1px solid ${open ? "color-mix(in oklab, var(--accent-violet) 55%, transparent)" : "var(--hairline)"}`,
          color: "oklch(0.97 0 0)", fontSize: 13,
          transition: "border-color .15s, box-shadow .15s",
          boxShadow: open ? "0 0 0 3px color-mix(in oklab, var(--accent-violet) 15%, transparent)" : "none",
        }}
      >
        <span className="truncate flex-1 text-left flex items-center gap-2" style={{ color: showPlaceholder ? "oklch(0.55 0 0)" : "oklch(0.90 0 0)" }}>
          {selected ? (selected.node ?? selected.label) : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "oklch(0.55 0 0)" }} />
      </button>

      {open && portal && coords && createPortal(
        <div
          ref={menuRef}
          className="overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
          style={{ position: "fixed", zIndex: 300, top: coords.top, left: coords.left, right: coords.right, minWidth: coords.minWidth, ...menuStyle }}
        >
          {menuItems}
        </div>,
        document.body,
      )}

      {open && !portal && (
        <div
          ref={menuRef}
          className="absolute z-50 top-[calc(100%+6px)] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
          style={{ [align]: 0, minWidth: Math.max(minWidth, 200), ...menuStyle } as React.CSSProperties}
        >
          {menuItems}
        </div>
      )}
    </div>
  );
}

// ─── BeastMultiSelect (multi-selección con checkboxes — mismo estilo) ──────────

function BeastMultiSelect({
  options, values, onToggle, onClear, placeholder, minWidth = 200, align = "left",
}: {
  options: BeastOption[];
  values: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
  placeholder: string;
  minWidth?: number;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left?: number; right?: number; minWidth: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.max(minWidth, r.width);
      const overflowsRight = r.left + w > window.innerWidth - 8;
      const anchorRight = align === "right" || overflowsRight;
      setCoords({
        top: r.bottom + 6,
        ...(anchorRight ? { right: Math.max(8, window.innerWidth - r.right) } : { left: r.left }),
        minWidth: w,
      });
    };
    update();
    // Reposicionar al hacer scroll (no cerrar): así no se cierra al desplazar
    // dentro del menú ni al usar su barra; si scrollea la página, lo sigue.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [open, align, minWidth]);

  const selectedSet = new Set(values);
  const count = values.length;

  const menu = (
    <div
      ref={menuRef}
      className="overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
      style={{
        position: "fixed", zIndex: 300, top: coords?.top, left: coords?.left, right: coords?.right,
        minWidth: coords?.minWidth ?? minWidth,
        background: "var(--panel-2)",
        border: "1px solid var(--hairline)",
        borderRadius: 10,
        boxShadow: "0 14px 32px -16px rgba(0,0,0,0.6), 0 0 0 1px oklch(1 0 0 / 0.02) inset",
        padding: 4,
        maxHeight: 340, overflowY: "auto",
      }}
    >
      <button
        onClick={() => { onClear(); }}
        className="w-full text-left flex items-center gap-2.5 transition-colors"
        style={{ padding: "8px 10px", borderRadius: 7, border: "none", background: "transparent", cursor: "pointer" }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.25 0.005 270)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
      >
        <span className="flex-1 truncate text-[13px]" style={{ color: count === 0 ? "oklch(0.97 0 0)" : "oklch(0.82 0 0)", fontWeight: count === 0 ? 500 : 400 }}>
          Todas las zonas
        </span>
        {count === 0 && <CheckIcon className="w-3.5 h-3.5 shrink-0" style={{ color: "#8B5CF6" }} strokeWidth={2.6} />}
      </button>
      {options.map(o => {
        const isActive = selectedSet.has(o.value);
        return (
          <button
            key={o.value}
            onClick={() => onToggle(o.value)}
            className="w-full text-left flex items-center gap-2.5 transition-colors"
            style={{ padding: "8px 10px", borderRadius: 7, border: "none", background: "transparent", cursor: "pointer" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.25 0.005 270)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
          >
            <span
              className="grid place-items-center shrink-0"
              style={{
                width: 16, height: 16, borderRadius: 5,
                border: `1.5px solid ${isActive ? "#8B5CF6" : "oklch(1 0 0 / 0.18)"}`,
                background: isActive ? "#8B5CF6" : "transparent",
                transition: "background .12s, border-color .12s",
              }}
            >
              {isActive && <CheckIcon className="w-2.5 h-2.5" style={{ color: "#fff" }} strokeWidth={3.5} />}
            </span>
            <span className="flex-1 truncate text-[13px]" style={{ color: isActive ? "oklch(0.97 0 0)" : "oklch(0.82 0 0)" }}>
              {o.node ?? o.label}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div ref={ref} className="relative" style={{ flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2"
        style={{
          height: 38, padding: "0 12px", borderRadius: 9, minWidth, width: "100%",
          background: "var(--panel-input)",
          border: `1px solid ${open ? "color-mix(in oklab, var(--accent-violet) 55%, transparent)" : "var(--hairline)"}`,
          color: "oklch(0.97 0 0)", fontSize: 13,
          transition: "border-color .15s, box-shadow .15s",
          boxShadow: open ? "0 0 0 3px color-mix(in oklab, var(--accent-violet) 15%, transparent)" : "none",
        }}
      >
        <span className="truncate flex-1 text-left flex items-center gap-1.5" style={{ color: count === 0 ? "oklch(0.55 0 0)" : "oklch(0.90 0 0)" }}>
          {count === 0
            ? placeholder
            : count <= 2
              ? values.slice().sort((a, b) => a.localeCompare(b, "es", { numeric: true })).map(z => <ZonePill key={z} zona={z} small />)
              : <>{count} zonas</>}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "oklch(0.55 0 0)" }} />
      </button>
      {open && coords && createPortal(menu, document.body)}
    </div>
  );
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

  // Toggle de fijar matrícula arriba
  const togglePin = useCallback((articulo: string) => {
    setPinnedArticulos(prev =>
      prev.includes(articulo) ? prev.filter(a => a !== articulo) : [...prev, articulo],
    );
  }, []);
  const toggleZonaSel = useCallback((zona: string) => {
    setSelectedZonas(prev =>
      prev.includes(zona) ? prev.filter(z => z !== zona) : [...prev, zona],
    );
  }, []);

  // Column resize & zone collapse
  const [colWidths, setColWidths] = useState({ articulo: 140, descArticulo: 280, udmPrimaria: 84, tipo: 130, total: 100 });
  const [zoneWidth, setZoneWidth] = useState(120);
  const [zonesExpanded, setZonesExpanded] = useState(true);
  const [zoneAnim, setZoneAnim] = useState<"in" | "out" | null>(null);   // animación colapso/expansión
  const zoneAnimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colWidthsLoaded = useRef(false);
  const resizingRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);

  // ── Persistencia del ancho de columnas (localStorage) ───────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLWIDTHS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { colWidths?: Partial<typeof colWidths>; zoneWidth?: number };
        if (saved.colWidths) setColWidths(c => ({ ...c, ...saved.colWidths }));
        if (typeof saved.zoneWidth === "number") setZoneWidth(saved.zoneWidth);
      }
    } catch { /* ignorar */ }
    colWidthsLoaded.current = true;
  }, []);

  useEffect(() => {
    if (!colWidthsLoaded.current) return;   // no guardar antes de cargar lo previo
    try { localStorage.setItem(COLWIDTHS_KEY, JSON.stringify({ colWidths, zoneWidth })); } catch { /* ignorar */ }
  }, [colWidths, zoneWidth]);

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
      // colapsar: reproducir salida y recién después ocultar las columnas
      setZoneAnim("out");
      zoneAnimTimer.current = setTimeout(() => { setZonesExpanded(false); setZoneAnim(null); }, 230);
    } else {
      // expandir: mostrar las columnas y reproducir entrada
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

  // ── Resize events ─────────────────────────────────────────────────────────

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const { col, startX, startWidth } = resizingRef.current;
      const newW = Math.max(50, startWidth + e.clientX - startX);
      if (col === "__zone__") setZoneWidth(newW);
      else setColWidths(p => ({ ...p, [col]: newW }));
    };
    const onUp = () => { resizingRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

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
    if (col === sortCol) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir(col === "articulo" || col === "descArticulo" || col === "udmPrimaria" || col === "tipo" ? "asc" : "desc"); }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const zonas = useMemo(
    () => uploads.map(u => u.zona).sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
    [uploads],
  );

  // Zonas elegidas en el desplegable (vacío = todas). Se intersecta con las
  // zonas existentes por si quedó alguna guardada que ya no existe.
  const baseZonas = useMemo(
    () => (selectedZonas.length ? zonas.filter(z => selectedZonas.includes(z)) : zonas),
    [zonas, selectedZonas],
  );

  const lastUpdate = useMemo(() => uploads.reduce<string | null>((latest, u) => {
    if (!latest || u.uploadedAt > latest) return u.uploadedAt;
    return latest;
  }, null), [uploads]);

  const familyMap = useMemo(() => new Map(families.map(f => [f.articulo, f])), [families]);

  // Familias (etiquetas) de una matrícula.
  const familiasOf = useCallback(
    (articulo: string): string[] => familyMap.get(articulo)?.familias ?? [],
    [familyMap],
  );

  // Tipo efectivo de una matrícula: la edición manual (Familias) tiene prioridad;
  // si no hay, sale del catálogo maestro `matriculas.mat_serv` (Carga de datos).
  const tipoOf = useCallback((articulo: string): ArticuloTipo => {
    const manual = familyMap.get(articulo)?.tipo;
    if (manual) return manual;
    return matriculasInfo.get(articulo)?.tipo ?? "";
  }, [familyMap, matriculasInfo]);

  // Todas las familias existentes (de todas las matrículas), únicas y ordenadas.
  const familiasDisponibles = useMemo(
    () => [...new Set(families.flatMap(f => f.familias))].sort((a, b) => a.localeCompare(b, "es")),
    [families],
  );

  // Cantidad de matrículas con al menos una familia asignada.
  const asignadosCount = useMemo(
    () => families.filter(f => f.familias.length > 0).length,
    [families],
  );

  // Build pivot — combina el stock cargado (uploads) con las matrículas
  // clasificadas en Familias que aún no tienen stock (aparecen con Total 0).
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
    // Matrículas con alguna familia asignada que aún no tienen stock: se incluyen
    // para que sean visibles (su descripción/UDM se completa abajo desde el catálogo).
    for (const f of families) {
      if (f.familias.length > 0 && !m.has(f.articulo)) {
        m.set(f.articulo, { articulo: f.articulo, descArticulo: "", udmPrimaria: "", total: 0, byZona: {} });
      }
    }
    // Servicios del catálogo maestro: por definición no tienen stock, así que
    // no aparecerían por sí solos. Se incluyen (Total 0) para que se puedan ver
    // y filtrar. Los materiales sin stock NO se agregan (serían ruido).
    for (const [articulo, info] of matriculasInfo) {
      if (info.tipo === "servicio" && !m.has(articulo)) {
        m.set(articulo, { articulo, descArticulo: "", udmPrimaria: "", total: 0, byZona: {} });
      }
    }
    // Enriquecer con el catálogo maestro `matriculas`: la descripción y UDM más
    // actualizadas mandan; si la matrícula no está en la maestra, queda el dato
    // del stock (o vacío para las clasificadas sin stock).
    for (const pivot of m.values()) {
      const info = matriculasInfo.get(pivot.articulo);
      if (info) {
        if (info.descripcion) pivot.descArticulo = info.descripcion;
        if (info.udm)         pivot.udmPrimaria  = info.udm;
      }
    }
    return m;
  }, [uploads, families, matriculasInfo]);

  // Cuando hay una búsqueda activa, incluir también las matrículas del catálogo
  // maestro que coincidan pero NO estén en el pivot (materiales sin stock y sin
  // familia). Aparecen con Total 0 en todas las zonas: así una matrícula cargada
  // en el sistema pero sin stock se ve como "0", en vez de parecer inexistente.
  // Sin búsqueda no se agregan (evita volcar todo el catálogo en 0).
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

  // Filas que cumplen los filtros (búsqueda / familia / tipo). NO se filtra por
  // zona: elegir zonas solo limita las COLUMNAS, no las filas.
  const matchedRows = useMemo(() => [...pivotMap.values(), ...searchExtraRows]
    .filter(r => {
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

  // Conjunto de matrículas fijadas (para estilo y para no duplicarlas).
  const pinnedSet = useMemo(() => new Set(pinnedArticulos), [pinnedArticulos]);

  // Filas finales: las fijadas SIEMPRE arriba (aunque no coincidan con el filtro),
  // en orden de fijado, y debajo el resto que cumple los filtros.
  const pivotRows = useMemo(() => {
    const pinned = pinnedArticulos
      .map(a => {
        const inPivot = pivotMap.get(a);
        if (inPivot) return inPivot;
        // Fijada una matrícula sin stock (solo en el catálogo): fila sintética en 0.
        const info = matriculasInfo.get(a);
        if (info) return { articulo: a, descArticulo: info.descripcion ?? "", udmPrimaria: info.udm ?? "", total: 0, byZona: {} } as PivotRow;
        return undefined;
      })
      .filter((r): r is PivotRow => !!r);
    const rest = matchedRows.filter(r => !pinnedSet.has(r.articulo));
    return [...pinned, ...rest];
  }, [pinnedArticulos, pivotMap, matriculasInfo, matchedRows, pinnedSet]);

  const pinnedCount = pinnedArticulos.filter(a => pivotMap.has(a) || matriculasInfo.has(a)).length;

  // Columnas de zona visibles: las elegidas (o todas) y, si "solo con stock"
  // está activo, solo las que tienen stock en alguna fila visible.
  const visibleZonas = useMemo(() => {
    if (!onlyZonasConStock) return baseZonas;
    const conStock = new Set<string>();
    for (const r of pivotRows) {
      for (const z of baseZonas) {
        if ((r.byZona[z] ?? 0) > 0) conStock.add(z);
      }
    }
    return baseZonas.filter(z => conStock.has(z));
  }, [baseZonas, onlyZonasConStock, pivotRows]);

  // ── Virtualización de tablas (rinde solo las filas visibles) ────────────────
  const resumenScrollRef  = useRef<HTMLDivElement>(null);

  const resumenVirtualizer = useVirtualizer({
    count: pivotRows.length,
    getScrollElement: () => resumenScrollRef.current,
    estimateSize: () => 41,
    overscan: 14,
  });

  // Column detection for Cargar tab
  const REQUIRED_COLS = Object.values(COL_MAP) as string[];
  const textLines = text.split("\n").filter(l => l.trim());
  const textRowCount = textLines.length;
  const looksOk = textRowCount > 1 && /art.culo/i.test(text) && /organizaci.n/i.test(text);

  const detectedCols = useMemo(() => {
    if (!text.trim()) return null;
    const head = textLines[0] || "";
    return REQUIRED_COLS.map(c => ({ name: c, found: head.includes(c) }));
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
      // Se queda en "Cargar datos" (se cargan zonas de a una); limpia y refresca.
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
    return [...new Set(rows.map(r => r.organizacion).filter(Boolean))];
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Table layout ──────────────────────────────────────────────────────────

  const TOGGLE_W = zonesExpanded ? 36 : 96;
  const tableWidth =
    colWidths.articulo + colWidths.descArticulo + colWidths.udmPrimaria + colWidths.tipo + colWidths.total +
    TOGGLE_W + (zonesExpanded ? visibleZonas.length * zoneWidth : 0);

  const fixedCols = [
    { col: "articulo",     label: "Matrícula",   align: "left"  as const, w: colWidths.articulo     },
    { col: "descArticulo", label: "Descripción", align: "left"  as const, w: colWidths.descArticulo },
    { col: "udmPrimaria",  label: "UDM",         align: "left"  as const, w: colWidths.udmPrimaria  },
    { col: "tipo",         label: "Tipo",        align: "left"  as const, w: colWidths.tipo         },
    { col: "total",        label: "Total",       align: "right" as const, w: colWidths.total        },
  ];

  const cellBorder = "1px solid hsl(var(--border) / 0.35)";

  const activeTab  = TABS.find(t => t.id === tab) ?? TABS[0];
  const ActiveIcon = activeTab.icon;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header bar: icon + title + actions */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div
            className="grid place-items-center mt-0.5"
            style={{
              width: 36, height: 36, borderRadius: 9,
              background: "color-mix(in oklab, var(--accent-emerald-deep) 45%, transparent)",
              border: "1px solid color-mix(in oklab, var(--accent-emerald) 50%, transparent)",
              color: "var(--accent-green)",
            }}
          >
            <PackageOpen className="w-[18px] h-[18px]" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-foreground" style={{ letterSpacing: -0.4, margin: 0 }}>
              Stock por Zona
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: "oklch(0.55 0 0)" }}>
              {lastUpdate
                ? <>Última actualización: <span style={{ color: "oklch(0.80 0 0)" }}>{new Date(lastUpdate).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</span></>
                : "Consulta y carga de stock por organización."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <button
            onClick={() => setHelpOpen(true)}
            title="Ayuda de Stock por Zona"
            style={{
              height: 32, padding: "0 12px", borderRadius: 9,
              background: "oklch(0.22 0.005 270)",
              border: "1px solid oklch(1 0 0 / 0.08)",
              color: "var(--muted-foreground)", fontSize: 12.5, fontWeight: 500,
              cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7,
              transition: "color .15s, border-color .15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.90 0 0)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "oklch(1 0 0 / 0.18)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--muted-foreground)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "oklch(1 0 0 / 0.08)"; }}
          >
            <HelpCircle className="w-4 h-4" />
            Ayuda
          </button>
          <button
            onClick={() => { refresh(); refreshFamilies(); refreshMatriculas(); }}
            disabled={loading}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-accent/40 transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Tabs — Direction Aware Tabs (burbuja deslizante + contenido direccional) */}
      <DirectionAwareTabs
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        className="mb-5"
        tabs={TABS.map((t) => {
          const Icon = t.icon;
          return {
            id: t.id,
            label: (
              <>
                <Icon className="w-3.5 h-3.5" strokeWidth={1.9} />
                {t.label}
              </>
            ),
          };
        })}
      >
      {/* Content card */}
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
              color: "var(--accent-green)",
            }}
          >
            <ActiveIcon className="w-4 h-4" strokeWidth={2} />
          </div>
          <h2 className="text-[20px] font-semibold tracking-tight text-foreground" style={{ letterSpacing: -0.3, margin: 0 }}>
            {activeTab.label}
          </h2>
        </div>
        <p className="ml-[42px] mb-7 text-[14.5px]" style={{ color: "oklch(0.58 0 0)" }}>
          {activeTab.desc}
        </p>

      {/* ── RESUMEN ────────────────────────────────────────────────────────── */}
      {tab === "resumen" && (
        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-16 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando datos...
            </div>
          ) : pivotMap.size === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground">
              <PackageOpen className="w-12 h-12 opacity-20" />
              <p className="text-sm">No hay datos cargados. Usá "Cargar datos" para importar.</p>
            </div>
          ) : (
            <>
              {/* Filter bar */}
              <div className="flex items-center gap-2.5 flex-wrap">
                {/* Zone multi-select (varias zonas fijas; solo limita columnas) */}
                <BeastMultiSelect
                  values={selectedZonas}
                  onToggle={toggleZonaSel}
                  onClear={() => setSelectedZonas([])}
                  placeholder="Todas las zonas"
                  minWidth={180}
                  options={zonas.map(z => ({ value: z, label: `Zona ${z}`, node: <ZonePill zona={z} /> }))}
                />

                {/* Solo zonas con stock (oculta columnas de zona sin stock visible) */}
                <button
                  onClick={() => setOnlyZonasConStock(v => !v)}
                  title="Mostrar solo las columnas de zona que tienen stock en lo que estás viendo"
                  style={{
                    height: 38, padding: "0 12px", borderRadius: 9,
                    display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer",
                    fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap",
                    background: onlyZonasConStock ? "color-mix(in oklab, var(--accent-emerald-deep) 45%, transparent)" : "var(--panel-input)",
                    border: `1px solid ${onlyZonasConStock ? "color-mix(in oklab, var(--accent-emerald) 55%, transparent)" : "var(--hairline)"}`,
                    color: onlyZonasConStock ? "var(--accent-green)" : "var(--muted-foreground)",
                    transition: "background .15s, color .15s, border-color .15s",
                  }}
                >
                  <Filter className="w-3.5 h-3.5" strokeWidth={2} />
                  Solo zonas con stock
                </button>

                {familiasDisponibles.length > 0 && (
                  <BeastSelect
                    options={familiasDisponibles.map(f => ({ value: f, label: f }))}
                    value={filterFamilia}
                    onChange={setFilterFamilia}
                    placeholder="Todas las familias"
                    clearable
                  />
                )}

                <BeastSelect
                  options={TIPO_OPTIONS.map(t => ({ value: t.value, label: t.label, node: <TipoPill tipo={t.value} /> }))}
                  value={filterTipo}
                  onChange={v => setFilterTipo(v as ArticuloTipo)}
                  placeholder="Servicio / Material"
                  minWidth={170}
                  clearable
                />

                {/* Search input — busca por número o por nombre a la vez */}
                <SearchInput
                  value={filterSearch}
                  onChange={setFilterSearch}
                  placeholder="Buscar por número o nombre…"
                  style={{ flex: 1, minWidth: 180 }}
                />

                <p className="text-[12.5px] text-muted-foreground whitespace-nowrap flex items-center gap-1.5">
                  <span><span className="text-foreground font-medium">{matchedRows.length}</span> de {pivotMap.size} artículos</span>
                  {pinnedCount > 0 && (
                    <span className="inline-flex items-center gap-1" style={{ color: "#c4b5fd" }}>
                      · <Pin className="w-3 h-3" fill="#c4b5fd" strokeWidth={2} /> {pinnedCount} fijada{pinnedCount !== 1 ? "s" : ""}
                      <button onClick={() => setPinnedArticulos([])} className="ml-0.5 underline decoration-dotted hover:text-foreground" style={{ fontSize: 11.5 }}>
                        limpiar
                      </button>
                    </span>
                  )}
                  {matriculasLoading && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground/70">
                      · <Loader2 className="w-3 h-3 animate-spin" /> catálogo…
                    </span>
                  )}
                </p>
              </div>

              {/* Pivot table */}
              <div className="rounded-[14px] overflow-hidden" style={{ background: "var(--panel-2)", border: "1px solid var(--hairline)" }}>
                <div ref={resumenScrollRef} className="overflow-auto" style={{ maxHeight: "70vh" }}>
                  <table
                    style={zonesExpanded
                      ? { tableLayout: "fixed", width: "100%", minWidth: tableWidth, borderCollapse: "separate", borderSpacing: 0, fontSize: 13.5 }
                      : { tableLayout: "fixed", width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13.5 }}
                  >
                    <colgroup>
                      {fixedCols.map(c => <col key={c.col} style={{ width: c.w }} />)}
                      <col style={{ width: TOGGLE_W }} />
                      {zonesExpanded && visibleZonas.map(z => <col key={z} style={{ width: zoneWidth }} />)}
                    </colgroup>
                    <thead>
                      <tr>
                        {fixedCols.map(({ col, label, align, w }) => {
                          const active = sortCol === col;
                          const SortIcon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
                          return (
                            <th
                              key={col}
                              onClick={() => handleSort(col)}
                              style={{
                                width: w,
                                borderBottom: "1px solid hsl(var(--border))",
                                padding: "14px 14px",
                                textAlign: align,
                                fontSize: 13,
                                fontWeight: 600,
                                letterSpacing: "0.5px",
                                textTransform: "uppercase",
                                color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                                cursor: "pointer",
                                userSelect: "none",
                                position: "sticky",
                                top: 0,
                                zIndex: 2,
                                background: "var(--panel-header)",
                              }}
                            >
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
                                {label}
                                <SortIcon className={`w-3.5 h-3.5 shrink-0 transition-opacity ${active ? "opacity-100" : "opacity-30"}`} />
                              </span>
                              <ResizeHandle onStart={e => { resizingRef.current = { col, startX: e.clientX, startWidth: w }; }} />
                            </th>
                          );
                        })}
                        <th
                          onClick={toggleZones}
                          title={zonesExpanded ? "Colapsar zonas" : "Expandir zonas"}
                          style={{
                            width: TOGGLE_W,
                            borderBottom: "1px solid hsl(var(--border))",
                            padding: "14px 8px",
                            cursor: "pointer",
                            userSelect: "none",
                            color: "hsl(var(--muted-foreground))",
                            position: "sticky",
                            top: 0,
                            zIndex: 2,
                            background: "var(--panel-header)",
                          }}
                        >
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${zonesExpanded ? "rotate-180" : ""}`} />
                            {!zonesExpanded && zonas.length > 0 && (
                              <span className="text-[11px] font-normal normal-case tracking-normal">{zonas.length} zona{zonas.length !== 1 ? "s" : ""}</span>
                            )}
                          </span>
                        </th>
                        {zonesExpanded && visibleZonas.map(zona => {
                          const active = sortCol === zona;
                          const SortIcon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
                          return (
                            <th
                              key={zona}
                              onClick={() => handleSort(zona)}
                              style={{
                                width: zoneWidth,
                                borderBottom: "1px solid hsl(var(--border))",
                                padding: "12px 8px",
                                cursor: "pointer",
                                userSelect: "none",
                                textAlign: "center",
                                position: "sticky",
                                top: 0,
                                zIndex: 2,
                                background: "var(--panel-header)",
                              }}
                            >
                              <span className={`inline-flex items-center justify-center gap-1.5 ${zoneAnimClass}`}>
                                <SortIcon className={`w-3.5 h-3.5 shrink-0 text-muted-foreground ${active ? "opacity-100" : "opacity-30"}`} />
                                <ZonePill zona={zona} />
                              </span>
                              <ResizeHandle onStart={e => { resizingRef.current = { col: "__zone__", startX: e.clientX, startWidth: zoneWidth }; }} />
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {pivotRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={fixedCols.length + 1 + (zonesExpanded ? visibleZonas.length : 0)}
                            style={{ padding: "48px 24px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}
                          >
                            No hay registros que coincidan con los filtros
                          </td>
                        </tr>
                      ) : (() => {
                        const vItems  = resumenVirtualizer.getVirtualItems();
                        const totalH  = resumenVirtualizer.getTotalSize();
                        const padTop  = vItems.length ? vItems[0].start : 0;
                        const padBot  = vItems.length ? totalH - vItems[vItems.length - 1].end : 0;
                        const colSpan = fixedCols.length + 1 + (zonesExpanded ? visibleZonas.length : 0);
                        return (
                          <>
                            {padTop > 0 && <tr style={{ height: padTop }}><td colSpan={colSpan} style={{ padding: 0, border: "none" }} /></tr>}
                            {vItems.map(vi => {
                              const row = pivotRows[vi.index];
                              const isSelected = selectedRow === row.articulo;
                              const isPinned   = pinnedSet.has(row.articulo);
                              const isLastPinned = pinnedCount > 0 && vi.index === pinnedCount - 1;
                              const isLast = vi.index === pivotRows.length - 1;
                              const bottomBorder = isLastPinned
                                ? { borderBottom: "2px solid color-mix(in oklab, var(--accent-violet) 50%, transparent)" }
                                : isLast ? {} : { borderBottom: cellBorder };
                              const pinnedBg = "color-mix(in oklab, var(--accent-violet) 8%, transparent)";
                              const baseBg = isSelected ? "color-mix(in oklab, var(--accent-violet) 15%, transparent)" : isPinned ? pinnedBg : "";
                              return (
                                <tr
                                  key={row.articulo}
                                  onClick={() => setSelectedRow(isSelected ? null : row.articulo)}
                                  style={{ cursor: "pointer", background: baseBg || undefined, transition: "background 0.1s" }}
                                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "hsl(var(--secondary) / 0.35)"; }}
                                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = baseBg; }}
                                >
                                  <td style={{ ...bottomBorder, padding: "10px 12px 10px 10px", fontFamily: "ui-monospace, monospace", fontSize: 12.5, color: "#7ee2a8", overflow: "hidden", whiteSpace: "nowrap" }}>
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%" }}>
                                      <button
                                        onClick={e => { e.stopPropagation(); togglePin(row.articulo); }}
                                        title={isPinned ? "Quitar de fijadas" : "Fijar arriba"}
                                        className="shrink-0 grid place-items-center transition-colors"
                                        style={{
                                          width: 20, height: 20, borderRadius: 5,
                                          color: isPinned ? "#c4b5fd" : "oklch(0.45 0 0)",
                                          background: isPinned ? "color-mix(in oklab, var(--accent-violet) 20%, transparent)" : "transparent",
                                        }}
                                        onMouseEnter={e => { if (!isPinned) (e.currentTarget as HTMLButtonElement).style.color = "#c4b5fd"; }}
                                        onMouseLeave={e => { if (!isPinned) (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.45 0 0)"; }}
                                      >
                                        <Pin className="w-3.5 h-3.5" strokeWidth={2} fill={isPinned ? "#c4b5fd" : "none"} />
                                      </button>
                                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.articulo}</span>
                                    </span>
                                  </td>
                                  <td style={{ ...bottomBorder, padding: "10px 12px", color: "hsl(var(--muted-foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {row.descArticulo}
                                  </td>
                                  <td style={{ ...bottomBorder, padding: "10px 12px", color: "hsl(var(--muted-foreground) / 0.65)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {row.udmPrimaria}
                                  </td>
                                  <td style={{ ...bottomBorder, padding: "10px 12px", whiteSpace: "nowrap" }}>
                                    {(() => {
                                      const tipo = tipoOf(row.articulo);
                                      return tipo
                                        ? <TipoPill tipo={tipo} />
                                        : <span style={{ opacity: 0.25, color: "hsl(var(--muted-foreground))" }}>—</span>;
                                    })()}
                                  </td>
                                  <td style={{ ...bottomBorder, padding: "10px 12px", textAlign: "right", fontWeight: 600, color: "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums" }}>
                                    {row.total.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
                                  </td>
                                  <td style={{ ...bottomBorder }} />
                                  {zonesExpanded && visibleZonas.map(zona => {
                                    const qty = row.byZona[zona];
                                    return (
                                      <td key={zona} style={{ ...bottomBorder, padding: "10px 6px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                                        <span className={zoneAnimClass ? `${zoneAnimClass} inline-block` : undefined}>
                                          {qty != null && qty > 0
                                            ? qty.toLocaleString("es-AR", { maximumFractionDigits: 2 })
                                            : <span style={{ opacity: 0.25 }}>—</span>
                                          }
                                        </span>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                            {padBot > 0 && <tr style={{ height: padBot }}><td colSpan={colSpan} style={{ padding: 0, border: "none" }} /></tr>}
                          </>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Loaded zones — compact inline list */}
              {uploads.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap pt-1">
                  <span className="text-[12px] text-muted-foreground">Zonas cargadas:</span>
                  {uploads.map(u => (
                    <div key={u.zona} className="flex items-center gap-1.5">
                      <ZonePill zona={u.zona} small />
                      <span className="text-[11px] text-muted-foreground/70">{u.rows.length} reg.</span>
                      <button
                        onClick={() => handleDelete(u.zona)}
                        disabled={deletingZona === u.zona}
                        className="text-muted-foreground/40 hover:text-destructive transition-colors disabled:opacity-30"
                      >
                        {deletingZona === u.zona ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── CARGAR ─────────────────────────────────────────────────────────── */}
      {tab === "cargar" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
          {/* Main card */}
          <div className="rounded-[14px] p-5" style={{ background: "var(--panel-2)", border: "1px solid var(--hairline)" }}>
            {/* Card header */}
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-[16px] font-semibold tracking-tight text-foreground">Pegar datos</h3>
                <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed max-w-[520px]">
                  Copiá el contenido desde el sistema y pegalo acá. Las zonas se detectan automáticamente desde la columna{" "}
                  <span className="text-foreground/80 font-medium">Organización</span>.
                </p>
              </div>
              {text.trim() && (
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold shrink-0 mt-0.5"
                  style={{
                    background: looksOk ? "color-mix(in oklab, var(--accent-emerald-deep) 40%, transparent)" : "oklch(0.30 0.10 50 / 0.4)",
                    color: looksOk ? "var(--accent-green)" : "var(--accent-amber)",
                    border: `1px solid ${looksOk ? "color-mix(in oklab, var(--accent-emerald) 50%, transparent)" : "oklch(0.6 0.15 60 / 0.5)"}`,
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {looksOk ? `${textRowCount} filas detectadas` : "Revisar encabezado"}
                </span>
              )}
            </div>

            {/* Terminal-style textarea */}
            <div className="rounded-[10px] border border-border overflow-hidden" style={{ background: "hsl(var(--background))" }}>
              {/* macOS chrome bar */}
              <div
                className="flex items-center gap-2 px-3 py-2 border-b border-border/40"
                style={{ background: "hsl(var(--secondary) / 0.5)" }}
              >
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.60 0.15 25 / 0.65)" }} />
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.70 0.13 75 / 0.65)" }} />
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.70 0.13 145 / 0.65)" }} />
                </div>
                <span className="ml-1.5 text-[11.5px] text-muted-foreground/60">datos_pegados.tsv</span>
                <div className="flex-1" />
                <span className="text-[11px] text-muted-foreground/45 tabular-nums">
                  {text.length.toLocaleString("es-AR")} car. · {textRowCount} línea{textRowCount === 1 ? "" : "s"}
                </span>
              </div>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={"Pegá aquí el texto copiado del sistema (Ctrl+V)…\n\nDebe contener las columnas: Artículo, Desc Artículo, UDM Primaria, En Mano, Organización"}
                rows={12}
                className="w-full px-4 py-3.5 bg-transparent border-none outline-none resize-y text-foreground leading-[1.7] placeholder:text-muted-foreground/35"
                style={{
                  fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
                  fontSize: 12.5,
                }}
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2.5 mt-3.5">
              <Button
                variant="accent"
                onClick={handleImport}
                loading={saving}
                disabled={!text.trim()}
              >
                {!saving && <Download className="w-3.5 h-3.5" />}
                {saving ? "Importando..." : "Importar"}
              </Button>

              <button
                onClick={() => setText("")}
                disabled={!text}
                className="px-3.5 py-2 rounded-[9px] border border-border text-[13px] font-medium transition-colors bg-transparent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Limpiar
              </button>

              <div className="flex-1" />

              {importedAt && (
                <div className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--accent-green)" }}>
                  <CheckIcon className="w-3.5 h-3.5" strokeWidth={2.4} />
                  Importado {importedAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · {importedCount} artículos
                </div>
              )}
            </div>

            {/* Detected zones */}
            {previewZonas.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-border/40">
                <span className="text-[12px] text-muted-foreground">Zonas detectadas:</span>
                {previewZonas.map(z => <ZonePill key={z} zona={z} small />)}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-3">
            {/* Required columns */}
            <div className="rounded-[14px] p-4" style={{ background: "var(--panel-2)", border: "1px solid var(--hairline)" }}>
              <p className="text-[11px] text-muted-foreground uppercase tracking-[0.6px] mb-3">Columnas requeridas</p>
              <div className="flex flex-col gap-1.5">
                {REQUIRED_COLS.map((c, i) => {
                  const found = detectedCols?.[i]?.found;
                  const hasText = text.trim().length > 0;
                  return (
                    <div
                      key={c}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px]"
                      style={{ background: "hsl(var(--background) / 0.5)", border: "1px solid hsl(var(--border) / 0.4)" }}
                    >
                      <span
                        className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center shrink-0"
                        style={{
                          background: found
                            ? "color-mix(in oklab, var(--accent-emerald) 25%, transparent)"
                            : hasText ? "oklch(0.5 0.15 25 / 0.2)" : "hsl(var(--secondary))",
                          color: found
                            ? "var(--accent-green)"
                            : hasText ? "var(--accent-red)" : "hsl(var(--muted-foreground))",
                        }}
                      >
                        {found ? (
                          <CheckIcon className="w-3 h-3" strokeWidth={2.6} />
                        ) : hasText ? (
                          <X className="w-2.5 h-2.5" strokeWidth={2.6} />
                        ) : (
                          <span className="w-1 h-1 rounded-full bg-current" />
                        )}
                      </span>
                      <span className="text-foreground font-medium flex-1">{c}</span>
                      {found && <span className="text-[11px]" style={{ color: "var(--accent-green)" }}>detectada</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tip card */}
            <div className="rounded-[14px] p-4 text-[12.5px] text-muted-foreground leading-relaxed" style={{ background: "var(--panel-2)", border: "1px solid var(--hairline)" }}>
              <div className="flex items-center gap-1.5 text-foreground font-semibold mb-1.5 text-[13px]">
                <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
                Tip
              </div>
              Pegá directamente desde Excel o el sistema SIGA. El parser detecta tabulaciones y separadores comunes automáticamente.
            </div>
          </div>
        </div>
      )}
      </div>
      </DirectionAwareTabs>

      {/* Centro de ayuda (mismo diseño y concepto que Informe Técnico) */}
      {helpOpen && (
        <StockHelpModal
          onClose={() => setHelpOpen(false)}
          onGoCargar={() => { setHelpOpen(false); setTab("cargar"); }}
        />
      )}
    </div>
  );
}

// ─── Centro de ayuda (réplica del diseño de Informe Técnico) ──────────────────

const STOCK_HELP_META = [
  { id: "cargar",   icon: Download,    label: "Cargar datos",     color: "#60a5fa", subtitle: "Extraer de SIGA y pegar" },
  { id: "resumen",  icon: PackageOpen, label: "Resumen de stock", color: "#34d399", subtitle: "Consulta consolidada" },
] as const;

function HelpTip({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 14px", borderRadius: 9, background: "color-mix(in oklab, var(--accent-emerald-deep) 12%, transparent)", border: "1px solid color-mix(in oklab, var(--accent-emerald) 22%, transparent)", marginTop: 8 }}>
      <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--accent-green)" }} />
      <span style={{ fontSize: 13, color: "oklch(0.78 0 0)", lineHeight: 1.55 }}>{children}</span>
    </div>
  );
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        <ListChecks className="w-4 h-4" style={{ color: "oklch(0.50 0 0)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "oklch(0.50 0 0)" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function HelpAction({ label, desc }: { label: string; desc: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", paddingBottom: 8 }}>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 24, height: 22, borderRadius: 6, background: "oklch(0.28 0.005 270)", border: "1px solid oklch(1 0 0 / 0.08)", fontSize: 12, color: "oklch(0.80 0 0)", fontWeight: 600, paddingLeft: 7, paddingRight: 7, whiteSpace: "nowrap", marginTop: 1 }}>{label}</span>
      <span style={{ fontSize: 13, color: "oklch(0.68 0 0)", lineHeight: 1.5 }}>{desc}</span>
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
        <p style={{ fontSize: 14, color: "oklch(0.72 0 0)", lineHeight: 1.65, marginBottom: 4 }}>
          Extraé el inventario de una zona desde <strong>SIGA</strong> y pegalo en la pestaña <strong>«Cargar datos»</strong>. La zona se detecta sola desde la columna <em>Organización</em>.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 16 }}>
          {steps.map(s => (
            <div key={s.n} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 999, background: "#60a5fa", color: "oklch(0.12 0 0)", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{s.n}</span>
                <span style={{ fontSize: 13.5, color: "oklch(0.85 0 0)", lineHeight: 1.55, paddingTop: 1 }}>{s.text}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, border: "1px solid var(--hairline)", background: "oklch(0.11 0.005 270)", padding: 12 }}>
                <img src={s.img} alt={`Paso ${s.n}`} style={{ maxHeight: 300, maxWidth: "100%", height: "auto", display: "block", borderRadius: 6 }} />
              </div>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 999, background: "var(--accent-green)", color: "oklch(0.12 0 0)", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>6</span>
            <span style={{ fontSize: 13.5, color: "oklch(0.85 0 0)", lineHeight: 1.55, paddingTop: 1 }}>
              Volvé acá, entrá a <strong>«Cargar datos»</strong>, <strong>pegá</strong> (Ctrl+V) la tabla y tocá <strong>Importar</strong>. Podés pegar varias zonas juntas.
            </span>
          </div>
        </div>
        <HelpTip>Pegá la información tal cual viene, sin borrar columnas ni filas: el sistema limpia y consolida solo. Volver a cargar una zona <strong>reemplaza</strong> sus datos anteriores.</HelpTip>
        <button
          onClick={onGoCargar}
          style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 9, border: "none", background: "#8B5CF6", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 0 oklch(1 0 0 / 0.1) inset, 0 8px 16px -10px rgba(139,92,246,0.6)" }}
        >
          <Download className="w-3.5 h-3.5" /> Ir a Cargar datos
        </button>
      </>
    );
  }
    return (
      <>
        <p style={{ fontSize: 14, color: "oklch(0.72 0 0)", lineHeight: 1.65, marginBottom: 4 }}>
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
          <HelpAction label="Redimensionar" desc="Arrastrá el borde de una columna para cambiar su ancho. Se guarda para la próxima vez." />
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
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "oklch(0 0 0 / 0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ width: "100%", maxWidth: 860, height: "min(90vh, 660px)", display: "flex", flexDirection: "column", borderRadius: 16, overflow: "hidden", background: "oklch(0.15 0.005 270)", border: "1px solid oklch(1 0 0 / 0.09)", boxShadow: "0 24px 64px -20px oklch(0 0 0 / 0.8)" }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid var(--hairline)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 8, background: "color-mix(in oklab, var(--accent-emerald-deep) 35%, transparent)", border: "1px solid color-mix(in oklab, var(--accent-emerald) 45%, transparent)", color: "var(--accent-green)" }}>
              <HelpCircle className="w-4 h-4" />
            </div>
            <span style={{ fontSize: 17, fontWeight: 600, color: "var(--foreground)", letterSpacing: -0.3 }}>Guía de uso — Stock por Zona</span>
          </div>
          <button onClick={onClose} style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 7, background: "transparent", border: "1px solid oklch(1 0 0 / 0.08)", color: "oklch(0.60 0 0)", cursor: "pointer", transition: "color .15s, background .15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.90 0 0)"; (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.22 0.005 270)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.60 0 0)"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid oklch(1 0 0 / 0.06)", padding: "14px 10px", overflowY: "auto", background: "oklch(0.13 0.005 270)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "oklch(0.38 0 0)", padding: "0 8px 10px" }}>Temas</div>
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
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.20 0.005 270)"; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, background: isActive ? `${s.color}22` : "oklch(0.20 0.005 270)", border: `1px solid ${isActive ? s.color + "55" : "oklch(1 0 0 / 0.06)"}`, flexShrink: 0, color: isActive ? s.color : "oklch(0.45 0 0)", transition: "color .12s, border-color .12s" }}>
                    <SIcon className="w-3.5 h-3.5" />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: isActive ? "var(--foreground)" : "var(--muted-foreground)", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: isActive ? "oklch(0.55 0 0)" : "oklch(0.40 0 0)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.subtitle}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, paddingBottom: 18, borderBottom: "1px solid oklch(1 0 0 / 0.06)" }}>
              <div style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 10, background: `${current.color}18`, border: `1px solid ${current.color}44`, color: current.color, flexShrink: 0 }}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "oklch(0.42 0 0)" }}>Tema {step + 1} de {total}</span>
                  <ArrowRight className="w-3 h-3" style={{ color: "oklch(0.30 0 0)" }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: current.color, textTransform: "uppercase", letterSpacing: "0.05em" }}>{current.subtitle}</span>
                </div>
                <div style={{ fontSize: 19, fontWeight: 700, color: "var(--foreground)", letterSpacing: -0.3, marginTop: 2 }}>{current.label}</div>
              </div>
            </div>
            <StockHelpStepContent step={step} onGoCargar={onGoCargar} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderTop: "1px solid var(--hairline)", flexShrink: 0 }}>
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "1px solid oklch(1 0 0 / 0.09)", background: "oklch(0.20 0.005 270)", color: step === 0 ? "oklch(0.35 0 0)" : "oklch(0.78 0 0)", fontSize: 13, fontWeight: 500, cursor: step === 0 ? "not-allowed" : "pointer" }}
          >
            <ChevronLeft className="w-4 h-4" /> Anterior
          </button>
          <div style={{ display: "flex", gap: 5 }}>
            {STOCK_HELP_META.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => setStep(idx)}
                style={{ width: idx === step ? 20 : 7, height: 7, borderRadius: 4, border: "none", background: idx === step ? current.color : "oklch(0.30 0.005 270)", cursor: "pointer", transition: "width .2s, background .2s", padding: 0 }}
              />
            ))}
          </div>
          {step < total - 1 ? (
            <button
              onClick={() => setStep(s => Math.min(total - 1, s + 1))}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: current.color, color: "oklch(0.10 0 0)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              Siguiente <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onClose}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--accent-green)", color: "oklch(0.10 0 0)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              <Check className="w-4 h-4" /> Entendido
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
