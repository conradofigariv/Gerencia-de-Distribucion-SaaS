"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Search, RefreshCw, Loader2, X,
  AlertTriangle, Tag, Download, ChevronUp, ChevronDown,
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

const COLWIDTHS_KEY = "matriculas-colwidths";

// Columnas redimensionables (en orden). "Acciones" queda con ancho fijo.
type ColKey = "articulo" | "descripcion" | "udm" | "tipo" | "estado";
const COLS: { key: ColKey; label: string; align: "left" | "right" }[] = [
  { key: "articulo",    label: "Matrícula",   align: "left" },
  { key: "descripcion", label: "Descripción", align: "left" },
  { key: "udm",         label: "UDM",         align: "left" },
  { key: "tipo",        label: "Tipo",        align: "left" },
  { key: "estado",      label: "Estado",      align: "left" },
];
const DEFAULT_WIDTHS: Record<ColKey, number> = {
  articulo: 150, descripcion: 380, udm: 90, tipo: 120, estado: 130,
};
const ACCIONES_W = 96;

// ─── Handle para redimensionar columnas ─────────────────────────────────────
function ResizeHandle({ onStart }: { onStart: (e: MouseEvent) => void }) {
  return (
    <div
      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none group/rh"
      onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onStart(e.nativeEvent); }}
      onClick={e => e.stopPropagation()}
    >
      <div className="absolute right-0 top-1/4 h-1/2 w-px bg-border group-hover/rh:bg-accent/60 transition-colors" />
    </div>
  );
}

// Separador de campos: tabulador. Combinado con BOM UTF-16LE es el formato
// que Excel siempre reconoce sin ambigüedad (es lo mismo que genera
// "Guardar como → Texto Unicode"). Con coma o punto y coma, Excel puede
// terminar interpretando mal el separador o los acentos según la configuración
// regional del usuario.
const CSV_SEP = "\t";

/** Escapa un valor para CSV (comillas, separador, saltos de línea). */
function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /["\t\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Codifica texto a UTF-16LE (con BOM) — formato que Excel siempre reconoce. */
function toUtf16LeBytes(text: string): ArrayBuffer {
  const withBom = "﻿" + text;
  const buf = new ArrayBuffer(withBom.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < withBom.length; i++) {
    view.setUint16(i * 2, withBom.charCodeAt(i), /* littleEndian */ true);
  }
  return buf;
}

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

  const [sortKey, setSortKey] = useState<ColKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (key: ColKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const [modal, setModal]   = useState<{ mode: "create" | "edit"; row: Matricula | null } | null>(null);
  const [toDelete, setToDelete] = useState<Matricula | null>(null);

  // Ancho de columnas (redimensionable + persistido en localStorage)
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>({ ...DEFAULT_WIDTHS });
  const colWidthsLoaded = useRef(false);
  const resizingRef = useRef<{ col: ColKey; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLWIDTHS_KEY);
      if (raw) setColWidths(c => ({ ...c, ...(JSON.parse(raw) as Partial<Record<ColKey, number>>) }));
    } catch { /* ignorar */ }
    colWidthsLoaded.current = true;
  }, []);

  useEffect(() => {
    if (!colWidthsLoaded.current) return;
    try { localStorage.setItem(COLWIDTHS_KEY, JSON.stringify(colWidths)); } catch { /* ignorar */ }
  }, [colWidths]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const { col, startX, startWidth } = resizingRef.current;
      const newW = Math.max(60, startWidth + e.clientX - startX);
      setColWidths(p => ({ ...p, [col]: newW }));
    };
    const onUp = () => { resizingRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

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
    let result = rows.filter(r => {
      if (tipoFilter !== "todos" && tipoFromMatServ(r.mat_serv) !== tipoFilter) return false;
      if (!lo) return true;
      return (
        r.articulo.toLowerCase().includes(lo) ||
        (r.descripcion ?? "").toLowerCase().includes(lo)
      );
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      result = [...result].sort((a, b) => {
        let va: string, vb: string;
        if      (sortKey === "articulo")    { va = a.articulo;                  vb = b.articulo; }
        else if (sortKey === "descripcion") { va = a.descripcion ?? "";          vb = b.descripcion ?? ""; }
        else if (sortKey === "udm")         { va = a.unidad_medida ?? "";        vb = b.unidad_medida ?? ""; }
        else if (sortKey === "tipo")        { va = tipoFromMatServ(a.mat_serv); vb = tipoFromMatServ(b.mat_serv); }
        else                               { va = a.estado ?? "";               vb = b.estado ?? ""; }
        return dir * va.localeCompare(vb, "es", { numeric: sortKey === "articulo" });
      });
    }
    return result;
  }, [rows, search, tipoFilter, sortKey, sortDir]);

  const duplicates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.articulo, (counts.get(r.articulo) ?? 0) + 1);
    return [...counts.entries()].filter(([, c]) => c > 1).map(([art]) => art);
  }, [rows]);

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

  // Exporta la lista actualmente visible (respeta búsqueda y filtro) a CSV.
  const exportCsv = () => {
    if (filtered.length === 0) { toast.error("No hay matrículas para exportar"); return; }
    const headers = ["Matrícula", "Descripción", "Unidad de medida", "Tipo", "Estado"];
    const lines = [
      headers.map(csvCell).join(CSV_SEP),
      ...filtered.map(r => [
        r.articulo, r.descripcion, r.unidad_medida,
        tipoFromMatServ(r.mat_serv) === "material" ? "Material"
          : tipoFromMatServ(r.mat_serv) === "servicio" ? "Servicio" : "",
        r.estado,
      ].map(csvCell).join(CSV_SEP)),
    ];
    // UTF-16LE + BOM + tabulador: formato que Excel reconoce siempre sin
    // ambigüedad de codificación regional (evita el "Ã­" en vez de "í").
    const blob = new Blob([toUtf16LeBytes(lines.join("\r\n"))], { type: "text/csv;charset=utf-16le;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `matriculas_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`${filtered.length.toLocaleString("es-AR")} matrículas exportadas`);
  };

  const thBase = "px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground sticky top-0 z-[2] bg-secondary border-b border-border";
  const totalWidth = COLS.reduce((s, c) => s + colWidths[c.key], 0) + ACCIONES_W;
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
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-semibold text-foreground leading-tight">Matrículas</h2>
            <span className="text-xs text-muted-foreground">
              {loading ? "Cargando…" : (
                <>
                  {filtered.length.toLocaleString("es-AR")}
                  {filtered.length !== rows.length && <> de {rows.length.toLocaleString("es-AR")}</>} matrículas
                </>
              )}
            </span>
          </div>
        </div>
        <button
          onClick={() => setModal({ mode: "create", row: null })}
          className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-accent text-accent-foreground text-xs font-medium hover:bg-accent/90 transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />Agregar matrícula
        </button>
      </div>

      {/* Buscador + filtros + acciones, todo en una fila */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-wrap">
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
        <button
          onClick={exportCsv}
          disabled={loading || filtered.length === 0}
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
        >
          <Download className="w-3.5 h-3.5" />Exportar CSV
        </button>
        <button
          onClick={load}
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground transition-all"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />Actualizar
        </button>
      </div>

      {/* Banner de duplicados */}
      {duplicates.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {duplicates.length} número{duplicates.length > 1 ? "s" : ""} de matrícula duplicado{duplicates.length > 1 ? "s" : ""}:{" "}
          <span className="font-mono">{duplicates.slice(0, 4).join(", ")}{duplicates.length > 4 ? "…" : ""}</span>
        </div>
      )}

      {/* Tabla */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: "calc(100vh - 320px)", minHeight: 240 }}>
          <table className="text-sm" style={{ tableLayout: "fixed", width: totalWidth, borderCollapse: "separate", borderSpacing: 0 }}>
            <colgroup>
              {COLS.map(c => <col key={c.key} style={{ width: colWidths[c.key] }} />)}
              <col style={{ width: ACCIONES_W }} />
            </colgroup>
            <thead>
              <tr>
                {COLS.map(c => (
                  <th
                    key={c.key}
                    className={cn(thBase, "relative cursor-pointer select-none hover:text-foreground transition-colors")}
                    onClick={() => toggleSort(c.key)}
                  >
                    <span className="flex items-center gap-1">
                      {c.label}
                      {sortKey === c.key
                        ? (sortDir === "asc"
                            ? <ChevronUp className="w-3 h-3 shrink-0" />
                            : <ChevronDown className="w-3 h-3 shrink-0" />)
                        : <ChevronUp className="w-3 h-3 shrink-0 opacity-0" />
                      }
                    </span>
                    <ResizeHandle onStart={e => { resizingRef.current = { col: c.key, startX: e.clientX, startWidth: colWidths[c.key] }; }} />
                  </th>
                ))}
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
                        <td style={border} className="px-3 py-2.5 font-mono text-xs text-accent-green truncate" title={r.articulo}>{r.articulo}</td>
                        <td style={border} className="px-3 py-2.5 text-foreground truncate" title={r.descripcion}>
                          {r.descripcion || <span className="text-muted-foreground/50">—</span>}
                        </td>
                        <td style={border} className="px-3 py-2.5 text-muted-foreground truncate" title={r.unidad_medida}>{r.unidad_medida || "—"}</td>
                        <td style={border} className="px-3 py-2.5 truncate"><TipoBadge matServ={r.mat_serv} /></td>
                        <td style={border} className="px-3 py-2.5 text-muted-foreground truncate" title={r.estado}>{r.estado || "—"}</td>
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
