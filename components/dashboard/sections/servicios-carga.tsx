"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  Loader2, Plus, Trash2, AlertCircle, CheckCircle2,
  ChevronLeft, ArrowRight,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = "input" | "preview";

interface FilaManual {
  id:        string;
  op:        number;
  op_madre:  number;
  linea:     number;
  matricula: string;
}

interface PreviewRow {
  zona:                   string;
  op:                     number;
  op_madre:               number;
  sc:                     string;
  descripcion_sc:         string;
  linea:                  number;
  matricula:              string;
  descripcion_matricula:  string;
  cantidad:               number;
  cantidad_recibida:      number;
  saldo_linea:            number;
  fecha_pactada:          string | null;
  proveedor:              string;
  fecha_redeterminacion:  null;
  precio_redeterminacion: number | null;
  estado:                 string;
  estado_plazo:           string;
  estado_cantidades:      string;
  revision:               string;
  observacion:            null;
  disponibilidad_meses:   number;
  _errors:                string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const splitCol = (t: string) => t.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
const EMPTY = { op: "", op_madre: "", linea: "1", matricula: "" };
const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const isoDate = (d: Date | null) => d ? d.toISOString().split("T")[0] : null;

// Trae TODAS las filas de una tabla paginando de a 1000
async function fetchAll<T extends Record<string, unknown>>(
  table: string,
  columns: string
): Promise<T[]> {
  const PAGE = 1000;
  const result: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Error cargando ${table}: ${error.message}`);
    if (!data?.length) break;
    result.push(...(data as unknown as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ServiciosCargaSection() {
  const [step, setStep]       = useState<Step>("input");
  const [filas, setFilas]     = useState<FilaManual[]>([]);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [mode, setMode]       = useState<"single" | "bulk">("single");
  const [form, setForm]       = useState(EMPTY);
  const [errors, setErrors]   = useState<Partial<typeof EMPTY>>({});
  const [bulk, setBulk]       = useState({ op: "", op_madre: "", linea: "", matricula: "" });
  const [bulkErr, setBulkErr] = useState("");
  const [adding, setAdding]   = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving]   = useState(false);

  // ── Cargar filas al montar
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("filas_manuales")
        .select("id, op, op_madre, linea, matricula")
        .order("created_at", { ascending: true });
      if (error) toast.error(`Error al cargar filas: ${error.message}`);
      else setFilas((data ?? []) as FilaManual[]);
      setLoading(false);
    })();
  }, []);

  // ── Validación
  const validate = () => {
    const e: Partial<typeof EMPTY> = {};
    if (!form.op.trim()       || isNaN(Number(form.op)))       e.op        = "Debe ser un número";
    if (!form.op_madre.trim() || isNaN(Number(form.op_madre))) e.op_madre  = "Debe ser un número";
    if (!form.linea.trim()    || isNaN(Number(form.linea)))    e.linea     = "Debe ser un número";
    if (!form.matricula.trim())                                 e.matricula = "Requerido";
    return e;
  };

  // ── Agregar fila individual
  const handleAdd = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setAdding(true);
    try {
      const { data, error } = await supabase
        .from("filas_manuales")
        .insert({ op: Number(form.op), op_madre: Number(form.op_madre), linea: Number(form.linea), matricula: form.matricula.trim() })
        .select("id, op, op_madre, linea, matricula")
        .single();
      if (error) { toast.error(`Error: ${error.message}`); return; }
      setFilas(prev => [...prev, data as FilaManual]);
      setForm(EMPTY);
    } finally { setAdding(false); }
  };

  // ── Eliminar fila
  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("filas_manuales").delete().eq("id", id);
    if (error) { toast.error(`Error: ${error.message}`); return; }
    setFilas(prev => prev.filter(f => f.id !== id));
  };

  // ── Agregar múltiples filas
  const handleBulkAdd = async () => {
    setBulkErr("");
    const ops    = splitCol(bulk.op);
    const madres = splitCol(bulk.op_madre);
    const lineas = splitCol(bulk.linea);
    const mats   = splitCol(bulk.matricula);
    if (!ops.length)    { setBulkErr("La columna OP está vacía.");        return; }
    if (!madres.length) { setBulkErr("La columna OP MADRE está vacía.");  return; }
    if (!mats.length)   { setBulkErr("La columna MATRÍCULA está vacía."); return; }
    const n = ops.length;
    if (madres.length !== n || mats.length !== n) {
      setBulkErr(`Columnas con distinto número de filas — OP: ${n}, OP MADRE: ${madres.length}, MATRÍCULA: ${mats.length}`);
      return;
    }
    const lineaFinal = lineas.length === n ? lineas : Array(n).fill("1");
    const errs: string[] = [];
    for (let i = 0; i < n; i++) {
      if (isNaN(Number(ops[i])))        errs.push(`Fila ${i+1}: OP no es número`);
      if (isNaN(Number(madres[i])))     errs.push(`Fila ${i+1}: OP MADRE no es número`);
      if (isNaN(Number(lineaFinal[i]))) errs.push(`Fila ${i+1}: LÍNEA no es número`);
      if (!mats[i])                     errs.push(`Fila ${i+1}: MATRÍCULA vacía`);
    }
    if (errs.length) { setBulkErr(errs.slice(0, 5).join(" · ")); return; }
    const payload = ops.map((op, i) => ({ op: Number(op), op_madre: Number(madres[i]), linea: Number(lineaFinal[i]), matricula: mats[i] }));
    setAdding(true);
    try {
      const { data, error } = await supabase.from("filas_manuales").insert(payload).select("id, op, op_madre, linea, matricula");
      if (error) { toast.error(`Error: ${error.message}`); return; }
      setFilas(prev => [...prev, ...((data ?? []) as FilaManual[])]);
      setBulk({ op: "", op_madre: "", linea: "", matricula: "" });
      setMode("single");
      toast.success(`${payload.length} filas agregadas`);
    } finally { setAdding(false); }
  };

  // ── GENERAR
  const handleGenerate = async () => {
    if (!filas.length) { toast.error("No hay filas para generar"); return; }
    setGenerating(true);
    try {
      type OpRow  = { relacion: string; cantidad: unknown; cantidad_recibida: unknown; fecha_creacion: unknown; fecha_pactada: unknown; proveedor: unknown; estado_cierre: unknown };
      type QwRow  = { combinacion: string; expediente_plazo_entrega: unknown; sc_descripcion: unknown; oc_precio_unitario: unknown };
      type MatRow = { articulo: string; descripcion: unknown };

      const [opData, qwData, matData] = await Promise.all([
        fetchAll<OpRow> ("planillas_op", "relacion, cantidad, cantidad_recibida, fecha_creacion, fecha_pactada, proveedor, estado_cierre"),
        fetchAll<QwRow> ("planillas_qw", "combinacion, expediente_plazo_entrega, sc_descripcion, oc_precio_unitario"),
        fetchAll<MatRow>("matriculas",   "articulo, descripcion"),
      ]);

      const opMap  = new Map(opData .map(r => [String(r.relacion),    r]));
      const qwMap  = new Map(qwData .map(r => [String(r.combinacion), r]));
      const matMap = new Map(matData.map(r => [String(r.articulo),    r]));

      const today = new Date();

      const rows: PreviewRow[] = filas.map(fila => {
        const opKey  = String(fila.op)       + String(fila.linea);
        const qwKey  = String(fila.op_madre) + String(fila.linea);
        const matKey = fila.matricula;

        const opRow  = opMap.get(opKey);
        const qwRow  = qwMap.get(qwKey);
        const matRow = matMap.get(matKey);

        const errs: string[] = [];
        if (!opRow)  errs.push(`OP "${opKey}" no encontrado en planillas_op`);
        if (!qwRow)  errs.push(`QW "${qwKey}" no encontrado en planillas_qw`);
        if (!matRow) errs.push(`MATRÍCULA "${matKey}" no encontrada en matriculas`);

        const cantidad         = num(opRow?.cantidad);
        const cantidadRecibida = num(opRow?.cantidad_recibida);
        const saldoLinea       = cantidad - cantidadRecibida;

        const fechaCreac = opRow?.fecha_creacion ? new Date(String(opRow.fecha_creacion)) : null;
        const fechaPact  = opRow?.fecha_pactada  ? new Date(String(opRow.fecha_pactada))  : null;

        const estadoPlazo      = fechaPact && fechaPact < today ? "VENCIDA" : "OK";
        const estadoCantidades = Math.round(saldoLinea) === 0   ? "SIN SALDO" : "VIGENTE";
        const revision         = estadoPlazo === "VENCIDA" || estadoCantidades === "SIN SALDO" ? "CERRAR" : "OK";

        const dias      = fechaCreac ? Math.floor((today.getTime() - fechaCreac.getTime()) / 86_400_000) : 0;
        const meses     = dias / 30;
        const consMes   = meses === 0 ? 0 : cantidadRecibida / meses;
        const dispMeses = consMes === 0 ? 0 : saldoLinea / consMes;

        return {
          zona:                   "",
          op:                     fila.op,
          op_madre:               fila.op_madre,
          sc:                     String(qwRow?.expediente_plazo_entrega ?? ""),
          descripcion_sc:         String(qwRow?.sc_descripcion ?? ""),
          linea:                  fila.linea,
          matricula:              fila.matricula,
          descripcion_matricula:  String(matRow?.descripcion ?? ""),
          cantidad,
          cantidad_recibida:      cantidadRecibida,
          saldo_linea:            parseFloat(saldoLinea.toFixed(4)),
          fecha_pactada:          isoDate(fechaPact),
          proveedor:              String(opRow?.proveedor ?? ""),
          fecha_redeterminacion:  null,
          precio_redeterminacion: qwRow?.oc_precio_unitario != null ? Number(qwRow.oc_precio_unitario) : null,
          estado:                 String(opRow?.estado_cierre ?? ""),
          estado_plazo:           estadoPlazo,
          estado_cantidades:      estadoCantidades,
          revision,
          observacion:            null,
          disponibilidad_meses:   parseFloat(dispMeses.toFixed(2)),
          _errors:                errs,
        };
      });

      setPreview(rows);
      setStep("preview");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al generar");
    } finally {
      setGenerating(false);
    }
  };

  // ── GUARDAR
  const handleSave = async (saveMode: "replace" | "accumulate") => {
    setSaving(true);
    try {
      if (saveMode === "replace") {
        const { error } = await supabase.from("seguimiento").delete().not("id", "is", null);
        if (error) throw new Error(`Error al limpiar: ${error.message}`);
      }
      const toInsert = preview.map(({ _errors: _, ...r }) => r);
      for (let i = 0; i < toInsert.length; i += 500) {
        const { error } = await supabase.from("seguimiento").insert(toInsert.slice(i, i + 500));
        if (error) throw new Error(`Error al insertar: ${error.message}`);
      }
      toast.success(`${toInsert.length} registros guardados en seguimiento`);
      setStep("input");
      setPreview([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const colCount = (t: string) => { const n = splitCol(t).length; return n > 0 ? `${n} fila${n !== 1 ? "s" : ""}` : ""; };
  const inputCls = (err?: string) => cn(
    "h-9 px-3 rounded-lg bg-secondary border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all",
    err ? "border-destructive" : "border-border focus:border-accent"
  );

  // ════════════════════════════════════════════════════════════════
  // PREVIEW STEP
  // ════════════════════════════════════════════════════════════════
  if (step === "preview") {
    const errCount  = preview.filter(r => r._errors.length > 0).length;
    const okCount   = preview.length - errCount;

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => setStep("input")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" />Volver
          </button>
          <h3 className="text-sm font-semibold text-foreground">Preview — {preview.length} registros generados</h3>
        </div>

        {/* Summary */}
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-success bg-success/10 border border-success/20 px-3 py-1.5 rounded-lg">
            <CheckCircle2 className="w-3.5 h-3.5" />{okCount} OK
          </span>
          {errCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 border border-destructive/20 px-3 py-1.5 rounded-lg">
              <AlertCircle className="w-3.5 h-3.5" />{errCount} con errores (se guardan igual)
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => handleSave("accumulate")} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-sm font-medium text-foreground transition-all disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Acumular
            </button>
            <button onClick={() => handleSave("replace")} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Reemplazar y guardar
            </button>
          </div>
        </div>

        {/* Preview table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-secondary/50 border-b border-border">
                <tr>
                  {["#", "OP", "OP MADRE", "SC", "DESCRIPCIÓN SC", "LÍNEA", "MATRÍCULA", "CANTIDAD", "CANT. RECIBIDA", "SALDO", "FECHA PACTADA", "PROVEEDOR", "PRECIO RDET.", "ESTADO", "E. PLAZO", "E. CANT.", "REVISION", "DISPONIB."].map((h, i) => (
                    <th key={i} className="py-2 px-3 text-left text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => {
                  const hasErr = row._errors.length > 0;
                  return (
                    <React.Fragment key={i}>
                      <tr className={cn("border-b border-border/50", hasErr ? "bg-destructive/5" : "hover:bg-secondary/20")}>
                        <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                        <td className="py-2 px-3 font-mono">{row.op}</td>
                        <td className="py-2 px-3 font-mono">{row.op_madre}</td>
                        <td className="py-2 px-3 max-w-[120px] truncate" title={row.sc}>{row.sc || "—"}</td>
                        <td className="py-2 px-3 max-w-[160px] truncate" title={row.descripcion_sc}>{row.descripcion_sc || "—"}</td>
                        <td className="py-2 px-3">{row.linea}</td>
                        <td className="py-2 px-3 font-mono">{row.matricula}</td>
                        <td className="py-2 px-3 text-right">{row.cantidad.toLocaleString("es-AR")}</td>
                        <td className="py-2 px-3 text-right">{row.cantidad_recibida.toLocaleString("es-AR")}</td>
                        <td className="py-2 px-3 text-right">{row.saldo_linea.toLocaleString("es-AR")}</td>
                        <td className="py-2 px-3 whitespace-nowrap">{row.fecha_pactada ?? "—"}</td>
                        <td className="py-2 px-3 max-w-[120px] truncate" title={row.proveedor}>{row.proveedor || "—"}</td>
                        <td className="py-2 px-3 text-right">{row.precio_redeterminacion != null ? row.precio_redeterminacion.toLocaleString("es-AR") : "—"}</td>
                        <td className="py-2 px-3">{row.estado || "—"}</td>
                        <td className="py-2 px-3">
                          <span className={cn("px-1.5 py-0.5 rounded text-[11px] font-medium",
                            row.estado_plazo === "VENCIDA" ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success")}>
                            {row.estado_plazo}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={cn("px-1.5 py-0.5 rounded text-[11px] font-medium",
                            row.estado_cantidades === "SIN SALDO" ? "bg-warning/15 text-warning" : "bg-success/15 text-success")}>
                            {row.estado_cantidades}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={cn("px-1.5 py-0.5 rounded text-[11px] font-medium",
                            row.revision === "CERRAR" ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success")}>
                            {row.revision}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">{row.disponibilidad_meses.toLocaleString("es-AR")}</td>
                      </tr>
                      {hasErr && (
                        <tr className="bg-destructive/5 border-b border-destructive/10">
                          <td colSpan={18} className="px-4 py-1.5">
                            <div className="flex items-start gap-1.5">
                              <AlertCircle className="w-3 h-3 text-destructive shrink-0 mt-0.5" />
                              <span className="text-[11px] text-destructive">{row._errors.join(" · ")}</span>
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
      {/* Encabezado + toggle */}
      <div className="flex items-center gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Crear seguimiento</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {loading ? "Cargando..." : `${filas.length} fila${filas.length !== 1 ? "s" : ""} cargada${filas.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 ml-auto">
          {(["single", "bulk"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {m === "single" ? "Fila individual" : "Pegar columnas"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Formulario individual ── */}
      {mode === "single" && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="grid grid-cols-4 gap-4 mb-4">
            {([
              { key: "op",        label: "OP",        placeholder: "ej. 4500012345" },
              { key: "op_madre",  label: "OP MADRE",  placeholder: "ej. 4500099999" },
              { key: "linea",     label: "LÍNEA",     placeholder: "1"              },
              { key: "matricula", label: "MATRÍCULA", placeholder: "ej. 00702632.0" },
            ] as const).map(({ key, label, placeholder }) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground">{label}</label>
                <input
                  type="text"
                  value={form[key]}
                  onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
                  placeholder={placeholder}
                  className={inputCls(errors[key])}
                />
                {errors[key] && <p className="text-[11px] text-destructive">{errors[key]}</p>}
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button onClick={handleAdd} disabled={adding}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-all disabled:opacity-50">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {adding ? "Guardando..." : "Agregar fila"}
            </button>
          </div>
        </div>
      )}

      {/* ── Pegar columnas ── */}
      {mode === "bulk" && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <p className="text-xs text-muted-foreground">Copiá una columna de Excel y pegala. LÍNEA es opcional (default 1).</p>
          <div className="grid grid-cols-4 gap-4">
            {([
              { key: "op",        label: "OP"        },
              { key: "op_madre",  label: "OP MADRE"  },
              { key: "linea",     label: "LÍNEA"     },
              { key: "matricula", label: "MATRÍCULA" },
            ] as const).map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-foreground">{label}</label>
                  {bulk[key] && <span className="text-[11px] text-accent font-medium">{colCount(bulk[key])}</span>}
                </div>
                <textarea
                  value={bulk[key]}
                  onChange={e => { setBulk(p => ({ ...p, [key]: e.target.value })); setBulkErr(""); }}
                  placeholder={`Columna ${label}…`}
                  rows={8}
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent resize-none transition-all font-mono"
                />
              </div>
            ))}
          </div>
          {bulkErr && <p className="text-xs text-destructive">{bulkErr}</p>}
          <div className="flex justify-end">
            <button onClick={handleBulkAdd} disabled={adding}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-all disabled:opacity-50">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {adding ? "Guardando..." : "Agregar filas"}
            </button>
          </div>
        </div>
      )}

      {/* ── Tabla de filas ── */}
      {!loading && filas.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-secondary/50 border-b border-border">
              <tr>
                {["#", "OP", "OP MADRE", "LÍNEA", "MATRÍCULA", ""].map((h, i) => (
                  <th key={i} className="py-2 px-3 text-left text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, i) => (
                <tr key={fila.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                  <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 px-3 font-mono">{fila.op}</td>
                  <td className="py-2 px-3 font-mono">{fila.op_madre}</td>
                  <td className="py-2 px-3">{fila.linea}</td>
                  <td className="py-2 px-3 font-mono">{fila.matricula}</td>
                  <td className="py-2 px-3">
                    <button onClick={() => handleDelete(fila.id)}
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

      {/* ── Botón Generar ── */}
      {!loading && filas.length > 0 && (
        <div className="flex justify-end">
          <button onClick={handleGenerate} disabled={generating}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-semibold transition-all disabled:opacity-50">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {generating ? "Generando..." : "Generar control de servicios"}
          </button>
        </div>
      )}
    </div>
  );
}
