"use client";

import React, { useState, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { dbGet, dbAppend, dbOverwriteByKey } from "@/lib/db";
import {
  UploadCloud, FileSpreadsheet, X, Loader2,
  ChevronLeft, ChevronRight, Download, AlertCircle, AlertTriangle,
  Plus, Trash2, ChevronRight as Arrow, Database, CheckCircle2,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Role = "OP" | "QW" | "MATRICULAS";
type Step = "upload" | "manual" | "processing" | "result" | "error";

interface FileSlot { file: File; role: Role | ""; }

interface ManualRow {
  id:        string;
  op:        string;
  opMadre:   string;
  linea:     string;
  matricula: string;
}

interface LookupMaps {
  opMap:  Map<string, Record<string, unknown>>;   // keyed by norm(Relación)
  qwMap:  Map<string, Record<string, unknown>>;   // keyed by norm(COMBINACION)
  matMap: Map<string, Record<string, unknown>>;   // keyed by norm(Artículo)
}

interface SeguimientoRow {
  ZONA:                         string;
  OP:                           string;
  "OP MADRE":                   string;
  SC:                           string;
  "DESCRIPCIÓN DE SC":          string;
  LÍNEA:                        string;
  MATRICULA:                    string;
  "DESCRIPCIÓN DE MATRICULA":   string;
  CANTIDAD:                     number;
  "CANTIDAD RECIBIDA":          number;
  "SALDO DE LINEA":             number;
  "FECHA DE CREACION":          string;
  "FECHA PACTADA":              string;
  PROVEEDOR:                    string;
  "FECHA REDETERMINACIÓN":      string;
  "PRECIO REDETERMINACIÓN":     number | string;
  ESTADO:                       string;
  "ESTADO DE PLAZO":            string;
  "ESTADO DE CANTIDADES":       string;
  REVISION:                     string;
  OBSERVACION:                  string;
  "DISPONIBILIDAD EN MESES":    number;
  "FECHA ACTUAL":               string;
  CANTIDAD2:                    number;
  "CANTIDAD DE MESES":          number;
  "CANTIDAD CONSUMIDA POR MES": number;
}

interface ResultRow extends SeguimientoRow {
  _errors: string[];
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
const uid = () => Math.random().toString(36).slice(2);

const str  = (v: unknown): string => String(v ?? "").trim();
const num  = (v: unknown): number => { const n = Number(v); return isNaN(n) ? 0 : n; };
const norm = (v: unknown): string => str(v).toUpperCase();

const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && v.trim()) { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  return null;
};
const fmtDate = (d: Date | null): string =>
  d ? d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

const parseFile = async (file: File): Promise<Record<string, unknown>[]> => {
  const XLSX = await import("xlsx");
  const buf  = await file.arrayBuffer();
  const wb   = XLSX.read(buf, { type: "array", cellDates: true });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const raw  = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
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

const buildMaps = (
  opRows: Record<string, unknown>[],
  qwRows: Record<string, unknown>[],
  matRows: Record<string, unknown>[]
): LookupMaps => {
  const opMap  = new Map<string, Record<string, unknown>>();
  const qwMap  = new Map<string, Record<string, unknown>>();
  const matMap = new Map<string, Record<string, unknown>>();
  for (const r of opRows)  { const k = norm(r["Relación"]);   if (k) opMap.set(k, r); }
  for (const r of qwRows)  { const k = norm(r["COMBINACION"]); if (k) qwMap.set(k, r); }
  for (const r of matRows) { const k = norm(r["Artículo"]);   if (k) matMap.set(k, r); }
  return { opMap, qwMap, matMap };
};

const buildSeguimiento = (
  manualRows: ManualRow[],
  { opMap, qwMap, matMap }: LookupMaps
): ResultRow[] => {
  const today    = new Date();
  const todayStr = fmtDate(today);

  return manualRows.map(mrow => {
    const opKey  = norm(mrow.op)      + norm(mrow.linea);
    const qwKey  = norm(mrow.opMadre) + norm(mrow.linea);
    const matKey = norm(mrow.matricula);

    const opRow  = opMap.get(opKey)   ?? null;
    const qwRow  = qwMap.get(qwKey)   ?? null;
    const matRow = matMap.get(matKey) ?? null;

    const errors: string[] = [];
    if (!opRow)  errors.push(`OP+LÍNEA "${opKey}" no encontrado en OP (col. Relación)`);
    if (!qwRow)  errors.push(`OP MADRE+LÍNEA "${qwKey}" no encontrado en QW (col. COMBINACION)`);
    if (!matRow) errors.push(`MATRÍCULA "${matKey}" no encontrada en MATRICULAS (col. Artículo)`);

    const cantidad   = opRow ? num(opRow["Cantidad"])          : 0;
    const cantRecib  = opRow ? num(opRow["Cantidad Recibida"]) : 0;
    const saldoLinea = cantidad - cantRecib;
    const fechaCreac = opRow ? toDate(opRow["Fecha Creación"]) : null;
    const fechaPact  = opRow ? toDate(opRow["Fecha Pactada"])  : null;

    const estadoPlazo = fechaPact && fechaPact < today ? "VENCIDA" : "OK";
    const estadoCant  = Math.round(saldoLinea) === 0   ? "SIN SALDO" : "VIGENTE";
    const revision    = estadoPlazo === "VENCIDA" || estadoCant === "SIN SALDO" ? "CERRAR" : "OK";

    const dias     = fechaCreac ? Math.floor((today.getTime() - fechaCreac.getTime()) / 86_400_000) : 0;
    const meses    = dias / 30;
    const consMes  = meses === 0 ? 0 : cantRecib / meses;
    const disponib = consMes  === 0 ? 0 : saldoLinea / consMes;

    return {
      _errors: errors,
      ZONA:                         "",
      OP:                           mrow.op,
      "OP MADRE":                   mrow.opMadre,
      SC:                           qwRow  ? str(qwRow["EXPEDIENTE_PLAZO_ENTREGA"]) : "",
      "DESCRIPCIÓN DE SC":          qwRow  ? str(qwRow["SC_DESCRIPCION"])           : "",
      LÍNEA:                        mrow.linea,
      MATRICULA:                    mrow.matricula,
      "DESCRIPCIÓN DE MATRICULA":   matRow ? str(matRow["Descripción"])             : "",
      CANTIDAD:                     cantidad,
      "CANTIDAD RECIBIDA":          cantRecib,
      "SALDO DE LINEA":             parseFloat(saldoLinea.toFixed(4)),
      "FECHA DE CREACION":          fmtDate(fechaCreac),
      "FECHA PACTADA":              fmtDate(fechaPact),
      PROVEEDOR:                    opRow  ? str(opRow["Proveedor"])                : "",
      "FECHA REDETERMINACIÓN":      "",
      "PRECIO REDETERMINACIÓN":     qwRow  ? num(qwRow["OC_PRECIO_UNITARIO"])       : "",
      ESTADO:                       opRow  ? str(opRow["Estado Cierre"])            : "",
      "ESTADO DE PLAZO":            estadoPlazo,
      "ESTADO DE CANTIDADES":       estadoCant,
      REVISION:                     revision,
      OBSERVACION:                  "",
      "DISPONIBILIDAD EN MESES":    parseFloat(disponib.toFixed(2)),
      "FECHA ACTUAL":               todayStr,
      CANTIDAD2:                    dias,
      "CANTIDAD DE MESES":          parseFloat(meses.toFixed(2)),
      "CANTIDAD CONSUMIDA POR MES": parseFloat(consMes.toFixed(4)),
    };
  });
};

// ─── FileSlotCard ─────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<Role, string> = {
  OP:         "OP — Órdenes de compra",
  QW:         "QW — Expedientes / SCs",
  MATRICULAS: "MATRICULAS — Catálogo",
};

function FileSlotCard({
  idx, slot, takenRoles, loading, onFile, onRole, onClear,
}: {
  idx: number; slot: FileSlot | null; takenRoles: Role[];
  loading: boolean; onFile: (f: File) => void;
  onRole: (r: Role | "") => void; onClear: () => void;
}) {
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0]; if (f) onFile(f);
  }, [onFile]);

  return (
    <div className="flex-1 min-w-0 bg-card border border-border rounded-xl p-4 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Archivo {idx + 1}</p>
      <div
        onClick={() => !slot && !loading && ref.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-lg p-4 text-center transition-all duration-200",
          slot ? "border-accent/40 bg-accent/8 cursor-default"
          : drag ? "border-accent bg-accent/8 cursor-pointer"
          : "border-border hover:border-muted-foreground/40 hover:bg-secondary/20 cursor-pointer"
        )}
      >
        {loading ? <Loader2 className="w-5 h-5 text-accent animate-spin mx-auto" />
        : slot ? (
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
            <p className="text-xs text-muted-foreground">Arrastrá o <span className="text-foreground font-medium">seleccioná</span></p>
          </>
        )}
      </div>
      <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      {slot && (
        <select value={slot.role} onChange={(e) => onRole(e.target.value as Role | "")}
          className="w-full h-8 px-2 rounded-lg bg-secondary border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all cursor-pointer">
          <option value="">— Asignar tipo —</option>
          {(["OP", "QW", "MATRICULAS"] as Role[]).map(r => (
            <option key={r} value={r} disabled={takenRoles.includes(r) && slot.role !== r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// ─── ManualEntry step ─────────────────────────────────────────────────────────

const EMPTY_FORM = { op: "", opMadre: "", linea: "1", matricula: "" };
const splitCol   = (t: string) => t.split(/\r?\n/).map(v => v.trim()).filter(v => v !== "");

function ManualEntryStep({
  rows, onAdd, onAddBulk, onDelete, onGenerate, onBack, generating,
}: {
  rows: ManualRow[];
  onAdd: (r: Omit<ManualRow, "id">) => void;
  onAddBulk: (rs: Omit<ManualRow, "id">[]) => void;
  onDelete: (id: string) => void;
  onGenerate: () => void;
  onBack: () => void;
  generating: boolean;
}) {
  const [mode, setMode]       = useState<"single" | "bulk">("single");
  const [form, setForm]       = useState(EMPTY_FORM);
  const [errors, setErrors]   = useState<Partial<typeof EMPTY_FORM>>({});
  const [bulk, setBulk]       = useState({ op: "", opMadre: "", linea: "", matricula: "" });
  const [bulkErr, setBulkErr] = useState("");

  // ── Single
  const validate = () => {
    const e: Partial<typeof EMPTY_FORM> = {};
    if (!form.op.trim() || isNaN(Number(form.op)))           e.op        = "Debe ser un número";
    if (!form.opMadre.trim() || isNaN(Number(form.opMadre))) e.opMadre   = "Debe ser un número";
    if (!form.linea.trim() || isNaN(Number(form.linea)))     e.linea     = "Debe ser un número";
    if (!form.matricula.trim())                               e.matricula = "No puede estar vacía";
    return e;
  };
  const handleAdd = () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    onAdd({ op: form.op.trim(), opMadre: form.opMadre.trim(), linea: form.linea.trim(), matricula: form.matricula.trim() });
    setForm(EMPTY_FORM);
  };

  // ── Bulk
  const handleBulkAdd = () => {
    setBulkErr("");
    const ops        = splitCol(bulk.op);
    const opMadres   = splitCol(bulk.opMadre);
    const lineas     = splitCol(bulk.linea);
    const matriculas = splitCol(bulk.matricula);

    if (ops.length === 0)        { setBulkErr("La columna OP está vacía.");        return; }
    if (opMadres.length === 0)   { setBulkErr("La columna OP MADRE está vacía.");  return; }
    if (matriculas.length === 0) { setBulkErr("La columna MATRÍCULA está vacía."); return; }

    const n = ops.length;
    if (opMadres.length !== n || matriculas.length !== n) {
      setBulkErr(`Las columnas tienen distinto número de filas — OP: ${n}, OP MADRE: ${opMadres.length}, MATRÍCULA: ${matriculas.length}. Deben coincidir.`);
      return;
    }

    const lineaFinal = lineas.length === n ? lineas : Array(n).fill("1");
    const errs: string[] = [];
    const newRows: Omit<ManualRow, "id">[] = [];

    for (let i = 0; i < n; i++) {
      const op = ops[i], opMadre = opMadres[i], linea = lineaFinal[i], matricula = matriculas[i];
      if (isNaN(Number(op)))      errs.push(`Fila ${i + 1}: OP "${op}" no es número`);
      if (isNaN(Number(opMadre))) errs.push(`Fila ${i + 1}: OP MADRE "${opMadre}" no es número`);
      if (isNaN(Number(linea)))   errs.push(`Fila ${i + 1}: LÍNEA "${linea}" no es número`);
      if (!matricula)             errs.push(`Fila ${i + 1}: MATRÍCULA vacía`);
      if (!errs.length) newRows.push({ op, opMadre, linea, matricula });
    }

    if (errs.length) { setBulkErr(errs.slice(0, 5).join(" · ") + (errs.length > 5 ? ` …y ${errs.length - 5} más` : "")); return; }

    onAddBulk(newRows);
    setBulk({ op: "", opMadre: "", linea: "", matricula: "" });
    setMode("single");
  };

  const colCount = (t: string) => { const n = splitCol(t).length; return n > 0 ? `${n} fila${n !== 1 ? "s" : ""}` : ""; };

  const field = (
    key: keyof typeof EMPTY_FORM,
    label: string,
    placeholder: string
  ) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <input
        type="text"
        value={form[key]}
        onChange={(e) => setForm(p => ({ ...p, [key]: e.target.value }))}
        onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        placeholder={placeholder}
        className={cn(
          "h-9 px-3 rounded-lg bg-secondary border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all",
          errors[key] ? "border-destructive focus:border-destructive" : "border-border focus:border-accent"
        )}
      />
      {errors[key] && <p className="text-[11px] text-destructive">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-3.5 h-3.5" />Volver
        </button>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Paso 2 — Ingreso de datos</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Cada fila será buscada en los archivos cargados</p>
        </div>
        {/* Mode toggle */}
        <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 ml-auto">
          {(["single", "bulk"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}>
              {m === "single" ? "Fila individual" : "Pegar columnas"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Single form ── */}
      {mode === "single" && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="grid grid-cols-4 gap-4 mb-4">
            {field("op",        "OP",        "ej. 4500012345")}
            {field("opMadre",   "OP MADRE",  "ej. 4500099999")}
            {field("linea",     "LÍNEA",     "ej. 1")}
            {field("matricula", "MATRÍCULA", "ej. 00702632.0")}
          </div>
          <div className="flex justify-end">
            <button onClick={handleAdd}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-all">
              <Plus className="w-4 h-4" />Agregar fila
            </button>
          </div>
        </div>
      )}

      {/* ── Bulk paste ── */}
      {mode === "bulk" && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <p className="text-xs text-muted-foreground">
            Copiá una columna de Excel y pegála en el campo correspondiente. LÍNEA es opcional (default 1).
          </p>
          <div className="grid grid-cols-4 gap-4">
            {([
              { key: "op",        label: "OP",        required: true  },
              { key: "opMadre",   label: "OP MADRE",  required: true  },
              { key: "linea",     label: "LÍNEA",     required: false },
              { key: "matricula", label: "MATRÍCULA", required: true  },
            ] as const).map(({ key, label, required }) => (
              <div key={key} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-foreground">
                    {label}{required && <span className="text-destructive ml-0.5">*</span>}
                  </label>
                  {bulk[key] && (
                    <span className="text-[11px] text-accent font-medium">{colCount(bulk[key])}</span>
                  )}
                </div>
                <textarea
                  value={bulk[key]}
                  onChange={(e) => { setBulk(p => ({ ...p, [key]: e.target.value })); setBulkErr(""); }}
                  placeholder={`Pegá la columna ${label} aquí…`}
                  rows={8}
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-xs text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all resize-none"
                />
              </div>
            ))}
          </div>

          {bulkErr && (
            <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {bulkErr}
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={handleBulkAdd}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-all">
              <Plus className="w-4 h-4" />
              Agregar {splitCol(bulk.op).length > 0 ? `${splitCol(bulk.op).length} filas` : "filas"}
            </button>
          </div>
        </div>
      )}

      {/* Rows table */}
      {rows.length > 0 ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Filas ingresadas ({rows.length})
            </span>
            <button onClick={() => { if (confirm("¿Eliminar todas las filas?")) rows.forEach(r => onDelete(r.id)); }}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors">
              Limpiar todo
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-secondary/50 border-b border-border">
                  {["OP", "OP MADRE", "LÍNEA", "MATRÍCULA", ""].map((h, i) => (
                    <th key={i} className="text-left py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider whitespace-nowrap bg-secondary/50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                    <td className="py-2 px-3 text-foreground font-mono">{row.op}</td>
                    <td className="py-2 px-3 text-foreground font-mono">{row.opMadre}</td>
                    <td className="py-2 px-3 text-foreground">{row.linea}</td>
                    <td className="py-2 px-3 text-foreground font-mono">{row.matricula}</td>
                    <td className="py-2 px-3 text-right">
                      <button onClick={() => onDelete(row.id)}
                        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all ml-auto">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-dashed border-border rounded-xl py-10 text-center text-muted-foreground">
          <p className="text-sm">Todavía no hay filas ingresadas</p>
          <p className="text-xs mt-1 opacity-60">Usá "Fila individual" o "Pegar columnas"</p>
        </div>
      )}

      {/* Generate button */}
      <div className="flex justify-end">
        <button onClick={onGenerate} disabled={rows.length === 0 || generating}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {generating
            ? <><Loader2 className="w-4 h-4 animate-spin" />Procesando...</>
            : <>Generar Seguimiento <Arrow className="w-4 h-4" /></>}
        </button>
      </div>
    </div>
  );
}

// ─── Result table ─────────────────────────────────────────────────────────────

function ResultTable({ rows, selected, onToggle, onToggleAll }: {
  rows: ResultRow[];
  selected: Set<number>;
  onToggle: (i: number) => void;
  onToggleAll: () => void;
}) {
  const [page, setPage] = useState(0);
  const total      = Math.ceil(rows.length / PAGE_SIZE);
  const paged      = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const allSel     = selected.size === rows.length && rows.length > 0;
  const someSel    = selected.size > 0 && !allSel;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-secondary/60 border-b border-border">
              <th className="py-2 px-3 w-8">
                <input
                  type="checkbox"
                  checked={allSel}
                  ref={(el) => { if (el) el.indeterminate = someSel; }}
                  onChange={onToggleAll}
                  className="w-3.5 h-3.5 cursor-pointer accent-[hsl(var(--accent))]"
                />
              </th>
              <th className="text-left py-2 px-3 text-muted-foreground font-semibold whitespace-nowrap">#</th>
              {COLUMNS.map(c => (
                <th key={c} className="text-left py-2 px-3 text-muted-foreground font-semibold whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row, i) => {
              const globalIdx = page * PAGE_SIZE + i;
              const isSelected = selected.has(globalIdx);
              const hasErr = row._errors.length > 0;
              return (
                <React.Fragment key={i}>
                  <tr
                    onClick={() => onToggle(globalIdx)}
                    className={cn(
                      "border-b border-border transition-colors cursor-pointer",
                      isSelected
                        ? hasErr ? "bg-destructive/10" : "bg-accent/8"
                        : hasErr ? "bg-destructive/8 hover:bg-destructive/12 opacity-60" : "hover:bg-secondary/20 opacity-60"
                    )}
                  >
                    <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggle(globalIdx)}
                        className="w-3.5 h-3.5 cursor-pointer accent-[hsl(var(--accent))]"
                      />
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">{globalIdx + 1}</td>
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
                            )}>{display || "—"}</span>
                          ) : (
                            <span className={hasErr ? "text-destructive/70" : "text-foreground"}>{display || "—"}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {hasErr && (
                    <tr className="bg-destructive/5 border-b border-destructive/20">
                      <td colSpan={COLUMNS.length + 2} className="px-4 py-1.5">
                        <div className="flex items-start gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
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
      {total > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <span className="text-xs text-muted-foreground">Página {page + 1} de {total} · {rows.length.toLocaleString("es-AR")} filas</span>
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

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ServiciosCargaSection() {
  const [slots, setSlots]         = useState<(FileSlot | null)[]>([null, null, null]);
  const [loadingSlot, setLoadingS] = useState<boolean[]>([false, false, false]);
  const [step, setStep]           = useState<Step>("upload");
  const [maps, setMaps]           = useState<LookupMaps | null>(null);
  const [manualRows, setManual]   = useState<ManualRow[]>([]);
  const [result, setResult]       = useState<ResultRow[]>([]);
  const [error, setError]         = useState("");
  const [generating, setGen]      = useState(false);
  const [exporting, setExp]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [selected, setSelected]   = useState<Set<number>>(new Set());
  const [saveModal, setSaveModal] = useState<{ fresh: ResultRow[]; dupes: ResultRow[] } | null>(null);

  const takenRoles = useMemo(
    () => slots.filter(Boolean).map(s => s!.role).filter(Boolean) as Role[],
    [slots]
  );
  const allReady = useMemo(() => {
    const r = new Set(takenRoles);
    return r.has("OP") && r.has("QW") && r.has("MATRICULAS");
  }, [takenRoles]);

  const updSlot = (idx: number, u: Partial<FileSlot> | null) =>
    setSlots(prev => { const n = [...prev]; n[idx] = u === null ? null : { ...n[idx]!, ...u }; return n; });

  const handleFile = useCallback((idx: number, file: File) => {
    updSlot(idx, { file, role: "" });
  }, []);

  // Parse files and advance to manual step
  const handleContinue = async () => {
    setGen(true);
    setError("");
    try {
      const get = (role: Role) => slots.find(s => s?.role === role)!;
      const [opRows, qwRows, matRows] = await Promise.all([
        parseFile(get("OP").file),
        parseFile(get("QW").file),
        parseFile(get("MATRICULAS").file),
      ]);
      if (opRows.length  === 0) throw new Error("El archivo OP no tiene datos (verificá que los headers estén en fila 2).");
      if (qwRows.length  === 0) throw new Error("El archivo QW no tiene datos.");
      if (matRows.length === 0) throw new Error("El archivo MATRICULAS no tiene datos.");
      setMaps(buildMaps(opRows, qwRows, matRows));
      setStep("manual");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
      setStep("error");
    } finally {
      setGen(false);
    }
  };

  const handleGenerate = async () => {
    if (!maps || manualRows.length === 0) return;
    setGen(true);
    await new Promise(r => setTimeout(r, 50)); // let UI update
    const data = buildSeguimiento(manualRows, maps);
    setResult(data);
    setSelected(new Set(data.map((_, i) => i)));
    setStep("result");
    setGen(false);
  };

  const handleExport = async () => {
    setExp(true);
    try {
      const XLSX = await import("xlsx");
      const exportData = result.map(({ _errors: _e, ...row }) => row);
      const ws = XLSX.utils.json_to_sheet(exportData, { header: COLUMNS as string[] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Seguimiento");
      const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      XLSX.writeFile(wb, `Seguimiento_de_Servicios_${d}.xlsx`);
    } finally {
      setExp(false);
    }
  };

  const rowKey = (r: Record<string, unknown> | ResultRow) => {
    const x = r as Record<string, unknown>;
    return `${norm(x["OP"])}||${norm(x["LÍNEA"])}||${norm(x["MATRICULA"])}`;
  };

  const handleSaveToDb = () => {
    const selectedRows = result.filter((_, i) => selected.has(i));
    const existing     = dbGet();
    const existingKeys = new Set(existing.map(rowKey));
    const fresh = selectedRows.filter(r => !existingKeys.has(rowKey(r)));
    const dupes = selectedRows.filter(r =>  existingKeys.has(rowKey(r)));
    if (dupes.length === 0) {
      dbAppend(fresh.map(({ _errors: _e, ...row }) => row));
      setSaved(true);
    } else {
      setSaveModal({ fresh, dupes });
    }
  };

  const handleSaveConfirm = (strategy: "overwrite" | "skip") => {
    if (!saveModal) return;
    const { fresh, dupes } = saveModal;
    if (strategy === "overwrite") {
      const allRows = [...fresh, ...dupes].map(({ _errors: _e, ...row }) => row);
      dbOverwriteByKey(allRows, rowKey);
    } else {
      dbAppend(fresh.map(({ _errors: _e, ...row }) => row));
    }
    setSaveModal(null);
    setSaved(true);
  };

  const handleToggle = (i: number) =>
    setSelected(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const handleToggleAll = () =>
    setSelected(prev => prev.size === result.length ? new Set() : new Set(result.map((_, i) => i)));

  const reset = () => {
    setSlots([null, null, null]);
    setStep("upload");
    setMaps(null);
    setManual([]);
    setResult([]);
    setError("");
    setSaved(false);
    setSelected(new Set());
  };

  const errorCount = result.filter(r => r._errors.length > 0).length;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ══ STEP: upload ══ */}
      {(step === "upload") && (
        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Paso 1 — Cargá los 3 archivos y asigná el tipo</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Headers deben estar en la fila 2 de cada archivo</p>
          </div>
          <div className="flex gap-4">
            {slots.map((slot, idx) => (
              <FileSlotCard key={idx} idx={idx} slot={slot}
                takenRoles={takenRoles.filter(r => slots[idx]?.role !== r)}
                loading={loadingSlot[idx]}
                onFile={(f) => handleFile(idx, f)}
                onRole={(r) => updSlot(idx, { role: r })}
                onClear={() => updSlot(idx, null)} />
            ))}
          </div>
          {!allReady && slots.some(Boolean) && (
            <div className="flex items-center gap-2 text-xs bg-warning/10 border border-warning/20 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
              <span className="text-muted-foreground">
                Falta asignar:{" "}
                {(["OP","QW","MATRICULAS"] as Role[]).filter(r => !takenRoles.includes(r))
                  .map(r => <strong key={r} className="text-foreground mx-0.5">{r}</strong>)}
              </span>
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={handleContinue} disabled={!allReady || generating}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {generating ? <><Loader2 className="w-4 h-4 animate-spin" />Leyendo archivos...</> : <>Continuar <Arrow className="w-4 h-4" /></>}
            </button>
          </div>
        </div>
      )}

      {/* ══ STEP: manual ══ */}
      {step === "manual" && (
        <ManualEntryStep
          rows={manualRows}
          onAdd={(r)    => setManual(prev => [...prev, { ...r, id: uid() }])}
          onAddBulk={(rs) => setManual(prev => [...prev, ...rs.map(r => ({ ...r, id: uid() }))])}
          onDelete={(id) => setManual(prev => prev.filter(r => r.id !== id))}
          onGenerate={handleGenerate}
          onBack={() => setStep("upload")}
          generating={generating}
        />
      )}

      {/* ══ STEP: error ══ */}
      {step === "error" && (
        <div className="bg-card border border-destructive/30 rounded-xl p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/15 flex items-center justify-center mx-auto mb-3">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
          <h3 className="text-base font-semibold text-foreground mb-2">Error al procesar</h3>
          <p className="text-sm text-destructive/80 bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 max-w-lg mx-auto mb-5">{error}</p>
          <button onClick={reset} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-all">
            Intentar de nuevo
          </button>
        </div>
      )}

      {/* ══ MODAL: duplicate confirmation ══ */}
      {saveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-warning/15 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-warning" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">Filas duplicadas encontradas</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Se comparan por <span className="text-foreground font-medium">OP + LÍNEA + MATRÍCULA</span>
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 bg-destructive/8 border border-destructive/20 rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-destructive">{saveModal.dupes.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">ya existen</p>
              </div>
              <div className="flex-1 bg-success/8 border border-success/20 rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-success">{saveModal.fresh.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">nuevas</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">¿Qué querés hacer con las <strong className="text-foreground">{saveModal.dupes.length}</strong> filas duplicadas?</p>

            <div className="space-y-2">
              <button onClick={() => handleSaveConfirm("overwrite")}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary hover:bg-secondary/80 border border-border text-sm font-medium text-foreground transition-all text-left">
                <div className="w-7 h-7 rounded-lg bg-warning/15 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                </div>
                <div>
                  <p className="font-semibold">Sobreescribir</p>
                  <p className="text-xs text-muted-foreground font-normal">Reemplaza las {saveModal.dupes.length} existentes y agrega las {saveModal.fresh.length} nuevas</p>
                </div>
              </button>
              <button onClick={() => handleSaveConfirm("skip")}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary hover:bg-secondary/80 border border-border text-sm font-medium text-foreground transition-all text-left">
                <div className="w-7 h-7 rounded-lg bg-success/15 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                </div>
                <div>
                  <p className="font-semibold">Omitir repetidas</p>
                  <p className="text-xs text-muted-foreground font-normal">
                    {saveModal.fresh.length > 0
                      ? `Solo agrega las ${saveModal.fresh.length} filas nuevas`
                      : "No se guardará ninguna fila (todas ya existen)"}
                  </p>
                </div>
              </button>
            </div>

            <button onClick={() => setSaveModal(null)}
              className="w-full px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ══ STEP: result ══ */}
      {step === "result" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Seguimiento generado</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {result.length} filas · {COLUMNS.length} columnas
                {errorCount > 0 && (
                  <span className="text-destructive ml-2">· {errorCount} fila{errorCount > 1 ? "s" : ""} con errores de búsqueda</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {saved ? (
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-success/15 text-success text-sm font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  Guardado en Base de datos
                </div>
              ) : (
                <button onClick={handleSaveToDb} disabled={selected.size === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-all border border-border disabled:opacity-40 disabled:cursor-not-allowed">
                  <Database className="w-4 h-4" />
                  {selected.size > 0
                    ? `Guardar ${selected.size} fila${selected.size !== 1 ? "s" : ""}`
                    : "Guardar seleccionadas"}
                </button>
              )}
              <button onClick={handleExport} disabled={exporting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground text-sm font-medium transition-all disabled:opacity-50">
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Descargar .xlsx
              </button>
              <button onClick={() => setStep("manual")}
                className="px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">
                Editar filas
              </button>
              <button onClick={reset}
                className="px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">
                Nueva carga
              </button>
            </div>
          </div>
          <ResultTable rows={result} selected={selected} onToggle={handleToggle} onToggleAll={handleToggleAll} />
        </div>
      )}
    </div>
  );
}
