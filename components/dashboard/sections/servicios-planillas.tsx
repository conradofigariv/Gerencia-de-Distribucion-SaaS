"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  UploadCloud, Loader2, Trash2, CheckCircle2,
  AlertTriangle, RefreshCw, Database, BellRing, X, HelpCircle, Check,
} from "lucide-react";
import { markUpdated } from "@/lib/notificaciones";
import { DialogRecordatorios } from "@/components/dashboard/dialog-recordatorios";
import { replaceSicSoler, upsertSicSoler, clearSicSoler, getSicSolerStatus, type SicSolerRow } from "@/lib/sicSoler";
import { reconstruirIndiceEnSegundoPlano } from "@/lib/busqueda";
import { normArticulo, parseNum, parseEntero, parseFechaArg } from "@/lib/tableroOp";

// Modo de subida de la planilla de SICs: reemplazar todo o actualizar lo existente.
type SicUploadMode = "replace" | "update";
// MATRICULAS: "overwrite" borra todo el catálogo; "append" conserva el resto,
// agrega las nuevas y refresca las que vengan repetidas en el archivo.
type MatUploadMode = "append" | "overwrite";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const str   = (v: unknown): string => String(v ?? "").trim();

// Fecha de Excel → "YYYY-MM-DD". XLSX se lee con cellDates:true, que convierte
// a Date las celdas que el Excel tiene formateadas COMO fecha. Pero si la
// celda es un número sin ese formato (frecuente en exports viejos: la columna
// "queda" con formato General), cellDates no la toca y llega el número crudo
// de serie de Excel (ej. 45658) — antes se guardaba tal cual con String(), y
// más tarde `new Date("45658")` lo interpretaba como el AÑO 45658 en vez de
// una fecha de 2024, lo que rompía cualquier insert que la usara («time zone
// displacement out of range»). Se convierte acá también, con el mismo epoch
// de Excel (30/12/1899) que usa lib/seguimientoBuild.ts del otro lado.
const fechaStr = (v: unknown): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86_400_000);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    }
  }
  return str(v);
};
const BATCH = 500;

// Normaliza un encabezado para comparar sin tildes, mayúsculas ni espacios.
const normHeader = (h: unknown): string =>
  str(h).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

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

type PlanillaType = "OP" | "SIC" | "MATRICULAS" | "TRANSACCIONES";

interface PlanillaState {
  count:      number;
  uploadedAt: string | null;
  loading:    boolean;
  uploading:  boolean;
}

const INIT: PlanillaState = { count: 0, uploadedAt: null, loading: true, uploading: false };

const REMINDER_DEFS = [
  { key: "planillas-OP",         planilla: "OP" as PlanillaType,         label: "OP",         name: "OP — Envíos (órdenes de compra)",      descripcion: "Planilla «Envíos»",      accentClass: "text-blue-400" },
  { key: "planillas-SIC",        planilla: "SIC" as PlanillaType,        label: "SIC",        name: "SICs — Solicitudes internas de compra", descripcion: "Solicitudes internas de compra", accentClass: "text-purple-400" },
  { key: "planillas-MATRICULAS", planilla: "MATRICULAS" as PlanillaType, label: "MATRICULAS", name: "MATRICULAS — Catálogo de materiales",  descripcion: "Catálogo de materiales",  accentClass: "text-emerald-400" },
  { key: "planillas-TRANSACCIONES", planilla: "TRANSACCIONES" as PlanillaType, label: "TRANSACCIONES", name: "TRANSACCIONES — Log de movimientos", descripcion: "Log de movimientos (Recibir/Aceptar/Entregar/devoluciones)", accentClass: "text-orange-400" },
] as const;

// ─── Ayuda: cómo exportar cada planilla desde SIEPEC ────────────────────────
// Un solo modal genérico (HelpModal) reutilizado por cada planilla que tenga
// su propio instructivo — evita duplicar el marcado por cada una.

const SIC_HELP_STEPS: { n: number; text: ReactNode }[] = [
  { n: 1, text: <>Entrá a <strong>SIEPEC</strong> y andá a <strong>Siga → Compras → Solicitante</strong>.</> },
  { n: 2, text: <>Abrí <strong>Resumen de Solicitudes Internas</strong>.</> },
  { n: 3, text: <>Seleccioná la pestaña <strong>«Rango de fechas»</strong> y elegí desde el <strong>01/01/2017</strong> hasta tu fecha actual.</> },
  { n: 4, text: <>Hacé click a la derecha en <strong>«Envíos»</strong> y luego en <strong>«Encontrar»</strong>.</> },
  { n: 5, text: <>Cuando se abra la lista, seleccioná la carpetita y elegí <strong>SIC (ALL)</strong>.</> },
  { n: 6, text: <>Andá a <strong>Archivo → Exportar</strong> para descargar el Excel.</> },
];

// Instructivo original: "Instructivo para Exportar Transacciones de SIEPEC".
const TRANSACCIONES_HELP_STEPS: { n: number; text: ReactNode }[] = [
  { n: 1, text: <>Entrá a <strong>SIEPEC</strong> y andá a <strong>Siga → Compras → Recepción e Inspección → Resumen de Transacción de Recepción</strong>.</> },
  { n: 2, text: <>En la ventana que se abre, seleccioná la pestaña <strong>«Zona A»</strong> y tocá <strong>Aceptar</strong>.</> },
  { n: 3, text: <>Elegí <strong>«Detalle de Transacción»</strong>, cargá el rango de fechas, tildá <strong>«Transacciones»</strong> y tocá <strong>«Encontrar»</strong>.</> },
  { n: 4, text: <>Andá a <strong>Archivo → Exportar</strong>.</> },
  { n: 5, text: <>Elegí <strong>«Continuar hasta el final»</strong> y esperá — puede tardar varios minutos.</> },
];

function HelpModal({
  titulo, intro, steps, nota, onClose,
}: {
  titulo: string;
  intro:  ReactNode;
  steps:  { n: number; text: ReactNode }[];
  nota?:  ReactNode;
  onClose: () => void;
}) {
  const ultimo = steps.length + 1;
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "oklch(0 0 0 / 0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ width: "100%", maxWidth: 520, maxHeight: "min(90vh, 640px)", display: "flex", flexDirection: "column", borderRadius: 16, overflow: "hidden", background: "oklch(0.15 0.005 270)", border: "1px solid oklch(1 0 0 / 0.09)", boxShadow: "0 24px 64px -20px oklch(0 0 0 / 0.8)" }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid var(--hairline)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 8, background: "color-mix(in oklab, var(--accent-emerald-deep) 35%, transparent)", border: "1px solid color-mix(in oklab, var(--accent-emerald) 45%, transparent)", color: "var(--accent-green)" }}>
              <HelpCircle className="w-4 h-4" />
            </div>
            <span style={{ fontSize: 16, fontWeight: 600, color: "var(--foreground)", letterSpacing: -0.3 }}>{titulo}</span>
          </div>
          <button onClick={onClose} style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 7, background: "transparent", border: "1px solid oklch(1 0 0 / 0.08)", color: "oklch(0.60 0 0)", cursor: "pointer", transition: "color .15s, background .15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.90 0 0)"; (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.22 0.005 270)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.60 0 0)"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "22px 24px" }}>
          <p style={{ fontSize: 13.5, color: "oklch(0.72 0 0)", lineHeight: 1.6, marginBottom: 16 }}>
            {intro}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {steps.map(s => (
              <div key={s.n} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 999, background: "#a78bfa", color: "oklch(0.12 0 0)", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{s.n}</span>
                <span style={{ fontSize: 13.5, color: "oklch(0.85 0 0)", lineHeight: 1.55, paddingTop: 1 }}>{s.text}</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 999, background: "var(--accent-green)", color: "oklch(0.12 0 0)", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{ultimo}</span>
              <span style={{ fontSize: 13.5, color: "oklch(0.85 0 0)", lineHeight: 1.55, paddingTop: 1 }}>
                Volvé acá y subí ese archivo <strong>.xlsx</strong> en esta tarjeta.
              </span>
            </div>
          </div>
          {nota && (
            <div style={{ display: "flex", gap: 10, padding: "10px 14px", borderRadius: 9, background: "color-mix(in oklab, var(--accent-emerald-deep) 12%, transparent)", border: "1px solid color-mix(in oklab, var(--accent-emerald) 22%, transparent)", marginTop: 18 }}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--accent-green)" }} />
              <span style={{ fontSize: 12.5, color: "oklch(0.78 0 0)", lineHeight: 1.55 }}>
                {nota}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 24px", borderTop: "1px solid var(--hairline)", flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--accent-green)", color: "oklch(0.10 0 0)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            <Check className="w-4 h-4" /> Entendido
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function PlanillaCard({
  tipo, label, descripcion, accentClass, state, onUpload, onClear, onHelp,
}: {
  tipo:        PlanillaType;
  label:       string;
  descripcion: string;
  accentClass: string;
  state:       PlanillaState;
  onUpload:    (file: File) => void;
  onClear:     () => void;
  onHelp?:     () => void;
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
      <div className="flex items-start justify-between gap-2">
        {/* min-h reserva el alto de 2 líneas de descripción: sin esto, una
            descripción corta ("Planilla «Envíos»") deja esa tarjeta más baja
            que una que sí ocupa dos líneas ("Solicitudes internas de
            compra"), y todo lo de abajo (filas, botón de carga, etc.) queda
            desalineado entre tarjetas. */}
        <div className="min-h-[38px]">
          <div className={cn("text-xs font-bold uppercase tracking-widest mb-0.5", accentClass)}>{label}</div>
          <p className="text-sm font-semibold text-foreground">{descripcion}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onHelp && (
            <button
              onClick={onHelp}
              title="Cómo exportar esta planilla desde SIEPEC"
              className="flex items-center justify-center w-6 h-6 rounded-full text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          )}
          {!state.loading && hasData && (
            <span className="flex items-center gap-1 text-xs text-success bg-success/10 px-2 py-1 rounded-full">
              <CheckCircle2 className="w-3 h-3" />OK
            </span>
          )}
        </div>
      </div>

      {/* min-h reserva el alto de las 2 líneas (filas + actualizado): sin
          esto, una tarjeta sin `uploadedAt` o en otro estado queda más baja
          que sus vecinas y el resto de la tarjeta (carga, botón) se desalinea. */}
      <div className="min-h-[38px]">
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
      </div>

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
              {hasData ? "Cargar" : "Subir archivo"} <span className="font-medium text-foreground">.xlsx</span>
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
    OP:            { ...INIT },
    SIC:           { ...INIT },
    MATRICULAS:    { ...INIT },
    TRANSACCIONES: { ...INIT },
  });

  // Archivo de SICs pendiente de confirmar el modo de subida (abre el diálogo).
  const [sicFile, setSicFile] = useState<File | null>(null);
  // Ayuda: cómo exportar las SICs desde SIEPEC.
  const [sicHelpOpen, setSicHelpOpen] = useState(false);
  const [txHelpOpen,  setTxHelpOpen]  = useState(false);
  // Archivo de MATRICULAS pendiente de confirmar el modo (abre el diálogo).
  const [matFile, setMatFile] = useState<File | null>(null);

  // Auth / role
  const [userId,    setUserId]    = useState<string | null>(null);
  const [canConfig, setCanConfig] = useState(true);

  // Recordatorios: la config es por usuario y vive en el diálogo compartido
  // (ver lib/notificaciones.ts). Acá solo se abre.
  const [configOpen, setConfigOpen] = useState(false);

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
      OP:            { ...prev.OP,            loading: true },
      SIC:           { ...prev.SIC,           loading: true },
      MATRICULAS:    { ...prev.MATRICULAS,    loading: true },
      TRANSACCIONES: { ...prev.TRANSACCIONES, loading: true },
    }));
    const [opCnt, opTs, sicStatus, matCnt, matTs, txCnt, txTs] = await Promise.all([
      supabase.from("planillas_op").select("*",        { count: "exact", head: true }),
      supabase.from("planillas_op").select("uploaded_at").order("uploaded_at", { ascending: false }).limit(1),
      getSicSolerStatus().catch(() => ({ count: 0, uploadedAt: null })),
      supabase.from("matriculas").select("*",          { count: "exact", head: true }),
      supabase.from("matriculas").select("updated_at").order("updated_at", { ascending: false }).limit(1),
      supabase.from("tablero_op_transaccion").select("*",         { count: "exact", head: true }),
      // Sin uploaded_at propia: se usa created_at, que es lo que ya tiene la
      // tabla (log de movimientos, no una planilla que se reemplaza como tal).
      supabase.from("tablero_op_transaccion").select("created_at").order("created_at", { ascending: false }).limit(1),
    ]);
    const isMissing = (msg: string) =>
      msg.includes("Invalid path") || msg.includes("does not exist") || msg.includes("Invalid api key");
    if (opCnt.error  && !isMissing(opCnt.error.message))  toast.error(`Error OP: ${opCnt.error.message}`);
    if (matCnt.error && !isMissing(matCnt.error.message)) toast.error(`Error MATRICULAS: ${matCnt.error.message}`);
    if (txCnt.error  && !isMissing(txCnt.error.message))  toast.error(`Error TRANSACCIONES: ${txCnt.error.message}`);
    setStates({
      OP:            { count: opCnt.count  ?? 0, uploadedAt: (opTs.data  as {uploaded_at: string}[]|null)?.[0]?.uploaded_at  ?? null, loading: false, uploading: false },
      SIC:           { count: sicStatus.count,   uploadedAt: sicStatus.uploadedAt,                                                    loading: false, uploading: false },
      MATRICULAS:    { count: matCnt.count ?? 0, uploadedAt: (matTs.data as {updated_at:  string}[]|null)?.[0]?.updated_at   ?? null, loading: false, uploading: false },
      TRANSACCIONES: { count: txCnt.count  ?? 0, uploadedAt: (txTs.data  as {created_at:  string}[]|null)?.[0]?.created_at   ?? null, loading: false, uploading: false },
    });
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);


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
        // fechaStr, NO str: con str() una celda de fecha del Excel queda como
        // "Tue Jul 23 2024 00:00:48 GMT-0300", que no se puede ordenar ni
        // comparar (alfabéticamente ordena por el nombre del día). fechaStr la
        // deja en ISO "YYYY-MM-DD", igual que ya hacía la carga de SIC.
        // Lo viejo ya cargado se sigue leyendo bien: gd_parse_fecha() en SQL y
        // fmtFechaISO() en el front entienden los dos formatos.
        fecha_creacion:       fechaStr(r["Fecha Creación"]  ?? r["Fecha Creacion"]),
        fecha_pactada:        fechaStr(r["Fecha Pactada"]),
        // organizacion_envio (columna «Organización Envío» del Excel) se dejó
        // de cargar: no era confiable y la Zona pasó a ser 100% manual, desde
        // op_datos (ver docs/buscador.md). La columna se borró de planillas_op
        // — ver supabase/planillas_op_drop_organizacion_envio.sql.
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
      if (userId) await markUpdated("planillas-OP", "OP — Envíos (órdenes de compra)", userId).catch(() => {});
      reconstruirIndiceEnSegundoPlano("cargar OP");
    } catch (e) {
      toast.error(`Error OP: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setS("OP", { uploading: false });
      await loadStatus();
    }
  };

  // Fecha del Excel → ISO con hora (columna `fecha timestamptz`, no una fecha
  // suelta): con cellDates:true llega como Date ya en hora local, así que
  // toISOString() da el instante correcto. Si por lo que sea la celda vino
  // como texto (columna mal formateada en el export), cae a parseFechaArg,
  // que entiende "dd/mm/aaaa hh:mm:ss" — el mismo parser que ya usa Tablero
  // OP para la carga por texto pegado.
  const fechaHoraISO = (v: unknown): string | null =>
    v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : parseFechaArg(v as string);

  const uploadTransacciones = async (file: File) => {
    setS("TRANSACCIONES", { uploading: true });
    try {
      const rows = await parseFile(file, 1, ["Tipo Transacción", "Importe", "Fecha", "Artículo", "Número Pedido"]);
      if (!rows.length) { toast.error("TRANSACCIONES: sin datos"); return; }

      let sinPedido = 0;
      let invalidas = 0;
      const mapped: Record<string, unknown>[] = [];
      for (const r of rows) {
        const tipo     = str(r["Tipo Transacción"] ?? r["Tipo"]);
        const importe  = parseNum(r["Importe"] ?? r["Cantidad"]);
        const fecha    = fechaHoraISO(r["Fecha"]);
        const articulo = normArticulo(r["Artículo"] ?? r["Articulo"]);
        const numeroPedidoRaw = r["Número Pedido"] ?? r["Numero Pedido"];
        const numero_pedido   = parseEntero(numeroPedidoRaw);

        if (!tipo || importe === null || !fecha || !articulo) { invalidas++; continue; }
        if (numero_pedido === null) {
          // Sin Número Pedido y el resto de la fila es válida → movimiento
          // interno (transferencia entre zonas, sin OP asociada). No se puede
          // cruzar con ninguna SIC/OP → se omite a propósito, no es un error
          // (mismo criterio que ya usa Tablero OP para este mismo caso).
          sinPedido++;
          continue;
        }
        mapped.push({
          tipo, importe, fecha,
          articulo,
          numero_pedido,
          linea:     str(r["Línea"] ?? r["Linea"]) || null,
          proveedor: str(r["Proveedor"]) || null,
        });
      }
      if (!mapped.length) { toast.error("TRANSACCIONES: no quedó ninguna fila válida para guardar."); return; }

      const { error: del } = await supabase.from("tablero_op_transaccion").delete().not("id", "is", null);
      if (del) { toast.error(`Error limpiando TRANSACCIONES: ${del.message}`); return; }
      for (let i = 0; i < mapped.length; i += BATCH) {
        const { error } = await supabase.from("tablero_op_transaccion").insert(mapped.slice(i, i + BATCH));
        if (error) { toast.error(`Error insertando TRANSACCIONES: ${error.message}`); return; }
      }
      toast.success(
        `TRANSACCIONES: ${mapped.length.toLocaleString("es-AR")} filas guardadas` +
        (sinPedido ? ` · ${sinPedido} movimiento(s) interno(s) omitido(s)` : "") +
        (invalidas ? ` · ${invalidas} fila(s) inválida(s) descartada(s)` : "")
      );
      if (userId) await markUpdated("planillas-TRANSACCIONES", "TRANSACCIONES — Log de movimientos", userId).catch(() => {});
      // Es la fuente de los campos tx_* del índice del Buscador (Recibido/
      // Aceptado/Entregado/devoluciones por línea) y del detalle de entregas
      // — sin reconstruir, quedarían mostrando el histórico anterior.
      reconstruirIndiceEnSegundoPlano("cargar transacciones");
    } catch (e) {
      toast.error(`Error TRANSACCIONES: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setS("TRANSACCIONES", { uploading: false });
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
        const cant    = pick(r, ["Cantidad", "Ctd", "Cant"]);
        const precio  = pick(r, ["Precio", "Precio Unitario", "Precio Unit"]);
        const importe = pick(r, ["Importe", "Monto"]);
        return {
          numero_sic:     str(pick(r, ["Número", "Numero", "N° SIC", "Nro SIC", "SIC", "Número SIC", "Numero SIC"])),
          linea:          str(pick(r, ["Línea", "Linea"])),
          articulo:       str(pick(r, ["Artículo", "Articulo", "Artículo Código", "Articulo Codigo"])),
          descripcion:    str(pick(r, ["Descripción", "Descripcion", "Descripción Artículo", "Descripcion Articulo"])),
          cantidad:       cant    != null && cant    !== "" ? Number(cant)    : null,
          precio:         precio  != null && precio  !== "" ? Number(precio)  : null,
          importe:        importe != null && importe !== "" ? Number(importe) : null,
          udm:            str(pick(r, ["UDM", "UdM", "Unidad Medida", "Unidad de Medida", "Unidad Medida Primaria"])),
          preparador:     str(pick(r, ["Preparador", "Preparador Nombre", "SC Preparador Nombre"])),
          numero_op:      str(pick(r, ["Número Pedido", "Numero Pedido", "Nro Pedido", "Número OP", "Numero OP", "OP", "Pedido"])),
          fecha_creacion: fechaStr(pick(r, ["Fecha Creación", "Fecha Creacion", "Fecha de Creación", "Fecha de Creacion"])),
        };
      }).filter(r => r.numero_sic);

      if (!mapped.length) { toast.error("SIC: no se encontró la columna 'Número' (N° de SIC)"); return; }

      if (mode === "replace") await replaceSicSoler(mapped);
      else                    await upsertSicSoler(mapped);

      const conOp = mapped.filter(r => r.numero_op !== "").length;
      toast.success(`SIC: ${mapped.length.toLocaleString("es-AR")} filas ${mode === "replace" ? "cargadas" : "actualizadas"} · ${conOp.toLocaleString("es-AR")} con OP`);
      if (conOp === 0) toast.error("Ojo: ninguna fila trae N° de OP (columna 'Número Pedido'). Revisá el archivo.");
      if (userId) await markUpdated("planillas-SIC", "SICs", userId).catch(() => {});
      reconstruirIndiceEnSegundoPlano("cargar SIC");
    } catch (e) {
      toast.error(`Error SIC: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setS("SIC", { uploading: false });
      await loadStatus();
    }
  };

  const uploadMatriculas = async (file: File, mode: MatUploadMode) => {
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
      const dedupMap = new Map<string, typeof rawMapped[0]>();
      for (const r of rawMapped) dedupMap.set(r.articulo, r);
      const mapped = [...dedupMap.values()];

      if (mode === "overwrite") {
        // Reemplazo total: borra todo el catálogo y reinserta.
        const { error: del } = await supabase.from("matriculas").delete().not("id", "is", null);
        if (del) { toast.error(`Error limpiando MATRICULAS: ${del.message}`); return; }
      } else {
        // Merge: borra solo las matrículas que vienen en el archivo (para
        // refrescarlas sin duplicar) y conserva el resto del catálogo.
        const articulos = mapped.map(r => r.articulo);
        for (let i = 0; i < articulos.length; i += 200) {
          const { error } = await supabase
            .from("matriculas")
            .delete()
            .in("articulo", articulos.slice(i, i + 200));
          if (error) { toast.error(`Error actualizando MATRICULAS: ${error.message}`); return; }
        }
      }

      for (let i = 0; i < mapped.length; i += BATCH) {
        const { error } = await supabase.from("matriculas").insert(mapped.slice(i, i + BATCH));
        if (error) { toast.error(`Error insertando MATRICULAS: ${error.message}`); return; }
      }
      toast.success(
        mode === "overwrite"
          ? `MATRICULAS: ${mapped.length.toLocaleString("es-AR")} filas guardadas (catálogo reemplazado)`
          : `MATRICULAS: ${mapped.length.toLocaleString("es-AR")} filas agregadas/actualizadas`,
      );
      if (userId) await markUpdated("planillas-MATRICULAS", "MATRICULAS — Catálogo de materiales", userId).catch(() => {});
      reconstruirIndiceEnSegundoPlano("cargar MATRICULAS");
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
    if (error) {
      toast.error(`Error: ${error.message}`);
    } else {
      toast.success(`${tipo} limpiada`);
      // Igual que al subir: sin esto el índice del Buscador seguiría
      // mostrando los tx_* y el detalle de entregas del histórico borrado.
      if (tabla === "tablero_op_transaccion") reconstruirIndiceEnSegundoPlano("limpiar transacciones");
    }
    await loadStatus();
  };

  const handleUpload = (tipo: PlanillaType, file: File) => {
    if (tipo === "OP")                  uploadOP(file);
    else if (tipo === "SIC")            setSicFile(file);   // abre el diálogo Sobreescribir/Actualizar
    else if (tipo === "TRANSACCIONES")  uploadTransacciones(file);   // siempre reemplaza, sin diálogo — igual que OP
    else                                setMatFile(file);   // abre el diálogo Agregar/Sobrescribir
  };

  // Confirma el modo elegido en el diálogo y sube la planilla de SICs.
  const confirmSicUpload = (mode: SicUploadMode) => {
    const file = sicFile;
    setSicFile(null);
    if (file) uploadSIC(file, mode);
  };

  // Confirma el modo elegido en el diálogo y sube la planilla de MATRICULAS.
  const confirmMatUpload = (mode: MatUploadMode) => {
    const file = matFile;
    setMatFile(null);
    if (file) uploadMatriculas(file, mode);
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
    const tabla = tipo === "OP" ? "planillas_op" : tipo === "TRANSACCIONES" ? "tablero_op_transaccion" : "matriculas";
    clearTable(tipo, tabla);
  };

  const allLoaded = !states.OP.loading && !states.SIC.loading && !states.MATRICULAS.loading && !states.TRANSACCIONES.loading;
  const allReady  = states.OP.count > 0 && states.SIC.count > 0 && states.MATRICULAS.count > 0 && states.TRANSACCIONES.count > 0;

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
          <CheckCircle2 className="w-4 h-4 shrink-0" />Las 4 planillas están cargadas.
        </div>
      )}
      {allLoaded && !allReady && (
        <div className="flex items-center gap-2 text-sm text-warning bg-warning/10 border border-warning/20 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />Faltan planillas por cargar — el Buscador y el Resumen de Servicios dependen de las 4.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        <PlanillaCard tipo="OP"            label="OP"            descripcion="Planilla «Envíos»"       accentClass="text-blue-400"    state={states.OP}            onUpload={f => handleUpload("OP",            f)} onClear={() => handleClear("OP")}            />
        <PlanillaCard tipo="SIC"           label="SIC"           descripcion="Solicitudes internas de compra" accentClass="text-purple-400"  state={states.SIC}           onUpload={f => handleUpload("SIC",           f)} onClear={() => handleClear("SIC")}           onHelp={() => setSicHelpOpen(true)} />
        <PlanillaCard tipo="MATRICULAS"    label="MATRICULAS"    descripcion="Catálogo de materiales"   accentClass="text-emerald-400" state={states.MATRICULAS}    onUpload={f => handleUpload("MATRICULAS",    f)} onClear={() => handleClear("MATRICULAS")}    />
        <PlanillaCard tipo="TRANSACCIONES" label="TRANSACCIONES" descripcion="Log de movimientos"       accentClass="text-orange-400"  state={states.TRANSACCIONES} onUpload={f => handleUpload("TRANSACCIONES", f)} onClear={() => handleClear("TRANSACCIONES")} onHelp={() => setTxHelpOpen(true)} />
      </div>

      {/* Diálogo Sobreescribir / Actualizar al subir la planilla de SICs */}
      {sicFile && createPortal(
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
          onClick={() => setSicFile(null)}
        >
          <div
            className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <span className="text-sm font-semibold text-foreground">¿Cómo cargar las SICs?</span>
              <button
                onClick={() => setSicFile(null)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2.5">
              <p className="text-xs text-muted-foreground px-0.5">
                Archivo: <span className="text-foreground font-medium">{sicFile.name}</span>
              </p>
              <button
                onClick={() => confirmSicUpload("replace")}
                className="w-full text-left p-3.5 rounded-lg border border-accent/40 bg-accent/10 hover:bg-accent/15 transition-colors"
              >
                <p className="text-sm font-semibold text-foreground">Sobreescribir</p>
                <p className="text-xs text-muted-foreground mt-0.5">Borra la planilla de SICs actual y carga el archivo de cero.</p>
              </button>
              <button
                onClick={() => confirmSicUpload("update")}
                className="w-full text-left p-3.5 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 transition-colors"
              >
                <p className="text-sm font-semibold text-foreground">Actualizar</p>
                <p className="text-xs text-muted-foreground mt-0.5">Actualiza las SICs que coinciden (por N° SIC + línea), agrega las nuevas y conserva el resto.</p>
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Diálogo Agregar a la base / Sobrescribir al subir la planilla de MATRICULAS */}
      {matFile && createPortal(
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
          onClick={() => setMatFile(null)}
        >
          <div
            className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <span className="text-sm font-semibold text-foreground">¿Cómo cargar las matrículas?</span>
              <button
                onClick={() => setMatFile(null)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2.5">
              <p className="text-xs text-muted-foreground px-0.5">
                Archivo: <span className="text-foreground font-medium">{matFile.name}</span>
              </p>
              <button
                onClick={() => confirmMatUpload("append")}
                className="w-full text-left p-3.5 rounded-lg border border-accent/40 bg-accent/10 hover:bg-accent/15 transition-colors"
              >
                <p className="text-sm font-semibold text-foreground">Agregar a la base</p>
                <p className="text-xs text-muted-foreground mt-0.5">Conserva el catálogo actual, agrega las nuevas y actualiza las que vengan repetidas en el archivo.</p>
              </button>
              <button
                onClick={() => confirmMatUpload("overwrite")}
                className="w-full text-left p-3.5 rounded-lg border border-destructive/40 bg-destructive/10 hover:bg-destructive/15 transition-colors"
              >
                <p className="text-sm font-semibold text-foreground">Sobrescribir completo</p>
                <p className="text-xs text-muted-foreground mt-0.5">Borra todo el catálogo actual y carga solo este archivo.</p>
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Reminder config dialog — rendered via portal to escape stacking context */}
      {configOpen && userId && (
        <DialogRecordatorios userId={userId} onClose={() => setConfigOpen(false)} onGuardado={() => {}} />
      )}

      {sicHelpOpen && (
        <HelpModal
          titulo="Cómo exportar las SICs"
          intro={<>Seguí estos pasos en <strong>SIEPEC</strong> para descargar el Excel de SICs con las columnas correctas (Artículo, Línea, Cantidad y Número Pedido incluidos).</>}
          steps={SIC_HELP_STEPS}
          nota={<>Si el archivo exportado no trae la columna <strong>«Número Pedido»</strong>, el sistema no va a poder cruzar las SICs con la OP — es señal de que se exportó otro reporte (por ejemplo, uno de cabeceras) en vez del detalle por línea.</>}
          onClose={() => setSicHelpOpen(false)}
        />
      )}
      {txHelpOpen && (
        <HelpModal
          titulo="Cómo exportar las Transacciones"
          intro={<>Seguí estos pasos en <strong>SIEPEC</strong> para descargar el detalle de transacciones de recepción (Recibir / Aceptar / Entregar y devoluciones).</>}
          steps={TRANSACCIONES_HELP_STEPS}
          nota={<>El export puede tardar varios minutos en generarse — es un reporte pesado, no hace falta reintentar si tarda.</>}
          onClose={() => setTxHelpOpen(false)}
        />
      )}
    </div>
  );
}
