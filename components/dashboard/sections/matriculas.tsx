"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Search, RefreshCw, Loader2, X,
  Database, AlertTriangle, Tag,
} from "lucide-react";
import {
  listMatriculas, createMatricula, updateMatricula, deleteMatricula,
  articuloExists, cleanInput, tipoFromMatServ,
  type Matricula, type MatriculaInput,
} from "@/lib/matriculas";

type TipoFilter = "todos" | "material" | "servicio";

const EMPTY_INPUT: MatriculaInput = {
  articulo: "", descripcion: "", unidad_medida: "", estado: "", mat_serv: "",
};

// ─── Badge de tipo (Material/Servicio) ──────────────────────────────────────
function TipoBadge({ matServ }: { matServ: string }) {
  const tipo = tipoFromMatServ(matServ);
  if (tipo === "material")
    return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-500/15 text-blue-300 border border-blue-500/25">Material</span>;
  if (tipo === "servicio")
    return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/25">Servicio</span>;
  return <span className="text-xs text-muted-foreground/60">—</span>;
}

// ─── Modal de alta / edición ────────────────────────────────────────────────
function MatriculaModal({
  mode, initial, existingArticulo, onClose, onSaved,
}: {
  mode: "create" | "edit";
  initial: Matricula | null;
  existingArticulo?: string;
  onClose: () => void;
  onSaved: (m: Matricula, mode: "create" | "edit") => void;
}) {
  const [form, setForm] = useState<MatriculaInput>(
    initial
      ? {
          articulo: initial.articulo, descripcion: initial.descripcion,
          unidad_medida: initial.unidad_medida, estado: initial.estado,
          mat_serv: initial.mat_serv,
        }
      : { ...EMPTY_INPUT },
  );
  const [saving, setSaving] = useState(false);

  const set = (k: keyof MatriculaInput, v: string) => setForm(p => ({ ...p, [k]: v }));

  const submit = async () => {
    const clean = cleanInput(form);
    if (!clean.articulo) { toast.error("La matrícula (número de artículo) es obligatoria"); return; }
    setSaving(true);
    try {
      // Evita duplicar el número de artículo.
      const dup = await articuloExists(clean.articulo, initial?.id);
      if (dup) { toast.error(`Ya existe una matrícula con el número ${clean.articulo}`); return; }

      const saved = mode === "edit" && initial?.id
        ? await updateMatricula(initial.id, clean)
        : await createMatricula(clean);
      toast.success(mode === "edit" ? "Matrícula actualizada" : "Matrícula agregada");
      onSaved(saved, mode);
    } catch (e) {
      toast.error(`Error al guardar: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-accent" />
            <span className="text-sm font-semibold text-foreground">
              {mode === "edit" ? "Editar matrícula" : "Agregar matrícula"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Matrícula (N° de artículo) *</label>
            <input
              autoFocus={mode === "create"}
              value={form.articulo}
              onChange={e => set("articulo", e.target.value)}
              placeholder="Ej. 1234567.0"
              className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Descripción</label>
            <textarea
              value={form.descripcion}
              onChange={e => set("descripcion", e.target.value)}
              rows={2}
              placeholder="Descripción del material o servicio"
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Unidad de medida</label>
              <input
                value={form.unidad_medida}
                onChange={e => set("unidad_medida", e.target.value)}
                placeholder="Ej. UN, MT, KG"
                className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Estado</label>
              <input
                value={form.estado}
                onChange={e => set("estado", e.target.value)}
                placeholder="Ej. Activo"
                className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Tipo (Mat/Serv)</label>
            <div className="flex items-center gap-1 rounded-lg bg-secondary/40 border border-border p-0.5">
              {([
                { v: "", label: "Sin definir" },
                { v: "Material", label: "Material" },
                { v: "Servicio", label: "Servicio" },
              ] as const).map(opt => {
                const active = tipoFromMatServ(form.mat_serv) === tipoFromMatServ(opt.v) && (opt.v ? true : !form.mat_serv);
                return (
                  <button
                    key={opt.label}
                    onClick={() => set("mat_serv", opt.v)}
                    className={cn(
                      "flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors",
                      active ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="h-8 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-all flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {mode === "edit" ? "Guardar cambios" : "Agregar"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Confirmación de borrado ────────────────────────────────────────────────
function DeleteConfirm({
  matricula, onClose, onConfirm,
}: {
  matricula: Matricula;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const run = async () => { setDeleting(true); await onConfirm(); setDeleting(false); };
  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-destructive/15 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4 text-destructive" />
            </div>
            <span className="text-sm font-semibold text-foreground">Eliminar matrícula</span>
          </div>
          <p className="text-sm text-muted-foreground">
            ¿Seguro que querés eliminar la matrícula{" "}
            <span className="font-mono text-foreground">{matricula.articulo}</span>
            {matricula.descripcion ? <> — {matricula.descripcion}</> : null}? Esta acción no se puede deshacer.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="h-8 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={run}
            disabled={deleting}
            className="h-8 px-4 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 transition-all flex items-center gap-1.5"
          >
            {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Eliminar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Sección principal ──────────────────────────────────────────────────────
export function MatriculasSection() {
  const [rows, setRows]       = useState<Matricula[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [tipoFilter, setTipoFilter] = useState<TipoFilter>("todos");

  const [modal, setModal]   = useState<{ mode: "create" | "edit"; row: Matricula | null } | null>(null);
  const [toDelete, setToDelete] = useState<Matricula | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listMatriculas());
    } catch (e) {
      toast.error(`Error al cargar matrículas: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const lo = search.trim().toLowerCase();
    return rows.filter(r => {
      if (tipoFilter !== "todos" && tipoFromMatServ(r.mat_serv) !== tipoFilter) return false;
      if (!lo) return true;
      return (
        r.articulo.toLowerCase().includes(lo) ||
        (r.descripcion ?? "").toLowerCase().includes(lo)
      );
    });
  }, [rows, search, tipoFilter]);

  // Virtualización
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 14,
  });

  // Aplica el resultado de un alta/edición al estado local sin recargar todo.
  const applySaved = (saved: Matricula, mode: "create" | "edit") => {
    setRows(prev => {
      const next = mode === "edit"
        ? prev.map(r => (r.id === saved.id ? saved : r))
        : [...prev, saved];
      return next.sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { numeric: true }));
    });
    setModal(null);
  };

  const confirmDelete = async () => {
    if (!toDelete?.id) return;
    try {
      await deleteMatricula(toDelete.id);
      setRows(prev => prev.filter(r => r.id !== toDelete.id));
      toast.success("Matrícula eliminada");
      setToDelete(null);
    } catch (e) {
      toast.error(`Error al eliminar: ${e instanceof Error ? e.message : "Error"}`);
    }
  };

  const thBase = "px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground sticky top-0 z-[2] bg-secondary border-b border-border";
  const vItems = virtualizer.getVirtualItems();
  const totalH = virtualizer.getTotalSize();
  const padTop = vItems.length ? vItems[0].start : 0;
  const padBot = vItems.length ? totalH - vItems[vItems.length - 1].end : 0;

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
            <Tag className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground leading-tight">Matrículas</h2>
            <p className="text-xs text-muted-foreground">
              Base de matrículas actualizable — agregá, editá o eliminá de a una.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground transition-all"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />Actualizar
          </button>
          <button
            onClick={() => setModal({ mode: "create", row: null })}
            className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-accent text-accent-foreground text-xs font-medium hover:bg-accent/90 transition-all"
          >
            <Plus className="w-4 h-4" />Agregar matrícula
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por número o descripción…"
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-secondary/40 border border-border p-0.5">
          {([
            { v: "todos", label: "Todos" },
            { v: "material", label: "Material" },
            { v: "servicio", label: "Servicio" },
          ] as const).map(opt => (
            <button
              key={opt.v}
              onClick={() => setTipoFilter(opt.v)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                tipoFilter === opt.v ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Conteo */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Database className="w-3.5 h-3.5" />
        {loading ? (
          "Cargando…"
        ) : (
          <span>
            {filtered.length.toLocaleString("es-AR")}
            {filtered.length !== rows.length && <> de {rows.length.toLocaleString("es-AR")}</>} matrículas
          </span>
        )}
      </div>

      {/* Tabla */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: "calc(100vh - 320px)", minHeight: 240 }}>
          <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
            <colgroup>
              <col style={{ width: 150 }} />
              <col />
              <col style={{ width: 90 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr>
                <th className={thBase}>Matrícula</th>
                <th className={thBase}>Descripción</th>
                <th className={thBase}>UDM</th>
                <th className={thBase}>Tipo</th>
                <th className={thBase}>Estado</th>
                <th className={cn(thBase, "text-right")}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-16 text-center text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin inline" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-16 text-center text-sm text-muted-foreground">
                    <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-warning" />
                    {rows.length === 0
                      ? "No hay matrículas cargadas. Cargá la planilla en «Carga de datos» o agregá una a mano."
                      : "Ninguna matrícula coincide con la búsqueda."}
                  </td>
                </tr>
              ) : (
                <>
                  {padTop > 0 && <tr style={{ height: padTop }}><td colSpan={6} style={{ padding: 0, border: "none" }} /></tr>}
                  {vItems.map(vi => {
                    const r = filtered[vi.index];
                    const isLast = vi.index === filtered.length - 1;
                    const border = isLast ? {} : { borderBottom: "1px solid hsl(var(--border))" };
                    return (
                      <tr key={r.id ?? r.articulo} className="group hover:bg-secondary/40 transition-colors">
                        <td style={border} className="px-3 py-2.5 font-mono text-xs text-accent-green whitespace-nowrap">{r.articulo}</td>
                        <td style={border} className="px-3 py-2.5 text-foreground">
                          <span className="block truncate" title={r.descripcion}>{r.descripcion || <span className="text-muted-foreground/50">—</span>}</span>
                        </td>
                        <td style={border} className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{r.unidad_medida || "—"}</td>
                        <td style={border} className="px-3 py-2.5"><TipoBadge matServ={r.mat_serv} /></td>
                        <td style={border} className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{r.estado || "—"}</td>
                        <td style={border} className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => setModal({ mode: "edit", row: r })}
                              title="Editar"
                              className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setToDelete(r)}
                              title="Eliminar"
                              className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {padBot > 0 && <tr style={{ height: padBot }}><td colSpan={6} style={{ padding: 0, border: "none" }} /></tr>}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <MatriculaModal
          mode={modal.mode}
          initial={modal.row}
          onClose={() => setModal(null)}
          onSaved={applySaved}
        />
      )}
      {toDelete && (
        <DeleteConfirm
          matricula={toDelete}
          onClose={() => setToDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
