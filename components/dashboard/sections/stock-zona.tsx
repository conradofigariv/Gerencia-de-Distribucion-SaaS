"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Trash2, Loader2, Search, X, PackageOpen, RefreshCw,
  ChevronDown, ChevronUp, ChevronsUpDown, ChevronRight,
  Download, Sparkles, Tag, Wrench, Package, Check,
} from "lucide-react";
import { CheckIcon } from "lucide-react";
import { parseTSV, saveUpload, getUploads, removeUpload, COL_MAP } from "@/lib/stockStorage";
import type { ZonaUpload, CompraRow } from "@/lib/stockStorage";
import { getFamilies, upsertFamily, deleteFamily, upsertFamiliesBulk, deleteFamiliesBulk, getMatriculasInfo } from "@/lib/stockFamilies";
import type { FamilyRow, ArticuloTipo, MatriculaInfo } from "@/lib/stockFamilies";
import { toast } from "sonner";

type Tab            = "resumen" | "cargar" | "familias";
type ArticuloFiltro = "nro" | "nombre";
type SortDir        = "asc" | "desc";

// Caché de sesión del catálogo maestro (para que la 2da carga sea instantánea)
const MATRICULAS_CACHE_KEY = "stock-zona-matriculas-cache";
// Ancho de columnas persistido (para que la lista se vea igual al volver)
const COLWIDTHS_KEY = "stock-zona-colwidths";

const TABS: { id: Tab; label: string; icon: React.ElementType; desc: string }[] = [
  { id: "resumen",  label: "Resumen de stock", icon: PackageOpen, desc: "Stock consolidado por artículo y zona de depósito." },
  { id: "cargar",   label: "Cargar datos",     icon: Download,    desc: "Importá stock pegando los datos directamente desde el sistema." },
  { id: "familias", label: "Familias",         icon: Tag,         desc: "Clasificá los artículos por familia y subfamilia." },
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
  if (tipo === "material") return { label: "Material", color: "#86efac", bg: "oklch(0.30 0.10 155 / 0.45)", border: "oklch(0.55 0.15 155 / 0.5)", Icon: Package };
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
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", update); };
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
    background: "oklch(0.205 0.005 270)",
    border: "1px solid oklch(1 0 0 / 0.07)",
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
          background: "oklch(0.16 0.005 270)",
          border: `1px solid ${open ? "oklch(0.55 0.20 295 / 0.55)" : "oklch(1 0 0 / 0.07)"}`,
          color: "oklch(0.97 0 0)", fontSize: 13,
          transition: "border-color .15s, box-shadow .15s",
          boxShadow: open ? "0 0 0 3px oklch(0.55 0.20 295 / 0.15)" : "none",
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

// ─── Main section ─────────────────────────────────────────────────────────────

export function StockZonaSection() {
  const [tab, setTab]                       = useState<Tab>("resumen");
  const [uploads, setUploads]               = useState<ZonaUpload[]>([]);
  const [loading, setLoading]               = useState(true);
  const [text, setText]                     = useState("");
  const [saving, setSaving]                 = useState(false);
  const [deletingZona, setDeletingZona]     = useState<string | null>(null);
  const [importedAt, setImportedAt]         = useState<Date | null>(null);
  const [importedCount, setImportedCount]   = useState(0);

  // Resumen state
  const [filterZona, setFilterZona]         = useState("todos");
  const [filterFamilia, setFilterFamilia]   = useState("");
  const [filterSubfamilia, setFilterSubfamilia] = useState("");
  const [filterTipo, setFilterTipo]         = useState<ArticuloTipo>("");
  const [filterSearch, setFilterSearch]     = useState("");
  const [articuloFiltro, setArticuloFiltro] = useState<ArticuloFiltro>("nro");
  const [sortCol, setSortCol]               = useState("articulo");
  const [sortDir, setSortDir]               = useState<SortDir>("asc");
  const [selectedRow, setSelectedRow]       = useState<string | null>(null);

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

  // Families tab
  const [families, setFamilies]             = useState<FamilyRow[]>([]);
  const [localEdits, setLocalEdits]         = useState<Record<string, { familia: string; subfamilia: string; tipo: ArticuloTipo }>>({});
  const [savingArticulo, setSavingArticulo] = useState<string | null>(null);
  const [familiaSearch, setFamiliaSearch]   = useState("");
  const [onlyUnclassified, setOnlyUnclassified] = useState(false);

  // Bulk assignment
  const [selectedArticulos, setSelectedArticulos] = useState<Set<string>>(new Set());
  const [bulkFamilia, setBulkFamilia]       = useState("");
  const [bulkSubfamilia, setBulkSubfamilia] = useState("");
  const [bulkTipo, setBulkTipo]             = useState<ArticuloTipo>("");
  const [applyingBulk, setApplyingBulk]     = useState(false);

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
    setFamilies(await getFamilies());
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

  useEffect(() => {
    setLocalEdits(prev => {
      const next = { ...prev };
      for (const f of families) {
        if (!next[f.articulo]) next[f.articulo] = { familia: f.familia, subfamilia: f.subfamilia, tipo: f.tipo };
      }
      return next;
    });
  }, [families]);

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

  const lastUpdate = useMemo(() => uploads.reduce<string | null>((latest, u) => {
    if (!latest || u.uploadedAt > latest) return u.uploadedAt;
    return latest;
  }, null), [uploads]);

  const familyMap = useMemo(() => new Map(families.map(f => [f.articulo, f])), [families]);

  // Tipo efectivo de una matrícula: la edición manual (Familias) tiene prioridad;
  // si no hay, sale del catálogo maestro `matriculas.mat_serv` (Carga de datos).
  const tipoOf = useCallback((articulo: string): ArticuloTipo => {
    const manual = familyMap.get(articulo)?.tipo;
    if (manual) return manual;
    return matriculasInfo.get(articulo)?.tipo ?? "";
  }, [familyMap, matriculasInfo]);

  const familiasDisponibles = useMemo(
    () => [...new Set(families.map(f => f.familia).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    [families],
  );

  // Cantidad de matrículas con familia/subfamilia asignada (asignación real).
  const asignadosCount = useMemo(
    () => families.filter(f => f.familia || f.subfamilia).length,
    [families],
  );

  const subfamiliasDisponibles = useMemo(() => [...new Set(
    families
      .filter(f => !filterFamilia || f.familia === filterFamilia)
      .map(f => f.subfamilia)
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "es")), [families, filterFamilia]);

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
    // Matrículas con familia/subfamilia asignada manualmente que aún no tienen
    // stock: se incluyen para que sean visibles (su descripción/UDM se completa
    // abajo desde el catálogo maestro).
    for (const f of families) {
      if ((f.familia || f.subfamilia) && !m.has(f.articulo)) {
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

  const pivotRows = useMemo(() => Array.from(pivotMap.values())
    .filter(r => {
      const zonaOk       = filterZona === "todos"    || (r.byZona[filterZona] ?? 0) > 0;
      const familiaOk    = !filterFamilia            || (familyMap.get(r.articulo)?.familia ?? "") === filterFamilia;
      const subfamiliaOk = !filterSubfamilia         || (familyMap.get(r.articulo)?.subfamilia ?? "") === filterSubfamilia;
      const tipoOk       = !filterTipo               || tipoOf(r.articulo) === filterTipo;
      const lo           = filterSearch.toLowerCase();
      const searchOk     = !filterSearch || (
        articuloFiltro === "nro"
          ? r.articulo.toLowerCase().includes(lo)
          : r.descArticulo.toLowerCase().includes(lo)
      );
      return zonaOk && familiaOk && subfamiliaOk && tipoOk && searchOk;
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
    }), [pivotMap, familyMap, tipoOf, filterZona, filterFamilia, filterSubfamilia, filterTipo, filterSearch, articuloFiltro, sortCol, sortDir]);

  const allArticles = useMemo(() => Array.from(pivotMap.values())
    .sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { numeric: true })), [pivotMap]);

  const filteredFamiliaArticles = useMemo(() => allArticles.filter(a => {
    if (onlyUnclassified && (familyMap.get(a.articulo)?.familia ?? "")) return false;
    if (!familiaSearch) return true;
    const lo = familiaSearch.toLowerCase();
    return a.articulo.toLowerCase().includes(lo) || a.descArticulo.toLowerCase().includes(lo);
  }), [allArticles, familiaSearch, onlyUnclassified, familyMap]);

  const subfamiliasForFamilia = (familia: string) =>
    [...new Set(families.filter(f => f.familia === familia).map(f => f.subfamilia).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es"));

  // ── Virtualización de tablas (rinde solo las filas visibles) ────────────────
  const resumenScrollRef  = useRef<HTMLDivElement>(null);
  const familiasScrollRef = useRef<HTMLDivElement>(null);

  const resumenVirtualizer = useVirtualizer({
    count: pivotRows.length,
    getScrollElement: () => resumenScrollRef.current,
    estimateSize: () => 41,
    overscan: 14,
  });
  const familiasVirtualizer = useVirtualizer({
    count: filteredFamiliaArticles.length,
    getScrollElement: () => familiasScrollRef.current,
    estimateSize: () => 46,
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

  // ── Persist one article (familia / subfamilia / tipo) ───────────────────────

  const persistRow = async (articulo: string, next: { familia: string; subfamilia: string; tipo: ArticuloTipo }) => {
    setLocalEdits(p => ({ ...p, [articulo]: next }));
    const saved = familyMap.get(articulo);
    const savedFamilia    = saved?.familia    ?? "";
    const savedSubfamilia = saved?.subfamilia ?? "";
    const savedTipo       = saved?.tipo       ?? "";
    if (next.familia.trim() === savedFamilia && next.subfamilia.trim() === savedSubfamilia && next.tipo === savedTipo) return;
    setSavingArticulo(articulo);
    const isEmpty = !next.familia.trim() && !next.subfamilia.trim() && !next.tipo;
    if (isEmpty) {
      if (saved) await deleteFamily(articulo);
    } else {
      const err = await upsertFamily({ articulo, familia: next.familia.trim(), subfamilia: next.subfamilia.trim(), tipo: next.tipo });
      if (err) { toast.error(`Error al guardar: ${err}`); setSavingArticulo(null); return; }
    }
    await refreshFamilies();
    setSavingArticulo(null);
  };

  const handleFamilyBlur = (articulo: string) => {
    const local = localEdits[articulo] ?? { familia: "", subfamilia: "", tipo: "" as ArticuloTipo };
    return persistRow(articulo, local);
  };

  // ── Bulk assignment ─────────────────────────────────────────────────────────

  const toggleSelect = (articulo: string) => {
    setSelectedArticulos(prev => {
      const next = new Set(prev);
      if (next.has(articulo)) next.delete(articulo); else next.add(articulo);
      return next;
    });
  };

  const applyBulk = async () => {
    const fam = bulkFamilia.trim();
    const sub = bulkSubfamilia.trim();
    if (!fam && !sub && !bulkTipo) { toast.error("Elegí al menos familia, subfamilia o tipo para aplicar."); return; }
    setApplyingBulk(true);
    const rows: FamilyRow[] = [...selectedArticulos].map(articulo => {
      const saved = familyMap.get(articulo);
      return {
        articulo,
        familia:    fam || saved?.familia || "",
        subfamilia: sub || saved?.subfamilia || "",
        tipo:       (bulkTipo || saved?.tipo || "") as ArticuloTipo,
      };
    }).filter(r => r.familia || r.subfamilia || r.tipo);
    const err = await upsertFamiliesBulk(rows);
    if (err) { toast.error(`Error al aplicar: ${err}`); setApplyingBulk(false); return; }
    // Reflejar en el buffer local sin esperar el refresh
    setLocalEdits(p => {
      const next = { ...p };
      for (const r of rows) next[r.articulo] = { familia: r.familia, subfamilia: r.subfamilia, tipo: r.tipo };
      return next;
    });
    await refreshFamilies();
    toast.success(`${rows.length} artículo${rows.length === 1 ? "" : "s"} actualizado${rows.length === 1 ? "" : "s"}`);
    setSelectedArticulos(new Set());
    setBulkFamilia(""); setBulkSubfamilia(""); setBulkTipo("");
    setApplyingBulk(false);
  };

  const clearBulkSelection = async (deleteRows = false) => {
    if (deleteRows && selectedArticulos.size > 0) {
      setApplyingBulk(true);
      const arts = [...selectedArticulos];
      const err = await deleteFamiliesBulk(arts);
      if (err) { toast.error(`Error al quitar: ${err}`); setApplyingBulk(false); return; }
      setLocalEdits(p => {
        const next = { ...p };
        for (const a of arts) next[a] = { familia: "", subfamilia: "", tipo: "" };
        return next;
      });
      await refreshFamilies();
      toast.success(`${arts.length} asignación${arts.length === 1 ? "" : "es"} quitada${arts.length === 1 ? "" : "s"}`);
      setApplyingBulk(false);
    }
    setSelectedArticulos(new Set());
    setBulkFamilia(""); setBulkSubfamilia(""); setBulkTipo("");
  };

  const allVisibleSelected = useMemo(
    () => filteredFamiliaArticles.length > 0 && filteredFamiliaArticles.every(a => selectedArticulos.has(a.articulo)),
    [filteredFamiliaArticles, selectedArticulos],
  );

  const toggleSelectAll = () => {
    setSelectedArticulos(prev => {
      const next = new Set(prev);
      if (filteredFamiliaArticles.length > 0 && filteredFamiliaArticles.every(a => prev.has(a.articulo))) {
        for (const a of filteredFamiliaArticles) next.delete(a.articulo);
      } else {
        for (const a of filteredFamiliaArticles) next.add(a.articulo);
      }
      return next;
    });
  };

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
      setText(""); setTab("resumen"); await refresh();
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
    TOGGLE_W + (zonesExpanded ? zonas.length * zoneWidth : 0);

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
              background: "oklch(0.30 0.10 155 / 0.45)",
              border: "1px solid oklch(0.55 0.15 155 / 0.5)",
              color: "#86efac",
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
        <button
          onClick={() => { refresh(); refreshFamilies(); refreshMatriculas(); }}
          disabled={loading}
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-accent/40 transition-colors disabled:opacity-40 mt-0.5"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Tabs — beast pure pill bar */}
      <div
        style={{
          display: "inline-flex", gap: 4, padding: 4,
          background: "oklch(0.235 0.005 270)", borderRadius: 12,
          flexWrap: "wrap", maxWidth: "100%",
        }}
      >
        {TABS.map((t, idx) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <Fragment key={t.id}>
              {idx > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", color: "oklch(0.38 0 0)", fontSize: 13, userSelect: "none", pointerEvents: "none" }}>
                  →
                </span>
              )}
              <button
                onClick={() => setTab(t.id)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  padding: "8px 14px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: isActive ? "oklch(0.27 0.005 270)" : "transparent",
                  color: isActive ? "oklch(0.97 0 0)" : "oklch(0.65 0 0)",
                  fontSize: 13, fontWeight: isActive ? 500 : 400,
                  transition: "background .15s, color .15s",
                  boxShadow: isActive ? "0 1px 0 oklch(1 0 0 / 0.06) inset" : "none",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.90 0 0)"; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.65 0 0)"; }}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={1.8} />
                {t.label}
              </button>
            </Fragment>
          );
        })}
      </div>

      {/* Content card */}
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
                {/* Zone select */}
                <BeastSelect
                  value={filterZona}
                  onChange={setFilterZona}
                  placeholder="Todas las zonas"
                  minWidth={180}
                  options={[
                    { value: "todos", label: "Todas las zonas" },
                    ...zonas.map(z => ({ value: z, label: `Zona ${z}`, node: <ZonePill zona={z} /> })),
                  ]}
                />

                {familiasDisponibles.length > 0 && (
                  <BeastSelect
                    options={familiasDisponibles.map(f => ({ value: f, label: f }))}
                    value={filterFamilia}
                    onChange={v => { setFilterFamilia(v); setFilterSubfamilia(""); }}
                    placeholder="Todas las familias"
                    clearable
                  />
                )}
                {filterFamilia && subfamiliasDisponibles.length > 0 && (
                  <BeastSelect
                    options={subfamiliasDisponibles.map(s => ({ value: s, label: s }))}
                    value={filterSubfamilia}
                    onChange={setFilterSubfamilia}
                    placeholder="Todas las subfamilias"
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

                {/* Search mode toggle */}
                <div className="inline-flex p-[3px] rounded-[9px] bg-secondary border border-border/60">
                  {([
                    { id: "nro"    as ArticuloFiltro, label: "Artículo Nro"    },
                    { id: "nombre" as ArticuloFiltro, label: "Artículo Nombre" },
                  ]).map(m => (
                    <button
                      key={m.id}
                      onClick={() => { setArticuloFiltro(m.id); setFilterSearch(""); }}
                      className="px-3 py-1 rounded-[7px] text-[12.5px] font-medium transition-colors"
                      style={{
                        background: articuloFiltro === m.id ? "#8B5CF6" : "transparent",
                        color: articuloFiltro === m.id ? "#fff" : "hsl(var(--muted-foreground))",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {/* Search input */}
                <div className="flex items-center gap-2 flex-1 min-w-[180px] h-9 px-3 rounded-lg bg-secondary border border-border">
                  <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    value={filterSearch}
                    onChange={e => setFilterSearch(e.target.value)}
                    placeholder={articuloFiltro === "nro" ? "Buscar por número…" : "Buscar por nombre…"}
                    className="flex-1 bg-transparent border-none outline-none text-[13px] text-foreground placeholder:text-muted-foreground/50"
                  />
                  {filterSearch && (
                    <button onClick={() => setFilterSearch("")} className="text-muted-foreground hover:text-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <p className="text-[12.5px] text-muted-foreground whitespace-nowrap flex items-center gap-1.5">
                  <span><span className="text-foreground font-medium">{pivotRows.length}</span> de {pivotMap.size} artículos</span>
                  {matriculasLoading && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground/70">
                      · <Loader2 className="w-3 h-3 animate-spin" /> catálogo…
                    </span>
                  )}
                </p>
              </div>

              {/* Pivot table */}
              <div className="rounded-[14px] overflow-hidden" style={{ background: "oklch(0.205 0.005 270)", border: "1px solid oklch(1 0 0 / 0.07)" }}>
                <div ref={resumenScrollRef} className="overflow-auto" style={{ maxHeight: "70vh" }}>
                  <table
                    style={zonesExpanded
                      ? { tableLayout: "fixed", width: "100%", minWidth: tableWidth, borderCollapse: "separate", borderSpacing: 0, fontSize: 13.5 }
                      : { tableLayout: "fixed", width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13.5 }}
                  >
                    <colgroup>
                      {fixedCols.map(c => <col key={c.col} style={{ width: c.w }} />)}
                      <col style={{ width: TOGGLE_W }} />
                      {zonesExpanded && zonas.map(z => <col key={z} style={{ width: zoneWidth }} />)}
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
                                background: "oklch(0.255 0.006 270)",
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
                            background: "oklch(0.255 0.006 270)",
                          }}
                        >
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${zonesExpanded ? "rotate-180" : ""}`} />
                            {!zonesExpanded && zonas.length > 0 && (
                              <span className="text-[11px] font-normal normal-case tracking-normal">{zonas.length} zona{zonas.length !== 1 ? "s" : ""}</span>
                            )}
                          </span>
                        </th>
                        {zonesExpanded && zonas.map(zona => {
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
                                background: "oklch(0.255 0.006 270)",
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
                            colSpan={fixedCols.length + 1 + (zonesExpanded ? zonas.length : 0)}
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
                        const colSpan = fixedCols.length + 1 + (zonesExpanded ? zonas.length : 0);
                        return (
                          <>
                            {padTop > 0 && <tr style={{ height: padTop }}><td colSpan={colSpan} style={{ padding: 0, border: "none" }} /></tr>}
                            {vItems.map(vi => {
                              const row = pivotRows[vi.index];
                              const isSelected = selectedRow === row.articulo;
                              const isLast = vi.index === pivotRows.length - 1;
                              const bottomBorder = isLast ? {} : { borderBottom: cellBorder };
                              return (
                                <tr
                                  key={row.articulo}
                                  onClick={() => setSelectedRow(isSelected ? null : row.articulo)}
                                  style={{ cursor: "pointer", background: isSelected ? "oklch(0.55 0.20 295 / 0.15)" : undefined, transition: "background 0.1s" }}
                                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "hsl(var(--secondary) / 0.35)"; }}
                                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = ""; }}
                                >
                                  <td style={{ ...bottomBorder, padding: "10px 12px 10px 14px", fontFamily: "ui-monospace, monospace", fontSize: 12.5, color: "#7ee2a8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {row.articulo}
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
                                  {zonesExpanded && zonas.map(zona => {
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
          <div className="rounded-[14px] p-5" style={{ background: "oklch(0.205 0.005 270)", border: "1px solid oklch(1 0 0 / 0.07)" }}>
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
                    background: looksOk ? "oklch(0.30 0.10 155 / 0.4)" : "oklch(0.30 0.10 50 / 0.4)",
                    color: looksOk ? "#86efac" : "#fcd34d",
                    border: `1px solid ${looksOk ? "oklch(0.55 0.15 155 / 0.5)" : "oklch(0.6 0.15 60 / 0.5)"}`,
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
              <button
                onClick={handleImport}
                disabled={saving || !text.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-[9px] text-[13px] font-semibold transition-all disabled:cursor-not-allowed"
                style={{
                  background: (saving || !text.trim()) ? "hsl(var(--secondary))" : "#8B5CF6",
                  color: (saving || !text.trim()) ? "hsl(var(--muted-foreground))" : "#fff",
                  border: "none",
                  boxShadow: (!saving && text.trim()) ? "0 1px 0 rgba(255,255,255,0.1) inset, 0 8px 16px -10px rgba(139,92,246,0.6)" : "none",
                }}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {saving ? "Importando..." : "Importar"}
              </button>

              <button
                onClick={() => setText("")}
                disabled={!text}
                className="px-3.5 py-2 rounded-[9px] border border-border text-[13px] font-medium transition-colors bg-transparent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Limpiar
              </button>

              <div className="flex-1" />

              {importedAt && (
                <div className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "#86efac" }}>
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
            <div className="rounded-[14px] p-4" style={{ background: "oklch(0.205 0.005 270)", border: "1px solid oklch(1 0 0 / 0.07)" }}>
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
                            ? "oklch(0.55 0.15 155 / 0.25)"
                            : hasText ? "oklch(0.5 0.15 25 / 0.2)" : "hsl(var(--secondary))",
                          color: found
                            ? "#86efac"
                            : hasText ? "#fca5a5" : "hsl(var(--muted-foreground))",
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
                      {found && <span className="text-[11px]" style={{ color: "#86efac" }}>detectada</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tip card */}
            <div className="rounded-[14px] p-4 text-[12.5px] text-muted-foreground leading-relaxed" style={{ background: "oklch(0.205 0.005 270)", border: "1px solid oklch(1 0 0 / 0.07)" }}>
              <div className="flex items-center gap-1.5 text-foreground font-semibold mb-1.5 text-[13px]">
                <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
                Tip
              </div>
              Pegá directamente desde Excel o el sistema SIGA. El parser detecta tabulaciones y separadores comunes automáticamente.
            </div>
          </div>
        </div>
      )}

      {/* ── FAMILIAS ───────────────────────────────────────────────────────── */}
      {tab === "familias" && (
        <div className="space-y-4">
          {pivotMap.size === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground">
              <Tag className="w-12 h-12 opacity-30" />
              <p className="text-sm">Primero cargá datos de stock para poder asignar familias.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm h-9 px-3 rounded-lg bg-secondary border border-border">
                  <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    value={familiaSearch}
                    onChange={e => setFamiliaSearch(e.target.value)}
                    placeholder="Buscar artículo..."
                    className="flex-1 bg-transparent border-none outline-none text-[13px] text-foreground placeholder:text-muted-foreground/50"
                  />
                  {familiaSearch && (
                    <button onClick={() => setFamiliaSearch("")} className="text-muted-foreground hover:text-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => setOnlyUnclassified(v => !v)}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-medium transition-colors"
                  style={{
                    background: onlyUnclassified ? "#8B5CF6" : "hsl(var(--secondary))",
                    color: onlyUnclassified ? "#fff" : "hsl(var(--muted-foreground))",
                    border: `1px solid ${onlyUnclassified ? "transparent" : "hsl(var(--border))"}`,
                    cursor: "pointer",
                  }}
                >
                  <Tag className="w-3.5 h-3.5" />
                  Sin clasificar
                </button>

                <p className="text-[12.5px] text-muted-foreground whitespace-nowrap">
                  {filteredFamiliaArticles.length} de {allArticles.length} artículos
                  {asignadosCount > 0 && <> · <span className="text-accent">{asignadosCount} asignados</span></>}
                </p>
              </div>

              {/* Barra de asignación masiva */}
              {selectedArticulos.size > 0 && (
                <div
                  className="flex items-center gap-2.5 flex-wrap rounded-[12px] p-3"
                  style={{ background: "oklch(0.27 0.04 295 / 0.35)", border: "1px solid oklch(0.55 0.20 295 / 0.45)" }}
                >
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground shrink-0">
                    <span
                      className="inline-flex items-center justify-center rounded-md"
                      style={{ width: 22, height: 22, background: "#8B5CF6", color: "#fff", fontSize: 12, fontWeight: 700 }}
                    >
                      {selectedArticulos.size}
                    </span>
                    seleccionados
                  </span>

                  <input
                    type="text"
                    list="familias-list"
                    value={bulkFamilia}
                    onChange={e => setBulkFamilia(e.target.value)}
                    placeholder="Familia…"
                    className="h-9 px-3 rounded-lg bg-secondary border border-border text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent/40"
                    style={{ minWidth: 150 }}
                  />
                  <input
                    type="text"
                    value={bulkSubfamilia}
                    onChange={e => setBulkSubfamilia(e.target.value)}
                    placeholder="Subfamilia…"
                    className="h-9 px-3 rounded-lg bg-secondary border border-border text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent/40"
                    style={{ minWidth: 150 }}
                  />
                  <BeastSelect
                    options={TIPO_OPTIONS.map(t => ({ value: t.value, label: t.label, node: <TipoPill tipo={t.value} /> }))}
                    value={bulkTipo}
                    onChange={v => setBulkTipo(v as ArticuloTipo)}
                    placeholder="Tipo…"
                    minWidth={150}
                    clearable
                  />

                  <button
                    onClick={applyBulk}
                    disabled={applyingBulk}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold transition-all disabled:opacity-50"
                    style={{ background: "#8B5CF6", color: "#fff", border: "none", cursor: applyingBulk ? "wait" : "pointer" }}
                  >
                    {applyingBulk ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" strokeWidth={2.6} />}
                    Aplicar
                  </button>

                  <div className="flex-1" />

                  <button
                    onClick={() => clearBulkSelection(true)}
                    disabled={applyingBulk}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-medium transition-colors disabled:opacity-50"
                    style={{ background: "transparent", color: "#fca5a5", border: "1px solid oklch(0.5 0.15 25 / 0.4)", cursor: "pointer" }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Quitar asignación
                  </button>
                  <button
                    onClick={() => clearBulkSelection(false)}
                    disabled={applyingBulk}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    style={{ background: "transparent", border: "1px solid hsl(var(--border))", cursor: "pointer" }}
                  >
                    Cancelar
                  </button>
                </div>
              )}

              <datalist id="familias-list">
                {familiasDisponibles.map(f => <option key={f} value={f} />)}
              </datalist>

              <div className="rounded-[14px] overflow-hidden" style={{ background: "oklch(0.205 0.005 270)", border: "1px solid oklch(1 0 0 / 0.07)" }}>
                <div ref={familiasScrollRef} className="overflow-auto" style={{ maxHeight: "70vh" }}>
                  <table className="text-sm" style={{ tableLayout: "fixed", width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                    <colgroup>
                      <col style={{ width: 44 }} />
                      <col style={{ width: 130 }} />
                      <col />
                      <col style={{ width: 160 }} />
                      <col style={{ width: 160 }} />
                      <col style={{ width: 160 }} />
                      <col style={{ width: 32 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={{ padding: "14px 0 14px 14px", width: 44, position: "sticky", top: 0, zIndex: 2, background: "oklch(0.255 0.006 270)", borderBottom: "1px solid hsl(var(--border))" }}>
                          <button
                            onClick={toggleSelectAll}
                            title={allVisibleSelected ? "Deseleccionar todo" : "Seleccionar todo"}
                            className="inline-flex items-center justify-center rounded-[5px] transition-colors"
                            style={{
                              width: 18, height: 18,
                              background: allVisibleSelected ? "#8B5CF6" : "transparent",
                              border: `1.5px solid ${allVisibleSelected ? "#8B5CF6" : "hsl(var(--border))"}`,
                              color: "#fff", cursor: "pointer",
                            }}
                          >
                            {allVisibleSelected && <Check className="w-3 h-3" strokeWidth={3} />}
                          </button>
                        </th>
                        <th style={{ padding: "14px 14px", textAlign: "left", fontSize: 13, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", width: 130, position: "sticky", top: 0, zIndex: 2, background: "oklch(0.255 0.006 270)", borderBottom: "1px solid hsl(var(--border))" }}>Matrícula</th>
                        <th style={{ padding: "14px 12px", textAlign: "left", fontSize: 13, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", position: "sticky", top: 0, zIndex: 2, background: "oklch(0.255 0.006 270)", borderBottom: "1px solid hsl(var(--border))" }}>Descripción</th>
                        <th style={{ padding: "14px 12px", textAlign: "left", fontSize: 13, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", width: 160, position: "sticky", top: 0, zIndex: 2, background: "oklch(0.255 0.006 270)", borderBottom: "1px solid hsl(var(--border))" }}>Familia</th>
                        <th style={{ padding: "14px 12px", textAlign: "left", fontSize: 13, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", width: 160, position: "sticky", top: 0, zIndex: 2, background: "oklch(0.255 0.006 270)", borderBottom: "1px solid hsl(var(--border))" }}>Subfamilia</th>
                        <th style={{ padding: "14px 12px", textAlign: "left", fontSize: 13, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", width: 160, position: "sticky", top: 0, zIndex: 2, background: "oklch(0.255 0.006 270)", borderBottom: "1px solid hsl(var(--border))" }}>Tipo</th>
                        <th style={{ width: 32, position: "sticky", top: 0, zIndex: 2, background: "oklch(0.255 0.006 270)", borderBottom: "1px solid hsl(var(--border))" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFamiliaArticles.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ padding: "48px 24px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
                            No hay artículos que coincidan con la búsqueda
                          </td>
                        </tr>
                      ) : (() => {
                        const vItems = familiasVirtualizer.getVirtualItems();
                        const totalH = familiasVirtualizer.getTotalSize();
                        const padTop = vItems.length ? vItems[0].start : 0;
                        const padBot = vItems.length ? totalH - vItems[vItems.length - 1].end : 0;
                        return (
                          <>
                            {padTop > 0 && <tr style={{ height: padTop }}><td colSpan={7} style={{ padding: 0, border: "none" }} /></tr>}
                            {vItems.map(vi => {
                        const row = filteredFamiliaArticles[vi.index];
                        const edit    = localEdits[row.articulo] ?? { familia: "", subfamilia: "", tipo: "" as ArticuloTipo };
                        const isSaving   = savingArticulo === row.articulo;
                        const hasFamily  = !!(familyMap.get(row.articulo)?.familia);
                        // Tipo del catálogo maestro (Carga de datos); el manual lo pisa.
                        const catalogTipo = matriculasInfo.get(row.articulo)?.tipo ?? "";
                        const isSelected = selectedArticulos.has(row.articulo);
                        const subfamiliasList = edit.familia ? subfamiliasForFamilia(edit.familia) : [];
                        const isLast = vi.index === filteredFamiliaArticles.length - 1;
                        const bottomBorder = isLast ? {} : { borderBottom: cellBorder };

                        return (
                          <tr
                            key={row.articulo}
                            style={{ opacity: hasFamily || isSelected ? 1 : 0.6, transition: "opacity 0.15s", background: isSelected ? "oklch(0.55 0.20 295 / 0.12)" : undefined }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = "1"; if (!isSelected) e.currentTarget.style.background = "hsl(var(--secondary) / 0.3)"; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = hasFamily || isSelected ? "1" : "0.6"; e.currentTarget.style.background = isSelected ? "oklch(0.55 0.20 295 / 0.12)" : ""; }}
                          >
                            <td style={{ ...bottomBorder, padding: "0 0 0 14px", textAlign: "center" }}>
                              <button
                                onClick={() => toggleSelect(row.articulo)}
                                className="inline-flex items-center justify-center rounded-[5px] transition-colors"
                                style={{
                                  width: 18, height: 18,
                                  background: isSelected ? "#8B5CF6" : "transparent",
                                  border: `1.5px solid ${isSelected ? "#8B5CF6" : "hsl(var(--border))"}`,
                                  color: "#fff", cursor: "pointer",
                                }}
                              >
                                {isSelected && <Check className="w-3 h-3" strokeWidth={3} />}
                              </button>
                            </td>
                            <td style={{ ...bottomBorder, padding: "9px 14px", fontFamily: "ui-monospace, monospace", fontSize: 12.5, color: "#7ee2a8", whiteSpace: "nowrap" }}>{row.articulo}</td>
                            <td style={{ ...bottomBorder, padding: "9px 12px", color: "hsl(var(--foreground))", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>{row.descArticulo}</td>
                            <td style={{ ...bottomBorder, padding: "6px 8px" }}>
                              {isSaving ? (
                                <div className="flex items-center gap-1.5 h-8 px-2 text-xs text-muted-foreground">
                                  <Loader2 className="w-3 h-3 animate-spin" />Guardando...
                                </div>
                              ) : (
                                <>
                                  <datalist id={`sub-${row.articulo}`}>
                                    {subfamiliasList.map(s => <option key={s} value={s} />)}
                                  </datalist>
                                  <input
                                    type="text"
                                    list="familias-list"
                                    value={edit.familia}
                                    onChange={e => setLocalEdits(p => ({ ...p, [row.articulo]: { ...(p[row.articulo] ?? { familia: "", subfamilia: "", tipo: "" as ArticuloTipo }), familia: e.target.value } }))}
                                    onBlur={() => handleFamilyBlur(row.articulo)}
                                    placeholder="Sin familia"
                                    className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent/30 transition-all"
                                  />
                                </>
                              )}
                            </td>
                            <td style={{ ...bottomBorder, padding: "6px 8px" }}>
                              {!isSaving && (
                                <input
                                  type="text"
                                  list={`sub-${row.articulo}`}
                                  value={edit.subfamilia}
                                  onChange={e => setLocalEdits(p => ({ ...p, [row.articulo]: { ...(p[row.articulo] ?? { familia: "", subfamilia: "", tipo: "" as ArticuloTipo }), subfamilia: e.target.value } }))}
                                  onBlur={() => handleFamilyBlur(row.articulo)}
                                  placeholder="—"
                                  disabled={!edit.familia}
                                  className="w-full h-8 px-2 rounded-md bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent/30 transition-all disabled:opacity-30"
                                />
                              )}
                            </td>
                            <td style={{ ...bottomBorder, padding: "6px 8px" }}>
                              {!isSaving && (
                                <BeastSelect
                                  options={TIPO_OPTIONS.map(t => ({ value: t.value, label: t.label, node: <TipoPill tipo={t.value} /> }))}
                                  value={edit.tipo || catalogTipo}
                                  onChange={v => persistRow(row.articulo, { ...edit, tipo: v as ArticuloTipo })}
                                  placeholder="—"
                                  minWidth={140}
                                  clearable
                                  portal
                                />
                              )}
                            </td>
                            <td style={{ ...bottomBorder, padding: "6px 4px", textAlign: "center" }}>
                              {hasFamily && !isSaving && (
                                <button
                                  onClick={async () => {
                                    setSavingArticulo(row.articulo);
                                    await deleteFamily(row.articulo);
                                    setLocalEdits(p => ({ ...p, [row.articulo]: { familia: "", subfamilia: "", tipo: "" } }));
                                    await refreshFamilies();
                                    setSavingArticulo(null);
                                  }}
                                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                            })}
                            {padBot > 0 && <tr style={{ height: padBot }}><td colSpan={7} style={{ padding: 0, border: "none" }} /></tr>}
                          </>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Tildá varios artículos para asignar familia, subfamilia o tipo en lote. Los cambios individuales se guardan al salir del campo. Dejá Familia vacía para quitar la asignación.
              </p>
            </>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
