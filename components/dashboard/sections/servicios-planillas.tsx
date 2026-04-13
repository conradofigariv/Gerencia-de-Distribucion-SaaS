"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  UploadCloud, Loader2, Trash2, CheckCircle2,
  AlertTriangle, RefreshCw, Database,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const str   = (v: unknown): string => String(v ?? "").trim();
const BATCH = 500;

const parseFile = async (file: File, headerRow = 1): Promise<Record<string, unknown>[]> => {
  const XLSX = await import("xlsx");
  const buf  = await file.arrayBuffer();
  const wb   = XLSX.read(buf, { type: "array", cellDates: true });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const raw  = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
  if (raw.length <= headerRow) return [];
  const hdrs = (raw[headerRow] as unknown[]).map(h => str(h));
  return raw
    .slice(headerRow + 1)
    .filter(row => (row as unknown[]).some(c => c != null && c !== ""))
    .map(row => {
      const arr = row as unknown[];
      const obj: Record<string, unknown> = {};
      hdrs.forEach((h, i) => { if (h) obj[h] = arr[i] ?? null; });
      return obj;
    });
};

// ─── Types ────────────────────────────────────────────────────────────────────

type PlanillaType = "OP" | "QW" | "MATRICULAS";

interface PlanillaState {
  count:      number;
  uploadedAt: string | null;
  loading:    boolean;
  uploading:  boolean;
}

const INIT: PlanillaState = { count: 0, uploadedAt: null, loading: true, uploading: false };

// ─── Card ─────────────────────────────────────────────────────────────────────

function PlanillaCard({
  tipo, label, descripcion, accentClass, state, onUpload, onClear,
}: {
  tipo:        PlanillaType;
  label:       string;
  descripcion: string;
  accentClass: string;
  state:       PlanillaState;
  onUpload:    (file: File) => void;
  onClear:     () => void;
}) {
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0]; if (f) onUpload(f);
  }, [onUpload]);

  const hasData = state.count > 0;
  const busy    = state.loading || state.uploading;

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <div className={cn("text-xs font-bold uppercase tracking-widest mb-0.5", accentClass)}>{label}</div>
          <p className="text-sm font-semibold text-foreground">{descripcion}</p>
        </div>
        {!state.loading && hasData && (
          <span className="flex items-center gap-1 text-xs text-success bg-success/10 px-2 py-1 rounded-full shrink-0">
            <CheckCircle2 className="w-3 h-3" />OK
          </span>
        )}
      </div>

      {state.loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Cargando...
        </div>
      ) : hasData ? (
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{state.count.toLocaleString("es-AR")} filas</span>
          </div>
          {state.uploadedAt && (
            <p className="text-xs text-muted-foreground pl-5">
              Actualizado: {new Date(state.uploadedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5 text-warning" />Sin datos en Supabase
        </div>
      )}

      <div
        onClick={() => !busy && ref.current?.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-lg p-4 text-center transition-all duration-200",
          busy  ? "border-accent/30 bg-accent/5 cursor-default"
               : drag ? "border-accent bg-accent/8 cursor-pointer"
               : "border-border hover:border-muted-foreground/40 hover:bg-secondary/20 cursor-pointer"
        )}
      >
        {state.uploading ? (
          <div className="flex flex-col items-center gap-1.5">
            <Loader2 className="w-5 h-5 text-accent animate-spin" />
            <p className="text-xs text-muted-foreground">Subiendo...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <UploadCloud className="w-5 h-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              {hasData ? "Reemplazar" : "Subir archivo"} <span className="font-medium text-foreground">.xlsx</span>
            </p>
          </div>
        )}
      </div>
      <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />

      {hasData && (
        <button onClick={onClear} disabled={busy}
          className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs text-destructive hover:bg-destructive/10 border border-destructive/20 transition-all disabled:opacity-40">
          <Trash2 className="w-3 h-3" />Limpiar tabla
        </button>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ServiciosPlanillasSection() {
  const [states, setStates] = useState<Record<PlanillaType, PlanillaState>>({
    OP:         { ...INIT },
    QW:         { ...INIT },
    MATRICULAS: { ...INIT },
  });

  const setS = (tipo: PlanillaType, u: Partial<PlanillaState>) =>
    setStates(prev => ({ ...prev, [tipo]: { ...prev[tipo], ...u } }));

  const loadStatus = useCallback(async () => {
    setStates(prev => ({
      OP:         { ...prev.OP,         loading: true },
      QW:         { ...prev.QW,         loading: true },
      MATRICULAS: { ...prev.MATRICULAS, loading: true },
    }));
    const [opCnt, opTs, qwCnt, qwTs, matCnt, matTs] = await Promise.all([
      supabase.from("planillas_op").select("*",        { count: "exact", head: true }),
      supabase.from("planillas_op").select("uploaded_at").order("uploaded_at", { ascending: false }).limit(1),
      supabase.from("planillas_qw").select("*",        { count: "exact", head: true }),
      supabase.from("planillas_qw").select("uploaded_at").order("uploaded_at", { ascending: false }).limit(1),
      supabase.from("matriculas").select("*",          { count: "exact", head: true }),
      supabase.from("matriculas").select("updated_at").order("updated_at", { ascending: false }).limit(1),
    ]);
    if (opCnt.error)  toast.error(`Error OP: ${opCnt.error.message}`);
    if (qwCnt.error)  toast.error(`Error QW: ${qwCnt.error.message}`);
    if (matCnt.error) toast.error(`Error MATRICULAS: ${matCnt.error.message}`);
    setStates({
      OP:         { count: opCnt.count  ?? 0, uploadedAt: (opTs.data  as {uploaded_at: string}[]|null)?.[0]?.uploaded_at  ?? null, loading: false, uploading: false },
      QW:         { count: qwCnt.count  ?? 0, uploadedAt: (qwTs.data  as {uploaded_at: string}[]|null)?.[0]?.uploaded_at  ?? null, loading: false, uploading: false },
      MATRICULAS: { count: matCnt.count ?? 0, uploadedAt: (matTs.data as {updated_at:  string}[]|null)?.[0]?.updated_at   ?? null, loading: false, uploading: false },
    });
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const uploadOP = async (file: File) => {
    setS("OP", { uploading: true });
    try {
      const rows = await parseFile(file);
      if (!rows.length) { toast.error("OP: sin datos (headers en fila 2)"); return; }
      const now = new Date().toISOString();
      const mapped = rows.map(r => ({
        relacion:             str(r["Relación"]            ?? r["Relacion"]),
        numero:               str(r["Número"]              ?? r["Numero"]),
        linea:                str(r["Línea"]               ?? r["Linea"]),
        envio:                str(r["Envío"]               ?? r["Envio"]),
        articulo:             str(r["Artículo"]            ?? r["Articulo"]),
        descripcion_articulo: str(r["Descripción Artículo"] ?? r["Descripcion Articulo"]),
        udm:                  str(r["UDM"]                 ?? r["UdM"]),
        fecha_creacion:       str(r["Fecha Creación"]      ?? r["Fecha Creacion"]),
        fecha_pactada:        str(r["Fecha Pactada"]),
        organizacion_envio:   str(r["Organización Envío"]  ?? r["Organizacion Envio"]),
        cantidad:             r["Cantidad"]           != null ? Number(r["Cantidad"])           : null,
        cantidad_vencida:     r["Cantidad Vencida"]   != null ? Number(r["Cantidad Vencida"])   : null,
        cantidad_recibida:    r["Cantidad Recibida"]  != null ? Number(r["Cantidad Recibida"])  : null,
        ctd_aceptada:         r["Ctd Aceptada"]       != null ? Number(r["Ctd Aceptada"])       : null,
        cantidad_rechazada:   r["Cantidad Rechazada"] != null ? Number(r["Cantidad Rechazada"]) : null,
        cantidad_facturada:   r["Cantidad Facturada"] != null ? Number(r["Cantidad Facturada"]) : null,
        cantidad_cancelada:   r["Cantidad Cancelada"] != null ? Number(r["Cantidad Cancelada"]) : null,
        proveedor:            str(r["Proveedor"]),
        estado_autorizacion:  str(r["Estado Autorización"] ?? r["Estado Autorizacion"]),
        estado_cierre:        str(r["Estado Cierre"]),
        uploaded_at:          now,
      })).filter(r => r.relacion);
      if (!mapped.length) { toast.error("OP: no se encontró columna 'Relación'"); return; }
      const { error: del } = await supabase.from("planillas_op").delete().not("id", "is", null);
      if (del) { toast.error(`Error limpiando OP: ${del.message}`); return; }
      for (let i = 0; i < mapped.length; i += BATCH) {
        const { error } = await supabase.from("planillas_op").insert(mapped.slice(i, i + BATCH));
        if (error) { toast.error(`Error insertando OP: ${error.message}`); return; }
      }
      toast.success(`OP: ${mapped.length.toLocaleString("es-AR")} filas guardadas`);
    } catch (e) {
      toast.error(`Error OP: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setS("OP", { uploading: false });
      await loadStatus();
    }
  };

  const uploadQW = async (file: File) => {
    setS("QW", { uploading: true });
    try {
      const rows = await parseFile(file);
      if (!rows.length) { toast.error("QW: sin datos (headers en fila 2)"); return; }
      const now = new Date().toISOString();
      const mapped = rows.map(r => ({
        combinacion:                  str(r["COMBINACION"]),
        oc_numero:                    str(r["OC_NUMERO"]),
        sc_numero_linea:              str(r["SC_NUMERO_LINEA"]),
        expediente_plazo_entrega:     str(r["EXPEDIENTE_PLAZO_ENTREGA"]),
        sc_descripcion:               str(r["SC_DESCRIPCION"]),
        sc_numero:                    str(r["SC_NUMERO"]),
        expediente_numero:            str(r["EXPEDIENTE_NUMERO"]),
        expediente_nro_contratacion:  str(r["EXPEDIENTE_NRO_CONTRATACION"]),
        expediente_tipo_contratacion: str(r["EXPEDIENTE_TIPO_CONTRATACION"]),
        sc_fecha_creacion:            str(r["SC_FECHA_CREACION"]),
        sc_estado:                    str(r["SC_ESTADO"]),
        estado_siga:                  str(r["ESTADO_SIGA"]),
        ult_responsable:              str(r["ULT_RESPONSABLE"]),
        ult_reparto:                  str(r["ULT_REPARTO"]),
        expediente_fecha_apertura:    str(r["EXPEDIENTE_FECHA_APERTURA"]),
        ult_cant_dias:                r["ULT_CANT_DIAS"]        != null ? Number(r["ULT_CANT_DIAS"])        : null,
        articulo_codigo:              str(r["ARTICULO_CODIGO"]),
        sc_cantidad_solicitada:       r["SC_CANTIDAD_SOLICITADA"] != null ? Number(r["SC_CANTIDAD_SOLICITADA"]) : null,
        oc_precio_unitario:           r["OC_PRECIO_UNITARIO"]   != null ? Number(r["OC_PRECIO_UNITARIO"])   : null,
        proveedor_nombre:             str(r["PROVEEDOR_NOMBRE"]),
        oc_fecha_aprobacion:          str(r["OC_FECHA_APROBACION"]),
        sc_es_inversion:              str(r["SC_ES_INVERSION"]),
        sc_preparador_nombre:         str(r["SC_PREPARADOR_NOMBRE"]),
        articulo_id:                  str(r["ARTICULO_ID"]),
        articulo_descripcion:         str(r["ARTICULO_DESCRIPCION"]),
        oc_fecha_pactada:             str(r["OC_FECHA_PACTADA"]),
        oc_estado_cierre:             str(r["OC_ESTADO_CIERRE"]),
        uploaded_at:                  now,
      })).filter(r => r.combinacion);
      if (!mapped.length) { toast.error("QW: no se encontró columna COMBINACION"); return; }
      const { error: del } = await supabase.from("planillas_qw").delete().not("id", "is", null);
      if (del) { toast.error(`Error limpiando QW: ${del.message}`); return; }
      for (let i = 0; i < mapped.length; i += BATCH) {
        const { error } = await supabase.from("planillas_qw").insert(mapped.slice(i, i + BATCH));
        if (error) { toast.error(`Error insertando QW: ${error.message}`); return; }
      }
      toast.success(`QW: ${mapped.length.toLocaleString("es-AR")} filas guardadas`);
    } catch (e) {
      toast.error(`Error QW: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setS("QW", { uploading: false });
      await loadStatus();
    }
  };

  const uploadMatriculas = async (file: File) => {
    setS("MATRICULAS", { uploading: true });
    try {
      const rows = await parseFile(file);
      if (!rows.length) { toast.error("MATRICULAS: sin datos (headers en fila 2)"); return; }
      const rawMapped = rows.map(r => ({
        articulo:      str(r["Artículo"]              ?? r["Articulo"]),
        descripcion:   str(r["Descripción"]          ?? r["Descripcion"]),
        unidad_medida: str(r["Unidad Medida Primaria"] ?? r["Unidad de medida"] ?? r["UDM"] ?? r["UdM"]),
        estado:        str(r["Estado Artículo"]      ?? r["Estado Articulo"] ?? r["Estado"] ?? ""),
        mat_serv:      str(r["Mat/Serv"]             ?? r["Mat./serv."]    ?? r["MAT_SERV"] ?? ""),
      })).filter(r => r.articulo);
      if (!rawMapped.length) { toast.error("No se encontró columna 'Artículo'"); return; }
      // Deduplicar por artículo
      const dedupMap = new Map<string, typeof rawMapped[0]>();
      for (const r of rawMapped) dedupMap.set(r.articulo, r);
      const mapped = [...dedupMap.values()];
      const { error: del } = await supabase.from("matriculas").delete().not("id", "is", null);
      if (del) { toast.error(`Error limpiando MATRICULAS: ${del.message}`); return; }
      for (let i = 0; i < mapped.length; i += BATCH) {
        const { error } = await supabase.from("matriculas").insert(mapped.slice(i, i + BATCH));
        if (error) { toast.error(`Error insertando MATRICULAS: ${error.message}`); return; }
      }
      toast.success(`MATRICULAS: ${mapped.length.toLocaleString("es-AR")} filas guardadas`);
    } catch (e) {
      toast.error(`Error MATRICULAS: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setS("MATRICULAS", { uploading: false });
      await loadStatus();
    }
  };

  const clearTable = async (tipo: PlanillaType, tabla: string) => {
    if (!confirm(`¿Limpiar toda la tabla ${tipo}?`)) return;
    setS(tipo, { loading: true });
    const { error } = await supabase.from(tabla).delete().not("id", "is", null);
    if (error) toast.error(`Error: ${error.message}`);
    else toast.success(`${tipo} limpiada`);
    await loadStatus();
  };

  const handleUpload = (tipo: PlanillaType, file: File) => {
    if (tipo === "OP")        uploadOP(file);
    else if (tipo === "QW")   uploadQW(file);
    else                      uploadMatriculas(file);
  };

  const handleClear = (tipo: PlanillaType) => {
    const tabla = tipo === "OP" ? "planillas_op" : tipo === "QW" ? "planillas_qw" : "matriculas";
    clearTable(tipo, tabla);
  };

  const allLoaded = !states.OP.loading && !states.QW.loading && !states.MATRICULAS.loading;
  const allReady  = states.OP.count > 0 && states.QW.count > 0 && states.MATRICULAS.count > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Subí las planillas base — quedan persistidas en Supabase.</p>
        <button onClick={loadStatus}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground transition-all">
          <RefreshCw className="w-3.5 h-3.5" />Actualizar
        </button>
      </div>

      {allLoaded && allReady && (
        <div className="flex items-center gap-2 text-sm text-success bg-success/10 border border-success/20 rounded-lg px-4 py-3">
          <CheckCircle2 className="w-4 h-4 shrink-0" />Las 3 planillas están cargadas.
        </div>
      )}
      {allLoaded && !allReady && (
        <div className="flex items-center gap-2 text-sm text-warning bg-warning/10 border border-warning/20 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />Subí las 3 planillas para poder generar seguimientos.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <PlanillaCard tipo="OP"         label="OP"         descripcion="Órdenes de compra"       accentClass="text-blue-400"    state={states.OP}         onUpload={f => handleUpload("OP",         f)} onClear={() => handleClear("OP")}         />
        <PlanillaCard tipo="QW"         label="QW"         descripcion="Expedientes / SCs"        accentClass="text-purple-400"  state={states.QW}         onUpload={f => handleUpload("QW",         f)} onClear={() => handleClear("QW")}         />
        <PlanillaCard tipo="MATRICULAS" label="MATRICULAS" descripcion="Catálogo de materiales"   accentClass="text-emerald-400" state={states.MATRICULAS} onUpload={f => handleUpload("MATRICULAS", f)} onClear={() => handleClear("MATRICULAS")} />
      </div>
    </div>
  );
}
