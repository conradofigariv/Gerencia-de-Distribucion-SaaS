"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  UploadCloud, Loader2, Plus, Trash2, AlertCircle, CheckCircle2,
  ChevronLeft, ArrowRight, X, Info, ClipboardList, ArrowLeftRight, Package, Database,
} from "lucide-react";
import {
  getSeguimiento, upsertSeguimiento, deleteSeguimiento, deleteSeguimientoBulk, clearSeguimiento,
  getTableCount, replaceTable,
  normArticulo, parseNum, parseEntero, parseFechaArg,
} from "@/lib/tableroOp";
import type { SeguimientoRow, SeguimientoDbRow, TransaccionRow, StockRow } from "@/lib/tableroOp";

// ─── Pestañas ────────────────────────────────────────────────────────────────

type Tab = "seguimiento" | "transacciones" | "stock";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "seguimiento",   label: "SIC a seguir",  icon: ClipboardList },
  { id: "transacciones", label: "Transacciones", icon: ArrowLeftRight },
  { id: "stock",         label: "Stock",         icon: Package },
];

// ─── Helpers de pegado tab-separado ──────────────────────────────────────────

interface ParsedRow<T> {
  row: T;
  display: string[];
  errors: string[];
  // Motivo de exclusión intencional (no es un error de datos — ej. movimiento
  // interno sin Número Pedido). Se excluye del guardado igual que un error,
  // pero se muestra distinto (gris, no rojo) para no alarmar al usuario.
  omitted?: string;
}

function splitLines(text: string): string[] {
  return text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
}

// ─── Parser por encabezado (mapea columnas por NOMBRE, robusto al orden) ─────
// Los exports de SIGA traen muchas columnas extra y en otro orden. Detectamos
// la fila de encabezado y mapeamos cada campo por el nombre de su columna. Si
// no se reconoce el encabezado, se cae a posiciones fijas (orden documentado).

type Spec = Record<string, (h: string) => boolean>;

function buildHeaderIndex(headerCells: string[], specs: Spec): Record<string, number> {
  const idx: Record<string, number> = {};
  headerCells.forEach((cell, i) => {
    for (const key in specs) {
      if (idx[key] === undefined && specs[key](cell)) idx[key] = i;
    }
  });
  return idx;
}

// Recorre las filas con un accessor get(key) que resuelve la columna por
// nombre (si hay encabezado) o por posición fija (fallback). `required` define
// qué columnas deben existir para considerar la 1ª fila como encabezado.
function parseByHeader<T>(
  text: string,
  specs: Spec,
  required: string[],
  defaultIdx: Record<string, number>,
  build: (get: (key: string) => string) => ParsedRow<T>
): ParsedRow<T>[] {
  const lines = splitLines(text);
  if (!lines.length) return [];
  const header = lines[0].split("\t").map((c) => c.trim());
  const hidx = buildHeaderIndex(header, specs);
  const headerOk = required.every((k) => hidx[k] !== undefined);
  const idx = headerOk ? hidx : defaultIdx;
  const dataLines = headerOk ? lines.slice(1) : lines;
  return dataLines.map((line) => {
    const cells = line.split("\t").map((c) => c.trim());
    const get = (key: string) => (idx[key] === undefined ? "" : (cells[idx[key]] ?? ""));
    return build(get);
  });
}

// ════════════════════════════════════════════════════════════════
// SIC a seguir — pegado manual con clave numero_sic (upsert / replace)
//
// El usuario pega directamente su planilla de seguimiento (ej. la pestaña
// "GD" del Excel del sistema), que trae las 8 columnas fuente MÁS columnas
// calculadas (Proveedor, Control, STOCK, Recibido, ..., DESDE/HASTA) que ya
// resuelve gd_tablero(). Se reconocen por encabezado y se descartan las extra.
// ════════════════════════════════════════════════════════════════

const SEG_COLS = [
  "Número", "Línea", "Artículo", "Descripción", "Cantidad", "UDM", "Ctd Entregada", "Número Pedido",
] as const;

const SEG_SPECS: Spec = {
  numero_sic:    (h) => /^n[uú]mero( sic)?$/i.test(h) || /^sic$/i.test(h),
  linea:         (h) => /^l[ií]nea$/i.test(h),
  articulo:      (h) => /art[ií]culo/i.test(h),
  descripcion:   (h) => /descrip/i.test(h),
  cantidad:      (h) => /^cantidad$/i.test(h),
  udm:           (h) => /^udm$/i.test(h) || /^unidad( primaria)?$/i.test(h),
  ctd_entregada: (h) => /entregad/i.test(h),
  numero_op:     (h) => /pedido/i.test(h),
};
const SEG_DEFAULT_IDX = { numero_sic: 0, linea: 1, articulo: 2, descripcion: 3, cantidad: 4, udm: 5, ctd_entregada: 6, numero_op: 7 };

const parseSeguimiento = (text: string): ParsedRow<SeguimientoRow>[] =>
  parseByHeader<SeguimientoRow>(text, SEG_SPECS, ["numero_sic", "articulo"], SEG_DEFAULT_IDX, (get) => {
    const numero_sic = parseEntero(get("numero_sic"));
    const articulo   = normArticulo(get("articulo"));
    const errors: string[] = [];
    if (numero_sic === null) errors.push("SIC inválido o vacío");
    if (!articulo)           errors.push("Artículo vacío");
    const row: SeguimientoRow = {
      numero_sic:    numero_sic ?? 0,
      linea:         get("linea") || null,
      articulo,
      descripcion:   get("descripcion") || null,
      cantidad:      parseNum(get("cantidad")),
      udm:           get("udm") || null,
      ctd_entregada: parseNum(get("ctd_entregada")) ?? 0,
      numero_op:     parseEntero(get("numero_op")),
    };
    return {
      row,
      display: [
        String(row.numero_sic || ""), row.linea ?? "", row.articulo, row.descripcion ?? "",
        row.cantidad != null ? String(row.cantidad) : "", row.udm ?? "", String(row.ctd_entregada),
        row.numero_op != null ? String(row.numero_op) : "",
      ],
      errors,
    };
  });

function SeguimientoTab() {
  type Step = "input" | "preview";

  const [step, setStep]       = useState<Step>("input");
  const [raw, setRaw]         = useState("");
  const [preview, setPreview] = useState<ParsedRow<SeguimientoRow>[]>([]);
  const [rows, setRows]       = useState<SeguimientoDbRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
    let parsed: ParsedRow<SeguimientoRow>[];
    try {
      parsed = parseSeguimiento(raw);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!parsed.length) { toast.error("No se detectaron filas."); return; }

    // Detecta duplicados dentro del pegado. La clave única es
    // (numero_sic, linea, numero_op). Una SIC puede traer varias líneas
    // (distintos artículos) o líneas ampliadas (1,1 / 2,2) — eso NO es error.
    // Si SIC+línea se repiten con distinta OP → el sistema generó dos OPs para
    // la misma línea; no es error del pegado, se importa la última.
    // Si SIC+línea+OP son idénticos → error del sistema de origen (EPEC): la
    // fila está repetida textualmente y no debería estar.
    const sicLineaOp = new Map<string, Set<string>>();
    const keyOf = (r: ParsedRow<SeguimientoRow>) =>
      `${r.row.numero_sic}|${r.row.linea ?? ""}`;
    const opOf = (r: ParsedRow<SeguimientoRow>) =>
      String(r.row.numero_op ?? "");
    parsed.forEach((r) => {
      if (!r.row.numero_sic) return;
      const k = keyOf(r);
      if (!sicLineaOp.has(k)) sicLineaOp.set(k, new Set());
      sicLineaOp.get(k)!.add(opOf(r));
    });
    parsed.forEach((r) => {
      if (!r.row.numero_sic) return;
      const ops = sicLineaOp.get(keyOf(r))!;
      if (ops.size > 1) return; // misma SIC+línea pero distinta OP → OK
      // misma SIC+línea+OP (filas idénticas) → error del sistema de origen
      const count = parsed.filter(x => keyOf(x) === keyOf(r) && opOf(x) === opOf(r)).length;
      if (count > 1) {
        r.errors.push("SIC, línea y OP iguales — fila repetida en el sistema de origen");
      }
    });

    setPreview(parsed);
    setStep("preview");
  };

  // El import SOLO agrega/actualiza (upsert por numero_sic + linea + numero_op).
  // Nunca borra: así las entradas manuales (SIC que no salen del export) conviven
  // con las importadas y no se pisan al volver a pegar. El borrado es siempre
  // explícito (por fila / selección / "Limpiar todo").
  const handleSave = async () => {
    const valid = preview.filter((r) => r.errors.length === 0);
    if (!valid.length) { toast.error("No hay filas válidas para guardar."); return; }
    setSaving(true);
    try {
      // Deduplicar por (numero_sic, linea, numero_op) antes del upsert: si hay
      // dos filas válidas con la MISMA clave completa, Postgres rechaza el batch
      // con "cannot affect row a second time". Quedamos con la última ocurrencia.
      // OJO: distinta OP = clave distinta = NO se deduplica (una línea puede
      // estar cubierta por varias OPs — ampliación/recompra).
      const deduped = new Map<string, SeguimientoRow>();
      for (const r of valid) {
        deduped.set(`${r.row.numero_sic}|${r.row.linea ?? ""}|${r.row.numero_op ?? ""}`, r.row);
      }
      const toSave = [...deduped.values()];
      await upsertSeguimiento(toSave);
      toast.success(`${toSave.length} fila(s) agregada(s) / actualizada(s) en seguimiento.`);
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

  const handleDelete = async (id: string) => {
    try {
      await deleteSeguimiento(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      setSelected((prev) => { const s = new Set(prev); s.delete(id); return s; });
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
      setRows((prev) => prev.filter((r) => !selected.has(r.id)));
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
    const errCount = preview.filter((r) => r.errors.length > 0).length;
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
            <button onClick={() => handleSave()} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Agregar a seguimiento
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
                  const hasErr = r.errors.length > 0;
                  const row = r.row;
                  return (
                    <React.Fragment key={i}>
                      <tr className={cn("border-b border-border/50", hasErr ? "bg-destructive/5" : "hover:bg-secondary/20")}>
                        <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                        <td className="py-2 px-3 font-mono">{row.numero_sic || "—"}</td>
                        <td className="py-2 px-3">{row.linea ?? "—"}</td>
                        <td className="py-2 px-3 font-mono">{row.articulo || "—"}</td>
                        <td className="py-2 px-3 max-w-[200px] truncate" title={row.descripcion ?? ""}>{row.descripcion ?? "—"}</td>
                        <td className="py-2 px-3 text-right font-mono">{row.cantidad ?? "—"}</td>
                        <td className="py-2 px-3">{row.udm ?? "—"}</td>
                        <td className="py-2 px-3 text-right font-mono">{row.ctd_entregada}</td>
                        <td className="py-2 px-3 font-mono">{row.numero_op ?? "—"}</td>
                      </tr>
                      {hasErr && (
                        <tr className="bg-destructive/5 border-b border-destructive/10">
                          <td colSpan={SEG_COLS.length + 1} className="px-4 py-1.5">
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
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/40 border border-border rounded-lg px-3 py-2.5">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-accent" />
        <span>
          Pegá las SIC que querés seguir <strong className="text-foreground/80">incluyendo la fila de encabezado</strong> —
          las columnas se reconocen por su nombre (<strong className="text-foreground/80">{SEG_COLS.join(" · ")}</strong>),
          sin importar el orden ni las columnas extra que traiga el export (Proveedor, Control, STOCK, Recibido, etc. se
          descartan automáticamente — son las que calcula el Resumen). El sufijo «.0» del artículo se quita
          automáticamente. Se guarda por <strong className="text-foreground/80">Número + Línea</strong> — una SIC puede
          traer varias líneas (distintos artículos pedidos juntos) o líneas «ampliadas» al recomprar/recontratar
          (ej. 1,1 / 2,2); eso no es un duplicado. El import <strong className="text-foreground/80">solo agrega o
          actualiza</strong>: nunca borra, así tus <strong className="text-foreground/80">entradas manuales</strong> (SIC
          que no salen del export) quedan siempre a salvo. Para quitar filas, usá el borrado por fila o «Limpiar todo».
        </span>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={`Pegá con encabezado:\nNúmero\tLínea\tArtículo\tDescripción\tCantidad\tUDM\tCtd Entregada\tNúmero Pedido\n102345\t1\t00013242.0\tCABLE PREENS 3X95\t100\tMT\t40\t900123`}
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
                      onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
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
                  <tr key={r.id} className={cn("border-b border-border/50 transition-colors", selected.has(r.id) ? "bg-accent/5" : "hover:bg-secondary/20")}>
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={(e) => setSelected((prev) => {
                          const s = new Set(prev);
                          if (e.target.checked) s.add(r.id); else s.delete(r.id);
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
                      <button onClick={() => handleDelete(r.id)}
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
    let parsed: ParsedRow<T>[];
    try {
      parsed = parse(raw);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!parsed.length) { toast.error("No se detectaron filas."); return; }
    setPreview(parsed);
  };

  const handleReplace = async () => {
    if (!preview) return;
    const valid = preview.filter((r) => r.errors.length === 0 && !r.omitted);
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
        const errCount     = preview.filter((r) => r.errors.length > 0).length;
        const omittedCount = preview.filter((r) => r.errors.length === 0 && r.omitted).length;
        const okCount      = preview.length - errCount - omittedCount;
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
              {omittedCount > 0 && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary/60 border border-border px-3 py-1.5 rounded-lg">
                  <Info className="w-3.5 h-3.5" />{omittedCount} movimiento(s) interno(s) (se omiten)
                </span>
              )}
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
                      const hasErr    = r.errors.length > 0;
                      const isOmitted = !hasErr && !!r.omitted;
                      return (
                        <React.Fragment key={i}>
                          <tr className={cn(
                            "border-b border-border/50",
                            hasErr ? "bg-destructive/5" : isOmitted ? "bg-secondary/20 opacity-70" : "hover:bg-secondary/20"
                          )}>
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
                          {isOmitted && (
                            <tr className="bg-secondary/10 border-b border-border/30">
                              <td colSpan={columns.length + 1} className="px-4 py-1.5">
                                <div className="flex items-start gap-1.5">
                                  <Info className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                                  <span className="text-[11px] text-muted-foreground">{r.omitted}</span>
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

// ─── Transacciones ───────────────────────────────────────────────────────────

const TRANSACCION_COLS = ["Tipo", "Importe", "Fecha", "Artículo", "Número Pedido", "Línea", "Proveedor"];

const TIPOS_DEVOLUCION = new Set(["Rechazar", "Devolver a Proveedor", "Devolver a Recepción", "Corregir"]);

const TRANSACCION_SPECS: Spec = {
  tipo:          (h) => /tipo/i.test(h),
  importe:       (h) => /importe|cantidad/i.test(h),
  fecha:         (h) => /fecha/i.test(h),
  articulo:      (h) => /art[ií]culo/i.test(h),
  numero_pedido: (h) => /pedido/i.test(h),
  linea:         (h) => /^l[ií]nea$/i.test(h),
  proveedor:     (h) => /^proveedor$/i.test(h), // exacto → no choca con "Lote Proveedores"
};
const TRANSACCION_DEFAULT_IDX = { tipo: 0, importe: 1, fecha: 2, articulo: 3, numero_pedido: 4, linea: 5, proveedor: 6 };

const parseTransacciones = (text: string): ParsedRow<TransaccionRow>[] =>
  parseByHeader<TransaccionRow>(
    text, TRANSACCION_SPECS,
    ["tipo", "importe", "fecha", "articulo", "numero_pedido"],
    TRANSACCION_DEFAULT_IDX,
    (get) => {
      const tipo          = get("tipo");
      const importe       = parseNum(get("importe"));
      const fecha         = parseFechaArg(get("fecha"));
      const articulo      = normArticulo(get("articulo"));
      const numeroPedidoRaw = get("numero_pedido");
      const numero_pedido   = parseEntero(numeroPedidoRaw);
      const errors: string[] = [];
      if (!tipo)            errors.push("Tipo vacío");
      if (importe === null) errors.push("Importe inválido");
      if (!fecha)           errors.push("Fecha inválida");
      if (!articulo)        errors.push("Artículo vacío");

      let omitted: string | undefined;
      if (numero_pedido === null) {
        if (!numeroPedidoRaw.trim() && errors.length === 0) {
          // Sin Número Pedido y el resto de la fila es válida → movimiento
          // interno (transferencia entre zonas, sin OP asociada). No se puede
          // cruzar con ninguna SIC → se omite a propósito, no es un error.
          omitted = "Movimiento interno (sin Número Pedido) — se omite";
        } else {
          errors.push("Número de pedido inválido");
        }
      }
      const row: TransaccionRow = {
        tipo,
        importe: importe ?? 0,
        fecha: fecha ?? new Date().toISOString(),
        articulo,
        numero_pedido: numero_pedido ?? 0,
        linea: get("linea") || null,
        proveedor: get("proveedor") || null,
      };
      return {
        row,
        display: [tipo, importe != null ? String(importe) : "", fecha ?? "", articulo, numeroPedidoRaw || "—", row.linea ?? "", row.proveedor ?? ""],
        errors,
        omitted,
      };
    }
  );

// ─── Stock ───────────────────────────────────────────────────────────────────

const STOCK_COLS = ["Organización", "Artículo", "En Mano"];

const STOCK_SPECS: Spec = {
  organizacion: (h) => /organiz/i.test(h),
  articulo:     (h) => /art[ií]culo/i.test(h),
  en_mano:      (h) => /en\s*mano|cantidad|stock|saldo/i.test(h),
};
const STOCK_DEFAULT_IDX = { organizacion: 0, articulo: 1, en_mano: 2 };

const parseStock = (text: string): ParsedRow<StockRow>[] =>
  parseByHeader<StockRow>(text, STOCK_SPECS, ["organizacion", "articulo", "en_mano"], STOCK_DEFAULT_IDX, (get) => {
    const organizacion = get("organizacion");
    const articulo     = normArticulo(get("articulo"));
    const en_mano      = parseNum(get("en_mano"));
    const errors: string[] = [];
    if (!organizacion)    errors.push("Organización (zona) vacía");
    if (!articulo)        errors.push("Artículo vacío");
    if (en_mano === null) errors.push("En Mano inválido");
    const row: StockRow = { organizacion, articulo, en_mano: en_mano ?? 0 };
    return {
      row,
      display: [organizacion, articulo, en_mano != null ? String(en_mano) : ""],
      errors,
    };
  });

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
            SIC a seguir + datos fuente (Transacciones, Stock). La OP la toma de «Carga de datos». El cruce se calcula en el Resumen.
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
              Pegá la pestaña <strong className="text-foreground/80">Transacciones</strong> del Excel <strong className="text-foreground/80">incluyendo la fila de encabezado</strong> —
              las columnas se reconocen por su nombre (Tipo Transacción, Importe, Fecha, Artículo, Número Pedido, Línea, Proveedor…), sin importar el
              orden ni las columnas extra. Tipos relevantes: Recibir, Aceptar, Entregar, y devoluciones (
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
              Pegá la pestaña <strong className="text-foreground/80">Stock</strong> del Excel <strong className="text-foreground/80">incluyendo la fila de encabezado</strong> —
              las columnas se reconocen por su nombre (Organización, Artículo, En Mano/Cantidad…), sin importar el orden ni las columnas extra
              (Organización = zona, ej. ZA). <strong className="text-foreground/80">Reemplaza la tabla completa</strong> — subí siempre el saldo actual completo.
            </span>
          }
        />
      )}
    </div>
  );
}
