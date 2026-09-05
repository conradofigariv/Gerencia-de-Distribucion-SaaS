"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  DataSheetGrid,
  createTextColumn,
  keyColumn,
  type Column,
} from "react-datasheet-grid";
import "react-datasheet-grid/dist/style.css";
import {
  UploadCloud, Loader2, Save, RefreshCw, Calendar, Trash2, Plus, Info,
  SlidersHorizontal, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
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

// Columna numérica: todo IDO es numérico, así que se alinea a la derecha
// (mucho más legible para comparar magnitudes bajando por una columna) y
// hereda la fuente monoespaciada del wrapper (números tabulares gratis).
const numColumn = createTextColumn({ alignRight: true });

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

// ── Column header (grupo + campo en dos líneas fijas, nunca texto que envuelve
// de forma impredecible) — el borde verde a la izquierda marca el inicio de
// cada sección (Técnico / POVA / Mantenimiento); las columnas intermedias
// reservan la misma línea superior (vacía) para que el nombre del campo quede
// siempre a la misma altura en todo el header. ──────────────────────────────
function ColumnHeader({ group, label }: { group?: string; label: string }) {
  return (
    <span
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        paddingLeft: 6,
        borderLeft: group ? "2px solid oklch(0.55 0.2 155 / 0.7)" : "2px solid transparent",
      }}
    >
      <span style={{
        fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
        color: "oklch(0.72 0.18 155)", lineHeight: 1.3, minHeight: 12,
      }}>
        {group ?? " "}
      </span>
      <span style={{ fontSize: 11.5, fontWeight: 500, color: "oklch(0.82 0 0)", lineHeight: 1.2 }}>
        {label}
      </span>
    </span>
  );
}

// Trash icon inline (avoids importing Lucide in column closures)
function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M19 6l-1 14H6L5 6M8 6V4h8v2"/>
    </svg>
  );
}

const DEFAULT_ZONAS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

// ── Design tokens (same palette as Buscador) ──────────────────────────────────
const CARD_BG      = "oklch(0.235 0.005 270)";
const PANEL_BG     = "oklch(0.205 0.005 270)";
const PANEL_BORDER = "1px solid oklch(1 0 0 / 0.07)";
const BTN_IDLE     = { background: "oklch(0.16 0.005 270)", border: "1px solid oklch(1 0 0 / 0.07)" } as const;
const BTN_ACTIVE   = { background: "oklch(0.28 0.02 295)", border: "1px solid oklch(0.55 0.20 295 / 0.45)" } as const;
const BTN_ACCENT   = { background: "oklch(0.55 0.18 155)", border: "none" } as const;

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

  const load = useCallback(async (p: string) => {
    setLoading(true);
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
    setLoading(false);
  }, []);

  useEffect(() => { load(periodo); }, [periodo, load]);

  const removeZona = useCallback(async (zona: string) => {
    setGrid((prev) => prev.filter((r) => r.zona !== zona));
    await deleteRow(periodo, zona);
  }, [periodo]);

  // Recompute derived columns on every grid change
  function handleChange(newData: DsgRow[]) {
    setGrid(newData.map(computeRow));
  }

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
    toast.success(`Guardado: ${rows.length} zona(s) para el período ${periodo}.`);
    load(periodo);
  }

  // Columns defined inside component to capture removeZona
  const columns = useMemo((): Column<DsgRow>[] => {
    function mk(key: keyof DsgRow, label: string, group?: string): Column<DsgRow> {
      return {
        ...(keyColumn(key, numColumn as never) as object),
        title: <ColumnHeader label={label} group={group} />,
        minWidth: 88,
      } as Column<DsgRow>;
    }
    function mkDisabled(key: keyof DsgRow, label: string, group?: string): Column<DsgRow> {
      return {
        ...(keyColumn(key, numColumn as never) as object),
        title: <ColumnHeader label={label} group={group} />,
        disabled: true,
        cellClassName: "ido-computed-cell",
        minWidth: 96,
      } as Column<DsgRow>;
    }

    return [
      // ── Técnico ────────────────────────────────────────────────────────────
      mk("fmik_s1", "FMIK S1", "Técnico"),
      mk("fmik_s2", "FMIK S2"),
      mk("dmik_s1", "DMIK S1"),
      mk("dmik_s2", "DMIK S2"),

      // ── POVA ───────────────────────────────────────────────────────────────
      mk("pova_transferido", "Transferido", "POVA"),
      mk("pova_fin_obra", "Fin de obra"),
      mk("pova_creadas", "Creadas"),
      mk("pova_total", "Total obras"),
      mkDisabled("_pova_ejecutado", "Ejecutado"),
      mkDisabled("_pova_resultado", "Result. s/ Obj"),

      // ── Mantenimiento ──────────────────────────────────────────────────────
      mk("mant_poda_bt", "Poda BT", "Mantenimiento"),
      mk("mant_poda_mt", "Poda MT"),
      mk("mant_termografia", "Termografía"),
      mkDisabled("_mant_promedio", "Mantenimiento"),

      // ── Delete button ── ancho fijo real: en react-datasheet-grid un `grow:0`
      // sin `basis` se queda "congelado" en 0px (el minWidth nunca llega a
      // evaluarse) — hay que fijar el tamaño con `basis`, no con `width`/`minWidth`.
      {
        component: ({ rowData }: { rowData: DsgRow }) => (
          <button
            onMouseDown={(e) => { e.stopPropagation(); removeZona(rowData.zona); }}
            title="Eliminar zona"
            className="ido-delete-btn"
          >
            <TrashIcon />
          </button>
        ),
        title: "",
        basis: 36,
        grow: 0,
        shrink: 0,
        disabled: true,
      } as unknown as Column<DsgRow>,
    ];
  }, [removeZona]);

  const inputStyle: React.CSSProperties = {
    height: 30, borderRadius: 8,
    background: "oklch(0.16 0.005 270)",
    border: "1px solid oklch(1 0 0 / 0.07)",
    color: "oklch(0.92 0 0)", fontSize: 12,
    paddingInline: 8, outline: "none",
  };

  return (
    <div
      className="p-2.5 overflow-hidden space-y-2"
      style={{ background: CARD_BG, border: PANEL_BORDER, borderRadius: 12 }}
    >
      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <div
          className="grid place-items-center shrink-0"
          style={{ width: 28, height: 28, borderRadius: 7, background: "oklch(0.30 0.10 155 / 0.45)", border: "1px solid oklch(0.55 0.15 155 / 0.5)", color: "#86efac" }}
        >
          <UploadCloud className="w-[14px] h-[14px]" strokeWidth={2} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: "oklch(0.92 0 0)", letterSpacing: -0.2 }}>
          IDO — Carga de datos
        </span>
        <div style={{ width: 1, height: 16, background: "oklch(1 0 0 / 0.10)", marginInline: 4 }} />
        <Calendar className="w-3.5 h-3.5" style={{ color: "oklch(0.58 0 0)" }} />
        <span style={{ fontSize: 12, color: "oklch(0.58 0 0)" }}>Período</span>
        <input
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value)}
          style={{ ...inputStyle, width: 72 }}
        />

        <div className="flex-1" />

        {/* Criterios toggle */}
        <button
          onClick={() => setMetasOpen((o) => !o)}
          style={{ height: 30, borderRadius: 9, paddingInline: 10, fontSize: 12.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, color: "oklch(0.88 0 0)", cursor: "pointer", ...(metasOpen ? BTN_ACTIVE : BTN_IDLE) }}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Criterios
          <ChevronDown className={`w-3 h-3 transition-transform ${metasOpen ? "rotate-180" : ""}`} />
        </button>

        {/* Guardar */}
        <button
          onClick={handleSave}
          disabled={saving || loading}
          style={{ height: 30, borderRadius: 9, paddingInline: 12, fontSize: 12.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, color: "#fff", cursor: saving || loading ? "not-allowed" : "pointer", opacity: saving || loading ? 0.45 : 1, ...BTN_ACCENT }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Guardar {periodo}
        </button>

        {/* Recargar */}
        <button
          onClick={() => load(periodo)}
          disabled={loading}
          style={{ height: 30, borderRadius: 9, paddingInline: 10, fontSize: 12.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, color: "oklch(0.68 0 0)", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.45 : 1, ...BTN_IDLE }}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Recargar
        </button>

        {/* Agregar zona */}
        <input
          value={newZona}
          onChange={(e) => setNewZona(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addZona()}
          placeholder="Zona…"
          style={{ ...inputStyle, width: 62 }}
        />
        <button
          onClick={addZona}
          style={{ height: 30, borderRadius: 9, paddingInline: 9, fontSize: 12.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 5, color: "oklch(0.68 0 0)", cursor: "pointer", ...BTN_IDLE }}
        >
          <Plus className="w-3.5 h-3.5" /> Agregar
        </button>
      </div>

      {/* ── Alcance ──────────────────────────────────────────────────────────── */}
      <div style={{ background: PANEL_BG, border: PANEL_BORDER, borderRadius: 9, padding: "5px 10px", fontSize: 11, color: "oklch(0.56 0 0)", lineHeight: 1.45 }}>
        <strong style={{ color: "oklch(0.70 0 0)" }}>Alcance:</strong>{" "}
        únicamente <strong style={{ color: "oklch(0.70 0 0)" }}>Obras Vía Administrativa</strong> y{" "}
        <strong style={{ color: "oklch(0.70 0 0)" }}>obras de mantenimiento</strong>. No se incluyen obras a cargo del cliente.
      </div>

      {/* ── Criterios panel (collapsible) ────────────────────────────────────── */}
      {metasOpen && (
        <div style={{ background: PANEL_BG, border: PANEL_BORDER, borderRadius: 9, padding: "10px 12px" }} className="space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {META_FIELDS.map(({ key, label, calc }) => (
              <label key={key} className="flex flex-col gap-1" style={{ fontSize: 11, color: "oklch(0.58 0 0)" }}>
                <span className="flex items-center gap-1">
                  {label}
                  {calc && <span style={{ color: "oklch(0.65 0.2 155)" }} title="Afecta el cálculo del IDO">•</span>}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={metaInputs[key]}
                  onChange={(e) => setMeta(key, e.target.value)}
                  style={{ ...inputStyle, height: 28, borderRadius: 7, fontFamily: "monospace", width: "100%" }}
                />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={handleSaveMetas}
              disabled={metasSaving}
              style={{ height: 28, borderRadius: 8, paddingInline: 10, fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 5, color: "#fff", cursor: metasSaving ? "not-allowed" : "pointer", opacity: metasSaving ? 0.45 : 1, ...BTN_ACCENT }}
            >
              {metasSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Guardar criterios
            </button>
            <span style={{ fontSize: 11, color: "oklch(0.50 0 0)" }}>
              Los <span style={{ color: "oklch(0.65 0.2 155)" }}>•</span> afectan el cálculo del IDO.
            </span>
          </div>
        </div>
      )}

      {/* ── Ayuda ────────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-1.5" style={{ fontSize: 11, color: "oklch(0.52 0 0)", paddingInline: 2 }}>
        <Info className="w-3.5 h-3.5 shrink-0 mt-px" style={{ color: "oklch(0.65 0.2 155)" }} />
        <span>
          Pegá desde Excel — completa hacia abajo y a la derecha. Columnas en{" "}
          <span style={{ color: "oklch(0.72 0.18 155)" }}>verde</span> son calculadas. Decimales con coma o punto.
        </span>
      </div>

      {/* ── Grid ─────────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center h-32 gap-2" style={{ color: "oklch(0.55 0 0)" }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="ido-dsg-wrapper overflow-hidden" style={{ borderRadius: 10, border: PANEL_BORDER }}>
          <DataSheetGrid<DsgRow>
            value={grid}
            onChange={handleChange}
            columns={columns}
            // Gutter fijo (sticky) con la zona en vez del índice de fila: así
            // siempre se sabe a qué zona corresponde la fila aunque se haya
            // scrolleado horizontalmente hacia las últimas columnas.
            gutterColumn={{
              basis: 60, grow: 0, shrink: 0,
              component: ({ rowData }) => <div className="ido-zona-gutter">{rowData.zona}</div>,
            }}
            rowClassName={({ rowIndex }) => (rowIndex % 2 === 1 ? "ido-row-alt" : undefined)}
            lockRows
            disableContextMenu
            rowHeight={34}
            headerRowHeight={42}
            height={grid.length * 34 + 42 + 2}
          />
        </div>
      )}
    </div>
  );
}
