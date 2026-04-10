"use client";

import React, { useState, useRef, useCallback } from "react";
import { UploadCloud, FileSpreadsheet, X, Loader2, Table2, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 100;

interface SheetData {
  fileName: string;
  headers:  string[];
  rows:     Record<string, unknown>[];
  page:     number;
}

// ─── Dropzone ─────────────────────────────────────────────────────────────────

interface DropZoneProps {
  label:    string;
  data:     SheetData | null;
  loading:  boolean;
  onFile:   (f: File) => void;
  onClear:  () => void;
}

function DropZone({ label, data, loading, onFile, onClear }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile]);

  return (
    <div className="flex-1">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
      <div
        onClick={() => !loading && !data && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-6 text-center transition-all duration-200 ${
          data
            ? "border-accent/40 bg-accent/8 cursor-default"
            : dragOver
            ? "border-accent bg-accent/8 cursor-pointer"
            : "border-border hover:border-muted-foreground/40 hover:bg-secondary/20 cursor-pointer"
        }`}
      >
        {loading ? (
          <Loader2 className="w-6 h-6 text-accent animate-spin mx-auto" />
        ) : data ? (
          <div className="flex items-center justify-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-accent shrink-0" />
            <span className="text-sm font-medium text-foreground truncate">{data.fileName}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-all shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <UploadCloud className="w-6 h-6 text-muted-foreground mx-auto mb-1.5" />
            <p className="text-sm text-muted-foreground">
              Arrastrá o <span className="text-foreground font-medium">seleccioná</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">.xlsx / .xls</p>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
      />
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

function DataTable({ data, onPageChange }: { data: SheetData; onPageChange: (p: number) => void }) {
  const totalPages = Math.ceil(data.rows.length / PAGE_SIZE);
  const paged = data.rows.slice(data.page * PAGE_SIZE, (data.page + 1) * PAGE_SIZE);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border text-sm">
        <Table2 className="w-4 h-4 text-accent" />
        <span className="font-medium text-foreground">{data.fileName}</span>
        <span className="text-muted-foreground">· {data.rows.length.toLocaleString("es-AR")} filas · {data.headers.length} columnas</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-secondary/50 border-b border-border">
              {data.headers.map((h) => (
                <th key={h} className="text-left py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                {data.headers.map((h) => (
                  <td key={h} className="py-2 px-3 text-foreground whitespace-nowrap max-w-[200px] truncate" title={String(row[h] ?? "")}>
                    {String(row[h] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <span className="text-xs text-muted-foreground">Página {data.page + 1} de {totalPages}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => onPageChange(data.page - 1)} disabled={data.page === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all">
              <ChevronLeft className="w-3.5 h-3.5" />Anterior
            </button>
            <button onClick={() => onPageChange(data.page + 1)} disabled={data.page >= totalPages - 1}
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
  const [sheets, setSheets]   = useState<[SheetData | null, SheetData | null]>([null, null]);
  const [loading, setLoading] = useState<[boolean, boolean]>([false, false]);

  const parseFile = useCallback(async (file: File, idx: 0 | 1) => {
    setLoading((prev) => { const n = [...prev] as [boolean, boolean]; n[idx] = true; return n; });
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (rows.length > 0) {
        const sheet: SheetData = { fileName: file.name, headers: Object.keys(rows[0]), rows, page: 0 };
        setSheets((prev) => { const n = [...prev] as [SheetData | null, SheetData | null]; n[idx] = sheet; return n; });
      }
    } finally {
      setLoading((prev) => { const n = [...prev] as [boolean, boolean]; n[idx] = false; return n; });
    }
  }, []);

  const clearSheet = (idx: 0 | 1) =>
    setSheets((prev) => { const n = [...prev] as [SheetData | null, SheetData | null]; n[idx] = null; return n; });

  const setPage = (idx: 0 | 1, p: number) =>
    setSheets((prev) => {
      const n = [...prev] as [SheetData | null, SheetData | null];
      if (n[idx]) n[idx] = { ...n[idx]!, page: p };
      return n;
    });

  return (
    <div className="space-y-6">
      {/* Dropzones */}
      <div className="flex gap-4">
        <DropZone label="Archivo 1" data={sheets[0]} loading={loading[0]}
          onFile={(f) => parseFile(f, 0)} onClear={() => clearSheet(0)} />
        <DropZone label="Archivo 2" data={sheets[1]} loading={loading[1]}
          onFile={(f) => parseFile(f, 1)} onClear={() => clearSheet(1)} />
      </div>

      {/* Tables */}
      {sheets[0] && <DataTable data={sheets[0]} onPageChange={(p) => setPage(0, p)} />}
      {sheets[1] && <DataTable data={sheets[1]} onPageChange={(p) => setPage(1, p)} />}
    </div>
  );
}
