"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Search, Trash2, Database, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";

// ─── Column config ────────────────────────────────────────────────────────────

const DISPLAY_COLS: { db: string; label: string }[] = [
  { db: "op",                        label: "OP" },
  { db: "op_madre",                  label: "OP MADRE" },
  { db: "sc",                        label: "SC" },
  { db: "descripcion_sc",            label: "DESCRIPCIÓN DE SC" },
  { db: "linea",                     label: "LÍNEA" },
  { db: "matricula",                 label: "MATRICULA" },
  { db: "descripcion_matricula",     label: "DESCRIPCIÓN DE MATRICULA" },
  { db: "cantidad",                  label: "CANTIDAD" },
  { db: "cantidad_recibida",         label: "CANTIDAD RECIBIDA" },
  { db: "saldo_de_linea",            label: "SALDO DE LINEA" },
  { db: "fecha_de_creacion",         label: "FECHA DE CREACION" },
  { db: "fecha_pactada",             label: "FECHA PACTADA" },
  { db: "proveedor",                 label: "PROVEEDOR" },
  { db: "fecha_redeterminacion",     label: "FECHA REDETERMINACIÓN" },
  { db: "precio_redeterminacion",    label: "PRECIO REDETERMINACIÓN" },
  { db: "estado",                    label: "ESTADO" },
  { db: "estado_de_plazo",           label: "ESTADO DE PLAZO" },
  { db: "estado_de_cantidades",      label: "ESTADO DE CANTIDADES" },
  { db: "revision",                  label: "REVISION" },
  { db: "observacion",               label: "OBSERVACION" },
  { db: "disponibilidad_en_meses",   label: "DISPONIBILIDAD EN MESES" },
  { db: "fecha_actual",              label: "FECHA ACTUAL" },
  { db: "cantidad2",                 label: "CANTIDAD2" },
  { db: "cantidad_de_meses",         label: "CANTIDAD DE MESES" },
  { db: "cantidad_consumida_por_mes", label: "CANTIDAD CONSUMIDA POR MES" },
];

const STATUS_COLS = new Set(["estado_de_plazo", "estado_de_cantidades", "revision"]);

const PAGE_SIZE = 50;

type DbRow = Record<string, unknown> & { id: string };

// ─── Component ────────────────────────────────────────────────────────────────

export function ServiciosTablaSection() {
  const [rows, setRows]       = useState<DbRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [page, setPage]       = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("seguimiento")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) {
      toast.error(`Error al cargar seguimiento: ${error.message}`);
      // leave rows as [] so empty state renders
    } else {
      setRows((data ?? []) as DbRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 text-accent animate-spin" />
      </div>
    );
  }

  const filtered = rows.filter(r =>
    search === "" ||
    DISPLAY_COLS.some(c => String(r[c.db] ?? "").toLowerCase().includes(search.toLowerCase()))
  );

  const total = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleDelete = async (id: string) => {
    setRows(prev => prev?.filter(r => r.id !== id) ?? null);
    const { error } = await supabase.from("seguimiento").delete().eq("id", id);
    if (error) {
      toast.error(`Error al eliminar: ${error.message}`);
      load(); // re-sync
    }
  };

  const handleClear = async () => {
    if (!confirm("¿Eliminar TODOS los registros de seguimiento?")) return;
    const { error } = await supabase.from("seguimiento").delete().not("id", "is", null);
    if (error) { toast.error(`Error al limpiar: ${error.message}`); return; }
    setRows([]);
    toast.success("Base de datos limpiada");
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Datos persistidos en Supabase · tabla <code className="text-xs bg-secondary px-1.5 py-0.5 rounded">seguimiento</code>
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
                  {DISPLAY_COLS.map(c => (
                    <th key={c.db} className="text-left py-2.5 px-3 text-muted-foreground font-semibold whitespace-nowrap uppercase tracking-wider">{c.label}</th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {paged.map((row, pageIdx) => (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors duration-150"
                  >
                    <td className="py-2.5 px-3 text-muted-foreground">{page * PAGE_SIZE + pageIdx + 1}</td>
                    {DISPLAY_COLS.map(c => {
                      const val     = row[c.db];
                      const display = typeof val === "number" ? val.toLocaleString("es-AR") : String(val ?? "");
                      const isStat  = STATUS_COLS.has(c.db);
                      return (
                        <td key={c.db} className="py-2.5 px-3 whitespace-nowrap max-w-[180px] truncate" title={display}>
                          {isStat ? (
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
                        onClick={() => handleDelete(row.id)}
                        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/30">
            <span className="text-sm text-muted-foreground">
              {filtered.length !== rows.length
                ? `${filtered.length} resultado${filtered.length !== 1 ? "s" : ""} de ${rows.length} registros`
                : `${rows.length} registro${rows.length !== 1 ? "s" : ""} en Supabase`}
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
    </div>
  );
}
