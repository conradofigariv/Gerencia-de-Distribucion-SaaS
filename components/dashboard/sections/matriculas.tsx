"use client";

import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Search, RefreshCw, Loader2, X,
  AlertTriangle, Tag, Download,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { loadTableLayout, saveTableLayout } from "@/lib/tableLayout";
import {
  type Density, type SortDir, DENSITY_ROW_H, DENSITY_LABEL, DENSITY_ORDER, isDensity,
  SortArrow, IdoCheckbox, TipoPill, monoFont, sansFont, autoFitTextWidth, IdoConfirmModal, CargandoFilas,
} from "@/components/dashboard/ido-kit";
import {
  listMatriculas, createMatricula, updateMatricula, deleteMatricula, deleteMatriculasBulk,
  articuloExists, cleanInput, tipoFromMatServ,
  type Matricula, type MatriculaInput,
} from "@/lib/matriculas";

// Pantalla en el sistema de diseño IDO (design-system.md): tabla en CSS grid
// con header sticky (§4.11), redimensionado + doble clic (§4.15), ajuste al
// ancho (§4.17), densidad (§4.19) + layout persistido (§4.20), selección de
// filas con barra flotante (§4.16), badges (§4.3), inputs (§4.2), botones
// (§4.1) y filtro de tipo con burbuja deslizante (§4.7).

type TipoFilter = "todos" | "material" | "servicio";

const EMPTY_INPUT: MatriculaInput = {
  articulo: "", descripcion: "", unidad_medida: "", estado: "", mat_serv: "",
};

// ─── Columnas ───────────────────────────────────────────────────────────────
type ColKey = "articulo" | "descripcion" | "udm" | "tipo" | "estado";
const COLS: { key: ColKey; label: string }[] = [
  { key: "articulo",    label: "Matrícula" },
  { key: "descripcion", label: "Descripción" },
  { key: "udm",         label: "UDM" },
  { key: "tipo",        label: "Tipo" },
  { key: "estado",      label: "Estado" },
];
const COL_KEYS = new Set<string>(COLS.map((c) => c.key));
// Ancho natural de cada columna. Solo Descripción absorbe el sobrante (§4.17):
// es la única de texto largo; Matrícula es la identificadora y el resto son
// referencias cortas.
const NATURAL_W: Record<ColKey, number> = {
  articulo: 130, descripcion: 260, udm: 80, tipo: 120, estado: 110,
};
const ABSORBER: ColKey = "descripcion";
const MIN_W = 64;     // §4.15
const SEL_W = 36;     // columna de checkbox
const HEADER_H = 38;  // §4.19: el encabezado no escala con la densidad

const TABLE_ID = "matriculasCatalogo";
// Clave vieja (antes de §4.20). Se borra al entrar: los anchos guardados ahí
// eran los defaults viejos y, leídos como "redimensionados a mano", dejarían a
// Descripción sin absorber el sobrante.
const LEGACY_COLWIDTHS_KEY = "matriculas-colwidths";

const COLLATOR_ES = new Intl.Collator("es");
const COLLATOR_ES_NUM = new Intl.Collator("es", { numeric: true });

const TIPO_FILTER_OPTS = [
  { v: "todos", label: "Todos" },
  { v: "material", label: "Material" },
  { v: "servicio", label: "Servicio" },
] as const;

const MODAL_TIPO_OPTS = [
  { v: "", label: "Sin definir" },
  { v: "Material", label: "Material" },
  { v: "Servicio", label: "Servicio" },
] as const;

const rowKey = (r: Matricula) => r.id ?? `art:${r.articulo}`;

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

/** Descarga una lista de matrículas como CSV (UTF-16LE + BOM + tabulador). */
function downloadCsv(list: Matricula[], fileSuffix: string) {
  const headers = ["Matrícula", "Descripción", "Unidad de medida", "Tipo", "Estado"];
  const lines = [
    headers.map(csvCell).join(CSV_SEP),
    ...list.map((r) => [
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
  a.download = `matriculas${fileSuffix}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Badge de estado (§4.3) ─────────────────────────────────────────────────
// "Activo" usa el badge de estado del sistema. "Inactivo" (u otro valor) no
// tiene badge definido → chip neutro, sin color semántico. Se muestra el
// valor tal cual viene de la planilla.
function EstadoBadge({ estado }: { estado: string }) {
  const v = (estado ?? "").trim();
  if (!v) return <span style={{ color: "var(--ido-text-faint)" }}>—</span>;
  const ok = v.toLowerCase().startsWith("activ");
  return (
    <span className={`ido-chip ${ok ? "ido-badge-ok" : "ido-badge-neutral"}`} style={{ maxWidth: "100%" }} title={v}>
      {/* El texto en un span propio: text-overflow no funciona sobre un
          contenedor flex (el texto suelto es un ítem anónimo). */}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
    </span>
  );
}

// ─── Ítem del menú de clic derecho (§4.5) ─────────────────────────────────
// Ícono en text.secondary que toma el color del ítem al hover; el destructivo
// va en `error` también en reposo (no solo al pasar el mouse).
function RowMenuItem({ icon: Icon, label, danger, onClick }: {
  icon: React.ElementType; label: string; danger?: boolean; onClick: () => void;
}) {
  return (
    <div
      role="menuitem"
      className="ido-menu-item ido-ctx-item"
      onClick={onClick}
      style={{ cursor: "pointer", ...(danger ? { color: "var(--ido-error)" } : null) }}
    >
      <Icon className="ido-ctx-icon w-3.5 h-3.5 shrink-0" style={danger ? { color: "var(--ido-error)" } : undefined} />
      <span style={{ flex: 1 }}>{label}</span>
    </div>
  );
}

// ─── Selector con burbuja deslizante (§4.7) ────────────────────────────────
// Memoizado A PROPÓSITO (igual que las tabs de Stock por Zona): `layoutId` de
// motion vuelve a medir el layout cada vez que el componente se re-renderiza;
// sin memo, cualquier cambio de la pantalla (tildar una fila, escribir en el
// buscador) dispararía esa medición. `options` y `onChange` tienen que ser
// estables (constantes de módulo / setters / useCallback).
const IdoSegmented = memo(function IdoSegmented({
  options, value, onChange, layoutId, full,
}: {
  options: readonly { v: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  layoutId: string;
  full?: boolean;
}) {
  return (
    <div className="ido-tabs" style={full ? { display: "flex", width: "100%" } : undefined}>
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button
            key={o.v || "_"}
            type="button"
            onClick={() => onChange(o.v)}
            className={`ido-tab${active ? " is-active" : ""}`}
            style={full ? { flex: 1, justifyContent: "center" } : undefined}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="ido-tab-bubble"
                transition={{ type: "spring", bounce: 0.2, duration: 0.35 }}
              />
            )}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
});

// ─── Modal de alta / edición ────────────────────────────────────────────────
function MatriculaModal({
  mode, initial, onClose, onSaved,
}: {
  mode: "create" | "edit";
  initial: Matricula | null;
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

  const set = (k: keyof MatriculaInput, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const setMatServ = useCallback((v: string) => setForm((p) => ({ ...p, mat_serv: v })), []);
  const tipo = tipoFromMatServ(form.mat_serv);
  const tipoValue = tipo === "material" ? "Material" : tipo === "servicio" ? "Servicio" : "";

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
    // `.ido-terminal` otra vez: el modal se portalea a <body>, fuera del
    // contenedor donde se definen los tokens --ido-*.
    <div className="ido-terminal ido-modal-overlay" onClick={onClose}>
      <div className="ido-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="ido-modal-head">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4" style={{ color: "var(--ido-text-dim)" }} />
            <span className="ido-modal-title">{mode === "edit" ? "Editar matrícula" : "Agregar matrícula"}</span>
          </div>
          <button type="button" className="ido-icon-btn" onClick={onClose} title="Cerrar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4" style={{ padding: 20 }}>
          <div>
            <label className="ido-label">Matrícula (N° de artículo) *</label>
            <input
              autoFocus={mode === "create"}
              value={form.articulo}
              onChange={(e) => set("articulo", e.target.value)}
              placeholder="Ej. 1234567.0"
              className="ido-input ido-input-mono"
            />
          </div>

          <div>
            <label className="ido-label">Descripción</label>
            <textarea
              value={form.descripcion}
              onChange={(e) => set("descripcion", e.target.value)}
              rows={2}
              placeholder="Descripción del material o servicio"
              className="ido-input"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ido-label">Unidad de medida</label>
              <input
                value={form.unidad_medida}
                onChange={(e) => set("unidad_medida", e.target.value)}
                placeholder="Ej. UN, MT, KG"
                className="ido-input"
              />
            </div>
            <div>
              <label className="ido-label">Estado</label>
              <input
                value={form.estado}
                onChange={(e) => set("estado", e.target.value)}
                placeholder="Ej. Activo"
                className="ido-input"
              />
            </div>
          </div>

          <div>
            <label className="ido-label">Tipo (Mat/Serv)</label>
            <IdoSegmented
              options={MODAL_TIPO_OPTS}
              value={tipoValue}
              onChange={setMatServ}
              layoutId="matricula-modal-tipo-bubble"
              full
            />
          </div>
        </div>

        <div className="ido-modal-foot">
          <button type="button" className="ido-btn ido-btn-text" style={{ height: 38 }} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ido-btn ido-btn-primary" style={{ height: 38 }} onClick={submit} disabled={saving}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {mode === "edit" ? "Guardar cambios" : "Agregar"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Confirmación de borrado (una o varias): `IdoConfirmModal` de ido-kit, el
// mismo que usa el Buscador.
const DeleteConfirm = IdoConfirmModal;

// ─── Sección principal ──────────────────────────────────────────────────────
export function MatriculasSection({ onSummaryChange }: { onSummaryChange?: (label: string | null) => void } = {}) {
  const [rows, setRows]       = useState<Matricula[]>([]);
  const [loading, setLoading] = useState(true);
  const [progreso, setProgreso] = useState<{ n: number; total: number } | null>(null);
  const [search, setSearch]   = useState("");
  const [tipoFilter, setTipoFilter] = useState<TipoFilter>("todos");
  const onTipoFilter = useCallback((v: string) => setTipoFilter(v as TipoFilter), []);

  const [sortKey, setSortKey] = useState<ColKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Al soltar un arrastre de redimensionado dentro del mismo encabezado, el
  // navegador dispara un `click` sobre ese encabezado → ordenaba la columna.
  // Se ignora el orden si un redimensionado terminó hace menos de 300ms.
  const lastResizeEnd = useRef(0);
  const toggleSort = (key: ColKey) => {
    if (Date.now() - lastResizeEnd.current < 300) return;
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const [modal, setModal]   = useState<{ mode: "create" | "edit"; row: Matricula | null } | null>(null);
  const [toDelete, setToDelete] = useState<Matricula | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // ── Usuario actual (namespacea la persistencia de layout por cuenta) ───────
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // ── Ancho de columna (§4.15) + densidad (§4.19), persistidos (§4.20) ───────
  const [colW, setColW] = useState<Partial<Record<ColKey, number>>>({});
  const colWRef = useRef(colW);
  useEffect(() => { colWRef.current = colW; }, [colW]);
  const [resizingCol, setResizingCol] = useState<ColKey | null>(null);
  const resizing = useRef<{ id: ColKey; startX: number; startW: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [density, setDensity] = useState<Density>("normal");
  // Las filas deslizan a su nueva altura SOLO al cambiar de densidad (§4.19,
  // 200ms). Si la transición quedara puesta siempre, también se animarían al
  // filtrar u ordenar, y escribir en el buscador haría "nadar" la tabla.
  const [densityAnim, setDensityAnim] = useState(false);
  const densityAnimT = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [resetMsg, setResetMsg] = useState(false);
  const resetMsgT = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (resetMsgT.current) clearTimeout(resetMsgT.current);
    if (densityAnimT.current) clearTimeout(densityAnimT.current);
  }, []);

  useEffect(() => {
    try { localStorage.removeItem(LEGACY_COLWIDTHS_KEY); } catch { /* ignorar */ }
  }, []);

  useEffect(() => {
    if (!userId) return;
    const saved = loadTableLayout(userId, TABLE_ID);
    if (saved.colW) {
      const known: Partial<Record<ColKey, number>> = {};
      for (const [k, v] of Object.entries(saved.colW)) {
        if (COL_KEYS.has(k) && typeof v === "number") known[k as ColKey] = v;
      }
      setColW(known);
    }
    if (isDensity(saved.density)) setDensity(saved.density);
  }, [userId]);

  function cycleDensity() {
    const next = DENSITY_ORDER[(DENSITY_ORDER.indexOf(density) + 1) % DENSITY_ORDER.length];
    setDensity(next);
    setDensityAnim(true);
    if (densityAnimT.current) clearTimeout(densityAnimT.current);
    densityAnimT.current = setTimeout(() => setDensityAnim(false), 240);
    if (userId) saveTableLayout(userId, TABLE_ID, { density: next });
  }

  function resetLayout() {
    setColW({});
    setDensity("normal");
    if (userId) saveTableLayout(userId, TABLE_ID, { colW: null, density: null });
    setResetMsg(true);
    if (resetMsgT.current) clearTimeout(resetMsgT.current);
    resetMsgT.current = setTimeout(() => setResetMsg(false), 1500);
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const r = resizing.current;
      if (!r) return;
      const w = Math.max(MIN_W, r.startW + (e.clientX - r.startX));
      setColW((p) => ({ ...p, [r.id]: w }));
    }
    function onUp() {
      if (!resizing.current) return;
      resizing.current = null;
      lastResizeEnd.current = Date.now();
      setResizingCol(null);
      if (userIdRef.current) saveTableLayout(userIdRef.current, TABLE_ID, { colW: colWRef.current as Record<string, number> });
    }
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
    return () => { window.removeEventListener("mousemove", onMove, true); window.removeEventListener("mouseup", onUp, true); };
  }, []);

  // ── Datos ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setProgreso(null);
    try {
      setRows(await listMatriculas((n, total) => setProgreso({ n, total })));
    } catch (e) {
      toast.error(`Error al cargar matrículas: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const lo = search.trim().toLowerCase();
    let result = rows.filter((r) => {
      if (tipoFilter !== "todos" && tipoFromMatServ(r.mat_serv) !== tipoFilter) return false;
      if (!lo) return true;
      return (
        r.articulo.toLowerCase().includes(lo) ||
        (r.descripcion ?? "").toLowerCase().includes(lo)
      );
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      const val = (r: Matricula): string =>
        sortKey === "articulo"    ? r.articulo
        : sortKey === "descripcion" ? r.descripcion ?? ""
        : sortKey === "udm"         ? r.unidad_medida ?? ""
        : sortKey === "tipo"        ? tipoFromMatServ(r.mat_serv)
        : r.estado ?? "";
      const coll = sortKey === "articulo" ? COLLATOR_ES_NUM : COLLATOR_ES;
      result = [...result].sort((a, b) => dir * coll.compare(val(a), val(b)));
    }
    return result;
  }, [rows, search, tipoFilter, sortKey, sortDir]);

  // Reporta el conteo al header global (icono + título viven ahí).
  useEffect(() => {
    if (!onSummaryChange) return;
    if (loading) { onSummaryChange("Cargando…"); return; }
    const label = filtered.length !== rows.length
      ? `${filtered.length.toLocaleString("es-AR")} de ${rows.length.toLocaleString("es-AR")} matrículas`
      : `${filtered.length.toLocaleString("es-AR")} matrículas`;
    onSummaryChange(label);
  }, [onSummaryChange, loading, filtered.length, rows.length]);

  const duplicates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.articulo, (counts.get(r.articulo) ?? 0) + 1);
    return [...counts.entries()].filter(([, c]) => c > 1).map(([art]) => art);
  }, [rows]);

  // ── Selección de filas (§4.16) ─────────────────────────────────────────────
  // Clic simple: exclusiva (inspección, checkbox sin marcar) · Ctrl/⌘ clic o
  // checkbox: acumula · ⇧ clic: rango · clic en zona vacía: libera.
  const [selMode, setSelMode] = useState<"simple" | "multi">("simple");
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [selAnchor, setSelAnchor] = useState<number | null>(null);

  // Al filtrar/buscar se descarta lo que quedó fuera de la vista: la barra en
  // lote nunca tiene que exportar o BORRAR filas que no se están viendo.
  useEffect(() => {
    setSelAnchor(null);
    setSelIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(filtered.map(rowKey));
      const next = new Set([...prev].filter((k) => visible.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  function selectRange(i: number) {
    const a = selAnchor ?? i;
    const lo = Math.min(a, i), hi = Math.max(a, i);
    setSelMode("multi");
    setSelIds(new Set(filtered.slice(lo, hi + 1).map(rowKey)));
    setSelAnchor(a);
  }
  function toggleMulti(i: number, fromCheckbox = false) {
    const k = rowKey(filtered[i]);
    setSelIds((prev) => {
      // Ctrl/⌘ clic acumula sobre lo que ya estaba elegido (incluida la fila
      // del clic simple). El checkbox no: tildar otra fila mientras se
      // inspecciona una no tiene por qué arrastrar la inspeccionada al lote.
      const next = fromCheckbox && selMode === "simple" ? new Set<string>() : new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
    setSelMode("multi");
    setSelAnchor(i);
  }
  function handleRowClick(i: number, e: React.MouseEvent) {
    if (e.shiftKey) { selectRange(i); return; }
    if (e.metaKey || e.ctrlKey) { toggleMulti(i); return; }
    setSelMode("simple");
    setSelIds(new Set([rowKey(filtered[i])]));
    setSelAnchor(i);
  }
  function handleCheck(i: number, e: React.MouseEvent) {
    if (e.shiftKey) selectRange(i);
    else toggleMulti(i, true);
  }
  function clearSelection() {
    setSelIds(new Set());
    setSelAnchor(null);
    setSelMode("simple");
  }
  const multiCount = selMode === "multi" ? selIds.size : 0;
  const allChecked = selMode === "multi" && filtered.length > 0 && selIds.size === filtered.length;
  function toggleAll() {
    if (allChecked) { clearSelection(); return; }
    setSelMode("multi");
    setSelIds(new Set(filtered.map(rowKey)));
    setSelAnchor(null);
  }
  const selectedRows = useMemo(
    () => (multiCount > 0 ? filtered.filter((r) => selIds.has(rowKey(r))) : []),
    [filtered, selIds, multiCount],
  );
  const showSelBar = selMode === "multi" && selIds.size >= 2;

  // ── Menú de clic derecho (§4.5) — reemplaza la columna de acciones ─────────
  // Sobre una fila suelta: Editar / Eliminar esa fila (y la deja seleccionada,
  // para que se vea a qué fila apunta el menú). Sobre una fila que forma parte
  // de una selección múltiple de 2+: actúa sobre toda la selección, igual que
  // la barra flotante.
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; row: Matricula; bulk: boolean } | null>(null);
  function openRowMenu(i: number, e: React.MouseEvent) {
    e.preventDefault();
    const r = filtered[i];
    const k = rowKey(r);
    const bulk = selMode === "multi" && selIds.size >= 2 && selIds.has(k);
    if (!bulk) {
      setSelMode("simple");
      setSelIds(new Set([k]));
      setSelAnchor(i);
    }
    // Que no se salga de la ventana (216px de ancho §4.5; alto aprox. del menú).
    const MENU_W = 216, MENU_H = 92;
    setRowMenu({
      x: Math.min(e.clientX, window.innerWidth - MENU_W - 8),
      y: e.clientY + MENU_H > window.innerHeight - 8 ? Math.max(8, e.clientY - MENU_H) : e.clientY,
      row: r, bulk,
    });
  }
  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    // mousedown (no click): cierra antes de que el clic llegue a otra fila.
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("wheel", close, { passive: true });
    const sc = scrollRef.current;
    sc?.addEventListener("scroll", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("wheel", close);
      sc?.removeEventListener("scroll", close);
    };
  }, [rowMenu]);

  // ── Ajuste de ancho al viewport (§4.17) ────────────────────────────────────
  // Se mide el ancho útil de la caja de scroll (sin su barra vertical): medir
  // el contenedor de afuera dejaría la tabla 10px más ancha que lo visible y
  // aparecería un scroll horizontal fantasma.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [availW, setAvailW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setAvailW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const widths = useMemo(() => {
    const w = {} as Record<ColKey, number>;
    for (const c of COLS) w[c.key] = colW[c.key] ?? NATURAL_W[c.key];
    if (colW[ABSORBER] == null) {
      const used = SEL_W + COLS.reduce((s, c) => s + w[c.key], 0);
      // Descripción absorbe TODO el sobrante, sin el tope de 2× de §4.17
      // (mismo desvío deliberado que Stock por Zona): con el tope, en una
      // pantalla ancha quedaba un hueco vacío al costado de la tabla mientras
      // la descripción —el único texto largo— se veía cortada con "…".
      w[ABSORBER] += Math.max(0, availW - used);
    }
    return w;
  }, [colW, availW]);

  const gridTemplateColumns = useMemo(
    () => `${SEL_W}px ${COLS.map((c) => `${widths[c.key]}px`).join(" ")}`,
    [widths],
  );
  const contentW = SEL_W + COLS.reduce((s, c) => s + widths[c.key], 0);

  // Borde derecho de una columna: dónde va la guía de redimensionado.
  const colRightX = (id: ColKey) => {
    let x = SEL_W;
    for (const c of COLS) { x += widths[c.key]; if (c.key === id) break; }
    return x;
  };

  function startResize(e: React.MouseEvent, id: ColKey) {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { id, startX: e.clientX, startW: widths[id] };
    setResizingCol(id);
  }

  // Doble clic: ajusta la columna a su contenido más ancho (§4.15). Mide con
  // la fuente REAL de cada celda (mono para Matrícula, sans para el resto, la
  // del badge para Tipo/Estado), y nunca por debajo de lo que pide el título.
  function autoFit(e: React.MouseEvent, id: ColKey) {
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current ?? (canvasRef.current = document.createElement("canvas"));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let fit: number;
    if (id === "tipo" || id === "estado") {
      ctx.font = sansFont(11.5, 600);
      const values = id === "tipo"
        ? ["Material", "Servicio"]
        : [...new Set(filtered.map((r) => (r.estado ?? "").trim()))];
      // + padding del chip (9+9) + borde (2) [+ ícono 12 + gap 5 en Tipo]
      fit = autoFitTextWidth(ctx, values, MIN_W) + 20 + (id === "tipo" ? 17 : 0);
    } else {
      ctx.font = id === "articulo" ? monoFont(13) : sansFont(13);
      const values = filtered.map((r) =>
        id === "articulo" ? r.articulo : id === "descripcion" ? r.descripcion ?? "" : r.unidad_medida ?? "");
      fit = autoFitTextWidth(ctx, values, MIN_W);
    }
    ctx.font = sansFont(10, 500);
    const label = COLS.find((c) => c.key === id)!.label.toUpperCase();
    // título + letter-spacing .1em + flecha de orden (12 + 6 de gap) + padding
    const labelW = Math.ceil(ctx.measureText(label).width + label.length * 1 + 18 + 24);
    const w = Math.max(fit, labelW);
    setColW((p) => ({ ...p, [id]: w }));
    if (userIdRef.current) saveTableLayout(userIdRef.current, TABLE_ID, { colW: { ...colWRef.current, [id]: w } as Record<string, number> });
  }

  // Funciones que devuelven JSX, NO componentes: un `<Resizer/>` definido
  // dentro del render sería un tipo nuevo en cada render y React remontaría
  // los handles (y perdería el doble clic) cada vez.
  const renderResizer = (id: ColKey) => {
    const active = resizingCol === id;
    return (
      <span
        onMouseDown={(e) => startResize(e, id)}
        onDoubleClick={(e) => autoFit(e, id)}
        onClick={(e) => e.stopPropagation()}
        title="Arrastrá para cambiar el ancho · doble clic para ajustar al contenido"
        className="group absolute top-0 right-[-4px] bottom-0 w-2 cursor-col-resize z-20 flex justify-center"
      >
        <span
          className={`w-[2px] h-full transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          style={{ background: "var(--ido-accent)", transitionDuration: "100ms", transitionTimingFunction: "var(--ido-ease)" }}
        />
      </span>
    );
  };

  // ── Virtualización ─────────────────────────────────────────────────────────
  const ROW_H = DENSITY_ROW_H[density];
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  });
  // react-virtual cachea el tamaño por índice: sin este remeasure, cambiar de
  // densidad no movería las filas que ya se midieron.
  useEffect(() => { virtualizer.measure(); }, [density]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Acciones ───────────────────────────────────────────────────────────────
  // Aplica el resultado de un alta/edición al estado local sin recargar todo.
  const applySaved = (saved: Matricula, mode: "create" | "edit") => {
    setRows((prev) => {
      const next = mode === "edit"
        ? prev.map((r) => (r.id === saved.id ? saved : r))
        : [...prev, saved];
      return next.sort((a, b) => COLLATOR_ES_NUM.compare(a.articulo, b.articulo));
    });
    setModal(null);
  };

  const confirmDelete = async () => {
    if (!toDelete?.id) return;
    try {
      await deleteMatricula(toDelete.id);
      setRows((prev) => prev.filter((r) => r.id !== toDelete.id));
      toast.success("Matrícula eliminada");
      setToDelete(null);
    } catch (e) {
      toast.error(`Error al eliminar: ${e instanceof Error ? e.message : "Error"}`);
    }
  };

  const confirmBulkDelete = async () => {
    const ids = selectedRows.map((r) => r.id).filter((id): id is string => !!id);
    if (ids.length === 0) return;
    try {
      await deleteMatriculasBulk(ids);
      const gone = new Set(ids);
      setRows((prev) => prev.filter((r) => !r.id || !gone.has(r.id)));
      toast.success(`${ids.length.toLocaleString("es-AR")} matrículas eliminadas`);
      setBulkDeleteOpen(false);
      clearSelection();
    } catch (e) {
      // Puede haber borrado algunas tandas antes de fallar: se recarga para
      // no mostrar filas que ya no existen.
      toast.error(`Error al eliminar: ${e instanceof Error ? e.message : "Error"}`);
      setBulkDeleteOpen(false);
      clearSelection();
      load();
    }
  };

  // Única exportación de la pantalla: la de la selección (barra flotante o
  // clic derecho). Para bajar todo lo visible se tilda el checkbox del
  // encabezado — por eso se sacó el "Exportar CSV" de la toolbar, que hacía
  // lo mismo. Si está todo el catálogo elegido, el archivo no lleva "_seleccion".
  const exportSelected = () => {
    if (selectedRows.length === 0) return;
    downloadCsv(selectedRows, selectedRows.length === rows.length ? "" : "_seleccion");
    toast.success(`${selectedRows.length.toLocaleString("es-AR")} matrículas exportadas`);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const headerLabelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 500, letterSpacing: ".1em", textTransform: "uppercase",
  };
  // Celda con texto que se trunca con "…" (§4.19: una fila, una línea).
  const textCell = (content: React.ReactNode, title: string | undefined, style?: React.CSSProperties, className = "") => (
    <div className={`flex items-center ${className}`} title={title || undefined} style={{ padding: "0 12px", overflow: "hidden", ...style }}>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{content}</span>
    </div>
  );
  const vItems = virtualizer.getVirtualItems();

  return (
    <div className="ido-terminal flex flex-col h-[calc(100vh-96px)] sm:h-[calc(100vh-112px)] min-h-[360px]">
      <div className="ido-card flex flex-col flex-1 min-h-0" style={{ position: "relative" }}>
        {/* Toolbar: filtro de tipo + buscador + vista + acciones (título y conteo viven en el header global) */}
        <div className="ido-toolbar" style={{ padding: "10px 20px" }}>
          <IdoSegmented
            options={TIPO_FILTER_OPTS}
            value={tipoFilter}
            onChange={onTipoFilter}
            layoutId="matriculas-tipo-bubble"
          />
          <div className="relative" style={{ flex: "1 1 220px", maxWidth: 420 }}>
            <Search className="w-3.5 h-3.5 absolute" style={{ left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ido-text-dim)", pointerEvents: "none" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por número o descripción…"
              className="ido-input"
              style={{ height: 32, paddingLeft: 34 }}
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap" style={{ marginLeft: "auto" }}>
            {resetMsg && (
              <span className="ido-reset-confirm">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg>
                Vista restablecida
              </span>
            )}
            <button type="button" className="ido-btn ido-btn-text" style={{ height: 32 }} onClick={resetLayout} title="Restaura el ancho de columnas y la densidad a su valor por defecto">
              Restablecer vista
            </button>
            <button type="button" className="ido-btn ido-btn-text" style={{ height: 32 }} onClick={cycleDensity} title="Altura de fila: compacta 32px · normal 40px · cómoda 52px">
              Densidad: {DENSITY_LABEL[density]}
            </button>
            <span style={{ width: 1, height: 20, background: "var(--ido-line)", margin: "0 4px" }} />
            <button type="button" className="ido-btn ido-btn-text" style={{ height: 32 }} onClick={load} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5${loading ? " animate-spin" : ""}`} />Actualizar
            </button>
            <button type="button" className="ido-btn ido-btn-primary" style={{ height: 32 }} onClick={() => setModal({ mode: "create", row: null })}>
              <Plus className="w-4 h-4" />Agregar matrícula
            </button>
          </div>
        </div>

        {/* Aviso de duplicados */}
        {duplicates.length > 0 && (
          <div className="ido-banner-warning shrink-0">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {duplicates.length} número{duplicates.length > 1 ? "s" : ""} de matrícula duplicado{duplicates.length > 1 ? "s" : ""}:{" "}
            <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
              {duplicates.slice(0, 4).join(", ")}{duplicates.length > 4 ? "…" : ""}
            </span>
          </div>
        )}

        {/* Tabla (CSS grid, §4.11). UN solo contenedor de scroll para los dos
            ejes, con el encabezado sticky adentro: si header y filas tuvieran
            cada uno su propio scroll, se desincronizarían al scrollear en X.
            Ocupa todo el alto que queda en la card, así la barra horizontal
            queda siempre a la vista al pie de la tabla. */}
        <div
          ref={scrollRef}
          className="flex-1 min-h-0"
          style={{ overflow: "auto" }}
          onClick={(e) => { if ((e.target as HTMLElement).dataset.empty) clearSelection(); }}
          data-empty="1"
        >
          {/* minWidth 100%: si Descripción no absorbe (la redimensionaste a
              mano), las filas igual llegan hasta el borde de la card. */}
          <div data-empty="1" style={{ width: contentW, minWidth: "100%", minHeight: "100%", position: "relative" }}>
            {resizingCol && (
              <>
                {/* Guía de 1px que atraviesa toda la tabla + ancho actual (§4.15) */}
                <div style={{ position: "absolute", top: 0, bottom: 0, left: colRightX(resizingCol), width: 1, background: "var(--ido-accent)", pointerEvents: "none", zIndex: 30 }} />
                <div
                  style={{
                    position: "absolute", top: HEADER_H + 6, left: colRightX(resizingCol) + 6, zIndex: 31,
                    padding: "4px 8px", borderRadius: 6, background: "var(--ido-surface-hover)", border: "1px solid var(--ido-line)",
                    fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11, color: "var(--ido-text)",
                    whiteSpace: "nowrap", pointerEvents: "none",
                  }}
                >
                  {Math.round(widths[resizingCol])} px
                </div>
              </>
            )}

            {/* Header sticky (§4.11). El fondo TIENE que ser opaco: las filas
                pasan por debajo al scrollear. */}
            <div
              className="grid"
              style={{
                gridTemplateColumns, height: HEADER_H, position: "sticky", top: 0, zIndex: 10,
                background: "var(--ido-surface)", borderBottom: "1px solid var(--ido-border-strong)",
              }}
            >
              <div className="flex items-center justify-center" style={{ position: "sticky", left: 0, zIndex: 2, background: "var(--ido-surface)" }}>
                <IdoCheckbox
                  checked={allChecked}
                  indeterminate={!allChecked && multiCount > 0}
                  onClick={toggleAll}
                  label="Seleccionar todas"
                />
              </div>
              {COLS.map((c) => {
                const active = sortKey === c.key;
                return (
                  <div
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className="relative flex items-center gap-1.5"
                    style={{
                      padding: "0 12px", cursor: "pointer", userSelect: "none", ...headerLabelStyle,
                      color: active ? "var(--ido-text)" : "var(--ido-text-dim)",
                      ...(c.key === "articulo" ? { position: "sticky", left: SEL_W, zIndex: 2, background: "var(--ido-surface)" } : null),
                    }}
                  >
                    <span className="truncate">{c.label}</span>
                    <SortArrow active={active} dir={active ? sortDir : "asc"} className="w-3 h-3 shrink-0" />
                    {renderResizer(c.key)}
                    {c.key === ABSORBER && colW[ABSORBER] == null && (
                      <span
                        title="Absorbe el sobrante"
                        style={{ position: "absolute", bottom: 0, left: 12, right: 12, height: 2, background: "var(--ido-accent)", opacity: 0.5, pointerEvents: "none" }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Cuerpo */}
            {loading ? (
              <CargandoFilas
                texto={progreso ? "Cargando filas…" : "Cargando matrículas…"}
                n={progreso?.n}
                total={progreso?.total}
                style={{ minHeight: 200 }}
              />
            ) : filtered.length === 0 ? (
              <div className="ido-loading" style={{ flexDirection: "column", gap: 10, height: 220, textAlign: "center", padding: "0 24px" }}>
                <AlertTriangle className="w-5 h-5" style={{ color: "var(--ido-warning)" }} />
                {rows.length === 0
                  ? "No hay matrículas cargadas. Cargá la planilla en «Carga de datos» o agregá una a mano."
                  : "Ninguna matrícula coincide con la búsqueda."}
              </div>
            ) : (
              <div data-empty="1" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {vItems.map((vi) => {
                  const r = filtered[vi.index];
                  const k = rowKey(r);
                  const on = selIds.has(k);
                  const checked = on && selMode === "multi";
                  const selClass = on ? (selMode === "multi" ? "ido-row-selected-multi" : "ido-row-selected") : "";
                  return (
                    <div
                      key={k}
                      onClick={(e) => handleRowClick(vi.index, e)}
                      // ⇧ clic: el navegador selecciona texto en el mousedown,
                      // antes del click — hay que cortarlo acá o el rango queda
                      // pintado de azul encima de la selección de filas.
                      onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                      onContextMenu={(e) => openRowMenu(vi.index, e)}
                      className={`ido-table-row grid ${selClass}`}
                      style={{
                        gridTemplateColumns, position: "absolute", top: 0, left: 0, width: "100%",
                        height: ROW_H, transform: `translateY(${vi.start}px)`, fontSize: 13,
                        borderBottom: "1px solid var(--ido-row-line)",
                        transition: densityAnim
                          ? "transform 200ms var(--ido-ease), height 200ms var(--ido-ease), background 120ms var(--ido-ease)"
                          : undefined,
                      }}
                    >
                      {/* Checkbox y Matrícula quedan ancladas a la izquierda
                          con scroll horizontal (§4.11). Fondo opaco por estado
                          vía `.ido-sticky-cell` (ver globals.css). boxShadow
                          inherit: si no, el fondo de esta celda taparía el borde
                          verde de fila seleccionada (un inset shadow de la fila). */}
                      <div className="ido-sticky-cell flex items-center justify-center" style={{ position: "sticky", left: 0, zIndex: 1, boxShadow: "inherit" }}>
                        <IdoCheckbox checked={checked} onClick={(e) => handleCheck(vi.index, e)} label={`Seleccionar ${r.articulo}`} />
                      </div>
                      {textCell(r.articulo, r.articulo, {
                        position: "sticky", left: SEL_W, zIndex: 1,
                        fontFamily: "var(--font-mono, ui-monospace, monospace)", fontVariantNumeric: "tabular-nums", color: "var(--ido-text)",
                      }, "ido-sticky-cell")}
                      {textCell(
                        r.descripcion || <span style={{ color: "var(--ido-text-faint)" }}>—</span>,
                        r.descripcion, { color: "var(--ido-text)" },
                      )}
                      {textCell(r.unidad_medida || "—", r.unidad_medida, { color: "var(--ido-text-dim)" })}
                      <div className="flex items-center" style={{ padding: "0 12px", overflow: "hidden" }}>
                        {tipoFromMatServ(r.mat_serv)
                          ? <TipoPill tipo={tipoFromMatServ(r.mat_serv)} />
                          : <span style={{ color: "var(--ido-text-faint)" }}>—</span>}
                      </div>
                      <div className="flex items-center" style={{ padding: "0 12px", overflow: "hidden" }}>
                        <EstadoBadge estado={r.estado} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {rowMenu && createPortal(
          <div
            className="ido-terminal ido-menu"
            style={{ left: rowMenu.x, top: rowMenu.y, width: 216 }}
            // El mousedown de adentro no tiene que llegar al listener de
            // window que cierra el menú (si no, se cierra antes del click).
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {rowMenu.bulk ? (
              <>
                <RowMenuItem icon={Download} label={`Exportar ${selIds.size.toLocaleString("es-AR")} seleccionadas`}
                  onClick={() => { setRowMenu(null); exportSelected(); }} />
                <div className="ido-menu-sep" />
                <RowMenuItem icon={Trash2} danger label={`Eliminar ${selIds.size.toLocaleString("es-AR")} seleccionadas`}
                  onClick={() => { setRowMenu(null); setBulkDeleteOpen(true); }} />
              </>
            ) : (
              <>
                <RowMenuItem icon={Pencil} label="Editar"
                  onClick={() => { const r = rowMenu.row; setRowMenu(null); setModal({ mode: "edit", row: r }); }} />
                <div className="ido-menu-sep" />
                <RowMenuItem icon={Trash2} danger label="Eliminar"
                  onClick={() => { const r = rowMenu.row; setRowMenu(null); setToDelete(r); }} />
              </>
            )}
          </div>,
          document.body,
        )}

        {/* Barra flotante de selección en lote (§4.16): aparece con 2+ filas
            en modo múltiple. "Bloquear" no aplica: el catálogo no tiene
            celdas editables que bloquear. */}
        {showSelBar && (
          <div className="ido-selbar">
            <span className="ido-selbar-count"><b>{selIds.size.toLocaleString("es-AR")}</b> seleccionadas</span>
            <span className="ido-selbar-sep" />
            <button type="button" className="ido-btn ido-btn-ghost" style={{ height: 32 }} onClick={exportSelected}>
              <Download className="w-3.5 h-3.5" /> Exportar
            </button>
            <button type="button" className="ido-btn ido-btn-danger" style={{ height: 32 }} onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 className="w-3.5 h-3.5" /> Eliminar
            </button>
            <button type="button" className="ido-selbar-close" title="Liberar selección" onClick={clearSelection}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
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
          title="Eliminar matrícula"
          confirmLabel="Eliminar"
          onClose={() => setToDelete(null)}
          onConfirm={confirmDelete}
        >
          ¿Seguro que querés eliminar la matrícula{" "}
          <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", color: "var(--ido-text)" }}>{toDelete.articulo}</span>
          {toDelete.descripcion ? <> — {toDelete.descripcion}</> : null}? Esta acción no se puede deshacer.
        </DeleteConfirm>
      )}
      {bulkDeleteOpen && (
        <DeleteConfirm
          title={`Eliminar ${selectedRows.length.toLocaleString("es-AR")} matrículas`}
          confirmLabel={`Eliminar ${selectedRows.length.toLocaleString("es-AR")}`}
          onClose={() => setBulkDeleteOpen(false)}
          onConfirm={confirmBulkDelete}
        >
          Se van a eliminar del catálogo las{" "}
          <span style={{ color: "var(--ido-text)" }}>{selectedRows.length.toLocaleString("es-AR")}</span>{" "}
          matrículas seleccionadas. Esta acción no se puede deshacer.
        </DeleteConfirm>
      )}
    </div>
  );
}
