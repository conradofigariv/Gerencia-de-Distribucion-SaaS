"use client";

import React, { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FileSpreadsheet,
  X,
  ArrowLeftRight,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Eye,
  AlertTriangle,
  Info,
  Table2,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type Step = "assign" | "processing" | "preview" | "error";

interface MappedRow {
  oc_numero: number;
  linea: number;
  descripcion: string;
  udm: string;
  fecha_creacion: string | null;
  fecha_pactada: string | null;
  organizacion_envio: string;
  cantidad: number;
  cantidad_recibida: number;
  proveedor: string;
  estado: string;
  estado_cierre: string;
  sc_numero: string;
  sc_descripcion: string;
  precio_unitario: number;
  fecha_pactada_oc: string | null;
  sc_estado: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toNum = (val: unknown): number => {
  if (val == null || val === "") return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
};

const toStr = (val: unknown): string => {
  if (val == null) return "";
  return String(val).trim();
};

const toDate = (val: unknown): string | null => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val.toISOString();
  if (typeof val === "string" && val.trim()) {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
};

const parseExcel = async (file: File): Promise<Record<string, unknown>[]> => {
  const XLSX = await import("xlsx");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
          defval: null,
          raw: true,
        });
        resolve(rows);
      } catch {
        reject(new Error("No se pudo leer el archivo. Verificá que sea un Excel válido."));
      }
    };
    reader.onerror = () => reject(new Error("Error al leer el archivo."));
    reader.readAsArrayBuffer(file);
  });
};

const validateColumns = (
  rows: Record<string, unknown>[],
  role: "QW" | "OP"
): string | null => {
  if (rows.length === 0) return `El archivo ${role} está vacío.`;
  const headers = Object.keys(rows[0]);
  const required =
    role === "QW"
      ? ["COMBINACION"]
      : ["Relación", "Número", "Línea"];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length > 0)
    return `Columnas faltantes en archivo ${role}: ${missing.join(", ")}`;
  return null;
};

const joinAndMap = (
  qwRows: Record<string, unknown>[],
  opRows: Record<string, unknown>[]
): { data: MappedRow[]; unmatched: number } => {
  const qwMap = new Map<string, Record<string, unknown>>();
  for (const row of qwRows) {
    const key = toStr(row["COMBINACION"]);
    if (key) qwMap.set(key, row);
  }

  let unmatched = 0;
  const data: MappedRow[] = [];

  for (const opRow of opRows) {
    const key = toStr(opRow["Relación"]);
    const qwRow = qwMap.get(key);
    if (!qwRow) { unmatched++; continue; }

    data.push({
      oc_numero:          toNum(opRow["Número"]),
      linea:              toNum(opRow["Línea"]),
      descripcion:        toStr(opRow["Descripción Artículo"]),
      udm:                toStr(opRow["UDM"]),
      fecha_creacion:     toDate(opRow["Fecha Creación"]),
      fecha_pactada:      toDate(opRow["Fecha Pactada"]),
      organizacion_envio: toStr(opRow["Organización Envío"]),
      cantidad:           toNum(opRow["Cantidad"]),
      cantidad_recibida:  toNum(opRow["Cantidad Recibida"]),
      proveedor:          toStr(opRow["Proveedor"]),
      estado:             toStr(opRow["Estado Autorización"]),
      estado_cierre:      toStr(opRow["Estado Cierre"]),
      sc_numero:          toStr(qwRow["SC_NUMERO"]),
      sc_descripcion:     toStr(qwRow["SC_DESCRIPCION"]),
      precio_unitario:    toNum(qwRow["OC_PRECIO_UNITARIO"]),
      fecha_pactada_oc:   toDate(qwRow["OC_FECHA_PACTADA"]),
      sc_estado:          toStr(qwRow["SC_ESTADO"]),
    });
  }

  return { data, unmatched };
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface DropZoneProps {
  role: "QW" | "OP";
  file: File | null;
  onFile: (f: File) => void;
  onClear: () => void;
  disabled?: boolean;
}

function DropZone({ role, file, onFile, onClear, disabled }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile, disabled]
  );

  const roleLabel  = role === "QW" ? "Archivo QW" : "Archivo OP";
  const roleDesc   = role === "QW" ? "Columna clave: COMBINACION" : "Columna clave: Relación";
  const roleColor  = role === "QW" ? "text-chart-1" : "text-accent";
  const roleBorder = role === "QW" ? "border-chart-1/40" : "border-accent/40";
  const roleBg     = role === "QW" ? "bg-chart-1/8"  : "bg-accent/8";

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-2">
        <span className={cn("text-sm font-semibold", roleColor)}>{roleLabel}</span>
        <span className="text-xs text-muted-foreground">({roleDesc})</span>
      </div>

      {file ? (
        <div className={cn("border rounded-xl p-4 flex items-center gap-3 transition-all duration-200", roleBorder, roleBg)}>
          <FileSpreadsheet className={cn("w-8 h-8 shrink-0", roleColor)} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
            <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
          {!disabled && (
            <button
              onClick={onClear}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : (
        <div
          onClick={() => !disabled && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={cn(
            "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200",
            dragOver
              ? cn("border-current", roleColor, roleBg)
              : "border-border hover:border-muted-foreground/40 hover:bg-secondary/30",
            disabled && "pointer-events-none opacity-40"
          )}
        >
          <UploadCloud className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Arrastrá o <span className="text-foreground font-medium">seleccioná</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">.xlsx / .xls</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ─── Data Table ───────────────────────────────────────────────────────────────

function DataTable({ rows }: { rows: MappedRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-secondary/50 border-b border-border">
            {[
              { key: "oc_numero",         label: "OC Nro"     },
              { key: "linea",             label: "Línea"      },
              { key: "descripcion",       label: "Descripción"},
              { key: "proveedor",         label: "Proveedor"  },
              { key: "cantidad",          label: "Cant."      },
              { key: "cantidad_recibida", label: "Recibida"   },
              { key: "estado",            label: "Estado"     },
              { key: "precio_unitario",   label: "P. Unit."   },
            ].map((c) => (
              <th
                key={c.key}
                className="text-left py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
              <td className="py-2.5 px-3 text-foreground font-mono whitespace-nowrap">{row.oc_numero}</td>
              <td className="py-2.5 px-3 text-foreground whitespace-nowrap">{row.linea}</td>
              <td className="py-2.5 px-3 text-foreground max-w-[220px] truncate">
                {String(row.descripcion ?? "").slice(0, 45)}{String(row.descripcion ?? "").length > 45 ? "…" : ""}
              </td>
              <td className="py-2.5 px-3 text-foreground whitespace-nowrap max-w-[160px] truncate">{row.proveedor}</td>
              <td className="py-2.5 px-3 text-foreground whitespace-nowrap text-right">{toNum(row.cantidad).toLocaleString("es-AR")}</td>
              <td className="py-2.5 px-3 text-foreground whitespace-nowrap text-right">{toNum(row.cantidad_recibida).toLocaleString("es-AR")}</td>
              <td className="py-2.5 px-3 whitespace-nowrap">
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[11px] font-medium",
                  row.estado === "Autorizada"
                    ? "bg-success/15 text-success"
                    : row.estado === "Cancelada"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-secondary text-muted-foreground"
                )}>
                  {row.estado || "—"}
                </span>
              </td>
              <td className="py-2.5 px-3 text-foreground whitespace-nowrap text-right">
                ${toNum(row.precio_unitario).toLocaleString("es-AR")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export function ServiciosCargaSection() {
  const [files, setFiles] = useState<{ QW: File | null; OP: File | null }>({ QW: null, OP: null });
  const [step, setStep] = useState<Step>("assign");
  const [allData, setAllData] = useState<MappedRow[]>([]);
  const [unmatched, setUnmatched] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [tablePage, setTablePage] = useState(0);

  const bothAssigned = files.QW !== null && files.OP !== null;

  const handleProcess = async () => {
    if (!files.QW || !files.OP) return;
    setStep("processing");
    setErrorMsg("");

    try {
      const [qwRows, opRows] = await Promise.all([
        parseExcel(files.QW),
        parseExcel(files.OP),
      ]);

      const qwErr = validateColumns(qwRows, "QW");
      if (qwErr) throw new Error(qwErr);
      const opErr = validateColumns(opRows, "OP");
      if (opErr) throw new Error(opErr);

      const { data, unmatched: u } = joinAndMap(qwRows, opRows);

      if (data.length === 0) {
        throw new Error(
          "El join no produjo resultados. Verificá que los valores de COMBINACION y Relación coincidan."
        );
      }

      setAllData(data);
      setUnmatched(u);
      setTablePage(0);
      setStep("preview");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error desconocido");
      setStep("error");
    }
  };

  const reset = () => {
    setFiles({ QW: null, OP: null });
    setStep("assign");
    setAllData([]);
    setUnmatched(0);
    setErrorMsg("");
    setTablePage(0);
  };

  const totalPages = Math.ceil(allData.length / PAGE_SIZE);
  const pagedRows  = allData.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE);

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Cargá dos archivos Excel, procesá el join y visualizá los datos resultantes
        </p>
      </div>

      {/* ── Step indicator */}
      <div className="flex items-center gap-2 text-xs">
        {(["assign", "preview"] as const).map((s, i, arr) => {
          const labels = { assign: "1. Archivos", preview: "2. Resultado" };
          const isActive = (step === "assign" || step === "processing") ? s === "assign" : s === "preview";
          const isDone   = step === "preview" && s === "assign";
          return (
            <React.Fragment key={s}>
              <span
                className={cn(
                  "px-2.5 py-1 rounded-full font-medium transition-all duration-200",
                  isActive ? "bg-accent text-accent-foreground"
                  : isDone  ? "bg-success/20 text-success"
                  : "bg-secondary text-muted-foreground"
                )}
              >
                {labels[s]}
              </span>
              {i < arr.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
            </React.Fragment>
          );
        })}
      </div>

      {/* ════════════════════════════════════════════
          STEP: assign / processing
      ════════════════════════════════════════════ */}
      {(step === "assign" || step === "processing") && (
        <div className="bg-card border border-border rounded-xl p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Asignación de archivos</h3>
              <p className="text-xs text-muted-foreground">
                Ambos archivos son necesarios para procesar
              </p>
            </div>
          </div>

          {/* Both-required notice */}
          {!bothAssigned && (
            <div className="flex items-center gap-2 text-xs bg-warning/10 border border-warning/20 rounded-lg px-3 py-2.5 mb-5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-warning" />
              <span className="text-muted-foreground">
                Necesitás cargar <strong className="text-foreground">ambos archivos</strong> (QW y OP) antes de continuar
              </span>
            </div>
          )}

          {/* Drop zones */}
          <div className="flex items-start gap-4">
            <DropZone
              role="QW"
              file={files.QW}
              onFile={(f) => setFiles((p) => ({ ...p, QW: f }))}
              onClear={() => setFiles((p) => ({ ...p, QW: null }))}
              disabled={step === "processing"}
            />

            <button
              onClick={() => setFiles((prev) => ({ QW: prev.OP, OP: prev.QW }))}
              disabled={step === "processing" || (!files.QW && !files.OP)}
              title="Intercambiar roles"
              className="mt-8 w-9 h-9 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 shrink-0"
            >
              <ArrowLeftRight className="w-4 h-4" />
            </button>

            <DropZone
              role="OP"
              file={files.OP}
              onFile={(f) => setFiles((p) => ({ ...p, OP: f }))}
              onClear={() => setFiles((p) => ({ ...p, OP: null }))}
              disabled={step === "processing"}
            />
          </div>

          {/* Join info */}
          <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground bg-secondary/40 rounded-lg px-3 py-2.5">
            <Info className="w-3.5 h-3.5 shrink-0 text-accent" />
            Join: <span className="font-mono text-foreground mx-1">QW.COMBINACION</span>=
            <span className="font-mono text-foreground mx-1">OP.Relación</span>· Filas sin coincidencia se descartan
          </div>

          {/* Process button */}
          <div className="flex justify-end mt-5">
            <button
              onClick={handleProcess}
              disabled={!bothAssigned || step === "processing"}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {step === "processing" ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Procesando...</>
              ) : (
                <>Procesar archivos<ChevronRight className="w-4 h-4" /></>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          STEP: error
      ════════════════════════════════════════════ */}
      {step === "error" && (
        <div className="bg-card border border-destructive/30 rounded-xl p-8 text-center animate-in fade-in duration-300">
          <div className="w-14 h-14 rounded-full bg-destructive/15 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-7 h-7 text-destructive" />
          </div>
          <h3 className="text-base font-semibold text-foreground mb-2">Error al procesar</h3>
          <p className="text-sm text-destructive/80 bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 max-w-lg mx-auto mb-5">
            {errorMsg}
          </p>
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-all duration-200"
          >
            <RefreshCw className="w-4 h-4" />
            Intentar de nuevo
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════
          STEP: preview — resumen + tabla completa
      ════════════════════════════════════════════ */}
      {step === "preview" && (
        <>
          {/* Summary bar */}
          <div className="bg-card border border-border rounded-xl p-5 flex items-center justify-between animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-3">
              <Eye className="w-5 h-5 text-accent" />
              <h3 className="text-base font-semibold text-foreground">Resultado del join</h3>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded-full bg-accent/15 text-accent text-xs font-semibold">
                {allData.length.toLocaleString("es-AR")} filas
              </span>
              {unmatched > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-warning/15 text-warning text-xs font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {unmatched} sin coincidencia
                </span>
              )}
              <button
                onClick={reset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Nueva carga
              </button>
            </div>
          </div>

          {/* Full table */}
          <div className="bg-card border border-border rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <Table2 className="w-5 h-5 text-accent" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Datos procesados</h3>
                  <p className="text-xs text-muted-foreground">
                    {allData.length.toLocaleString("es-AR")} registros · página {tablePage + 1} de {totalPages}
                  </p>
                </div>
              </div>
              <CheckCircle2 className="w-4 h-4 text-success" />
            </div>

            <DataTable rows={pagedRows} />

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Página {tablePage + 1} de {totalPages} · {allData.length.toLocaleString("es-AR")} registros
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setTablePage((p) => p - 1)}
                    disabled={tablePage === 0}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Anterior
                  </button>
                  <button
                    onClick={() => setTablePage((p) => p + 1)}
                    disabled={tablePage >= totalPages - 1}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    Siguiente
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Placeholder inicial */}
      {step === "assign" && (
        <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-14 text-muted-foreground">
          <Table2 className="w-10 h-10 mb-3 opacity-20" />
          <p className="text-sm">Los datos procesados aparecerán aquí</p>
          <p className="text-xs mt-1 opacity-60">Cargá ambos archivos y presioná "Procesar"</p>
        </div>
      )}
    </div>
  );
}
