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

// ── Layout de columnas (anchos fijos, como el diseño) ─────────────────────────
// `sep` marca el inicio de un bloque (línea vertical + etiqueta de grupo arriba).
const ZONA_W = 72;
type ColSpec = {
  key: keyof DsgRow; label: string; width: number;
  group?: string; sep?: boolean; calc?: boolean;
};
const COLS: ColSpec[] = [
  { key: "fmik_s1", label: "FMIK S1", width: 96, group: "Técnico", sep: true },
  { key: "fmik_s2", label: "FMIK S2", width: 96 },
  { key: "dmik_s1", label: "DMIK S1", width: 96 },
  { key: "dmik_s2", label: "DMIK S2", width: 96 },
  { key: "pova_transferido", label: "Transferido", width: 120, group: "POVA", sep: true },
  { key: "pova_fin_obra", label: "Fin de obra", width: 116 },
  { key: "pova_creadas", label: "Creadas", width: 96 },
  { key: "pova_total", label: "Total obras", width: 116 },
  { key: "_pova_ejecutado", label: "Ejecutado", width: 108, calc: true },
  { key: "_pova_resultado", label: "Result. s/ Obj", width: 124, calc: true },
  { key: "mant_poda_bt", label: "Poda BT", width: 96, group: "Mantenimiento", sep: true },
  { key: "mant_poda_mt", label: "Poda MT", width: 96 },
  { key: "mant_termografia", label: "Termografía", width: 120 },
  { key: "_mant_promedio", label: "Mantenimiento", width: 156, calc: true },
];

// Bloques (Técnico / POVA / Mantenimiento) con su ancho total, para la banda
// de grupos que va arriba del header.
const GROUPS = COLS.reduce<{ label: string; width: number }[]>((acc, c) => {
  if (c.group) acc.push({ label: c.group, width: c.width });
  else if (acc.length) acc[acc.length - 1].width += c.width;
  return acc;
}, []);

const GRID_W = ZONA_W + COLS.reduce((a, c) => a + c.width, 0);

const ROW_H = 52;
const HEADER_H = 34;

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
  const gridRef = useRef<DsgRow[]>([]);
  gridRef.current = grid;

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
    setSyncAt(new Date());
    setLoading(false);
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

  const columns = useMemo((): Column<DsgRow>[] =>
    COLS.map((c, i) => ({
      ...(keyColumn(c.key, numColumn as never) as object),
      title: c.label,
      basis: c.width,
      // Anchos fijos salvo la última, que absorbe el espacio sobrante para que
      // las filas lleguen siempre hasta el borde de la card. Con `shrink: 0`,
      // si la pantalla es más angosta que la tabla aparece scroll horizontal
      // en vez de apretar las columnas.
      grow: i === COLS.length - 1 ? 1 : 0,
      shrink: 0,
      disabled: !!c.calc,
      headerClassName: c.sep ? "ido-col-sep" : undefined,
      cellClassName: [c.sep ? "ido-col-sep" : "", c.calc ? "ido-calc-cell" : ""].filter(Boolean).join(" ") || undefined,
    }) as Column<DsgRow>),
  []);

  // Menú contextual del botón secundario, con el diseño del terminal.
  const ContextMenu = useCallback(({ clientX, clientY, items, cursorIndex, close }: ContextMenuComponentProps) => {
    const run = (fn: () => void) => () => { fn(); close(); };
    const find = (t: ContextMenuItem["type"]) => items.find((i) => i.type === t);
    const col = COLS[cursorIndex.col];
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
  }, []);

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
          <div className="ido-band-zona" style={{ width: ZONA_W }} />
          <div className="ido-band-scroll">
            <div ref={bandRef} className="ido-band-track" style={{ width: GRID_W - ZONA_W }}>
              {GROUPS.map((g) => (
                <div key={g.label} className="ido-band-group" style={{ width: g.width }}>{g.label}</div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Grid ──────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="ido-loading"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</div>
        ) : (
          <div className={`ido-grid${scrolled ? " is-scrolled" : ""}`}>
            <DataSheetGrid<DsgRow>
              value={grid}
              onChange={handleChange}
              columns={columns}
              gutterColumn={{
                basis: ZONA_W, grow: 0, shrink: 0,
                title: <span className="ido-zona-head">Zona</span>,
                component: ({ rowData }) => <span className="ido-zona">{rowData.zona}</span>,
              }}
              contextMenuComponent={ContextMenu}
              createRow={() => emptyDsgRow(nextZona())}
              duplicateRow={({ rowData }) => ({ ...rowData, zona: nextZona() })}
              addRowsComponent={false}
              rowHeight={ROW_H}
              headerRowHeight={HEADER_H}
              height={grid.length * ROW_H + HEADER_H + 2}
              onScroll={(e) => {
                const x = (e.target as HTMLElement).scrollLeft;
                if (bandRef.current) bandRef.current.style.transform = `translateX(${-x}px)`;
                setScrolled(x > 1);
              }}
            />
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
