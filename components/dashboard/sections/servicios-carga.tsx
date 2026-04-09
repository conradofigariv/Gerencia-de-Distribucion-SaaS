"use client";

import React, { useState, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  UploadCloud,
  AlertCircle,
  RefreshCw,
  FileSpreadsheet,
  X,
  ArrowDownToLine,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Search,
  Filter,
  Table2,
  AlertTriangle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Step     = "assign" | "processing" | "result" | "error";
type FileRole = "OP" | "QW" | "MATRICULAS";

interface SeguimientoRow {
  nro_op:          string;
  fecha:           string;
  cliente:         string;
  matricula:       string;
  tipo_servicio:   string;
  estado:          string;
  observaciones:   string;
  fecha_prometida: string;
  modelo:          string;
  serie:           string;
  propietario:     string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normaliza clave de cruce */
const norm = (val: unknown): string =>
  String(val ?? "").toString().trim().toUpperCase();

/** Valor limpio como string */
const str = (val: unknown): string => String(val ?? "").trim();

const parseExcel = async (file: File): Promise<Record<string, unknown>[]> => {
  const XLSX = await import("xlsx");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: "array", cellDates: false });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        resolve(
          XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: false })
        );
      } catch {
        reject(new Error("No se pudo leer el archivo. Verificá que sea un Excel válido."));
      }
    };
    reader.onerror = () => reject(new Error("Error al leer el archivo."));
    reader.readAsArrayBuffer(file);
  });
};

const buildSeguimiento = (
  opRows:         Record<string, unknown>[],
  qwRows:         Record<string, unknown>[],
  matriculasRows: Record<string, unknown>[]
): SeguimientoRow[] => {
  // Mapas de cruce
  const qwMap  = new Map<string, Record<string, unknown>>();
  const matMap = new Map<string, Record<string, unknown>>();

  for (const row of qwRows) {
    const key = norm(row["NRO OP"]);
    if (key) qwMap.set(key, row);
  }
  for (const row of matriculasRows) {
    const key = norm(row["MATRICULA"]);
    if (key) matMap.set(key, row);
  }

  return opRows.map((op) => {
    const qw  = qwMap.get(norm(op["NRO OP"]));
    const mat = matMap.get(norm(op["MATRICULA"]));

    return {
      nro_op:          str(op["NRO OP"]),
      fecha:           str(op["FECHA"]),
      cliente:         str(op["CLIENTE"]),
      matricula:       str(op["MATRICULA"]),
      tipo_servicio:   str(op["TIPO DE SERVICIO"]),
      estado:          qw  ? str(qw["ESTADO"])           : "Sin datos en QW",
      observaciones:   qw  ? str(qw["OBSERVACIONES"])    : "",
      fecha_prometida: qw  ? str(qw["FECHA PROMETIDA"])  : "",
      modelo:          mat ? str(mat["MODELO"])           : "",
      serie:           mat ? str(mat["SERIE"])            : "",
      propietario:     mat ? str(mat["PROPIETARIO"])      : "",
    };
  });
};

// ─── DropZone config ──────────────────────────────────────────────────────────

const ROLE_CFG: Record<FileRole, { label: string; desc: string; color: string; border: string; bg: string }> = {
  OP:         { label: "OP",         desc: "Tabla principal",     color: "text-accent",  border: "border-accent/40",  bg: "bg-accent/8"  },
  QW:         { label: "QW",         desc: "Cruce por NRO OP",    color: "text-chart-1", border: "border-chart-1/40", bg: "bg-chart-1/8" },
  MATRICULAS: { label: "MATRICULAS", desc: "Cruce por MATRICULA", color: "text-chart-2", border: "border-chart-2/40", bg: "bg-chart-2/8" },
};

interface DropZoneProps {
  role:     FileRole;
  file:     File | null;
  onFile:   (f: File) => void;
  onClear:  () => void;
  disabled?: boolean;
}

function DropZone({ role, file, onFile, onClear, disabled }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cfg = ROLE_CFG[role];

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

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-2">
        <span className={cn("text-sm font-bold", cfg.color)}>{cfg.label}</span>
        <span className="text-xs text-muted-foreground">({cfg.desc})</span>
      </div>

      {file ? (
        <div className={cn("border rounded-xl p-3 flex items-center gap-3", cfg.border, cfg.bg)}>
          <FileSpreadsheet className={cn("w-7 h-7 shrink-0", cfg.color)} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{file.name}</p>
            <p className="text-[11px] text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
          {!disabled && (
            <button onClick={onClear} className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">
              <X className="w-3.5 h-3.5" />
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
            "border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all duration-200",
            dragOver
              ? cn("border-current", cfg.color, cfg.bg)
              : "border-border hover:border-muted-foreground/40 hover:bg-secondary/30",
            disabled && "pointer-events-none opacity-40"
          )}
        >
          <UploadCloud className="w-6 h-6 text-muted-foreground mx-auto mb-1.5" />
          <p className="text-xs text-muted-foreground">
            Arrastrá o <span className="text-foreground font-medium">seleccioná</span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">.xlsx / .xls</p>
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

// ─── Estado badge ─────────────────────────────────────────────────────────────

function EstadoBadge({ estado }: { estado: string }) {
  const lower = estado.toLowerCase();
  const cls =
    estado === "Sin datos en QW"                              ? "bg-secondary text-muted-foreground" :
    lower.includes("pend") || lower.includes("espera")       ? "bg-warning/15 text-warning"         :
    lower.includes("cerr") || lower.includes("complet") ||
    lower.includes("finaliz") || lower.includes("ok")        ? "bg-success/15 text-success"         :
    lower.includes("cancel") || lower.includes("rechaz")     ? "bg-destructive/15 text-destructive" :
                                                                "bg-secondary/80 text-foreground";
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap", cls)}>
      {estado || "—"}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export function ServiciosCargaSection() {
  const [files, setFiles]           = useState<Record<FileRole, File | null>>({ OP: null, QW: null, MATRICULAS: null });
  const [step, setStep]             = useState<Step>("assign");
  const [allData, setAllData]       = useState<SeguimientoRow[]>([]);
  const [errorMsg, setErrorMsg]     = useState("");
  const [search, setSearch]         = useState("");
  const [estadoFilter, setEstado]   = useState("todos");
  const [tablePage, setTablePage]   = useState(0);
  const [exporting, setExporting]   = useState(false);

  const allAssigned = files.OP !== null && files.QW !== null && files.MATRICULAS !== null;
  const missing     = (["OP", "QW", "MATRICULAS"] as FileRole[]).filter((r) => !files[r]);

  // ── Derived data
  const estadoOptions = useMemo(() => {
    const set = new Set(allData.map((r) => r.estado).filter(Boolean));
    return ["todos", ...Array.from(set).sort()];
  }, [allData]);

  const filteredData = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allData.filter((row) => {
      const matchEstado  = estadoFilter === "todos" || row.estado === estadoFilter;
      const matchSearch  = !q || row.cliente.toLowerCase().includes(q) || row.nro_op.toLowerCase().includes(q);
      return matchEstado && matchSearch;
    });
  }, [allData, search, estadoFilter]);

  const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
  const pagedRows  = filteredData.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE);

  const setSearchAndReset  = (v: string) => { setSearch(v);  setTablePage(0); };
  const setEstadoAndReset  = (v: string) => { setEstado(v);  setTablePage(0); };

  // ── Process
  const handleProcess = async () => {
    if (!files.OP || !files.QW || !files.MATRICULAS) return;
    setStep("processing");
    setErrorMsg("");
    try {
      const [opRows, qwRows, matRows] = await Promise.all([
        parseExcel(files.OP),
        parseExcel(files.QW),
        parseExcel(files.MATRICULAS),
      ]);
      if (opRows.length === 0) throw new Error("El archivo OP está vacío.");
      if (qwRows.length === 0) throw new Error("El archivo QW está vacío.");
      const data = buildSeguimiento(opRows, qwRows, matRows);
      if (data.length === 0) throw new Error("El archivo OP no contiene filas válidas.");
      setAllData(data);
      setTablePage(0);
      setStep("result");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error desconocido");
      setStep("error");
    }
  };

  // ── Export
  const handleExport = async () => {
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const sheet = XLSX.utils.json_to_sheet(
        filteredData.map((r) => ({
          "NRO OP":           r.nro_op,
          "FECHA":            r.fecha,
          "CLIENTE":          r.cliente,
          "MATRICULA":        r.matricula,
          "TIPO DE SERVICIO": r.tipo_servicio,
          "ESTADO":           r.estado,
          "OBSERVACIONES":    r.observaciones,
          "FECHA PROMETIDA":  r.fecha_prometida,
          "MODELO":           r.modelo,
          "SERIE":            r.serie,
          "PROPIETARIO":      r.propietario,
        }))
      );
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet, "Seguimiento");
      XLSX.writeFile(wb, "seguimiento_consolidado.xlsx");
    } finally {
      setExporting(false);
    }
  };

  // ── Reset
  const reset = () => {
    setFiles({ OP: null, QW: null, MATRICULAS: null });
    setStep("assign");
    setAllData([]);
    setErrorMsg("");
    setSearch("");
    setEstado("todos");
    setTablePage(0);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Cargá los tres archivos para generar el Seguimiento Consolidado
      </p>

      {/* ════════ CARGA DE ARCHIVOS ════════ */}
      {(step === "assign" || step === "processing") && (
        <div className="bg-card border border-border rounded-xl p-6 space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Carga de archivos</h3>
              <p className="text-xs text-muted-foreground">Los tres archivos son obligatorios</p>
            </div>
          </div>

          {!allAssigned && (
            <div className="flex items-center gap-2 text-xs bg-warning/10 border border-warning/20 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-warning" />
              <span className="text-muted-foreground">
                Falta{missing.length > 1 ? "n" : ""}:{" "}
                <span className="text-foreground font-semibold">{missing.join(", ")}</span>
              </span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            {(["OP", "QW", "MATRICULAS"] as FileRole[]).map((role) => (
              <DropZone
                key={role}
                role={role}
                file={files[role]}
                onFile={(f) => setFiles((p) => ({ ...p, [role]: f }))}
                onClear={() => setFiles((p) => ({ ...p, [role]: null }))}
                disabled={step === "processing"}
              />
            ))}
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleProcess}
              disabled={!allAssigned || step === "processing"}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {step === "processing"
                ? <><Loader2 className="w-4 h-4 animate-spin" />Procesando...</>
                : <>Generar seguimiento<ChevronRight className="w-4 h-4" /></>}
            </button>
          </div>
        </div>
      )}

      {/* ════════ ERROR ════════ */}
      {step === "error" && (
        <div className="bg-card border border-destructive/30 rounded-xl p-8 text-center animate-in fade-in duration-300">
          <div className="w-14 h-14 rounded-full bg-destructive/15 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-7 h-7 text-destructive" />
          </div>
          <h3 className="text-base font-semibold text-foreground mb-2">Error al procesar</h3>
          <p className="text-sm text-destructive/80 bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 max-w-lg mx-auto mb-5">
            {errorMsg}
          </p>
          <button onClick={reset} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-all">
            <RefreshCw className="w-4 h-4" />Intentar de nuevo
          </button>
        </div>
      )}

      {/* ════════ RESULTADO ════════ */}
      {step === "result" && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* Barra de controles */}
          <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center gap-3">
            {/* Buscador */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearchAndReset(e.target.value)}
                placeholder="Buscar por cliente o NRO OP…"
                className="w-full h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
              />
            </div>

            {/* Filtro estado */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
              <select
                value={estadoFilter}
                onChange={(e) => setEstadoAndReset(e.target.value)}
                className="h-9 pl-3 pr-8 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all cursor-pointer"
              >
                {estadoOptions.map((e) => (
                  <option key={e} value={e}>{e === "todos" ? "Todos los estados" : e}</option>
                ))}
              </select>
            </div>

            {/* Contador + acciones */}
            <div className="flex items-center gap-3 ml-auto">
              <span className="text-xs text-muted-foreground">
                <span className="text-foreground font-medium">{filteredData.length.toLocaleString("es-AR")}</span>
                {" "}de {allData.length.toLocaleString("es-AR")} registros
              </span>

              <button
                onClick={handleExport}
                disabled={exporting || filteredData.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-all disabled:opacity-50"
              >
                {exporting
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <ArrowDownToLine className="w-4 h-4" />}
                Exportar Excel
              </button>

              <button
                onClick={reset}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" />Nueva carga
              </button>
            </div>
          </div>

          {/* Tabla seguimiento */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-secondary/50 border-b border-border">
                    {["NRO OP","FECHA","CLIENTE","MATRÍCULA","TIPO SERVICIO","ESTADO","OBSERVACIONES","F. PROMETIDA","MODELO","SERIE","PROPIETARIO"].map((h) => (
                      <th key={h} className="text-left py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-sm text-muted-foreground">
                        No hay registros que coincidan con los filtros
                      </td>
                    </tr>
                  ) : (
                    pagedRows.map((row, i) => (
                      <tr key={i} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                        <td className="py-2.5 px-3 text-foreground font-mono whitespace-nowrap">{row.nro_op}</td>
                        <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{row.fecha || "—"}</td>
                        <td className="py-2.5 px-3 text-foreground whitespace-nowrap max-w-[160px] truncate" title={row.cliente}>{row.cliente || "—"}</td>
                        <td className="py-2.5 px-3 text-foreground font-mono whitespace-nowrap">{row.matricula || "—"}</td>
                        <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{row.tipo_servicio || "—"}</td>
                        <td className="py-2.5 px-3"><EstadoBadge estado={row.estado} /></td>
                        <td className="py-2.5 px-3 text-muted-foreground max-w-[200px] truncate" title={row.observaciones}>{row.observaciones || "—"}</td>
                        <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{row.fecha_prometida || "—"}</td>
                        <td className="py-2.5 px-3 text-foreground whitespace-nowrap">{row.modelo || "—"}</td>
                        <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{row.serie || "—"}</td>
                        <td className="py-2.5 px-3 text-foreground whitespace-nowrap max-w-[140px] truncate" title={row.propietario}>{row.propietario || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Página {tablePage + 1} de {totalPages} · {filteredData.length.toLocaleString("es-AR")} registros
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setTablePage((p) => p - 1)}
                    disabled={tablePage === 0}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />Anterior
                  </button>
                  <button
                    onClick={() => setTablePage((p) => p + 1)}
                    disabled={tablePage >= totalPages - 1}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    Siguiente<ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Placeholder inicial */}
      {step === "assign" && (
        <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Table2 className="w-10 h-10 mb-3 opacity-20" />
          <p className="text-sm">El Seguimiento Consolidado aparecerá aquí</p>
          <p className="text-xs mt-1 opacity-60">Cargá los 3 archivos y presioná "Generar seguimiento"</p>
        </div>
      )}
    </div>
  );
}
