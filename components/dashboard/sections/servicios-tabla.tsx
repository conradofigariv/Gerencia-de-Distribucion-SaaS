"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Search, Trash2, Database, RefreshCw, Loader2, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";

// ─── Column config ────────────────────────────────────────────────────────────

const DISPLAY_COLS: { db: string; label: string }[] = [
  { db: "zona",                  label: "ZONA"                    },
  { db: "op",                    label: "OP"                      },
  { db: "op_madre",              label: "OP MADRE"                },
  { db: "sc",                    label: "SC"                      },
  { db: "descripcion_sc",        label: "DESCRIPCIÓN DE SC"       },
  { db: "linea",                 label: "LÍNEA"                   },
  { db: "matricula",             label: "MATRICULA"               },
  { db: "descripcion_matricula", label: "DESCRIPCIÓN DE MATRICULA"},
  { db: "cantidad",              label: "CANTIDAD"                },
  { db: "cantidad_recibida",     label: "CANTIDAD RECIBIDA"       },
  { db: "saldo_linea",           label: "SALDO DE LINEA"          },
  { db: "fecha_pactada",         label: "FECHA PACTADA"           },
  { db: "proveedor",             label: "PROVEEDOR"               },
  { db: "fecha_redeterminacion", label: "FECHA REDETERMINACIÓN"   },
  { db: "precio_redeterminacion",label: "PRECIO REDETERMINACIÓN"  },
  { db: "estado",                label: "ESTADO"                  },
  { db: "estado_plazo",          label: "ESTADO DE PLAZO"         },
  { db: "estado_cantidades",     label: "ESTADO DE CANTIDADES"    },
  { db: "revision",              label: "REVISION"                },
  { db: "observacion",           label: "OBSERVACION"             },
  { db: "disponibilidad_meses",  label: "DISPONIBILIDAD EN MESES" },
];

const STATUS_COLS = new Set(["estado_plazo", "estado_cantidades", "revision"]);
const RAW_COLS    = new Set(["op", "op_madre", "linea"]);
const NUM_COLS    = new Set(["op", "op_madre", "linea", "cantidad", "cantidad_recibida", "saldo_linea", "precio_redeterminacion", "disponibilidad_meses"]);
const DATE_COLS   = new Set(["fecha_pactada", "fecha_redeterminacion"]);

const DEFAULT_WIDTHS: Record<string, number> = {
  zona:                  80,
  op:                    90,
  op_madre:              90,
  sc:                    100,
  descripcion_sc:        200,
  linea:                 60,
  matricula:             110,
  descripcion_matricula: 200,
  cantidad:              90,
  cantidad_recibida:     110,
  saldo_linea:           100,
  fecha_pactada:         110,
  proveedor:             160,
  fecha_redeterminacion: 130,
  precio_redeterminacion:130,
  estado:                90,
  estado_plazo:          100,
  estado_cantidades:     120,
  revision:              90,
  observacion:           160,
  disponibilidad_meses:  130,
};

const PAGE_SIZE = 50;

type DbRow = Record<string, unknown> & { id: string };

// ─── Component ────────────────────────────────────────────────────────────────

export function ServiciosTablaSection() {
  const [rows, setRows]         = useState<DbRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [page, setPage]         = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // ── Edit state
  const [editingCell, setEditingCell] = useState<{ rowId: string; col: string } | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Column resize
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  const [isResizing, setIsResizing] = useState(false);
  const resizing = useRef<{ col: string; startX: number; startW: number } | null>(null);

  const startResize = (e: React.MouseEvent, col: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startW = colWidths[col] ?? DEFAULT_WIDTHS[col] ?? 100;
    resizing.current = { col, startX: e.clientX, startW };
    setIsResizing(true);

    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const newW = Math.max(50, resizing.current.startW + (ev.clientX - resizing.current.startX));
      setColWidths(prev => ({ ...prev, [resizing.current!.col]: newW }));
    };
    const onUp = () => {
      resizing.current = null;
      setIsResizing(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("seguimiento")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) {
        toast.error(`Error al cargar seguimiento: ${error.message}`);
      } else {
        setRows((data ?? []) as DbRow[]);
        setSelected(new Set());
      }
    } catch (err) {
      toast.error(`Error al cargar seguimiento: ${err instanceof Error ? err.message : "Error desconocido"}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Start editing a cell
  const startEdit = (rowId: string, col: string, val: unknown) => {
    let str = "";
    if (val !== null && val !== undefined) {
      str = DATE_COLS.has(col) ? String(val).split("T")[0] : String(val);
    }
    setEditingCell({ rowId, col });
    setEditingValue(str);
  };

  // ── Save edit to DB
  const saveEdit = useCallback(async () => {
    if (!editingCell) return;
    const { rowId, col } = editingCell;
    setEditingCell(null);

    let newVal: unknown = editingValue.trim() === "" ? null : editingValue.trim();
    if (newVal !== null && NUM_COLS.has(col)) newVal = Number(newVal);

    // Optimistic update
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, [col]: newVal } : r));

    const { error } = await supabase.from("seguimiento").update({ [col]: newVal }).eq("id", rowId);
    if (error) {
      toast.error(`Error al guardar: ${error.message}`);
      load();
    }
  }, [editingCell, editingValue, load]);

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

  // ── Selection helpers
  const pagedIds    = paged.map(r => r.id);
  const allPageSel  = pagedIds.length > 0 && pagedIds.every(id => selected.has(id));
  const somePageSel = pagedIds.some(id => selected.has(id));

  const toggleRow = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (allPageSel) setSelected(prev => { const n = new Set(prev); pagedIds.forEach(id => n.delete(id)); return n; });
    else            setSelected(prev => { const n = new Set(prev); pagedIds.forEach(id => n.add(id));    return n; });
  };

  // ── Delete single row
  const handleDelete = async (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id));
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    const { error } = await supabase.from("seguimiento").delete().eq("id", id);
    if (error) { toast.error(`Error al eliminar: ${error.message}`); load(); }
  };

  // ── Delete selected rows
  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`¿Eliminar ${selected.size} registro${selected.size !== 1 ? "s" : ""} seleccionado${selected.size !== 1 ? "s" : ""}?`)) return;
    setDeleting(true);
    const ids = Array.from(selected);
    const { error } = await supabase.from("seguimiento").delete().in("id", ids);
    if (error) { toast.error(`Error al eliminar: ${error.message}`); load(); }
    else {
      setRows(prev => prev.filter(r => !selected.has(r.id)));
      setSelected(new Set());
      toast.success(`${ids.length} registro${ids.length !== 1 ? "s" : ""} eliminado${ids.length !== 1 ? "s" : ""}`);
    }
    setDeleting(false);
  };

  // ── Delete all rows
  const handleClear = async () => {
    if (!confirm("¿Eliminar TODOS los registros de seguimiento?")) return;
    const { error } = await supabase.from("seguimiento").delete().not("id", "is", null);
    if (error) { toast.error(`Error al limpiar: ${error.message}`); return; }
    setRows([]);
    setSelected(new Set());
    toast.success("Base de datos limpiada");
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Datos persistidos en Supabase · tabla <code className="text-xs bg-secondary px-1.5 py-0.5 rounded">seguimiento</code>
      </p>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar en todos los campos..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); setSelected(new Set()); }}
            className="w-72 h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
          />
        </div>
        <button onClick={load} className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-muted-foreground hover:text-foreground transition-all">
          <RefreshCw className="w-3.5 h-3.5" />Actualizar
        </button>
        {selected.size > 0 && (
          <button onClick={handleDeleteSelected} disabled={deleting}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm text-destructive hover:bg-destructive/10 border border-destructive/30 transition-all disabled:opacity-50">
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Borrar selección ({selected.size})
          </button>
        )}
        {rows.length > 0 && (
          <button onClick={handleClear}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm text-destructive hover:bg-destructive/10 border border-destructive/30 transition-all">
            <Trash2 className="w-3.5 h-3.5" />Limpiar todo
          </button>
        )}
      </div>

      {/* Empty state */}
      {rows.length === 0 ? (
        <div className="bg-card border border-dashed border-border rounded-xl py-16 text-center">
          <Database className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Base de datos vacía</p>
          <p className="text-xs text-muted-foreground mt-1">Generá un seguimiento y presioná "Guardar en Base de datos"</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className={cn("overflow-x-auto", isResizing && "select-none cursor-col-resize")}>
            <table className="text-xs table-fixed" style={{ minWidth: "100%" }}>
              <colgroup>
                <col style={{ width: 32 }} />
                <col style={{ width: 40 }} />
                {DISPLAY_COLS.map(c => <col key={c.db} style={{ width: colWidths[c.db] ?? DEFAULT_WIDTHS[c.db] ?? 100 }} />)}
                <col style={{ width: 40 }} />
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="py-2.5 px-3">
                    <input type="checkbox" checked={allPageSel}
                      ref={el => { if (el) el.indeterminate = somePageSel && !allPageSel; }}
                      onChange={toggleAll}
                      className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
                      title="Seleccionar todos en esta página"
                    />
                  </th>
                  <th className="text-left py-2.5 px-3 text-muted-foreground font-semibold">#</th>
                  {DISPLAY_COLS.map(c => (
                    <th key={c.db} className="relative text-left py-2.5 pl-3 pr-4 text-muted-foreground font-semibold whitespace-nowrap uppercase tracking-wider overflow-hidden">
                      <span className="block truncate">{c.label}</span>
                      {/* Resize handle */}
                      <div
                        onMouseDown={e => startResize(e, c.db)}
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize group/handle flex items-center justify-center"
                      >
                        <div className="w-px h-4 bg-border group-hover/handle:bg-accent transition-colors" />
                      </div>
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {paged.map((row, pageIdx) => {
                  const isSelected = selected.has(row.id);
                  return (
                    <tr key={row.id} className={cn(
                      "border-b border-border last:border-0 transition-colors duration-150",
                      isSelected ? "bg-accent/8 hover:bg-accent/12" : "hover:bg-secondary/30"
                    )}>
                      <td className="py-2.5 px-3">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleRow(row.id)}
                          className="w-3.5 h-3.5 rounded accent-accent cursor-pointer" />
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground">{page * PAGE_SIZE + pageIdx + 1}</td>

                      {DISPLAY_COLS.map(c => {
                        const val      = row[c.db];
                        const display  = typeof val === "number" && !RAW_COLS.has(c.db) ? val.toLocaleString("es-AR") : String(val ?? "");
                        const isStat   = STATUS_COLS.has(c.db);
                        const isEditing = editingCell?.rowId === row.id && editingCell.col === c.db;

                        return (
                          <td
                            key={c.db}
                            className="py-1.5 px-3 whitespace-nowrap max-w-[180px] group"
                            title={isEditing ? undefined : display}
                          >
                            {isEditing ? (
                              <input
                                ref={inputRef}
                                autoFocus
                                type={DATE_COLS.has(c.db) ? "date" : NUM_COLS.has(c.db) ? "number" : "text"}
                                value={editingValue}
                                onChange={e => setEditingValue(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === "Enter")  { e.preventDefault(); saveEdit(); }
                                  if (e.key === "Escape") { setEditingCell(null); }
                                }}
                                onBlur={saveEdit}
                                className="w-full min-w-[80px] bg-secondary border border-accent rounded px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                              />
                            ) : (
                              <div
                                className="flex items-center gap-1.5 cursor-pointer"
                                onClick={() => startEdit(row.id, c.db, val)}
                              >
                                {isStat ? (
                                  <span className={cn(
                                    "px-1.5 py-0.5 rounded text-[11px] font-medium",
                                    val === "VENCIDA" || val === "CERRAR" ? "bg-destructive/15 text-destructive" :
                                    val === "SIN SALDO"                   ? "bg-warning/15 text-warning"         :
                                    val === "OK" || val === "VIGENTE"     ? "bg-success/15 text-success"         :
                                    "bg-secondary text-muted-foreground"
                                  )}>{display || "—"}</span>
                                ) : (
                                  <span className="text-foreground truncate max-w-[140px] block">{display || "—"}</span>
                                )}
                                <Pencil className="w-3 h-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity duration-150" />
                              </div>
                            )}
                          </td>
                        );
                      })}

                      <td className="py-2.5 px-3">
                        <button onClick={() => handleDelete(row.id)}
                          className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
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
              {selected.size > 0 ? `${selected.size} seleccionado${selected.size !== 1 ? "s" : ""} · ` : ""}
              {filtered.length !== rows.length
                ? `${filtered.length} resultado${filtered.length !== 1 ? "s" : ""} de ${rows.length} registros`
                : `${rows.length} registro${rows.length !== 1 ? "s" : ""} en Supabase`}
            </span>
            {total > 1 && (
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => p - 1)} disabled={page === 0}
                  className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  Anterior
                </button>
                <span className="px-3 py-1.5 rounded-lg text-sm bg-accent text-accent-foreground font-medium">
                  {page + 1} / {total}
                </span>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= total - 1}
                  className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
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
