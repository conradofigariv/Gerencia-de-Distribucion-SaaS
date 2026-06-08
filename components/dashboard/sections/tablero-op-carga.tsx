"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  UploadCloud, Loader2, Plus, Trash2, AlertCircle, CheckCircle2,
  ChevronLeft, ArrowRight, X, Info, ClipboardList, FileText, ArrowLeftRight, Package, Database,
} from "lucide-react";
import {
  getSeguimiento, upsertSeguimiento, deleteSeguimiento, deleteSeguimientoBulk, clearSeguimiento,
  getTableCount, replaceTable,
  normArticulo, parseNum, parseEntero, parseFechaArg,
} from "@/lib/tableroOp";
import type { SeguimientoRow, OpRow, TransaccionRow, StockRow } from "@/lib/tableroOp";

// ─── Pestañas ────────────────────────────────────────────────────────────────

type Tab = "seguimiento" | "op" | "transacciones" | "stock";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "seguimiento",   label: "SIC a seguir",  icon: ClipboardList },
  { id: "op",            label: "OP's",          icon: FileText },
  { id: "transacciones", label: "Transacciones", icon: ArrowLeftRight },
  { id: "stock",         label: "Stock",         icon: Package },
];

// ─── Helpers de pegado tab-separado ──────────────────────────────────────────

interface ParsedRow<T> {
  row: T;
  display: string[];
  errors: string[];
}

function splitLines(text: string): string[] {
  return text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
}

function parsePasted<T>(
  text: string,
  isHeader: (cells: string[]) => boolean,
  mapRow: (cells: string[]) => ParsedRow<T>
): ParsedRow<T>[] {
  return splitLines(text).flatMap((line, idx) => {
    const cells = line.split("\t").map((c) => c.trim());
    if (idx === 0 && isHeader(cells)) return [];
    return [mapRow(cells)];
  });
}

// ════════════════════════════════════════════════════════════════
// SIC a seguir — pegado manual con clave numero_sic (upsert / replace)
// ════════════════════════════════════════════════════════════════

const SEG_COLS = [
  "SIC", "Línea", "Artículo", "Descripción", "Cantidad", "UDM", "Ctd. Entregada", "OP",
] as const;

function looksLikeSicHeader(cells: string[]): boolean {
  const first = (cells[0] ?? "").toLowerCase();
  return first.includes("sic") || first.includes("solicitud") || first === "numero_sic";
}

function mapSeguimientoRow(cells: string[]): SeguimientoRow & { _errors: string[] } {
  const numero_sic = parseEntero(cells[0]);
  const articulo   = normArticulo(cells[2]);
  const errors: string[] = [];
  if (numero_sic === null) errors.push("SIC inválido o vacío");
  if (!articulo)           errors.push("Artículo vacío");
  return {
    numero_sic:    numero_sic ?? 0,
    linea:         cells[1]?.trim() || null,
    articulo,
    descripcion:   cells[3]?.trim() || null,
    cantidad:      parseNum(cells[4]),
    udm:           cells[5]?.trim() || null,
    ctd_entregada: parseNum(cells[6]) ?? 0,
    numero_op:     parseEntero(cells[7]),
    _errors:       errors,
  };
}

function SeguimientoTab() {
  type Step = "input" | "preview";
  type PreviewRow = SeguimientoRow & { _errors: string[] };

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
    const lines = splitLines(raw);
    const parsed = lines.flatMap((line, idx) => {
      const cells = line.split("\t").map((c) => c.trim());
      if (idx === 0 && looksLikeSicHeader(cells)) return [];
      return [mapSeguimientoRow(cells)];
    });
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

  if (step === "preview") {
    const errCount = preview.filter((r) => r._errors.length > 0).length;
    const okCount  = preview.length - errCount;

    return (
      <div className="space-y-5">
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
                  {SEG_COLS.map((h) => (
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
                          <td colSpan={SEG_COLS.length + 1} className="px-4 py-1.5">
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

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/40 border border-border rounded-lg px-3 py-2.5">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-accent" />
        <span>
          Pegá las filas desde Excel (tab-separado), una por línea, en este orden:{" "}
          <strong className="text-foreground/80">{SEG_COLS.join(" · ")}</strong>. El sufijo «.0» del artículo se quita
          automáticamente. Se guarda por <strong className="text-foreground/80">SIC</strong> (clave única).
        </span>
      </div>

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
                  {SEG_COLS.map((h) => (
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

// ════════════════════════════════════════════════════════════════
// Panel genérico de import "pegar → previsualizar → reemplazar todo"
// (usado por OP's, Transacciones y Stock — tablas snapshot/log que se
// recargan completas en cada subida)
// ════════════════════════════════════════════════════════════════

function ImportPanel<T extends Record<string, unknown>>({
  table, notNullCol, columns, placeholder, hint, countLabel, parse,
}: {
  table:       string;
  notNullCol:  string;
  columns:     string[];
  placeholder: string;
  hint:        React.ReactNode;
  countLabel:  (n: number) => string;
  parse:       (text: string) => ParsedRow<T>[];
}) {
  const [raw, setRaw]                   = useState("");
  const [preview, setPreview]           = useState<ParsedRow<T>[] | null>(null);
  const [count, setCount]               = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(true);
  const [saving, setSaving]             = useState(false);

  const loadCount = async () => {
    setLoadingCount(true);
    try {
      setCount(await getTableCount(table));
    } catch (e) {
      toast.error(`Error al consultar ${table}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingCount(false);
    }
  };

  useEffect(() => { loadCount(); }, [table]);

  const handlePreview = () => {
    if (!raw.trim()) { toast.error("Pegá los datos primero."); return; }
    const parsed = parse(raw);
    if (!parsed.length) { toast.error("No se detectaron filas."); return; }
    setPreview(parsed);
  };

  const handleReplace = async () => {
    if (!preview) return;
    const valid = preview.filter((r) => r.errors.length === 0);
    if (!valid.length) { toast.error("No hay filas válidas para guardar."); return; }
    setSaving(true);
    try {
      await replaceTable(table, notNullCol, valid.map((r) => r.row));
      toast.success(`Tabla reemplazada — ${valid.length} fila(s) cargada(s).`);
      setRaw("");
      setPreview(null);
      await loadCount();
    } catch (e) {
      toast.error(`Error al guardar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/30 border border-border rounded-lg px-3 py-2.5">
        <Database className="w-3.5 h-3.5 text-accent shrink-0" />
        {loadingCount ? "Consultando estado actual…" : countLabel(count ?? 0)}
      </div>

      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/40 border border-border rounded-lg px-3 py-2.5">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-accent" />
        <div>{hint}</div>
      </div>

      {!preview && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={placeholder}
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
      )}

      {preview && (() => {
        const errCount = preview.filter((r) => r.errors.length > 0).length;
        const okCount  = preview.length - errCount;
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setPreview(null)}
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
              <div className="ml-auto">
                <button onClick={handleReplace} disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  Reemplazar todo
                </button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              «Reemplazar todo» borra los datos actuales de esta tabla y carga el pegado completo — subí siempre el archivo entero, no incrementos.
            </p>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/50 border-b border-border">
                    <tr>
                      <th className="py-2 px-3 text-left text-muted-foreground font-medium">#</th>
                      {columns.map((h) => (
                        <th key={h} className="py-2 px-3 text-left text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, i) => {
                      const hasErr = r.errors.length > 0;
                      return (
                        <React.Fragment key={i}>
                          <tr className={cn("border-b border-border/50", hasErr ? "bg-destructive/5" : "hover:bg-secondary/20")}>
                            <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                            {r.display.map((v, j) => (
                              <td key={j} className="py-2 px-3 max-w-[220px] truncate font-mono" title={v}>{v || "—"}</td>
                            ))}
                          </tr>
                          {hasErr && (
                            <tr className="bg-destructive/5 border-b border-destructive/10">
                              <td colSpan={columns.length + 1} className="px-4 py-1.5">
                                <div className="flex items-start gap-1.5">
                                  <AlertCircle className="w-3 h-3 text-destructive shrink-0 mt-0.5" />
                                  <span className="text-[11px] text-destructive">{r.errors.join(" · ")}</span>
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
      })()}
    </div>
  );
}

// ─── OP's ────────────────────────────────────────────────────────────────────

const OP_COLS = ["Número", "Línea", "Artículo", "Descripción", "UDM", "Cantidad", "Proveedor"];

function mapOpRow(cells: string[]): ParsedRow<OpRow> {
  const numero    = parseEntero(cells[0]);
  const articulo  = cells[2]?.trim() ? normArticulo(cells[2]) : null;
  const errors: string[] = [];
  if (numero === null) errors.push("Número inválido o vacío");
  const row: OpRow = {
    numero:      numero ?? 0,
    linea:       cells[1]?.trim() || null,
    articulo,
    descripcion: cells[3]?.trim() || null,
    udm:         cells[4]?.trim() || null,
    cantidad:    parseNum(cells[5]),
    proveedor:   cells[6]?.trim() || null,
  };
  return {
    row,
    display: [String(row.numero || ""), row.linea ?? "", row.articulo ?? "", row.descripcion ?? "", row.udm ?? "", row.cantidad != null ? String(row.cantidad) : "", row.proveedor ?? ""],
    errors,
  };
}

const parseOp = (text: string): ParsedRow<OpRow>[] =>
  parsePasted(text, (c) => /n[uú]mero|pedido/i.test(c[0] ?? ""), mapOpRow);

// ─── Transacciones ───────────────────────────────────────────────────────────

const TRANSACCION_COLS = ["Tipo", "Importe", "Fecha", "Artículo", "Número Pedido", "Línea", "Proveedor"];

const TIPOS_DEVOLUCION = new Set(["Rechazar", "Devolver a Proveedor", "Devolver a Recepción", "Corregir"]);

function mapTransaccionRow(cells: string[]): ParsedRow<TransaccionRow> {
  const tipo          = cells[0]?.trim() || "";
  const importe       = parseNum(cells[1]);
  const fecha         = parseFechaArg(cells[2]);
  const articulo      = normArticulo(cells[3]);
  const numero_pedido = parseEntero(cells[4]);
  const errors: string[] = [];
  if (!tipo)                errors.push("Tipo vacío");
  if (importe === null)     errors.push("Importe inválido");
  if (!fecha)               errors.push("Fecha inválida");
  if (!articulo)            errors.push("Artículo vacío");
  if (numero_pedido === null) errors.push("Número de pedido inválido");
  const row: TransaccionRow = {
    tipo,
    importe: importe ?? 0,
    fecha: fecha ?? new Date().toISOString(),
    articulo,
    numero_pedido: numero_pedido ?? 0,
    linea: cells[5]?.trim() || null,
    proveedor: cells[6]?.trim() || null,
  };
  return {
    row,
    display: [tipo, importe != null ? String(importe) : "", fecha ?? "", articulo, String(numero_pedido ?? ""), row.linea ?? "", row.proveedor ?? ""],
    errors,
  };
}

const parseTransacciones = (text: string): ParsedRow<TransaccionRow>[] =>
  parsePasted(text, (c) => /^tipo$/i.test((c[0] ?? "").trim()), mapTransaccionRow);

// ─── Stock ───────────────────────────────────────────────────────────────────

const STOCK_COLS = ["Organización", "Artículo", "En Mano"];

function mapStockRow(cells: string[]): ParsedRow<StockRow> {
  const organizacion = cells[0]?.trim() || "";
  const articulo     = normArticulo(cells[1]);
  const en_mano      = parseNum(cells[2]);
  const errors: string[] = [];
  if (!organizacion)   errors.push("Organización (zona) vacía");
  if (!articulo)       errors.push("Artículo vacío");
  if (en_mano === null) errors.push("En Mano inválido");
  const row: StockRow = { organizacion, articulo, en_mano: en_mano ?? 0 };
  return {
    row,
    display: [organizacion, articulo, en_mano != null ? String(en_mano) : ""],
    errors,
  };
}

const parseStock = (text: string): ParsedRow<StockRow>[] =>
  parsePasted(text, (c) => /organiz/i.test(c[0] ?? ""), mapStockRow);

// ════════════════════════════════════════════════════════════════
// Sección principal
// ════════════════════════════════════════════════════════════════

export function TableroOpCargaSection() {
  const [tab, setTab] = useState<Tab>("seguimiento");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <UploadCloud className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Tablero OP — Carga de datos</h2>
          <p className="text-sm text-muted-foreground">
            Lista de SIC a seguir + datos fuente (OP's, Transacciones, Stock). El cruce se calcula en el Resumen.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-3 flex-wrap">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              )}
            >
              <Icon className="w-4 h-4" />{t.label}
            </button>
          );
        })}
      </div>

      {tab === "seguimiento" && <SeguimientoTab />}

      {tab === "op" && (
        <ImportPanel
          table="tablero_op_op"
          notNullCol="numero"
          columns={OP_COLS}
          countLabel={(n) => `${n.toLocaleString("es-AR")} línea(s) de OP cargadas`}
          placeholder={`Ej.:\n900123\t1\t00013242.0\tCABLE PREENS 3X95\tMT\t100\tACME S.A.`}
          parse={parseOp}
          hint={
            <span>
              Pegá la pestaña <strong className="text-foreground/80">OP&apos;s</strong> del Excel (tab-separado), una fila por línea, en
              este orden: <strong className="text-foreground/80">{OP_COLS.join(" · ")}</strong>. Es el maestro de líneas
              (Número Pedido = OP). <strong className="text-foreground/80">Reemplaza la tabla completa</strong> — subí siempre el archivo entero.
            </span>
          }
        />
      )}

      {tab === "transacciones" && (
        <ImportPanel
          table="tablero_op_transaccion"
          notNullCol="id"
          columns={TRANSACCION_COLS}
          countLabel={(n) => `${n.toLocaleString("es-AR")} transacción(es) cargadas`}
          placeholder={`Ej.:\nRecibir\t100\t15/04/2026 11:59:58\t00013242.0\t900123\t1\tACME S.A.`}
          parse={parseTransacciones}
          hint={
            <span>
              Pegá la pestaña <strong className="text-foreground/80">Transacciones</strong> del Excel (tab-separado), una fila por
              línea, en este orden: <strong className="text-foreground/80">{TRANSACCION_COLS.join(" · ")}</strong>.
              Tipos relevantes: Recibir, Aceptar, Entregar, y devoluciones (
              {[...TIPOS_DEVOLUCION].join(", ")}). Fecha en formato <code className="text-foreground/80">dd/mm/aaaa hh:mm:ss</code>.{" "}
              <strong className="text-foreground/80">Reemplaza la tabla completa</strong> — al ser un log que crece rápido (60k+ filas),
              subí siempre el export completo y actualizado.
            </span>
          }
        />
      )}

      {tab === "stock" && (
        <ImportPanel
          table="tablero_op_stock"
          notNullCol="organizacion"
          columns={STOCK_COLS}
          countLabel={(n) => `${n.toLocaleString("es-AR")} fila(s) de stock cargadas`}
          placeholder={`Ej.:\nZA\t00013242.0\t250`}
          parse={parseStock}
          hint={
            <span>
              Pegá la pestaña <strong className="text-foreground/80">Stock</strong> del Excel (tab-separado), una fila por línea, en
              este orden: <strong className="text-foreground/80">{STOCK_COLS.join(" · ")}</strong> (Organización = zona, ej. ZA).{" "}
              <strong className="text-foreground/80">Reemplaza la tabla completa</strong> — subí siempre el saldo actual completo.
            </span>
          }
        />
      )}
    </div>
  );
}
