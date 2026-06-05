"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  UploadCloud, FileSpreadsheet, Loader2, Save, RefreshCw,
  CheckCircle2, AlertCircle, Calendar, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  parseBlock, getRows, saveRows, deleteRow, mergeRows,
  TECNICO_FIELDS, POVA_FIELDS, MANT_FIELDS,
} from "@/lib/idoStorage";
import type { IdoRow, ParsedBlock, Bloque } from "@/lib/idoStorage";

interface BlockDef {
  id: Bloque;
  title: string;
  hint: string;
  cols: string;
}

const BLOCKS: BlockDef[] = [
  {
    id: "tecnico",
    title: "Técnico — FMIK / DMIK",
    hint: "Pegá la tabla con las columnas Zona, FMIK S1, FMIK S2, DMIK S1, DMIK S2 (las columnas de KPI se ignoran).",
    cols: "Zona · FMIK S1 · FMIK S2 · DMIK S1 · DMIK S2",
  },
  {
    id: "pova",
    title: "POVA — Obras",
    hint: "Pegá la tabla de Obras con Zona, Transferido, Fin de obra, Creadas, Total obras.",
    cols: "Zona · Transferido · Fin de obra · Creadas · Total obras",
  },
  {
    id: "mant",
    title: "Mantenimiento",
    hint: "Pegá la tabla con Zona, Poda BT, Poda MT, Termografía (en %).",
    cols: "Zona · Poda BT · Poda MT · Termografía",
  },
];

const FIELD_LABELS: Record<string, string> = {
  fmik_s1: "FMIK S1", fmik_s2: "FMIK S2", dmik_s1: "DMIK S1", dmik_s2: "DMIK S2",
  pova_transferido: "Transf.", pova_fin_obra: "Fin obra", pova_creadas: "Creadas", pova_total: "Total",
  mant_poda_bt: "Poda BT", mant_poda_mt: "Poda MT", mant_termografia: "Termog.",
};

const ALL_FIELDS = [...TECNICO_FIELDS, ...POVA_FIELDS, ...MANT_FIELDS];

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return Number.isInteger(v) ? String(v) : v.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

export function IndiceIdoCargaSection() {
  const [periodo, setPeriodo] = useState(String(new Date().getFullYear()));
  const [texts, setTexts] = useState<Record<Bloque, string>>({ tecnico: "", pova: "", mant: "" });
  const [existing, setExisting] = useState<IdoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    const rows = await getRows(p);
    setExisting(rows);
    setLoading(false);
  }, []);

  useEffect(() => { load(periodo); }, [periodo, load]);

  // Parseo en vivo de cada bloque
  const parsed = useMemo(() => {
    const out: Partial<Record<Bloque, ParsedBlock>> = {};
    for (const b of BLOCKS) {
      if (texts[b.id].trim()) out[b.id] = parseBlock(texts[b.id], b.id);
    }
    return out;
  }, [texts]);

  // Vista previa: existentes + lo recién parseado (sin errores)
  const preview = useMemo(() => {
    const valid: Partial<Record<Bloque, ParsedBlock>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v && !v.error) valid[k as Bloque] = v;
    }
    return mergeRows(periodo, existing, valid);
  }, [periodo, existing, parsed]);

  const hasNewData = Object.values(parsed).some((p) => p && !p.error);

  async function handleSave() {
    const valid: Partial<Record<Bloque, ParsedBlock>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v && !v.error) valid[k as Bloque] = v;
    }
    if (Object.keys(valid).length === 0) {
      toast.error("No hay datos válidos para guardar.");
      return;
    }
    setSaving(true);
    const merged = mergeRows(periodo, existing, valid);
    const err = await saveRows(merged);
    setSaving(false);
    if (err) {
      toast.error(`Error al guardar: ${err}`);
      return;
    }
    toast.success(`Datos guardados para el período ${periodo}.`);
    setTexts({ tecnico: "", pova: "", mant: "" });
    load(periodo);
  }

  async function handleDelete(zona: string) {
    const err = await deleteRow(periodo, zona);
    if (err) { toast.error(`Error: ${err}`); return; }
    toast.success(`Zona ${zona} eliminada.`);
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
              Pegá las planillas del otro sistema. Se guardan los valores crudos; los KPIs e IDO se calculan en el Resumen.
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

      {/* Bloques de pegado */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {BLOCKS.map((b) => {
          const p = parsed[b.id];
          return (
            <div key={b.id} className="rounded-xl border border-border bg-card/40 p-4 flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{b.title}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{b.hint}</p>
                <p className="text-[11px] text-muted-foreground/70 mt-1 font-mono">{b.cols}</p>
              </div>
              <textarea
                value={texts[b.id]}
                onChange={(e) => setTexts((t) => ({ ...t, [b.id]: e.target.value }))}
                placeholder={`Pegá acá la tabla "${b.title}"…`}
                rows={6}
                className="w-full rounded-lg bg-secondary border border-border text-xs text-foreground p-2.5 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent placeholder:text-muted-foreground"
              />
              {/* Estado del parseo */}
              {p && (
                p.error ? (
                  <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{p.error}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{p.zonas.length} zona(s) detectada(s): {p.zonas.join(", ")}</span>
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!hasNewData || saving}
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
      </div>

      {/* Vista previa / datos guardados */}
      <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">
            Datos del período {periodo}
            {hasNewData && <span className="ml-2 text-xs text-accent font-normal">(incluye cambios sin guardar)</span>}
          </h3>
          <span className="ml-auto text-xs text-muted-foreground">{preview.length} zona(s)</span>
        </div>

        {preview.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {loading ? "Cargando…" : "Sin datos para este período. Pegá las planillas y guardá."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left font-medium px-3 py-2 sticky left-0 bg-card/80">Zona</th>
                  {ALL_FIELDS.map((f) => (
                    <th key={f} className="text-right font-medium px-3 py-2 whitespace-nowrap">{FIELD_LABELS[f]}</th>
                  ))}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.zona} className="border-b border-border/50 hover:bg-secondary/30">
                    <td className="px-3 py-2 font-semibold text-foreground sticky left-0 bg-card/80">{row.zona}</td>
                    {ALL_FIELDS.map((f) => (
                      <td key={f} className="px-3 py-2 text-right font-mono text-foreground/90 whitespace-nowrap">
                        {fmt((row as unknown as Record<string, number | null>)[f])}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => handleDelete(row.zona)}
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
        )}
      </div>
    </div>
  );
}
