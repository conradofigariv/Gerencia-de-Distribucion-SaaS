"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Tag, Plus, Trash2, Pencil, Search, RefreshCw, Loader2, X,
  FolderPlus, Check, AlertTriangle, Layers,
} from "lucide-react";
import {
  listFamilias, createFamilia, renameFamilia, deleteFamilia,
  listAsignaciones, assignMatriculas, removeMatriculas, bulkImport,
  validarContraCatalogo, getMatriculasInfo, getTipoOverrides,
  type Familia, type MatriculaInfo, type ArticuloTipo,
} from "@/lib/familias";

// ─── Badge de tipo (Material / Servicio) ────────────────────────────────────
function TipoBadge({ tipo }: { tipo: ArticuloTipo }) {
  if (tipo === "material")
    return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/25">Material</span>;
  if (tipo === "servicio")
    return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/25">Servicio</span>;
  return null;
}

// ─── Modal: importar familia (nombre + pegar matrículas + preview) ───────────
function ImportFamiliaModal({
  catalog, onClose, onDone,
}: {
  catalog: Map<string, MatriculaInfo>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [texto, setTexto]   = useState("");
  const [preview, setPreview] = useState<{ reconocidas: string[]; noEncontradas: string[] } | null>(null);
  const [importing, setImporting] = useState(false);

  // Matrículas pegadas: una por línea; tolera coma / tab / punto y coma.
  const matriculas = useMemo(
    () => [...new Set(texto.split(/[\r\n\t,;]+/).map(s => s.trim()).filter(Boolean))],
    [texto],
  );

  const doPreview = async () => {
    if (matriculas.length === 0) { toast.error("Pegá al menos una matrícula."); return; }
    const res = await validarContraCatalogo(matriculas, catalog);
    setPreview(res);
  };

  // Al editar el texto se invalida el preview previo.
  const onTextChange = (v: string) => { setTexto(v); setPreview(null); };

  const doImport = async () => {
    const n = nombre.trim();
    if (!n) { toast.error("Ponele un nombre a la familia."); return; }
    if (!preview || preview.reconocidas.length === 0) { toast.error("No hay matrículas reconocidas para importar."); return; }
    setImporting(true);
    const { error, asignadas } = await bulkImport(n, preview.reconocidas);
    if (error) { toast.error(`Error: ${error}`); setImporting(false); return; }
    toast.success(`Familia «${n}»: ${asignadas} matrícula${asignadas === 1 ? "" : "s"} asignada${asignadas === 1 ? "" : "s"}.`);
    setImporting(false);
    onDone();
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-accent" />
            <span className="text-sm font-semibold text-foreground">Importar familia</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Nombre de la familia *</label>
            <input
              autoFocus
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Ej. Cables de aluminio"
              className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Matrículas <span className="text-muted-foreground/60">(una por línea — pegá tu lista)</span>
            </label>
            <textarea
              value={texto}
              onChange={e => onTextChange(e.target.value)}
              rows={6}
              placeholder={"1234567.0\n7654321.0\n…"}
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/20 resize-y"
            />
            <p className="text-[11px] text-muted-foreground">{matriculas.length} matrícula{matriculas.length === 1 ? "" : "s"} pegada{matriculas.length === 1 ? "" : "s"}.</p>
          </div>

          {preview && (
            <div className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex items-center gap-2 text-sm text-success">
                <Check className="w-4 h-4 shrink-0" />
                <span className="font-medium">{preview.reconocidas.length} reconocida{preview.reconocidas.length === 1 ? "" : "s"}</span>
                <span className="text-muted-foreground">en el catálogo</span>
              </div>
              {preview.noEncontradas.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-amber-400">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="font-medium">{preview.noEncontradas.length} no encontrada{preview.noEncontradas.length === 1 ? "" : "s"}</span>
                    <span className="text-muted-foreground">(se omiten)</span>
                  </div>
                  <p className="text-[11px] font-mono text-muted-foreground break-all">
                    {preview.noEncontradas.slice(0, 12).join(", ")}{preview.noEncontradas.length > 12 ? "…" : ""}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="h-8 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">Cancelar</button>
          {!preview ? (
            <button onClick={doPreview} className="h-8 px-4 rounded-lg bg-secondary border border-border text-sm font-medium text-foreground hover:bg-secondary/80 transition-all">
              Previsualizar
            </button>
          ) : (
            <button onClick={doImport} disabled={importing || preview.reconocidas.length === 0} className="h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-all flex items-center gap-1.5">
              {importing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Importar {preview.reconocidas.length > 0 ? preview.reconocidas.length : ""}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Modal: agregar matrículas a una familia (selección del catálogo) ────────
function PickerModal({
  familiaNombre, catalog, tipoFor, yaAsignadas, onClose, onConfirm,
}: {
  familiaNombre: string;
  catalog: Map<string, MatriculaInfo>;
  tipoFor: (articulo: string) => ArticuloTipo;
  yaAsignadas: Set<string>;
  onClose: () => void;
  onConfirm: (articulos: string[]) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Catálogo sin las ya asignadas (acá se AGREGAN nuevas; quitar es en el panel).
  const disponibles = useMemo(() => {
    const arr: { articulo: string; info: MatriculaInfo }[] = [];
    for (const [articulo, info] of catalog) {
      if (!yaAsignadas.has(articulo)) arr.push({ articulo, info });
    }
    arr.sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { numeric: true }));
    return arr;
  }, [catalog, yaAsignadas]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return disponibles;
    return disponibles.filter(d =>
      d.articulo.toLowerCase().includes(q) || d.info.descripcion.toLowerCase().includes(q));
  }, [disponibles, search]);

  const rowVirt = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 12,
  });

  const toggle = (articulo: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(articulo) ? next.delete(articulo) : next.add(articulo);
      return next;
    });
  };

  const run = async () => {
    if (selected.size === 0) { toast.error("Elegí al menos una matrícula."); return; }
    setSaving(true);
    await onConfirm([...selected]);
    setSaving(false);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Plus className="w-4 h-4 text-accent shrink-0" />
            <span className="text-sm font-semibold text-foreground truncate">Agregar matrículas a «{familiaNombre}»</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 border-b border-border shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por número o descripción…"
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-[240px]">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">Sin matrículas para agregar.</div>
          ) : (
            <div style={{ height: rowVirt.getTotalSize(), position: "relative" }}>
              {rowVirt.getVirtualItems().map(v => {
                const d = filtered[v.index];
                const checked = selected.has(d.articulo);
                return (
                  <button
                    key={d.articulo}
                    onClick={() => toggle(d.articulo)}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 40, transform: `translateY(${v.start}px)` }}
                    className={cn(
                      "flex items-center gap-3 px-4 text-left border-b border-border/50 transition-colors",
                      checked ? "bg-accent/10" : "hover:bg-secondary/60",
                    )}
                  >
                    <span className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                      checked ? "bg-accent border-accent" : "border-border",
                    )}>
                      {checked && <Check className="w-3 h-3 text-accent-foreground" />}
                    </span>
                    <span className="font-mono text-xs text-foreground shrink-0 w-28 truncate">{d.articulo}</span>
                    <span className="text-xs text-muted-foreground truncate flex-1">{d.info.descripcion || "—"}</span>
                    <TipoBadge tipo={tipoFor(d.articulo)} />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border shrink-0">
          <span className="text-xs text-muted-foreground">{selected.size} seleccionada{selected.size === 1 ? "" : "s"}</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="h-8 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">Cancelar</button>
            <button onClick={run} disabled={saving || selected.size === 0} className="h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-all flex items-center gap-1.5">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Agregar {selected.size > 0 ? selected.size : ""}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Modal: renombrar familia ───────────────────────────────────────────────
function RenameModal({ familia, onClose, onConfirm }: { familia: Familia; onClose: () => void; onConfirm: (nombre: string) => Promise<void> }) {
  const [nombre, setNombre] = useState(familia.nombre);
  const [saving, setSaving] = useState(false);
  const run = async () => {
    if (!nombre.trim()) { toast.error("El nombre no puede estar vacío."); return; }
    setSaving(true); await onConfirm(nombre.trim()); setSaving(false);
  };
  return createPortal(
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <Pencil className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-foreground">Renombrar familia</span>
        </div>
        <div className="p-5">
          <input
            autoFocus
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") run(); }}
            className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="h-8 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">Cancelar</button>
          <button onClick={run} disabled={saving} className="h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-all flex items-center gap-1.5">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Guardar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Modal: eliminar familia ────────────────────────────────────────────────
function DeleteFamiliaModal({ familia, count, onClose, onConfirm }: { familia: Familia; count: number; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [deleting, setDeleting] = useState(false);
  const run = async () => { setDeleting(true); await onConfirm(); setDeleting(false); };
  return createPortal(
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-destructive/15 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4 text-destructive" />
            </div>
            <span className="text-sm font-semibold text-foreground">Eliminar familia</span>
          </div>
          <p className="text-sm text-muted-foreground">
            ¿Eliminar la familia <span className="text-foreground font-medium">«{familia.nombre}»</span>?
            {count > 0 && <> Se quitará de <span className="text-foreground">{count}</span> matrícula{count === 1 ? "" : "s"}</>}. Las matrículas del catálogo NO se borran. Esta acción no se puede deshacer.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="h-8 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">Cancelar</button>
          <button onClick={run} disabled={deleting} className="h-8 px-4 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 transition-all flex items-center gap-1.5">
            {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Eliminar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Sección principal ──────────────────────────────────────────────────────
export function MatriculasFamiliasSection() {
  const [familias, setFamilias]         = useState<Familia[]>([]);
  const [asignaciones, setAsignaciones] = useState<{ familiaId: string; articulo: string }[]>([]);
  const [catalog, setCatalog]           = useState<Map<string, MatriculaInfo>>(new Map());
  const [overrides, setOverrides]       = useState<Map<string, ArticuloTipo>>(new Map());
  const [loading, setLoading]           = useState(true);

  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [familiaSearch, setFamiliaSearch] = useState("");
  const [matSearch, setMatSearch]       = useState("");
  const [newFamiliaName, setNewFamiliaName] = useState("");

  const [importOpen, setImportOpen]     = useState(false);
  const [pickerOpen, setPickerOpen]     = useState(false);
  const [renameTarget, setRenameTarget] = useState<Familia | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Familia | null>(null);

  // ── Carga ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const [fams, asigs, cat, ovr] = await Promise.all([
      listFamilias(), listAsignaciones(), getMatriculasInfo(), getTipoOverrides(),
    ]);
    setFamilias(fams);
    setAsignaciones(asigs);
    setCatalog(cat);
    setOverrides(ovr);
    setLoading(false);
  }, []);

  // Refresca familias + asignaciones sin recargar el catálogo (más liviano).
  const refresh = useCallback(async () => {
    const [fams, asigs] = await Promise.all([listFamilias(), listAsignaciones()]);
    setFamilias(fams);
    setAsignaciones(asigs);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Derivados ────────────────────────────────────────────────────────────────
  const matriculasByFamilia = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of asignaciones) {
      if (!m.has(a.familiaId)) m.set(a.familiaId, []);
      m.get(a.familiaId)!.push(a.articulo);
    }
    return m;
  }, [asignaciones]);

  const tipoFor = useCallback(
    (articulo: string): ArticuloTipo => overrides.get(articulo) ?? catalog.get(articulo)?.tipo ?? "",
    [overrides, catalog],
  );

  const familiasFiltradas = useMemo(() => {
    const q = familiaSearch.trim().toLowerCase();
    const list = q ? familias.filter(f => f.nombre.toLowerCase().includes(q)) : familias;
    return list;
  }, [familias, familiaSearch]);

  const selected = useMemo(() => familias.find(f => f.id === selectedId) ?? null, [familias, selectedId]);

  const selectedArticulos = useMemo(
    () => (selectedId ? matriculasByFamilia.get(selectedId) ?? [] : []),
    [selectedId, matriculasByFamilia],
  );

  const selectedFiltrados = useMemo(() => {
    const q = matSearch.trim().toLowerCase();
    const arr = selectedArticulos
      .map(articulo => ({ articulo, info: catalog.get(articulo) }))
      .filter(d => !q || d.articulo.toLowerCase().includes(q) || (d.info?.descripcion ?? "").toLowerCase().includes(q));
    arr.sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { numeric: true }));
    return arr;
  }, [selectedArticulos, catalog, matSearch]);

  // Virtualización del panel de matrículas asignadas.
  const matScrollRef = useRef<HTMLDivElement>(null);
  const matVirt = useVirtualizer({
    count: selectedFiltrados.length,
    getScrollElement: () => matScrollRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  // ── Acciones ─────────────────────────────────────────────────────────────────
  const handleCreateFamilia = async () => {
    const n = newFamiliaName.trim();
    if (!n) return;
    const { id, error } = await createFamilia(n);
    if (error) { toast.error(error); return; }
    toast.success(`Familia «${n}» creada.`);
    setNewFamiliaName("");
    await refresh();
    if (id) setSelectedId(id);
  };

  const handleAddMatriculas = async (articulos: string[]) => {
    if (!selectedId) return;
    const err = await assignMatriculas(selectedId, articulos);
    if (err) { toast.error(`Error: ${err}`); return; }
    toast.success(`${articulos.length} matrícula${articulos.length === 1 ? "" : "s"} agregada${articulos.length === 1 ? "" : "s"}.`);
    setPickerOpen(false);
    await refresh();
  };

  const handleRemoveMatricula = async (articulo: string) => {
    if (!selectedId) return;
    const err = await removeMatriculas(selectedId, [articulo]);
    if (err) { toast.error(`Error: ${err}`); return; }
    await refresh();
  };

  const handleRename = async (nombre: string) => {
    if (!renameTarget) return;
    const err = await renameFamilia(renameTarget.id, nombre);
    if (err) { toast.error(err); return; }
    toast.success("Familia renombrada.");
    setRenameTarget(null);
    await refresh();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const err = await deleteFamilia(deleteTarget.id);
    if (err) { toast.error(err); return; }
    toast.success(`Familia «${deleteTarget.nombre}» eliminada.`);
    if (selectedId === deleteTarget.id) setSelectedId(null);
    setDeleteTarget(null);
    await refresh();
  };

  const yaAsignadas = useMemo(() => new Set(selectedArticulos), [selectedArticulos]);

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
            <Layers className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground leading-tight">Familias</h2>
            <p className="text-xs text-muted-foreground">
              Agrupá matrículas del catálogo en familias. Importá listas completas o seleccioná a mano.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-accent text-accent-foreground text-xs font-medium hover:bg-accent/90 transition-all"
          >
            <FolderPlus className="w-4 h-4" />Importar familia
          </button>
          <button
            onClick={load}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground transition-all"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />Actualizar
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-72 text-sm text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />Cargando familias…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          {/* Panel izquierdo: familias */}
          <div className="rounded-xl border border-border bg-card/40 overflow-hidden flex flex-col max-h-[70vh]">
            <div className="p-3 border-b border-border space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={familiaSearch}
                  onChange={e => setFamiliaSearch(e.target.value)}
                  placeholder="Buscar familia…"
                  className="w-full h-8 pl-8 pr-3 rounded-lg bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  value={newFamiliaName}
                  onChange={e => setNewFamiliaName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleCreateFamilia(); }}
                  placeholder="Nueva familia…"
                  className="flex-1 h-8 px-3 rounded-lg bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
                <button
                  onClick={handleCreateFamilia}
                  disabled={!newFamiliaName.trim()}
                  className="h-8 w-8 flex items-center justify-center rounded-lg bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-40 transition-all shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-1.5">
              {familiasFiltradas.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-xs text-muted-foreground text-center px-4">
                  {familias.length === 0 ? "Todavía no hay familias. Creá una o importá tu primera lista." : "Sin resultados."}
                </div>
              ) : familiasFiltradas.map(f => {
                const count = matriculasByFamilia.get(f.id)?.length ?? 0;
                const active = f.id === selectedId;
                return (
                  <div
                    key={f.id}
                    onClick={() => { setSelectedId(f.id); setMatSearch(""); }}
                    className={cn(
                      "group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors",
                      active ? "bg-accent/15" : "hover:bg-secondary/60",
                    )}
                  >
                    <Tag className={cn("w-3.5 h-3.5 shrink-0", active ? "text-accent" : "text-muted-foreground")} />
                    <span className={cn("text-sm truncate flex-1", active ? "text-foreground font-medium" : "text-foreground/90")}>{f.nombre}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{count}</span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={e => { e.stopPropagation(); setRenameTarget(f); }} className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button onClick={e => { e.stopPropagation(); setDeleteTarget(f); }} className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-3 py-2 border-t border-border text-[11px] text-muted-foreground">
              {familias.length} familia{familias.length === 1 ? "" : "s"}
            </div>
          </div>

          {/* Panel derecho: matrículas de la familia seleccionada */}
          <div className="rounded-xl border border-border bg-card/40 overflow-hidden flex flex-col max-h-[70vh]">
            {!selected ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center px-6 gap-2">
                <Layers className="w-8 h-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Elegí una familia de la izquierda para ver y editar sus matrículas.</p>
              </div>
            ) : (
              <>
                <div className="p-3 border-b border-border flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground truncate">{selected.nombre}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0">{selectedArticulos.length} matrícula{selectedArticulos.length === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  <div className="relative w-48 shrink-0 hidden sm:block">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      value={matSearch}
                      onChange={e => setMatSearch(e.target.value)}
                      placeholder="Filtrar…"
                      className="w-full h-8 pl-8 pr-3 rounded-lg bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20"
                    />
                  </div>
                  <button
                    onClick={() => setPickerOpen(true)}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-accent text-accent-foreground text-xs font-medium hover:bg-accent/90 transition-all shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />Agregar
                  </button>
                </div>

                <div ref={matScrollRef} className="flex-1 overflow-y-auto">
                  {selectedFiltrados.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                      {selectedArticulos.length === 0 ? "Esta familia no tiene matrículas. Agregá con el botón o importá una lista." : "Sin resultados."}
                    </div>
                  ) : (
                    <div style={{ height: matVirt.getTotalSize(), position: "relative" }}>
                      {matVirt.getVirtualItems().map(v => {
                        const d = selectedFiltrados[v.index];
                        return (
                          <div
                            key={d.articulo}
                            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 44, transform: `translateY(${v.start}px)` }}
                            className="group flex items-center gap-3 px-4 border-b border-border/50 hover:bg-secondary/40 transition-colors"
                          >
                            <span className="font-mono text-xs text-foreground shrink-0 w-28 truncate">{d.articulo}</span>
                            <span className="text-xs text-muted-foreground truncate flex-1">{d.info?.descripcion || "—"}</span>
                            <TipoBadge tipo={tipoFor(d.articulo)} />
                            <button
                              onClick={() => handleRemoveMatricula(d.articulo)}
                              title="Quitar de la familia"
                              className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modales */}
      {importOpen && (
        <ImportFamiliaModal
          catalog={catalog}
          onClose={() => setImportOpen(false)}
          onDone={async () => { setImportOpen(false); await refresh(); }}
        />
      )}
      {pickerOpen && selected && (
        <PickerModal
          familiaNombre={selected.nombre}
          catalog={catalog}
          tipoFor={tipoFor}
          yaAsignadas={yaAsignadas}
          onClose={() => setPickerOpen(false)}
          onConfirm={handleAddMatriculas}
        />
      )}
      {renameTarget && (
        <RenameModal familia={renameTarget} onClose={() => setRenameTarget(null)} onConfirm={handleRename} />
      )}
      {deleteTarget && (
        <DeleteFamiliaModal
          familia={deleteTarget}
          count={matriculasByFamilia.get(deleteTarget.id)?.length ?? 0}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
