"use client";

import { useState, useEffect, useReducer, useMemo, useCallback, useRef, type ReactNode, type CSSProperties, type DragEvent } from "react";
import {
  Search, Loader2, X, Download, RefreshCw, Database, PackageOpen,
  ChevronDown, ChevronUp, ChevronsUpDown, Wrench, Package,
  Columns3, GripVertical, Eye, EyeOff, Pin,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { buscar, reconstruirIndice, estadoIndice, type BusquedaRow } from "@/lib/busqueda";
import { getPreference, setPreference } from "@/lib/userPreferences";
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

// Fecha ISO "YYYY-MM-DD" → dd/mm/aa. Se parsea a mano para evitar el
// corrimiento de zona horaria que mete new Date("YYYY-MM-DD") (lo toma UTC).
const fmtFechaISO = (iso: string | null | undefined) => {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
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
    // (import viejo) — se muestra normalizada en los dos casos.
    key: "sic_fecha_creacion", label: "F. SIC", group: "sic", mono: true,
    render: (r) => {
      if (!r.sic_fecha_creacion) return "";
      const iso = /^\d{4}-\d{2}-\d{2}/.exec(r.sic_fecha_creacion);
      if (iso) return fmtFechaISO(r.sic_fecha_creacion);
      const d = new Date(r.sic_fecha_creacion);
      return Number.isNaN(d.getTime())
        ? r.sic_fecha_creacion
        : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
    },
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
  { key: "fecha_creacion",     label: "F. creación",  group: "op", mono: true, render: (r) => fmtFechaISO(r.fecha_creacion) },
  { key: "fecha_pactada",      label: "F. pactada",   group: "op", mono: true, render: (r) => fmtFechaISO(r.fecha_pactada) },
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
  { key: "tx_primera_fecha", label: "1er mov.",   group: "tx", mono: true, render: (r) => fmtFechaISO(r.tx_primera_fecha) },
  { key: "tx_ultima_fecha",  label: "Últ. mov.",  group: "tx", mono: true, render: (r) => fmtFechaISO(r.tx_ultima_fecha) },
];

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
  sic_fecha_creacion:  95,
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
  fecha_creacion:      110,
  fecha_pactada:       110,
  estado_autorizacion: 120,
  estado_cierre:       95,
  tx_recibido:         125,
  tx_aceptado:         125,
  tx_entregado:        130,
  tx_devoluciones:     125,
  tx_movimientos:      85,
  tx_primera_fecha:    95,
  tx_ultima_fecha:     95,
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

  type SortState = { col: keyof BusquedaRow | null; dir: SortDir };
  const [sortState, dispatchSort] = useReducer(
    (s: SortState, col: keyof BusquedaRow): SortState => ({
      col,
      dir: s.col === col ? (s.dir === "asc" ? "desc" : "asc") : "asc",
    }),
    { col: null, dir: "asc" }
  );
  const sortCol = sortState.col;
  const sortDir = sortState.dir;

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

  const cargarEstado = useCallback(() => {
    estadoIndice().then(setIndice).catch(() => setIndice(null));
  }, []);
  useEffect(() => { cargarEstado(); }, [cargarEstado]);

  // Búsqueda con debounce: dispara 300 ms después de dejar de tipear.
  useEffect(() => {
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
  }, [query]);

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
      const va = a[sortCol];
      const vb = b[sortCol];
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

  const handleSort = useCallback((col: keyof BusquedaRow) => dispatchSort(col), []);

  // Exporta las columnas visibles, en el orden elegido (igual a lo que se ve
  // en pantalla). Las columnas ocultas no se pierden — siguen en el índice.
  const exportCSV = useCallback(() => {
    if (!sorted.length) { toast.error("No hay datos para exportar."); return; }
    const head = visibleCols.map((c) => c.label).join(";");
    const body = sorted.map((r) =>
      visibleCols.map((c) => {
        const v = r[c.key];
        const s = v == null ? "" : String(v);
        return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(";")
    ).join("\n");
    const blob = new Blob(["﻿" + head + "\n" + body], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `busqueda_${query.trim().replace(/\s+/g, "-") || "todo"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sorted, query, visibleCols]);

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

          <button
            onClick={exportCSV}
            disabled={!sorted.length}
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

        {/* Contador */}
        {(buscado && !loading) && (
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
          {!query.trim() ? (
            <div className="flex flex-col items-center gap-2.5 py-14 text-sm text-muted-foreground">
              <Search className="w-10 h-10 opacity-20" />
              Escribí algo para buscar en SIC, OP, Matrículas y Transacciones.
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />Buscando…
            </div>
          ) : !sorted.length ? (
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
                  {/* Columna de fijado: fija, no reordenable ni ocultable — se
                      mantiene igual que en Stock por Zona (icono a la izquierda). */}
                  <col style={{ width: 30 }} />
                  {visibleCols.map((c) => (
                    <col key={c.key} style={{ width: colWidths[c.key] ?? DEFAULT_COL_WIDTHS[c.key] }} />
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
                      }}
                    />
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
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => {
                    const key = rowKey(r);
                    const isPinned = pinnedRows.length > 0 && i < pinnedRows.length;
                    const isLastPinned = isPinned && i === pinnedRows.length - 1;
                    const isLastRow = i === sorted.length - 1;
                    const pinnedBg = "color-mix(in oklab, var(--accent-violet) 8%, transparent)";
                    const bottomBorder = isLastPinned
                      ? "2px solid color-mix(in oklab, var(--accent-violet) 50%, transparent)"
                      : isLastRow ? "none" : "1px solid oklch(1 0 0 / 0.05)";
                    return (
                      <tr
                        key={key}
                        className="transition-colors"
                        // Las filas que son solo catálogo (matrícula nunca pedida) van
                        // atenuadas; las fijadas llevan un tinte violeta de fondo.
                        style={{
                          opacity: r.fuente === "catalogo" ? 0.72 : 1,
                          background: isPinned ? pinnedBg : undefined,
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "oklch(0.25 0.005 270 / 0.5)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = isPinned ? pinnedBg : ""; }}
                      >
                        <td style={{ padding: "6px", borderBottom: bottomBorder, textAlign: "center" }}>
                          <button
                            onClick={() => togglePin(key)}
                            title={isPinned ? "Quitar de fijadas" : "Fijar arriba"}
                            className="grid place-items-center transition-colors"
                            style={{
                              width: 20, height: 20, borderRadius: 5, margin: "0 auto",
                              color: isPinned ? "#c4b5fd" : "oklch(0.45 0 0)",
                              background: isPinned ? "color-mix(in oklab, var(--accent-violet) 20%, transparent)" : "transparent",
                            }}
                            onMouseEnter={(e) => { if (!isPinned) (e.currentTarget as HTMLButtonElement).style.color = "#c4b5fd"; }}
                            onMouseLeave={(e) => { if (!isPinned) (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.45 0 0)"; }}
                          >
                            <Pin className="w-3.5 h-3.5" strokeWidth={2} fill={isPinned ? "#c4b5fd" : "none"} />
                          </button>
                        </td>
                        {visibleCols.map((c) => (
                          <td
                            key={c.key}
                            className={cn("truncate", c.num ? "text-right tabular-nums" : "text-left")}
                            style={{
                              padding: "7px 12px",
                              borderBottom: bottomBorder,
                              fontFamily: (c.num || c.mono) ? "ui-monospace, monospace" : undefined,
                              color: c.key === "articulo" ? "hsl(var(--foreground))" : undefined,
                              fontWeight: c.key === "articulo" ? 500 : undefined,
                            }}
                            title={c.key === "descripcion" ? (r.descripcion ?? "") : undefined}
                          >
                            {c.render ? c.render(r) : c.num ? fmtNum(r[c.key] as number) : ((r[c.key] ?? "") as ReactNode)}
                          </td>
                        ))}
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
