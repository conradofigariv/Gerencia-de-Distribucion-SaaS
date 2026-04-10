"use client";

import React, { useState, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  UploadCloud, FileSpreadsheet, X, Loader2,
  ChevronLeft, ChevronRight, Download, AlertCircle, AlertTriangle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Role = "OP" | "QW" | "MATRICULAS";
type Step = "upload" | "processing" | "result" | "error";

interface FileSlot {
  file: File;
  role: Role | "";
}

interface SeguimientoRow {
  ZONA:                        string;
  OP:                          string;
  "OP MADRE":                  string;
  SC:                          string;
  "DESCRIPCIÓN DE SC":         string;
  LÍNEA:                       string;
  MATRICULA:                   string;
  "DESCRIPCIÓN DE MATRICULA":  string;
  CANTIDAD:                    number;
  "CANTIDAD RECIBIDA":         number;
  "SALDO DE LINEA":            number;
  "FECHA DE CREACION":         string;
  "FECHA PACTADA":             string;
  PROVEEDOR:                   string;
  "FECHA REDETERMINACIÓN":     string;
  "PRECIO REDETERMINACIÓN":    number | string;
  ESTADO:                      string;
  "ESTADO DE PLAZO":           string;
  "ESTADO DE CANTIDADES":      string;
  REVISION:                    string;
  OBSERVACION:                 string;
  "DISPONIBILIDAD EN MESES":   number;
  "FECHA ACTUAL":              string;
  CANTIDAD2:                   number;
  "CANTIDAD DE MESES":         number;
  "CANTIDAD CONSUMIDA POR MES": number;
}

const COLUMNS: (keyof SeguimientoRow)[] = [
  "ZONA", "OP", "OP MADRE", "SC", "DESCRIPCIÓN DE SC", "LÍNEA",
  "MATRICULA", "DESCRIPCIÓN DE MATRICULA", "CANTIDAD", "CANTIDAD RECIBIDA",
  "SALDO DE LINEA", "FECHA DE CREACION", "FECHA PACTADA", "PROVEEDOR",
  "FECHA REDETERMINACIÓN", "PRECIO REDETERMINACIÓN", "ESTADO",
  "ESTADO DE PLAZO", "ESTADO DE CANTIDADES", "REVISION", "OBSERVACION",
  "DISPONIBILIDAD EN MESES", "FECHA ACTUAL", "CANTIDAD2",
  "CANTIDAD DE MESES", "CANTIDAD CONSUMIDA POR MES",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;

const str  = (v: unknown): string => String(v ?? "").trim();
const num  = (v: unknown): number => { const n = Number(v); return isNaN(n) ? 0 : n; };
const norm = (v: unknown): string => str(v).toUpperCase();

const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const fmtDate = (d: Date | null): string =>
  d ? d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

// Lee el archivo: headers reales en fila 2, datos desde fila 3
const parseFile = async (file: File): Promise<Record<string, unknown>[]> => {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: "array", cellDates: true });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
  if (raw.length < 2) return [];
  const hdrs = (raw[1] as unknown[]).map(h => str(h));
  return raw.slice(2)
    .filter(row => (row as unknown[]).some(c => c != null && c !== ""))
    .map(row => {
      const arr = row as unknown[];
      const obj: Record<string, unknown> = {};
      hdrs.forEach((h, i) => { if (h) obj[h] = arr[i] ?? null; });
      return obj;
    });
};

// ─── Core join + build ────────────────────────────────────────────────────────

const buildSeguimiento = (
  opRows:  Record<string, unknown>[],
  qwRows:  Record<string, unknown>[],
  matRows: Record<string, unknown>[]
): SeguimientoRow[] => {
  const today    = new Date();
  const todayStr = fmtDate(today);

  // QW map: COMBINACION → row
  const qwMap = new Map<string, Record<string, unknown>>();
  for (const r of qwRows) {
    const k = norm(r["COMBINACION"]);
    if (k) qwMap.set(k, r);
  }

  // MATRICULAS map: Artículo → row
  const matMap = new Map<string, Record<string, unknown>>();
  for (const r of matRows) {
    const k = norm(r["Artículo"]);
    if (k) matMap.set(k, r);
  }

  return opRows.map(op => {
    // Join key OP → QW: Número + Línea concatenados
    const joinKey = norm(op["Número"]) + norm(op["Línea"]);
    const qw  = qwMap.get(joinKey) ?? null;
    const mat = matMap.get(norm(op["Artículo"])) ?? null;

    const cantidad     = num(op["Cantidad"]);
    const cantRecib    = num(op["Cantidad Recibida"]);
    const saldoLinea   = cantidad - cantRecib;

    const fechaCreac   = toDate(op["Fecha Creación"]);
    const fechaPact    = toDate(op["Fecha Pactada"]);

    const estadoPlazo  = fechaPact && fechaPact < today ? "VENCIDA" : "OK";
    const estadoCant   = Math.round(saldoLinea) === 0   ? "SIN SALDO" : "VIGENTE";
    const revision     = estadoPlazo === "VENCIDA" || estadoCant === "SIN SALDO" ? "CERRAR" : "OK";

    const dias         = fechaCreac
      ? Math.floor((today.getTime() - fechaCreac.getTime()) / 86_400_000)
      : 0;
    const meses        = dias / 30;
    const consXMes     = meses === 0 ? 0 : cantRecib / meses;
    const disponib     = consXMes === 0 ? 0 : saldoLinea / consXMes;

    return {
      ZONA:                        "",
      OP:                          str(op["Número"]),
      "OP MADRE":                  "",
      SC:                          qw  ? str(qw["EXPEDIENTE_PLAZO_ENTREGA"]) : "",
      "DESCRIPCIÓN DE SC":         qw  ? str(qw["SC_DESCRIPCION"])           : "",
      LÍNEA:                       str(op["Línea"]),
      MATRICULA:                   str(op["Artículo"]),
      "DESCRIPCIÓN DE MATRICULA":  mat ? str(mat["Descripción"])              : "",
      CANTIDAD:                    cantidad,
      "CANTIDAD RECIBIDA":         cantRecib,
      "SALDO DE LINEA":            parseFloat(saldoLinea.toFixed(4)),
      "FECHA DE CREACION":         fmtDate(fechaCreac),
      "FECHA PACTADA":             fmtDate(fechaPact),
      PROVEEDOR:                   str(op["Proveedor"]),
      "FECHA REDETERMINACIÓN":     "",
      "PRECIO REDETERMINACIÓN":    qw  ? num(qw["OC_PRECIO_UNITARIO"])        : "",
      ESTADO:                      str(op["Estado Cierre"]),
      "ESTADO DE PLAZO":           estadoPlazo,
      "ESTADO DE CANTIDADES":      estadoCant,
      REVISION:                    revision,
      OBSERVACION:                 "",
      "DISPONIBILIDAD EN MESES":   parseFloat(disponib.toFixed(2)),
      "FECHA ACTUAL":              todayStr,
      CANTIDAD2:                   dias,
      "CANTIDAD DE MESES":         parseFloat(meses.toFixed(2)),
      "CANTIDAD CONSUMIDA POR MES": parseFloat(consXMes.toFixed(4)),
    };
  });
};

// ─── File Slot component ──────────────────────────────────────────────────────

const ROLE_LABELS: Record<Role, string> = {
  OP:         "OP — Órdenes de compra",
  QW:         "QW — Expedientes / SCs",
  MATRICULAS: "MATRICULAS — Catálogo",
};

interface SlotProps {
  idx:        number;
  slot:       FileSlot | null;
  takenRoles: Role[];
  loading:    boolean;
  onFile:     (f: File) => void;
  onRole:     (r: Role | "") => void;
  onClear:    () => void;
}

function FileSlotCard({ idx, slot, takenRoles, loading, onFile, onRole, onClear }: SlotProps) {
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile]);

  return (
    <div className="flex-1 min-w-0 bg-card border border-border rounded-xl p-4 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Archivo {idx + 1}
      </p>

      {/* Drop area */}
      <div
        onClick={() => !slot && !loading && ref.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-lg p-4 text-center transition-all duration-200",
          slot
            ? "border-accent/40 bg-accent/8 cursor-default"
            : drag
            ? "border-accent bg-accent/8 cursor-pointer"
            : "border-border hover:border-muted-foreground/40 hover:bg-secondary/20 cursor-pointer"
        )}
      >
        {loading ? (
          <Loader2 className="w-5 h-5 text-accent animate-spin mx-auto" />
        ) : slot ? (
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-accent shrink-0" />
            <span className="text-xs font-medium text-foreground truncate flex-1">{slot.file.name}</span>
            <button onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-all shrink-0">
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <>
            <UploadCloud className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">
              Arrastrá o <span className="text-foreground font-medium">seleccioná</span>
            </p>
          </>
        )}
      </div>

      <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />

      {/* Role selector */}
      {slot && (
        <select
          value={slot.role}
          onChange={(e) => onRole(e.target.value as Role | "")}
          className="w-full h-8 px-2 rounded-lg bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all cursor-pointer"
        >
          <option value="">— Asignar tipo —</option>
          {(["OP", "QW", "MATRICULAS"] as Role[]).map(r => (
            <option key={r} value={r} disabled={takenRoles.includes(r) && slot.role !== r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ─── Result table ─────────────────────────────────────────────────────────────

function ResultTable({ rows }: { rows: SeguimientoRow[] }) {
  const [page, setPage] = useState(0);
  const total = Math.ceil(rows.length / PAGE_SIZE);
  const paged = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-secondary/60 border-b border-border">
              {COLUMNS.map(c => (
                <th key={c} className="text-left py-2 px-3 text-muted-foreground font-semibold whitespace-nowrap sticky top-0 bg-secondary/60">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                {COLUMNS.map(c => {
                  const val = row[c];
                  const display = typeof val === "number" ? val.toLocaleString("es-AR") : String(val ?? "");
                  const isStatus = c === "ESTADO DE PLAZO" || c === "REVISION" || c === "ESTADO DE CANTIDADES";
                  return (
                    <td key={c} className="py-2 px-3 whitespace-nowrap max-w-[180px] truncate" title={display}>
                      {isStatus ? (
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[11px] font-medium",
                          val === "VENCIDA" || val === "CERRAR" ? "bg-destructive/15 text-destructive" :
                          val === "SIN SALDO"                   ? "bg-warning/15 text-warning"         :
                          val === "OK" || val === "VIGENTE"     ? "bg-success/15 text-success"         :
                          "bg-secondary text-muted-foreground"
                        )}>
                          {display || "—"}
                        </span>
                      ) : (
                        <span className="text-foreground">{display || "—"}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <span className="text-xs text-muted-foreground">
            Página {page + 1} de {total} · {rows.length.toLocaleString("es-AR")} filas
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => p - 1)} disabled={page === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all">
              <ChevronLeft className="w-3.5 h-3.5" />Anterior
            </button>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= total - 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all">
              Siguiente<ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ServiciosCargaSection() {
  const [slots, setSlots]     = useState<(FileSlot | null)[]>([null, null, null]);
  const [loading, setLoading] = useState<boolean[]>([false, false, false]);
  const [step, setStep]       = useState<Step>("upload");
  const [result, setResult]   = useState<SeguimientoRow[]>([]);
  const [error, setError]     = useState("");
  const [exporting, setExp]   = useState(false);

  const takenRoles = useMemo(
    () => slots.filter(Boolean).map(s => s!.role).filter(Boolean) as Role[],
    [slots]
  );

  const allReady = useMemo(() => {
    const roles = new Set(takenRoles);
    return roles.has("OP") && roles.has("QW") && roles.has("MATRICULAS");
  }, [takenRoles]);

  const setSlot = (idx: number, update: Partial<FileSlot> | null) =>
    setSlots(prev => {
      const next = [...prev];
      if (update === null) { next[idx] = null; }
      else { next[idx] = { ...next[idx]!, ...update }; }
      return next;
    });

  const handleFile = useCallback(async (idx: number, file: File) => {
    setLoading(prev => { const n = [...prev]; n[idx] = true; return n; });
    // Just store the file, parsing happens on generate
    setSlot(idx, { file, role: "" });
    setLoading(prev => { const n = [...prev]; n[idx] = false; return n; });
  }, []);

  const handleGenerate = async () => {
    setStep("processing");
    setError("");
    try {
      const getSlot = (role: Role) => slots.find(s => s?.role === role)!;
      const opSlot  = getSlot("OP");
      const qwSlot  = getSlot("QW");
      const matSlot = getSlot("MATRICULAS");

      const [opRows, qwRows, matRows] = await Promise.all([
        parseFile(opSlot.file),
        parseFile(qwSlot.file),
        parseFile(matSlot.file),
      ]);

      if (opRows.length  === 0) throw new Error("El archivo OP no tiene datos (verificá que los headers estén en fila 2).");
      if (qwRows.length  === 0) throw new Error("El archivo QW no tiene datos.");
      if (matRows.length === 0) throw new Error("El archivo MATRICULAS no tiene datos.");

      const data = buildSeguimiento(opRows, qwRows, matRows);
      setResult(data);
      setStep("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
      setStep("error");
    }
  };

  const handleExport = async () => {
    setExp(true);
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(result, { header: COLUMNS as string[] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Seguimiento");
      const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      XLSX.writeFile(wb, `Seguimiento_de_Servicios_${d}.xlsx`);
    } finally {
      setExp(false);
    }
  };

  const reset = () => {
    setSlots([null, null, null]);
    setStep("upload");
    setResult([]);
    setError("");
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ══════ UPLOAD ══════ */}
      {(step === "upload" || step === "processing") && (
        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Paso 1 — Cargá los 3 archivos y asigná el tipo</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Los headers deben estar en la fila 2 de cada archivo
            </p>
          </div>

          <div className="flex gap-4">
            {slots.map((slot, idx) => (
              <FileSlotCard
                key={idx}
                idx={idx}
                slot={slot}
                takenRoles={takenRoles.filter(r => slots[idx]?.role !== r)}
                loading={loading[idx]}
                onFile={(f) => handleFile(idx, f)}
                onRole={(r) => setSlot(idx, { role: r })}
                onClear={() => setSlot(idx, null)}
              />
            ))}
          </div>

          {/* Validación visual */}
          {!allReady && slots.some(Boolean) && (
            <div className="flex items-center gap-2 text-xs bg-warning/10 border border-warning/20 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
              <span className="text-muted-foreground">
                Asigná los 3 tipos distintos:{" "}
                {(["OP","QW","MATRICULAS"] as Role[])
                  .filter(r => !takenRoles.includes(r))
                  .map(r => <strong key={r} className="text-foreground mx-0.5">{r}</strong>)}
                {" "}falta{takenRoles.length < 2 ? "n" : ""}.
              </span>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleGenerate}
              disabled={!allReady || step === "processing"}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {step === "processing"
                ? <><Loader2 className="w-4 h-4 animate-spin" />Procesando...</>
                : "Generar Seguimiento →"}
            </button>
          </div>
        </div>
      )}

      {/* ══════ ERROR ══════ */}
      {step === "error" && (
        <div className="bg-card border border-destructive/30 rounded-xl p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/15 flex items-center justify-center mx-auto mb-3">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
          <h3 className="text-base font-semibold text-foreground mb-2">Error al procesar</h3>
          <p className="text-sm text-destructive/80 bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 max-w-lg mx-auto mb-5">
            {error}
          </p>
          <button onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-all">
            Intentar de nuevo
          </button>
        </div>
      )}

      {/* ══════ RESULT ══════ */}
      {step === "result" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Seguimiento generado</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {result.length.toLocaleString("es-AR")} filas · {COLUMNS.length} columnas
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handleExport} disabled={exporting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all disabled:opacity-50">
                {exporting
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Download className="w-4 h-4" />}
                Descargar .xlsx
              </button>
              <button onClick={reset}
                className="px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">
                Nueva carga
              </button>
            </div>
          </div>

          <ResultTable rows={result} />
        </div>
      )}
    </div>
  );
}
