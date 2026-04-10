"use client";

import React, { useState, useRef, useCallback } from "react";
import { UploadCloud, FileSpreadsheet, X, Loader2, Table2, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 100;

export function ServiciosCargaSection() {
  const [rows, setRows]         = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders]   = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading]   = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [page, setPage]         = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setLoading(true);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (data.length > 0) {
        setHeaders(Object.keys(data[0]));
        setRows(data);
        setFileName(file.name);
        setPage(0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const clear = () => { setRows([]); setHeaders([]); setFileName(""); setPage(0); };

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const paged = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        onClick={() => !loading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200 ${
          dragOver ? "border-accent bg-accent/8" : "border-border hover:border-muted-foreground/40 hover:bg-secondary/20"
        }`}
      >
        {loading ? (
          <Loader2 className="w-8 h-8 text-accent animate-spin mx-auto mb-2" />
        ) : fileName ? (
          <div className="flex items-center justify-center gap-3">
            <FileSpreadsheet className="w-6 h-6 text-accent" />
            <span className="text-sm font-medium text-foreground">{fileName}</span>
            <button
              onClick={(e) => { e.stopPropagation(); clear(); }}
              className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <UploadCloud className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Arrastrá o <span className="text-foreground font-medium">seleccioná</span> un archivo Excel
            </p>
            <p className="text-xs text-muted-foreground mt-1">.xlsx / .xls</p>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ""; }}
      />

      {/* Table */}
      {rows.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2 text-sm">
              <Table2 className="w-4 h-4 text-accent" />
              <span className="font-medium text-foreground">{rows.length.toLocaleString("es-AR")} filas</span>
              <span className="text-muted-foreground">· {headers.length} columnas</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-secondary/50 border-b border-border">
                  {headers.map((h) => (
                    <th key={h} className="text-left py-2.5 px-3 text-muted-foreground font-semibold uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                    {headers.map((h) => (
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
              <span className="text-xs text-muted-foreground">
                Página {page + 1} de {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => p - 1)} disabled={page === 0}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                  <ChevronLeft className="w-3.5 h-3.5" />Anterior
                </button>
                <button onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                  Siguiente<ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
