"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  DataSheetGrid,
  createTextColumn,
  keyColumn,
  type Column,
  type ContextMenuComponentProps,
  type ContextMenuItem,
} from "react-datasheet-grid";
import "react-datasheet-grid/dist/style.css";
import { Loader2, Save, RefreshCw, Plus, SlidersHorizontal, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { loadTableLayout, saveTableLayout } from "@/lib/tableLayout";
import {
  parseNum, getRows, saveRows, deleteRow, getMetas, saveMetas, DEFAULT_METAS,
} from "@/lib/idoStorage";
import type { IdoRow, IdoMetas } from "@/lib/idoStorage";

// ── Meta fields ───────────────────────────────────────────────────────────────
const META_FIELDS: { key: keyof IdoMetas; label: string; calc?: boolean }[] = [
  { key: "fmikS1", label: "FMIK S1 ≤", calc: true },
  { key: "fmikS2", label: "FMIK S2 ≤", calc: true },
  { key: "dmikS1", label: "DMIK S1 ≤", calc: true },
  { key: "dmikS2", label: "DMIK S2 ≤", calc: true },
  { key: "povaTransferido", label: "Objetivo POVA (%)", calc: true },
  { key: "povaFinObra", label: "POVA Fin de obra (%)" },
  { key: "povaCreados", label: "POVA Creados/demás =" },
];

const metaToInputs = (m: IdoMetas): Record<keyof IdoMetas, string> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)])) as Record<keyof IdoMetas, string>;

// ── Grid data type ────────────────────────────────────────────────────────────
// Flat row: all string (raw input). Fields prefixed _ are computed, not persisted.
type DsgRow = {
  zona: string;
  fmik_s1: string; fmik_s2: string; dmik_s1: string; dmik_s2: string;
  pova_transferido: string; pova_fin_obra: string; pova_creadas: string; pova_total: string;
  _pova_ejecutado: string; _pova_resultado: string;
  mant_poda_bt: string; mant_poda_mt: string; mant_termografia: string;
  _mant_promedio: string;
};

const EDITABLE_FIELDS: (keyof DsgRow)[] = [
  "fmik_s1", "fmik_s2", "dmik_s1", "dmik_s2",
  "pova_transferido", "pova_fin_obra", "pova_creadas", "pova_total",
  "mant_poda_bt", "mant_poda_mt", "mant_termografia",
];

const POVA_OBJ = 95;

// ── Layout de columnas — pisos reales por tipo (design-system.md §4.18) ───────
// `sep` marca el inicio de un bloque (línea vertical + etiqueta de grupo arriba).
// `width` es el PISO real por tipo de dato, no un ancho fijo arbitrario:
// 88px numérica con decimales (FMIK/DMIK/poda/termografía) · 76px numérica
// corta sin decimales (conteos de obras) · 84px porcentaje calculado.
const ZONA_W = 56;
type ColSpec = {
  key: keyof DsgRow; label: string; width: number;
  group?: string; sep?: boolean; calc?: boolean;
};
const COLS: ColSpec[] = [
  { key: "fmik_s1", label: "FMIK S1", width: 88, group: "Técnico", sep: true },
  { key: "fmik_s2", label: "FMIK S2", width: 88 },
  { key: "dmik_s1", label: "DMIK S1", width: 88 },
  { key: "dmik_s2", label: "DMIK S2", width: 88 },
  { key: "pova_transferido", label: "Transferido", width: 76, group: "POVA", sep: true },
  { key: "pova_fin_obra", label: "Fin de obra", width: 76 },
  { key: "pova_creadas", label: "Creadas", width: 76 },
  { key: "pova_total", label: "Total obras", width: 76 },
  { key: "_pova_ejecutado", label: "Ejecutado", width: 84, calc: true },
  { key: "_pova_resultado", label: "Result. s/ Obj", width: 84, calc: true },
  { key: "mant_poda_bt", label: "Poda BT", width: 88, group: "Mantenimiento", sep: true },
  { key: "mant_poda_mt", label: "Poda MT", width: 88 },
  { key: "mant_termografia", label: "Termografía", width: 88 },
  { key: "_mant_promedio", label: "Mantenimiento", width: 84, calc: true },
];

const ROW_H_NORMAL = 52;
const HEADER_H_NORMAL = 34;
const ROW_H_COMPACT = 32;
const HEADER_H_COMPACT = 32;
// Modo compacto (design-system.md §4.18, paso 2): cada columna se angosta
// ~8px (padding de celda 12px→8px) cuando la suma de pisos reales no entra.
const COMPACT_SHRINK = 8;

// ─── Ajuste de ancho al viewport (design-system.md §4.17) ────────────────────
// Identificadora (Zona) y columnas editables (referencias cortas) quedan
// fijas; las 3 calculadas absorben el sobrante en partes iguales, y
// Mantenimiento (columna de cierre del bloque) al doble. Ninguna crece más
// del doble de su ancho natural — el excedente pasa a padding lateral.
const ALL_COL_KEYS: (keyof DsgRow)[] = ["zona", ...COLS.map((c) => c.key)];
const NATURAL_W: Record<string, number> = { zona: ZONA_W, ...Object.fromEntries(COLS.map((c) => [c.key, c.width])) };
const POOL_KEYS = new Set(["_pova_ejecutado", "_pova_resultado", "_mant_promedio"]);
const CLOSING_KEY = "_mant_promedio";
const SUM_REAL = ALL_COL_KEYS.reduce((a, k) => a + NATURAL_W[k], 0);
const SUM_COMPACT = SUM_REAL - ALL_COL_KEYS.length * COMPACT_SHRINK;

// ─── Persistencia de layout (design-system.md — sección 07) ─────────────────
// Solo lo que existe hoy en este módulo: ancho de columna redimensionado a
// mano. Selección/celda activa/scroll/filtros no aplican aquí (grilla de
// edición, no de selección de filas) y quedan fuera de todos modos.
const TABLE_ID = "indiceIdoCarga";
const KNOWN_COL_IDS = new Set<string>(ALL_COL_KEYS);

const numColumn = createTextColumn({});

function computeRow(row: DsgRow): DsgRow {
  const t = parseNum(row.pova_transferido);
  const f = parseNum(row.pova_fin_obra);
  const tot = parseNum(row.pova_total);
  let ejec: number | null = null;
  if (t !== null && f !== null && tot !== null && tot > 0)
    ejec = ((t + f) / tot) * 100;
  const result = ejec !== null ? Math.min(100, (ejec / POVA_OBJ) * 100) : null;

  const bt = parseNum(row.mant_poda_bt);
  const mt = parseNum(row.mant_poda_mt);
  const termo = parseNum(row.mant_termografia);
  const allNull = bt === null && mt === null && termo === null;
  // Siempre divide por 3 (faltantes = 0)
  const prom = allNull ? null : ((bt ?? 0) + (mt ?? 0) + (termo ?? 0)) / 3;

  return {
    ...row,
    _pova_ejecutado: ejec !== null ? `${ejec.toFixed(1)}%` : "",
    _pova_resultado: result !== null ? `${result.toFixed(1)}%` : "",
    _mant_promedio: prom !== null ? `${prom.toFixed(1)}%` : "",
  };
}

function emptyDsgRow(zona: string): DsgRow {
  return {
    zona,
    fmik_s1: "", fmik_s2: "", dmik_s1: "", dmik_s2: "",
    pova_transferido: "", pova_fin_obra: "", pova_creadas: "", pova_total: "",
    _pova_ejecutado: "", _pova_resultado: "",
    mant_poda_bt: "", mant_poda_mt: "", mant_termografia: "",
    _mant_promedio: "",
  };
}

function idoRowToDsg(r: IdoRow): DsgRow {
  const raw = emptyDsgRow(r.zona);
  for (const f of EDITABLE_FIELDS) {
    const v = (r as unknown as Record<string, number | null>)[f as string];
    (raw as unknown as Record<string, string>)[f as string] = v !== null && v !== undefined ? String(v) : "";
  }
  return computeRow(raw);
}

function dsgToIdoRow(periodo: string, r: DsgRow): IdoRow | null {
  const parsed: Record<string, number | null> = {};
  let hasData = false;
  for (const f of EDITABLE_FIELDS) {
    const n = parseNum((r as unknown as Record<string, string>)[f as string] ?? "");
    parsed[f as string] = n;
    if (n !== null) hasData = true;
  }
  if (!hasData) return null;
  return { periodo, zona: r.zona, ...parsed } as unknown as IdoRow;
}

const DEFAULT_ZONAS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

// ── Menú contextual (botón secundario) ────────────────────────────────────────
// Reemplaza el menú por defecto de DSG: mismas acciones de la librería
// (copiar / pegar / duplicar / eliminar) más dos propias que se resuelven
// contra el estado del grid (limpiar celda y rellenar hacia abajo).
type MenuIcon = "copy" | "paste" | "clear" | "fill" | "dup" | "del";

const ICON_PATHS: Record<MenuIcon, React.ReactNode> = {
  copy: <><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5V3a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3v5.5A1.5 1.5 0 0 0 3.5 10H4" /></>,
  paste: <><rect x="3.5" y="3" width="9" height="11" rx="1.5" /><path d="M6 3V2.2c0-.4.3-.7.7-.7h2.6c.4 0 .7.3.7.7V3" /></>,
  clear: <><path d="M14 12.5H6.5L2 8l4.5-4.5H14z" /><path d="M8.5 6.5l3 3M11.5 6.5l-3 3" /></>,
  fill: <><path d="M8 2.5v11" /><path d="M4.5 10L8 13.5 11.5 10" /></>,
  dup: <><rect x="2" y="4.5" width="9" height="3" rx="1" /><rect x="2" y="9" width="9" height="3" rx="1" /><path d="M13.5 6.5v3" /></>,
  del: <><path d="M3 5h10" /><path d="M4.5 5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9L11.5 5" /><path d="M6.5 5V3.6c0-.3.3-.6.6-.6h1.8c.3 0 .6.3.6.6V5" /></>,
};

function MenuRow({ icon, label, shortcut, danger, onClick }: {
  icon: MenuIcon; label: string; shortcut: string; danger?: boolean; onClick: () => void;
}) {
  return (
    <div className={`ido-menu-item${danger ? " ido-menu-item-danger" : ""}`} onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" style={{ opacity: 0.5 }}>
        {ICON_PATHS[icon]}
      </svg>
      <span style={{ flex: 1 }}>{label}</span>
      <span className="ido-menu-shortcut">{shortcut}</span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export function IndiceIdoCargaSection() {
  const [periodo, setPeriodo] = useState(String(new Date().getFullYear()));
  const [grid, setGrid] = useState<DsgRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newZona, setNewZona] = useState("");
  const [metaInputs, setMetaInputs] = useState<Record<keyof IdoMetas, string>>(metaToInputs(DEFAULT_METAS));
  const [metasOpen, setMetasOpen] = useState(false);
  const [metasSaving, setMetasSaving] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [syncAt, setSyncAt] = useState<Date | null>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const resizeScrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<DsgRow[]>([]);
  gridRef.current = grid;

  // Usuario actual (namespacea la persistencia de layout por cuenta)
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Anchos de columna ajustables a mano — salen del reparto automático
  const [colW, setColW] = useState<Record<string, number>>({});
  const colWRef = useRef(colW);
  useEffect(() => { colWRef.current = colW; }, [colW]);
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizing = useRef<{ id: string; startX: number; startW: number } | null>(null);

  // "Restablecer vista": confirmación temporal (1.5 s)
  const [resetMsg, setResetMsg] = useState(false);
  const resetMsgT = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetMsgT.current) clearTimeout(resetMsgT.current); }, []);

  // Ancho real del contenedor de la grilla (para el reparto automático)
  const gridWrapRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Resolución de desborde (design-system.md §4.18): se evalúa ANTES del
  // reparto de sobrante. Paso 1, pisos reales, ya está en NATURAL_W/COLS.
  // Paso 2: si ni así entra, modo compacto (fila/header más bajos, cada
  // columna ~8px más angosta). Paso 3: si ni compacto entra, la columna de
  // cierre (Mantenimiento) se ancla a la derecha vía stickyRightColumn de la
  // librería y solo las columnas del medio scrollean.
  const compact = containerW > 0 && containerW < SUM_REAL;
  const scrollAnchored = compact && containerW < SUM_COMPACT;
  const ROW_H = compact ? ROW_H_COMPACT : ROW_H_NORMAL;
  const HEADER_H = compact ? HEADER_H_COMPACT : HEADER_H_NORMAL;
  // Columnas que renderiza la grilla "del medio" — excluye la de cierre
  // cuando está anclada a la derecha (stickyRightColumn).
  const midCols = useMemo(() => (scrollAnchored ? COLS.filter((c) => c.key !== CLOSING_KEY) : COLS), [scrollAnchored]);

  const [scrolledRight, setScrolledRight] = useState(true);

  // react-datasheet-grid no re-renderiza sus columnas cuando `basis` cambia
  // en caliente (solo lo toma en cuenta al montar) — confirmado con la
  // grilla en vivo: el estado de React se actualiza perfecto, pero el DOM
  // de la librería queda con el ancho viejo. Única salida sin tocar la
  // librería: forzar un remount (key) cuando el ancho efectivo cambia.
  const [dsgKey, setDsgKey] = useState(0);
  const bumpDsgKey = useCallback(() => setDsgKey((k) => k + 1), []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const r = resizing.current;
      if (!r) return;
      // Piso real por columna (§4.18), no el genérico de 64px.
      const floor = NATURAL_W[r.id] ?? 64;
      const w = Math.max(floor, r.startW + (e.clientX - r.startX));
      setColW((p) => ({ ...p, [r.id]: w }));
    }
    function onUp() {
      if (!resizing.current) return;
      resizing.current = null;
      setResizingCol(null);
      if (userIdRef.current) saveTableLayout(userIdRef.current, TABLE_ID, { colW: colWRef.current });
      bumpDsgKey();
    }
    // Captura, no burbujeo: react-datasheet-grid tiene su propio manejo de
    // mouse para la selección de celdas y puede frenar la propagación del
    // mouseup si soltás el clic sobre una celda de la grilla (muy fácil con
    // un handle de 8px). En fase de captura, este handler se dispara antes
    // de que la librería tenga chance de interceptarlo — si no, el resize
    // queda "trabado" con la guía verde pegada en pantalla.
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
    return () => { window.removeEventListener("mousemove", onMove, true); window.removeEventListener("mouseup", onUp, true); };
  }, [bumpDsgKey]);

  // Ídem para el resize de ventana/sidebar (§4.17): el ancho efectivo puede
  // cambiar sin que haya un mouseup de por medio. Debounced para no
  // remontar la grilla en cada tick del ResizeObserver durante un drag de
  // ventana en vivo.
  useEffect(() => {
    const t = setTimeout(bumpDsgKey, 200);
    return () => clearTimeout(t);
  }, [containerW, bumpDsgKey]);

  // Hidrata el ancho guardado para este usuario y esta tabla. Referencias a
  // columnas que ya no existen se descartan en silencio.
  useEffect(() => {
    if (!userId) return;
    const saved = loadTableLayout(userId, TABLE_ID).colW;
    if (!saved) return;
    const known: Record<string, number> = {};
    for (const [k, v] of Object.entries(saved)) {
      if (KNOWN_COL_IDS.has(k) && typeof v === "number") known[k] = v;
    }
    if (Object.keys(known).length) setColW(known);
  }, [userId]);

  function resetLayout() {
    setColW({});
    if (userId) saveTableLayout(userId, TABLE_ID, { colW: null });
    setResetMsg(true);
    if (resetMsgT.current) clearTimeout(resetMsgT.current);
    resetMsgT.current = setTimeout(() => setResetMsg(false), 1500);
    bumpDsgKey();
  }

  // Columnas manuales (fuera del reparto automático) y reparto del sobrante:
  // las 3 calculadas absorben en partes iguales, Mantenimiento (cierre) al
  // doble; ninguna crece más de 2× su ancho natural; el resto va a padding.
  const manualCols = useMemo(() => new Set(Object.keys(colW)), [colW]);
  const isAbsorber = useCallback((key: string) => POOL_KEYS.has(key) && !manualCols.has(key), [manualCols]);

  const fitted = useMemo(() => {
    const natural: Record<string, number> = {};
    for (const key of ALL_COL_KEYS) {
      natural[key] = manualCols.has(key) ? colW[key] : NATURAL_W[key] - (compact ? COMPACT_SHRINK : 0);
    }
    const pool: string[] = ALL_COL_KEYS.filter((k) => isAbsorber(k));
    const weight = (k: string) => (k === CLOSING_KEY ? 2 : 1);
    const out: Record<string, number> = { ...natural };
    const sumNatural = ALL_COL_KEYS.reduce((a, k) => a + natural[k], 0);
    let rest = Math.max(0, containerW - sumNatural);
    let active: string[] = [...pool];
    while (rest > 0.5 && active.length) {
      const tw = active.reduce((a, k) => a + weight(k), 0);
      let used = 0;
      const next: string[] = [];
      for (const k of active) {
        const cap = natural[k] * 2 - out[k];
        const add = Math.min((rest * weight(k)) / tw, cap);
        out[k] += add; used += add;
        if (cap - add > 0.5) next.push(k);
      }
      if (used < 0.5) break;
      rest -= used;
      active = next;
    }
    return { widths: out, pad: Math.max(0, Math.round(rest / 2)) };
  }, [manualCols, isAbsorber, colW, containerW, compact]);

  function startResize(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    const startW = colW[id] ?? fitted.widths[id] ?? NATURAL_W[id];
    resizing.current = { id, startX: e.clientX, startW };
    setResizingCol(id);
  }
  const Resizer = ({ id }: { id: string }) => {
    const active = resizingCol === id;
    return (
      <span
        onMouseDown={(e) => startResize(e, id)}
        className="group absolute top-0 bottom-0 w-2 cursor-col-resize flex justify-center"
        style={{ right: -4, pointerEvents: "auto", zIndex: 20 }}
      >
        <span
          className={`w-[2px] h-full transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          style={{ background: "var(--ido-accent)", transitionDuration: "100ms", transitionTimingFunction: "var(--ido-ease)" }}
        />
      </span>
    );
  };
  const AbsorbBar = ({ id }: { id: string }) => {
    if (!isAbsorber(id)) return null;
    const closing = id === CLOSING_KEY;
    return (
      <span
        title={closing ? "Absorbe el doble de proporción" : "Absorbe el sobrante"}
        style={{ position: "absolute", bottom: 0, left: 8, right: 8, height: 2, background: "var(--ido-accent)", opacity: closing ? 1 : 0.5, pointerEvents: "none" }}
      />
    );
  };
  // Offset acumulado (dentro de la región de columnas del medio, sin contar
  // Zona ni la columna de cierre si está anclada a la derecha) hasta el
  // borde derecho de `key`.
  function colOffset(key: string): number {
    let x = 0;
    for (const c of midCols) {
      x += fitted.widths[c.key] ?? c.width;
      if (c.key === key) break;
    }
    return x;
  }

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try {
      getMetas(p).then((m) => setMetaInputs(metaToInputs(m)));
      const rows = await getRows(p);
      const byZona = new Map<string, IdoRow>();
      for (const r of rows) byZona.set(r.zona, r);
      const zonas = [...DEFAULT_ZONAS];
      for (const z of byZona.keys()) if (!zonas.includes(z)) zonas.push(z);
      setGrid(zonas.map((zona) => {
        const r = byZona.get(zona);
        return r ? idoRowToDsg(r) : emptyDsgRow(zona);
      }));
      setSyncAt(new Date());
    } catch (e) {
      toast.error(`Error al cargar: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(periodo); }, [periodo, load]);

  // Primera letra libre (A..Z) para zonas nuevas o duplicadas.
  const nextZona = useCallback(() => {
    const used = new Set(gridRef.current.map((r) => r.zona));
    for (let i = 0; i < 26; i++) {
      const l = String.fromCharCode(65 + i);
      if (!used.has(l)) return l;
    }
    return "Z";
  }, []);

  // Recompute derived columns on every grid change. Las filas que se borran
  // (menú contextual o borrado inteligente) también se borran en Supabase.
  const handleChange = useCallback(
    (newData: DsgRow[], operations: { type: string; fromRowIndex: number; toRowIndex: number }[]) => {
      const prev = gridRef.current;
      for (const op of operations) {
        if (op.type !== "DELETE") continue;
        for (const r of prev.slice(op.fromRowIndex, op.toRowIndex)) {
          if (r.zona) deleteRow(periodo, r.zona).catch(() => {});
        }
      }
      setGrid(newData.map(computeRow));
    },
    [periodo],
  );

  function addZona() {
    const z = newZona.trim().toUpperCase();
    if (!z) return;
    if (grid.some((r) => r.zona === z)) { toast.error(`La zona ${z} ya existe.`); return; }
    setGrid((prev) => [...prev, emptyDsgRow(z)]);
    setNewZona("");
  }

  function setMeta(key: keyof IdoMetas, value: string) {
    setMetaInputs((m) => ({ ...m, [key]: value }));
  }

  async function handleSaveMetas() {
    setMetasSaving(true);
    const parsed = Object.fromEntries(
      (Object.keys(metaInputs) as (keyof IdoMetas)[]).map((k) => [k, parseNum(metaInputs[k]) ?? 0])
    ) as unknown as IdoMetas;
    const err = await saveMetas(periodo, parsed);
    setMetasSaving(false);
    if (err) { toast.error(`Error al guardar criterios: ${err}`); return; }
    toast.success(`Criterios guardados para el período ${periodo}.`);
  }

  async function handleSave() {
    const rows: IdoRow[] = [];
    for (const r of grid) {
      const ido = dsgToIdoRow(periodo, r);
      if (ido) rows.push(ido);
    }
    if (rows.length === 0) { toast.error("No hay datos para guardar."); return; }
    setSaving(true);
    const err = await saveRows(rows);
    setSaving(false);
    if (err) { toast.error(`Error al guardar: ${err}`); return; }
    setSyncAt(new Date());
    toast.success(`Guardado: ${rows.length} zona(s) para el período ${periodo}.`);
    load(periodo);
  }

  // Encabezado con nombre completo en tooltip (design-system.md §4.18: los
  // encabezados truncan en modo compacto/desborde, el nombre completo queda
  // disponible al hover).
  function headerTitle(label: string) {
    return <span title={label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{label}</span>;
  }

  // El ancho de cada columna sale de `fitted` (reparto automático + resize a
  // mano), no de flex nativo de la librería: con grow/shrink en 0 en todas,
  // el ancho que calculamos es el que se renderiza, sin ambigüedad. Cuando
  // hay desborde incluso en modo compacto, la columna de cierre sale de acá
  // y se sirve por `stickyRightColumn` (ver JSX).
  const columns = useMemo((): Column<DsgRow>[] =>
    midCols.map((c) => ({
      ...(keyColumn(c.key, numColumn as never) as object),
      title: headerTitle(c.label),
      basis: Math.round(fitted.widths[c.key] ?? c.width),
      grow: 0,
      shrink: 0,
      disabled: !!c.calc,
      headerClassName: c.sep ? "ido-col-sep" : undefined,
      cellClassName: [c.sep ? "ido-col-sep" : "", c.calc ? "ido-calc-cell" : ""].filter(Boolean).join(" ") || undefined,
    }) as Column<DsgRow>),
  [fitted, midCols]);

  // Columna de cierre anclada a la derecha (design-system.md §4.18, paso 3):
  // solo se usa cuando ni el modo compacto alcanza — el resto del tiempo
  // viaja como una columna más dentro de `columns`.
  const stickyRightW = Math.round(fitted.widths[CLOSING_KEY] ?? NATURAL_W[CLOSING_KEY]);
  const closingSpec = COLS.find((c) => c.key === CLOSING_KEY)!;
  const stickyRightColumn = scrollAnchored
    ? {
        title: headerTitle(closingSpec.label),
        basis: stickyRightW, grow: 0, shrink: 0,
        component: ({ rowData }: { rowData: DsgRow }) => (
          <span style={{ width: "100%", textAlign: "right", padding: "0 8px", fontFamily: "var(--font-mono, ui-monospace, monospace)", color: "var(--ido-accent)", fontStyle: "italic", fontWeight: 500 }}>
            {rowData._mant_promedio}
          </span>
        ),
      }
    : undefined;

  // Bandas de grupo (Técnico/POVA/Mantenimiento) con ancho dinámico.
  const groupBands = useMemo(() => {
    const acc: { label: string; width: number }[] = [];
    for (const c of midCols) {
      const w = Math.round(fitted.widths[c.key] ?? c.width);
      if (c.group) acc.push({ label: c.group, width: w });
      else if (acc.length) acc[acc.length - 1].width += w;
    }
    return acc;
  }, [fitted, midCols]);
  const zonaW = Math.round(fitted.widths.zona ?? ZONA_W);
  const nonGutterW = useMemo(
    () => midCols.reduce((a, c) => a + Math.round(fitted.widths[c.key] ?? c.width), 0),
    [fitted, midCols]
  );
  const gridPixelHeight = grid.length * ROW_H + HEADER_H + 2;

  // Menú contextual del botón secundario, con el diseño del terminal.
  const ContextMenu = useCallback(({ clientX, clientY, items, cursorIndex, close }: ContextMenuComponentProps) => {
    const run = (fn: () => void) => () => { fn(); close(); };
    const find = (t: ContextMenuItem["type"]) => items.find((i) => i.type === t);
    const col = midCols[cursorIndex.col];
    const editable = !!col && !col.calc;

    // Limpiar celda y rellenar hacia abajo se resuelven contra nuestro estado:
    // DSG no las trae de fábrica.
    const clearCell = () => {
      if (!editable) return;
      setGrid((prev) => prev.map((r, i) =>
        i === cursorIndex.row ? computeRow({ ...r, [col.key]: "" }) : r));
    };
    const fillDown = () => {
      if (!editable) return;
      setGrid((prev) => {
        const v = prev[cursorIndex.row]?.[col.key] ?? "";
        return prev.map((r, i) => (i > cursorIndex.row ? computeRow({ ...r, [col.key]: v }) : r));
      });
    };

    const copy = find("COPY");
    const paste = find("PASTE");
    const dup = find("DUPLICATE_ROW");
    const del = find("DELETE_ROW");

    return (
      <div className="ido-menu" style={{ left: clientX, top: clientY }} onContextMenu={(e) => e.preventDefault()}>
        {copy && <MenuRow icon="copy" label="Copiar" shortcut="⌘C" onClick={run(copy.action)} />}
        {paste && <MenuRow icon="paste" label="Pegar" shortcut="⌘V" onClick={run(paste.action)} />}
        {editable && <MenuRow icon="clear" label="Limpiar celda" shortcut="⌫" onClick={run(clearCell)} />}
        {(dup || del || editable) && <div className="ido-menu-sep" />}
        {editable && <MenuRow icon="fill" label="Rellenar hacia abajo" shortcut="⌘D" onClick={run(fillDown)} />}
        {dup && <MenuRow icon="dup" label="Duplicar zona" shortcut="⇧⌘D" onClick={run(dup.action)} />}
        {del && <MenuRow icon="del" label="Eliminar zona" shortcut="⌘⌫" danger onClick={run(del.action)} />}
      </div>
    );
  }, [midCols]);

  // Estadísticas del pie (mismos números que muestra la tabla).
  const promEjec = useMemo(() => {
    const vals = grid
      .map((r) => parseNum(r._pova_ejecutado.replace("%", "")))
      .filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [grid]);

  return (
    <div className="ido-terminal">
      <div className="ido-card">
        {/* ── Toolbar ────────────────────────────────────────────────────── */}
        <div className="ido-toolbar">
          <span className="ido-title">IDO</span>
          <span className="ido-divider" />
          <span className="ido-subtitle">Índices de calidad · red de distribución</span>
          <input
            className="ido-field"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            style={{ width: 76 }}
            aria-label="Período"
          />

          <div style={{ flex: 1 }} />

          {resetMsg && (
            <span className="ido-reset-confirm">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg>
              Vista restablecida
            </span>
          )}
          <button
            className="ido-btn ido-btn-text"
            onClick={resetLayout}
            title="Restaura el ancho de columnas a su valor por defecto"
          >
            Restablecer vista
          </button>

          <button
            className={`ido-btn ido-btn-ghost${metasOpen ? " is-on" : ""}`}
            onClick={() => setMetasOpen((o) => !o)}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Criterios
            <ChevronDown className={`w-3 h-3 transition-transform ${metasOpen ? "rotate-180" : ""}`} />
          </button>
          <button className="ido-btn ido-btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Guardar
          </button>
          <button className="ido-btn ido-btn-ghost" onClick={() => load(periodo)} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Recargar
          </button>
          <div className="flex items-center gap-2" style={{ flex: "none" }}>
            <input
              className="ido-field"
              value={newZona}
              onChange={(e) => setNewZona(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addZona()}
              placeholder="Zona"
              style={{ width: 66 }}
            />
            <button className="ido-btn ido-btn-ghost" onClick={addZona}>
              <Plus className="w-3.5 h-3.5" /> Agregar
            </button>
          </div>
        </div>

        {/* ── Criterios (colapsable) ─────────────────────────────────────── */}
        {metasOpen && (
          <div className="ido-criterios">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {META_FIELDS.map(({ key, label, calc }) => (
                <label key={key} className="ido-criterio">
                  <span>
                    {label}
                    {calc && <i title="Afecta el cálculo del IDO"> •</i>}
                  </span>
                  <input
                    className="ido-field ido-field-mono"
                    type="text"
                    inputMode="decimal"
                    value={metaInputs[key]}
                    onChange={(e) => setMeta(key, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <button className="ido-btn ido-btn-primary" onClick={handleSaveMetas} disabled={metasSaving}>
                {metasSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Guardar criterios
              </button>
              <span className="ido-hint">Los <i>•</i> afectan el cálculo del IDO.</span>
            </div>
          </div>
        )}

        {/* ── Banda de grupos (scrollea junto con la grilla) ─────────────── */}
        <div className="ido-band">
          <div className="ido-band-zona" style={{ width: zonaW }} />
          <div className="ido-band-scroll">
            <div ref={bandRef} className="ido-band-track" style={{ width: nonGutterW }}>
              {groupBands.map((g) => (
                <div key={g.label} className="ido-band-group" style={{ width: g.width }}>{g.label}</div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Grid ──────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="ido-loading"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</div>
        ) : (
          <div ref={gridWrapRef} className={`ido-grid${scrolled ? " is-scrolled" : ""}`}>
            <div style={{ position: "relative", padding: `0 ${fitted.pad}px`, transition: "padding 200ms var(--ido-ease)" }}>
              <DataSheetGrid<DsgRow>
                key={dsgKey}
                value={grid}
                onChange={handleChange}
                columns={columns}
                gutterColumn={{
                  basis: zonaW, grow: 0, shrink: 0,
                  title: <span className="ido-zona-head">Zona</span>,
                  component: ({ rowData }) => <span className="ido-zona">{rowData.zona}</span>,
                }}
                stickyRightColumn={stickyRightColumn}
                contextMenuComponent={ContextMenu}
                createRow={() => emptyDsgRow(nextZona())}
                duplicateRow={({ rowData }) => ({ ...rowData, zona: nextZona() })}
                addRowsComponent={false}
                rowHeight={ROW_H}
                headerRowHeight={HEADER_H}
                height={gridPixelHeight}
                onScroll={(e) => {
                  const el = e.target as HTMLElement;
                  const x = el.scrollLeft;
                  const max = el.scrollWidth - el.clientWidth;
                  if (bandRef.current) bandRef.current.style.transform = `translateX(${-x}px)`;
                  if (resizeScrollRef.current) resizeScrollRef.current.style.transform = `translateX(${-x}px)`;
                  setScrolled(x > 1);
                  setScrolledRight(max - x > 1);
                }}
              />

              {/* Sombra de scroll a la derecha (design-system.md §4.18, paso 3) —
                  espejo de la sombra izquierda ya provista por .dsg-cell-gutter */}
              {scrollAnchored && (
                <div
                  style={{
                    position: "absolute", top: 0, bottom: 0, right: stickyRightW, width: 16, pointerEvents: "none", zIndex: 11,
                    background: "linear-gradient(to left, rgba(0,0,0,.55), rgba(0,0,0,0))",
                    opacity: scrolledRight ? 1 : 0, transition: "opacity 140ms var(--ido-ease)",
                  }}
                />
              )}

              {/* ── Redimensionado de columna (§4.15) — overlay sobre el header ──
                  `inset:0` en un hijo absoluto se resuelve contra el borde de la
                  padding box del ancestro posicionado (el div `position:relative`
                  con `padding: 0 fitted.pad px`), es decir ANTES del padding. La
                  grilla real (hija normal, no posicionada) arranca después del
                  padding — en la content box. Sin compensar `fitted.pad` acá el
                  overlay entero (guía, handles, etiqueta de ancho) queda corrido
                  a la izquierda exactamente `fitted.pad` px respecto de las
                  columnas reales. */}
              <div style={{ position: "absolute", top: 0, bottom: 0, left: fitted.pad, right: fitted.pad, pointerEvents: "none", zIndex: 10 }}>
                {/* Zona: columna fija (sticky), no scrollea */}
                <div style={{ position: "absolute", top: 0, left: 0, width: zonaW, height: HEADER_H }}>
                  <Resizer id="zona" />
                </div>
                {/* Resto: scrollea en sincro con la grilla */}
                <div
                  ref={resizeScrollRef}
                  style={{ position: "absolute", top: 0, left: zonaW, right: 0, height: gridPixelHeight, overflow: "visible" }}
                >
                  {midCols.map((c) => {
                    const w = Math.round(fitted.widths[c.key] ?? c.width);
                    const left = colOffset(c.key) - w;
                    return (
                      <div key={c.key} style={{ position: "absolute", left, top: 0, width: w, height: HEADER_H }}>
                        <Resizer id={c.key} />
                        <AbsorbBar id={c.key} />
                      </div>
                    );
                  })}
                  {resizingCol && resizingCol !== "zona" && (
                    <>
                      <div
                        style={{
                          position: "absolute", top: 0, left: colOffset(resizingCol), width: 1, height: gridPixelHeight,
                          background: "var(--ido-accent)", zIndex: 30,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute", top: HEADER_H + 8, left: colOffset(resizingCol) + 6, padding: "4px 8px",
                          borderRadius: 6, background: "var(--ido-surface-hover)", border: "1px solid var(--ido-line)",
                          fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11, color: "var(--ido-text)",
                          whiteSpace: "nowrap", zIndex: 31,
                        }}
                      >
                        {Math.round(fitted.widths[resizingCol] ?? NATURAL_W[resizingCol])} px
                      </div>
                    </>
                  )}
                </div>
                {resizingCol === "zona" && (
                  <>
                    <div
                      style={{
                        position: "absolute", top: 0, left: zonaW, width: 1, height: gridPixelHeight,
                        background: "var(--ido-accent)", zIndex: 30,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute", top: HEADER_H + 8, left: zonaW + 6, padding: "4px 8px",
                        borderRadius: 6, background: "var(--ido-surface-hover)", border: "1px solid var(--ido-line)",
                        fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11, color: "var(--ido-text)",
                        whiteSpace: "nowrap", zIndex: 31,
                      }}
                    >
                      {zonaW} px
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="ido-foot">
          <span>{grid.length} ZONAS</span>
          <span>OBJ {metaInputs.povaTransferido}%</span>
          <span>PROM. EJEC. {promEjec !== null ? `${promEjec.toFixed(1)}%` : "—"}</span>
          <span style={{ marginLeft: "auto" }}>
            SYNC {syncAt ? syncAt.toLocaleTimeString("es-AR", { hour12: false }) : "—"}
          </span>
        </div>
      </div>

      <p className="ido-note">
        <strong>Alcance:</strong> únicamente Obras Vía Administrativa y obras de mantenimiento (no se
        incluyen obras a cargo del cliente). Pegá desde Excel con <strong>⌘V</strong> o usá el botón
        secundario del mouse para copiar, rellenar hacia abajo y administrar zonas. Decimales con coma
        o punto; las columnas en <span className="ido-note-calc">verde</span> son calculadas.
      </p>
    </div>
  );
}
