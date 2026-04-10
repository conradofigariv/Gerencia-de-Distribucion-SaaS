"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Search, Trash2, Database, RefreshCw, AlertCircle } from "lucide-react";
import { dbGet, dbDeleteRow, dbClear, type DbRow } from "@/lib/db";

const COLUMNS = [
  "ZONA", "OP", "OP MADRE", "SC", "DESCRIPCIÓN DE SC", "LÍNEA",
  "MATRICULA", "DESCRIPCIÓN DE MATRICULA", "CANTIDAD", "CANTIDAD RECIBIDA",
  "SALDO DE LINEA", "FECHA DE CREACION", "FECHA PACTADA", "PROVEEDOR",
  "FECHA REDETERMINACIÓN", "PRECIO REDETERMINACIÓN", "ESTADO",
  "ESTADO DE PLAZO", "ESTADO DE CANTIDADES", "REVISION", "OBSERVACION",
  "DISPONIBILIDAD EN MESES", "FECHA ACTUAL", "CANTIDAD2",
  "CANTIDAD DE MESES", "CANTIDAD CONSUMIDA POR MES",
];

const PAGE_SIZE = 50;

export function ServiciosTablaSection() {
  const [rows, setRows]     = useState<DbRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage]     = useState(0);

  const load = useCallback(() => { setRows(dbGet()); setPage(0); }, []);

  useEffect(() => { load(); }, [load]);

  if (rows === null) return null;

  const filtered = rows.filter(r =>
    search === "" ||
    COLUMNS.some(c => String(r[c] ?? "").toLowerCase().includes(search.toLowerCase()))
  );

  const total = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleDelete = (globalIdx: number) => {
    dbDeleteRow(globalIdx);
    load();
  };

  const handleClear = () => {
    if (confirm("¿Eliminar todas las filas de la base de datos?")) {
      dbClear();
      load();
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Datos guardados en este dispositivo via localStorage
      </p>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar en todos los campos..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="w-72 h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
            />
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-muted-foreground hover:text-foreground transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Actualizar
          </button>
        </div>
        {rows.length > 0 && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm text-destructive hover:bg-destructive/10 border border-destructive/30 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Limpiar todo
          </button>
        )}
      </div>

      {/* Empty state */}
      {rows.length === 0 ? (
        <div className="bg-card border border-dashed border-border rounded-xl py-16 text-center">
          <Database className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Base de datos vacía</p>
          <p className="text-xs text-muted-foreground mt-1">
            Generá un seguimiento y presioná "Guardar en Base de datos"
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="text-left py-2.5 px-3 text-muted-foreground font-semibold whitespace-nowrap">#</th>
                  {COLUMNS.map(c => (
                    <th key={c} className="text-left py-2.5 px-3 text-muted-foreground font-semibold whitespace-nowrap uppercase tracking-wider">{c}</th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {paged.map((row, pageIdx) => {
                  const globalIdx = rows.indexOf(row);
                  return (
                    <tr
                      key={pageIdx}
                      className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors duration-150"
                    >
                      <td className="py-2.5 px-3 text-muted-foreground">{page * PAGE_SIZE + pageIdx + 1}</td>
                      {COLUMNS.map(c => {
                        const val = row[c];
                        const display = typeof val === "number" ? val.toLocaleString("es-AR") : String(val ?? "");
                        const isStatus = c === "ESTADO DE PLAZO" || c === "REVISION" || c === "ESTADO DE CANTIDADES";
                        return (
                          <td key={c} className="py-2.5 px-3 whitespace-nowrap max-w-[180px] truncate" title={display}>
                            {isStatus ? (
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[11px] font-medium",
                                val === "VENCIDA" || val === "CERRAR" ? "bg-destructive/15 text-destructive" :
                                val === "SIN SALDO"                   ? "bg-warning/15 text-warning"         :
                                val === "OK" || val === "VIGENTE"     ? "bg-success/15 text-success"         :
                                "bg-secondary text-muted-foreground"
                              )}>{display || "—"}</span>
                            ) : (
                              <span className="text-foreground">{display || "—"}</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-2.5 px-3">
                        <button
                          onClick={() => handleDelete(globalIdx)}
                          className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/30">
            <span className="text-sm text-muted-foreground">
              {filtered.length !== rows.length
                ? `${filtered.length} resultado${filtered.length !== 1 ? "s" : ""} de ${rows.length} filas`
                : `${rows.length} fila${rows.length !== 1 ? "s" : ""} en la base de datos`}
            </span>
            {total > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => p - 1)} disabled={page === 0}
                  className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Anterior
                </button>
                <span className="px-3 py-1.5 rounded-lg text-sm bg-accent text-accent-foreground font-medium">
                  {page + 1} / {total}
                </span>
                <button
                  onClick={() => setPage(p => p + 1)} disabled={page >= total - 1}
                  className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Siguiente
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {filtered.length === 0 && rows.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/30 border border-border rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          No se encontraron filas para "{search}"
        </div>
      )}
    </div>
  );
}
