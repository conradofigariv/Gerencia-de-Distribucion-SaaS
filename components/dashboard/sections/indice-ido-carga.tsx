"use client";

import { useState, useEffect, useCallback } from "react";
import {
  UploadCloud, Loader2, Save, RefreshCw, Calendar, Trash2, Plus, Info,
} from "lucide-react";
import { toast } from "sonner";
import { parseNum, getRows, saveRows, deleteRow } from "@/lib/idoStorage";
import type { IdoRow } from "@/lib/idoStorage";

// Orden canónico de zonas (igual que las tablas de origen FMIK/DMIK) para que
// al pegar una columna de valores se alineen fila por fila.
const DEFAULT_ZONAS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

interface Field {
  key: string;
  label: string;
}

interface DerivedCol {
  key: string;
  label: string;
  compute: (cells: Record<string, string>) => number | null;
}

interface Group {
  label: string;
  fields: Field[];
  derived?: DerivedCol[];
}

// POVA — cálculos provisorios (no se persisten; el valor oficial sale en el Resumen)
const POVA_OBJETIVO = 95; // %
function povaEjecutado(cells: Record<string, string>): number | null {
  const t = parseNum(cells.pova_transferido ?? "");
  const f = parseNum(cells.pova_fin_obra ?? "");
  const tot = parseNum(cells.pova_total ?? "");
  if (t === null || f === null || tot === null || tot === 0) return null;
  return ((t + f) / tot) * 100;
}
function povaResultado(cells: Record<string, string>): number | null {
  const e = povaEjecutado(cells);
  if (e === null) return null;
  return Math.min(100, (e / POVA_OBJETIVO) * 100);
}

// Mantenimiento — promedio de Poda BT, Poda MT y Termografía (de los que tengan dato)
function mantPromedio(cells: Record<string, string>): number | null {
  const vals = [cells.mant_poda_bt, cells.mant_poda_mt, cells.mant_termografia]
    .map((v) => parseNum(v ?? ""))
    .filter((n): n is number => n !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const GROUPS: Group[] = [
  {
    label: "Técnico — FMIK / DMIK",
    fields: [
      { key: "fmik_s1", label: "FMIK S1" },
      { key: "fmik_s2", label: "FMIK S2" },
      { key: "dmik_s1", label: "DMIK S1" },
      { key: "dmik_s2", label: "DMIK S2" },
    ],
  },
  {
    label: "POVA — Obras",
    fields: [
      { key: "pova_transferido", label: "Transferido" },
      { key: "pova_fin_obra", label: "Fin de obra" },
      { key: "pova_creadas", label: "Creadas" },
      { key: "pova_total", label: "Total obras" },
    ],
    derived: [
      { key: "pova_ejecutado", label: "Ejecutado", compute: povaEjecutado },
      { key: "pova_resultado", label: "Result. sobre Objetivo", compute: povaResultado },
    ],
  },
  {
    label: "Mantenimiento",
    fields: [
      { key: "mant_poda_bt", label: "Poda BT" },
      { key: "mant_poda_mt", label: "Poda MT" },
      { key: "mant_termografia", label: "Termografía" },
    ],
    derived: [
      { key: "mant_promedio", label: "Mantenimiento", compute: mantPromedio },
    ],
  },
];

// Solo los campos editables se mapean a la base y al pegado de columnas.
const FLAT_FIELDS: string[] = GROUPS.flatMap((g) => g.fields.map((f) => f.key));

// Layout de columnas (editables + derivadas) con índice de pegado y borde de grupo.
type Col =
  | { kind: "input"; field: string; label: string; fieldIdx: number; groupStart: boolean }
  | { kind: "derived"; key: string; label: string; compute: DerivedCol["compute"]; groupStart: boolean };

const COLUMNS: Col[] = (() => {
  const cols: Col[] = [];
  let ei = 0;
  for (const g of GROUPS) {
    g.fields.forEach((f, idx) => {
      cols.push({ kind: "input", field: f.key, label: f.label, fieldIdx: ei, groupStart: idx === 0 });
      ei++;
    });
    (g.derived ?? []).forEach((d, idx) => {
      cols.push({ kind: "derived", key: d.key, label: d.label, compute: d.compute, groupStart: g.fields.length === 0 && idx === 0 });
    });
  }
  return cols;
})();

interface GridRow {
  zona: string;
  cells: Record<string, string>;
}

function numToStr(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)}%`;
}

function emptyCells(): Record<string, string> {
  return Object.fromEntries(FLAT_FIELDS.map((f) => [f, ""]));
}

export function IndiceIdoCargaSection() {
  const [periodo, setPeriodo] = useState(String(new Date().getFullYear()));
  const [grid, setGrid] = useState<GridRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newZona, setNewZona] = useState("");

  const load = useCallback(async (p: string) => {
    setLoading(true);
    const rows = await getRows(p);
    const byZona = new Map<string, IdoRow>();
    for (const r of rows) byZona.set(r.zona, r);

    // Siempre mostramos las zonas por defecto + cualquier extra ya guardada
    const zonas = [...DEFAULT_ZONAS];
    for (const z of byZona.keys()) if (!zonas.includes(z)) zonas.push(z);

    const next: GridRow[] = zonas.map((zona) => {
      const r = byZona.get(zona);
      const cells = emptyCells();
      if (r) {
        for (const f of FLAT_FIELDS) {
          cells[f] = numToStr((r as unknown as Record<string, number | null>)[f]);
        }
      }
      return { zona, cells };
    });
    setGrid(next);
    setLoading(false);
  }, []);

  useEffect(() => { load(periodo); }, [periodo, load]);

  function setCell(rowIdx: number, field: string, value: string) {
    setGrid((prev) => {
      const next = prev.map((r) => ({ ...r, cells: { ...r.cells } }));
      next[rowIdx].cells[field] = value;
      return next;
    });
  }

  // Pegar desde Excel: rellena hacia abajo (y a la derecha si hay tabs)
  function handlePaste(e: React.ClipboardEvent, rowIdx: number, fieldIdx: number) {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    const lines = text.replace(/\r/g, "").split("\n");
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    // Una sola celda sin tabs → comportamiento normal de pegado
    if (lines.length <= 1 && !text.includes("\t")) return;
    e.preventDefault();
    setGrid((prev) => {
      const next = prev.map((r) => ({ ...r, cells: { ...r.cells } }));
      lines.forEach((line, i) => {
        const r = rowIdx + i;
        if (r >= next.length) return;
        line.split("\t").forEach((val, j) => {
          const f = FLAT_FIELDS[fieldIdx + j];
          if (f) next[r].cells[f] = val.trim();
        });
      });
      return next;
    });
  }

  function addZona() {
    const z = newZona.trim().toUpperCase();
    if (!z) return;
    if (grid.some((r) => r.zona === z)) { toast.error(`La zona ${z} ya existe.`); return; }
    setGrid((prev) => [...prev, { zona: z, cells: emptyCells() }]);
    setNewZona("");
  }

  async function removeZona(zona: string) {
    setGrid((prev) => prev.filter((r) => r.zona !== zona));
    await deleteRow(periodo, zona);
  }

  async function handleSave() {
    const rows: IdoRow[] = [];
    for (const r of grid) {
      const parsedCells: Record<string, number | null> = {};
      let hasData = false;
      for (const f of FLAT_FIELDS) {
        const n = parseNum(r.cells[f] ?? "");
        parsedCells[f] = n;
        if (n !== null) hasData = true;
      }
      if (!hasData) continue;
      rows.push({ periodo, zona: r.zona, ...parsedCells } as unknown as IdoRow);
    }
    if (rows.length === 0) { toast.error("No hay datos para guardar."); return; }
    setSaving(true);
    const err = await saveRows(rows);
    setSaving(false);
    if (err) { toast.error(`Error al guardar: ${err}`); return; }
    toast.success(`Guardado: ${rows.length} zona(s) para el período ${periodo}.`);
    load(periodo);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
            <UploadCloud className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Índice IDO — Carga de datos</h2>
            <p className="text-sm text-muted-foreground">
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

      {/* Alcance */}
      <div className="text-xs text-muted-foreground bg-secondary/30 border border-border rounded-lg px-3 py-2.5">
        <strong className="text-foreground/80">Alcance:</strong> se consideran únicamente las{" "}
        <strong className="text-foreground/80">Obras Vía Administrativa</strong> y las{" "}
        <strong className="text-foreground/80">Obras de mantenimiento</strong>. No se tienen en cuenta las
        obras a cargo del cliente.
      </div>

      {/* Ayuda */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/40 border border-border rounded-lg px-3 py-2.5">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-accent" />
        <span>
          Copiá una columna desde Excel (ej. FMIK <strong>2026 S1</strong>) y pegala sobre la primera celda
          de la columna correspondiente: se completa hacia abajo automáticamente. Las zonas están en el orden
          de origen (A, B, C, …, I). También podés escribir valores a mano. Decimales con coma o punto.
        </span>
      </div>

      {/* Tabla editable */}
      <div className="rounded-xl border border-border bg-card/40 overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th rowSpan={2} className="text-left font-medium px-3 py-2 sticky left-0 bg-card/90 z-10 align-bottom">
                Zona
              </th>
              {GROUPS.map((g) => (
                <th
                  key={g.label}
                  colSpan={g.fields.length + (g.derived?.length ?? 0)}
                  className="text-center font-semibold text-foreground/80 px-3 py-1.5 border-l border-border"
                >
                  {g.label}
                </th>
              ))}
              <th rowSpan={2} className="px-2 py-2" />
            </tr>
            <tr className="border-b border-border text-muted-foreground">
              {COLUMNS.map((col) => (
                <th
                  key={col.kind === "input" ? col.field : col.key}
                  className={`text-right font-medium px-3 py-1.5 whitespace-nowrap ${col.groupStart ? "border-l border-border" : ""} ${col.kind === "derived" ? "text-accent/70 italic" : ""}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, rowIdx) => (
              <tr key={row.zona} className="border-b border-border/50 hover:bg-secondary/20">
                <td className="px-3 py-1.5 font-semibold text-foreground sticky left-0 bg-card/90 z-10">
                  {row.zona}
                </td>
                {COLUMNS.map((col) => {
                  if (col.kind === "input") {
                    return (
                      <td key={col.field} className={`px-1 py-1 ${col.groupStart ? "border-l border-border" : ""}`}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.cells[col.field]}
                          onChange={(e) => setCell(rowIdx, col.field, e.target.value)}
                          onPaste={(e) => handlePaste(e, rowIdx, col.fieldIdx)}
                          className="w-20 px-2 py-1 rounded bg-secondary/60 border border-transparent text-right font-mono text-foreground/90 focus:outline-none focus:border-accent focus:bg-secondary"
                        />
                      </td>
                    );
                  }
                  return (
                    <td key={col.key} className={`px-2 py-1.5 text-right ${col.groupStart ? "border-l border-border" : ""}`}>
                      <span className="font-mono text-accent/80" title="Calculado (provisorio)">{fmtPct(col.compute(row.cells))}</span>
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right">
                  <button
                    onClick={() => removeZona(row.zona)}
                    title="Eliminar zona"
                    className="text-muted-foreground hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
  );
}
