"use client";

import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, Fragment, memo, type ReactNode, type ElementType, type CSSProperties, type DragEvent } from "react";
import { motion } from "motion/react";
import { createPortal } from "react-dom";
import {
  Search, Loader2, X, Download, RefreshCw, Database, PackageOpen,
  ChevronDown, ChevronUp, ChevronsUpDown, Wrench, Package,
  Columns3, GripVertical, Pin, Plus, Trash2, Pencil, ListPlus,
  ChevronRight, Rows3, Tag, FileText, Share2, Users, Lock, UserMinus, UserPlus,
  Copy, Check, CalendarClock,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  buscar, reconstruirIndice, estadoIndice, rowKey, fechaMs, fmtFechaISO,
  ORDENABLES_SERVIDOR, CAMPOS_FECHA,
  type BusquedaRow, type CampoBusqueda, type CampoFecha,
} from "@/lib/busqueda";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { getPreference, setPreference } from "@/lib/userPreferences";
import {
  fetchOpDatos, upsertOpDato, aplicarOpDatos, normOp, OP_MANUAL_COLS, type OpDato,
} from "@/lib/opDatos";
import {
  fetchTabs, createTab, renameTab, deleteTab, fetchTabFilas, addFilas, siguienteOrden,
  updateFilaDatos, deleteFilas, reorderFilas, updateTabConfig, marcarEnTarjeta,
  fetchMisPermisos, fetchColaboradores, compartirTab, descompartirTab, fetchEquipo,
  TRACK_KEYS, ESTADOS,
  type BuscadorTab, type TabFila, type TabConfig, type AgruparPor,
  type Permiso, type Colaborador, type PerfilBasico,
} from "@/lib/buscadorTabs";
import { getStockZonaMap } from "@/lib/stockStorage";
import { supabase } from "@/lib/supabaseClient";
import {
  IdoCheckbox, SortArrow, TipoPill as IdoTipoPill, monoFont, sansFont, autoFitTextWidth,
  type Density, DENSITY_ROW_H, DENSITY_LABEL, DENSITY_ORDER, isDensity, useIdoDialogs, CargandoFilas,
} from "@/components/dashboard/ido-kit";
import { loadTableLayout, saveTableLayout } from "@/lib/tableLayout";
import { useVirtualizer } from "@tanstack/react-virtual";

// ─── Sistema de diseño IDO (design-system.md) ────────────────────────────────
// Tokens --ido-*: solo existen debajo de `.ido-terminal`. La sección entera va
// adentro de esa clase, y lo que se portalea a <body> (menú contextual, modal
// Compartir) la vuelve a aplicar.

const CARD_BG      = "var(--ido-surface)";
const PANEL_BG     = "var(--ido-base)";
const PANEL_BORDER = "1px solid var(--ido-border)";
const STICKY_BG    = "var(--ido-surface)";

// Alto único de los controles de la barra (§4.2 / §4.8: 38px).
const TOOLBAR_H = 38;

const fmtNum = (n: number | null | undefined) =>
  n == null ? "" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });

// Columnas que guardan una FECHA como texto. Ordenarlas comparando el string
// da mal por el mismo motivo que en SQL (ver gd_parse_fecha): conviven el
// formato ISO y el `Date.toString()` de los imports viejos, y alfabéticamente
// el segundo se ordena por el nombre del día. Hay que parsear antes de comparar.
const DATE_COLS = new Set<string>([
  "sic_fecha_creacion", "fecha_creacion", "fecha_pactada",
  "tx_primera_fecha", "tx_ultima_fecha", TRACK_KEYS.fechaRevision,
]);

/** Comparador de una columna, sabiendo si es fecha, número o texto. */
const compararValores = (va: unknown, vb: unknown, col: string, dir: number): number => {
  if (DATE_COLS.has(col)) {
    const a = fechaMs(va), b = fechaMs(vb);
    const na = Number.isNaN(a), nb = Number.isNaN(b);
    if (na && nb) return 0;
    if (na) return 1;          // sin fecha, siempre al final
    if (nb) return -1;
    return (a - b) * dir;
  }
  if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
  return String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" }) * dir;
};

// `rowKey` vive en lib/busqueda.ts: la comparten esta sección y el volcado de
// familias desde Matrículas, y tienen que generar exactamente la misma clave
// para que la detección de duplicados funcione.

// ─── Selector de fecha (Popover + Calendar de shadcn) ───────────────────────
// Reemplaza al <input type="date"> nativo, que abre el calendario del sistema
// operativo: sin animación, sin tema oscuro y distinto en cada navegador. Este
// hereda el tema y las animaciones de entrada/salida del Popover.
//
// El valor sigue siendo el string ISO "YYYY-MM-DD" que espera la RPC. Se
// convierte a Date sólo para pintar el calendario, y se arma a mano con las
// partes locales al volver: `toISOString()` pasa por UTC y en Argentina (UTC-3)
// devuelve el día ANTERIOR para cualquier fecha elegida.
function DatePicker({
  valor, onChange, placeholder,
}: { valor: string; onChange: (v: string) => void; placeholder: string }) {
  const [abierto, setAbierto] = useState(false);
  const fecha = valor ? new Date(`${valor}T00:00:00`) : undefined;

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-left px-1.5 rounded transition-colors hover:bg-white/5 outline-none"
          style={{
            color: valor ? "var(--ido-text)" : "var(--ido-placeholder)", width: 92, height: 26,
            fontSize: valor ? 12 : 13,
            fontFamily: valor ? "var(--font-mono, ui-monospace, monospace)" : undefined,
          }}
        >
          {valor ? fmtFechaISO(valor) : placeholder}
        </button>
      </PopoverTrigger>
      {/* `.ido-cal` remapea los colores del Calendar de shadcn a los tokens IDO. */}
      <PopoverContent align="start" className="ido-terminal ido-pop ido-cal w-auto p-0 border-0">
        <Calendar
          mode="single"
          selected={fecha}
          defaultMonth={fecha}
          captionLayout="dropdown"
          onSelect={(d) => {
            if (!d) { onChange(""); return; }
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            onChange(`${d.getFullYear()}-${mm}-${dd}`);
            setAbierto(false);
          }}
        />
        {valor && (
          <div className="p-2 pt-0">
            <button
              type="button"
              onClick={() => { onChange(""); setAbierto(false); }}
              className="ido-btn ido-btn-text w-full justify-center"
              style={{ height: 30, fontSize: 12 }}
            >
              Limpiar
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Jerarquía de fuentes (para colorear los encabezados) ───────────────────
// SIC → OP → Transacciones, más el catálogo de Matrículas como eje transversal.
// El color deja ver de qué tabla sale cada columna, para poder reordenarlas
// agrupadas por jerarquía en el panel «Columnas».

type ColGroup = "sic" | "op" | "tx" | "cat" | "track";

// Paleta categórica del sistema (§1): colores de IDENTIDAD, nunca el verde de
// acento — por eso Movimientos dejó de ser verde y pasó a celeste.
const GROUP_META: Record<ColGroup, { label: string; color: string }> = {
  sic:   { label: "SIC",            color: "var(--ido-cat-2)" },  // violeta — nivel de arriba
  op:    { label: "OP",             color: "var(--ido-cat-1)" },  // azul — planilla OP
  tx:    { label: "Movimientos",    color: "var(--ido-cat-3)" },  // celeste — transacciones reales
  cat:   { label: "Matrícula",      color: "var(--ido-cat-4)" },  // ámbar — catálogo (transversal)
  // Las únicas que NO salen de ninguna tabla del índice: las escribe el usuario
  // sobre la fila copiada. Color propio (rosa) para que se lean de un vistazo
  // como "esto lo puse yo", no como un dato importado.
  track: { label: "Personalizadas", color: "var(--ido-cat-5)" },
};

// ─── Selector de columnas (mostrar/ocultar + reordenar) ──────────────────────
// No borra datos: solo cambia qué columnas se ven y en qué orden. Persistido
// aparte de colWidths para no perder los anchos guardados al tocar esto.

interface ColMeta { key: string; label: string; group: ColGroup }

function ColumnsMenu({
  cols, order, hidden, onToggle, onReorder, onReset, locked,
}: {
  cols:     ColMeta[];        // metadata completa (todas las columnas, sin filtrar)
  order:    string[];         // orden actual de TODAS las claves
  hidden:   Set<string>;
  onToggle: (key: string) => void;
  onReorder: (newOrder: string[]) => void;
  onReset:  () => void;
  // Pestaña compartida de solo lectura: se puede ABRIR el menú para ver qué
  // columnas hay, pero no tocar nada — es una vista única para todos, no una
  // preferencia personal, así que un lector no puede cambiarla.
  locked?:  boolean;
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
  // Las visibles primero, las ocultas al fondo — mismo criterio que aplica
  // toggleColHidden sobre el `order` real al ocultar una columna. Queda acá
  // TAMBIÉN por las «Personalizadas»: esas nunca pasan por toggleColHidden
  // (no están en `cols` del índice maestro), así que si alguna quedara oculta
  // en el medio del orden persistido, este sort igual la manda al fondo acá.
  const orderedCols = order
    .map((k) => byKey.get(k))
    .filter((c): c is ColMeta => !!c)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => Number(hidden.has(a.c.key)) - Number(hidden.has(b.c.key)) || a.i - b.i)
    .map(({ c }) => c);
  // Se cuenta sobre `orderedCols`, no sobre `order`: en el índice maestro el
  // orden persistido incluye las Personalizadas, que acá no se ofrecen.
  const visibleCount = orderedCols.filter((c) => !hidden.has(c.key)).length;

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

  // Menú de columnas (§4.10): botón secundario con badge N/total y un panel
  // de 216–270px con checkbox propio por columna (off: borde 16%; on: verde).
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ido-btn ido-btn-ghost"
        style={{ height: TOOLBAR_H }}
      >
        <Columns3 className="w-3.5 h-3.5" />
        Columnas
        <span className="ido-mono" style={{ color: "var(--ido-text-2)" }}>{visibleCount}/{orderedCols.length}</span>
      </button>

      {open && (
        <div
          className="ido-pop absolute right-0 top-[calc(100%+6px)] z-50"
          style={{ width: 270, maxHeight: 440, overflowY: "auto" }}
        >
          <div className="flex items-center justify-between">
            <span className="ido-pop-label">{locked ? "Solo lectura" : "Mostrar y ordenar"}</span>
            {!locked && (
              <button type="button" onClick={onReset} className="ido-btn ido-btn-text" style={{ height: 24, fontSize: 11 }}>
                Restablecer
              </button>
            )}
          </div>
          {/* Leyenda de colores: de qué tabla sale cada columna, para agrupar
              por jerarquía (SIC → OP → Movimientos) al arrastrar. */}
          <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 px-2.5 pb-2 mb-1" style={{ borderBottom: "1px solid var(--ido-border)" }}>
            {(Object.keys(GROUP_META) as ColGroup[]).map((g) => (
              <span key={g} className="inline-flex items-center gap-1" style={{ fontSize: 10.5, color: "var(--ido-text-2)" }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: GROUP_META[g].color, flexShrink: 0 }} />
                {GROUP_META[g].label}
              </span>
            ))}
          </div>
          {orderedCols.map((c, idx) => {
            const isHidden = hidden.has(c.key);
            const isDragOver = dragOverKey === c.key;
            // Encabezado «Ocultas» delante de la primera oculta: sin un corte
            // visible, la lista ordenada parecía simplemente desordenada y no
            // se entendía por qué una columna se había movido de lugar.
            const abreOcultas = isHidden && (idx === 0 || !hidden.has(orderedCols[idx - 1].key));
            return (
              <Fragment key={`w-${c.key}`}>
              {abreOcultas && (
                <div className="ido-pop-label" style={{ borderTop: "1px solid var(--ido-border)", marginTop: 4 }}>
                  Ocultas
                </div>
              )}
              <div
                key={c.key}
                draggable={!locked}
                onDragStart={locked ? undefined : (e) => {
                  dragKey.current = c.key;
                  // dataTransfer.setData es obligatorio para que el drag arranque
                  // en Firefox — sin esto, dragstart dispara pero dragover/drop
                  // nunca llegan y el arrastre queda muerto (Chrome lo tolera,
                  // por eso pasaba desapercibido).
                  e.dataTransfer.setData("text/plain", c.key);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={locked ? undefined : (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverKey(c.key); }}
                onDragLeave={locked ? undefined : () => setDragOverKey((k) => (k === c.key ? null : k))}
                onDrop={locked ? undefined : (e) => handleDrop(e, c.key)}
                onDragEnd={locked ? undefined : () => { dragKey.current = null; setDragOverKey(null); }}
                className={cn("ido-pop-item select-none", !locked && "cursor-grab active:cursor-grabbing")}
                style={{ background: isDragOver ? "rgba(255,255,255,.06)" : undefined, cursor: locked ? "default" : undefined }}
              >
                <GripVertical className="w-3.5 h-3.5" style={{ opacity: locked ? 0.35 : 1 }} />
                <IdoCheckbox
                  checked={!isHidden}
                  onClick={() => onToggle(c.key)}
                  disabled={locked}
                  label={isHidden ? `Mostrar ${c.label}` : `Ocultar ${c.label}`}
                />
                <span
                  title={GROUP_META[c.group].label}
                  style={{ width: 7, height: 7, borderRadius: 2, background: GROUP_META[c.group].color, flexShrink: 0 }}
                />
                <span className="truncate flex-1" style={{ color: isHidden ? "var(--ido-text-2)" : "var(--ido-text)" }}>
                  {c.label}
                </span>
              </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Pill de tipo (material / servicio) — la misma de Stock por Zona y Matrículas.
function TipoPill({ tipo }: { tipo: string | null }) {
  if (!tipo) return <span style={{ color: "var(--ido-text-faint)" }}>—</span>;
  return <IdoTipoPill tipo={tipo.toLowerCase().startsWith("s") ? "servicio" : "material"} />;
}

// Estado de la matrícula: «Activo» = badge de estado del sistema (§4.3); el
// resto (Inactivo, etc.) = chip neutro. No filtra nada — sirve para saber si
// la matrícula sigue vigente.
function EstadoPill({ estado }: { estado: string | null }) {
  if (!estado) return <span style={{ color: "var(--ido-text-faint)" }}>—</span>;
  const activo = /activ/i.test(estado) && !/inactiv/i.test(estado);
  return (
    <span className={`ido-chip ${activo ? "ido-badge-ok" : "ido-badge-neutral"}`}>
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
  { key: "sic_precio",         label: "Precio SIC",   group: "sic", num: true },
  { key: "sic_importe",        label: "Importe SIC",  group: "sic", num: true },
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
          <span style={{ color: "var(--ido-text-2)" }}>/{r.envios_linea}</span>
        </span>
      );
    },
  },
  { key: "proveedor",          label: "Proveedor",    group: "op" },
  // Las dos siguientes se cargan A MANO (op_datos), no vienen de la planilla:
  // son datos de la OP entera, no de la fila. Ver lib/opDatos.ts.
  { key: "op_descripcion",     label: "Descripción OP", group: "op" },
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
        <span style={{ color: pend > 0 ? "var(--ido-warning)" : "var(--ido-accent)", fontWeight: pend > 0 ? 600 : 400 }}>
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
      return <span style={{ color: v > 0 ? "var(--ido-error)" : undefined, fontWeight: v > 0 ? 600 : 400 }}>{fmtNum(v)}</span>;
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
      return <span style={{ color: v > 0 ? "var(--ido-error)" : undefined, fontWeight: v > 0 ? 600 : 400 }}>{fmtNum(v)}</span>;
    },
  },
  { key: "tx_movimientos",  label: "N° mov.",     group: "tx", num: true },
  { key: "tx_primera_fecha", label: "F. 1er mov.",  group: "tx", mono: true, render: (r) => fmtFechaISO(r.tx_primera_fecha) },
  { key: "tx_ultima_fecha",  label: "F. últ. mov.", group: "tx", mono: true, render: (r) => fmtFechaISO(r.tx_ultima_fecha) },

  // ── Stock (Stock por Zona) ──
  // Va en el grupo de matrícula y no en el de OP a propósito: es el stock de
  // la MATRÍCULA en ZA, no de esta OP ni de este envío. Se repite igual en
  // todas las filas que compartan matrícula — no se puede sumar la columna.
  { key: "stock_za", label: "Stock ZA", group: "cat", num: true },
];

// ─── Columnas de seguimiento (solo dentro de una pestaña) ───────────────────
// No salen del índice: las escribe el usuario. Van al final de la tabla, con
// fondo propio para que se distingan de los datos copiados.

interface TrackColDef { key: string; label: string; tipo: "texto" | "estado" | "fecha"; width: number }

// `_en_tarjeta` NO va acá: no es un dato que se lea de la fila sino una marca,
// y como tal se opera seleccionando filas y usando el menú contextual («Enviar
// a Tarjeta»), no tildando una celda columna por columna.
//
// ⚠ Estas columnas NO son arrastrables (no hay drag & drop entre ellas ni con
// las del índice): siempre se renderizan al final de la tabla, en ESTE orden
// fijo. "Nota" va primera del grupo a propósito — es la que más se usa como
// descripción corta y la idea es que quede lo más cerca posible de los datos
// del índice, sin tener que scrollear hasta el final para verla.
const TRACK_COLS: TrackColDef[] = [
  { key: TRACK_KEYS.nota,          label: "Nota",         tipo: "texto",  width: 260 },
  { key: TRACK_KEYS.estado,        label: "Estado seg.",  tipo: "estado", width: 130 },
  { key: TRACK_KEYS.responsable,   label: "Responsable",  tipo: "texto",  width: 160 },
  { key: TRACK_KEYS.fechaRevision, label: "F. revisión",  tipo: "fecha",  width: 130 },
];

// ─── Editor de celda (§4.4) ─────────────────────────────────────────────────
// Guarda su propio valor mientras se tipea: cuando vivía en la sección (más de
// 3000 líneas), cada tecla re-renderizaba la tabla entera.
// Enter o salir del campo guarda; Esc cancela — y NO guarda aunque el
// navegador dispare `blur` al sacar el campo del DOM (Chrome lo hace).
function CeldaEditor({
  inicial, tipo = "texto", alinear = "left", onGuardar, onCancelar,
}: {
  inicial: string;
  tipo?: "texto" | "fecha" | "estado";
  alinear?: "left" | "right";
  onGuardar: (valor: string) => void;
  onCancelar: () => void;
}) {
  const [valor, setValor] = useState(inicial);
  const cerrado = useRef(false);
  const cancelar = () => { cerrado.current = true; onCancelar(); };

  if (tipo === "estado") {
    return (
      <select
        autoFocus
        onClick={(e) => e.stopPropagation()}
        value={valor}
        onChange={(e) => { cerrado.current = true; setValor(e.target.value); onGuardar(e.target.value); }}
        onBlur={() => { if (!cerrado.current) cancelar(); }}
        onKeyDown={(e) => { if (e.key === "Escape") cancelar(); }}
        className="ido-cell-edit"
      >
        <option value="">—</option>
        {ESTADOS.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    );
  }
  return (
    <input
      autoFocus
      onClick={(e) => e.stopPropagation()}
      type={tipo === "fecha" ? "date" : "text"}
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      onBlur={() => { if (!cerrado.current) { cerrado.current = true; onGuardar(valor); } }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") cancelar();
      }}
      className="ido-cell-edit"
      style={{ textAlign: alinear }}
    />
  );
}

// ─── Valor de celda para exportar / copiar ──────────────────────────────────
// Lo mismo que se ve en pantalla, pero con tipos que Excel entiende: las fechas
// como fecha de verdad (antes salían como texto crudo y mezclado — "2024-07-23"
// en unas filas, "Tue Jul 23 2024 …" en otras — y no se podían ordenar ni
// filtrar), los números como número y el envío como «1/2».
const COLS_FECHA = new Set<string>([
  ...COLS.filter((c) => /fecha/.test(c.key as string)).map((c) => c.key as string),
  ...TRACK_COLS.filter((c) => c.tipo === "fecha").map((c) => c.key),
]);
const COLS_NUM = new Set<string>(COLS.filter((c) => c.num).map((c) => c.key as string));

/** Fecha a medianoche LOCAL (Excel no tiene zona horaria: así cae en el día que se ve). */
function fechaLocal(v: unknown): Date | null {
  const s = String(v);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function valorExportable(key: string, f: Record<string, unknown>): string | number | Date {
  const v = f[key];
  if (v == null || v === "") return "";
  if (COLS_FECHA.has(key)) return fechaLocal(v) ?? String(v);
  if (key === "envio") {
    const total = Number(f.envios_linea);
    return total > 1 ? `${v}/${total}` : String(v);
  }
  if (key === "tipo") return /^s/i.test(String(v)) ? "Servicio" : "Material";
  if (COLS_NUM.has(key)) {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : String(v);
  }
  return String(v);
}

/** Igual que `valorExportable`, como texto para el portapapeles (pegar en Excel es-AR). */
function valorCopiable(key: string, f: Record<string, unknown>): string {
  const v = valorExportable(key, f);
  if (v instanceof Date) return v.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  if (typeof v === "number") return String(v).replace(".", ",");
  return v.replace(/[\t\r\n]+/g, " ");
}

// ─── Agrupado de pestañas ────────────────────────────────────────────────────
// Una pestaña puede agruparse por distintos ejes de la jerarquía del dominio
// (SIC → OP → línea → envío, con la matrícula como eje transversal). Cada uno
// vive en una columna distinta del `datos` copiado. El tipo vive en
// lib/buscadorTabs.ts porque se guarda en buscador_tabs.config.

const AGRUPAR_OPTIONS: { value: AgruparPor; label: string; icon: ElementType }[] = [
  { value: "articulo",   label: "Matrícula", icon: Tag },
  { value: "numero_sic", label: "SIC",       icon: FileText },
  { value: "numero_op",  label: "OP",        icon: Package },
];

/** Opciones del selector de campo, al lado de la caja de búsqueda. Sin elegir
 *  ninguna (null) busca en todos los campos, que es el comportamiento de
 *  siempre — este selector solo AFINA, nunca es obligatorio. */
const CAMPO_OPTIONS: { value: CampoBusqueda; label: string; icon: ElementType }[] = [
  { value: "numero_sic",     label: "SIC",         icon: FileText },
  { value: "sic_preparador", label: "Preparador",  icon: Users },
  { value: "numero_op",      label: "OP",          icon: Package },
  { value: "articulo",       label: "Matrícula",   icon: Tag },
  { value: "descripcion",    label: "Descripción", icon: Rows3 },
];

const SIN_DATO = "— (sin dato)";

/** Clave de grupo de una fila según el criterio elegido. */
function groupKeyOf(data: Record<string, unknown>, criterio: AgruparPor): string {
  if (criterio === "articulo") {
    const k = data.articulo_key ?? data.articulo;
    return k == null || k === "" ? SIN_DATO : String(k);
  }
  const v = data[criterio];
  return v == null || v === "" ? SIN_DATO : String(v);
}

/** Título + subtítulo del encabezado de grupo, según el criterio elegido. */
function grupoTitulo(gk: string, primera: Record<string, unknown>, criterio: AgruparPor): { titulo: string; subtitulo: string } {
  if (criterio === "articulo") {
    return { titulo: String(primera.articulo ?? gk), subtitulo: String(primera.descripcion ?? "") };
  }
  if (criterio === "numero_sic") {
    // Descripción de la matrícula, no el preparador: agrupado por SIC lo que
    // importa de un vistazo es QUÉ se pidió, no quién la cargó — el preparador
    // ya tiene su propia columna en la tabla si hace falta mirarlo.
    return { titulo: gk === SIN_DATO ? gk : `SIC ${gk}`, subtitulo: String(primera.descripcion ?? "") };
  }
  return { titulo: gk === SIN_DATO ? gk : `OP ${gk}`, subtitulo: String(primera.proveedor ?? "") };
}

// Etiqueta legible de cualquier columna (del índice o de seguimiento), para
// que el menú contextual pueda decir «Editar «Fecha pactada OP»».
const LABEL_POR_COL: Record<string, string> = {
  ...Object.fromEntries(COLS.map((c) => [c.key as string, c.label])),
  ...Object.fromEntries(TRACK_COLS.map((c) => [c.key, c.label])),
};

// Badges del estado de seguimiento (§4.3): Pendiente ámbar, Resuelto verde
// (badges del sistema) y «En curso» azul de la paleta categórica — el sistema
// no define un badge para «en curso» (confirmado con el usuario).
const ESTADO_STYLE: Record<string, { bg: string; fg: string }> = {
  "Pendiente": { bg: "rgba(245,165,36,.12)", fg: "var(--ido-warning)" },
  "En curso":  { bg: "color-mix(in srgb, var(--ido-cat-1) 12%, transparent)", fg: "var(--ido-cat-1)" },
  "Resuelto":  { bg: "rgba(63,207,142,.12)", fg: "var(--ido-accent)" },
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
  sic_precio:          95,
  sic_importe:         100,
  sic_udm:             85,
  sic_preparador:      150,
  sic_fecha_creacion:  135,
  relacion:            110,
  numero_op:           90,
  linea:               70,
  envio:               80,
  proveedor:           180,
  op_descripcion:      240,
  zona:                140,
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
  stock_za:            95,
  // Columnas de seguimiento: mismo diccionario que las del índice, para que
  // el resize y el ancho persistido funcionen igual sin un lookup aparte —
  // ver el comentario de `mergedCols`, más abajo, sobre por qué ahora
  // conviven en un solo orden renderizado.
  ...Object.fromEntries(TRACK_COLS.map((c) => [c.key, c.width])),
};

const COLUMNS_KEY = "buscador-columns";
// Densidad del índice maestro, por usuario (lib/tableLayout, §4.20).
const INDICE_LAYOUT_ID = "buscadorIndice";
const PINNED_KEY   = "buscador-pinned";
// Las de seguimiento entran al orden persistido como cualquier otra: así el
// selector puede ocultarlas y la elección sobrevive a recargas (`validKeys`
// sale de acá, y lo que no esté en esta lista se descarta al restaurar).
const DEFAULT_COL_ORDER = [
  ...COLS.map((c) => c.key as string),
  ...TRACK_COLS.map((c) => c.key),
];

// Dos vistas del mismo catálogo: dentro de una pestaña se ofrecen también las
// Personalizadas; en el índice maestro no existen, así que no se listan (si se
// listaran, el contador diría "24/41" con 4 columnas que nunca se renderizan).
const COL_META_INDICE: ColMeta[] = COLS.map((c) => ({ key: c.key as string, label: c.label, group: c.group }));
const COL_META: ColMeta[] = [
  ...COL_META_INDICE,
  ...TRACK_COLS.map((c) => ({ key: c.key, label: c.label, group: "track" as ColGroup })),
];

type SortDir = "asc" | "desc";

// ─── Menú contextual de fila ─────────────────────────────────────────────────
// Junta en un solo lugar las acciones que antes estaban desparramadas en
// iconitos de la columna de acciones (fijar, borrar) y en gestos invisibles
// (doble click para editar). Se abre con click derecho sobre cualquier celda,
// y sabe en qué columna se hizo click para ofrecer «Editar esta columna».

interface CtxItem {
  label:     string;
  icon:      ElementType;
  onClick:   () => void;
  danger?:   boolean;
  disabled?: boolean;
  hint?:     string;
}

/** Lo que se abrió: dónde, sobre qué fila y sobre qué columna. */
interface CtxState {
  x: number;
  y: number;
  items: (CtxItem | "sep")[];
}

function RowContextMenu({ state, onClose }: { state: CtxState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  // Reposiciona si se sale de la ventana: se mide después de pintar, porque el
  // alto depende de cuántos items tenga este menú en particular.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: state.x + width  > window.innerWidth  - 8 ? Math.max(8, state.x - width)  : state.x,
      y: state.y + height > window.innerHeight - 8 ? Math.max(8, state.y - height) : state.y,
    });
  }, [state.x, state.y]);

  useEffect(() => {
    const cerrar = () => onClose();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // `capture` en el scroll: el menú queda anclado a coordenadas de pantalla,
    // así que si la tabla scrollea abajo del menú, este queda apuntando a otra fila.
    document.addEventListener("mousedown", cerrar);
    document.addEventListener("scroll", cerrar, true);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", cerrar);
    return () => {
      document.removeEventListener("mousedown", cerrar);
      document.removeEventListener("scroll", cerrar, true);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", cerrar);
    };
  }, [onClose]);

  // Menú contextual §4.5: 210–220px, ítems de 32px, destructivo en `error`
  // también en reposo, separador de 1px con margen 4px 8px.
  return createPortal(
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="ido-terminal ido-pop"
      style={{
        position: "fixed", left: pos.x, top: pos.y, zIndex: 200,
        minWidth: 216, maxWidth: 320, maxHeight: "min(70vh, 420px)", overflowY: "auto",
      }}
    >
      {state.items.map((it, i) =>
        it === "sep" ? (
          <div key={`s${i}`} className="ido-pop-sep" />
        ) : (
          <button
            key={it.label}
            type="button"
            disabled={it.disabled}
            onClick={() => { it.onClick(); onClose(); }}
            className="ido-pop-item"
            style={it.danger ? { color: "var(--ido-error)" } : undefined}
          >
            <it.icon className="w-3.5 h-3.5" style={it.danger ? { color: "var(--ido-error)" } : undefined} />
            <span className="flex-1 truncate">{it.label}</span>
            {it.hint && <span className="ido-mono shrink-0" style={{ fontSize: 11, color: "var(--ido-text-2)" }}>{it.hint}</span>}
          </button>
        )
      )}
    </div>,
    document.body
  );
}

// ─── Compartir pestaña ───────────────────────────────────────────────────────
// Modal de gestión de colaboradores de UNA pestaña — solo la abre el dueño
// (ver botón «Share2» en la barra de pestañas). Ver supabase/buscador_tab_shares.sql
// para el modelo completo de permisos.

const PERMISO_LABEL: Record<Permiso, string> = { lectura: "Lectura", edicion: "Edición" };

/** Lectura / Edición — Select de shadcn con el panel IDO. `z-[10000]`: el
 *  desplegable se portalea a <body> y tiene que quedar arriba del modal. */
function PermisoSelect({ value, onChange, compact }: { value: Permiso; onChange: (v: Permiso) => void; compact?: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Permiso)}>
      <SelectTrigger
        size="sm"
        className="shrink-0 text-[12.5px] shadow-none focus-visible:ring-0"
        style={{
          height: compact ? 28 : 38, minWidth: 104,
          background: compact ? "transparent" : "var(--ido-elevated)",
          border: compact ? "0" : "1px solid var(--ido-border)", borderRadius: 8,
          color: "var(--ido-text)",
        }}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="ido-terminal ido-pop border-0 z-[10000]">
        {(["edicion", "lectura"] as Permiso[]).map((p) => (
          <SelectItem
            key={p}
            value={p}
            className="ido-pop-item focus:bg-white/5 focus:text-[var(--ido-text)] data-[state=checked]:text-[var(--ido-text)]"
          >
            {PERMISO_LABEL[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ShareDialog({ tabId, tabNombre, ownerId, onClose }: { tabId: string; tabNombre: string; ownerId: string; onClose: () => void }) {
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [equipo, setEquipo]               = useState<PerfilBasico[]>([]);
  const [loading, setLoading]             = useState(true);
  const [query, setQuery]                 = useState("");
  const [nuevoPermiso, setNuevoPermiso]   = useState<Permiso>("edicion");
  const [busy, setBusy]                   = useState<string | null>(null); // user_id en vuelo

  const cargar = useCallback(() => {
    setLoading(true);
    Promise.all([fetchColaboradores(tabId), fetchEquipo()])
      .then(([cols, eq]) => { setColaboradores(cols); setEquipo(eq); })
      .catch((e) => toast.error(`No se pudo cargar: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setLoading(false));
  }, [tabId]);

  useEffect(() => { cargar(); }, [cargar]);

  const yaCompartidoCon = useMemo(() => new Set(colaboradores.map((c) => c.user_id)), [colaboradores]);

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase();
    return equipo
      .filter((p) => p.id !== ownerId && !yaCompartidoCon.has(p.id))
      // Por nombre O por email — no todos en el equipo tienen el nombre
      // completado en su perfil, y el email siempre está.
      .filter((p) => !q || `${p.nombre} ${p.apellido} ${p.email}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [equipo, query, ownerId, yaCompartidoCon]);

  // Para mostrar algo mejor que "Usuario" cuando a alguien con acceso le
  // falta el nombre en su perfil — mismo `equipo` que ya se trajo para la
  // búsqueda, sin otra vuelta a la API.
  const equipoPorId = useMemo(() => new Map(equipo.map((p) => [p.id, p])), [equipo]);

  const handleAgregar = async (p: PerfilBasico) => {
    setBusy(p.id);
    try {
      await compartirTab(tabId, p.id, nuevoPermiso);
      setQuery("");
      cargar();
    } catch (e) {
      toast.error(`No se pudo compartir: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleCambiarPermiso = async (userId: string, permiso: Permiso) => {
    setColaboradores((p) => p.map((c) => (c.user_id === userId ? { ...c, permiso } : c))); // optimista
    try {
      await compartirTab(tabId, userId, permiso);
    } catch (e) {
      toast.error(`No se pudo cambiar el permiso: ${e instanceof Error ? e.message : String(e)}`);
      cargar();
    }
  };

  const handleQuitar = async (userId: string) => {
    const backup = colaboradores;
    setColaboradores((p) => p.filter((c) => c.user_id !== userId)); // optimista
    try {
      await descompartirTab(tabId, userId);
    } catch (e) {
      setColaboradores(backup);
      toast.error(`No se pudo quitar: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Esc cierra, igual que los demás modales IDO — salvo que lo haya consumido
  // el Select de permiso abierto (Radix hace preventDefault al cerrarse).
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const dialog = (
    <div className="ido-terminal ido-modal-overlay" onClick={onClose}>
      <div className="ido-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="ido-modal-head">
          <div className="flex items-center gap-2 min-w-0">
            <Share2 className="w-4 h-4 shrink-0" style={{ color: "var(--ido-text-dim)" }} />
            <span className="ido-modal-title truncate">Compartir «{tabNombre}»</span>
          </div>
          <button type="button" className="ido-icon-btn" onClick={onClose} title="Cerrar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-5" style={{ padding: 20 }}>
          {/* Colaboradores actuales */}
          <div>
            <span className="ido-label">Con acceso</span>
            {loading ? (
              <div className="flex items-center gap-2 py-2 text-[13px]" style={{ color: "var(--ido-text-2)" }}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />Cargando…
              </div>
            ) : !colaboradores.length ? (
              <p className="text-[13px]" style={{ color: "var(--ido-text-2)" }}>
                Todavía no compartiste esta pestaña con nadie.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {colaboradores.map((c) => {
                  const nombre = [c.nombre, c.apellido].filter(Boolean).join(" ").trim()
                    || equipoPorId.get(c.user_id)?.email || "Usuario";
                  return (
                    <div
                      key={c.id}
                      className="flex items-center gap-2"
                      style={{ padding: "4px 4px 4px 10px", borderRadius: 8, background: "var(--ido-elevated)", border: "1px solid var(--ido-border)" }}
                    >
                      <span className="text-[13px] flex-1 truncate" style={{ color: "var(--ido-text)" }}>{nombre}</span>
                      <PermisoSelect value={c.permiso} onChange={(v) => handleCambiarPermiso(c.user_id, v)} compact />
                      <button
                        type="button"
                        onClick={() => handleQuitar(c.user_id)}
                        title="Quitar acceso"
                        className="ido-icon-btn ido-icon-btn-danger"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Agregar colaborador */}
          <div>
            <span className="ido-label">Agregar</span>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre o email…"
                className="ido-input flex-1"
              />
              <PermisoSelect value={nuevoPermiso} onChange={setNuevoPermiso} />
            </div>
            {query.trim() && (
              <div className="flex flex-col gap-0.5 mt-2 max-h-[180px] overflow-y-auto">
                {!resultados.length ? (
                  <p className="text-[12.5px] px-1" style={{ color: "var(--ido-text-2)" }}>Sin resultados.</p>
                ) : resultados.map((p) => {
                  const nombreCompleto = [p.nombre, p.apellido].filter(Boolean).join(" ").trim();
                  const nombre = nombreCompleto || p.email || "Usuario";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleAgregar(p)}
                      disabled={busy === p.id}
                      className="ido-pop-item disabled:opacity-50"
                    >
                      <UserPlus className="w-3.5 h-3.5 shrink-0" />
                      <span className="flex-1 min-w-0 truncate">
                        <span className="text-[13px]">{nombre}</span>
                        {/* Si ya se muestra el nombre, el email va aparte y más chico
                            — ayuda a distinguir gente con el mismo nombre. */}
                        {nombreCompleto && p.email && (
                          <span className="text-[11px] ml-1.5" style={{ color: "var(--ido-text-2)" }}>{p.email}</span>
                        )}
                      </span>
                      {busy === p.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-[12px] leading-relaxed" style={{ color: "var(--ido-text-2)" }}>
            {PERMISO_LABEL.lectura}: solo ve la pestaña. {PERMISO_LABEL.edicion}: además edita filas, columnas y agrupado — la vista es la misma para todos.
          </p>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

// ─── Barra de pestañas (design-system.md §4.7) ───────────────────────────────
// Indicador deslizante (bg.elevated + borde fuerte, 200ms con la curva del
// sistema) y botón «nueva vista» con borde discontinuo. Memoizado A PROPÓSITO:
// el indicador usa `layoutId` de motion, que remide el layout en cada render;
// sin memo, tipear en el buscador o tildar una fila lo dispararía cada vez.
// Los handlers tienen que ser estables (useCallback en la sección).

const TAB_BUBBLE_TRANSITION = { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };

const BuscadorTabsBar = memo(function BuscadorTabsBar({
  tabs, activeTab, userId, permisoDe, activeCount, onSelectIndice, onSelectTab, onRename, onContext, onCreate,
}: {
  tabs: BuscadorTab[];
  activeTab: string | null;
  userId: string | null;
  permisoDe: (t: BuscadorTab) => Permiso;
  activeCount: number;
  onSelectIndice: () => void;
  onSelectTab: (id: string) => void;
  onRename: (t: BuscadorTab) => void;
  onContext: (e: React.MouseEvent, t: BuscadorTab) => void;
  onCreate: () => void;
}) {
  const bubble = <motion.span layoutId="buscador-tab-bubble" className="ido-dtab-bubble" transition={TAB_BUBBLE_TRANSITION} />;
  return (
    <div className="ido-tabbar">
      <button type="button" onClick={onSelectIndice} className={`ido-dtab${activeTab === null ? " is-active" : ""}`}>
        {activeTab === null && bubble}
        <Database className="w-3.5 h-3.5" />
        <span>Índice maestro</span>
      </button>
      {tabs.map((t) => {
        const act = activeTab === t.id;
        const propia = t.user_id === userId;
        const permiso = permisoDe(t);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelectTab(t.id)}
            onDoubleClick={permiso === "edicion" ? () => onRename(t) : undefined}
            onContextMenu={(e) => onContext(e, t)}
            title={
              propia ? "Doble clic para renombrar · clic derecho para más"
                : permiso === "edicion" ? "Compartida — podés editarla y renombrarla"
                : "Compartida — solo lectura"
            }
            className={`ido-dtab${act ? " is-active" : ""}`}
          >
            {act && bubble}
            {!propia && (
              permiso === "edicion"
                ? <Users className="w-3 h-3 shrink-0" style={{ color: "var(--ido-cat-3)" }} />
                : <Lock className="w-3 h-3 shrink-0" style={{ color: "var(--ido-text-2)" }} />
            )}
            <span>{t.nombre}</span>
            {act && activeCount > 0 && (
              <span className="ido-mono" style={{ fontSize: 11, color: "var(--ido-text-2)" }}>{activeCount}</span>
            )}
          </button>
        );
      })}
      <button type="button" onClick={onCreate} title="Nueva pestaña de seguimiento" className="ido-dtab-new">
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
});

// ─── Sección ─────────────────────────────────────────────────────────────────

export function BuscadorSection() {
  // Confirmaciones y nombres de pestaña en modales IDO, no en los cuadros
  // nativos del navegador (ver ido-kit `useIdoDialogs`).
  const { confirmar, pedirTexto, dialogo } = useIdoDialogs();
  const [query, setQuery]     = useState("");
  // Campo al que se acota la búsqueda (selector al lado de la caja). null =
  // todos los campos, arranca así siempre — es un afinador, no un requisito.
  const [campoBusqueda, setCampoBusqueda] = useState<CampoBusqueda | null>(null);
  const [campoMenuOpen, setCampoMenuOpen] = useState(false);

  // Stock de ZA por matrícula, cruzado en el cliente (ver getStockZonaMap).
  const [stockZA, setStockZA] = useState<Map<string, number>>(new Map());

  // ── Filtro por rango de fechas ────────────────────────────────────────────
  // Acota la BÚSQUEDA a un rango sobre la fecha elegida (creación de la SIC,
  // creación o pactada de la OP, primer/último movimiento). El filtro se
  // aplica en el servidor: filtrarlo acá abajo filtraría las 500 filas que ya
  // vinieron, no el índice — el mismo error que tenía el orden.
  //
  // `aplicado` es lo que está filtrando de verdad; los inputs escriben en el
  // borrador y recién pasan acá al apretar «Buscar». Sin esa separación, una
  // fecha a medio tipear dispararía una consulta por tecla.
  const [fechaCampo,  setFechaCampo]  = useState<CampoFecha>("fecha_pactada");
  const [fechaDesde,  setFechaDesde]  = useState("");
  const [fechaHasta,  setFechaHasta]  = useState("");
  const [fechaAplicada, setFechaAplicada] =
    useState<{ campo: CampoFecha; desde: string; hasta: string } | null>(null);

  const [rows, setRows]       = useState<BusquedaRow[]>([]);
  // Datos manuales de la OP (descripción + zona real), por OP normalizada. Se
  // superponen a lo que traiga el índice o la copia congelada de la pestaña,
  // así lo último cargado se ve al toque sin esperar un «Reconstruir».
  const [opDatos, setOpDatos] = useState<Map<string, OpDato>>(new Map());
  const [loading, setLoading] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [reconstruyendo, setReconstruyendo] = useState(false);
  const [indice, setIndice]   = useState<{ filas: number; actualizado: string | null } | null>(null);
  // Menú del estado del índice. «Reconstruir» vive acá adentro y no suelto en
  // la barra: es una operación de varios minutos que además ya corre sola
  // después de cada carga masiva, así que casi nunca hace falta a mano.
  const [indiceMenuOpen, setIndiceMenuOpen] = useState(false);
  const indiceMenuRef = useRef<HTMLDivElement>(null);
  // Menú contextual de fila (click derecho). null = cerrado.
  const [ctxMenu, setCtxMenu] = useState<CtxState | null>(null);

  // Un solo estado para col+dir: con dos useState separados, un click rápido
  // podía actualizar el ícono (dir) sin que el array se reordenara de nuevo
  // (o viceversa) porque quedaban desincronizados entre sí.
  // `col` es string (no keyof BusquedaRow) porque dentro de una pestaña también
  // se puede ordenar por las columnas de seguimiento, que no vienen del índice.
  //
  // El maestro abre ordenado por SIC descendente: lo primero que se quiere ver
  // al entrar es lo último que se pidió. Antes abría con el orden por defecto
  // del servidor (OP más nueva), que dejaba arriba filas viejas de OP y las
  // SIC recientes sin OP —que son la mayoría— quedaban enterradas.
  // Al entrar a una pestaña se resetea a null (orden manual de la pestaña).
  const [sort, setSort] = useState<{ col: string | null; dir: SortDir }>({ col: "numero_sic", dir: "desc" });
  const sortCol = sort.col;
  const sortDir = sort.dir;

  // ── Pestañas de seguimiento ──
  // activeTab = null → índice maestro (la vista de siempre).
  const [tabs, setTabs]           = useState<BuscadorTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabFilas, setTabFilas]   = useState<TabFila[]>([]);
  const [loadingTab, setLoadingTab] = useState(false);
  // Permiso del usuario actual en cada pestaña que OTRO compartió con él
  // (tab_id → permiso). Las propias no están acá: ser dueño ya es edición
  // completa. Se trae una sola vez al conocer al usuario (ver más abajo).
  const [misPermisos, setMisPermisos] = useState<Map<string, Permiso>>(new Map());
  // Pestaña cuyo diálogo "Compartir" está abierto (null = cerrado).
  const [shareTabId, setShareTabId] = useState<string | null>(null);
  // Selección (design-system.md §4.16):
  //  · `selected` = selección MÚLTIPLE (checkbox marcado): Ctrl/⌘ clic, ⇧ clic
  //    o el checkbox. Es sobre lo que actúan las acciones en lote. En el índice
  //    SOBREVIVE al cambiar la búsqueda (tildar en varias búsquedas es un caso
  //    legítimo); la barra flotante avisa cuántas quedaron fuera.
  //  · `inspeccionada` = clic simple: marca UNA fila para mirarla (bg.elevated +
  //    borde verde, checkbox sin marcar). No es selección en lote.
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [inspeccionada, setInspeccionada] = useState<string | null>(null);
  // Datos de cada fila seleccionada, por clave. La selección del índice
  // sobrevive a cambiar la búsqueda, pero `rows` solo tiene la búsqueda
  // actual: sin guardar acá el dato de lo tildado antes, «Agregar a pestaña»
  // y «Exportar» no podían incluirlo (y lo perdían). Lo llena el efecto que
  // está debajo de `displayRows`.
  const selDatos = useRef(new Map<string, Record<string, unknown>>());
  /** Datos de TODO lo seleccionado, visible o no, en el orden en que se tildó. */
  const filasSeleccionadas = useCallback(
    () => [...selected].map((k) => selDatos.current.get(k)).filter((d): d is Record<string, unknown> => !!d),
    [selected],
  );
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // Celda en edición dentro de una pestaña: { filaId, key }.
  // `valor` = con qué arranca el campo; lo que se tipea vive en <CeldaEditor>.
  const [editing, setEditing]     = useState<{ filaId: string; key: string; valor: string } | null>(null);
  // Vista de agrupado — `agrupar`/`agruparPor` viven en buscador_tabs.config
  // (ver más abajo, junto a tabLayouts/patchLayout): son valores DERIVADOS de
  // la pestaña activa, no estado propio, para que cada pestaña recuerde su
  // propio criterio igual que ya hace con sus columnas.
  const [agruparMenuOpen, setAgruparMenuOpen] = useState(false);
  const agruparMenuRef = useRef<HTMLDivElement>(null);
  const dragFilaId = useRef<string | null>(null);
  const [dragOverFilaId, setDragOverFilaId] = useState<string | null>(null);
  // Fila resaltada al hacer click — como en Excel: sirve de referencia al
  const [userId, setUserId] = useState<string | null>(null);
  const saveWidthsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveColsTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS);
  const colWidthsLoaded = useRef(false);
  const resizingRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);
  // Columna que se está redimensionando (guía de 1px + ancho, ver más abajo).
  const [resizingCol, setResizingCol] = useState<string | null>(null);

  // Orden y visibilidad de columnas (no borra datos, solo qué se ve y en qué orden).
  const [colOrder, setColOrder]   = useState<string[]>(DEFAULT_COL_ORDER);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const colOrderLoaded = useRef(false);

  // Layout de columnas POR PESTAÑA (buscador_tabs.config). El índice maestro
  // sigue usando la preferencia global de arriba; una lista de seguimiento casi
  // nunca quiere las mismas 37 columnas que la vista maestra, así que cada
  // pestaña guarda su propio orden / ocultas / anchos.
  const [tabLayouts, setTabLayouts] = useState<Record<string, TabConfig>>({});
  // Un timer POR pestaña: con uno solo compartido, tocar A y cambiar enseguida
  // a B cancelaba el guardado pendiente de A y se perdía su layout.
  const saveTabCfgTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const isTabMode = activeTab !== null;

  // Config guardada de la pestaña activa (columnas Y agrupado): `undefined` si
  // es el índice maestro o si la pestaña todavía no tiene nada guardado.
  const tabCfg = isTabMode && activeTab ? tabLayouts[activeTab] : undefined;

  // Vista de agrupado — de la pestaña activa, no un toggle global: cada
  // pestaña recuerda su propio criterio (matrícula / SIC / OP) igual que ya
  // recuerda sus columnas. Sin agrupado ni criterio guardado, arranca como
  // antes: agrupada por matrícula.
  const agrupar    = tabCfg?.agrupar    ?? true;
  const agruparPor = tabCfg?.agruparPor ?? "articulo";
  // Qué grupos dejó plegados el usuario — por pestaña, guardado. Antes era
  // estado suelto del componente: se perdía al recargar y se arrastraba de una
  // pestaña a otra, plegando grupos que ni existían en la que abrías.
  //
  // `undefined` (nunca se tocó) NO es lo mismo que `[]` (se abrieron todos a
  // propósito): en el primer caso vale el default de "todo cerrado", en el
  // segundo hay que respetar que los quiso abiertos. Por eso no se colapsa a
  // un Set vacío acá.
  const colapsadosGuardados = useMemo(
    () => (tabCfg?.colapsados ? new Set(tabCfg.colapsados) : null),
    [tabCfg?.colapsados]
  );

  // ── Permisos de la pestaña activa ──
  // Dueño = edición completa siempre. Compartida = lo que diga `misPermisos`
  // (fail-closed: si todavía no cargó, "lectura" — nunca se asume edición por
  // las dudas). En el índice maestro no hay restricción: no es de nadie.
  const tabActiva  = isTabMode ? tabs.find((t) => t.id === activeTab) ?? null : null;
  const esPropia   = !!tabActiva && tabActiva.user_id === userId;
  const miPermiso: Permiso = esPropia ? "edicion" : (activeTab ? misPermisos.get(activeTab) ?? "lectura" : "edicion");
  const puedoEditar = !isTabMode || esPropia || miPermiso === "edicion";

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
    // Mientras se arrastra el borde, `colWidths` cambia en cada mousemove: se
    // guarda recién al soltar (el ref vuelve a null y este efecto corre de
    // nuevo por `resizingCol`).
    if (resizingRef.current) return;
    try { localStorage.setItem(COLWIDTHS_KEY, JSON.stringify(colWidths)); } catch { /* ignorar */ }
    if (!userId) return;
    if (saveWidthsTimer.current) clearTimeout(saveWidthsTimer.current);
    saveWidthsTimer.current = setTimeout(() => {
      setPreference(userId, COLWIDTHS_KEY, colWidths);
    }, 1000);
  }, [colWidths, userId, resizingCol]);
  // Snapshot del layout para los handlers que viven fuera del ciclo de render
  // (el listener de resize se registra una sola vez) y para no arrastrar medio
  // componente en las deps de cada callback.
  const layoutRef = useRef({ tabLayouts, colOrder, hiddenCols, colWidths, activeTab });
  useEffect(() => {
    layoutRef.current = { tabLayouts, colOrder, hiddenCols, colWidths, activeTab };
  });

  /**
   * Escribe orden / ocultas / anchos / agrupado en el scope que corresponde: la
   * pestaña activa si hay una, la preferencia global si estamos en el índice
   * maestro (agrupar/agruparPor no aplican ahí — el maestro no agrupa).
   *
   * La primera vez que se toca una pestaña hereda lo que se está viendo (la
   * config del maestro para columnas, los defaults para agrupado) en lugar de
   * saltar a otra cosa — si no, cambiar el ancho de una columna haría
   * reaparecer de golpe las 37, o tocar el agrupado perdería el criterio ya
   * elegido en esa pestaña.
   */
  const patchLayout = useCallback((patch: TabConfig) => {
    const s = layoutRef.current;
    if (s.activeTab) {
      const id = s.activeTab;
      const base = s.tabLayouts[id] ?? {};
      const next: TabConfig = {
        order:      patch.order      ?? base.order      ?? s.colOrder,
        hidden:     patch.hidden     ?? base.hidden      ?? [...s.hiddenCols],
        widths:     patch.widths     ?? base.widths      ?? s.colWidths,
        agrupar:    patch.agrupar    ?? base.agrupar     ?? true,
        agruparPor: patch.agruparPor ?? base.agruparPor  ?? "articulo",
        colapsados: patch.colapsados ?? base.colapsados  ?? [],
        density:    patch.density    ?? base.density     ?? "normal",
      };
      setTabLayouts((p) => ({ ...p, [id]: next }));
      clearTimeout(saveTabCfgTimers.current[id]);
      saveTabCfgTimers.current[id] = setTimeout(() => {
        delete saveTabCfgTimers.current[id];
        updateTabConfig(id, next).catch(() => { /* se reintenta en el próximo cambio */ });
      }, 1000);
    } else {
      if (patch.order)  setColOrder(patch.order);
      if (patch.hidden) setHiddenCols(new Set(patch.hidden));
      if (patch.widths) setColWidths(patch.widths);
    }
  }, []);

  /** Toggle del agrupado de la pestaña activa — no hace nada en el maestro. */
  const setAgrupar = useCallback((updater: boolean | ((prev: boolean) => boolean)) => {
    const s = layoutRef.current;
    if (!s.activeTab) return;
    const current = s.tabLayouts[s.activeTab]?.agrupar ?? true;
    const next = typeof updater === "function" ? (updater as (p: boolean) => boolean)(current) : updater;
    patchLayout({ agrupar: next });
  }, [patchLayout]);

  /**
   * Cambia el criterio de agrupado de la pestaña activa.
   *
   * Se pliegan todos los grupos del criterio NUEVO: las claves guardadas eran
   * de otro eje (matrícula ≠ SIC ≠ OP) y no coinciden con ningún grupo nuevo,
   * así que dejarlas abriría todo de golpe — justo lo contrario de lo que sirve
   * al cambiar de eje, que es ver el panorama y después abrir lo que interese.
   */
  const setAgruparPor = useCallback((value: AgruparPor) => {
    // ⚠ UNA sola llamada a patchLayout, con agrupar y agruparPor juntos.
    //   patchLayout lee `layoutRef.current`, que se refresca en un efecto
    //   DESPUÉS del render: dos llamadas seguidas en el mismo handler hacen que
    //   la segunda lea el estado viejo y pise lo que escribió la primera. Eso
    //   era exactamente el bug de «Agrupar por no hace nada» — se guardaba el
    //   criterio y el setAgrupar(true) de al lado lo revertía.
    patchLayout({
      agrupar: true,
      agruparPor: value,
      colapsados: [...new Set(tabFilasRef.current.map((f) => groupKeyOf(f.datos, value)))],
    });
  }, [patchLayout]);

  // Redimensionado (§4.15): mínimo 64px; `resizingCol` pinta la guía de 1px
  // con el ancho. `lastResizeEnd`: al soltar un arrastre dentro del mismo
  // encabezado el navegador dispara un click sobre él → ordenaba la columna.
  const lastResizeEnd = useRef(0);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const { col, startX, startWidth } = resizingRef.current;
      const s = layoutRef.current;
      const base = (s.activeTab ? s.tabLayouts[s.activeTab]?.widths : null) ?? s.colWidths;
      patchLayout({ widths: { ...base, [col]: Math.max(64, startWidth + e.clientX - startX) } });
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = null;
      lastResizeEnd.current = Date.now();
      setResizingCol(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [patchLayout]);

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
    const s = layoutRef.current;
    const actual = (s.activeTab ? s.tabLayouts[s.activeTab]?.hidden : null) ?? [...s.hiddenCols];
    const next = new Set(actual);
    const ocultando = !next.has(key);
    if (ocultando) next.add(key); else next.delete(key);

    // Al ocultar, la columna se manda al fondo del orden — así en el panel
    // «Columnas» (y en la tabla, si se vuelve a mostrar) las visibles quedan
    // siempre arriba, sin ocultas salteadas en el medio de la lista.
    //
    // ⚠ Los dos cambios (hidden + order) van en UN solo patchLayout, no en dos
    // llamadas seguidas: patchLayout lee `layoutRef.current`, que recién se
    // actualiza en un efecto DESPUÉS del render — dos llamadas sucesivas leen
    // el mismo estado viejo y la segunda pisa a la primera (mismo bug que ya
    // se arregló para «Agrupar por no hace nada», ver commit 6d01929).
    const patch: TabConfig = { hidden: [...next] };
    if (ocultando) {
      const ordenActual = (s.activeTab ? s.tabLayouts[s.activeTab]?.order : null) ?? s.colOrder;
      patch.order = [...ordenActual.filter((k) => k !== key), key];
    }
    patchLayout(patch);
  }, [patchLayout]);

  const resetColumnas = useCallback(() => {
    // También los anchos: si no, un ancho viejo guardado sigue cortando la
    // etiqueta de una columna que después se renombró más larga.
    patchLayout({ order: DEFAULT_COL_ORDER, hidden: [], widths: DEFAULT_COL_WIDTHS });
  }, [patchLayout]);

  const setOrden = useCallback((o: string[]) => patchLayout({ order: o }), [patchLayout]);

  // ── Layout efectivo ──
  // El del maestro o el de la pestaña activa, según dónde estemos. Una pestaña
  // sin config propia todavía muestra la del maestro (config = {} en la DB).
  // (`tabCfg` ya se calculó más arriba, junto a `agrupar`/`agruparPor`.)
  // El order guardado de una pestaña puede ser viejo (de antes de que
  // existiera alguna columna, ej. sic_precio/sic_importe) — sin este merge la
  // columna nueva queda invisible para siempre en esa pestaña, aunque en el
  // maestro sí aparezca (el maestro ya hace este mismo merge para colOrder).
  const effOrder = useMemo(() => {
    const base = tabCfg?.order ?? colOrder;
    const missing = DEFAULT_COL_ORDER.filter((k) => !base.includes(k));
    return missing.length ? [...base, ...missing] : base;
  }, [tabCfg?.order, colOrder]);
  const effHidden = useMemo(
    () => (tabCfg?.hidden ? new Set(tabCfg.hidden) : hiddenCols),
    [tabCfg?.hidden, hiddenCols]
  );
  const effWidths = useMemo(
    () => (tabCfg?.widths ? { ...DEFAULT_COL_WIDTHS, ...tabCfg.widths } : colWidths),
    [tabCfg?.widths, colWidths]
  );

  /**
   * Todas las columnas visibles, EN UN SOLO orden — las del índice y las de
   * seguimiento (Nota, Estado seg., etc.) mezcladas según `effOrder`.
   *
   * Antes esto eran dos listas (`visibleCols` / `visibleTrackCols`)
   * renderizadas en dos pasadas separadas: la tabla SIEMPRE pintaba primero
   * todas las del índice y recién después todas las de seguimiento, sin
   * importar qué orden se arrastrara en el panel «Columnas» — ese panel ya
   * incluía las de seguimiento en la misma lista arrastrable (`effOrder` las
   * contempla desde siempre, ver DEFAULT_COL_ORDER), pero la posición que
   * ahí se elegía nunca llegaba a afectar el render. Resultado: arrastrar
   * «Nota» reordenaba la lista del panel pero la tabla no se movía un pixel.
   *
   * Ahora una sola pasada respeta `effOrder` de punta a punta, así que
   * cualquier columna se puede ubicar en cualquier posición.
   */
  const mergedCols = useMemo(() => {
    const dataByKey  = new Map(COLS.map((c) => [c.key as string, c]));
    const trackByKey = new Map(TRACK_COLS.map((c) => [c.key, c]));
    type Item =
      | { kind: "data";  key: string; data: ColDef }
      | { kind: "track"; key: string; track: TrackColDef };
    return effOrder
      .filter((k) => !effHidden.has(k))
      .map((k): Item | null => {
        const d = dataByKey.get(k);
        if (d) return { kind: "data", key: k, data: d };
        if (!isTabMode) return null;   // de seguimiento: solo dentro de una pestaña
        const t = trackByKey.get(k);
        return t ? { kind: "track", key: k, track: t } : null;
      })
      .filter((x): x is Item => x !== null);
  }, [effOrder, effHidden, isTabMode]);

  // Derivadas de `mergedCols`, para el código existente que solo necesita un
  // tipo — ya no definen el orden de render (eso lo hace `mergedCols`), solo
  // filtran por tipo conservando la posición relativa entre sí.
  const visibleCols = useMemo(
    () => mergedCols.filter((x) => x.kind === "data").map((x) => x.data),
    [mergedCols]
  );
  const visibleTrackCols = useMemo(
    () => mergedCols.filter((x) => x.kind === "track").map((x) => x.track),
    [mergedCols]
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
    fetchMisPermisos(userId)
      .then(setMisPermisos)
      .catch(() => { /* sin esto, las compartidas se ven como solo-lectura por las dudas */ });
  }, [userId]);

  /** Permiso del usuario actual en CUALQUIER pestaña (propia o compartida) —
   *  a diferencia de `miPermiso`, que es solo de la activa. Se usa para decidir
   *  qué pestañas ofrecer en "Agregar a pestaña" y qué badge mostrar en la barra. */
  const permisoDe = useCallback(
    (tab: BuscadorTab): Permiso => (tab.user_id === userId ? "edicion" : misPermisos.get(tab.id) ?? "lectura"),
    [userId, misPermisos]
  );

  // Config de columnas que ya trae cada pestaña. Solo se siembran las que
  // todavía no están en memoria: un refetch tras renombrar/crear no debe pisar
  // un layout que el usuario acaba de tocar y sigue en vuelo hacia la DB.
  useEffect(() => {
    setTabLayouts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const t of tabs) {
        if (!(t.id in next)) { next[t.id] = t.config ?? {}; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [tabs]);

  // Al cambiar de pestaña se traen sus filas. El índice maestro (null) no carga nada.
  useEffect(() => {
    // La selección se limpia siempre: dentro de una pestaña sus claves son
    // filaIds, en el índice son rowKeys, y arrastrar unas al otro contexto
    // dejaría marcadas filas que no son (o ninguna, en el mejor caso).
    setSelected(new Set());
    setInspeccionada(null);
    if (!activeTab) { setTabFilas([]); return; }
    // `vigente`: si se cambia de pestaña antes de que lleguen las filas, la
    // respuesta vieja se descarta. Sin esto, una pestaña lenta que respondía
    // última pintaba SUS filas bajo el nombre de la otra (y se podían editar
    // ahí creyendo que eran de la pestaña abierta).
    let vigente = true;
    setTabFilas([]);
    setLoadingTab(true);
    fetchTabFilas(activeTab)
      .then((f) => { if (vigente) setTabFilas(f); })
      .catch((e) => { if (vigente) toast.error(`No se pudieron cargar las filas: ${e.message}`); })
      .finally(() => { if (vigente) setLoadingTab(false); });
    return () => { vigente = false; };
  }, [activeTab]);

  // Espejo de `tabFilas` para el efecto de plegado de abajo, que necesita las
  // filas actuales pero NO puede tenerlas en sus deps (ver ahí por qué).
  const tabFilasRef = useRef(tabFilas);
  useEffect(() => { tabFilasRef.current = tabFilas; });

  // El plegado ya no se calcula con un efecto que pisaba el estado en cada
  // carga: se deriva más abajo, junto a `displayRows`, a partir de lo guardado
  // en la pestaña. Ver `colapsados`.

  useEffect(() => {
    if (!agruparMenuOpen) return;
    const h = (e: MouseEvent) => { if (!agruparMenuRef.current?.contains(e.target as Node)) setAgruparMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [agruparMenuOpen]);

  // (El click-afuera del selector de campo lo maneja ahora el DropdownMenu de
  // Radix, así que el listener a mano que había acá se borró.)

  useEffect(() => {
    if (!indiceMenuOpen) return;
    const h = (e: MouseEvent) => { if (!indiceMenuRef.current?.contains(e.target as Node)) setIndiceMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [indiceMenuOpen]);

  const handleCreateTab = useCallback(async () => {
    const nombre = await pedirTexto({
      title: "Nueva pestaña", label: "Nombre", initial: "Seguimiento", confirmLabel: "Crear", icon: Plus,
    });
    if (!nombre?.trim()) return;
    try {
      // Se pide el usuario FRESCO en vez de usar el `userId` de estado (que se
      // fijó una sola vez al montar la sección): si la sesión cambió mientras
      // la pestaña del navegador estuvo abierta, el estado viejo manda un
      // user_id que ya no coincide con auth.uid() del lado del servidor, y el
      // insert rebota contra la RLS con un error que no dice esto para nada.
      const { data, error: authError } = await supabase.auth.getUser();
      const uidFresco = data.user?.id ?? null;
      if (authError || !uidFresco) {
        toast.error("Tu sesión no está activa — recargá la página e iniciá sesión de nuevo.");
        return;
      }
      if (uidFresco !== userId) setUserId(uidFresco); // resincroniza el estado

      const tab = await createTab(uidFresco, nombre.trim(), tabs.length);
      setTabs((p) => [...p, tab]);
      setActiveTab(tab.id);
    } catch (e) {
      toast.error(`No se pudo crear: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [userId, tabs.length, pedirTexto]);

  const handleRenameTab = useCallback(async (tab: BuscadorTab) => {
    const nombre = await pedirTexto({
      title: "Renombrar pestaña", label: "Nombre", initial: tab.nombre, confirmLabel: "Guardar", icon: Pencil,
    });
    if (!nombre?.trim() || nombre.trim() === tab.nombre) return;
    try {
      await renameTab(tab.id, nombre.trim());
      setTabs((p) => p.map((t) => (t.id === tab.id ? { ...t, nombre: nombre.trim() } : t)));
    } catch (e) {
      toast.error(`No se pudo renombrar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [pedirTexto]);

  const handleDeleteTab = useCallback(async (tab: BuscadorTab) => {
    const ok = await confirmar({
      title: "Borrar pestaña",
      children: <>Se borra «{tab.nombre}» con todas sus filas{tab.user_id === userId ? ", también para quienes la tengan compartida" : ""}. No se puede deshacer.</>,
      confirmLabel: "Borrar pestaña",
    });
    if (!ok) return;
    try {
      await deleteTab(tab.id);
      // Cortar un guardado de layout en vuelo: la pestaña ya no existe.
      clearTimeout(saveTabCfgTimers.current[tab.id]);
      delete saveTabCfgTimers.current[tab.id];
      setTabLayouts((p) => { const n = { ...p }; delete n[tab.id]; return n; });
      setTabs((p) => p.filter((t) => t.id !== tab.id));
      setActiveTab((cur) => (cur === tab.id ? null : cur));
      toast.success("Pestaña borrada.");
    } catch (e) {
      toast.error(`No se pudo borrar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [confirmar, userId]);

  // Saca de la selección (y de la inspección) filas que se acaban de borrar:
  // si no, la barra seguía contándolas («N seleccionadas · 1 fuera de esta
  // búsqueda» fantasma).
  const olvidarSeleccion = useCallback((ids: Iterable<string>) => {
    const fuera = new Set(ids);
    setSelected((prev) => {
      if (![...prev].some((k) => fuera.has(k))) return prev;
      return new Set([...prev].filter((k) => !fuera.has(k)));
    });
    setInspeccionada((k) => (k && fuera.has(k) ? null : k));
  }, []);

  /**
   * Quita filas de la pestaña. Una sola va directo (es lo que se ve bajo el
   * mouse); varias piden confirmación, porque se llevan lo anotado en ellas.
   * `titulo` = nombre del grupo cuando se quita uno entero.
   */
  const quitarFilas = useCallback(async (filaIds: string[], titulo?: string) => {
    if (!filaIds.length) return;
    if (filaIds.length > 1 || titulo) {
      const n = filaIds.length;
      const ok = await confirmar({
        title: "Quitar filas de la pestaña",
        children: <>Se quita{n === 1 ? "" : "n"} <b className="ido-mono" style={{ color: "var(--ido-text)" }}>{n}</b> fila{n === 1 ? "" : "s"}{titulo ? <> de «{titulo}»</> : null}, con lo que hayas anotado en {n === 1 ? "ella" : "ellas"}. El índice maestro no se toca.</>,
        confirmLabel: "Quitar",
      });
      if (!ok) return;
    }
    const backup = tabFilas;
    const ids = new Set(filaIds);
    setTabFilas((p) => p.filter((f) => !ids.has(f.id)));   // optimista
    try {
      await deleteFilas(filaIds);
      olvidarSeleccion(ids);
      if (filaIds.length > 1) toast.success(`${filaIds.length} filas quitadas${titulo ? ` de «${titulo}»` : ""}.`);
    } catch (e) {
      setTabFilas(backup);
      toast.error(`No se pudo borrar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [tabFilas, confirmar, olvidarSeleccion]);

  /** Borra todas las filas de un grupo entero (una OP, una matrícula, una SIC) de una vez. */
  const handleDeleteGrupo = useCallback(
    (filaIds: string[], titulo: string) => quitarFilas(filaIds, titulo),
    [quitarFilas],
  );

  // Guarda una celda editada. `datos` es jsonb, así que se manda el objeto
  // entero con la clave ya aplicada.
  /**
   * Guarda una celda editada. Hay DOS destinos según la columna:
   *
   *  • `op_descripcion` / `zona` → son datos de la OP ENTERA, no de la fila.
   *    Van a `op_datos` (tabla compartida) y se ven al instante en todas las
   *    filas de esa OP, en todas las pestañas y para todo el equipo. Por eso
   *    también se pueden editar desde el índice maestro, donde no hay `filaId`.
   *
   *  • cualquier otra → es la copia privada de esta pestaña; se guarda el
   *    `datos` jsonb completo de esa fila.
   */
  const commitEdit = useCallback(async (filaId: string | null, key: string, value: string, numeroOp?: string | null) => {
    setEditing(null);

    if (OP_MANUAL_COLS.has(key)) {
      const clave = normOp(numeroOp);
      if (!clave) { toast.error("Esta fila no tiene número de OP — no se le puede cargar zona ni descripción."); return; }
      const previo = opDatos.get(clave);
      const limpio = value.trim();
      const campo  = key === "zona" ? "zona" : "descripcion";
      if (String(previo?.[campo] ?? "") === limpio) return;   // sin cambios

      const backup = opDatos;
      setOpDatos((p) => {
        const n = new Map(p);
        n.set(clave, {
          numero_op:   clave,
          descripcion: previo?.descripcion ?? null,
          zona:        previo?.zona ?? null,
          [campo]:     limpio || null,
        } as OpDato);
        return n;
      });
      try {
        await upsertOpDato(clave, { [campo]: limpio || null }, userId);
      } catch (e) {
        setOpDatos(backup);
        toast.error(`No se pudo guardar: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }

    if (!filaId) return;
    const fila = tabFilas.find((f) => f.id === filaId);
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
  }, [tabFilas, opDatos, userId]);

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
    // Solo se guardan las que cambiaron de `orden` (las que están entre el
    // origen y el destino, salvo la primera vez después de borrar filas, que
    // cierra los huecos).
    const previos = new Map(tabFilas.map((f) => [f.id, f.orden]));
    const aGuardar = renumeradas.filter((f) => previos.get(f.id) !== f.orden);
    setTabFilas(renumeradas);
    try {
      await reorderFilas(aGuardar.map((f) => ({ id: f.id, orden: f.orden })));
    } catch (e) {
      // Si falló a la mitad, parte del orden nuevo ya quedó guardado: volver al
      // estado anterior en pantalla mentiría. Se recarga lo que hay en la base.
      toast.error(`No se pudo reordenar del todo: ${e instanceof Error ? e.message : String(e)}`);
      if (activeTab) fetchTabFilas(activeTab).then(setTabFilas).catch(() => {});
    }
  }, [tabFilas, activeTab]);

  const cargarEstado = useCallback(() => {
    estadoIndice().then(setIndice).catch(() => setIndice(null));
  }, []);
  useEffect(() => { cargarEstado(); }, [cargarEstado]);

  // Datos manuales de OP: se traen una vez y se mantienen en memoria. La tabla
  // solo tiene fila por OP que alguien anotó, así que es chica.
  useEffect(() => {
    fetchOpDatos()
      .then(setOpDatos)
      .catch(() => { /* sin esto se ve la zona de la planilla, degrada bien */ });
  }, []);

  // Búsqueda con debounce: dispara 300 ms después de dejar de tipear.
  // Dentro de una pestaña no se consulta el índice: el filtrado es local sobre
  // las filas ya copiadas (ver tabFilasFiltradas).
  //
  // Con la caja vacía TAMBIÉN se consulta (antes se mostraba un cartel de
  // "escribí algo" y no se veía nada): `gd_buscar` con `p_q` vacío devuelve
  // todo el índice ordenado por `fecha_creacion` DESC, así que el Buscador
  // abre mostrando las OP más nuevas en vez de una pantalla en blanco.
  //
  // El ORDEN va en la consulta, no después: la búsqueda devuelve como mucho
  // `limite` filas de las 112k+ del índice, así que ordenar del lado del
  // cliente ordenaba ese recorte y no el índice — tocar «F. pactada» daba la
  // más vieja de las 500 traídas, no la más vieja que hay. Por eso el sort
  // está entre las dependencias: cambiarlo re-consulta.
  const ordenServidor = sortCol && ORDENABLES_SERVIDOR.has(sortCol) ? sortCol : null;
  // La dirección solo le importa al servidor si ordena él: dar vuelta una
  // columna que se ordena en el cliente (Stock ZA, movimientos…) no re-consulta.
  const dirServidor: SortDir = ordenServidor ? sortDir : "asc";
  // «Reconstruir ahora» lo incrementa para volver a buscar con el índice nuevo.
  const [recargaBusqueda, setRecargaBusqueda] = useState(0);

  useEffect(() => {
    if (activeTab) { setLoading(false); return; }
    const q = query.trim();
    // `vigente`: la respuesta de una búsqueda vieja que llega DESPUÉS que la
    // nueva se descarta. Sin esto, tipear rápido podía dejar en la tabla los
    // resultados de lo que se había escrito antes (y sacar el spinner antes
    // de tiempo).
    let vigente = true;
    setLoading(true);
    const t = setTimeout(() => {
      buscar(q, undefined, campoBusqueda, false, ordenServidor, dirServidor, fechaAplicada)
        .then((data) => {
          if (!vigente) return;
          setRows(data);
          setBuscado(true);
          // Resultados nuevos arrancan arriba; el scroll horizontal se respeta
          // (la columna que se estaba mirando sigue a la vista).
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        })
        .catch((e) => { if (vigente) toast.error(`Error al buscar: ${e instanceof Error ? e.message : String(e)}`); })
        .finally(() => { if (vigente) setLoading(false); });
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [query, activeTab, campoBusqueda, ordenServidor, dirServidor, fechaAplicada, recargaBusqueda]);

  // El stock se trae una sola vez y se cruza en memoria: son ~5k matrículas en
  // un único registro jsonb, mucho más barato que pedirlo por fila.
  useEffect(() => {
    getStockZonaMap("ZA")
      .then(setStockZA)
      .catch(() => { /* sin stock la columna queda vacía, no rompe nada */ });
  }, []);

  const handleReconstruir = async () => {
    // Confirmación explícita: son varios minutos y no es algo que haga falta
    // en el uso normal (las cargas masivas ya reconstruyen solas).
    setIndiceMenuOpen(false);
    const ok = await confirmar({
      title: "Reconstruir el índice",
      children: <>Vuelve a leer Matrículas + Envíos + SIC + Transacciones. Tarda varios minutos y no hace falta después de una carga de datos, porque eso ya reconstruye solo.</>,
      confirmLabel: "Reconstruir igual",
      danger: false,
      icon: RefreshCw,
    });
    if (!ok) return;
    setReconstruyendo(true);
    try {
      const n = await reconstruirIndice();
      toast.success(`Índice reconstruido — ${n.toLocaleString("es-AR")} fila(s).`);
      cargarEstado();
      setRecargaBusqueda((n) => n + 1); // vuelve a buscar con el índice nuevo
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

  // Filas del índice con los datos manuales de OP ya superpuestos. Todo lo de
  // abajo (ordenar, fijar, agrupar, CSV) sale de acá, así nunca se ve un valor
  // viejo por un lado y el nuevo por otro.
  const rowsConOp = useMemo(() => aplicarOpDatos(rows, opDatos), [rows, opDatos]);

  const sortedByCol = useMemo(() => {
    if (!sortCol) return rowsConOp;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rowsConOp].sort((a, b) => {
      const va = (a as unknown as Record<string, unknown>)[sortCol];
      const vb = (b as unknown as Record<string, unknown>)[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return compararValores(va, vb, sortCol, dir);
    });
  }, [rowsConOp, sortCol, sortDir]);

  // Filas fijadas: las que están fijadas Y presentes en la búsqueda actual, en
  // orden de fijado. Se releen desde `rows` para mostrar siempre el dato más
  // fresco (por si se reconstruyó el índice).
  const pinnedRows = useMemo(() => {
    if (!pinnedKeys.length) return [];
    const byKey = new Map(rowsConOp.map((r) => [rowKey(r), r]));
    return pinnedKeys.map((k) => byKey.get(k)).filter((r): r is BusquedaRow => !!r);
  }, [pinnedKeys, rowsConOp]);

  // Filas fijadas SIEMPRE arriba (en orden de fijado), y debajo el resto en el
  // orden elegido — misma función que en Stock por Zona.
  const sorted = useMemo(() => {
    if (!pinnedRows.length) return sortedByCol;
    const pinnedSet = new Set(pinnedRows.map(rowKey));
    const rest = sortedByCol.filter((r) => !pinnedSet.has(rowKey(r)));
    return [...pinnedRows, ...rest];
  }, [sortedByCol, pinnedRows]);

  const handleSort = useCallback((col: string) => {
    if (resizingRef.current || Date.now() - lastResizeEnd.current < 300) return;
    setSort((prev) => {
      if (prev.col !== col) return { col, dir: "asc" };
      // En una pestaña, el tercer clic vuelve al orden manual (el de arrastrar):
      // si no, una vez ordenada por columna no había forma de recuperarlo sin
      // salir y volver a entrar.
      if (isTabMode && prev.dir === "desc") return { col: null, dir: "asc" };
      return { col, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }, [isTabMode]);

  // Copia las filas tildadas del índice a una pestaña — TODAS, también las que
  // se tildaron en otra búsqueda (ver `filasSeleccionadas`). Las que ya están
  // (mismo row_key) se saltean para no duplicar.
  const handleAddSelected = useCallback(async (tabId: string) => {
    // Sin `stock_za`: se pega al mostrar (no viene del índice) y copiado
    // quedaría congelado en la pestaña con el valor de hoy.
    const elegidas = filasSeleccionadas()
      .map(({ stock_za: _stock, ...r }) => r) as unknown as BusquedaRow[];
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
      const creadas = await addFilas(tabId, nuevas, rowKey, siguienteOrden(destinoFilas));
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
  }, [filasSeleccionadas, activeTab, tabFilas, tabs]);

  /** Copia UNA fila del índice a una pestaña (desde el menú contextual). */
  const handleAddRowToTab = useCallback(async (tabId: string, r: BusquedaRow) => {
    try {
      const destinoFilas = tabId === activeTab ? tabFilas : await fetchTabFilas(tabId);
      const destino = tabs.find((t) => t.id === tabId)?.nombre ?? "la pestaña";
      if (destinoFilas.some((f) => f.row_key === rowKey(r))) {
        toast.info(`Esa fila ya está en «${destino}».`);
        return;
      }
      const creadas = await addFilas(tabId, [r], rowKey, siguienteOrden(destinoFilas));
      if (tabId === activeTab) setTabFilas((p) => [...p, ...creadas]);
      toast.success(`Fila copiada a «${destino}».`);
    } catch (e) {
      toast.error(`No se pudo copiar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [activeTab, tabFilas, tabs]);

  /**
   * Arma y abre el menú contextual de una fila. Junta las acciones que antes
   * estaban repartidas entre iconitos de la columna de acciones (fijar,
   * borrar) y gestos sin anunciar (doble click para editar).
   *
   * Recibe la columna sobre la que se hizo click para poder ofrecer «Editar
   * esta columna» y «Copiar valor» de esa celda puntual.
   */
  /** Marca/desmarca filas para la tarjeta «Próximas Entregas» de Transformadores. */
  const handleMarcarTarjeta = useCallback(async (filaIds: string[], valor: boolean) => {
    const ids = new Set(filaIds);
    const filas = tabFilas.filter((f) => ids.has(f.id));
    if (!filas.length) return;
    try {
      await marcarEnTarjeta(filas.map((f) => ({ id: f.id, datos: f.datos })), valor);
      setTabFilas((prev) => prev.map((f) =>
        ids.has(f.id)
          ? { ...f, datos: { ...f.datos, [TRACK_KEYS.enTarjeta]: valor ? "true" : "" } }
          : f
      ));
      setSelected(new Set());
      const n = filas.length;
      toast.success(
        valor
          ? `${n} fila${n === 1 ? "" : "s"} enviada${n === 1 ? "" : "s"} a la tarjeta.`
          : `${n} fila${n === 1 ? "" : "s"} quitada${n === 1 ? "" : "s"} de la tarjeta.`
      );
    } catch (e) {
      toast.error(`No se pudo actualizar la tarjeta: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [tabFilas]);



  // ── Filas que efectivamente se pintan ──
  // Un solo shape para los dos modos, así la tabla no se duplica: en el índice
  // maestro la data es la BusquedaRow; en una pestaña, el `datos` de la fila
  // copiada (que además trae las claves de seguimiento).

  // Igual que en el índice: las filas copiadas quedaron congeladas el día que
  // se agregaron, así que la descripción y la zona de la OP se superponen
  // desde op_datos para mostrar siempre lo último cargado.
  const tabFilasConOp = useMemo(() => {
    if (!opDatos.size) return tabFilas;
    return tabFilas.map((f) => {
      const [datos] = aplicarOpDatos([f.datos], opDatos);
      return datos === f.datos ? f : { ...f, datos };
    });
  }, [tabFilas, opDatos]);

  // Dentro de una pestaña el buscador filtra las filas que ya están copiadas,
  // no vuelve a pegarle al índice.
  const tabFilasFiltradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tabFilasConOp;
    // Dentro de una pestaña se busca SIEMPRE en todos los campos: el selector
    // de campo no se muestra acá, y respetarlo igual dejaría un filtro
    // invisible aplicándose (el que quedó elegido en el índice maestro).
    return tabFilasConOp.filter((f) =>
      Object.values(f.datos).some((v) => v != null && String(v).toLowerCase().includes(q))
    );
  }, [tabFilasConOp, query]);

  // El mismo filtro de fechas que en el maestro, pero acá SÍ va del lado del
  // cliente y es correcto: la pestaña tiene todas sus filas cargadas, no un
  // recorte de 500. Sin esto el control quedaría visible dentro de una pestaña
  // sin hacer nada.
  const tabFilasEnRango = useMemo(() => {
    if (!fechaAplicada) return tabFilasFiltradas;
    const desde = fechaAplicada.desde ? fechaMs(fechaAplicada.desde) : null;
    const hasta = fechaAplicada.hasta ? fechaMs(fechaAplicada.hasta) : null;
    return tabFilasFiltradas.filter((f) => {
      const ms = fechaMs(f.datos[fechaAplicada.campo]);
      // Sin fecha en ese campo queda afuera: «las de tal período» no incluye
      // «las que no tienen fecha». Mismo criterio que el filtro del servidor.
      if (Number.isNaN(ms)) return false;
      if (desde != null && !Number.isNaN(desde) && ms < desde) return false;
      if (hasta != null && !Number.isNaN(hasta) && ms > hasta) return false;
      return true;
    });
  }, [tabFilasFiltradas, fechaAplicada]);

  const tabFilasOrdenadas = useMemo(() => {
    if (!sortCol) return tabFilasEnRango;        // sin sort → orden manual
    const dir = sortDir === "asc" ? 1 : -1;
    return [...tabFilasEnRango].sort((a, b) => {
      const va = a.datos[sortCol];
      const vb = b.datos[sortCol];
      if (va == null || va === "") return 1;
      if (vb == null || vb === "") return -1;
      return compararValores(va, vb, sortCol, dir);
    });
  }, [tabFilasEnRango, sortCol, sortDir]);

  const displayRows = useMemo(() => {
    if (isTabMode) {
      return tabFilasOrdenadas.map((f) => ({
        key: f.id, filaId: f.id, data: f.datos as Record<string, unknown>,
      }));
    }
    return sorted.map((r) => ({
      // ⚠ El id de `busqueda_index`, NO rowKey: rowKey se arma con
      // (fuente, artículo, OP, línea, envío) y si el índice trae dos filas con
      // esos cinco valores iguales, las dos comparten clave — y como los datos
      // también son iguales, el orden las deja pegadas. Seleccionar una
      // marcaba las dos («se selecciona la de abajo también»). El id es único
      // por construcción.
      //
      // rowKey NO se toca: se persiste en buscador_tab_filas.row_key y en los
      // fijados de localStorage, así que sigue usándose para esas dos cosas.
      key: String(r.id), filaId: undefined as string | undefined,
      // El stock no viene del índice: se pega acá, cruzando por la matrícula
      // normalizada (los dos exports difieren en el sufijo ".0").
      data: { ...r, stock_za: stockZA.get(r.articulo_key ?? "") ?? null } as unknown as Record<string, unknown>,
    }));
  }, [isTabMode, tabFilasOrdenadas, sorted, stockZA]);

  // Mantiene `selDatos` al día: saca lo deseleccionado y guarda el dato de lo
  // seleccionado que está a la vista. En una pestaña sale de todas sus filas
  // (también las ocultas por el filtro), así una edición posterior se exporta
  // con el valor nuevo.
  useEffect(() => {
    const c = selDatos.current;
    for (const k of [...c.keys()]) if (!selected.has(k)) c.delete(k);
    if (!selected.size) return;
    const fuente = isTabMode
      ? new Map(tabFilasConOp.map((f) => [f.id, f.datos as Record<string, unknown>]))
      : new Map(displayRows.map((r) => [r.key, r.data]));
    for (const k of selected) {
      const d = fuente.get(k);
      if (d) c.set(k, d);
    }
  }, [selected, displayRows, tabFilasConOp, isTabMode]);

  /**
   * Grupos plegados, ya resueltos para renderizar. Tres reglas, en orden:
   *
   *   1. Mientras se busca → todos ABIERTOS, sin tocar lo guardado. Si no, el
   *      filtro deja los resultados escondidos adentro de grupos cerrados y la
   *      búsqueda parece no encontrar nada. Al limpiar la búsqueda vuelve a
   *      verse lo que el usuario había dejado.
   *   2. Si la pestaña tiene plegado guardado → se respeta tal cual.
   *   3. Si nunca se tocó → todos cerrados, para ver de un vistazo qué hay sin
   *      scrollear cientos de filas.
   */
  // Con una búsqueda activa los grupos arrancan todos abiertos, y plegar o
  // desplegar vale SOLO para esa búsqueda: no se guarda. Antes se guardaba
  // partiendo del Set vacío de la búsqueda, y al limpiarla aparecían abiertos
  // todos los grupos que estaban cerrados (para todos, si era una pestaña
  // compartida).
  const hayBusqueda = !!query.trim();
  const [colapsadosBusqueda, setColapsadosBusqueda] = useState<Set<string>>(new Set());
  useEffect(() => { setColapsadosBusqueda(new Set()); }, [hayBusqueda, activeTab]);
  const colapsados = useMemo(() => {
    if (hayBusqueda) return colapsadosBusqueda;
    if (colapsadosGuardados) return colapsadosGuardados;
    return new Set(displayRows.map((r) => groupKeyOf(r.data, agruparPor)));
  }, [hayBusqueda, colapsadosBusqueda, colapsadosGuardados, displayRows, agruparPor]);
  const setColapsadosVista = useCallback((keys: string[]) => {
    if (hayBusqueda) setColapsadosBusqueda(new Set(keys));
    else patchLayout({ colapsados: keys });
  }, [hayBusqueda, patchLayout]);

  // ── Agrupado (solo en pestañas) ──
  // Una matrícula tiene una fila por (OP, línea, envío), así que una familia
  // entera desborda la tabla. Agrupando, cada valor del criterio elegido
  // (matrícula / SIC / OP) es un encabezado plegable y debajo cuelgan sus filas.
  type GrupoItem = { tipo: "grupo"; key: string; gkey: string; titulo: string; subtitulo: string; count: number; filaIds: string[] };
  type FilaItem  = { tipo: "fila";  key: string; filaId?: string; data: Record<string, unknown> };

  const displayItems = useMemo<(GrupoItem | FilaItem)[]>(() => {
    const filas: FilaItem[] = displayRows.map((r) => ({ tipo: "fila", ...r }));
    if (!isTabMode || !agrupar) return filas;

    // Se respeta el orden en que aparecen: así el agrupado no pelea con el
    // orden manual ni con el sort por columna.
    const grupos = new Map<string, FilaItem[]>();
    for (const f of filas) {
      const gk = groupKeyOf(f.data, agruparPor);
      if (!grupos.has(gk)) grupos.set(gk, []);
      grupos.get(gk)!.push(f);
    }
    const out: (GrupoItem | FilaItem)[] = [];
    for (const [gk, items] of grupos) {
      const { titulo, subtitulo } = grupoTitulo(gk, items[0].data, agruparPor);
      const filaIds = items.map((f) => f.filaId).filter((id): id is string => !!id);
      out.push({ tipo: "grupo", key: `g:${gk}`, gkey: gk, titulo, subtitulo, count: items.length, filaIds });
      if (!colapsados.has(gk)) out.push(...items);
    }
    return out;
  }, [displayRows, isTabMode, agrupar, agruparPor, colapsados]);

  // Arrastrar reescribe el orden MANUAL: con la tabla ordenada por una columna
  // no se ve ningún cambio y se guardaba igual un orden distinto al visible.
  const puedeArrastrar = isTabMode && !agrupar && puedoEditar && !sortCol;

  // ── Selección por click, estilo explorador de archivos ────────────────────
  // Reemplaza a los checkboxes por fila: click selecciona sola, ctrl (o ⌘)
  // suma/saca, shift arma el rango contra la última fila clickeada. El menú
  // contextual actúa sobre esta selección.
  //
  // El rango se arma sobre las filas COMO SE VEN (displayItems ya viene
  // ordenado y agrupado), no sobre el array de datos: shift+click tiene que
  // seleccionar lo que hay visualmente entre las dos filas, que con el
  // agrupado activo no es lo mismo que el orden de origen.
  const keysVisibles = useMemo(
    () => displayItems.filter((it) => it.tipo === "fila").map((it) => it.key),
    [displayItems]
  );
  const ultimaClickeada = useRef<string | null>(null);

  /**
   * ⇧ clic: suma a la selección múltiple el rango visible desde la última fila
   * tocada. Si esa fila ya no está a la vista (otra búsqueda, grupo plegado,
   * filtro), no hay rango posible: suma solo la fila clickeada — nunca borra
   * lo que había.
   */
  const seleccionarRango = useCallback((key: string) => {
    const a = ultimaClickeada.current ? keysVisibles.indexOf(ultimaClickeada.current) : -1;
    const b = keysVisibles.indexOf(key);
    const rango = a === -1 || b === -1 ? [key] : keysVisibles.slice(Math.min(a, b), Math.max(a, b) + 1);
    setSelected((prev) => new Set([...prev, ...rango]));
    setInspeccionada(null);
    ultimaClickeada.current = key;
  }, [keysVisibles]);

  const handleRowClick = useCallback((e: React.MouseEvent, key: string) => {
    if (e.shiftKey) { seleccionarRango(key); return; }
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/⌘ acumula sobre lo que ya había — incluida la fila inspeccionada,
      // que pasa a ser parte de la selección múltiple.
      setSelected((prev) => {
        const s = new Set(prev);
        if (inspeccionada && inspeccionada !== key) s.add(inspeccionada);
        if (s.has(key)) s.delete(key); else s.add(key);
        return s;
      });
      setInspeccionada(null);
    } else {
      // Clic simple: exclusivo (§4.16) — inspecciona esa fila y libera la
      // selección múltiple. EXCEPTO si parte de la selección quedó fuera de
      // la vista (tildada en otra búsqueda): esa no se ve, así que borrarla
      // con un clic que solo buscaba mirar una fila la perdía sin aviso. Ahí
      // el clic solo inspecciona; se libera con la ✕ de la barra o con Esc.
      setSelected((prev) => {
        if (!prev.size) return prev;
        const visibles = new Set(keysVisibles);
        for (const k of prev) if (!visibles.has(k)) return prev;
        return new Set();
      });
      setInspeccionada(key);
    }
    ultimaClickeada.current = key;
  }, [seleccionarRango, inspeccionada, keysVisibles]);

  /** Checkbox de la fila: suma/saca de la selección múltiple (⇧ = rango). */
  const handleCheck = useCallback((e: React.MouseEvent, key: string) => {
    if (e.shiftKey) { seleccionarRango(key); return; }
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return s;
    });
    ultimaClickeada.current = key;
  }, [seleccionarRango]);

  const liberarSeleccion = useCallback(() => {
    setSelected(new Set());
    setInspeccionada(null);
    setAddMenuOpen(false);
  }, []);

  const toggleGrupo = useCallback((gk: string) => {
    const s = new Set(colapsados);
    if (s.has(gk)) s.delete(gk); else s.add(gk);
    setColapsadosVista([...s]);
  }, [colapsados, setColapsadosVista]);

  /** Menú contextual del encabezado de un GRUPO (dentro de una pestaña). */
  const abrirMenuGrupo = useCallback((
    e: React.MouseEvent,
    g: { gkey: string; titulo: string; count: number; filaIds: string[] }
  ) => {
    e.preventDefault();
    const cerrado = colapsados.has(g.gkey);
    const items: (CtxItem | "sep")[] = [
      {
        label: cerrado ? "Abrir grupo" : "Cerrar grupo",
        icon: cerrado ? ChevronDown : ChevronRight,
        onClick: () => toggleGrupo(g.gkey),
      },
      {
        label: "Abrir todos",
        icon: ChevronDown,
        onClick: () => setColapsadosVista([]),
      },
      {
        label: "Cerrar todos",
        icon: ChevronRight,
        onClick: () => setColapsadosVista([...new Set(displayRows.map((r) => groupKeyOf(r.data, agruparPor)))]),
      },
      {
        label: "Copiar nombre",
        icon: Copy,
        onClick: () => {
          navigator.clipboard.writeText(g.titulo)
            .then(() => toast.success("Copiado."))
            .catch(() => toast.error("No se pudo copiar."));
        },
      },
    ];
    if (puedoEditar) {
      items.push("sep");
      items.push({
        label: `Quitar «${g.titulo}» entero`,
        icon: Trash2,
        danger: true,
        hint: `${g.count}`,
        disabled: !g.filaIds.length,
        onClick: () => handleDeleteGrupo(g.filaIds, g.titulo),
      });
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [colapsados, displayRows, agruparPor, puedoEditar, toggleGrupo, handleDeleteGrupo, setColapsadosVista]);

  // Cantidad de grupos distintos en la pestaña, según el criterio (para el contador).
  const gruposCount = useMemo(
    () => new Set(displayRows.map((r) => groupKeyOf(r.data, agruparPor))).size,
    [displayRows, agruparPor]
  );

  // Exporta las columnas visibles, en el orden elegido (igual a lo que se ve
  // en pantalla). Las columnas ocultas no se pierden — siguen en el índice.
  /**
   * Exporta filas a un .xlsx de verdad, no a CSV.
   *
   * El CSV obligaba a elegir separador y codificación, y en es-AR terminaba
   * abriéndose con todo en una sola columna según la configuración regional de
   * cada máquina. Un xlsx no tiene esa ambigüedad. `xlsx` ya es dependencia
   * (se usa para LEER las planillas), y se importa dinámico para no sumarle
   * peso al bundle del Buscador, que es la pantalla más pesada.
   */
  const exportarAExcel = useCallback(async (
    filas: Record<string, unknown>[],
    cols: { key: string; label: string }[],
    nombre: string,
  ) => {
    if (!filas.length) { toast.error("No hay filas para exportar."); return; }
    try {
      const XLSX = await import("xlsx");
      const aoa = [
        cols.map((c) => c.label),
        ...filas.map((f) => cols.map((c) => valorExportable(c.key, f))),
      ];
      // Las Date se escriben como fecha de Excel con formato dd/mm/aaaa.
      const ws = XLSX.utils.aoa_to_sheet(aoa, { dateNF: "dd/mm/yyyy" });
      // Ancho de columna aproximado: el del título o 10, lo que sea mayor.
      ws["!cols"] = cols.map((c) => ({ wch: Math.max(10, c.label.length + 2) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Datos");
      XLSX.writeFile(wb, `${nombre.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-")}.xlsx`);
      toast.success(`${filas.length} fila(s) exportadas.`);
    } catch (e) {
      toast.error(`No se pudo exportar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  /**
   * Columnas de la vista actual, en el orden EXACTO en que se ven (sale de
   * `mergedCols`). Antes las de seguimiento iban siempre al final del Excel
   * aunque en pantalla estuvieran intercaladas.
   */
  const colsVisibles = useMemo(
    () => mergedCols.map((x) => (x.kind === "data"
      ? { key: x.key, label: x.data.label }
      : { key: x.key, label: x.track.label })),
    [mergedCols]
  );

  const abrirMenuFila = useCallback((
    e: React.MouseEvent,
    ctx: { key: string; filaId?: string; data: Record<string, unknown>; colKey?: string }
  ) => {
    e.preventDefault();

    // Click derecho sobre una fila que NO está seleccionada: pasa a ser la
    // selección. Es lo que hace cualquier explorador de archivos, y evita el
    // error de creer que la acción del menú va a aplicarse a lo que estaba
    // seleccionado antes cuando en realidad aplica a otra fila.
    // Si la fila no está en la selección múltiple, el menú actúa SOLO sobre
    // ella (y queda inspeccionada, para que se vea a cuál apunta). Si está,
    // actúa sobre toda la selección.
    const enSeleccion = selected.has(ctx.key);
    if (!enSeleccion) {
      setInspeccionada(ctx.key);
      ultimaClickeada.current = ctx.key;
    }
    const objetivoKeys = enSeleccion ? selected : new Set([ctx.key]);

    const items: (CtxItem | "sep")[] = [];

    const colKey    = ctx.colKey;
    const label     = colKey ? LABEL_POR_COL[colKey] ?? colKey : "";
    const esManual  = !!colKey && OP_MANUAL_COLS.has(colKey);
    const numeroOp  = String(ctx.data.numero_op ?? "");
    const editable  = !!colKey && (esManual ? (puedoEditar && !!numeroOp) : (isTabMode && puedoEditar));
    const editKey   = isTabMode ? ctx.filaId : ctx.key;
    const valor     = colKey ? String(ctx.data[colKey] ?? "") : "";

    if (colKey) {
      items.push({
        label: `Editar «${label}»`,
        icon: Pencil,
        disabled: !editable,
        hint: esManual && editable ? "toda la OP" : undefined,
        onClick: () => setEditing({ filaId: editKey!, key: colKey, valor }),
      });
      items.push({
        label: "Copiar valor",
        icon: Copy,
        disabled: !valor,
        onClick: () => {
          navigator.clipboard.writeText(valor)
            .then(() => toast.success("Copiado."))
            .catch(() => toast.error("No se pudo copiar."));
        },
      });
    }

    if (isTabMode) {
      if (items.length) items.push("sep");

      items.push({
        label: selected.has(ctx.key) ? "Quitar de la selección" : "Seleccionar",
        icon: selected.has(ctx.key) ? X : Check,
        onClick: () => setSelected((prev) => {
          const s = new Set(prev);
          if (s.has(ctx.key)) s.delete(ctx.key); else s.add(ctx.key);
          return s;
        }),
      });

      // Si la fila del click está dentro de la selección, la acción va sobre
      // toda la selección; si no, sobre esa sola fila. Es lo que espera
      // cualquiera que venga de un explorador de archivos, y evita que un click
      // derecho descuidado sobre otra fila opere sobre la selección entera.
      const objetivo = enSeleccion ? [...selected] : ctx.filaId ? [ctx.filaId] : [];
      // Map y no `find` por id: con miles de filas seleccionadas, abrir el menú
      // era O(selección × filas).
      const porId = new Map(tabFilas.map((f) => [f.id, f]));
      const enTarjeta = (id: string) =>
        String(porId.get(id)?.datos[TRACK_KEYS.enTarjeta] ?? "") === "true";
      // Solo se ofrece "Quitar" cuando TODO el objetivo ya está en la tarjeta:
      // con una selección mezclada, lo útil es terminar de mandarla entera.
      const todasEn = objetivo.length > 0 && objetivo.every(enTarjeta);
      items.push({
        label: todasEn ? "Quitar de Tarjeta" : "Enviar a Tarjeta",
        icon: CalendarClock,
        hint: objetivo.length > 1 ? String(objetivo.length) : undefined,
        disabled: !puedoEditar || !objetivo.length,
        onClick: () => handleMarcarTarjeta(objetivo, !todasEn),
      });

      items.push("sep");
      // Sobre una fila seleccionada actúa sobre TODA la selección, igual que
      // «Enviar a Tarjeta» y «Exportar» (antes quitaba solo esa fila aunque
      // hubiera 10 marcadas).
      const aQuitar = enSeleccion ? [...selected] : ctx.filaId ? [ctx.filaId] : [];
      items.push({
        label: aQuitar.length > 1 ? `Quitar ${aQuitar.length} filas de la pestaña` : "Quitar de la pestaña",
        icon: Trash2,
        danger: true,
        disabled: !puedoEditar || !aQuitar.length,
        onClick: () => quitarFilas(aQuitar),
      });
      if (agrupar) {
        const gk = groupKeyOf(ctx.data, agruparPor);
        const delGrupo = tabFilas.filter((f) => groupKeyOf(f.datos, agruparPor) === gk);
        const { titulo } = grupoTitulo(gk, ctx.data, agruparPor);
        items.push({
          label: `Quitar «${titulo}» entero`,
          icon: Trash2,
          danger: true,
          hint: `${delGrupo.length}`,
          disabled: !puedoEditar || !delGrupo.length,
          onClick: () => handleDeleteGrupo(delGrupo.map((f) => f.id), titulo),
        });
      }
    } else {
      if (items.length) items.push("sep");
      // Fijar sigue trabajando con rowKey y no con ctx.key: los fijados se
      // guardan en localStorage y se resuelven contra el índice por rowKey, así
      // que usar el id nuevo dejaría huérfano todo lo ya fijado.
      const claveFijado = rowKey(ctx.data as unknown as BusquedaRow);
      const fijada = pinnedKeys.includes(claveFijado);
      items.push({
        label: fijada ? "Quitar de fijadas" : "Fijar arriba",
        icon: Pin,
        onClick: () => togglePin(claveFijado),
      });
      items.push({
        label: selected.has(ctx.key) ? "Quitar de la selección" : "Seleccionar",
        icon: selected.has(ctx.key) ? X : Check,
        onClick: () => setSelected((prev) => {
          const s = new Set(prev);
          if (s.has(ctx.key)) s.delete(ctx.key); else s.add(ctx.key);
          return s;
        }),
      });

      const editables = tabs.filter((t) => permisoDe(t) === "edicion");
      if (editables.length) {
        items.push("sep");
        for (const t of editables) {
          items.push({
            label: `Agregar a «${t.nombre}»`,
            icon: ListPlus,
            onClick: () => handleAddRowToTab(t.id, ctx.data as unknown as BusquedaRow),
          });
        }
      }
    }

    // Exportar la selección. Va al final y en los dos modos: reemplaza al
    // botón «CSV» que estaba fijo en la barra. Al abrir el menú la fila
    // clickeada ya entró en la selección (ver arriba), así que nunca exporta
    // vacío ni algo distinto de lo que el usuario ve marcado.
    const seleccionadas = enSeleccion
      ? filasSeleccionadas()
      : displayRows.filter((r) => objetivoKeys.has(r.key)).map((r) => r.data);
    if (seleccionadas.length) {
      items.push("sep");
      items.push({
        label: seleccionadas.length > 1 ? `Exportar selección a Excel (${seleccionadas.length})` : "Exportar fila a Excel",
        icon: Download,
        onClick: () => exportarAExcel(
          seleccionadas,
          colsVisibles,
          isTabMode
            ? `${tabs.find((t) => t.id === activeTab)?.nombre ?? "pestana"}-seleccion`
            : `busqueda-${query.trim().replace(/\s+/g, "-") || "todo"}`,
        ),
      });
    }

    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [
    isTabMode, puedoEditar, agrupar, agruparPor, tabFilas, pinnedKeys, selected,
    tabs, permisoDe, togglePin, quitarFilas, handleDeleteGrupo, handleAddRowToTab,
    handleMarcarTarjeta, displayRows, colsVisibles, exportarAExcel, activeTab, query, filasSeleccionadas,
  ]);

  /** Menú contextual de una PESTAÑA (click derecho en la barra de arriba). */
  const abrirMenuPestana = useCallback((e: React.MouseEvent, t: BuscadorTab) => {
    e.preventDefault();
    const propia  = t.user_id === userId;
    const permiso = permisoDe(t);
    const items: (CtxItem | "sep")[] = [];

    if (activeTab !== t.id) {
      items.push({
        label: "Abrir",
        icon: Database,
        onClick: () => { setActiveTab(t.id); setEditing(null); setSort({ col: null, dir: "asc" }); },
      });
    }
    // Renombrar lo puede hacer el dueño y también un colaborador con edición.
    if (propia || permiso === "edicion") {
      items.push({ label: "Renombrar…", icon: Pencil, onClick: () => handleRenameTab(t) });
    }
    // Compartir y borrar son solo del dueño.
    if (propia) {
      items.push({ label: "Compartir…", icon: Share2, onClick: () => setShareTabId(t.id) });
      items.push("sep");
      items.push({ label: "Borrar pestaña", icon: Trash2, danger: true, onClick: () => handleDeleteTab(t) });
    }

    // Exportar: disponible siempre, incluso en una compartida de solo
    // lectura — leer los datos es justamente lo que puede hacer un lector.
    // Se exporta la pestaña ENTERA, no lo que esté filtrado en pantalla: el
    // click derecho puede caer sobre una pestaña que ni siquiera está abierta.
    if (items.length) items.push("sep");
    items.push({
      label: "Exportar a Excel",
      icon: Download,
      onClick: async () => {
        try {
          const filas = t.id === activeTab ? tabFilas : await fetchTabFilas(t.id);
          // Columnas según la config de ESA pestaña, no la de la vista actual.
          const cfg     = tabLayouts[t.id];
          const ordenBase = cfg?.order ?? DEFAULT_COL_ORDER;
          const orden   = [...ordenBase, ...DEFAULT_COL_ORDER.filter((k) => !ordenBase.includes(k))];
          const ocultas = new Set(cfg?.hidden ?? []);
          const cols = [
            ...orden
              .filter((k) => !ocultas.has(k))
              .map((k) => COLS.find((c) => c.key === k))
              .filter((c): c is ColDef => !!c)
              .map((c) => ({ key: c.key as string, label: c.label })),
            ...TRACK_COLS.filter((c) => !ocultas.has(c.key)).map((c) => ({ key: c.key, label: c.label })),
          ];
          await exportarAExcel(filas.map((f) => f.datos), cols, t.nombre);
        } catch (err) {
          toast.error(`No se pudo exportar: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });

    // Compartida de solo lectura y ya abierta: no hay nada que ofrecer.
    if (!items.length) return;
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [activeTab, userId, permisoDe, handleRenameTab, handleDeleteTab, tabFilas, tabLayouts, exportarAExcel]);

  const conOp    = sorted.filter((r) => r.fuente === "op").length;
  const soloMov  = sorted.filter((r) => r.fuente === "transaccion").length;
  const soloCat  = sorted.filter((r) => r.fuente === "catalogo").length;
  const soloSic  = sorted.filter((r) => r.fuente === "sic").length;

  // ── Densidad (§4.19) ───────────────────────────────────────────────────────
  // Índice: por usuario (lib/tableLayout). Pestaña: en su config, igual que
  // columnas y agrupado — la vista es la misma para todos los que la abren.
  const [densityIndice, setDensityIndice] = useState<Density>("normal");
  useEffect(() => {
    if (!userId) return;
    const d = loadTableLayout(userId, INDICE_LAYOUT_ID).density;
    if (isDensity(d)) setDensityIndice(d);
  }, [userId]);
  const density: Density = isTabMode
    ? (isDensity(tabCfg?.density) ? tabCfg!.density as Density : "normal")
    : densityIndice;
  const ROW_H = DENSITY_ROW_H[density];

  const cycleDensity = () => {
    const next = DENSITY_ORDER[(DENSITY_ORDER.indexOf(density) + 1) % DENSITY_ORDER.length];
    if (isTabMode) { patchLayout({ density: next }); return; }
    setDensityIndice(next);
    if (userId) saveTableLayout(userId, INDICE_LAYOUT_ID, { density: next });
  };

  // Densidad (§4.19): vive en la línea de contexto, pegada a la tabla — en la
  // barra de herramientas la hacía saltar a dos renglones. En una pestaña es
  // la vista compartida, así que en solo lectura no se toca.
  // ⚠ NO hay «Restablecer vista» (§4.20), ni en el índice ni en las pestañas
  //   (pedido del usuario): un clic borraba sin deshacer el orden, las columnas
  //   ocultas y los anchos armados a mano — y en una pestaña, a todos los que
  //   la comparten.
  const vistaBloqueada = isTabMode && !puedoEditar;
  const vistaControls = (
    <span className="inline-flex items-center gap-0.5" style={{ borderLeft: "1px solid var(--ido-border)", paddingLeft: 8 }}>
      <button
        type="button"
        className="ido-btn ido-btn-text"
        style={{ height: 24, fontSize: 12 }}
        onClick={cycleDensity}
        disabled={vistaBloqueada}
        title="Altura de fila: compacta 32px · normal 40px · cómoda 52px"
      >
        Densidad: {DENSITY_LABEL[density]}
      </button>
    </span>
  );

  // ── Doble clic en el borde de una columna: ajusta al contenido (§4.15) ────
  // Mide con canvas el valor más ancho de lo que se está viendo, con la fuente
  // real de la celda (mono para números/códigos/fechas, sans para texto, la del
  // badge para Tipo/Estado), y nunca por debajo de lo que pide el título.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const autoFitCol = useCallback((key: string) => {
    const canvas = canvasRef.current ?? (canvasRef.current = document.createElement("canvas"));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const def = COLS.find((c) => c.key === key);
    const track = TRACK_COLS.find((c) => c.key === key);
    const esPill = key === "tipo" || key === "estado_matricula" || track?.tipo === "estado";
    const mono = def ? !!(def.num || def.mono) : track?.tipo === "fecha";
    const textoDe = (d: Record<string, unknown>): string => {
      const v = d[key];
      if (v == null || v === "") return "";
      if (key === "tipo") return String(v).toLowerCase().startsWith("s") ? "Servicio" : "Material";
      if (key === "estado_matricula") return /activ/i.test(String(v)) && !/inactiv/i.test(String(v)) ? "Activo" : String(v);
      if (key === "envio") return d.envios_linea && Number(d.envios_linea) > 1 ? `${v}/${d.envios_linea}` : String(v);
      if (DATE_COLS.has(key)) return fmtFechaISO(String(v));
      if (def?.num) return fmtNum(v as number);
      return String(v);
    };
    ctx.font = esPill ? sansFont(11.5, 600) : mono ? monoFont(13) : sansFont(13);
    // + padding del chip (9+9) + borde + ícono de Tipo
    const extra = esPill ? (key === "tipo" ? 37 : 20) : 0;
    const fit = autoFitTextWidth(ctx, displayRows.map((r) => textoDe(r.data)), 64) + extra;
    ctx.font = sansFont(10, 500);
    const label = (LABEL_POR_COL[key] ?? key).toUpperCase();
    const labelW = Math.ceil(ctx.measureText(label).width + label.length * 1 + 18 + 24);
    const w = Math.min(700, Math.max(fit, labelW));
    patchLayout({ widths: { ...effWidths, [key]: w } });
  }, [displayRows, effWidths, patchLayout]);

  const startResize = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { col: key, startX: e.clientX, startWidth: effWidths[key] ?? DEFAULT_COL_WIDTHS[key] };
    setResizingCol(key);
  };

  // ── Geometría de la grilla (§4.11) ─────────────────────────────────────────
  const SEL_W = isTabMode ? 78 : 58;
  const widthOf = (key: string) => effWidths[key] ?? DEFAULT_COL_WIDTHS[key] ?? 120;
  const gridTemplateColumns = `${SEL_W}px ${mergedCols.map((x) => `${widthOf(x.key)}px`).join(" ")}`;
  const contentW = SEL_W + mergedCols.reduce((sum, x) => sum + widthOf(x.key), 0);
  const colRightX = (key: string) => {
    let x = SEL_W;
    for (const c of mergedCols) { x += widthOf(c.key); if (c.key === key) break; }
    return x;
  };

  // ── Virtualización: solo se montan las filas visibles ──────────────────────
  // Una pestaña no tiene límite de filas (el índice corta en 500). Encabezados
  // de grupo y filas conviven en la misma lista con alturas distintas.
  const scrollRef = useRef<HTMLDivElement>(null);
  const GROUP_H = 40;
  const HEADER_H = 38;   // encabezado sticky de la tabla (mismo alto que abajo)
  // Callbacks ESTABLES: con funciones nuevas en cada render el virtualizador
  // recalculaba las posiciones de todas las filas (O(n)) en cada render —
  // cada tecla, cada movimiento al redimensionar.
  const estimateSize = useCallback(
    (i: number) => (displayItems[i]?.tipo === "grupo" ? GROUP_H : ROW_H),
    [displayItems, ROW_H],
  );
  const getItemKey = useCallback((i: number) => displayItems[i]?.key ?? i, [displayItems]);
  const rowVirtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    overscan: 10,
  });
  // Cambiar la densidad no cambia las claves: hay que pedirle que vuelva a medir.
  useEffect(() => { rowVirtualizer.measure(); }, [ROW_H, rowVirtualizer]);

  // Selección: totales para la barra flotante.
  const seleccionVisibleKeys = useMemo(
    () => displayRows.filter((r) => selected.has(r.key)).map((r) => r.key),
    [displayRows, selected]
  );
  const fueraDeVista = selected.size - seleccionVisibleKeys.length;
  const todosVisiblesSel = keysVisibles.length > 0 && keysVisibles.every((k) => selected.has(k));
  const algunoVisibleSel = keysVisibles.some((k) => selected.has(k));
  const toggleTodosVisibles = () => {
    // Solo agrega/saca lo VISIBLE: lo seleccionado en otra búsqueda se conserva.
    setSelected((prev) => {
      const s = new Set(prev);
      if (todosVisiblesSel) keysVisibles.forEach((k) => s.delete(k));
      else keysVisibles.forEach((k) => s.add(k));
      return s;
    });
    setInspeccionada(null);
  };
  // Las acciones de la barra van sobre TODA la selección, también lo tildado
  // en otra búsqueda / oculto por el filtro: es justamente para eso que se
  // conserva. La barra lo avisa («N fuera de esta búsqueda»).
  const enTarjetaTodas = useMemo(() => {
    if (!isTabMode || !selected.size) return false;
    const porId = new Map(tabFilas.map((f) => [f.id, f]));
    for (const k of selected) {
      if (String(porId.get(k)?.datos[TRACK_KEYS.enTarjeta] ?? "") !== "true") return false;
    }
    return true;
  }, [isTabMode, selected, tabFilas]);
  const exportarSeleccion = () => exportarAExcel(
    filasSeleccionadas(),
    colsVisibles,
    isTabMode
      ? `${tabs.find((t) => t.id === activeTab)?.nombre ?? "pestana"}-seleccion`
      : `busqueda-${query.trim().replace(/\s+/g, "-") || "todo"}`,
  );

  // ── Alto de la tabla: ajustado a la ventana ───────────────────────────────
  // El panel termina justo en el borde de abajo de la ventana, así la barra de
  // scroll HORIZONTAL queda siempre a la vista: antes el alto era un número
  // fijo (100vh − 190px) que no contaba todo lo que hay arriba (header de la
  // app, pestañas, barra, contexto), la tabla se pasaba de la ventana y para
  // ir a la derecha había que bajar primero la página.
  // Se mide dónde arranca el panel en la página y se le resta lo que queda
  // debajo (padding de la card y del <main>). Se recalcula al cambiar el
  // tamaño de la ventana o lo de arriba (la barra se parte en dos renglones,
  // aparece la línea de contexto…).
  const cardRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [altoTabla, setAltoTabla] = useState<number | null>(null);
  useLayoutEffect(() => {
    const card = cardRef.current, panel = panelRef.current;
    if (!card || !panel) return;
    const medir = () => {
      const p = panel.getBoundingClientRect();
      const debajoEnCard = card.getBoundingClientRect().bottom - p.bottom;
      const main = card.closest("main");
      const padMain = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const top = p.top + window.scrollY;
      const alto = Math.max(260, Math.floor(window.innerHeight - top - debajoEnCard - padMain));
      setAltoTabla((prev) => (prev === alto ? prev : alto));
    };
    medir();
    // La sección entra con una animación de 500ms que la desplaza 16px: se
    // vuelve a medir cuando termina.
    const t = setTimeout(medir, 550);
    const ro = new ResizeObserver(medir);
    ro.observe(card);
    window.addEventListener("resize", medir);
    return () => { clearTimeout(t); ro.disconnect(); window.removeEventListener("resize", medir); };
  }, []);

  // ── Teclado ────────────────────────────────────────────────────────────────
  // ↑/↓ mueve la fila inspeccionada (hace falta haber clickeado una antes, así
  // las flechas no le roban el scroll a la página), Esc suelta la selección y
  // Ctrl/⌘+C copia la fila inspeccionada — o toda la selección — como texto
  // separado por tabs, listo para pegar en Excel.
  // No actúa mientras se escribe en un campo, se edita una celda o hay un
  // menú / modal / desplegable abierto (esos manejan sus propias teclas).
  const teclado = useRef({ keysVisibles, displayItems, inspeccionada, selected, editing, ctxMenu, colsVisibles, filasSeleccionadas, displayRows });
  teclado.current = { keysVisibles, displayItems, inspeccionada, selected, editing, ctxMenu, colsVisibles, filasSeleccionadas, displayRows };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = teclado.current;
      const el = e.target as HTMLElement | null;
      if (e.isComposing || t.editing || t.ctxMenu) return;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (document.querySelector(".ido-modal-overlay, [data-radix-popper-content-wrapper]")) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!t.inspeccionada || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const i = t.keysVisibles.indexOf(t.inspeccionada);
        const j = i === -1 ? 0 : i + (e.key === "ArrowDown" ? 1 : -1);
        const key = t.keysVisibles[j];
        if (!key) return;
        e.preventDefault();
        setInspeccionada(key);
        ultimaClickeada.current = key;
        // Scroll a mano y no `scrollToIndex`: el virtualizador no sabe del
        // encabezado sticky de 38px que está adentro del mismo scroll, así que
        // dejaba la fila tapada por él (subiendo) o 38px bajo el borde (bajando).
        const idx = t.displayItems.findIndex((it) => it.key === key);
        const m = rowVirtualizer.measurementsCache[idx];
        const sc = scrollRef.current;
        if (m && sc) {
          if (m.start < sc.scrollTop) sc.scrollTop = m.start;
          else if (m.end + HEADER_H > sc.scrollTop + sc.clientHeight) sc.scrollTop = m.end + HEADER_H - sc.clientHeight;
        }
        return;
      }

      if (e.key === "Escape") {
        if (!t.selected.size && !t.inspeccionada) return;
        e.preventDefault();
        setSelected(new Set());
        setInspeccionada(null);
        setAddMenuOpen(false);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        // Si hay texto marcado con el mouse, se copia eso (comportamiento normal).
        if (window.getSelection()?.toString()) return;
        const filas = t.selected.size
          ? t.filasSeleccionadas()
          : t.displayRows.filter((r) => r.key === t.inspeccionada).map((r) => r.data);
        if (!filas.length) return;
        e.preventDefault();
        const lineas = filas.map((f) => t.colsVisibles.map((c) => valorCopiable(c.key, f)).join("\t"));
        // Varias filas llevan encabezado (para pegarlas como tabla nueva); una
        // sola no, así se puede pegar debajo de una planilla que ya lo tiene.
        if (filas.length > 1) lineas.unshift(t.colsVisibles.map((c) => c.label).join("\t"));
        navigator.clipboard.writeText(lineas.join("\n"))
          .then(() => toast.success(filas.length > 1 ? `${filas.length} filas copiadas.` : "Fila copiada."))
          .catch(() => toast.error("No se pudo copiar."));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rowVirtualizer]);

  // Menú «Agregar a pestaña» de la barra flotante: cierra con clic afuera.
  const addMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addMenuOpen) return;
    const h = (e: MouseEvent) => { if (!addMenuRef.current?.contains(e.target as Node)) setAddMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [addMenuOpen]);

  // Handlers estables para la barra de pestañas memoizada.
  const selectIndice = useCallback(() => {
    // Vuelve al orden con el que abre el maestro (SIC más recientes), no al que
    // hubiera quedado de la pestaña: son dos vistas con criterios distintos y
    // la pestaña resetea el sort a manual.
    setActiveTab(null); setEditing(null); setSort({ col: "numero_sic", dir: "desc" });
  }, []);
  const selectTab = useCallback((id: string) => {
    setActiveTab(id); setEditing(null); setSort({ col: null, dir: "asc" });
  }, []);

  return (
    <div className="ido-terminal">
      {/* Card. El título de la sección ya lo pone el header general, así que
          acá va directo la barra de herramientas para que la tabla suba. */}
      <div
        ref={cardRef}
        className="p-3 overflow-hidden space-y-3"
        style={{ background: CARD_BG, border: PANEL_BORDER, borderRadius: 12, position: "relative" }}
      >
        {/* Barra de pestañas (§4.7). El índice maestro es la vista de siempre;
            las demás son listas de seguimiento propias o compartidas.
            Compartir / Renombrar / Borrar: clic derecho en la pestaña. */}
        <BuscadorTabsBar
          tabs={tabs}
          activeTab={activeTab}
          userId={userId}
          permisoDe={permisoDe}
          activeCount={isTabMode ? tabFilas.length : 0}
          onSelectIndice={selectIndice}
          onSelectTab={selectTab}
          onRename={handleRenameTab}
          onContext={abrirMenuPestana}
          onCreate={handleCreateTab}
        />

        {/* Barra de filtros (§4.8) + acciones, en una sola fila para no gastar
            alto vertical. Controles de 38px (§4.2). */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="ido-inputbox" style={{ width: 260, flexShrink: 0 }}>
            {loading
              ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" style={{ color: "var(--ido-text-2)" }} />
              : <Search className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--ido-text-2)" }} />}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                campoBusqueda
                  ? `Buscar en ${CAMPO_OPTIONS.find((o) => o.value === campoBusqueda)?.label}…`
                  : "SIC, OP, matrícula, preparador, proveedor, zona…"
              }
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} title="Limpiar búsqueda" style={{ color: "var(--ido-text-2)", display: "grid", placeItems: "center" }}>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Selector de campo — afina la búsqueda a una sola columna. Solo en
              el índice maestro: dentro de una pestaña el universo ya lo acotó
              el usuario al elegir qué filas copiar, y son pocas — filtrar por
              campo ahí no aporta y ocupa lugar en la barra.
              DropdownMenu de Radix: animación de entrada y salida, clic afuera,
              foco y teclado sin mantener nada de eso acá. */}
          {!isTabMode && (
            <DropdownMenu open={campoMenuOpen} onOpenChange={setCampoMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="Acotar la búsqueda a un solo campo"
                  className={cn("ido-selectbtn shrink-0", campoBusqueda && "is-on")}
                >
                  {(() => {
                    const opt = CAMPO_OPTIONS.find((o) => o.value === campoBusqueda);
                    const Icon = opt?.icon ?? Search;
                    return <><Icon className="w-3.5 h-3.5" style={{ color: "var(--ido-text-2)" }} />{opt?.label ?? "Todo el índice"}</>;
                  })()}
                  <ChevronDown className="ido-chev w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={6} className="ido-terminal ido-pop min-w-[200px] border-0">
                <DropdownMenuItem onSelect={() => setCampoBusqueda(null)} className="ido-pop-item focus:bg-transparent">
                  <Search className="w-3.5 h-3.5" />
                  <span className="flex-1">Todo el índice</span>
                  {campoBusqueda === null && <Check className="w-3.5 h-3.5" style={{ color: "var(--ido-accent)" }} />}
                </DropdownMenuItem>
                <DropdownMenuSeparator className="ido-pop-sep" />
                {CAMPO_OPTIONS.map((o) => {
                  const Icon = o.icon;
                  return (
                    <DropdownMenuItem key={o.value} onSelect={() => setCampoBusqueda(o.value)} className="ido-pop-item focus:bg-transparent">
                      <Icon className="w-3.5 h-3.5" />
                      <span className="flex-1">{o.label}</span>
                      {o.value === campoBusqueda && <Check className="w-3.5 h-3.5" style={{ color: "var(--ido-accent)" }} />}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Filtro por rango de fechas. El desplegable elige CUÁL fecha se
              filtra: sin eso el rango es ambiguo (¿cuándo se pidió?, ¿para
              cuándo se comprometió?, ¿cuándo se movió?). Se aplica con
              «Buscar» (botón primario) y no al tipear: una fecha a medio
              escribir dispararía una consulta por tecla. */}
          <div className={cn("ido-inputbox shrink-0", fechaAplicada && "is-on")} style={{ gap: 6, paddingRight: 6 }}>
            <CalendarClock className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--ido-text-2)" }} />
            <Select value={fechaCampo} onValueChange={(v) => setFechaCampo(v as CampoFecha)}>
              <SelectTrigger
                size="sm"
                title="Sobre qué fecha se aplica el rango"
                className="h-[26px] border-none bg-transparent px-1 text-[13px] shadow-none focus-visible:ring-0"
                style={{ color: "var(--ido-text)", maxWidth: 190 }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="ido-terminal ido-pop border-0">
                {CAMPOS_FECHA.map((f) => (
                  // ⚠ Se pisa el `focus:bg-accent` que trae SelectItem: Radix
                  //   enfoca el ítem elegido al abrir y eso pintaba una barra
                  //   verde a full apenas se abría.
                  <SelectItem
                    key={f.key}
                    value={f.key}
                    className="ido-pop-item focus:bg-white/5 focus:text-[var(--ido-text)] data-[state=checked]:text-[var(--ido-text)]"
                  >
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span style={{ width: 1, height: 18, background: "var(--ido-border)" }} />
            <DatePicker valor={fechaDesde} onChange={setFechaDesde} placeholder="Desde" />
            <span style={{ color: "var(--ido-text-2)" }}>→</span>
            <DatePicker valor={fechaHasta} onChange={setFechaHasta} placeholder="Hasta" />
            <button
              type="button"
              onClick={() => setFechaAplicada(
                fechaDesde || fechaHasta ? { campo: fechaCampo, desde: fechaDesde, hasta: fechaHasta } : null
              )}
              disabled={!fechaDesde && !fechaHasta}
              title="Aplicar el filtro de fechas"
              className="ido-btn ido-btn-primary"
              style={{ height: 26, padding: "0 10px", fontSize: 11.5 }}
            >
              Buscar
            </button>
            {(fechaAplicada || fechaDesde || fechaHasta) && (
              <button
                type="button"
                onClick={() => { setFechaDesde(""); setFechaHasta(""); setFechaAplicada(null); }}
                title="Quitar el filtro de fechas"
                style={{ color: "var(--ido-text-2)", display: "grid", placeItems: "center" }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <ColumnsMenu
            cols={isTabMode ? COL_META : COL_META_INDICE}
            order={effOrder}
            hidden={effHidden}
            onToggle={toggleColHidden}
            onReorder={setOrden}
            onReset={resetColumnas}
            locked={isTabMode && !puedoEditar}
          />

          {/* Agrupar — un solo botón: el estado on/off y el criterio son la
              misma decisión, así que tenerlos separados obligaba a dos clics
              para algo que es una sola elección. «Nada» es el off. */}
          {isTabMode && (
            <div className="inline-flex items-center gap-2 shrink-0">
              <div className="relative" ref={agruparMenuRef}>
                <button
                  type="button"
                  onClick={() => puedoEditar && setAgruparMenuOpen((v) => !v)}
                  disabled={!puedoEditar}
                  title={puedoEditar ? "Agrupar las filas por un criterio" : "Solo lectura — el agrupado es la misma vista para todos"}
                  className={cn("ido-selectbtn", agruparMenuOpen && "is-open")}
                >
                  <Rows3 className="w-3.5 h-3.5" style={{ color: "var(--ido-text-2)" }} />
                  {agrupar
                    ? `Agrupar: ${AGRUPAR_OPTIONS.find((o) => o.value === agruparPor)?.label ?? ""}`
                    : "Agrupar: Nada"}
                  {puedoEditar && <ChevronDown className="ido-chev w-3.5 h-3.5" />}
                </button>

                {agruparMenuOpen && puedoEditar && (
                  <div className="ido-pop absolute left-0 top-[calc(100%+6px)] z-50" style={{ minWidth: 190 }}>
                    {/* «Nada» apaga el agrupado sin tocar el criterio guardado:
                        al volver a elegir uno, la pestaña recuerda cuál era. */}
                    <button type="button" onClick={() => { setAgrupar(false); setAgruparMenuOpen(false); }} className="ido-pop-item">
                      <X className="w-3.5 h-3.5" />
                      <span className="flex-1">Nada</span>
                      {!agrupar && <Check className="w-3.5 h-3.5" style={{ color: "var(--ido-accent)" }} />}
                    </button>
                    <div className="ido-pop-sep" />
                    {AGRUPAR_OPTIONS.map((o) => {
                      const Icon = o.icon;
                      const activo = agrupar && o.value === agruparPor;
                      return (
                        <button key={o.value} type="button" onClick={() => { setAgruparPor(o.value); setAgruparMenuOpen(false); }} className="ido-pop-item">
                          <Icon className="w-3.5 h-3.5" />
                          <span className="flex-1">{o.label}</span>
                          {activo && <Check className="w-3.5 h-3.5" style={{ color: "var(--ido-accent)" }} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {agrupar && gruposCount > 0 && (
                <button
                  type="button"
                  onClick={() => setColapsadosVista(
                    colapsados.size ? [] : [...new Set(displayRows.map((r) => groupKeyOf(r.data, agruparPor)))]
                  )}
                  title={colapsados.size ? "Abrir todos los grupos" : "Cerrar todos los grupos"}
                  className="ido-btn ido-btn-ghost"
                  style={{ height: TOOLBAR_H, width: TOOLBAR_H, padding: 0, justifyContent: "center" }}
                >
                  {colapsados.size ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          )}

          {/* Las acciones sobre la selección (Agregar a pestaña, Enviar a
              Tarjeta, Exportar, Quitar selección) pasaron a la barra flotante
              de abajo (§4.16), que aparece con 2+ filas seleccionadas. */}

          {/* El botón de exportar salió de la barra: ocupaba lugar fijo para
              algo ocasional. Ahora está en el click derecho — sobre las filas
              (exporta la selección) y sobre una pestaña (la exporta entera). */}

          {/* Estado del índice: chip contador (§4.3). «Reconstruir» vive
              adentro de este menú y no suelto en la barra: tarda varios
              minutos y, desde que cada carga masiva reconstruye sola, casi
              nunca hace falta a mano. */}
          {indice && !isTabMode && (
            <div className="relative shrink-0" ref={indiceMenuRef} style={{ marginLeft: "auto" }}>
              <button
                type="button"
                onClick={() => setIndiceMenuOpen((v) => !v)}
                title="Estado del índice de búsqueda"
                className="ido-chipbtn"
              >
                {reconstruyendo
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--ido-warning)" }} />
                  : <Database className="w-3.5 h-3.5" />}
                {reconstruyendo ? "Reconstruyendo…" : <><b>{indice.filas.toLocaleString("es-AR")}</b> filas</>}
                <ChevronDown className="w-3 h-3" />
              </button>

              {indiceMenuOpen && (
                <div className="ido-pop absolute right-0 top-[calc(100%+6px)] z-50" style={{ width: 290, padding: 12 }}>
                  <div className="ido-pop-label" style={{ padding: "0 0 8px" }}>Índice de búsqueda</div>
                  <p className="text-[13px] mb-1" style={{ color: "var(--ido-text)" }}>
                    <span className="ido-mono">{indice.filas.toLocaleString("es-AR")}</span> filas indexadas
                  </p>
                  {indice.actualizado && (
                    <p className="text-[12px] mb-2.5" style={{ color: "var(--ido-text-2)" }}>
                      Actualizado el <span className="ido-mono">{fmtFechaISO(indice.actualizado)}</span>
                    </p>
                  )}
                  <p className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--ido-text-2)" }}>
                    Se reconstruye solo después de cargar Envíos, SIC, MATRICULAS o
                    Transacciones. Hacelo a mano solo si cambiaste un Material/Servicio
                    o el catálogo y no querés esperar a la próxima carga.
                  </p>
                  <button
                    type="button"
                    onClick={handleReconstruir}
                    disabled={reconstruyendo}
                    className="ido-btn ido-btn-ghost w-full justify-center"
                    style={{ height: 32 }}
                  >
                    {reconstruyendo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {reconstruyendo ? "Reconstruyendo…" : "Reconstruir ahora"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Línea de contexto (§4.9): conteo en mono, aviso de lista truncada
            en ámbar, atajos a la derecha en <kbd>. En una pestaña cuenta sus
            filas, no resultados del índice. */}
        {isTabMode && !loadingTab && tabFilas.length > 0 && (
          <div className="ido-context">
            <span>
              <b>{tabFilasEnRango.length.toLocaleString("es-AR")}</b>
              {query.trim() || fechaAplicada ? <> de <b>{tabFilas.length.toLocaleString("es-AR")}</b> filas</> : " filas"}
              {agrupar && gruposCount > 0 && (() => {
                const nombre = agruparPor === "articulo" ? "matrícula" : agruparPor === "numero_sic" ? "SIC" : "OP";
                return <> en <b>{gruposCount.toLocaleString("es-AR")}</b> {nombre}{gruposCount === 1 || agruparPor !== "articulo" ? "" : "s"}</>;
              })()}
            </span>
            <span className="inline-flex items-center gap-1.5 flex-wrap" title="Atajos: ↑/↓ moverse entre filas · Esc soltar la selección · Ctrl+C copiar filas (para pegar en Excel)">
              <kbd className="ido-kbd">Ctrl+clic</kbd> varias
              · <kbd className="ido-kbd">Ctrl+C</kbd> copiar
              · <kbd className="ido-kbd">Doble clic</kbd> editar
              · <kbd className="ido-kbd">Clic der.</kbd> exportar y más
              {puedeArrastrar && <>· arrastrá para reordenar</>}
              {vistaControls}
            </span>
          </div>
        )}

        {(!isTabMode && buscado) && (
          <div className="ido-context">
            <span className="inline-flex items-center flex-wrap gap-x-1">
              <span>
                <b>{sorted.length.toLocaleString("es-AR")}</b> resultados
                {conOp > 0 && <> · <b>{conOp.toLocaleString("es-AR")}</b> con OP</>}
                {soloSic > 0 && <> · <b>{soloSic.toLocaleString("es-AR")}</b> SIC sin OP todavía</>}
                {soloMov > 0 && <> · <b>{soloMov.toLocaleString("es-AR")}</b> solo con movimientos (OP fuera de la planilla)</>}
                {soloCat > 0 && <> · <b>{soloCat.toLocaleString("es-AR")}</b> solo en catálogo</>}
                {sorted.length >= 500 && <> · <span className="is-warn">lista truncada a 500 filas, afiná la búsqueda</span></>}
              </span>
              {pinnedRows.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  · <Pin className="w-3 h-3" fill="var(--ido-cat-1)" strokeWidth={2} style={{ color: "var(--ido-cat-1)" }} />
                  <b>{pinnedRows.length}</b> fijada{pinnedRows.length !== 1 ? "s" : ""}
                  <button type="button" onClick={unpinAll} className="ml-0.5 underline decoration-dotted" style={{ color: "var(--ido-text-2)" }}>
                    Quitar todas
                  </button>
                </span>
              )}
            </span>
            <span className="inline-flex items-center gap-1.5 flex-wrap" title="Atajos: ↑/↓ moverse entre filas · Esc soltar la selección · Ctrl+C copiar filas (para pegar en Excel)">
              <kbd className="ido-kbd">Ctrl+clic</kbd> varias
              · <kbd className="ido-kbd">Ctrl+C</kbd> copiar
              · <kbd className="ido-kbd">Clic der.</kbd> exportar y más
              {vistaControls}
            </span>
          </div>
        )}

        {/* Resultados — tabla en CSS grid (§4.11). UN solo contenedor de scroll
            para los dos ejes con el encabezado sticky adentro (si header y
            filas scrollean por separado se desincronizan en X). `minHeight`
            hace que el panel llegue siempre hasta abajo de la ventana aunque
            haya pocos resultados; con muchos, `maxHeight` corta y scrollea
            puertas adentro. */}
        <div
          ref={panelRef}
          className="overflow-hidden flex flex-col"
          style={{ background: PANEL_BG, border: PANEL_BORDER, borderRadius: 12, height: altoTabla ?? "calc(100vh - 190px)" }}
        >
          {isTabMode && loadingTab ? (
            <CargandoFilas texto="Cargando pestaña…" className="flex-1" />
          ) : isTabMode && !tabFilas.length ? (
            <div className="ido-loading flex-1" style={{ flexDirection: "column", gap: 10, height: "auto", textAlign: "center" }}>
              <ListPlus className="w-10 h-10" style={{ opacity: 0.2 }} />
              Esta pestaña está vacía.
              <span className="text-[12px]" style={{ color: "var(--ido-text-2)" }}>
                Andá a «Índice maestro», seleccioná las filas que quieras seguir y usá «Agregar a pestaña».
              </span>
            </div>
          ) : !isTabMode && loading && !sorted.length ? (
            // Spinner a pantalla completa SOLO si no hay nada que mostrar
            // (primera carga, o la búsqueda anterior no trajo nada). Con
            // resultados en pantalla, se quedan mientras llega lo nuevo: antes
            // la tabla desaparecía en cada tecla y en cada orden, y volvía con
            // el scroll en 0 (se perdía la columna que se estaba mirando).
            // Ordenar re-consulta al servidor (el orden va en la query), así
            // que el cartel tiene que decir eso y no "cargando".
            <CargandoFilas
              texto={ordenServidor ? "Ordenando…" : query.trim() ? "Buscando…" : "Cargando las OP más recientes…"}
              className="flex-1"
            />
          ) : !isTabMode && !sorted.length ? (
            <div className="ido-loading flex-1" style={{ flexDirection: "column", gap: 10, height: "auto", textAlign: "center" }}>
              <PackageOpen className="w-10 h-10" style={{ opacity: 0.2 }} />
              {query.trim() ? `Sin resultados para «${query.trim()}».` : "El índice no tiene filas todavía."}
              {indice?.filas === 0 && <span className="text-[12px]" style={{ color: "var(--ido-text-2)" }}>El índice está vacío — probá «Reconstruir índice».</span>}
            </div>
          ) : !mergedCols.length ? (
            <div className="ido-loading flex-1" style={{ flexDirection: "column", gap: 10, height: "auto" }}>
              <Columns3 className="w-10 h-10" style={{ opacity: 0.2 }} />
              Ocultaste todas las columnas — abrí «Columnas» para mostrar alguna.
            </div>
          ) : (
            <div
              ref={scrollRef}
              className="flex-1 min-h-0"
              // Mientras llega una búsqueda nueva, los resultados anteriores
              // quedan atenuados (además del spinner en la caja de búsqueda).
              style={{
                overflow: "auto",
                opacity: !isTabMode && loading ? 0.55 : 1, transition: "opacity 150ms var(--ido-ease)",
              }}
              // Clic en zona vacía libera la selección (§4.16).
              onClick={(e) => { if ((e.target as HTMLElement).dataset.empty) liberarSeleccion(); }}
              data-empty="1"
            >
              {/* minWidth 100%: si las columnas suman menos que el panel, las
                  filas igual llegan hasta el borde. */}
              <div data-empty="1" style={{ width: contentW, minWidth: "100%", minHeight: "100%", position: "relative" }}>
                {resizingCol && (
                  <>
                    {/* Guía de 1px que atraviesa la tabla + ancho actual (§4.15). */}
                    <div style={{ position: "absolute", top: 0, bottom: 0, left: colRightX(resizingCol), width: 1, background: "var(--ido-accent)", pointerEvents: "none", zIndex: 30 }} />
                    <div
                      className="ido-mono"
                      style={{
                        position: "absolute", top: 44, left: colRightX(resizingCol) + 6, zIndex: 31,
                        padding: "4px 8px", borderRadius: 6, background: "var(--ido-elevated)", border: "1px solid var(--ido-border)",
                        fontSize: 11, color: "var(--ido-text)", whiteSpace: "nowrap", pointerEvents: "none",
                      }}
                    >
                      {Math.round(widthOf(resizingCol))} px
                    </div>
                  </>
                )}

                {/* Encabezado sticky, fondo OPACO (las filas pasan por debajo).
                    La franja de color de arriba dice de qué tabla sale cada
                    columna (SIC / OP / Movimientos / Matrícula / Personalizadas). */}
                <div
                  style={{
                    display: "grid", gridTemplateColumns, height: HEADER_H,
                    position: "sticky", top: 0, zIndex: 10,
                    background: "var(--ido-surface)", borderBottom: "1px solid var(--ido-border-strong)",
                  }}
                >
                  <div className="flex items-center justify-center" style={{ background: "var(--ido-surface)" }}>
                    {keysVisibles.length > 0 && (
                      <IdoCheckbox
                        checked={todosVisiblesSel}
                        indeterminate={!todosVisiblesSel && algunoVisibleSel}
                        onClick={toggleTodosVisibles}
                        label={todosVisiblesSel ? "Quitar de la selección todo lo visible" : "Seleccionar todo lo visible"}
                      />
                    )}
                  </div>
                  {mergedCols.map((x) => {
                    const active = sortCol === x.key;
                    const group: ColGroup = x.kind === "data" ? x.data.group : "track";
                    const num = x.kind === "data" && !!x.data.num;
                    const label = x.kind === "data" ? x.data.label : x.track.label;
                    return (
                      <div
                        key={x.key}
                        onClick={() => handleSort(x.key)}
                        title={x.kind === "data" ? `${label} — fuente: ${GROUP_META[group].label}` : `${label} — columna personalizada (editable)`}
                        className={`ido-bs-head${active ? " is-active" : ""}`}
                        style={{ justifyContent: num ? "flex-end" : "flex-start", boxShadow: `inset 0 2.5px 0 0 ${GROUP_META[group].color}` }}
                      >
                        <span className="truncate">{label}</span>
                        <SortArrow active={active} dir={active ? sortDir : "asc"} className="w-3 h-3 shrink-0" />
                        <span
                          onMouseDown={(e) => startResize(e, x.key)}
                          onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); autoFitCol(x.key); }}
                          onClick={(e) => e.stopPropagation()}
                          title="Arrastrá para cambiar el ancho · doble clic para ajustar al contenido"
                          className="group absolute top-0 right-[-4px] bottom-0 w-2 cursor-col-resize z-20 flex justify-center"
                        >
                          <span
                            className={`w-[2px] h-full transition-opacity ${resizingCol === x.key ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                            style={{ background: "var(--ido-accent)", transitionDuration: "100ms" }}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Filas (virtualizadas) */}
                <div data-empty="1" style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
                  {rowVirtualizer.getVirtualItems().map((vi) => {
                    const item = displayItems[vi.index];
                    if (!item) return null;
                    const pos: CSSProperties = { position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` };

                    // Encabezado de grupo (pestaña agrupada): ocupa toda la fila y pliega el grupo.
                    if (item.tipo === "grupo") {
                      const cerrado = colapsados.has(item.gkey);
                      return (
                        <div
                          key={item.key}
                          className="ido-bs-group"
                          style={{ ...pos, height: GROUP_H }}
                          onContextMenu={(e) => abrirMenuGrupo(e, item)}
                        >
                          <button
                            type="button"
                            onClick={() => toggleGrupo(item.gkey)}
                            title={cerrado ? "Abrir grupo" : "Cerrar grupo"}
                            className="shrink-0 grid place-items-center rounded-[5px]"
                            style={{ width: 22, height: 22, color: "var(--ido-cat-4)" }}
                          >
                            {cerrado ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                          {puedoEditar && (
                            <button
                              type="button"
                              onClick={() => handleDeleteGrupo(item.filaIds, item.titulo)}
                              title={`Quitar de la pestaña las ${item.count} fila(s) de «${item.titulo}»`}
                              className="ido-icon-btn shrink-0"
                              style={{ width: 22, height: 22 }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleGrupo(item.gkey)}
                            className="flex items-center gap-2 text-left min-w-0"
                            // Sin flex-1: la fila de grupo mide lo que toda la
                            // tabla, y estirado el chip de líneas quedaba fuera
                            // de vista a la derecha.
                            style={{ position: "sticky", left: 0, maxWidth: "min(100%, 900px)" }}
                          >
                            <span className="ido-mono" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ido-text)" }}>{item.titulo}</span>
                            <span className="truncate" style={{ fontSize: 12, color: "var(--ido-text-2)" }}>{item.subtitulo}</span>
                            <span className="ido-chip ido-badge-neutral shrink-0" style={{ fontWeight: 500 }}>
                              <span className="ido-mono" style={{ color: "var(--ido-text)" }}>{item.count}</span> línea{item.count === 1 ? "" : "s"}
                            </span>
                          </button>
                        </div>
                      );
                    }

                    const { key, filaId, data } = item;
                    const i = vi.index;
                    const isPinned = !isTabMode && pinnedRows.length > 0 && i < pinnedRows.length;
                    const isLastPinned = isPinned && i === pinnedRows.length - 1;
                    const isSel = selected.has(key);
                    const isInsp = !isSel && inspeccionada === key;
                    const isDragOver = isTabMode && dragOverFilaId === filaId;
                    // Dentro de una pestaña la fila es una copia editable, no
                    // tiene sentido atenuar por fuente.
                    const dim = !isTabMode && data.fuente === "catalogo";
                    const enTarjeta = isTabMode && String(data[TRACK_KEYS.enTarjeta] ?? "") === "true";
                    const cls = [
                      "ido-bs-row",
                      isDragOver ? "is-dragover" : isSel ? "is-sel" : isInsp ? "is-insp" : isPinned ? "is-pinned" : "",
                      isLastPinned ? "is-pinned-last" : "",
                    ].join(" ");

                    return (
                      <div
                        key={key}
                        className={cls}
                        style={{ ...pos, gridTemplateColumns, height: ROW_H, opacity: dim ? 0.72 : 1 }}
                        onClick={(e) => handleRowClick(e, key)}
                        // ⇧ clic: el navegador selecciona texto en el mousedown, antes
                        // del click — se corta acá o el rango queda pintado de azul.
                        onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                        // Con el agrupado activo el arrastre se desactiva: mover una
                        // fila entre grupos no tiene sentido y el regrupado la
                        // devolvería a su grupo igual.
                        draggable={puedeArrastrar}
                        onDragStart={puedeArrastrar ? (e) => {
                          dragFilaId.current = filaId!;
                          e.dataTransfer.setData("text/plain", filaId!);
                          e.dataTransfer.effectAllowed = "move";
                        } : undefined}
                        onDragOver={puedeArrastrar ? (e) => {
                          e.preventDefault(); e.dataTransfer.dropEffect = "move";
                          setDragOverFilaId(filaId!);
                        } : undefined}
                        onDragLeave={puedeArrastrar ? () => setDragOverFilaId((k) => (k === filaId ? null : k)) : undefined}
                        onDrop={puedeArrastrar ? (e) => { e.preventDefault(); handleDropFila(filaId!); } : undefined}
                        onDragEnd={puedeArrastrar ? () => { dragFilaId.current = null; setDragOverFilaId(null); } : undefined}
                      >
                        {/* Columna fija: checkbox (§4.16) + indicadores. En una
                            pestaña, el handle de arrastre y la marca «en la
                            tarjeta»; en el índice, la chincheta de fijada. */}
                        <div
                          className="flex items-center justify-center gap-1.5"
                          onContextMenu={(e) => abrirMenuFila(e, { key, filaId, data })}
                        >
                          {isTabMode && (
                            <span
                              className={cn("grid place-items-center", puedeArrastrar && "cursor-grab active:cursor-grabbing")}
                              title={puedeArrastrar ? "Arrastrar para reordenar" : agrupar ? "Desactivá el agrupado para reordenar" : sortCol ? "Ordenada por columna — clic en el encabezado hasta volver al orden manual para reordenar" : "Solo lectura"}
                              style={{ color: "var(--ido-text-2)", opacity: puedeArrastrar ? 1 : 0.35 }}
                            >
                              <GripVertical className="w-3.5 h-3.5" />
                            </span>
                          )}
                          <IdoCheckbox checked={isSel} onClick={(e) => handleCheck(e, key)} label={isSel ? "Quitar de la selección" : "Seleccionar"} />
                          {enTarjeta && (
                            <span className="grid place-items-center" title="En «Próximas Entregas» — clic derecho para quitarla" style={{ color: GROUP_META.track.color }}>
                              <CalendarClock className="w-3.5 h-3.5" strokeWidth={2.2} />
                            </span>
                          )}
                          {isPinned && (
                            <span className="grid place-items-center" title="Fijada arriba — clic derecho para quitarla" style={{ color: "var(--ido-cat-1)" }}>
                              <Pin className="w-3.5 h-3.5" strokeWidth={2} fill="var(--ido-cat-1)" />
                            </span>
                          )}
                        </div>

                        {/* Columnas del índice y de seguimiento, en un solo orden (ver `mergedCols`). */}
                        {mergedCols.map((x) => {
                          if (x.kind === "track") {
                            const c = x.track;
                            const editando = editing?.filaId === filaId && editing?.key === c.key;
                            const val = String(data[c.key] ?? "");
                            const est = c.tipo === "estado" ? ESTADO_STYLE[val] : undefined;
                            return (
                              <div
                                key={c.key}
                                className={cn("ido-bs-cell", puedoEditar && !editando && "is-editable")}
                                style={{ padding: editando ? "0 4px" : undefined, color: "var(--ido-text)" }}
                                title={!puedoEditar ? "Solo lectura — pedile al dueño permiso de edición" : c.tipo === "texto" ? val : "Doble clic para editar"}
                                onDoubleClick={puedoEditar ? () => setEditing({ filaId: filaId!, key: c.key, valor: val }) : undefined}
                                onContextMenu={(e) => abrirMenuFila(e, { key, filaId, data, colKey: c.key })}
                              >
                                {editando ? (
                                  <CeldaEditor
                                    inicial={editing.valor}
                                    tipo={c.tipo}
                                    onGuardar={(v) => commitEdit(filaId!, c.key, v)}
                                    onCancelar={() => setEditing(null)}
                                  />
                                ) : (
                                  // Hover de celda editable (§4.4) en CSS: `.is-editable`.
                                  <>
                                    <span className="ido-bs-txt flex-1">
                                      {est ? (
                                        <span className="ido-chip" style={{ background: est.bg, color: est.fg }}>{val}</span>
                                      ) : c.tipo === "fecha" ? (
                                        <span className="ido-mono">{fmtFechaISO(val)}</span>
                                      ) : (
                                        val || <span style={{ color: "var(--ido-text-faint)" }}>—</span>
                                      )}
                                    </span>
                                  </>
                                )}
                              </div>
                            );
                          }
                          // Columnas del índice. En una pestaña son copias, así
                          // que se editan con doble clic. Las manuales de OP
                          // (descripción / zona) se editan TAMBIÉN en el índice
                          // maestro, donde no hay filaId: la clave es la fila.
                          const c = x.data;
                          const esManualOp = OP_MANUAL_COLS.has(c.key as string);
                          const numeroOp   = String(data.numero_op ?? "");
                          const editKey    = isTabMode ? filaId : key;
                          const editable   = esManualOp ? (puedoEditar && !!numeroOp) : (isTabMode && puedoEditar);
                          const editando   = editing?.filaId === editKey && editing?.key === c.key;
                          const contenido  = c.render
                            ? c.render(data as unknown as BusquedaRow)
                            : c.num ? fmtNum(data[c.key] as number) : ((data[c.key] ?? "") as ReactNode);
                          return (
                            <div
                              key={c.key}
                              className={cn("ido-bs-cell", editable && !editando && "is-editable", c.num && "tabular-nums")}
                              style={{
                                padding: editando ? "0 4px" : undefined,
                                justifyContent: c.num ? "flex-end" : "flex-start",
                                fontFamily: (c.num || c.mono) ? "var(--font-mono, ui-monospace, monospace)" : undefined,
                                color: c.key === "articulo" || c.key === "descripcion" || c.num ? "var(--ido-text)" : undefined,
                                fontWeight: c.key === "articulo" ? 500 : undefined,
                              }}
                              title={
                                esManualOp
                                  ? (!numeroOp ? "Esta fila no tiene OP"
                                     : !puedoEditar ? "Solo lectura — pedile al dueño permiso de edición"
                                     : `Doble clic para editar — se guarda para toda la OP ${numeroOp}`)
                                  : isTabMode ? (puedoEditar ? "Doble clic para editar" : "Solo lectura — pedile al dueño permiso de edición")
                                  : c.key === "descripcion" ? String(data.descripcion ?? "") : undefined
                              }
                              onDoubleClick={editable ? () => setEditing({ filaId: editKey!, key: c.key, valor: String(data[c.key] ?? "") }) : undefined}
                              onContextMenu={(e) => abrirMenuFila(e, { key, filaId, data, colKey: c.key as string })}
                            >
                              {editando ? (
                                <CeldaEditor
                                  inicial={editing.valor}
                                  alinear={c.num ? "right" : "left"}
                                  onGuardar={(v) => commitEdit(isTabMode ? filaId ?? null : null, c.key, v, numeroOp)}
                                  onCancelar={() => setEditing(null)}
                                />
                              ) : (
                                <>
                                  <span className="ido-bs-txt">{contenido}</span>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Barra flotante de selección en lote (§4.16): aparece con 2+ filas
            seleccionadas. En el índice la selección sobrevive a cambiar la
            búsqueda — las acciones van sobre lo que está a la vista, y la barra
            dice cuántas quedaron afuera para no prometer de más. */}
        {selected.size >= 2 && (
          <div className="ido-selbar">
            <span className="ido-selbar-count">
              <b>{selected.size.toLocaleString("es-AR")}</b> seleccionadas
              {fueraDeVista > 0 && (
                <span style={{ color: "var(--ido-text-2)" }} title="Las acciones de esta barra las incluyen">
                  {" "}· <b>{fueraDeVista.toLocaleString("es-AR")}</b> fuera de esta búsqueda
                </span>
              )}
            </span>
            <span className="ido-selbar-sep" />
            {!isTabMode && (
              <div className="relative" ref={addMenuRef}>
                <button
                  type="button"
                  className="ido-btn ido-btn-ghost"
                  style={{ height: 32 }}
                  onClick={() => setAddMenuOpen((v) => !v)}
                >
                  <ListPlus className="w-3.5 h-3.5" />
                  Agregar a pestaña
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                {addMenuOpen && (
                  <div className="ido-pop absolute left-0 bottom-[calc(100%+8px)] z-50" style={{ minWidth: 240, maxHeight: 320, overflowY: "auto" }}>
                    {(() => {
                      // Solo pestañas donde se puede escribir: una compartida
                      // "solo lectura" no admite que le agreguen filas.
                      const editables = tabs.filter((t) => permisoDe(t) === "edicion");
                      if (!editables.length) {
                        return (
                          <div className="px-2.5 py-2 text-[12px]" style={{ color: "var(--ido-text-2)" }}>
                            {tabs.length === 0
                              ? "No tenés pestañas todavía — creá una con el «+» de arriba."
                              : "No tenés ninguna pestaña editable — las compartidas contigo son de solo lectura."}
                          </div>
                        );
                      }
                      return editables.map((t) => (
                        <button key={t.id} type="button" onClick={() => handleAddSelected(t.id)} className="ido-pop-item">
                          <span className="flex-1 truncate">{t.nombre}</span>
                          {t.user_id !== userId && <span style={{ color: "var(--ido-text-2)", fontSize: 11 }}>compartida</span>}
                        </button>
                      ));
                    })()}
                  </div>
                )}
              </div>
            )}
            {isTabMode && (
              <button
                type="button"
                className="ido-btn ido-btn-ghost"
                style={{ height: 32 }}
                onClick={() => handleMarcarTarjeta([...selected], !enTarjetaTodas)}
                disabled={!puedoEditar}
                title="«Próximas Entregas» de Transformadores"
              >
                <CalendarClock className="w-3.5 h-3.5" />
                {enTarjetaTodas ? "Quitar de Tarjeta" : "Enviar a Tarjeta"}
              </button>
            )}
            <button type="button" className="ido-btn ido-btn-ghost" style={{ height: 32 }} onClick={exportarSeleccion}>
              <Download className="w-3.5 h-3.5" />
              Exportar
            </button>
            <button type="button" className="ido-selbar-close" title="Liberar selección" onClick={liberarSeleccion}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>


      {ctxMenu && <RowContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />}
      {dialogo}

      {shareTabId && (() => {
        const tab = tabs.find((t) => t.id === shareTabId);
        // Defensivo: si la pestaña se borró justo mientras el diálogo estaba
        // abierto, o si por algún motivo ya no es la tuya, no se renderiza.
        if (!tab || tab.user_id !== userId) return null;
        return (
          <ShareDialog
            tabId={tab.id}
            tabNombre={tab.nombre}
            ownerId={tab.user_id}
            onClose={() => setShareTabId(null)}
          />
        );
      })()}
    </div>
  );
}
