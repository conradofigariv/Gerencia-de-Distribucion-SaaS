"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
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
  Database,
  Eye,
  AlertTriangle,
  Info,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type Step = "assign" | "processing" | "preview" | "uploading" | "done" | "error";
type Strategy = "replace" | "upsert";

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
  // Dynamic import to avoid SSR bundle bloat
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
      } catch (err) {
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
      oc_numero:        toNum(opRow["Número"]),
      linea:            toNum(opRow["Línea"]),
      descripcion:      toStr(opRow["Descripción Artículo"]),
      udm:              toStr(opRow["UDM"]),
      fecha_creacion:   toDate(opRow["Fecha Creación"]),
      fecha_pactada:    toDate(opRow["Fecha Pactada"]),
      organizacion_envio: toStr(opRow["Organización Envío"]),
      cantidad:         toNum(opRow["Cantidad"]),
      cantidad_recibida:toNum(opRow["Cantidad Recibida"]),
      proveedor:        toStr(opRow["Proveedor"]),
      estado:           toStr(opRow["Estado Autorización"]),
      estado_cierre:    toStr(opRow["Estado Cierre"]),
      sc_numero:        toStr(qwRow["SC_NUMERO"]),
      sc_descripcion:   toStr(qwRow["SC_DESCRIPCION"]),
      precio_unitario:  toNum(qwRow["OC_PRECIO_UNITARIO"]),
      fecha_pactada_oc: toDate(qwRow["OC_FECHA_PACTADA"]),
      sc_estado:        toStr(qwRow["SC_ESTADO"]),
    });
  }

  return { data, unmatched };
};

const BATCH_SIZE = 500;

const uploadToSupabase = async (
  data: MappedRow[],
  strategy: Strategy,
  onProgress: (pct: number) => void
): Promise<void> => {
  if (strategy === "replace") {
    onProgress(0);
    const { error: delError } = await supabase
      .from("servicios")
      .delete()
      .gte("oc_numero", 0);
    if (delError) throw new Error(`Error al limpiar tabla: ${delError.message}`);
  }

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    let error: { message: string } | null = null;

    if (strategy === "upsert") {
      ({ error } = await supabase
        .from("servicios")
        .upsert(batch, { onConflict: "oc_numero,linea" }) as { error: { message: string } | null });
    } else {
      ({ error } = await supabase
        .from("servicios")
        .insert(batch) as { error: { message: string } | null });
    }

    if (error) throw new Error(`Error al insertar lote ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
    onProgress(Math.round(((i + batch.length) / data.length) * 100));
  }
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

  const roleLabel = role === "QW" ? "Archivo QW" : "Archivo OP";
  const roleDesc =
    role === "QW"
      ? "Columna clave: COMBINACION"
      : "Columna clave: Relación";
  const roleColor = role === "QW" ? "text-chart-1" : "text-accent";
  const roleBorder = role === "QW" ? "border-chart-1/40" : "border-accent/40";
  const roleBg = role === "QW" ? "bg-chart-1/8" : "bg-accent/8";

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-2">
        <span className={cn("text-sm font-semibold", roleColor)}>{roleLabel}</span>
        <span className="text-xs text-muted-foreground">({roleDesc})</span>
      </div>

      {file ? (
        <div
          className={cn(
            "border rounded-xl p-4 flex items-center gap-3 transition-all duration-200",
            roleBorder,
            roleBg
          )}
        >
          <FileSpreadsheet className={cn("w-8 h-8 shrink-0", roleColor)} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB
            </p>
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

// ─── Preview Table ────────────────────────────────────────────────────────────

const PREVIEW_COLS: { key: keyof MappedRow; label: string }[] = [
  { key: "oc_numero", label: "OC Nro" },
  { key: "linea", label: "Línea" },
  { key: "descripcion", label: "Descripción" },
  { key: "proveedor", label: "Proveedor" },
  { key: "cantidad", label: "Cant." },
  { key: "estado", label: "Estado" },
  { key: "precio_unitario", label: "P. Unit." },
];

function PreviewTable({ rows }: { rows: MappedRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-secondary/50 border-b border-border">
            {PREVIEW_COLS.map((c) => (
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
            <tr
              key={i}
              className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
            >
              {PREVIEW_COLS.map((c) => {
                const val = row[c.key];
                const display =
                  c.key === "descripcion"
                    ? String(val ?? "").slice(0, 40) + (String(val ?? "").length > 40 ? "…" : "")
                    : c.key === "precio_unitario"
                    ? `$${toNum(val).toLocaleString("es-AR")}`
                    : String(val ?? "—");
                return (
                  <td key={c.key} className="py-2.5 px-3 text-foreground whitespace-nowrap">
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ServiciosCargaSection() {
  const [files, setFiles] = useState<{ QW: File | null; OP: File | null }>({
    QW: null,
    OP: null,
  });
  const [step, setStep] = useState<Step>("assign");
  const [allData, setAllData] = useState<MappedRow[]>([]);
  const [unmatched, setUnmatched] = useState(0);
  const [existingCount, setExistingCount] = useState<number | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("upsert");
  const [progress, setProgress] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const bothAssigned = files.QW !== null && files.OP !== null;

  // ── Bottom table
  const PAGE_SIZE = 50;
  const [tableData, setTableData] = useState<MappedRow[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tablePage, setTablePage] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);

  const fetchTableData = useCallback(async (page: number) => {
    setTableLoading(true);
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, count, error } = await supabase
      .from("servicios")
      .select("*", { count: "exact" })
      .range(from, to)
      .order("oc_numero", { ascending: true });
    if (!error && data) {
      setTableData(data as MappedRow[]);
      setTableTotal(count ?? 0);
      setTablePage(page);
    }
    setTableLoading(false);
  }, []);

  useEffect(() => {
    fetchTableData(0);
  }, [fetchTableData]);

  // ── Swap files between roles
  const swapFiles = () => {
    setFiles((prev) => ({ QW: prev.OP, OP: prev.QW }));
  };

  // ── Process: parse + join
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

      // Fetch existing count
      const { count } = await supabase
        .from("servicios")
        .select("*", { count: "exact", head: true });

      setAllData(data);
      setUnmatched(u);
      setExistingCount(count ?? 0);
      setStep("preview");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error desconocido");
      setStep("error");
    }
  };

  // ── Upload
  const handleUpload = async () => {
    setStep("uploading");
    setProgress(0);

    try {
      await uploadToSupabase(allData, strategy, (pct) => setProgress(pct));
      setUploadedCount(allData.length);
      setStep("done");
      fetchTableData(0);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error al subir datos");
      setStep("error");
    }
  };

  // ── Reset
  const reset = () => {
    setFiles({ QW: null, OP: null });
    setStep("assign");
    setAllData([]);
    setUnmatched(0);
    setExistingCount(null);
    setProgress(0);
    setErrorMsg("");
  };

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Procesá dos archivos Excel, visualizá el resultado y subí los datos a Supabase
        </p>
      </div>

      {/* ── Step indicator */}
      <div className="flex items-center gap-2 text-xs">
        {(["assign", "preview", "uploading", "done"] as Step[]).map((s, i, arr) => {
          const labels: Record<string, string> = {
            assign: "1. Archivos",
            preview: "2. Vista previa",
            uploading: "3. Cargando",
            done: "4. Listo",
          };
          const isDone =
            step === "done" ||
            (step === "uploading" && i < 2) ||
            (step === "preview" && i < 1) ||
            (step === "processing" && i < 1);
          const isActive = step === s || (step === "processing" && s === "assign");
          const showActive = step === "preview" && s === "preview" ||
            step === "uploading" && s === "uploading" ||
            step === "done" && s === "done" ||
            (step === "assign" || step === "processing") && s === "assign";

          return (
            <React.Fragment key={s}>
              <span
                className={cn(
                  "px-2.5 py-1 rounded-full font-medium transition-all duration-200",
                  showActive
                    ? "bg-accent text-accent-foreground"
                    : isDone
                    ? "bg-success/20 text-success"
                    : "bg-secondary text-muted-foreground"
                )}
              >
                {labels[s]}
              </span>
              {i < arr.length - 1 && (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              )}
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
                Asigná cada archivo al rol correspondiente antes de procesar
              </p>
            </div>
          </div>

          {/* Drop zones */}
          <div className="flex items-start gap-4">
            <DropZone
              role="QW"
              file={files.QW}
              onFile={(f) => setFiles((p) => ({ ...p, QW: f }))}
              onClear={() => setFiles((p) => ({ ...p, QW: null }))}
              disabled={step === "processing"}
            />

            {/* Swap button */}
            <button
              onClick={swapFiles}
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
            Join: <span className="font-mono text-foreground mx-1">QW.COMBINACION</span> =
            <span className="font-mono text-foreground mx-1">OP.Relación</span> · Las filas de OP
            sin coincidencia en QW se descartan
          </div>

          {/* Process button */}
          <div className="flex justify-end mt-5">
            <button
              onClick={handleProcess}
              disabled={!bothAssigned || step === "processing"}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {step === "processing" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  Procesar archivos
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          STEP: preview
      ════════════════════════════════════════════ */}
      {step === "preview" && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Summary */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Eye className="w-5 h-5 text-accent" />
                <h3 className="text-base font-semibold text-foreground">Vista previa del resultado</h3>
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
              </div>
            </div>

            <PreviewTable rows={allData.slice(0, 5)} />

            {allData.length > 5 && (
              <p className="text-xs text-muted-foreground mt-2 text-right">
                Mostrando 5 de {allData.length.toLocaleString("es-AR")} filas
              </p>
            )}
          </div>

          {/* Strategy */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <Database className="w-5 h-5 text-accent" />
              <div>
                <h3 className="text-base font-semibold text-foreground">Estrategia de carga</h3>
                {existingCount !== null && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    La tabla <span className="font-mono text-foreground">servicios</span> tiene{" "}
                    <span className="font-semibold text-foreground">
                      {existingCount.toLocaleString("es-AR")}
                    </span>{" "}
                    registro{existingCount !== 1 ? "s" : ""} actualmente
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {(
                [
                  {
                    value: "upsert" as Strategy,
                    label: "Insertar / Actualizar (recomendado)",
                    desc: "Inserta nuevos registros y actualiza los existentes usando oc_numero + linea como clave única",
                    icon: CheckCircle2,
                    color: "text-accent",
                  },
                  {
                    value: "replace" as Strategy,
                    label: "Reemplazar todo",
                    desc: "Borra todos los registros existentes de la tabla y los reemplaza con los nuevos datos",
                    icon: AlertTriangle,
                    color: "text-warning",
                  },
                ] as const
              ).map((opt) => {
                const Icon = opt.icon;
                const selected = strategy === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={cn(
                      "flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all duration-200",
                      selected
                        ? "border-accent/50 bg-accent/8"
                        : "border-border hover:border-muted-foreground/30 hover:bg-secondary/30"
                    )}
                  >
                    <input
                      type="radio"
                      name="strategy"
                      value={opt.value}
                      checked={selected}
                      onChange={() => setStrategy(opt.value)}
                      className="mt-0.5 accent-current"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Icon className={cn("w-4 h-4", opt.color)} />
                        <span className="text-sm font-medium text-foreground">{opt.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{opt.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            {strategy === "replace" && existingCount !== null && existingCount > 0 && (
              <div className="mt-3 flex items-center gap-2 text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Se eliminarán {existingCount.toLocaleString("es-AR")} registros existentes antes de insertar
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={reset}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200"
            >
              <ChevronLeft className="w-4 h-4" />
              Volver
            </button>
            <button
              onClick={handleUpload}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all duration-200"
            >
              <Database className="w-4 h-4" />
              Confirmar y subir
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          STEP: uploading
      ════════════════════════════════════════════ */}
      {step === "uploading" && (
        <div className="bg-card border border-border rounded-xl p-8 text-center animate-in fade-in duration-300">
          <Loader2 className="w-10 h-10 text-accent animate-spin mx-auto mb-4" />
          <h3 className="text-base font-semibold text-foreground mb-1">Subiendo datos...</h3>
          <p className="text-sm text-muted-foreground mb-5">
            {strategy === "replace"
              ? "Limpiando tabla e insertando nuevos registros"
              : "Insertando y actualizando registros"}
          </p>

          {/* Progress bar */}
          <div className="max-w-sm mx-auto">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span>{progress < 5 && strategy === "replace" ? "Eliminando..." : "Insertando..."}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {Math.round((allData.length * progress) / 100).toLocaleString("es-AR")} /{" "}
              {allData.length.toLocaleString("es-AR")} filas
            </p>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          STEP: done
      ════════════════════════════════════════════ */}
      {step === "done" && (
        <div className="bg-card border border-border rounded-xl p-10 text-center animate-in fade-in zoom-in-95 duration-400">
          <div className="w-16 h-16 rounded-full bg-success/15 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-success" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">¡Carga completada!</h3>
          <p className="text-sm text-muted-foreground mb-6">
            <span className="text-foreground font-semibold">
              {uploadedCount.toLocaleString("es-AR")} registros
            </span>{" "}
            subidos correctamente a la tabla{" "}
            <span className="font-mono text-accent">servicios</span>
          </p>
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-all duration-200"
          >
            <RefreshCw className="w-4 h-4" />
            Nueva carga
          </button>
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
          TABLA DE DATOS ACTUALES
      ════════════════════════════════════════════ */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-accent" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">Datos en Supabase</h3>
              <p className="text-xs text-muted-foreground">
                {tableLoading
                  ? "Cargando..."
                  : `${tableTotal.toLocaleString("es-AR")} registro${tableTotal !== 1 ? "s" : ""} en total`}
              </p>
            </div>
          </div>
          <button
            onClick={() => fetchTableData(tablePage)}
            disabled={tableLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40 transition-all duration-200"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", tableLoading && "animate-spin")} />
            Actualizar
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {tableLoading && tableData.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-accent animate-spin" />
            </div>
          ) : tableData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Database className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No hay registros en la tabla</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-secondary/50 border-b border-border">
                  {[
                    { key: "oc_numero", label: "OC Nro" },
                    { key: "linea", label: "Línea" },
                    { key: "descripcion", label: "Descripción" },
                    { key: "proveedor", label: "Proveedor" },
                    { key: "cantidad", label: "Cantidad" },
                    { key: "cantidad_recibida", label: "Recibida" },
                    { key: "estado", label: "Estado" },
                    { key: "precio_unitario", label: "P. Unit." },
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
                {tableData.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
                  >
                    <td className="py-2.5 px-3 text-foreground font-mono whitespace-nowrap">{row.oc_numero}</td>
                    <td className="py-2.5 px-3 text-foreground whitespace-nowrap">{row.linea}</td>
                    <td className="py-2.5 px-3 text-foreground max-w-[240px] truncate">
                      {String(row.descripcion ?? "").slice(0, 50)}{String(row.descripcion ?? "").length > 50 ? "…" : ""}
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
          )}
        </div>

        {/* Pagination */}
        {tableTotal > PAGE_SIZE && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border">
            <span className="text-xs text-muted-foreground">
              Página {tablePage + 1} de {Math.ceil(tableTotal / PAGE_SIZE)} · {tableTotal.toLocaleString("es-AR")} registros
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchTableData(tablePage - 1)}
                disabled={tablePage === 0 || tableLoading}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Anterior
              </button>
              <button
                onClick={() => fetchTableData(tablePage + 1)}
                disabled={(tablePage + 1) * PAGE_SIZE >= tableTotal || tableLoading}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
              >
                Siguiente
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
