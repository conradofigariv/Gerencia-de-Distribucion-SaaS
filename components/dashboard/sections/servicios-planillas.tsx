"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  UploadCloud, Loader2, Trash2, CheckCircle2,
  AlertTriangle, RefreshCw, Database, BellRing, X,
} from "lucide-react";
import { markUpdated, fetchReminders, upsertConfig } from "@/lib/reminders";
import { replaceSicSoler, upsertSicSoler, clearSicSoler, getSicSolerStatus, type SicSolerRow } from "@/lib/sicSoler";

// Modo de subida de la planilla de SICs: reemplazar todo o actualizar lo existente.
type SicUploadMode = "replace" | "update";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const str   = (v: unknown): string => String(v ?? "").trim();
const BATCH = 500;

// Normaliza un encabezado para comparar sin tildes, mayúsculas ni espacios.
const normHeader = (h: unknown): string =>
  str(h).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// Lee la primera hoja y detecta la fila de encabezados automáticamente.
// `anchors`: nombres de columna esperados (sin tildes/case). Se escanean las
// primeras filas y se elige como header la que contenga MÁS anchors. Si no se
// pasan anchors (o ninguna fila matchea), cae al `headerRow` fijo (default 1).
const parseFile = async (
  file: File,
  headerRow = 1,
  anchors: string[] = [],
): Promise<Record<string, unknown>[]> => {
  const XLSX = await import("xlsx");
  const buf  = await file.arrayBuffer();
  const wb   = XLSX.read(buf, { type: "array", cellDates: true });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const raw  = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });

  let hdrIdx = headerRow;
  if (anchors.length) {
    const wanted = anchors.map(normHeader);
    let bestIdx = -1, bestHits = 0;
    const scan = Math.min(raw.length, 10);
    for (let i = 0; i < scan; i++) {
      const cells = (raw[i] as unknown[] ?? []).map(normHeader);
      const hits  = wanted.filter(w => cells.includes(w)).length;
      if (hits > bestHits) { bestHits = hits; bestIdx = i; }
    }
    if (bestIdx >= 0 && bestHits > 0) hdrIdx = bestIdx;
  }

  if (raw.length <= hdrIdx) return [];
  const hdrs = (raw[hdrIdx] as unknown[]).map(h => str(h));
  return raw
    .slice(hdrIdx + 1)
    .filter(row => (row as unknown[]).some(c => c != null && c !== ""))
    .map(row => {
      const arr = row as unknown[];
      const obj: Record<string, unknown> = {};
      hdrs.forEach((h, i) => { if (h) obj[h] = arr[i] ?? null; });
      return obj;
    });
};

// ─── Types ────────────────────────────────────────────────────────────────────

type PlanillaType = "OP" | "SIC" | "MATRICULAS";

interface ParsedMatricula {
  articulo: string; descripcion: string; unidad_medida: string; estado: string; mat_serv: string;
}
interface MatPreview {
  fileName: string;
  rawCount: number;
  deduped: ParsedMatricula[];
  dupCount: number;
}

interface PlanillaState {
  count:      number;
  uploadedAt: string | null;
  loading:    boolean;
  uploading:  boolean;
}

const INIT: PlanillaState = { count: 0, uploadedAt: null, loading: true, uploading: false };

const REMINDER_DEFS = [
  { key: "planillas-OP",         planilla: "OP" as PlanillaType,         label: "OP",         name: "OP — Órdenes de compra",              descripcion: "Órdenes de compra",      accentClass: "text-blue-400" },
  { key: "planillas-SIC",        planilla: "SIC" as PlanillaType,        label: "SIC",        name: "SICs del Ing. Soler",                 descripcion: "SICs del Ing. Soler",     accentClass: "text-purple-400" },
  { key: "planillas-MATRICULAS", planilla: "MATRICULAS" as PlanillaType, label: "MATRICULAS", name: "MATRICULAS — Catálogo de materiales",  descripcion: "Catálogo de materiales",  accentClass: "text-emerald-400" },
] as const;

// ─── Card ─────────────────────────────────────────────────────────────────────

function PlanillaCard({
  tipo, label, descripcion, accentClass, state, onUpload, onClear,
  mode, onModeChange,
}: {
  tipo:        PlanillaType;
  label:       string;
  descripcion: string;
  accentClass: string;
  state:       PlanillaState;
  onUpload:    (file: File) => void;
  onClear:     () => void;
  mode?:        SicUploadMode;
  onModeChange?: (m: SicUploadMode) => void;
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

      {mode && onModeChange && (
        <div className="flex items-center gap-1 rounded-lg bg-secondary/40 border border-border p-0.5">
          <button
            onClick={() => onModeChange("replace")}
            disabled={busy}
            title="Borra la planilla actual y carga el archivo de cero"
            className={cn(
              "flex-1 px-2 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50",
              mode === "replace" ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Sobreescribir
          </button>
          <button
            onClick={() => onModeChange("update")}
            disabled={busy}
            title="Actualiza las SICs que coinciden y agrega las nuevas, conservando el resto"
            className={cn(
              "flex-1 px-2 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50",
              mode === "update" ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Actualizar
          </button>
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

// ─── Preview modal MATRICULAS ─────────────────────────────────────────────────

function MatPreviewModal({
  preview, onConfirm, onCancel,
}: {
  preview: MatPreview;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const sample = preview.deduped.slice(0, 5);
  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <UploadCloud className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold text-foreground">Vista previa — MATRICULAS</span>
          </div>
          <button
            onClick={onCancel}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground shrink-0">Archivo:</span>
            <span className="font-medium text-foreground truncate">{preview.fileName}</span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
              <Database className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold text-emerald-400">{preview.deduped.length.toLocaleString("es-AR")}</span>
              <span className="text-xs text-muted-foreground">matrículas a importar</span>
            </div>
            {preview.dupCount > 0 && (
              <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-semibold text-amber-400">{preview.dupCount}</span>
                <span className="text-xs text-muted-foreground">duplicados en el archivo eliminados</span>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-2">Primeras filas:</p>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-secondary border-b border-border">
                    {["Matrícula", "Descripción", "UDM", "Estado", "Tipo"].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sample.map((r, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-secondary/30">
                      <td className="px-3 py-2 font-mono text-accent">{r.articulo}</td>
                      <td className="px-3 py-2 text-foreground truncate max-w-[200px]">{r.descripcion || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.unidad_medida || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.estado || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.mat_serv || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.deduped.length > 5 && (
                <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border bg-secondary/20">
                  … y {(preview.deduped.length - 5).toLocaleString("es-AR")} filas más
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-border">
          <p className="text-xs text-muted-foreground">Esta acción reemplazará todo el catálogo actual.</p>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="h-8 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            >
              Cancelar
            </button>
            <button
              onClick={onConfirm}
              className="h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-all flex items-center gap-1.5"
            >
              <UploadCloud className="w-3.5 h-3.5" />Importar
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ServiciosPlanillasSection() {
  const [states, setStates] = useState<Record<PlanillaType, PlanillaState>>({
    OP:         { ...INIT },
    SIC:        { ...INIT },
    MATRICULAS: { ...INIT },
  });

  // Modo de subida de la planilla de SICs (reemplazar vs actualizar).
  const [sicMode, setSicMode] = useState<SicUploadMode>("replace");

  // Preview y resultado de importación de MATRICULAS
  const [matPreview, setMatPreview] = useState<MatPreview | null>(null);
  const [matLastImport, setMatLastImport] = useState<{ inserted: number; dupsInFile: number } | null>(null);

  // Auth / role
  const [userId,    setUserId]    = useState<string | null>(null);
  const [canConfig, setCanConfig] = useState(true);

  // Reminder config dialog
  const [configOpen,    setConfigOpen]    = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig,  setSavingConfig]  = useState(false);
  const [reminderFreq, setReminderFreq] = useState<Record<string, number>>({
    "planillas-OP": 7, "planillas-SIC": 7, "planillas-MATRICULAS": 7,
  });
  const [reminderTime, setReminderTime] = useState<Record<string, string>>({
    "planillas-OP": "09:00", "planillas-SIC": "09:00", "planillas-MATRICULAS": "09:00",
  });
  const [reminderLastUpdate, setReminderLastUpdate] = useState<Record<string, string | null>>({
    "planillas-OP": null, "planillas-SIC": null, "planillas-MATRICULAS": null,
  });

  const setS = (tipo: PlanillaType, u: Partial<PlanillaState>) =>
    setStates(prev => ({ ...prev, [tipo]: { ...prev[tipo], ...u } }));

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
      if (profile?.nivel_acceso === "visualizador") {
        setCanConfig(false);
      }
    })();
  }, []);

  const loadStatus = useCallback(async () => {
    setStates(prev => ({
      OP:         { ...prev.OP,         loading: true },
      SIC:        { ...prev.SIC,        loading: true },
      MATRICULAS: { ...prev.MATRICULAS, loading: true },
    }));
    const [opCnt, opTs, sicStatus, matCnt, matTs] = await Promise.all([
      supabase.from("planillas_op").select("*",        { count: "exact", head: true }),
      supabase.from("planillas_op").select("uploaded_at").order("uploaded_at", { ascending: false }).limit(1),
      getSicSolerStatus().catch(() => ({ count: 0, uploadedAt: null })),
      supabase.from("matriculas").select("*",          { count: "exact", head: true }),
      supabase.from("matriculas").select("updated_at").order("updated_at", { ascending: false }).limit(1),
    ]);
    const isMissing = (msg: string) =>
      msg.includes("Invalid path") || msg.includes("does not exist") || msg.includes("Invalid api key");
    if (opCnt.error  && !isMissing(opCnt.error.message))  toast.error(`Error OP: ${opCnt.error.message}`);
    if (matCnt.error && !isMissing(matCnt.error.message)) toast.error(`Error MATRICULAS: ${matCnt.error.message}`);
    setStates({
      OP:         { count: opCnt.count  ?? 0, uploadedAt: (opTs.data  as {uploaded_at: string}[]|null)?.[0]?.uploaded_at  ?? null, loading: false, uploading: false },
      SIC:        { count: sicStatus.count,   uploadedAt: sicStatus.uploadedAt,                                                    loading: false, uploading: false },
      MATRICULAS: { count: matCnt.count ?? 0, uploadedAt: (matTs.data as {updated_at:  string}[]|null)?.[0]?.updated_at   ?? null, loading: false, uploading: false },
    });
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Load reminder data whenever the dialog opens
  useEffect(() => {
    if (!configOpen) return;
    setLoadingConfig(true);
    fetchReminders(REMINDER_DEFS.map(d => d.key))
      .then(cfgs => {
        const freq:  Record<string, number>       = { "planillas-OP": 7,      "planillas-SIC": 7,      "planillas-MATRICULAS": 7 };
        const time:  Record<string, string>       = { "planillas-OP": "09:00", "planillas-SIC": "09:00", "planillas-MATRICULAS": "09:00" };
        const lastUp: Record<string, string|null> = { "planillas-OP": null,   "planillas-SIC": null,   "planillas-MATRICULAS": null };
        for (const cfg of cfgs) {
          freq[cfg.section_id]   = cfg.frequency_days;
          lastUp[cfg.section_id] = cfg.last_updated_at;
          if (cfg.reminder_time) time[cfg.section_id] = cfg.reminder_time.substring(0, 5);
        }
        setReminderFreq(freq);
        setReminderTime(time);
        setReminderLastUpdate(lastUp);
      })
      .catch(e => toast.error(`Error al cargar recordatorios: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setLoadingConfig(false));
  }, [configOpen]);

  const saveConfig = async () => {
    if (!userId) return;
    setSavingConfig(true);
    try {
      await Promise.all(
        REMINDER_DEFS.map(d => upsertConfig(d.key, d.name, reminderFreq[d.key] ?? 7, reminderTime[d.key] ?? "09:00", userId))
      );
      toast.success("Recordatorios guardados");
      setConfigOpen(false);
    } catch (e) {
      toast.error(`Error al guardar: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setSavingConfig(false);
    }
  };

  const uploadOP = async (file: File) => {
    setS("OP", { uploading: true });
    try {
      // La planilla OP puede traer (o no) una fila de título arriba de los
      // encabezados; se autodetecta la fila de headers buscando estas columnas.
      const rows = await parseFile(file, 1, ["Número", "Artículo", "Proveedor", "Cantidad"]);
      if (!rows.length) { toast.error("OP: sin datos"); return; }
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
      })).filter(r => r.numero);
      if (!mapped.length) { toast.error("OP: no se encontró columna 'Número'"); return; }
      const { error: del } = await supabase.from("planillas_op").delete().not("id", "is", null);
      if (del) { toast.error(`Error limpiando OP: ${del.message}`); return; }
      for (let i = 0; i < mapped.length; i += BATCH) {
        const { error } = await supabase.from("planillas_op").insert(mapped.slice(i, i + BATCH));
        if (error) { toast.error(`Error insertando OP: ${error.message}`); return; }
      }
      toast.success(`OP: ${mapped.length.toLocaleString("es-AR")} filas guardadas`);
      if (userId) await markUpdated("planillas-OP", "OP — Órdenes de compra", userId).catch(() => {});
    } catch (e) {
      toast.error(`Error OP: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setS("OP", { uploading: false });
      await loadStatus();
    }
  };

  const uploadSIC = async (file: File, mode: SicUploadMode) => {
    setS("SIC", { uploading: true });
    try {
      // Encabezados esperados (con/sin tildes). Si el archivo usa otros nombres,
      // ajustar los alias acá. Se autodetecta la fila de headers por estas anclas.
      const rows = await parseFile(file, 1, ["Número", "Artículo", "Cantidad", "Número Pedido", "Línea"]);
      if (!rows.length) { toast.error("SIC: sin datos"); return; }

      // Toma el primer alias presente en la fila (normalizando el encabezado).
      const pick = (r: Record<string, unknown>, aliases: string[]): unknown => {
        const want = aliases.map(normHeader);
        for (const k of Object.keys(r)) {
          if (want.includes(normHeader(k))) return r[k];
        }
        return null;
      };

      const mapped: SicSolerRow[] = rows.map(r => {
        const cant = pick(r, ["Cantidad", "Ctd", "Cant"]);
        return {
          numero_sic:     str(pick(r, ["Número", "Numero", "N° SIC", "Nro SIC", "SIC", "Número SIC", "Numero SIC"])),
          linea:          str(pick(r, ["Línea", "Linea"])),
          articulo:       str(pick(r, ["Artículo", "Articulo", "Artículo Código", "Articulo Codigo"])),
          descripcion:    str(pick(r, ["Descripción", "Descripcion", "Descripción Artículo", "Descripcion Articulo"])),
          cantidad:       cant != null && cant !== "" ? Number(cant) : null,
          udm:            str(pick(r, ["UDM", "UdM", "Unidad Medida", "Unidad de Medida", "Unidad Medida Primaria"])),
          preparador:     str(pick(r, ["Preparador", "Preparador Nombre", "SC Preparador Nombre"])),
          numero_op:      str(pick(r, ["Número Pedido", "Numero Pedido", "Nro Pedido", "Número OP", "Numero OP", "OP", "Pedido"])),
          fecha_creacion: str(pick(r, ["Fecha Creación", "Fecha Creacion", "Fecha de Creación", "Fecha de Creacion"])),
        };
      }).filter(r => r.numero_sic);

      if (!mapped.length) { toast.error("SIC: no se encontró la columna 'Número' (N° de SIC)"); return; }

      if (mode === "replace") await replaceSicSoler(mapped);
      else                    await upsertSicSoler(mapped);

      toast.success(`SIC: ${mapped.length.toLocaleString("es-AR")} filas ${mode === "replace" ? "cargadas" : "actualizadas"}`);
      if (userId) await markUpdated("planillas-SIC", "SICs del Ing. Soler", userId).catch(() => {});
    } catch (e) {
      toast.error(`Error SIC: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setS("SIC", { uploading: false });
      await loadStatus();
    }
  };

  const parseMatriculas = (rows: Record<string, unknown>[]) => {
    const rawMapped: ParsedMatricula[] = rows.map(r => ({
      articulo:      str(r["Artículo"]              ?? r["Articulo"]),
      descripcion:   str(r["Descripción"]          ?? r["Descripcion"]),
      unidad_medida: str(r["Unidad Medida Primaria"] ?? r["Unidad de medida"] ?? r["UDM"] ?? r["UdM"]),
      estado:        str(r["Estado Artículo"]      ?? r["Estado Articulo"] ?? r["Estado"] ?? ""),
      mat_serv:      str(r["Mat/Serv"]             ?? r["Mat./serv."]    ?? r["MAT_SERV"] ?? ""),
    })).filter(r => r.articulo);
    const dedupMap = new Map<string, ParsedMatricula>();
    for (const r of rawMapped) dedupMap.set(r.articulo, r);
    return { rawCount: rawMapped.length, deduped: [...dedupMap.values()] };
  };

  const previewMatriculas = async (file: File) => {
    setS("MATRICULAS", { uploading: true });
    try {
      const rows = await parseFile(file);
      if (!rows.length) { toast.error("MATRICULAS: sin datos (headers en fila 2)"); return; }
      const { rawCount, deduped } = parseMatriculas(rows);
      if (!deduped.length) { toast.error("No se encontró columna 'Artículo'"); return; }
      setMatPreview({ fileName: file.name, rawCount, deduped, dupCount: rawCount - deduped.length });
    } catch (e) {
      toast.error(`Error MATRICULAS: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setS("MATRICULAS", { uploading: false });
    }
  };

  const confirmUploadMatriculas = async () => {
    if (!matPreview) return;
    const { deduped, dupCount } = matPreview;
    setMatPreview(null);
    setS("MATRICULAS", { uploading: true });
    try {
      const { error: del } = await supabase.from("matriculas").delete().not("id", "is", null);
      if (del) { toast.error(`Error limpiando MATRICULAS: ${del.message}`); return; }
      for (let i = 0; i < deduped.length; i += BATCH) {
        const { error } = await supabase.from("matriculas").insert(deduped.slice(i, i + BATCH));
        if (error) { toast.error(`Error insertando MATRICULAS: ${error.message}`); return; }
      }
      setMatLastImport({ inserted: deduped.length, dupsInFile: dupCount });
      toast.success(`MATRICULAS: ${deduped.length.toLocaleString("es-AR")} matrículas cargadas`);
      if (userId) await markUpdated("planillas-MATRICULAS", "MATRICULAS — Catálogo de materiales", userId).catch(() => {});
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
    if (tipo === "OP")         uploadOP(file);
    else if (tipo === "SIC")   uploadSIC(file, sicMode);
    else                       previewMatriculas(file);
  };

  const handleClear = async (tipo: PlanillaType) => {
    if (tipo === "SIC") {
      if (!confirm("¿Limpiar toda la tabla SIC?")) return;
      setS("SIC", { loading: true });
      try { await clearSicSoler(); toast.success("SIC limpiada"); }
      catch (e) { toast.error(`Error: ${e instanceof Error ? e.message : "Error"}`); }
      await loadStatus();
      return;
    }
    const tabla = tipo === "OP" ? "planillas_op" : "matriculas";
    clearTable(tipo, tabla);
  };

  const allLoaded = !states.OP.loading && !states.SIC.loading && !states.MATRICULAS.loading;
  const allReady  = states.OP.count > 0 && states.SIC.count > 0 && states.MATRICULAS.count > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Subí las planillas base — quedan persistidas en Supabase.</p>
        <div className="flex items-center gap-2">
          {canConfig && (
            <button
              onClick={() => setConfigOpen(true)}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground transition-all"
            >
              <BellRing className="w-3.5 h-3.5" />Recordatorios
            </button>
          )}
          <button onClick={loadStatus}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground transition-all">
            <RefreshCw className="w-3.5 h-3.5" />Actualizar
          </button>
        </div>
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

      {matLastImport && (
        <div className="flex items-center gap-2 text-sm text-success bg-success/10 border border-success/20 rounded-lg px-4 py-3">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Última importación MATRICULAS:{" "}
          <span className="font-medium">{matLastImport.inserted.toLocaleString("es-AR")} matrículas cargadas</span>
          {matLastImport.dupsInFile > 0 && (
            <span className="text-muted-foreground"> · {matLastImport.dupsInFile} duplicados del archivo eliminados</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <PlanillaCard tipo="OP"         label="OP"         descripcion="Órdenes de compra"       accentClass="text-blue-400"    state={states.OP}         onUpload={f => handleUpload("OP",         f)} onClear={() => handleClear("OP")}         />
        <PlanillaCard tipo="SIC"        label="SIC"        descripcion="SICs del Ing. Soler"     accentClass="text-purple-400"  state={states.SIC}        onUpload={f => handleUpload("SIC",        f)} onClear={() => handleClear("SIC")}        mode={sicMode} onModeChange={setSicMode} />
        <PlanillaCard tipo="MATRICULAS" label="MATRICULAS" descripcion="Catálogo de materiales"   accentClass="text-emerald-400" state={states.MATRICULAS} onUpload={f => handleUpload("MATRICULAS", f)} onClear={() => handleClear("MATRICULAS")} />
      </div>

      {/* Preview modal MATRICULAS */}
      {matPreview && (
        <MatPreviewModal
          preview={matPreview}
          onConfirm={confirmUploadMatriculas}
          onCancel={() => setMatPreview(null)}
        />
      )}

      {/* Reminder config dialog — rendered via portal to escape stacking context */}
      {configOpen && createPortal(
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
          onClick={() => setConfigOpen(false)}
        >
          <div
            className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <BellRing className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold text-foreground">Configurar recordatorios</span>
              </div>
              <button
                onClick={() => setConfigOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            {loadingConfig ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="p-5 space-y-3">
                {REMINDER_DEFS.map(({ key, label, descripcion, accentClass }) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-4 p-4 rounded-xl bg-secondary/30 border border-border"
                  >
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className={cn("text-xs font-bold uppercase tracking-widest mb-0.5", accentClass)}>
                        {label}
                      </div>
                      <p className="text-sm font-medium text-foreground">{descripcion}</p>
                      {reminderLastUpdate[key] ? (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Última carga:{" "}
                          {new Date(reminderLastUpdate[key]!).toLocaleString("es-AR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5">Sin carga registrada</p>
                      )}
                    </div>

                    {/* Controls */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {/* Preset buttons */}
                      <div className="flex items-center gap-1">
                        {[1, 7, 14, 30].map(d => (
                          <button
                            key={d}
                            onClick={() => setReminderFreq(p => ({ ...p, [key]: d }))}
                            className={cn(
                              "px-2 py-0.5 text-xs rounded font-medium transition-all",
                              reminderFreq[key] === d
                                ? "bg-accent text-accent-foreground"
                                : "bg-secondary text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {d}d
                          </button>
                        ))}
                      </div>
                      {/* Stepper */}
                      <div className="flex items-center gap-1 bg-secondary rounded-lg px-2 py-1">
                        <button
                          onClick={() => setReminderFreq(p => ({ ...p, [key]: Math.max(1, (p[key] ?? 7) - 1) }))}
                          className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded transition-colors font-bold text-sm"
                        >
                          −
                        </button>
                        <span className="w-9 text-center text-sm font-semibold tabular-nums">
                          {reminderFreq[key] ?? 7}d
                        </span>
                        <button
                          onClick={() => setReminderFreq(p => ({ ...p, [key]: Math.min(365, (p[key] ?? 7) + 1) }))}
                          className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded transition-colors font-bold text-sm"
                        >
                          +
                        </button>
                      </div>
                      {/* Time */}
                      <input
                        type="time"
                        value={reminderTime[key] ?? "09:00"}
                        onChange={e => setReminderTime(p => ({ ...p, [key]: e.target.value }))}
                        className="h-8 px-2 rounded-lg bg-secondary border border-border text-sm text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <button
                onClick={() => setConfigOpen(false)}
                className="h-8 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={saveConfig}
                disabled={savingConfig || loadingConfig}
                className="h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-all"
              >
                {savingConfig ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
