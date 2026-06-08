"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  UploadCloud, Loader2, Plus, Trash2, AlertCircle, CheckCircle2,
  ChevronLeft, ArrowRight, X, Info,
} from "lucide-react";
import {
  getSeguimiento, upsertSeguimiento, deleteSeguimiento,
  deleteSeguimientoBulk, clearSeguimiento,
  normArticulo, parseNum, parseEntero,
} from "@/lib/tableroOp";
import type { SeguimientoRow } from "@/lib/tableroOp";

type Step = "input" | "preview";

interface PreviewRow extends SeguimientoRow {
  _errors: string[];
}

// Orden de columnas esperado al pegar (tab-separado desde Excel).
const COLS = [
  "SIC", "Línea", "Artículo", "Descripción", "Cantidad", "UDM", "Ctd. Entregada", "OP",
] as const;

// Detecta si la primera fila pegada es un encabezado (para ignorarla).
function looksLikeHeader(cells: string[]): boolean {
  const first = (cells[0] ?? "").toLowerCase();
  return first.includes("sic") || first.includes("solicitud") || first === "numero_sic";
}

function parseTSV(text: string): PreviewRow[] {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l).filter((l) => l.trim() !== "");
  const rows: PreviewRow[] = [];
  lines.forEach((line, idx) => {
    const cells = line.split("\t").map((c) => c.trim());
    if (idx === 0 && looksLikeHeader(cells)) return;

    const numero_sic = parseEntero(cells[0]);
    const articulo   = normArticulo(cells[2]);

    const errs: string[] = [];
    if (numero_sic === null) errs.push("SIC inválido o vacío");
    if (!articulo)           errs.push("Artículo vacío");

    rows.push({
      numero_sic:    numero_sic ?? 0,
      linea:         cells[1]?.trim() || null,
      articulo,
      descripcion:   cells[3]?.trim() || null,
      cantidad:      parseNum(cells[4]),
      udm:           cells[5]?.trim() || null,
      ctd_entregada: parseNum(cells[6]) ?? 0,
      numero_op:     parseEntero(cells[7]),
      _errors:       errs,
    });
  });
  return rows;
}

export function TableroOpCargaSection() {
  const [step, setStep]       = useState<Step>("input");
  const [raw, setRaw]         = useState("");
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [rows, setRows]       = useState<SeguimientoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deletingSel, setDeletingSel] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await getSeguimiento());
    } catch (e) {
      toast.error(`Error al cargar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handlePreview = () => {
    if (!raw.trim()) { toast.error("Pegá la lista de SIC primero."); return; }
    const parsed = parseTSV(raw);
    if (!parsed.length) { toast.error("No se detectaron filas."); return; }

    // Detecta SIC duplicados dentro del pegado (la PK los colapsaría).
    const seen = new Map<number, number>();
    parsed.forEach((r) => {
      if (r.numero_sic) seen.set(r.numero_sic, (seen.get(r.numero_sic) ?? 0) + 1);
    });
    parsed.forEach((r) => {
      if (r.numero_sic && (seen.get(r.numero_sic) ?? 0) > 1) {
        r._errors.push("SIC duplicado en el pegado");
      }
    });

    setPreview(parsed);
    setStep("preview");
  };

  const handleSave = async (mode: "replace" | "accumulate") => {
    const valid = preview.filter((r) => r._errors.length === 0);
    if (!valid.length) { toast.error("No hay filas válidas para guardar."); return; }
    setSaving(true);
    try {
      if (mode === "replace") await clearSeguimiento();
      const toSave: SeguimientoRow[] = valid.map(({ _errors: _e, ...r }) => r);
      await upsertSeguimiento(toSave);
      toast.success(`${toSave.length} fila(s) guardada(s) en seguimiento.`);
      setRaw("");
      setPreview([]);
      setStep("input");
      await load();
    } catch (e) {
      toast.error(`Error al guardar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (numeroSic: number) => {
    try {
      await deleteSeguimiento(numeroSic);
      setRows((prev) => prev.filter((r) => r.numero_sic !== numeroSic));
      setSelected((prev) => { const s = new Set(prev); s.delete(numeroSic); return s; });
    } catch (e) {
      toast.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDeleteSelected = async () => {
    if (!selected.size) return;
    setDeletingSel(true);
    try {
      const ids = [...selected];
      await deleteSeguimientoBulk(ids);
      setRows((prev) => prev.filter((r) => !selected.has(r.numero_sic)));
      setSelected(new Set());
      toast.success(`${ids.length} fila(s) eliminada(s).`);
    } catch (e) {
      toast.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeletingSel(false);
    }
  };

  const handleClearAll = async () => {
    setClearing(true);
    try {
      await clearSeguimiento();
      setRows([]);
      setSelected(new Set());
      toast.success("Todas las filas eliminadas.");
    } catch (e) {
      toast.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setClearing(false);
    }
  };

  // ── Header (compartido) ──
  const header = (
    <div className="flex items-center gap-3">
      <div className="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
        <UploadCloud className="w-5 h-5 text-accent" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-foreground">Tablero OP — Carga de datos</h2>
        <p className="text-sm text-muted-foreground">
          Lista manual de SIC (líneas) a seguir. El cruce contra transacciones y stock se hace en el Resumen.
        </p>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════
  // PREVIEW STEP
  // ════════════════════════════════════════════════════════════════
  if (step === "preview") {
    const errCount = preview.filter((r) => r._errors.length > 0).length;
    const okCount  = preview.length - errCount;

    return (
      <div className="space-y-5">
        {header}

        <div className="flex items-center gap-3">
          <button onClick={() => setStep("input")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" />Volver
          </button>
          <h3 className="text-sm font-semibold text-foreground">Preview — {preview.length} fila(s)</h3>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs text-success bg-success/10 border border-success/20 px-3 py-1.5 rounded-lg">
            <CheckCircle2 className="w-3.5 h-3.5" />{okCount} válida(s)
          </span>
          {errCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 border border-destructive/20 px-3 py-1.5 rounded-lg">
              <AlertCircle className="w-3.5 h-3.5" />{errCount} con errores (se omiten)
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => handleSave("accumulate")} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-border hover:bg-secondary/80 text-foreground text-sm font-medium transition-all disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Agregar / actualizar
            </button>
            <button onClick={() => handleSave("replace")} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Reemplazar todo
            </button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-secondary/50 border-b border-border">
                <tr>
                  <th className="py-2 px-3 text-left text-muted-foreground font-medium">#</th>
                  {COLS.map((h) => (
                    <th key={h} className="py-2 px-3 text-left text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => {
                  const hasErr = r._errors.length > 0;
                  return (
                    <React.Fragment key={i}>
                      <tr className={cn("border-b border-border/50", hasErr ? "bg-destructive/5" : "hover:bg-secondary/20")}>
                        <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                        <td className="py-2 px-3 font-mono">{r.numero_sic || "—"}</td>
                        <td className="py-2 px-3">{r.linea ?? "—"}</td>
                        <td className="py-2 px-3 font-mono">{r.articulo || "—"}</td>
                        <td className="py-2 px-3 max-w-[200px] truncate" title={r.descripcion ?? ""}>{r.descripcion ?? "—"}</td>
                        <td className="py-2 px-3 text-right font-mono">{r.cantidad ?? "—"}</td>
                        <td className="py-2 px-3">{r.udm ?? "—"}</td>
                        <td className="py-2 px-3 text-right font-mono">{r.ctd_entregada}</td>
                        <td className="py-2 px-3 font-mono">{r.numero_op ?? "—"}</td>
                      </tr>
                      {hasErr && (
                        <tr className="bg-destructive/5 border-b border-destructive/10">
                          <td colSpan={COLS.length + 1} className="px-4 py-1.5">
                            <div className="flex items-start gap-1.5">
                              <AlertCircle className="w-3 h-3 text-destructive shrink-0 mt-0.5" />
                              <span className="text-[11px] text-destructive">{r._errors.join(" · ")}</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // INPUT STEP
  // ════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {header}

      {/* Ayuda */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/40 border border-border rounded-lg px-3 py-2.5">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-accent" />
        <span>
          Pegá las filas desde Excel (tab-separado), una por línea, en este orden:{" "}
          <strong className="text-foreground/80">{COLS.join(" · ")}</strong>. El sufijo «.0» del artículo se quita
          automáticamente. Se guarda por <strong className="text-foreground/80">SIC</strong> (clave única).
        </span>
      </div>

      {/* Pegar */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={`Ej.:\n102345\t1\t00013242.0\tCABLE PREENS 3X95\t100\tMT\t40\t900123\n102346\t1\t00099887.0\tMORSETO\t50\tUN\t0\t`}
          rows={10}
          className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent resize-y transition-all font-mono"
        />
        <div className="flex justify-end">
          <button onClick={handlePreview}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all">
            <ArrowRight className="w-4 h-4" />Previsualizar
          </button>
        </div>
      </div>

      {/* Tabla de existentes */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-secondary/30">
          <span className="text-xs text-muted-foreground">
            {loading
              ? "Cargando…"
              : selected.size > 0
                ? `${selected.size} seleccionada(s)`
                : `${rows.length} SIC en seguimiento`}
          </span>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <button onClick={handleDeleteSelected} disabled={deletingSel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors disabled:opacity-50">
                {deletingSel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Eliminar seleccionadas
              </button>
            )}
            {rows.length > 0 && (
              <button onClick={handleClearAll} disabled={clearing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50">
                {clearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                Limpiar todo
              </button>
            )}
          </div>
        </div>

        {!loading && rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Sin SIC cargadas. Pegá la lista arriba para empezar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-secondary/50 border-b border-border">
                <tr>
                  <th className="py-2 px-3 w-8">
                    <input
                      type="checkbox"
                      checked={selected.size === rows.length && rows.length > 0}
                      ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < rows.length; }}
                      onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.numero_sic)) : new Set())}
                      className="accent-accent w-3.5 h-3.5 cursor-pointer"
                    />
                  </th>
                  {COLS.map((h) => (
                    <th key={h} className="py-2 px-3 text-left text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                  <th className="py-2 px-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.numero_sic} className={cn("border-b border-border/50 transition-colors", selected.has(r.numero_sic) ? "bg-accent/5" : "hover:bg-secondary/20")}>
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={selected.has(r.numero_sic)}
                        onChange={(e) => setSelected((prev) => {
                          const s = new Set(prev);
                          if (e.target.checked) s.add(r.numero_sic); else s.delete(r.numero_sic);
                          return s;
                        })}
                        className="accent-accent w-3.5 h-3.5 cursor-pointer"
                      />
                    </td>
                    <td className="py-2 px-3 font-mono">{r.numero_sic}</td>
                    <td className="py-2 px-3">{r.linea ?? "—"}</td>
                    <td className="py-2 px-3 font-mono">{r.articulo}</td>
                    <td className="py-2 px-3 max-w-[200px] truncate" title={r.descripcion ?? ""}>{r.descripcion ?? "—"}</td>
                    <td className="py-2 px-3 text-right font-mono">{r.cantidad ?? "—"}</td>
                    <td className="py-2 px-3">{r.udm ?? "—"}</td>
                    <td className="py-2 px-3 text-right font-mono">{r.ctd_entregada}</td>
                    <td className="py-2 px-3 font-mono">{r.numero_op ?? "—"}</td>
                    <td className="py-2 px-3">
                      <button onClick={() => handleDelete(r.numero_sic)}
                        className="text-muted-foreground hover:text-destructive transition-colors">
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
