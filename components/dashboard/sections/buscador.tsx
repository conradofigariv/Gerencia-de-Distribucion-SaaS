"use client";

import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode, type CSSProperties, type DragEvent } from "react";
import {
  Search, Loader2, X, Download, RefreshCw, Database, PackageOpen,
  ChevronDown, ChevronUp, ChevronsUpDown, Wrench, Package,
  Columns3, GripVertical, Eye, EyeOff, Pin, Plus, Trash2, Pencil, ListPlus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { buscar, reconstruirIndice, estadoIndice, type BusquedaRow } from "@/lib/busqueda";
import { getPreference, setPreference } from "@/lib/userPreferences";
import {
  fetchTabs, createTab, renameTab, deleteTab, fetchTabFilas, addFilas,
  updateFilaDatos, deleteFilas, reorderFilas,
  TRACK_KEYS, ESTADOS, type BuscadorTab, type TabFila,
} from "@/lib/buscadorTabs";
import { supabase } from "@/lib/supabaseClient";

// ─── Estilos beast pure (alineados con Stock por Zona / Tablero OP) ─────────

const CARD_BG      = "oklch(0.235 0.005 270)";
const PANEL_BG     = "oklch(0.205 0.005 270)";
const PANEL_BORDER = "1px solid oklch(1 0 0 / 0.07)";
const STICKY_BG    = "oklch(0.255 0.006 270)";

// Alto único de todos los controles de la barra, para que queden alineados.
const TOOLBAR_H = 34;

const fmtNum = (n: number | null | undefined) =>
  n == null ? "" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });

// Normaliza fechas a dd/mm/aa. Maneja dos formatos que pueden venir de la DB:
//   • ISO "YYYY-MM-DD[...]"  → parse manual (evita corrimiento UTC de new Date)
//   • Date.toString "Tue Jul 23 2024 ..." → new Date() + toLocaleDateString
const fmtFechaISO = (v: string | null | undefined) => {
  if (!v) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1].slice(2)}`;
  const d = new Date(v);
  if (!Number.isNaN(d.getTime()))
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  return v;
};

// Clave estable de una fila para fijar (Pin), igual criterio que en Stock por
// Zona. NO se puede usar `id`: es un bigserial que se borra y regenera entero
// en cada «Reconstruir índice» (DELETE + INSERT), así que cambia de valor con
// cada reconstrucción y el pin quedaría apuntando a un id que ya no existe.
// Esta clave sale de los datos de negocio, que sí son estables entre
// reconstrucciones.
const rowKey = (r: BusquedaRow) =>
  `${r.fuente}|${r.articulo_key ?? ""}|${r.numero_op ?? ""}|${r.linea ?? ""}|${r.envio ?? ""}`;

function ResizeHandle({ onStart }: { onStart: (e: MouseEvent) => void }) {
  return (
    <div
      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none group/rh"
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onStart(e.nativeEvent); }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute right-0 top-1/4 h-1/2 w-px bg-border group-hover/rh:bg-accent/60 transition-colors" />
    </div>
  );
}

// ─── Jerarquía de fuentes (para colorear los encabezados) ───────────────────
// SIC → OP → Transacciones, más el catálogo de Matrículas como eje transversal.
// El color deja ver de qué tabla sale cada columna, para poder reordenarlas
// agrupadas por jerarquía en el panel «Columnas».

type ColGroup = "sic" | "op" | "tx" | "cat";

const GROUP_META: Record<ColGroup, { label: string; color: string }> = {
  sic: { label: "SIC",          color: "#c4b5fd" },  // violeta — nivel de arriba
  op:  { label: "OP",           color: "#7dd3fc" },  // celeste — planilla OP
  tx:  { label: "Movimientos",  color: "#86efac" },  // verde — transacciones reales
  cat: { label: "Matrícula",    color: "#fcd34d" },  // ámbar — catálogo (transversal)
};

// ─── Selector de columnas (mostrar/ocultar + reordenar) ──────────────────────
// No borra datos: solo cambia qué columnas se ven y en qué orden. Persistido
// aparte de colWidths para no perder los anchos guardados al tocar esto.

interface ColMeta { key: string; label: string; group: ColGroup }

function ColumnsMenu({
  cols, order, hidden, onToggle, onReorder, onReset,
}: {
  cols:     ColMeta[];        // metadata completa (todas las columnas, sin filtrar)
  order:    string[];         // orden actual de TODAS las claves
  hidden:   Set<string>;
  onToggle: (key: string) => void;
  onReorder: (newOrder: string[]) => void;
  onReset:  () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dragKey = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const byKey = useMemo(() => new Map(cols.map((c) => [c.key, c])), [cols]);
  const orderedCols = order.map((k) => byKey.get(k)).filter((c): c is ColMeta => !!c);
  const visibleCount = order.length - hidden.size;

  const handleDrop = (e: DragEvent<HTMLDivElement>, targetKey: string) => {
    e.preventDefault();
    const from = dragKey.current;
    setDragOverKey(null);
    if (!from || from === targetKey) return;
    const newOrder = [...order];
    const fromIdx = newOrder.indexOf(from);
    const toIdx = newOrder.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) return;
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, from);
    onReorder(newOrder);
    dragKey.current = null;
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 rounded-[9px] text-[12.5px] font-medium transition-colors"
        style={{
          height: TOOLBAR_H,
          background: open ? "oklch(0.22 0.005 270)" : "oklch(0.16 0.005 270)",
          border: `1px solid ${open ? "oklch(0.55 0.20 295 / 0.5)" : "oklch(1 0 0 / 0.07)"}`,
          color: "oklch(0.75 0 0)", cursor: "pointer",
        }}
      >
        <Columns3 className="w-3.5 h-3.5" />
        Columnas
        <span style={{ color: "oklch(0.5 0 0)" }}>{visibleCount}/{order.length}</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
          style={{
            width: 270, maxHeight: 440, overflowY: "auto",
            background: "oklch(0.205 0.005 270)",
            border: "1px solid oklch(1 0 0 / 0.07)",
            borderRadius: 10,
            boxShadow: "0 14px 32px -16px rgba(0,0,0,0.6), 0 0 0 1px oklch(1 0 0 / 0.02) inset",
            padding: 6,
          }}
        >
          <div className="flex items-center justify-between px-2 pt-1 pb-1.5">
            <span className="text-[11px] uppercase tracking-wide" style={{ color: "oklch(0.55 0 0)" }}>
              Mostrar y ordenar
            </span>
            <button
              onClick={onReset}
              className="text-[11px] hover:text-foreground transition-colors"
              style={{ color: "oklch(0.55 0 0)" }}
            >
              Restablecer
            </button>
          </div>
          {/* Leyenda de colores: de qué tabla sale cada columna, para agrupar
              por jerarquía (SIC → OP → Movimientos) al arrastrar. */}
          <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 px-2 pb-2 mb-1" style={{ borderBottom: "1px solid oklch(1 0 0 / 0.06)" }}>
            {(Object.keys(GROUP_META) as ColGroup[]).map((g) => (
              <span key={g} className="inline-flex items-center gap-1" style={{ fontSize: 10.5, color: "oklch(0.55 0 0)" }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: GROUP_META[g].color, flexShrink: 0 }} />
                {GROUP_META[g].label}
              </span>
            ))}
          </div>
          {orderedCols.map((c) => {
            const isHidden = hidden.has(c.key);
            const isDragOver = dragOverKey === c.key;
            return (
              <div
                key={c.key}
                draggable
                onDragStart={(e) => {
                  dragKey.current = c.key;
                  // dataTransfer.setData es obligatorio para que el drag arranque
                  // en Firefox — sin esto, dragstart dispara pero dragover/drop
                  // nunca llegan y el arrastre queda muerto (Chrome lo tolera,
                  // por eso pasaba desapercibido).
                  e.dataTransfer.setData("text/plain", c.key);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverKey(c.key); }}
                onDragLeave={() => setDragOverKey((k) => (k === c.key ? null : k))}
                onDrop={(e) => handleDrop(e, c.key)}
                onDragEnd={() => { dragKey.current = null; setDragOverKey(null); }}
                className="flex items-center gap-2 px-2 py-1.5 rounded-[7px] cursor-grab active:cursor-grabbing select-none"
                style={{
                  opacity: isHidden ? 0.5 : 1,
                  background: isDragOver ? "oklch(0.27 0.005 270)" : "transparent",
                }}
              >
                <GripVertical className="w-3.5 h-3.5 shrink-0" style={{ color: "oklch(0.45 0 0)" }} />
                <span
                  title={GROUP_META[c.group].label}
                  style={{ width: 7, height: 7, borderRadius: 2, background: GROUP_META[c.group].color, flexShrink: 0 }}
                />
                <button
                  onClick={() => onToggle(c.key)}
                  className="shrink-0 inline-flex items-center justify-center"
                  title={isHidden ? "Mostrar columna" : "Ocultar columna"}
                >
                  {isHidden
                    ? <EyeOff className="w-3.5 h-3.5" style={{ color: "oklch(0.5 0 0)" }} />
                    : <Eye className="w-3.5 h-3.5" style={{ color: "#86efac" }} />}
                </button>
                <span className="text-[13px] truncate flex-1" style={{ color: "oklch(0.88 0 0)" }}>
                  {c.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Pill de tipo (material / servicio) — mismos colores que Stock por Zona.
function TipoPill({ tipo }: { tipo: string | null }) {
  if (!tipo) return <span style={{ color: "oklch(0.45 0 0)" }}>—</span>;
  const esServicio = tipo.toLowerCase().startsWith("s");
  const Icon = esServicio ? Wrench : Package;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap",
      background: esServicio ? "oklch(0.28 0.08 230 / 0.5)" : "oklch(0.30 0.10 155 / 0.45)",
      color:      esServicio ? "#7dd3fc" : "#86efac",
      border: `1px solid ${esServicio ? "oklch(0.70 0.10 230 / 0.45)" : "oklch(0.55 0.15 155 / 0.5)"}`,
      fontSize: 11, fontWeight: 600, letterSpacing: 0.2,
    }}>
      <Icon className="w-3 h-3" strokeWidth={2.2} />
      {esServicio ? "Servicio" : "Material"}
    </span>
  );
}

// Estado de la matrícula: activo / inactivo. No filtra nada — sirve para saber
// si la matrícula sigue vigente.
function EstadoPill({ estado }: { estado: string | null }) {
  if (!estado) return <span style={{ color: "oklch(0.45 0 0)" }}>—</span>;
  const activo = /activ/i.test(estado) && !/inactiv/i.test(estado);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap",
      background: activo ? "oklch(0.30 0.10 155 / 0.45)" : "oklch(0.25 0.005 270)",
      color:      activo ? "#86efac" : "oklch(0.6 0 0)",
      border: `1px solid ${activo ? "oklch(0.55 0.15 155 / 0.5)" : "oklch(1 0 0 / 0.08)"}`,
      fontSize: 11, fontWeight: 600, letterSpacing: 0.2,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 3, background: "currentColor" }} />
      {activo ? "Activo" : estado}
    </span>
  );
}

// ─── Columnas ────────────────────────────────────────────────────────────────

interface ColDef {
  key:     keyof BusquedaRow;
  label:   string;
  group:   ColGroup;    // de qué tabla sale — colorea el header y el panel de columnas
  num?:    boolean;
  mono?:   boolean;
  render?: (r: BusquedaRow) => ReactNode;
}

// Todas las columnas de las cuatro fuentes, agrupadas: SIC → matrícula (eje
// transversal) → compra → cantidades → fechas y estados → movimientos. Se
// muestran todas; el ancho es ajustable y la tabla scrollea en horizontal.
const COLS: ColDef[] = [
  // ── Matrícula (catálogo — eje transversal) ──
  { key: "articulo",           label: "Matrícula",    group: "cat", mono: true },
  { key: "descripcion",        label: "Descripción",  group: "cat" },
  { key: "tipo",               label: "Tipo",         group: "cat", render: (r) => <TipoPill tipo={r.tipo} /> },
  { key: "mat_serv",           label: "Mat/Serv cat.", group: "cat" },
  { key: "estado_matricula",   label: "Estado",       group: "cat", render: (r) => <EstadoPill estado={r.estado_matricula} /> },
  { key: "unidad_medida",      label: "UDM",          group: "cat" },

  // ── SIC (el nivel de arriba de la OP) ──
  { key: "numero_sic",         label: "SIC",          group: "sic", mono: true },
  { key: "sic_linea",          label: "Línea SIC",    group: "sic", mono: true },
  { key: "sic_cantidad",       label: "Cant. SIC",    group: "sic", num: true },
  { key: "sic_udm",            label: "UDM SIC",      group: "sic" },
  { key: "sic_preparador",     label: "Preparador",   group: "sic" },
  {
    // Puede venir como fecha ISO (import nuevo) o como toString() de Date
    // (import viejo); fmtFechaISO ya normaliza los dos casos.
    key: "sic_fecha_creacion", label: "F. creación SIC", group: "sic", mono: true,
    render: (r) => fmtFechaISO(r.sic_fecha_creacion),
  },

  // ── Compra (planilla OP) ──
  { key: "relacion",           label: "Relación",     group: "op", mono: true },
  { key: "numero_op",          label: "OP",           group: "op", mono: true },
  { key: "linea",              label: "Línea",        group: "op", mono: true },
  {
    // «1/2» = envío 1 de los 2 que tiene esa línea. Deja ver de una que las
    // filas hermanas son otros envíos de la MISMA línea y que por eso comparten
    // los totales de movimientos.
    key: "envio", label: "Envío", group: "op", mono: true,
    render: (r) => {
      if (!r.envio) return "";
      if (!r.envios_linea || r.envios_linea <= 1) return r.envio;
      return (
        <span>
          {r.envio}
          <span style={{ color: "oklch(0.5 0 0)" }}>/{r.envios_linea}</span>
        </span>
      );
    },
  },
  { key: "proveedor",          label: "Proveedor",    group: "op" },
  { key: "zona",               label: "Zona",         group: "op" },

  // ── Cantidades (planilla OP) ──
  { key: "cantidad",           label: "Cantidad",     group: "op", num: true },
  { key: "cantidad_recibida",  label: "Recibida",     group: "op", num: true },
  { key: "ctd_aceptada",       label: "Aceptada",     group: "op", num: true },
  {
    key: "pendiente", label: "Pendiente", group: "op", num: true,
    render: (r) => {
      if (r.pendiente == null || r.fuente === "catalogo") return "";
      const pend = Number(r.pendiente);
      return (
        <span style={{ color: pend > 0 ? "#fcd34d" : "#86efac", fontWeight: pend > 0 ? 600 : 400 }}>
          {fmtNum(pend)}
        </span>
      );
    },
  },
  {
    key: "cantidad_vencida", label: "Vencida", group: "op", num: true,
    render: (r) => {
      if (r.cantidad_vencida == null) return "";
      const v = Number(r.cantidad_vencida);
      return <span style={{ color: v > 0 ? "#fca5a5" : undefined, fontWeight: v > 0 ? 600 : 400 }}>{fmtNum(v)}</span>;
    },
  },
  { key: "cantidad_rechazada", label: "Rechazada",    group: "op", num: true },
  { key: "cantidad_facturada", label: "Facturada",    group: "op", num: true },
  { key: "cantidad_cancelada", label: "Cancelada",    group: "op", num: true },

  // ── Fechas y estados (planilla OP) ──
  // Las fechas llevan el origen en la etiqueta: hay tres «fecha de creación»
  // distintas (SIC, OP y el primer movimiento) y sin el sufijo se confunden.
  { key: "fecha_creacion",     label: "F. creación OP", group: "op", mono: true, render: (r) => fmtFechaISO(r.fecha_creacion) },
  { key: "fecha_pactada",      label: "F. pactada OP",  group: "op", mono: true, render: (r) => fmtFechaISO(r.fecha_pactada) },
  { key: "estado_autorizacion", label: "Autorización", group: "op" },
  { key: "estado_cierre",      label: "Cierre",       group: "op" },

  // ── Movimientos reales (transacciones) ──
  // Rotuladas «(mov.)» a propósito: son totales POR LÍNEA, no por envío. Si la
  // línea tiene varios envíos, todas sus filas repiten el mismo total.
  { key: "tx_recibido",     label: "Recibido (mov.)",  group: "tx", num: true },
  { key: "tx_aceptado",     label: "Aceptado (mov.)",  group: "tx", num: true },
  { key: "tx_entregado",    label: "Entregado (mov.)", group: "tx", num: true },
  {
    key: "tx_devoluciones", label: "Devoluc. (mov.)", group: "tx", num: true,
    render: (r) => {
      if (r.tx_devoluciones == null) return "";
      const v = Number(r.tx_devoluciones);
      return <span style={{ color: v > 0 ? "#fca5a5" : undefined, fontWeight: v > 0 ? 600 : 400 }}>{fmtNum(v)}</span>;
    },
  },
  { key: "tx_movimientos",  label: "N° mov.",     group: "tx", num: true },
  { key: "tx_primera_fecha", label: "F. 1er mov.",  group: "tx", mono: true, render: (r) => fmtFechaISO(r.tx_primera_fecha) },
  { key: "tx_ultima_fecha",  label: "F. últ. mov.", group: "tx", mono: true, render: (r) => fmtFechaISO(r.tx_ultima_fecha) },
];

// ─── Columnas de seguimiento (solo dentro de una pestaña) ───────────────────
// No salen del índice: las escribe el usuario. Van al final de la tabla, con
// fondo propio para que se distingan de los datos copiados.

interface TrackColDef { key: string; label: string; tipo: "texto" | "estado" | "fecha"; width: number }

const TRACK_COLS: TrackColDef[] = [
  { key: TRACK_KEYS.estado,        label: "Estado seg.",  tipo: "estado", width: 130 },
  { key: TRACK_KEYS.responsable,   label: "Responsable",  tipo: "texto",  width: 160 },
  { key: TRACK_KEYS.fechaRevision, label: "F. revisión",  tipo: "fecha",  width: 130 },
  { key: TRACK_KEYS.nota,          label: "Nota",         tipo: "texto",  width: 260 },
];

const TRACK_BG = "oklch(0.225 0.012 300)";   // tinte violeta suave

const ESTADO_STYLE: Record<string, { bg: string; fg: string; bd: string }> = {
  "Pendiente": { bg: "oklch(0.30 0.09 85 / 0.45)",  fg: "#fcd34d", bd: "oklch(0.60 0.12 85 / 0.5)" },
  "En curso":  { bg: "oklch(0.28 0.08 230 / 0.5)",  fg: "#7dd3fc", bd: "oklch(0.70 0.10 230 / 0.45)" },
  "Resuelto":  { bg: "oklch(0.30 0.10 155 / 0.45)", fg: "#86efac", bd: "oklch(0.55 0.15 155 / 0.5)" },
};

const COLWIDTHS_KEY = "buscador-colwidths";

const DEFAULT_COL_WIDTHS: Record<string, number> = {
  articulo:            120,
  descripcion:         300,
  tipo:                110,
  mat_serv:            105,
  estado_matricula:    105,
  unidad_medida:       80,
  numero_sic:          85,
  sic_linea:           85,
  sic_cantidad:        90,
  sic_udm:             85,
  sic_preparador:      150,
  sic_fecha_creacion:  135,
  relacion:            110,
  numero_op:           90,
  linea:               70,
  envio:               80,
  proveedor:           180,
  zona:                80,
  cantidad:            95,
  cantidad_recibida:   95,
  ctd_aceptada:        95,
  pendiente:           95,
  cantidad_vencida:    95,
  cantidad_rechazada:  95,
  cantidad_facturada:  95,
  cantidad_cancelada:  95,
  fecha_creacion:      135,
  fecha_pactada:       130,
  estado_autorizacion: 120,
  estado_cierre:       95,
  tx_recibido:         125,
  tx_aceptado:         125,
  tx_entregado:        130,
  tx_devoluciones:     125,
  tx_movimientos:      85,
  tx_primera_fecha:    120,
  tx_ultima_fecha:     120,
};

const COLUMNS_KEY = "buscador-columns";
const PINNED_KEY   = "buscador-pinned";
const DEFAULT_COL_ORDER = COLS.map((c) => c.key as string);
const COL_META: ColMeta[] = COLS.map((c) => ({ key: c.key as string, label: c.label, group: c.group }));

type SortDir = "asc" | "desc";

// ─── Sección ─────────────────────────────────────────────────────────────────

export function BuscadorSection() {
  const [query, setQuery]     = useState("");
  const [rows, setRows]       = useState<BusquedaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [reconstruyendo, setReconstruyendo] = useState(false);
  const [indice, setIndice]   = useState<{ filas: number; actualizado: string | null } | null>(null);

  // Un solo estado para col+dir: con dos useState separados, un click rápido
  // podía actualizar el ícono (dir) sin que el array se reordenara de nuevo
  // (o viceversa) porque quedaban desincronizados entre sí.
  // `col` es string (no keyof BusquedaRow) porque dentro de una pestaña también
  // se puede ordenar por las columnas de seguimiento, que no vienen del índice.
  const [sort, setSort] = useState<{ col: string | null; dir: SortDir }>({ col: null, dir: "asc" });
  const sortCol = sort.col;
  const sortDir = sort.dir;

  // ── Pestañas de seguimiento ──
  // activeTab = null → índice maestro (la vista de siempre).
  const [tabs, setTabs]           = useState<BuscadorTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabFilas, setTabFilas]   = useState<TabFila[]>([]);
  const [loadingTab, setLoadingTab] = useState(false);
  // Filas tildadas en el índice maestro, para copiarlas a una pestaña.
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // Celda en edición dentro de una pestaña: { filaId, key }.
  const [editing, setEditing]     = useState<{ filaId: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const dragFilaId = useRef<string | null>(null);
  const [dragOverFilaId, setDragOverFilaId] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const saveWidthsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveColsTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS);
  const colWidthsLoaded = useRef(false);
  const resizingRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);

  // Orden y visibilidad de columnas (no borra datos, solo qué se ve y en qué orden).
  const [colOrder, setColOrder]   = useState<string[]>(DEFAULT_COL_ORDER);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const colOrderLoaded = useRef(false);

  // Usuario actual (para preferencias en Supabase).
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Anchos de columna: localStorage inmediato, luego Supabase cuando hay sesión.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLWIDTHS_KEY);
      if (raw) setColWidths((c) => ({ ...c, ...JSON.parse(raw) }));
    } catch { /* ignorar */ }
    colWidthsLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!userId) return;
    getPreference<Record<string, number>>(userId, COLWIDTHS_KEY).then((saved) => {
      if (saved) setColWidths((c) => ({ ...c, ...saved }));
    });
  }, [userId]);
  useEffect(() => {
    if (!colWidthsLoaded.current) return;
    try { localStorage.setItem(COLWIDTHS_KEY, JSON.stringify(colWidths)); } catch { /* ignorar */ }
    if (!userId) return;
    if (saveWidthsTimer.current) clearTimeout(saveWidthsTimer.current);
    saveWidthsTimer.current = setTimeout(() => {
      setPreference(userId, COLWIDTHS_KEY, colWidths);
    }, 1000);
  }, [colWidths, userId]);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const { col, startX, startWidth } = resizingRef.current;
      setColWidths((p) => ({ ...p, [col]: Math.max(50, startWidth + e.clientX - startX) }));
    };
    const onUp = () => { resizingRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

  // Orden/visibilidad persistidos. Se validan contra COLS por si el set de
  // columnas cambia con el tiempo: las claves desconocidas se descartan y las
  // nuevas que no estén guardadas se agregan al final, sin perder lo elegido.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLUMNS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { order?: string[]; hidden?: string[] };
        const validKeys = new Set(DEFAULT_COL_ORDER);
        const savedOrder = (saved.order ?? []).filter((k) => validKeys.has(k));
        const missing = DEFAULT_COL_ORDER.filter((k) => !savedOrder.includes(k));
        setColOrder([...savedOrder, ...missing]);
        setHiddenCols(new Set((saved.hidden ?? []).filter((k) => validKeys.has(k))));
      }
    } catch { /* ignorar */ }
    colOrderLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!userId) return;
    getPreference<{ order?: string[]; hidden?: string[] }>(userId, COLUMNS_KEY).then((saved) => {
      if (!saved) return;
      const validKeys = new Set(DEFAULT_COL_ORDER);
      const savedOrder = (saved.order ?? []).filter((k) => validKeys.has(k));
      const missing = DEFAULT_COL_ORDER.filter((k) => !savedOrder.includes(k));
      setColOrder([...savedOrder, ...missing]);
      setHiddenCols(new Set((saved.hidden ?? []).filter((k) => validKeys.has(k))));
    });
  }, [userId]);
  useEffect(() => {
    if (!colOrderLoaded.current) return;
    const data = { order: colOrder, hidden: [...hiddenCols] };
    try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(data)); } catch { /* ignorar */ }
    if (!userId) return;
    if (saveColsTimer.current) clearTimeout(saveColsTimer.current);
    saveColsTimer.current = setTimeout(() => {
      setPreference(userId, COLUMNS_KEY, data);
    }, 1000);
  }, [colOrder, hiddenCols, userId]);

  const toggleColHidden = useCallback((key: string) => {
    setHiddenCols((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return s;
    });
  }, []);
  const resetColumnas = useCallback(() => {
    setColOrder(DEFAULT_COL_ORDER);
    setHiddenCols(new Set());
    // También los anchos: si no, un ancho viejo guardado sigue cortando la
    // etiqueta de una columna que después se renombró más larga.
    setColWidths(DEFAULT_COL_WIDTHS);
  }, []);

  // Columnas realmente visibles, en el orden elegido — todo lo que se
  // renderiza (tabla + CSV) sale de acá; COLS completo sigue existiendo para
  // el menú de columnas y no se pierde ningún dato.
  const visibleCols = useMemo(
    () => colOrder
      .filter((k) => !hiddenCols.has(k))
      .map((k) => COLS.find((c) => c.key === k))
      .filter((c): c is ColDef => !!c),
    [colOrder, hiddenCols]
  );

  // Filas fijadas arriba (misma función que en Stock por Zona). Se guarda la
  // clave estable, no el índice ni el `id` — así el pin sobrevive a cambios de
  // orden, a re-búsquedas y a reconstrucciones del índice.
  const [pinnedKeys, setPinnedKeys] = useState<string[]>([]);
  const pinnedLoaded = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINNED_KEY);
      if (raw) setPinnedKeys(JSON.parse(raw));
    } catch { /* ignorar */ }
    pinnedLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!pinnedLoaded.current) return;
    try { localStorage.setItem(PINNED_KEY, JSON.stringify(pinnedKeys)); } catch { /* ignorar */ }
  }, [pinnedKeys]);

  const togglePin = useCallback((key: string) => {
    setPinnedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);
  const unpinAll = useCallback(() => setPinnedKeys([]), []);

  // ─── Pestañas ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!userId) return;
    fetchTabs(userId)
      .then(setTabs)
      .catch((e) => toast.error(`No se pudieron cargar las pestañas: ${e.message}`));
  }, [userId]);

  // Al cambiar de pestaña se traen sus filas. El índice maestro (null) no carga nada.
  useEffect(() => {
    if (!activeTab) { setTabFilas([]); return; }
    setLoadingTab(true);
    fetchTabFilas(activeTab)
      .then(setTabFilas)
      .catch((e) => toast.error(`No se pudieron cargar las filas: ${e.message}`))
      .finally(() => setLoadingTab(false));
  }, [activeTab]);

  const handleCreateTab = useCallback(async () => {
    if (!userId) { toast.error("Iniciá sesión para crear pestañas."); return; }
    const nombre = window.prompt("Nombre de la pestaña:", "Seguimiento");
    if (!nombre?.trim()) return;
    try {
      const tab = await createTab(userId, nombre.trim(), tabs.length);
      setTabs((p) => [...p, tab]);
      setActiveTab(tab.id);
    } catch (e) {
      toast.error(`No se pudo crear: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [userId, tabs.length]);

  const handleRenameTab = useCallback(async (tab: BuscadorTab) => {
    const nombre = window.prompt("Nuevo nombre:", tab.nombre);
    if (!nombre?.trim() || nombre.trim() === tab.nombre) return;
    try {
      await renameTab(tab.id, nombre.trim());
      setTabs((p) => p.map((t) => (t.id === tab.id ? { ...t, nombre: nombre.trim() } : t)));
    } catch (e) {
      toast.error(`No se pudo renombrar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const handleDeleteTab = useCallback(async (tab: BuscadorTab) => {
    if (!window.confirm(`¿Borrar la pestaña «${tab.nombre}» y todas sus filas?`)) return;
    try {
      await deleteTab(tab.id);
      setTabs((p) => p.filter((t) => t.id !== tab.id));
      setActiveTab((cur) => (cur === tab.id ? null : cur));
      toast.success("Pestaña borrada.");
    } catch (e) {
      toast.error(`No se pudo borrar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const handleDeleteFila = useCallback(async (id: string) => {
    const backup = tabFilas;
    setTabFilas((p) => p.filter((f) => f.id !== id));   // optimista
    try {
      await deleteFilas([id]);
    } catch (e) {
      setTabFilas(backup);
      toast.error(`No se pudo borrar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [tabFilas]);

  // Guarda una celda editada. `datos` es jsonb, así que se manda el objeto
  // entero con la clave ya aplicada.
  const commitEdit = useCallback(async (filaId: string, key: string, value: string) => {
    const fila = tabFilas.find((f) => f.id === filaId);
    setEditing(null);
    if (!fila) return;
    if (String(fila.datos[key] ?? "") === value) return;   // sin cambios
    const nuevos = { ...fila.datos, [key]: value };
    setTabFilas((p) => p.map((f) => (f.id === filaId ? { ...f, datos: nuevos } : f)));
    try {
      await updateFilaDatos(filaId, nuevos);
    } catch (e) {
      setTabFilas((p) => p.map((f) => (f.id === filaId ? fila : f)));
      toast.error(`No se pudo guardar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [tabFilas]);

  const handleDropFila = useCallback(async (targetId: string) => {
    const from = dragFilaId.current;
    dragFilaId.current = null;
    setDragOverFilaId(null);
    if (!from || from === targetId) return;
    const fromIdx = tabFilas.findIndex((f) => f.id === from);
    const toIdx   = tabFilas.findIndex((f) => f.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...tabFilas];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    const renumeradas = next.map((f, i) => ({ ...f, orden: i }));
    const backup = tabFilas;
    setTabFilas(renumeradas);
    try {
      await reorderFilas(renumeradas.map((f) => ({ id: f.id, orden: f.orden })));
    } catch (e) {
      setTabFilas(backup);
      toast.error(`No se pudo reordenar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [tabFilas]);

  const cargarEstado = useCallback(() => {
    estadoIndice().then(setIndice).catch(() => setIndice(null));
  }, []);
  useEffect(() => { cargarEstado(); }, [cargarEstado]);

  // Búsqueda con debounce: dispara 300 ms después de dejar de tipear.
  // Dentro de una pestaña no se consulta el índice: el filtrado es local sobre
  // las filas ya copiadas (ver tabFilasFiltradas).
  useEffect(() => {
    if (activeTab) { setLoading(false); return; }
    const q = query.trim();
    if (!q) { setRows([]); setBuscado(false); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => {
      buscar(q)
        .then((data) => { setRows(data); setBuscado(true); })
        .catch((e) => toast.error(`Error al buscar: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query, activeTab]);

  const handleReconstruir = async () => {
    setReconstruyendo(true);
    try {
      const n = await reconstruirIndice();
      toast.success(`Índice reconstruido — ${n.toLocaleString("es-AR")} fila(s).`);
      cargarEstado();
      if (query.trim()) setQuery((q) => q); // vuelve a disparar la búsqueda
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 57014 = statement timeout. La reconstrucción es pesada; si el volumen
      // supera el límite de la API, se corre desde el SQL Editor (sin ese tope).
      if (/timeout|57014/i.test(msg)) {
        toast.error(
          "La reconstrucción superó el tiempo límite de la API. Corré «SELECT gd_reconstruir_busqueda();» desde el SQL Editor de Supabase.",
          { duration: 12000 }
        );
      } else {
        toast.error(`Error al reconstruir: ${msg}`);
      }
    } finally {
      setReconstruyendo(false);
    }
  };

  const sortedByCol = useMemo(() => {
    if (!sortCol) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = (a as unknown as Record<string, unknown>)[sortCol];
      const vb = (b as unknown as Record<string, unknown>)[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [rows, sortCol, sortDir]);

  // Filas fijadas: las que están fijadas Y presentes en la búsqueda actual, en
  // orden de fijado. Se releen desde `rows` para mostrar siempre el dato más
  // fresco (por si se reconstruyó el índice).
  const pinnedRows = useMemo(() => {
    if (!pinnedKeys.length) return [];
    const byKey = new Map(rows.map((r) => [rowKey(r), r]));
    return pinnedKeys.map((k) => byKey.get(k)).filter((r): r is BusquedaRow => !!r);
  }, [pinnedKeys, rows]);

  // Filas fijadas SIEMPRE arriba (en orden de fijado), y debajo el resto en el
  // orden elegido — misma función que en Stock por Zona.
  const sorted = useMemo(() => {
    if (!pinnedRows.length) return sortedByCol;
    const pinnedSet = new Set(pinnedRows.map(rowKey));
    const rest = sortedByCol.filter((r) => !pinnedSet.has(rowKey(r)));
    return [...pinnedRows, ...rest];
  }, [sortedByCol, pinnedRows]);

  const handleSort = useCallback((col: string) => {
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }
    );
  }, []);

  // Copia las filas tildadas del índice a una pestaña. Las que ya están (mismo
  // row_key) se saltean para no duplicar.
  const handleAddSelected = useCallback(async (tabId: string) => {
    const elegidas = sorted.filter((r) => selected.has(rowKey(r)));
    if (!elegidas.length) return;
    setAddMenuOpen(false);
    try {
      // Si la pestaña destino no es la abierta hay que traer sus filas para
      // saber qué ya tiene.
      const destinoFilas = tabId === activeTab ? tabFilas : await fetchTabFilas(tabId);
      const existentes = new Set(destinoFilas.map((f) => f.row_key));
      const nuevas = elegidas.filter((r) => !existentes.has(rowKey(r)));
      const repetidas = elegidas.length - nuevas.length;
      if (!nuevas.length) {
        toast.info("Esas filas ya están en la pestaña.");
        return;
      }
      const creadas = await addFilas(tabId, nuevas, rowKey, destinoFilas.length);
      if (tabId === activeTab) setTabFilas((p) => [...p, ...creadas]);
      setSelected(new Set());
      const destino = tabs.find((t) => t.id === tabId)?.nombre ?? "la pestaña";
      toast.success(
        `${creadas.length} fila(s) copiadas a «${destino}»` +
        (repetidas ? ` — ${repetidas} ya estaban.` : ".")
      );
    } catch (e) {
      toast.error(`No se pudieron copiar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [sorted, selected, activeTab, tabFilas, tabs]);

  // ── Filas que efectivamente se pintan ──
  // Un solo shape para los dos modos, así la tabla no se duplica: en el índice
  // maestro la data es la BusquedaRow; en una pestaña, el `datos` de la fila
  // copiada (que además trae las claves de seguimiento).
  const isTabMode = activeTab !== null;

  // Dentro de una pestaña el buscador filtra las filas que ya están copiadas,
  // no vuelve a pegarle al índice.
  const tabFilasFiltradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tabFilas;
    return tabFilas.filter((f) =>
      Object.values(f.datos).some((v) => v != null && String(v).toLowerCase().includes(q))
    );
  }, [tabFilas, query]);

  const tabFilasOrdenadas = useMemo(() => {
    if (!sortCol) return tabFilasFiltradas;      // sin sort → orden manual
    const dir = sortDir === "asc" ? 1 : -1;
    return [...tabFilasFiltradas].sort((a, b) => {
      const va = a.datos[sortCol];
      const vb = b.datos[sortCol];
      if (va == null || va === "") return 1;
      if (vb == null || vb === "") return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [tabFilasFiltradas, sortCol, sortDir]);

  const displayRows = useMemo(() => {
    if (isTabMode) {
      return tabFilasOrdenadas.map((f) => ({
        key: f.id, filaId: f.id, data: f.datos as Record<string, unknown>,
      }));
    }
    return sorted.map((r) => ({
      key: rowKey(r), filaId: undefined as string | undefined,
      data: r as unknown as Record<string, unknown>,
    }));
  }, [isTabMode, tabFilasOrdenadas, sorted]);

  // Exporta las columnas visibles, en el orden elegido (igual a lo que se ve
  // en pantalla). Las columnas ocultas no se pierden — siguen en el índice.
  const exportCSV = useCallback(() => {
    if (!displayRows.length) { toast.error("No hay datos para exportar."); return; }
    // En una pestaña se suman las columnas de seguimiento al final.
    const cols: { key: string; label: string }[] = [
      ...visibleCols.map((c) => ({ key: c.key as string, label: c.label })),
      ...(isTabMode ? TRACK_COLS.map((c) => ({ key: c.key, label: c.label })) : []),
    ];
    const head = cols.map((c) => c.label).join(";");
    const body = displayRows.map((row) =>
      cols.map((c) => {
        const v = row.data[c.key];
        const s = v == null ? "" : String(v);
        return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(";")
    ).join("\n");
    const blob = new Blob(["﻿" + head + "\n" + body], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    const nombreTab = tabs.find((t) => t.id === activeTab)?.nombre;
    a.download = isTabMode
      ? `${(nombreTab ?? "pestana").replace(/\s+/g, "-")}.csv`
      : `busqueda_${query.trim().replace(/\s+/g, "-") || "todo"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [displayRows, query, visibleCols, isTabMode, tabs, activeTab]);

  const conOp    = sorted.filter((r) => r.fuente === "op").length;
  const soloMov  = sorted.filter((r) => r.fuente === "transaccion").length;
  const soloCat  = sorted.filter((r) => r.fuente === "catalogo").length;
  const soloSic  = sorted.filter((r) => r.fuente === "sic").length;

  return (
    <div>
      {/* Card. El título de la sección ya lo pone el header general, así que
          acá va directo la barra de herramientas para que la tabla suba. */}
      <div
        className="p-2.5 overflow-hidden space-y-2"
        style={{ background: CARD_BG, border: PANEL_BORDER, borderRadius: 12 }}
      >
        {/* Barra de pestañas. El índice maestro es la vista de siempre; las
            demás son listas de seguimiento propias del usuario. */}
        <div className="flex items-center gap-1 flex-wrap" style={{ borderBottom: PANEL_BORDER, paddingBottom: 6 }}>
          <button
            onClick={() => { setActiveTab(null); setEditing(null); }}
            className="inline-flex items-center gap-1.5 px-3 rounded-[8px] text-[12.5px] font-medium transition-colors"
            style={{
              height: 30,
              background: !isTabMode ? "oklch(0.28 0.02 295)" : "transparent",
              border: `1px solid ${!isTabMode ? "oklch(0.55 0.20 295 / 0.45)" : "transparent"}`,
              color: !isTabMode ? "oklch(0.92 0 0)" : "oklch(0.6 0 0)", cursor: "pointer",
            }}
          >
            <Database className="w-3.5 h-3.5" />
            Índice maestro
          </button>

          {tabs.map((t) => {
            const act = activeTab === t.id;
            return (
              <span key={t.id} className="inline-flex items-center group/tab">
                <button
                  onClick={() => { setActiveTab(t.id); setEditing(null); setSort({ col: null, dir: "asc" }); }}
                  onDoubleClick={() => handleRenameTab(t)}
                  title="Doble click para renombrar"
                  className="inline-flex items-center gap-1.5 px-3 rounded-[8px] text-[12.5px] font-medium transition-colors"
                  style={{
                    height: 30,
                    background: act ? "oklch(0.28 0.02 295)" : "transparent",
                    border: `1px solid ${act ? "oklch(0.55 0.20 295 / 0.45)" : "transparent"}`,
                    color: act ? "oklch(0.92 0 0)" : "oklch(0.6 0 0)", cursor: "pointer",
                  }}
                >
                  {t.nombre}
                  {act && tabFilas.length > 0 && (
                    <span style={{ color: "oklch(0.55 0 0)" }}>{tabFilas.length}</span>
                  )}
                </button>
                {act && (
                  <span className="inline-flex items-center gap-0.5 ml-0.5">
                    <button
                      onClick={() => handleRenameTab(t)}
                      title="Renombrar"
                      className="grid place-items-center rounded-[5px] transition-colors"
                      style={{ width: 22, height: 22, color: "oklch(0.5 0 0)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "#c4b5fd"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "oklch(0.5 0 0)"; }}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDeleteTab(t)}
                      title="Borrar pestaña"
                      className="grid place-items-center rounded-[5px] transition-colors"
                      style={{ width: 22, height: 22, color: "oklch(0.5 0 0)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "#fca5a5"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "oklch(0.5 0 0)"; }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </span>
            );
          })}

          <button
            onClick={handleCreateTab}
            title="Nueva pestaña de seguimiento"
            className="inline-flex items-center gap-1 px-2 rounded-[8px] text-[12.5px] transition-colors"
            style={{ height: 30, background: "transparent", border: PANEL_BORDER, color: "oklch(0.6 0 0)", cursor: "pointer" }}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Barra única: búsqueda + acciones + estado del índice, todo en una
            fila para no gastar alto vertical. */}
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="flex items-center gap-2 px-3"
            style={{
              height: TOOLBAR_H, width: 220, flexShrink: 0, borderRadius: 9,
              background: "oklch(0.16 0.005 270)",
              border: `1px solid ${query ? "oklch(0.55 0.20 295 / 0.5)" : "oklch(1 0 0 / 0.07)"}`,
              boxShadow: query ? "0 0 0 3px oklch(0.55 0.20 295 / 0.12)" : "none",
              transition: "border-color .15s, box-shadow .15s",
            }}
          >
            {loading
              ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" style={{ color: "#8B5CF6" }} />
              : <Search className="w-3.5 h-3.5 shrink-0" style={{ color: "oklch(0.55 0 0)" }} />}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SIC, OP, matrícula, preparador, proveedor, zona…"
              className="flex-1 bg-transparent border-none outline-none text-[13.5px] text-foreground placeholder:text-muted-foreground/45"
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <ColumnsMenu
            cols={COL_META}
            order={colOrder}
            hidden={hiddenCols}
            onToggle={toggleColHidden}
            onReorder={setColOrder}
            onReset={resetColumnas}
          />

          {/* Copiar a pestaña — solo en el índice maestro y con filas tildadas. */}
          {!isTabMode && selected.size > 0 && (
            <div className="relative shrink-0">
              <button
                onClick={() => setAddMenuOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 rounded-[9px] text-[12.5px] font-medium transition-colors"
                style={{
                  height: TOOLBAR_H,
                  background: "oklch(0.28 0.02 295)",
                  border: "1px solid oklch(0.55 0.20 295 / 0.45)",
                  color: "oklch(0.92 0 0)", cursor: "pointer",
                }}
              >
                <ListPlus className="w-3.5 h-3.5" />
                Agregar a pestaña
                <span style={{ color: "#c4b5fd" }}>{selected.size}</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {addMenuOpen && (
                <div
                  className="absolute left-0 top-[calc(100%+6px)] z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
                  style={{
                    minWidth: 220, maxHeight: 320, overflowY: "auto",
                    background: "oklch(0.205 0.005 270)", border: PANEL_BORDER,
                    borderRadius: 10, padding: 6,
                    boxShadow: "0 14px 32px -16px rgba(0,0,0,0.6)",
                  }}
                >
                  {tabs.length === 0 ? (
                    <div className="px-2 py-2 text-[12px]" style={{ color: "oklch(0.55 0 0)" }}>
                      No tenés pestañas todavía — creá una con el «+» de arriba.
                    </div>
                  ) : tabs.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleAddSelected(t.id)}
                      className="w-full text-left px-2 py-1.5 rounded-[7px] text-[13px] transition-colors"
                      style={{ color: "oklch(0.88 0 0)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "oklch(0.27 0.005 270)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      {t.nombre}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!isTabMode && selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="inline-flex items-center gap-1.5 px-2.5 rounded-[9px] text-[12px] transition-colors"
              style={{ height: TOOLBAR_H, background: "transparent", border: PANEL_BORDER, color: "oklch(0.55 0 0)", cursor: "pointer" }}
            >
              <X className="w-3.5 h-3.5" />Quitar selección
            </button>
          )}

          <button
            onClick={exportCSV}
            disabled={!displayRows.length}
            className="inline-flex items-center gap-1.5 px-3 rounded-[9px] text-[12.5px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ height: TOOLBAR_H, background: "oklch(0.16 0.005 270)", border: PANEL_BORDER, color: "oklch(0.65 0 0)", cursor: "pointer" }}
          >
            <Download className="w-3.5 h-3.5" />CSV
          </button>

          {indice && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 rounded-[9px] text-[12px] whitespace-nowrap"
              style={{ height: TOOLBAR_H, background: "oklch(0.16 0.005 270)", border: PANEL_BORDER, color: "oklch(0.6 0 0)" }}
              title="Filas en el índice de búsqueda"
            >
              <Database className="w-3.5 h-3.5" style={{ color: "#86efac" }} />
              {indice.filas.toLocaleString("es-AR")}
            </span>
          )}

          <button
            onClick={handleReconstruir}
            disabled={reconstruyendo}
            title="Vuelve a leer Matrículas + Planilla OP + Transacciones y regenera el índice"
            className="inline-flex items-center gap-1.5 px-3 rounded-[9px] text-[12.5px] font-medium transition-colors disabled:opacity-50"
            style={{ height: TOOLBAR_H, background: "oklch(0.22 0.005 270)", border: PANEL_BORDER, color: "oklch(0.75 0 0)", cursor: "pointer" }}
          >
            {reconstruyendo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {reconstruyendo ? "Reconstruyendo…" : "Reconstruir"}
          </button>
        </div>

        {/* Contador — en una pestaña cuenta sus filas, no resultados del índice. */}
        {isTabMode && !loadingTab && tabFilas.length > 0 && (
          <p className="text-[12px] px-0.5" style={{ color: "oklch(0.55 0 0)", margin: 0 }}>
            <span className="text-foreground font-medium">{tabFilasFiltradas.length.toLocaleString("es-AR")}</span>
            {query.trim() ? ` de ${tabFilas.length} fila(s)` : " fila(s)"}
            {" · doble click en una celda para editarla · arrastrá para reordenar"}
          </p>
        )}

        {(!isTabMode && buscado && !loading) && (
          <p className="text-[12px] px-0.5 flex items-center flex-wrap gap-x-1" style={{ color: "oklch(0.55 0 0)", margin: 0 }}>
            <span>
              <span className="text-foreground font-medium">{sorted.length.toLocaleString("es-AR")}</span> resultado(s)
              {conOp > 0 && <> · {conOp.toLocaleString("es-AR")} con OP</>}
              {soloSic > 0 && <> · {soloSic.toLocaleString("es-AR")} SIC sin OP todavía</>}
              {soloMov > 0 && <> · {soloMov.toLocaleString("es-AR")} solo con movimientos (OP fuera de la planilla)</>}
              {soloCat > 0 && <> · {soloCat.toLocaleString("es-AR")} solo en catálogo</>}
              {sorted.length >= 500 && <> · mostrando los primeros 500, afiná la búsqueda</>}
            </span>
            {pinnedRows.length > 0 && (
              <span className="inline-flex items-center gap-1">
                · <Pin className="w-3 h-3" fill="#c4b5fd" strokeWidth={2} style={{ color: "#c4b5fd" }} />
                {pinnedRows.length} fijada{pinnedRows.length !== 1 ? "s" : ""}
                <button onClick={unpinAll} className="ml-0.5 underline decoration-dotted hover:text-foreground">
                  Quitar todas
                </button>
              </span>
            )}
          </p>
        )}

        {/* Resultados */}
        <div className="rounded-[10px] overflow-hidden" style={{ background: PANEL_BG, border: PANEL_BORDER }}>
          {isTabMode && loadingTab ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />Cargando pestaña…
            </div>
          ) : isTabMode && !tabFilas.length ? (
            <div className="flex flex-col items-center gap-2.5 py-14 text-sm text-muted-foreground">
              <ListPlus className="w-10 h-10 opacity-20" />
              Esta pestaña está vacía.
              <span className="text-[12px]">
                Andá a «Índice maestro», tildá las filas que quieras seguir y usá «Agregar a pestaña».
              </span>
            </div>
          ) : !isTabMode && !query.trim() ? (
            <div className="flex flex-col items-center gap-2.5 py-14 text-sm text-muted-foreground">
              <Search className="w-10 h-10 opacity-20" />
              Escribí algo para buscar en SIC, OP, Matrículas y Transacciones.
            </div>
          ) : !isTabMode && loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />Buscando…
            </div>
          ) : !isTabMode && !sorted.length ? (
            <div className="flex flex-col items-center gap-2.5 py-14 text-sm text-muted-foreground">
              <PackageOpen className="w-10 h-10 opacity-20" />
              Sin resultados para «{query.trim()}».
              {indice?.filas === 0 && <span className="text-[12px]">El índice está vacío — probá «Reconstruir índice».</span>}
            </div>
          ) : !visibleCols.length ? (
            <div className="flex flex-col items-center gap-2.5 py-14 text-sm text-muted-foreground">
              <Columns3 className="w-10 h-10 opacity-20" />
              Ocultaste todas las columnas — abrí «Columnas» para mostrar alguna.
            </div>
          ) : (
            // Alto calculado en vez de un % fijo: con la barra compacta la
            // tabla puede ocupar casi toda la ventana.
            <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 190px)" }}>
              <table style={{ tableLayout: "fixed", width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
                <colgroup>
                  {/* Columna de acciones: fija, no reordenable ni ocultable.
                      En el índice maestro lleva el check de selección y el pin;
                      dentro de una pestaña, el handle de arrastre y el borrar. */}
                  <col style={{ width: 58 }} />
                  {visibleCols.map((c) => (
                    <col key={c.key} style={{ width: colWidths[c.key] ?? DEFAULT_COL_WIDTHS[c.key] }} />
                  ))}
                  {isTabMode && TRACK_COLS.map((c) => (
                    <col key={c.key} style={{ width: c.width }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th
                      style={{
                        padding: "8px 6px",
                        position: "sticky", top: 0, zIndex: 2,
                        background: STICKY_BG,
                        borderBottom: "1px solid hsl(var(--border))",
                        textAlign: "center",
                      }}
                    >
                      {/* Tildar / destildar todo lo que está a la vista. */}
                      {!isTabMode && (
                        <input
                          type="checkbox"
                          title="Seleccionar todo"
                          checked={sorted.length > 0 && selected.size === sorted.length}
                          onChange={(e) => {
                            setSelected(e.target.checked ? new Set(sorted.map(rowKey)) : new Set());
                          }}
                          style={{ accentColor: "#8B5CF6", cursor: "pointer" }}
                        />
                      )}
                    </th>
                    {visibleCols.map((c) => {
                      const active = sortCol === c.key;
                      const SortIcon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
                      return (
                        <th
                          key={c.key}
                          onClick={() => handleSort(c.key)}
                          title={`Fuente: ${GROUP_META[c.group].label}`}
                          className="relative"
                          style={{
                            padding: "8px 12px",
                            textAlign: c.num ? "right" : "left",
                            fontSize: 12, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase",
                            color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                            cursor: "pointer", userSelect: "none",
                            position: "sticky", top: 0, zIndex: 2,
                            background: STICKY_BG,
                            borderBottom: "1px solid hsl(var(--border))",
                            // Franja de color arriba del header: de qué tabla sale la
                            // columna (SIC / OP / Movimientos / Matrícula). boxShadow
                            // inset no altera el layout, a diferencia de un borderTop.
                            boxShadow: `inset 0 2.5px 0 0 ${GROUP_META[c.group].color}`,
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%", justifyContent: c.num ? "flex-end" : "flex-start" }}>
                            <span className="truncate">{c.label}</span>
                            <SortIcon className={`w-3.5 h-3.5 shrink-0 transition-opacity ${active ? "opacity-100" : "opacity-30"}`} />
                          </span>
                          <ResizeHandle
                            onStart={(e) => {
                              resizingRef.current = { col: c.key, startX: e.clientX, startWidth: colWidths[c.key] ?? DEFAULT_COL_WIDTHS[c.key] };
                            }}
                          />
                        </th>
                      );
                    })}

                    {/* Columnas de seguimiento: no vienen del índice, las
                        escribe el usuario. Fondo propio para diferenciarlas. */}
                    {isTabMode && TRACK_COLS.map((c) => {
                      const active = sortCol === c.key;
                      const SortIcon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
                      return (
                        <th
                          key={c.key}
                          onClick={() => handleSort(c.key)}
                          title="Columna de seguimiento (editable)"
                          className="relative"
                          style={{
                            padding: "8px 12px", textAlign: "left",
                            fontSize: 12, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase",
                            color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                            cursor: "pointer", userSelect: "none",
                            position: "sticky", top: 0, zIndex: 2,
                            background: TRACK_BG,
                            borderBottom: "1px solid hsl(var(--border))",
                            boxShadow: "inset 0 2.5px 0 0 #c4b5fd",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%" }}>
                            <span className="truncate">{c.label}</span>
                            <SortIcon className={`w-3.5 h-3.5 shrink-0 transition-opacity ${active ? "opacity-100" : "opacity-30"}`} />
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row, i) => {
                    const { key, filaId, data } = row;
                    const isPinned = !isTabMode && pinnedRows.length > 0 && i < pinnedRows.length;
                    const isLastPinned = isPinned && i === pinnedRows.length - 1;
                    const isLastRow = i === displayRows.length - 1;
                    const pinnedBg = "color-mix(in oklab, var(--accent-violet) 8%, transparent)";
                    const bottomBorder = isLastPinned
                      ? "2px solid color-mix(in oklab, var(--accent-violet) 50%, transparent)"
                      : isLastRow ? "none" : "1px solid oklch(1 0 0 / 0.05)";
                    const isSel = !isTabMode && selected.has(key);
                    const isDragOver = isTabMode && dragOverFilaId === filaId;
                    const rowBg = isDragOver
                      ? "oklch(0.27 0.005 270)"
                      : isSel ? "color-mix(in oklab, var(--accent-violet) 12%, transparent)"
                      : isPinned ? pinnedBg : undefined;
                    // Dentro de una pestaña la fila es una copia editable, no
                    // tiene sentido atenuar por fuente.
                    const dim = !isTabMode && data.fuente === "catalogo";

                    return (
                      <tr
                        key={key}
                        className="transition-colors"
                        draggable={isTabMode}
                        onDragStart={isTabMode ? (e) => {
                          dragFilaId.current = filaId!;
                          e.dataTransfer.setData("text/plain", filaId!);
                          e.dataTransfer.effectAllowed = "move";
                        } : undefined}
                        onDragOver={isTabMode ? (e) => {
                          e.preventDefault(); e.dataTransfer.dropEffect = "move";
                          setDragOverFilaId(filaId!);
                        } : undefined}
                        onDragLeave={isTabMode ? () => setDragOverFilaId((k) => (k === filaId ? null : k)) : undefined}
                        onDrop={isTabMode ? (e) => { e.preventDefault(); handleDropFila(filaId!); } : undefined}
                        onDragEnd={isTabMode ? () => { dragFilaId.current = null; setDragOverFilaId(null); } : undefined}
                        style={{ opacity: dim ? 0.72 : 1, background: rowBg }}
                        onMouseEnter={(e) => { if (!rowBg) (e.currentTarget as HTMLTableRowElement).style.background = "oklch(0.25 0.005 270 / 0.5)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = rowBg ?? ""; }}
                      >
                        {/* Acciones de la fila */}
                        <td style={{ padding: "6px 4px", borderBottom: bottomBorder }}>
                          <span className="flex items-center justify-center gap-1">
                            {isTabMode ? (
                              <>
                                <span
                                  className="cursor-grab active:cursor-grabbing grid place-items-center"
                                  title="Arrastrar para reordenar"
                                  style={{ color: "oklch(0.42 0 0)" }}
                                >
                                  <GripVertical className="w-3.5 h-3.5" />
                                </span>
                                <button
                                  onClick={() => handleDeleteFila(filaId!)}
                                  title="Quitar de la pestaña"
                                  className="grid place-items-center transition-colors"
                                  style={{ width: 20, height: 20, borderRadius: 5, color: "oklch(0.42 0 0)" }}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = "#fca5a5"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = "oklch(0.42 0 0)"; }}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <input
                                  type="checkbox"
                                  checked={isSel}
                                  onChange={(e) => {
                                    setSelected((prev) => {
                                      const s = new Set(prev);
                                      if (e.target.checked) s.add(key); else s.delete(key);
                                      return s;
                                    });
                                  }}
                                  title="Seleccionar para copiar a una pestaña"
                                  style={{ accentColor: "#8B5CF6", cursor: "pointer" }}
                                />
                                <button
                                  onClick={() => togglePin(key)}
                                  title={isPinned ? "Quitar de fijadas" : "Fijar arriba"}
                                  className="grid place-items-center transition-colors"
                                  style={{
                                    width: 20, height: 20, borderRadius: 5,
                                    color: isPinned ? "#c4b5fd" : "oklch(0.42 0 0)",
                                    background: isPinned ? "color-mix(in oklab, var(--accent-violet) 20%, transparent)" : "transparent",
                                  }}
                                  onMouseEnter={(e) => { if (!isPinned) e.currentTarget.style.color = "#c4b5fd"; }}
                                  onMouseLeave={(e) => { if (!isPinned) e.currentTarget.style.color = "oklch(0.42 0 0)"; }}
                                >
                                  <Pin className="w-3.5 h-3.5" strokeWidth={2} fill={isPinned ? "#c4b5fd" : "none"} />
                                </button>
                              </>
                            )}
                          </span>
                        </td>

                        {/* Columnas del índice. En una pestaña son copias, así
                            que se editan con doble click. */}
                        {visibleCols.map((c) => {
                          const editando = isTabMode && editing?.filaId === filaId && editing?.key === c.key;
                          return (
                            <td
                              key={c.key}
                              className={cn(!editando && "truncate", c.num ? "text-right tabular-nums" : "text-left")}
                              style={{
                                padding: editando ? "2px 6px" : "7px 12px",
                                borderBottom: bottomBorder,
                                fontFamily: (c.num || c.mono) ? "ui-monospace, monospace" : undefined,
                                color: c.key === "articulo" ? "hsl(var(--foreground))" : undefined,
                                fontWeight: c.key === "articulo" ? 500 : undefined,
                                cursor: isTabMode ? "text" : undefined,
                              }}
                              title={
                                isTabMode ? "Doble click para editar"
                                  : c.key === "descripcion" ? String(data.descripcion ?? "") : undefined
                              }
                              onDoubleClick={isTabMode ? () => {
                                setEditValue(String(data[c.key] ?? ""));
                                setEditing({ filaId: filaId!, key: c.key });
                              } : undefined}
                            >
                              {editando ? (
                                <input
                                  autoFocus
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={() => commitEdit(filaId!, c.key, editValue)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") e.currentTarget.blur();
                                    if (e.key === "Escape") setEditing(null);
                                  }}
                                  className="w-full bg-transparent outline-none text-[13px]"
                                  style={{
                                    padding: "5px 6px", borderRadius: 6,
                                    border: "1px solid oklch(0.55 0.20 295 / 0.6)",
                                    background: "oklch(0.16 0.005 270)",
                                    color: "hsl(var(--foreground))",
                                    textAlign: c.num ? "right" : "left",
                                  }}
                                />
                              ) : (
                                c.render
                                  ? c.render(data as unknown as BusquedaRow)
                                  : c.num ? fmtNum(data[c.key] as number) : ((data[c.key] ?? "") as ReactNode)
                              )}
                            </td>
                          );
                        })}

                        {/* Columnas de seguimiento */}
                        {isTabMode && TRACK_COLS.map((c) => {
                          const editando = editing?.filaId === filaId && editing?.key === c.key;
                          const val = String(data[c.key] ?? "");
                          const est = c.tipo === "estado" ? ESTADO_STYLE[val] : undefined;
                          return (
                            <td
                              key={c.key}
                              className={cn(!editando && "truncate")}
                              style={{
                                padding: editando ? "2px 6px" : "7px 12px",
                                borderBottom: bottomBorder,
                                background: TRACK_BG,
                                cursor: "text",
                              }}
                              title={c.tipo === "texto" ? val : "Doble click para editar"}
                              onDoubleClick={() => {
                                setEditValue(val);
                                setEditing({ filaId: filaId!, key: c.key });
                              }}
                            >
                              {editando && c.tipo === "estado" ? (
                                <select
                                  autoFocus
                                  value={editValue}
                                  onChange={(e) => { setEditValue(e.target.value); commitEdit(filaId!, c.key, e.target.value); }}
                                  onBlur={() => setEditing(null)}
                                  className="w-full outline-none text-[13px]"
                                  style={{
                                    padding: "5px 6px", borderRadius: 6,
                                    border: "1px solid oklch(0.55 0.20 295 / 0.6)",
                                    background: "oklch(0.16 0.005 270)", color: "hsl(var(--foreground))",
                                  }}
                                >
                                  <option value="">—</option>
                                  {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
                                </select>
                              ) : editando ? (
                                <input
                                  autoFocus
                                  type={c.tipo === "fecha" ? "date" : "text"}
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={() => commitEdit(filaId!, c.key, editValue)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") e.currentTarget.blur();
                                    if (e.key === "Escape") setEditing(null);
                                  }}
                                  className="w-full bg-transparent outline-none text-[13px]"
                                  style={{
                                    padding: "5px 6px", borderRadius: 6,
                                    border: "1px solid oklch(0.55 0.20 295 / 0.6)",
                                    background: "oklch(0.16 0.005 270)", color: "hsl(var(--foreground))",
                                  }}
                                />
                              ) : est ? (
                                <span style={{
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap",
                                  background: est.bg, color: est.fg, border: `1px solid ${est.bd}`,
                                  fontSize: 11, fontWeight: 600, letterSpacing: 0.2,
                                }}>
                                  <span style={{ width: 5, height: 5, borderRadius: 3, background: "currentColor" }} />
                                  {val}
                                </span>
                              ) : c.tipo === "fecha" ? (
                                <span style={{ fontFamily: "ui-monospace, monospace" }}>{fmtFechaISO(val)}</span>
                              ) : (
                                val || <span style={{ color: "oklch(0.38 0 0)" }}>—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
