"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  Loader2, Plus, Trash2, AlertCircle, CheckCircle2,
  ChevronLeft, ArrowRight, X, BellRing, Database,
} from "lucide-react";
import { markUpdated, fetchReminders, upsertConfig } from "@/lib/reminders";
import { getSicSoler } from "@/lib/sicSoler";
import { normArticulo } from "@/lib/tableroOp";

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = "input" | "preview";

interface FilaManual {
  id:        string;
  zona:      string;
  op:        number;
  op_madre:  number;
  linea:     number | null;   // opcional: null = todas las líneas de la OP
  matricula: string;          // opcional: "" = todas las matrículas de la OP
}

interface PreviewRow {
  zona:                   string;
  op:                     number;
  op_madre:               number;
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
const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const str = (v: unknown) => String(v ?? "").trim();
const isoDate = (d: Date | null) => d ? d.toISOString().split("T")[0] : null;

type OpRow  = { numero: string; linea: string; articulo: string; cantidad: unknown; cantidad_recibida: unknown; fecha_creacion: unknown; fecha_pactada: unknown; proveedor: unknown; estado_cierre: unknown };
type MatRow = { articulo: string; descripcion: unknown };

// Métricas calculadas de una fila de OP (cantidades, estado, plazos).
function opMetrics(opRow: OpRow | undefined, today: Date) {
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
    cantidad, cantidadRecibida,
    saldo_linea: parseFloat(saldoLinea.toFixed(4)),
    fecha_pactada: isoDate(fechaPact),
    proveedor: String(opRow?.proveedor ?? ""),
    estado: String(opRow?.estado_cierre ?? ""),
    estado_plazo: estadoPlazo, estado_cantidades: estadoCantidades, revision,
    disponibilidad_meses: parseFloat(dispMeses.toFixed(2)),
  };
}

// Clave de cruce OP robusta: Número Pedido + Línea normalizados a número (ignora
// el sufijo .0 y los ceros, que rompen el match por texto). Independiente de la
// columna `relacion` (que puede venir vacía o con otro formato).
const opCrossKey = (op: unknown, linea: unknown) => `${num(op)}|${num(linea)}`;

// Construye una fila de preview cruzando OP (cantidades/fecha/proveedor/estado)
// y matrículas (descripción). Cruce OP por (Número Pedido + Línea) normalizados;
// matrícula por valor literal con respaldo normalizado (sin .0). El valor de la
// matrícula se conserva literal para mostrar/guardar. (QW/expedientes ya no se usa.)
function buildPreviewRow(
  input: { zona: string; op: number; op_madre: number; linea: number; matricula: string; descripcion?: string },
  opMap: Map<string, OpRow>,
  matMap: Map<string, MatRow>,
  today: Date,
): PreviewRow {
  const opRow  = opMap.get(opCrossKey(input.op, input.linea));
  const matRow = matMap.get(input.matricula) ?? matMap.get(normArticulo(input.matricula));

  const errs: string[] = [];
  if (!opRow)  errs.push(`OP "${input.op}/${input.linea}" no encontrada en planillas_op`);
  if (!matRow) errs.push(`MATRÍCULA "${input.matricula}" no está en el catálogo (matriculas)`);

  // Descripción: catálogo primero; si la matrícula no está, usa la de la SIC.
  const m = opMetrics(opRow, today);
  return {
    zona: input.zona, op: input.op, op_madre: input.op_madre, linea: input.linea,
    matricula: input.matricula,
    descripcion_matricula: String(matRow?.descripcion ?? input.descripcion ?? ""),
    cantidad: m.cantidad, cantidad_recibida: m.cantidadRecibida, saldo_linea: m.saldo_linea,
    fecha_pactada: m.fecha_pactada, proveedor: m.proveedor,
    fecha_redeterminacion: null, precio_redeterminacion: null,
    estado: m.estado, estado_plazo: m.estado_plazo, estado_cantidades: m.estado_cantidades,
    revision: m.revision, observacion: null, disponibilidad_meses: m.disponibilidad_meses,
    _errors: errs,
  };
}

// Fila de preview a partir de una línea real de planillas_op (carga manual:
// se busca por OP y la matrícula/línea salen de la propia OP).
function buildRowFromOp(zona: string, opRow: OpRow, matMap: Map<string, MatRow>, today: Date): PreviewRow {
  const art = String(opRow.articulo ?? "");
  const matRow = matMap.get(art) ?? matMap.get(normArticulo(art));
  const m = opMetrics(opRow, today);
  const errs: string[] = [];
  if (!matRow) errs.push(`MATRÍCULA "${art}" no está en el catálogo (matriculas)`);
  return {
    zona, op: num(opRow.numero), op_madre: 0, linea: num(opRow.linea),
    matricula: art, descripcion_matricula: String(matRow?.descripcion ?? ""),
    cantidad: m.cantidad, cantidad_recibida: m.cantidadRecibida, saldo_linea: m.saldo_linea,
    fecha_pactada: m.fecha_pactada, proveedor: m.proveedor,
    fecha_redeterminacion: null, precio_redeterminacion: null,
    estado: m.estado, estado_plazo: m.estado_plazo, estado_cantidades: m.estado_cantidades,
    revision: m.revision, observacion: null, disponibilidad_meses: m.disponibilidad_meses,
    _errors: errs,
  };
}

// Fila de error cuando la OP buscada no está en planillas_op.
function opNotFoundRow(zona: string, op: number, linea: number | null): PreviewRow {
  return {
    zona, op, op_madre: 0, linea: linea ?? 0, matricula: "", descripcion_matricula: "",
    cantidad: 0, cantidad_recibida: 0, saldo_linea: 0, fecha_pactada: null, proveedor: "",
    fecha_redeterminacion: null, precio_redeterminacion: null,
    estado: "", estado_plazo: "OK", estado_cantidades: "SIN SALDO", revision: "CERRAR",
    observacion: null, disponibilidad_meses: 0,
    _errors: [`OP "${op}" no encontrada en planillas_op`],
  };
}

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

const REMINDER_KEY  = "servicios-carga";
const REMINDER_NAME = "Crear seguimiento";

export function ServiciosCargaSection() {
  const [step, setStep]       = useState<Step>("input");
  const [filas, setFilas]     = useState<FilaManual[]>([]);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  // Origen del preview: la carga masiva (SIC) puede reemplazar; la manual solo agrega.
  const [previewSource, setPreviewSource] = useState<"sic" | "manual">("manual");
  const [bulk, setBulk]       = useState({ zona: "", op: "", op_madre: "", linea: "", matricula: "" });
  const [bulkErr, setBulkErr] = useState("");
  const [adding, setAdding]       = useState(false);
  const [loading, setLoading]     = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingSIC, setGeneratingSIC] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  // Auth / role
  const [userId,    setUserId]    = useState<string | null>(null);
  const [canConfig, setCanConfig] = useState(true); // default true; hidden only if confirmed non-editor

  // Reminder config
  const [configOpen,      setConfigOpen]      = useState(false);
  const [loadingConfig,   setLoadingConfig]   = useState(false);
  const [savingConfig,    setSavingConfig]    = useState(false);
  const [reminderFreq,    setReminderFreq]    = useState(7);
  const [reminderTime,    setReminderTime]    = useState("09:00");
  const [reminderLastUpd, setReminderLastUpd] = useState<string | null>(null);

  // Fetch user + role on mount
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data: profile } = await supabase
        .from("profiles")
        .select("nivel_acceso")
        .eq("id", user.id)
        .single();
      // Only hide the button if we explicitly know the user is a visualizador
      if (profile?.nivel_acceso === "visualizador") {
        setCanConfig(false);
      }
    })();
  }, []);

  // Load reminder data whenever the dialog opens
  useEffect(() => {
    if (!configOpen) return;
    setLoadingConfig(true);
    fetchReminders([REMINDER_KEY])
      .then(cfgs => {
        const cfg = cfgs[0];
        if (cfg) {
          setReminderFreq(cfg.frequency_days);
          setReminderLastUpd(cfg.last_updated_at);
          if (cfg.reminder_time) setReminderTime(cfg.reminder_time.substring(0, 5));
        }
      })
      .catch(e => toast.error(`Error al cargar recordatorio: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setLoadingConfig(false));
  }, [configOpen]);

  const saveConfig = async () => {
    if (!userId) return;
    setSavingConfig(true);
    try {
      await upsertConfig(REMINDER_KEY, REMINDER_NAME, reminderFreq, reminderTime, userId);
      toast.success("Recordatorio guardado");
      setConfigOpen(false);
    } catch (e) {
      toast.error(`Error al guardar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingConfig(false);
    }
  };

  // ── Cargar filas al montar
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("filas_manuales")
        .select("id, zona, op, op_madre, linea, matricula")
        .order("created_at", { ascending: true });
      if (error) toast.error(`Error al cargar filas: ${error.message}`);
      else setFilas((data ?? []) as FilaManual[]);
      setLoading(false);
    })();
  }, []);


  // ── Eliminar fila
  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("filas_manuales").delete().eq("id", id);
    if (error) { toast.error(`Error: ${error.message}`); return; }
    setFilas(prev => prev.filter(f => f.id !== id));
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
  };

  // ── Eliminar seleccionados
  const handleDeleteSelected = async () => {
    if (!selected.size) return;
    setDeletingSelected(true);
    const ids = [...selected];
    const { error } = await supabase.from("filas_manuales").delete().in("id", ids);
    if (error) { toast.error(`Error: ${error.message}`); setDeletingSelected(false); return; }
    setFilas(prev => prev.filter(f => !selected.has(f.id)));
    setSelected(new Set());
    toast.success(`${ids.length} fila${ids.length !== 1 ? "s" : ""} eliminada${ids.length !== 1 ? "s" : ""}`);
    setDeletingSelected(false);
  };

  // ── Limpiar todo
  const handleClearAll = async () => {
    setClearingAll(true);
    const { error } = await supabase.from("filas_manuales").delete().not("id", "is", null);
    if (error) { toast.error(`Error: ${error.message}`); setClearingAll(false); return; }
    setFilas([]);
    setSelected(new Set());
    toast.success("Todas las filas eliminadas");
    setClearingAll(false);
  };

  // ── Agregar múltiples filas. Solo la OP es obligatoria; zona, línea y
  //    matrícula son opcionales (las columnas opcionales, si se pegan, deben
  //    tener la misma cantidad de filas que OP).
  const handleBulkAdd = async () => {
    setBulkErr("");
    const zonas  = splitCol(bulk.zona);
    const ops    = splitCol(bulk.op);
    const mats   = splitCol(bulk.matricula);
    if (!ops.length) { setBulkErr("La columna OP está vacía (es lo único obligatorio)."); return; }
    const n = ops.length;
    for (const [name, col] of [["ZONA", zonas], ["MATRÍCULA", mats]] as const) {
      if (col.length && col.length !== n) { setBulkErr(`La columna ${name} tiene ${col.length} filas y OP tiene ${n}.`); return; }
    }
    const zonaFinal = zonas.length === n ? zonas : Array(n).fill("");
    const matFinal  = mats.length  === n ? mats  : Array(n).fill("");
    const errs: string[] = [];
    for (let i = 0; i < n; i++) {
      if (isNaN(Number(ops[i]))) errs.push(`Fila ${i+1}: OP no es número`);
    }
    if (errs.length) { setBulkErr(errs.slice(0, 5).join(" · ")); return; }
    const payload = ops.map((op, i) => ({
      zona:      zonaFinal[i],
      op:        Number(op),
      op_madre:  0,
      linea:     null,           // sin filtro de línea: se traen todas las de la OP
      matricula: matFinal[i],
    }));
    setAdding(true);
    try {
      const { data, error } = await supabase.from("filas_manuales").insert(payload).select("id, zona, op, op_madre, linea, matricula");
      if (error) { toast.error(`Error: ${error.message}`); return; }
      setFilas(prev => [...prev, ...((data ?? []) as FilaManual[])]);
      setBulk({ zona: "", op: "", op_madre: "", linea: "", matricula: "" });
      toast.success(`${payload.length} fila${payload.length !== 1 ? "s" : ""} agregada${payload.length !== 1 ? "s" : ""}`);
    } finally { setAdding(false); }
  };

  // Carga las planillas base para el cruce (OP + matrículas) y arma los mapas
  // con claves robustas (ver opCrossKey / normArticulo).
  const loadCrossMaps = async () => {
    const [opData, matData] = await Promise.all([
      fetchAll<OpRow> ("planillas_op", "numero, linea, articulo, cantidad, cantidad_recibida, fecha_creacion, fecha_pactada, proveedor, estado_cierre"),
      fetchAll<MatRow>("matriculas",   "articulo, descripcion"),
    ]);
    const opMap = new Map<string, OpRow>();
    for (const r of opData) {
      const k = opCrossKey(r.numero, r.linea);
      if (!opMap.has(k)) opMap.set(k, r);   // primer envío de la línea
    }
    const matMap = new Map<string, MatRow>();
    for (const r of matData) {
      const a = String(r.articulo);
      matMap.set(a, r);                                   // literal (con .0)
      const n = normArticulo(a);
      if (!matMap.has(n)) matMap.set(n, r);               // respaldo sin .0
    }
    return { opData, opMap, matMap };
  };

  // ── GENERAR (carga manual): se busca SOLO por OP. Línea y matrícula son
  //    filtros opcionales; sin ellos se traen todas las líneas de la OP.
  const handleGenerate = async () => {
    if (!filas.length) { toast.error("No hay filas para generar"); return; }
    setGenerating(true);
    try {
      const { opData, matMap } = await loadCrossMaps();
      const today = new Date();
      const rows: PreviewRow[] = [];
      for (const fila of filas) {
        const opnum   = num(fila.op);
        const wantLin = fila.linea != null;
        const wantMat = str(fila.matricula) !== "";
        const matN    = wantMat ? normArticulo(String(fila.matricula)) : "";
        const cands = opData.filter(r =>
          num(r.numero) === opnum
          && (!wantLin || num(r.linea) === Number(fila.linea))
          && (!wantMat || String(r.articulo) === String(fila.matricula) || normArticulo(String(r.articulo)) === matN)
        );
        if (!cands.length) rows.push(opNotFoundRow(fila.zona, opnum, fila.linea));
        else for (const opRow of cands) rows.push(buildRowFromOp(fila.zona, opRow, matMap, today));
      }
      setPreview(rows);
      setPreviewSource("manual");
      setStep("preview");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al generar");
    } finally {
      setGenerating(false);
    }
  };

  // ── GENERAR (carga masiva desde la planilla de SICs del Ing. Soler)
  const handleGenerateFromSIC = async () => {
    setGeneratingSIC(true);
    try {
      const [sicRows, maps] = await Promise.all([getSicSoler(), loadCrossMaps()]);
      if (!sicRows.length) {
        toast.error("La planilla de SICs está vacía en la base. Subila en 'Carga de datos'.");
        return;
      }
      const conOp = sicRows.filter(s => str(s.numero_op) !== "");
      if (!conOp.length) {
        toast.error(`${sicRows.length} SICs cargadas, pero ninguna tiene N° de OP (columna "Número Pedido"). Re-subí la planilla en 'Carga de datos'.`);
        return;
      }
      const today = new Date();
      const rows = conOp.map(s =>
        buildPreviewRow(
          { zona: "", op: num(s.numero_op), op_madre: 0, linea: num(s.linea), matricula: str(s.articulo), descripcion: str(s.descripcion) },
          maps.opMap, maps.matMap, today,
        ),
      );
      const sinOp = sicRows.length - conOp.length;
      setPreview(rows);
      setPreviewSource("sic");
      setStep("preview");
      toast.success(`${rows.length} SIC(s) cargadas para revisar${sinOp ? ` · ${sinOp} sin OP omitidas` : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cargar SICs");
    } finally {
      setGeneratingSIC(false);
    }
  };

  // ── GUARDAR
  //  replace_all : borra TODO el seguimiento y guarda lo del preview.
  //  replace_sic : borra solo lo cargado por la masiva (origen 'sic' o legado
  //                null) y conserva los casos manuales (origen 'manual').
  //  accumulate  : no borra nada, solo agrega.
  type SaveMode = "replace_all" | "replace_sic" | "accumulate";
  const handleSave = async (saveMode: SaveMode) => {
    setSaveModalOpen(false);
    setSaving(true);
    try {
      if (saveMode === "replace_all") {
        const { error } = await supabase.from("seguimiento").delete().not("id", "is", null);
        if (error) throw new Error(`Error al limpiar: ${error.message}`);
      } else if (saveMode === "replace_sic") {
        const { error } = await supabase.from("seguimiento").delete().or("origen.is.null,origen.eq.sic");
        if (error) throw new Error(`Error al limpiar SICs: ${error.message}`);
      }
      const toInsert = preview.map(({ _errors: _, ...r }) => ({ ...r, origen: previewSource }));
      for (let i = 0; i < toInsert.length; i += 500) {
        const { error } = await supabase.from("seguimiento").insert(toInsert.slice(i, i + 500));
        if (error) throw new Error(`Error al insertar: ${error.message}`);
      }
      const n = toInsert.length;
      toast.success(
        saveMode === "accumulate"  ? `${n} registros agregados al seguimiento` :
        saveMode === "replace_sic" ? `SICs reemplazadas — ${n} registros (casos manuales conservados)` :
                                     `Seguimiento reemplazado — ${n} registros`
      );
      if (userId) await markUpdated(REMINDER_KEY, REMINDER_NAME, userId).catch(() => {});
      setStep("input");
      setPreview([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const colCount = (t: string) => { const n = splitCol(t).length; return n > 0 ? `${n} fila${n !== 1 ? "s" : ""}` : ""; };

  // ════════════════════════════════════════════════════════════════
  // DIÁLOGO de opciones de guardado (solo para la carga masiva de SICs)
  // ════════════════════════════════════════════════════════════════
  const saveModal = saveModalOpen && createPortal(
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
      onClick={() => !saving && setSaveModalOpen(false)}>
      <div className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <span className="text-sm font-semibold text-foreground">¿Cómo guardar la carga masiva?</span>
          <button onClick={() => setSaveModalOpen(false)} disabled={saving}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-2.5">
          <button onClick={() => handleSave("replace_sic")} disabled={saving}
            className="w-full text-left p-3.5 rounded-lg border border-accent/40 bg-accent/10 hover:bg-accent/15 transition-colors disabled:opacity-50">
            <p className="text-sm font-semibold text-foreground">Reemplazar solo las SICs de Soler</p>
            <p className="text-xs text-muted-foreground mt-0.5">Recarga el maestro de SICs y <span className="text-foreground">conserva los casos manuales</span> ya cargados. Recomendado.</p>
          </button>
          <button onClick={() => handleSave("replace_all")} disabled={saving}
            className="w-full text-left p-3.5 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 transition-colors disabled:opacity-50">
            <p className="text-sm font-semibold text-foreground">Reemplazar todo el seguimiento</p>
            <p className="text-xs text-muted-foreground mt-0.5">Borra todo (incluidos los casos manuales) y deja solo estas SICs.</p>
          </button>
          <button onClick={() => handleSave("accumulate")} disabled={saving}
            className="w-full text-left p-3.5 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 transition-colors disabled:opacity-50">
            <p className="text-sm font-semibold text-foreground">Solo agregar</p>
            <p className="text-xs text-muted-foreground mt-0.5">No borra nada; suma estas filas a lo que ya está (puede duplicar).</p>
          </button>
        </div>
        {saving && (
          <div className="flex items-center justify-center gap-2 px-5 py-3 border-t border-border text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />Guardando…
          </div>
        )}
      </div>
    </div>,
    document.body,
  );

  // ════════════════════════════════════════════════════════════════
  // REMINDER DIALOG (shared between both steps)
  // ════════════════════════════════════════════════════════════════
  const reminderDialog = configOpen && createPortal(
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
      onClick={() => setConfigOpen(false)}
    >
      <div
        className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <BellRing className="w-4 h-4 text-accent" />
            <span className="text-sm font-semibold text-foreground">Recordatorio — Crear seguimiento</span>
          </div>
          <button
            onClick={() => setConfigOpen(false)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loadingConfig ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {reminderLastUpd ? (
              <p className="text-xs text-muted-foreground">
                Último seguimiento guardado:{" "}
                {new Date(reminderLastUpd).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Sin seguimiento registrado</p>
            )}
            <div className="flex flex-col gap-3 p-4 rounded-xl bg-secondary/30 border border-border">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-foreground">Frecuencia</span>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-1">
                    {[1, 7, 14, 30].map(d => (
                      <button
                        key={d}
                        onClick={() => setReminderFreq(d)}
                        className={cn(
                          "px-2 py-0.5 text-xs rounded font-medium transition-all",
                          reminderFreq === d
                            ? "bg-accent text-accent-foreground"
                            : "bg-secondary text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 bg-secondary rounded-lg px-2 py-1">
                    <button onClick={() => setReminderFreq(v => Math.max(1, v - 1))}
                      className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded transition-colors font-bold text-sm">−</button>
                    <span className="w-9 text-center text-sm font-semibold tabular-nums">{reminderFreq}d</span>
                    <button onClick={() => setReminderFreq(v => Math.min(365, v + 1))}
                      className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded transition-colors font-bold text-sm">+</button>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-foreground">Hora</span>
                <input type="time" value={reminderTime} onChange={e => setReminderTime(e.target.value)}
                  className="h-8 px-2 rounded-lg bg-secondary border border-border text-sm text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={() => setConfigOpen(false)}
            className="h-8 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">
            Cancelar
          </button>
          <button onClick={saveConfig} disabled={savingConfig || loadingConfig}
            className="h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-all">
            {savingConfig ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );

  // ════════════════════════════════════════════════════════════════
  // PREVIEW STEP
  // ════════════════════════════════════════════════════════════════
  if (step === "preview") {
    const errCount  = preview.filter(r => r._errors.length > 0).length;
    const okCount   = preview.length - errCount;

    return (
      <>
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
            {previewSource === "manual" ? (
              // Carga manual: SOLO agrega, nunca reemplaza (no pisa la carga masiva).
              <button onClick={() => handleSave("accumulate")} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {saving ? "Guardando..." : "Agregar al seguimiento"}
              </button>
            ) : (
              // Carga masiva (SIC): abre el diálogo con las opciones de guardado.
              <button onClick={() => setSaveModalOpen(true)} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                {saving ? "Guardando..." : "Guardar seguimiento"}
              </button>
            )}
          </div>
        </div>

        {/* Preview table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-secondary/50 border-b border-border">
                <tr>
                  {["#", "ZONA", "OP", "LÍNEA", "MATRÍCULA", "CANTIDAD", "CANT. RECIBIDA", "SALDO", "FECHA PACTADA", "PROVEEDOR", "PRECIO RDET.", "ESTADO", "E. PLAZO", "E. CANT.", "REVISION", "DISPONIB."].map((h, i) => (
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
                        <td className="py-2 px-3">{row.zona || "—"}</td>
                        <td className="py-2 px-3 font-mono">{row.op}</td>
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
                          <td colSpan={16} className="px-4 py-1.5">
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
      {reminderDialog}
      {saveModal}
      </>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // INPUT STEP
  // ════════════════════════════════════════════════════════════════
  return (
    <>
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Crear seguimiento</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {loading ? "Cargando..." : `${filas.length} fila${filas.length !== 1 ? "s" : ""} cargada${filas.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        {canConfig && (
          <button
            onClick={() => setConfigOpen(true)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground transition-all"
          >
            <BellRing className="w-3.5 h-3.5" />Recordatorio
          </button>
        )}
      </div>

      {/* ── Carga masiva desde la planilla de SICs del Ing. Soler ── */}
      {!loading && (
        <div className="bg-card border border-border rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-accent/10 shrink-0">
              <Database className="w-5 h-5 text-accent" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Carga masiva desde SICs de Soler</p>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
                Genera el seguimiento cruzando toda la planilla de SICs (subida en «Carga de datos») con OP y matrículas.
                La zona queda vacía para completarla después. Las SICs sin OP se omiten.
              </p>
            </div>
          </div>
          <button
            onClick={handleGenerateFromSIC}
            disabled={generatingSIC || generating}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-semibold transition-all disabled:opacity-50 shrink-0"
          >
            {generatingSIC ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {generatingSIC ? "Generando…" : "Generar desde SICs"}
          </button>
        </div>
      )}

      {/* ── Pegar columnas (carga manual) ── */}
      {!loading && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <p className="text-xs text-muted-foreground">O cargá casos especiales a mano: solo <span className="text-foreground font-medium">OP es obligatorio</span>. ZONA y MATRÍCULA son opcionales. Con solo la OP se traen <span className="text-foreground font-medium">todas sus líneas</span>. Pegá una sola línea o columnas completas.</p>
          <div className="grid grid-cols-3 gap-4">
            {([
              { key: "zona",      label: "ZONA"      },
              { key: "op",        label: "OP"        },
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
          {/* Barra de acciones */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-secondary/30">
            <span className="text-xs text-muted-foreground">
              {selected.size > 0
                ? `${selected.size} fila${selected.size !== 1 ? "s" : ""} seleccionada${selected.size !== 1 ? "s" : ""}`
                : `${filas.length} fila${filas.length !== 1 ? "s" : ""}`}
            </span>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <button
                  onClick={handleDeleteSelected}
                  disabled={deletingSelected}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors disabled:opacity-50">
                  {deletingSelected ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Eliminar seleccionadas
                </button>
              )}
              <button
                onClick={handleClearAll}
                disabled={clearingAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50">
                {clearingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                Limpiar todo
              </button>
            </div>
          </div>

          <table className="w-full text-xs">
            <thead className="bg-secondary/50 border-b border-border">
              <tr>
                <th className="py-2 px-3 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === filas.length && filas.length > 0}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < filas.length; }}
                    onChange={e => setSelected(e.target.checked ? new Set(filas.map(f => f.id)) : new Set())}
                    className="accent-accent w-3.5 h-3.5 cursor-pointer"
                  />
                </th>
                {["#", "ZONA", "OP", "MATRÍCULA", ""].map((h, i) => (
                  <th key={i} className="py-2 px-3 text-left text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, i) => (
                <tr key={fila.id} className={cn("border-b border-border/50 transition-colors", selected.has(fila.id) ? "bg-accent/5" : "hover:bg-secondary/20")}>
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      checked={selected.has(fila.id)}
                      onChange={e => setSelected(prev => {
                        const s = new Set(prev);
                        e.target.checked ? s.add(fila.id) : s.delete(fila.id);
                        return s;
                      })}
                      className="accent-accent w-3.5 h-3.5 cursor-pointer"
                    />
                  </td>
                  <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 px-3">{fila.zona || "—"}</td>
                  <td className="py-2 px-3 font-mono">{fila.op}</td>
                  <td className="py-2 px-3 font-mono">{fila.matricula || "—"}</td>
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
    {reminderDialog}
    </>
  );
}
