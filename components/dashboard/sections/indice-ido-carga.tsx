"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  DataSheetGrid,
  textColumn,
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

// ── Group title helper (colored left border for group separators) ──────────────
function GroupTitle({ label }: { label: string }) {
  return (
    <span style={{
      display: "inline-block",
      borderLeft: "2px solid oklch(0.55 0.2 155 / 0.7)",
      paddingLeft: 6,
      color: "oklch(0.72 0.18 155)",
      fontWeight: 700,
      textTransform: "uppercase",
      fontSize: 10,
      letterSpacing: "0.06em",
    }}>
      {label}
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
    function mk(key: keyof DsgRow, title: string, groupStart?: boolean): Column<DsgRow> {
      return {
        ...(keyColumn(key, textColumn as never) as object),
        title: groupStart ? <GroupTitle label={title} /> : title,
        minWidth: 85,
      } as Column<DsgRow>;
    }
    function mkDisabled(key: keyof DsgRow, title: string): Column<DsgRow> {
      return {
        ...(keyColumn(key, textColumn as never) as object),
        title,
        disabled: true,
        minWidth: 95,
      } as Column<DsgRow>;
    }

    return [
      // Zona identifier (sticky left, read-only)
      {
        ...(keyColumn("zona", textColumn as never) as object),
        title: "Zona",
        disabled: true,
        minWidth: 56,
        grow: 0,
      } as Column<DsgRow>,

      // ── Técnico ────────────────────────────────────────────────────────────
      mk("fmik_s1", "Técnico — FMIK S1", true),
      mk("fmik_s2", "FMIK S2"),
      mk("dmik_s1", "DMIK S1"),
      mk("dmik_s2", "DMIK S2"),

      // ── POVA ───────────────────────────────────────────────────────────────
      mk("pova_transferido", "POVA — Transferido", true),
      mk("pova_fin_obra", "Fin de obra"),
      mk("pova_creadas", "Creadas"),
      mk("pova_total", "Total obras"),
      mkDisabled("_pova_ejecutado", "Ejecutado"),
      mkDisabled("_pova_resultado", "Result. s/ Obj"),

      // ── Mantenimiento ──────────────────────────────────────────────────────
      mk("mant_poda_bt", "Mant. — Poda BT", true),
      mk("mant_poda_mt", "Poda MT"),
      mk("mant_termografia", "Termografía"),
      mkDisabled("_mant_promedio", "Mantenimiento"),

      // ── Delete button ──────────────────────────────────────────────────────
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
        width: 36,
        minWidth: 36,
        grow: 0,
        disabled: true,
      } as unknown as Column<DsgRow>,
    ];
  }, [removeZona]);

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
            <UploadCloud className="w-[18px] h-[18px]" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-foreground" style={{ letterSpacing: -0.4, margin: 0 }}>
              Índice IDO — Carga de datos
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: "oklch(0.55 0 0)" }}>
              Completá la tabla con los valores crudos. Los KPIs e IDO se calculan en el Resumen.
            </p>
          </div>
        </div>

        {/* Período */}
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <label className="text-sm text-muted-foreground">Período</label>
          <input
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            className="w-24 h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent"
          />
        </div>
      </div>

      {/* Beast pure container */}
      <div
        className="px-4 py-6 sm:px-6 space-y-5"
        style={{
          background: "oklch(0.235 0.005 270)",
          border: "1px solid oklch(1 0 0 / 0.07)",
          borderRadius: 14,
        }}
      >
        {/* Alcance */}
        <div className="text-xs text-muted-foreground bg-secondary/30 border border-border rounded-lg px-3 py-2.5">
          <strong className="text-foreground/80">Alcance:</strong> se consideran únicamente las{" "}
          <strong className="text-foreground/80">Obras Vía Administrativa</strong> y las{" "}
          <strong className="text-foreground/80">Obras de mantenimiento</strong>. No se tienen en cuenta las
          obras a cargo del cliente.
        </div>

        {/* Criterios estratégicos */}
        <div className="rounded-[14px] bg-panel-2 border border-hairline">
          <button
            onClick={() => setMetasOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-foreground"
          >
            <SlidersHorizontal className="w-4 h-4 text-accent" />
            Criterios estratégicos / metas internas
            <span className="text-xs text-muted-foreground font-normal">
              (FMIK S1 ≤ {metaInputs.fmikS1} · DMIK S1 ≤ {metaInputs.dmikS1} · Obj. POVA {metaInputs.povaTransferido}%)
            </span>
            <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${metasOpen ? "rotate-180" : ""}`} />
          </button>
          {metasOpen && (
            <div className="px-4 pb-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {META_FIELDS.map(({ key, label, calc }) => (
                  <label key={key} className="flex flex-col gap-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      {label}
                      {calc && <span className="text-accent" title="Afecta el cálculo del IDO">•</span>}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={metaInputs[key]}
                      onChange={(e) => setMeta(key, e.target.value)}
                      className="h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent"
                    />
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleSaveMetas}
                  disabled={metasSaving}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-40 transition-colors"
                >
                  {metasSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Guardar criterios
                </button>
                <p className="text-[11px] text-muted-foreground/70">
                  Los marcados con <span className="text-accent">•</span> afectan el cálculo del IDO.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Ayuda */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/40 border border-border rounded-lg px-3 py-2.5">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-accent" />
          <span>
            Seleccioná una celda y pegá directamente desde Excel — se completa hacia abajo y a la derecha
            automáticamente. Las columnas en <span style={{ color: "oklch(0.72 0.18 155)" }}>verde</span> son calculadas (provisorias).
            Decimales con coma o punto.
          </span>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Cargando…
          </div>
        ) : (
          <div className="ido-dsg-wrapper rounded-[14px] overflow-hidden border border-hairline">
            <DataSheetGrid<DsgRow>
              value={grid}
              onChange={handleChange}
              columns={columns}
              lockRows
              disableContextMenu
              rowHeight={34}
              headerRowHeight={38}
            />
          </div>
        )}

        {/* Acciones */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Guardar período {periodo}
          </button>
          <button
            onClick={() => load(periodo)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Recargar
          </button>

          {/* Agregar zona */}
          <div className="flex items-center gap-2 ml-auto">
            <input
              value={newZona}
              onChange={(e) => setNewZona(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addZona()}
              placeholder="Nueva zona"
              className="w-28 h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent placeholder:text-muted-foreground"
            />
            <button
              onClick={addZona}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="w-4 h-4" /> Agregar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
