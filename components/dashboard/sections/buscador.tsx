"use client";

import { useState, useEffect, useMemo, useCallback, useRef, Fragment, type ReactNode, type ElementType, type CSSProperties, type DragEvent } from "react";
import { createPortal } from "react-dom";
import {
  Search, Loader2, X, Download, RefreshCw, Database, PackageOpen,
  ChevronDown, ChevronUp, ChevronsUpDown, Wrench, Package,
  Columns3, GripVertical, Eye, EyeOff, Pin, Plus, Trash2, Pencil, ListPlus,
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
  fetchTabs, createTab, renameTab, deleteTab, fetchTabFilas, addFilas,
  updateFilaDatos, deleteFilas, reorderFilas, updateTabConfig, marcarEnTarjeta,
  fetchMisPermisos, fetchColaboradores, compartirTab, descompartirTab, fetchEquipo,
  TRACK_KEYS, ESTADOS,
  type BuscadorTab, type TabFila, type TabConfig, type AgruparPor,
  type Permiso, type Colaborador, type PerfilBasico,
} from "@/lib/buscadorTabs";
import { getStockZonaMap } from "@/lib/stockStorage";
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
          className="text-[12px] text-left px-1 rounded transition-colors hover:bg-white/5 outline-none"
          style={{ color: valor ? "oklch(0.88 0 0)" : "oklch(0.45 0 0)", width: 92 }}
        >
          {valor ? fmtFechaISO(valor) : placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0 bg-panel border-hairline">
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
              onClick={() => { onChange(""); setAbierto(false); }}
              className="w-full text-[12px] py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-panel-2 transition-colors"
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

const GROUP_META: Record<ColGroup, { label: string; color: string }> = {
  sic:   { label: "SIC",            color: "#c4b5fd" },  // violeta — nivel de arriba
  op:    { label: "OP",             color: "#7dd3fc" },  // celeste — planilla OP
  tx:    { label: "Movimientos",    color: "#86efac" },  // verde — transacciones reales
  cat:   { label: "Matrícula",      color: "#fcd34d" },  // ámbar — catálogo (transversal)
  // Las únicas que NO salen de ninguna tabla del índice: las escribe el usuario
  // sobre la fila copiada. Color propio (rosa) para que se lean de un vistazo
  // como "esto lo puse yo", no como un dato importado.
  track: { label: "Personalizadas", color: "#f9a8d4" },
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
              {locked ? "Solo lectura" : "Mostrar y ordenar"}
            </span>
            {!locked && (
              <button
                onClick={onReset}
                className="text-[11px] hover:text-foreground transition-colors"
                style={{ color: "oklch(0.55 0 0)" }}
              >
                Restablecer
              </button>
            )}
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
                <div
                  className="text-[11px] uppercase tracking-wide px-2 pt-2 pb-1 mt-1"
                  style={{ color: "oklch(0.5 0 0)", borderTop: "1px solid oklch(1 0 0 / 0.06)" }}
                >
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
                className={cn("flex items-center gap-2 px-2 py-1.5 rounded-[7px] select-none", !locked && "cursor-grab active:cursor-grabbing")}
                style={{
                  opacity: isHidden ? 0.5 : 1,
                  background: isDragOver ? "oklch(0.27 0.005 270)" : "transparent",
                }}
              >
                <GripVertical className="w-3.5 h-3.5 shrink-0" style={{ color: locked ? "oklch(0.3 0 0)" : "oklch(0.45 0 0)" }} />
                <span
                  title={GROUP_META[c.group].label}
                  style={{ width: 7, height: 7, borderRadius: 2, background: GROUP_META[c.group].color, flexShrink: 0 }}
                />
                <button
                  onClick={() => onToggle(c.key)}
                  disabled={locked}
                  className="shrink-0 inline-flex items-center justify-center disabled:cursor-default"
                  title={locked ? undefined : isHidden ? "Mostrar columna" : "Ocultar columna"}
                >
                  {isHidden
                    ? <EyeOff className="w-3.5 h-3.5" style={{ color: "oklch(0.5 0 0)" }} />
                    : <Eye className="w-3.5 h-3.5" style={{ color: locked ? "oklch(0.5 0 0)" : "#86efac" }} />}
                </button>
                <span className="text-[13px] truncate flex-1" style={{ color: "oklch(0.88 0 0)" }}>
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
          <span style={{ color: "oklch(0.5 0 0)" }}>/{r.envios_linea}</span>
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
};

const COLUMNS_KEY = "buscador-columns";
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

  return createPortal(
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="animate-in fade-in zoom-in-95 duration-100"
      style={{
        position: "fixed", left: pos.x, top: pos.y, zIndex: 200,
        minWidth: 210, padding: 5,
        maxHeight: "min(70vh, 420px)", overflowY: "auto",
        background: "oklch(0.205 0.005 270)", border: PANEL_BORDER, borderRadius: 10,
        boxShadow: "0 18px 40px -18px rgba(0,0,0,0.75)",
      }}
    >
      {state.items.map((it, i) =>
        it === "sep" ? (
          <div key={`s${i}`} style={{ height: 1, background: "oklch(1 0 0 / 0.07)", margin: "4px 6px" }} />
        ) : (
          <button
            key={it.label}
            disabled={it.disabled}
            onClick={() => { it.onClick(); onClose(); }}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[7px] text-left text-[13px] transition-colors disabled:opacity-35 disabled:cursor-default"
            style={{ color: it.danger ? "#fca5a5" : "oklch(0.88 0 0)" }}
            onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = it.danger ? "oklch(0.30 0.08 25 / 0.35)" : "oklch(0.27 0.005 270)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <it.icon className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 truncate">{it.label}</span>
            {it.hint && <span className="text-[11px] shrink-0" style={{ color: "oklch(0.5 0 0)" }}>{it.hint}</span>}
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

  const dialog = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "oklch(0 0 0 / 0.55)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full animate-in fade-in zoom-in-95 duration-150"
        style={{
          maxWidth: 420, background: "oklch(0.205 0.005 270)", border: PANEL_BORDER,
          borderRadius: 14, boxShadow: "0 24px 60px -20px rgba(0,0,0,0.7)",
        }}
      >
        <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: PANEL_BORDER }}>
          <div className="flex items-center gap-2 min-w-0">
            <Share2 className="w-4 h-4 shrink-0" style={{ color: "#7dd3fc" }} />
            <span className="text-[14px] font-semibold truncate" style={{ color: "hsl(var(--foreground))" }}>
              Compartir «{tabNombre}»
            </span>
          </div>
          <button onClick={onClose} className="shrink-0 grid place-items-center rounded-[6px]" style={{ width: 24, height: 24, color: "oklch(0.55 0 0)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Colaboradores actuales */}
          <div>
            <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: "oklch(0.55 0 0)" }}>
              Con acceso
            </p>
            {loading ? (
              <div className="flex items-center gap-2 py-2 text-[13px]" style={{ color: "oklch(0.6 0 0)" }}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />Cargando…
              </div>
            ) : !colaboradores.length ? (
              <p className="text-[13px]" style={{ color: "oklch(0.55 0 0)" }}>
                Todavía no compartiste esta pestaña con nadie.
              </p>
            ) : (
              <div className="space-y-1">
                {colaboradores.map((c) => {
                  const nombre = [c.nombre, c.apellido].filter(Boolean).join(" ").trim()
                    || equipoPorId.get(c.user_id)?.email || "Usuario";
                  return (
                    <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-[8px]" style={{ background: "oklch(0.16 0.005 270)" }}>
                      <span className="text-[13px] flex-1 truncate" style={{ color: "hsl(var(--foreground))" }}>{nombre}</span>
                      <select
                        value={c.permiso}
                        onChange={(e) => handleCambiarPermiso(c.user_id, e.target.value as Permiso)}
                        className="text-[12px] rounded-[6px] outline-none"
                        style={{ background: "oklch(0.22 0.005 270)", border: PANEL_BORDER, color: "oklch(0.8 0 0)", padding: "3px 6px" }}
                      >
                        <option value="lectura">Lectura</option>
                        <option value="edicion">Edición</option>
                      </select>
                      <button
                        onClick={() => handleQuitar(c.user_id)}
                        title="Quitar acceso"
                        className="grid place-items-center rounded-[6px] transition-colors"
                        style={{ width: 24, height: 24, color: "oklch(0.5 0 0)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "#fca5a5"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "oklch(0.5 0 0)"; }}
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
            <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: "oklch(0.55 0 0)" }}>
              Agregar
            </p>
            <div className="flex items-center gap-2 mb-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre o email…"
                className="flex-1 text-[13px] outline-none"
                style={{ background: "oklch(0.16 0.005 270)", border: PANEL_BORDER, borderRadius: 8, padding: "7px 10px", color: "hsl(var(--foreground))" }}
              />
              <select
                value={nuevoPermiso}
                onChange={(e) => setNuevoPermiso(e.target.value as Permiso)}
                className="text-[12px] rounded-[8px] outline-none shrink-0"
                style={{ background: "oklch(0.16 0.005 270)", border: PANEL_BORDER, color: "oklch(0.8 0 0)", padding: "7px 8px" }}
              >
                <option value="edicion">Edición</option>
                <option value="lectura">Lectura</option>
              </select>
            </div>
            {query.trim() && (
              <div className="space-y-1 max-h-[160px] overflow-y-auto">
                {!resultados.length ? (
                  <p className="text-[12.5px] px-1" style={{ color: "oklch(0.5 0 0)" }}>Sin resultados.</p>
                ) : resultados.map((p) => {
                  const nombreCompleto = [p.nombre, p.apellido].filter(Boolean).join(" ").trim();
                  const nombre = nombreCompleto || p.email || "Usuario";
                  return (
                    <button
                      key={p.id}
                      onClick={() => handleAgregar(p)}
                      disabled={busy === p.id}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] text-left transition-colors disabled:opacity-50"
                      style={{ color: "hsl(var(--foreground))" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "oklch(0.16 0.005 270)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <UserPlus className="w-3.5 h-3.5 shrink-0" style={{ color: "#86efac" }} />
                      <span className="flex-1 min-w-0 truncate">
                        <span className="text-[13px]">{nombre}</span>
                        {/* Si ya se muestra el nombre, el email va aparte y más chico
                            — ayuda a distinguir gente con el mismo nombre. */}
                        {nombreCompleto && p.email && (
                          <span className="text-[11px] ml-1.5" style={{ color: "oklch(0.5 0 0)" }}>{p.email}</span>
                        )}
                      </span>
                      {busy === p.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-[11.5px] leading-relaxed" style={{ color: "oklch(0.5 0 0)" }}>
            {PERMISO_LABEL.lectura}: solo ve la pestaña. {PERMISO_LABEL.edicion}: además edita filas, columnas y agrupado — la vista es la misma para todos.
          </p>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

// ─── Sección ─────────────────────────────────────────────────────────────────

export function BuscadorSection() {
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
  // Filas tildadas en el índice maestro, para copiarlas a una pestaña.
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // Celda en edición dentro de una pestaña: { filaId, key }.
  const [editing, setEditing]     = useState<{ filaId: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState("");
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
    try { localStorage.setItem(COLWIDTHS_KEY, JSON.stringify(colWidths)); } catch { /* ignorar */ }
    if (!userId) return;
    if (saveWidthsTimer.current) clearTimeout(saveWidthsTimer.current);
    saveWidthsTimer.current = setTimeout(() => {
      setPreference(userId, COLWIDTHS_KEY, colWidths);
    }, 1000);
  }, [colWidths, userId]);
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

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const { col, startX, startWidth } = resizingRef.current;
      const s = layoutRef.current;
      const base = (s.activeTab ? s.tabLayouts[s.activeTab]?.widths : null) ?? s.colWidths;
      patchLayout({ widths: { ...base, [col]: Math.max(50, startWidth + e.clientX - startX) } });
    };
    const onUp = () => { resizingRef.current = null; };
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

  // Columnas realmente visibles, en el orden elegido — todo lo que se
  // renderiza (tabla + CSV) sale de acá; COLS completo sigue existiendo para
  // el menú de columnas y no se pierde ningún dato.
  const visibleCols = useMemo(
    () => effOrder
      .filter((k) => !effHidden.has(k))
      .map((k) => COLS.find((c) => c.key === k))
      .filter((c): c is ColDef => !!c),
    [effOrder, effHidden]
  );

  // Las Personalizadas van siempre al final, en su orden fijo — lo único que
  // se respeta acá es si están ocultas. No entran en `visibleCols` porque no
  // salen del índice y su celda se edita, no se renderiza como dato.
  const visibleTrackCols = useMemo(
    () => TRACK_COLS.filter((c) => !effHidden.has(c.key)),
    [effHidden]
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
    if (!activeTab) { setTabFilas([]); return; }
    setLoadingTab(true);
    fetchTabFilas(activeTab)
      .then(setTabFilas)
      .catch((e) => toast.error(`No se pudieron cargar las filas: ${e.message}`))
      .finally(() => setLoadingTab(false));
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
    const nombre = window.prompt("Nombre de la pestaña:", "Seguimiento");
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

  /** Borra todas las filas de un grupo entero (una OP, una matrícula, una SIC) de una vez. */
  const handleDeleteGrupo = useCallback(async (filaIds: string[], titulo: string) => {
    if (!filaIds.length) return;
    if (!window.confirm(`¿Quitar de la pestaña las ${filaIds.length} fila(s) de «${titulo}»?`)) return;
    const backup = tabFilas;
    const ids = new Set(filaIds);
    setTabFilas((p) => p.filter((f) => !ids.has(f.id)));   // optimista
    try {
      await deleteFilas(filaIds);
      toast.success(`${filaIds.length} fila(s) de «${titulo}» borradas.`);
    } catch (e) {
      setTabFilas(backup);
      toast.error(`No se pudo borrar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [tabFilas]);

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

  useEffect(() => {
    if (activeTab) { setLoading(false); return; }
    const q = query.trim();
    setLoading(true);
    const t = setTimeout(() => {
      buscar(q, undefined, campoBusqueda, false, ordenServidor, sortDir, fechaAplicada)
        .then((data) => { setRows(data); setBuscado(true); })
        .catch((e) => toast.error(`Error al buscar: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query, activeTab, campoBusqueda, ordenServidor, sortDir, fechaAplicada]);

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
    if (!window.confirm(
      "Reconstruir el índice vuelve a leer Matrículas + Envíos + SIC + Transacciones. " +
      "Tarda varios minutos y no hace falta después de una carga de datos, porque eso " +
      "ya reconstruye solo.\n\n¿Reconstruir igual?"
    )) return;
    setIndiceMenuOpen(false);
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

  /**
   * Cuántas de las filas tildadas están DENTRO de la búsqueda actual.
   *
   * La selección se mantiene al cambiar la búsqueda (tildar en varias búsquedas
   * es un caso legítimo), pero «Agregar a pestaña» solo copia lo visible
   * (`sorted.filter(...)`). Sin esta cuenta el botón prometía 12 y agregaba 3.
   */
  const seleccionadasVisibles = useMemo(
    () => sorted.reduce((n, r) => n + (selected.has(String(r.id)) ? 1 : 0), 0),
    [sorted, selected]
  );

  const handleSort = useCallback((col: string) => {
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }
    );
  }, []);

  // Copia las filas tildadas del índice a una pestaña. Las que ya están (mismo
  // row_key) se saltean para no duplicar.
  const handleAddSelected = useCallback(async (tabId: string) => {
    const elegidas = sorted.filter((r) => selected.has(String(r.id)));
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

  /** Copia UNA fila del índice a una pestaña (desde el menú contextual). */
  const handleAddRowToTab = useCallback(async (tabId: string, r: BusquedaRow) => {
    try {
      const destinoFilas = tabId === activeTab ? tabFilas : await fetchTabFilas(tabId);
      const destino = tabs.find((t) => t.id === tabId)?.nombre ?? "la pestaña";
      if (destinoFilas.some((f) => f.row_key === rowKey(r))) {
        toast.info(`Esa fila ya está en «${destino}».`);
        return;
      }
      const creadas = await addFilas(tabId, [r], rowKey, destinoFilas.length);
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
  const colapsados = useMemo(() => {
    if (query.trim()) return new Set<string>();
    if (colapsadosGuardados) return colapsadosGuardados;
    return new Set(displayRows.map((r) => groupKeyOf(r.data, agruparPor)));
  }, [query, colapsadosGuardados, displayRows, agruparPor]);

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

  const puedeArrastrar = isTabMode && !agrupar && puedoEditar;

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

  const handleRowClick = useCallback((e: React.MouseEvent, key: string) => {
    if (e.shiftKey && ultimaClickeada.current) {
      const a = keysVisibles.indexOf(ultimaClickeada.current);
      const b = keysVisibles.indexOf(key);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const rango = keysVisibles.slice(lo, hi + 1);
        setSelected((prev) => new Set([...prev, ...rango]));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const s = new Set(prev);
        if (s.has(key)) s.delete(key); else s.add(key);
        return s;
      });
    } else {
      setSelected(new Set([key]));
    }
    ultimaClickeada.current = key;
  }, [keysVisibles]);

  const toggleGrupo = useCallback((gk: string) => {
    const s = new Set(colapsados);
    if (s.has(gk)) s.delete(gk); else s.add(gk);
    patchLayout({ colapsados: [...s] });
  }, [colapsados, patchLayout]);

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
        onClick: () => patchLayout({ colapsados: [] }),
      },
      {
        label: "Cerrar todos",
        icon: ChevronRight,
        onClick: () => patchLayout({ colapsados: [...new Set(displayRows.map((r) => groupKeyOf(r.data, agruparPor)))] }),
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
  }, [colapsados, displayRows, agruparPor, puedoEditar, toggleGrupo, handleDeleteGrupo, patchLayout]);

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
        ...filas.map((f) => cols.map((c) => {
          const v = f[c.key];
          return v == null ? "" : (typeof v === "number" ? v : String(v));
        })),
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Datos");
      XLSX.writeFile(wb, `${nombre.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-")}.xlsx`);
      toast.success(`${filas.length} fila(s) exportadas.`);
    } catch (e) {
      toast.error(`No se pudo exportar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  /** Columnas de la vista actual, en el orden en que se ven. */
  const colsVisibles = useMemo(
    () => [
      ...visibleCols.map((c) => ({ key: c.key as string, label: c.label })),
      ...(isTabMode ? visibleTrackCols.map((c) => ({ key: c.key, label: c.label })) : []),
    ],
    [visibleCols, visibleTrackCols, isTabMode]
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
    if (!selected.has(ctx.key)) {
      setSelected(new Set([ctx.key]));
      ultimaClickeada.current = ctx.key;
    }

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
        onClick: () => { setEditValue(valor); setEditing({ filaId: editKey!, key: colKey }); },
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
      const objetivo = selected.has(ctx.key) ? [...selected] : ctx.filaId ? [ctx.filaId] : [];
      const enTarjeta = (id: string) =>
        String(tabFilas.find((f) => f.id === id)?.datos[TRACK_KEYS.enTarjeta] ?? "") === "true";
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
      items.push({
        label: "Quitar de la pestaña",
        icon: Trash2,
        danger: true,
        disabled: !puedoEditar || !ctx.filaId,
        onClick: () => handleDeleteFila(ctx.filaId!),
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
    const seleccionadas = displayRows.filter((r) => selected.has(r.key));
    if (seleccionadas.length) {
      items.push("sep");
      items.push({
        label: `Exportar selección a Excel (${seleccionadas.length})`,
        icon: Download,
        onClick: () => exportarAExcel(
          seleccionadas.map((r) => r.data),
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
    tabs, permisoDe, togglePin, handleDeleteFila, handleDeleteGrupo, handleAddRowToTab,
    handleMarcarTarjeta, displayRows, colsVisibles, exportarAExcel, activeTab, query,
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
            // Vuelve al orden con el que abre el maestro (SIC más recientes),
            // no al que hubiera quedado de la pestaña: son dos vistas con
            // criterios distintos y la pestaña resetea el sort a manual.
            onClick={() => { setActiveTab(null); setEditing(null); setSort({ col: "numero_sic", dir: "desc" }); }}
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
            const propia = t.user_id === userId;
            const permiso = permisoDe(t);
            return (
              <span
                key={t.id}
                className="inline-flex items-center group/tab"
                onContextMenu={(e) => abrirMenuPestana(e, t)}
              >
                <button
                  onClick={() => { setActiveTab(t.id); setEditing(null); setSort({ col: null, dir: "asc" }); }}
                  onDoubleClick={permiso === "edicion" ? () => handleRenameTab(t) : undefined}
                  title={
                    propia ? "Doble click para renombrar"
                      : permiso === "edicion" ? "Compartida — podés editarla y renombrarla"
                      : "Compartida — solo lectura"
                  }
                  className="inline-flex items-center gap-1.5 px-3 rounded-[8px] text-[12.5px] font-medium transition-colors"
                  style={{
                    height: 30,
                    background: act ? "oklch(0.28 0.02 295)" : "transparent",
                    border: `1px solid ${act ? "oklch(0.55 0.20 295 / 0.45)" : "transparent"}`,
                    color: act ? "oklch(0.92 0 0)" : "oklch(0.6 0 0)", cursor: "pointer",
                  }}
                >
                  {!propia && (
                    permiso === "edicion"
                      ? <Users className="w-3 h-3 shrink-0" style={{ color: "#7dd3fc" }} />
                      : <Lock  className="w-3 h-3 shrink-0" style={{ color: "oklch(0.55 0 0)" }} />
                  )}
                  {t.nombre}
                  {act && tabFilas.length > 0 && (
                    <span style={{ color: "oklch(0.55 0 0)" }}>{tabFilas.length}</span>
                  )}
                </button>
                {/* Compartir / Renombrar / Borrar salieron de acá: click
                    derecho en la pestaña abre el mismo menú (abrirMenuPestana). */}
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
              placeholder={
                campoBusqueda
                  ? `Buscar en ${CAMPO_OPTIONS.find((o) => o.value === campoBusqueda)?.label}…`
                  : "SIC, OP, matrícula, preparador, proveedor, zona…"
              }
              className="flex-1 bg-transparent border-none outline-none text-[13.5px] text-foreground placeholder:text-muted-foreground/45"
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Selector de campo — afina la búsqueda a una sola columna. Solo en
              el índice maestro: dentro de una pestaña el universo ya lo acotó
              el usuario al elegir qué filas copiar, y son pocas — filtrar por
              campo ahí no aporta y ocupa lugar en la barra. */}
          {!isTabMode && (
          <div className="relative shrink-0">
            {/* DropdownMenu de shadcn (Radix) en vez del panel a mano que había
                antes: trae la animación de entrada Y SALIDA, el click-afuera,
                el foco y la navegación con teclado sin mantener nada de eso
                acá. El de antes sólo animaba al abrir y desaparecía de golpe. */}
            <DropdownMenu open={campoMenuOpen} onOpenChange={setCampoMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  title="Acotar la búsqueda a un solo campo"
                  className="inline-flex items-center gap-1.5 px-3 rounded-[9px] text-[12.5px] font-medium transition-colors outline-none"
                  style={{
                    height: TOOLBAR_H,
                    background: campoBusqueda ? "oklch(0.28 0.02 295)" : "oklch(0.16 0.005 270)",
                    border: `1px solid ${campoBusqueda ? "oklch(0.55 0.20 295 / 0.45)" : "oklch(1 0 0 / 0.07)"}`,
                    color: campoBusqueda ? "oklch(0.92 0 0)" : "oklch(0.65 0 0)", cursor: "pointer",
                  }}
                >
                  {(() => {
                    const opt = CAMPO_OPTIONS.find((o) => o.value === campoBusqueda);
                    const Icon = opt?.icon ?? Search;
                    return <><Icon className="w-3.5 h-3.5" />{opt?.label ?? "Todo el índice"}</>;
                  })()}
                  <ChevronDown
                    className="w-3 h-3 opacity-60 transition-transform duration-200"
                    style={{ transform: campoMenuOpen ? "rotate(180deg)" : undefined }}
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={6} className="min-w-[180px] bg-panel border-hairline">
                <DropdownMenuItem
                  onSelect={() => setCampoBusqueda(null)}
                  className={cn("gap-2 text-[13px]", campoBusqueda === null && "bg-accent/15 text-foreground")}
                >
                  <Search className="w-3.5 h-3.5 shrink-0" />
                  Todo el índice
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-hairline" />
                {CAMPO_OPTIONS.map((o) => {
                  const Icon = o.icon;
                  return (
                    <DropdownMenuItem
                      key={o.value}
                      onSelect={() => setCampoBusqueda(o.value)}
                      className={cn("gap-2 text-[13px]", o.value === campoBusqueda && "bg-accent/15 text-foreground")}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      {o.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          )}

          {/* Filtro por rango de fechas. El desplegable elige CUÁL fecha se
              filtra: sin eso el rango es ambiguo (¿cuándo se pidió?, ¿para
              cuándo se comprometió?, ¿cuándo se movió?). Se aplica con
              «Buscar» y no al tipear: una fecha a medio escribir dispararía
              una consulta por tecla. */}
          <div
            className="flex items-center gap-1.5 px-2.5 shrink-0"
            style={{
              height: TOOLBAR_H, borderRadius: 9,
              background: "oklch(0.16 0.005 270)",
              border: `1px solid ${fechaAplicada ? "oklch(0.55 0.20 295 / 0.45)" : "oklch(1 0 0 / 0.07)"}`,
            }}
          >
            <CalendarClock className="w-3.5 h-3.5 shrink-0" style={{ color: "oklch(0.5 0 0)" }} />
            {/* Select de shadcn en vez del <select> nativo: el nativo abre un
                menú del sistema operativo, sin animación ni forma de estilarlo
                (se veía blanco en Windows aunque el resto sea oscuro). */}
            <Select value={fechaCampo} onValueChange={(v) => setFechaCampo(v as CampoFecha)}>
              <SelectTrigger
                size="sm"
                title="Sobre qué fecha se aplica el rango"
                className="h-[22px] border-none bg-transparent px-1 text-[12px] shadow-none focus-visible:ring-0"
                style={{ color: "oklch(0.78 0 0)", maxWidth: 176 }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-panel border-hairline">
                {CAMPOS_FECHA.map((f) => (
                  // ⚠ Se pisa el `focus:bg-accent` que trae SelectItem. Radix
                  //   enfoca solo el ítem seleccionado al abrir el Select, así
                  //   que ese estilo pintaba una barra verde a full apenas se
                  //   abría — nada que ver con el DropdownMenu de al lado, que
                  //   no enfoca nada al abrir. Acá el resaltado es suave y el
                  //   elegido lleva el mismo tinte que el ítem activo de aquel.
                  <SelectItem
                    key={f.key}
                    value={f.key}
                    className="text-[13px] focus:bg-panel-2 focus:text-foreground data-[state=checked]:bg-accent/15 data-[state=checked]:text-foreground"
                  >
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span style={{ color: "oklch(0.28 0 0)" }}>|</span>
            <DatePicker valor={fechaDesde} onChange={setFechaDesde} placeholder="Desde" />
            <span style={{ color: "oklch(0.35 0 0)" }}>→</span>
            <DatePicker valor={fechaHasta} onChange={setFechaHasta} placeholder="Hasta" />
            <button
              onClick={() => setFechaAplicada(
                fechaDesde || fechaHasta ? { campo: fechaCampo, desde: fechaDesde, hasta: fechaHasta } : null
              )}
              disabled={!fechaDesde && !fechaHasta}
              title="Aplicar el filtro de fechas"
              className="shrink-0 px-2 h-[22px] rounded-md text-[11px] font-semibold transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
              style={{
                background: "oklch(0.55 0.20 295 / 0.18)",
                border: "1px solid oklch(0.55 0.20 295 / 0.45)",
                color: "oklch(0.85 0.08 295)",
              }}
            >
              Buscar
            </button>
            {(fechaAplicada || fechaDesde || fechaHasta) && (
              <button
                onClick={() => { setFechaDesde(""); setFechaHasta(""); setFechaAplicada(null); }}
                title="Quitar el filtro de fechas"
                className="text-muted-foreground hover:text-foreground shrink-0"
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
            <div className="inline-flex items-center gap-1 shrink-0">
              <div className="relative" ref={agruparMenuRef}>
                <button
                  onClick={() => puedoEditar && setAgruparMenuOpen((v) => !v)}
                  disabled={!puedoEditar}
                  title={puedoEditar ? "Agrupar las filas por un criterio" : "Solo lectura — el agrupado es la misma vista para todos"}
                  className="inline-flex items-center gap-1.5 px-3 rounded-[9px] text-[12.5px] font-medium transition-colors disabled:cursor-default"
                  style={{
                    height: TOOLBAR_H,
                    background: agrupar ? "oklch(0.28 0.02 295)" : "oklch(0.16 0.005 270)",
                    border: `1px solid ${agrupar ? "oklch(0.55 0.20 295 / 0.45)" : "oklch(1 0 0 / 0.07)"}`,
                    color: agrupar ? "oklch(0.92 0 0)" : "oklch(0.65 0 0)", cursor: puedoEditar ? "pointer" : "default",
                  }}
                >
                  <Rows3 className="w-3.5 h-3.5" />
                  {agrupar
                    ? `Agrupar: ${AGRUPAR_OPTIONS.find((o) => o.value === agruparPor)?.label ?? ""}`
                    : "Agrupar: Nada"}
                  {puedoEditar && <ChevronDown className="w-3 h-3 opacity-60" />}
                </button>

                {agruparMenuOpen && puedoEditar && (
                  <div
                    className="absolute left-0 top-[calc(100%+6px)] z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
                    style={{
                      minWidth: 170, background: "oklch(0.205 0.005 270)", border: PANEL_BORDER,
                      borderRadius: 10, padding: 6, boxShadow: "0 14px 32px -16px rgba(0,0,0,0.6)",
                    }}
                  >
                    {/* «Nada» apaga el agrupado sin tocar el criterio guardado:
                        al volver a elegir uno, la pestaña recuerda cuál era. */}
                    <button
                      onClick={() => { setAgrupar(false); setAgruparMenuOpen(false); }}
                      className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-[7px] text-[13px] transition-colors"
                      style={{ color: !agrupar ? "oklch(0.92 0 0)" : "oklch(0.75 0 0)", background: !agrupar ? "oklch(0.28 0.02 295)" : "transparent" }}
                      onMouseEnter={(e) => { if (agrupar) e.currentTarget.style.background = "oklch(0.27 0.005 270)"; }}
                      onMouseLeave={(e) => { if (agrupar) e.currentTarget.style.background = "transparent"; }}
                    >
                      <X className="w-3.5 h-3.5 shrink-0" />
                      Nada
                    </button>
                    <div style={{ height: 1, background: "oklch(1 0 0 / 0.07)", margin: "4px 6px" }} />
                    {AGRUPAR_OPTIONS.map((o) => {
                      const Icon = o.icon;
                      const activo = agrupar && o.value === agruparPor;
                      return (
                        <button
                          key={o.value}
                          onClick={() => { setAgruparPor(o.value); setAgruparMenuOpen(false); }}
                          className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-[7px] text-[13px] transition-colors"
                          style={{ color: activo ? "oklch(0.92 0 0)" : "oklch(0.75 0 0)", background: activo ? "oklch(0.28 0.02 295)" : "transparent" }}
                          onMouseEnter={(e) => { if (!activo) e.currentTarget.style.background = "oklch(0.27 0.005 270)"; }}
                          onMouseLeave={(e) => { if (!activo) e.currentTarget.style.background = "transparent"; }}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {agrupar && gruposCount > 0 && (
                <button
                  onClick={() => patchLayout({
                    colapsados: colapsados.size
                      ? []
                      : [...new Set(displayRows.map((r) => groupKeyOf(r.data, agruparPor)))],
                  })}
                  title={colapsados.size ? "Abrir todas" : "Cerrar todas"}
                  className="inline-flex items-center justify-center rounded-[9px] transition-colors"
                  style={{ height: TOOLBAR_H, width: 32, background: "oklch(0.16 0.005 270)", border: PANEL_BORDER, color: "oklch(0.6 0 0)", cursor: "pointer" }}
                >
                  {colapsados.size ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          )}

          {/* Enviar a la tarjeta — dentro de una pestaña, con filas tildadas.
              Misma acción que el menú contextual, a la vista: si no, la única
              forma de descubrirla sería probando el click derecho. */}
          {isTabMode && selected.size > 0 && (
            <button
              onClick={() => handleMarcarTarjeta([...selected], true)}
              disabled={!puedoEditar}
              title="Mostrar estas filas en «Próximas Entregas» de Transformadores"
              className="inline-flex items-center gap-1.5 px-3 rounded-[9px] text-[12.5px] font-medium transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                height: TOOLBAR_H,
                background: "oklch(0.28 0.02 295)",
                border: "1px solid oklch(0.55 0.20 295 / 0.45)",
                color: "oklch(0.92 0 0)", cursor: "pointer",
              }}
            >
              <CalendarClock className="w-3.5 h-3.5" />
              Enviar a Tarjeta
              <span style={{ color: GROUP_META.track.color }}>{selected.size}</span>
            </button>
          )}

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
                <span style={{ color: "#c4b5fd" }}>{seleccionadasVisibles}</span>
                {/* Hay tildadas fuera de la búsqueda actual: solo se copian
                    las visibles, así que se aclara en vez de prometer de más. */}
                {seleccionadasVisibles !== selected.size && (
                  <span style={{ color: "oklch(0.6 0 0)" }}>de {selected.size}</span>
                )}
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
                  {(() => {
                    // Solo pestañas donde se puede escribir: una compartida
                    // "solo lectura" no admite que le agreguen filas.
                    const editables = tabs.filter((t) => permisoDe(t) === "edicion");
                    if (!editables.length) {
                      return (
                        <div className="px-2 py-2 text-[12px]" style={{ color: "oklch(0.55 0 0)" }}>
                          {tabs.length === 0
                            ? "No tenés pestañas todavía — creá una con el «+» de arriba."
                            : "No tenés ninguna pestaña editable — las compartidas contigo son de solo lectura."}
                        </div>
                      );
                    }
                    return editables.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => handleAddSelected(t.id)}
                        className="w-full text-left px-2 py-1.5 rounded-[7px] text-[13px] transition-colors"
                        style={{ color: "oklch(0.88 0 0)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "oklch(0.27 0.005 270)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        {t.nombre}
                        {t.user_id !== userId && <span style={{ color: "oklch(0.5 0 0)" }}> · compartida</span>}
                      </button>
                    ));
                  })()}
                </div>
              )}
            </div>
          )}

          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="inline-flex items-center gap-1.5 px-2.5 rounded-[9px] text-[12px] transition-colors"
              style={{ height: TOOLBAR_H, background: "transparent", border: PANEL_BORDER, color: "oklch(0.55 0 0)", cursor: "pointer" }}
            >
              <X className="w-3.5 h-3.5" />
              {/* El "(N)" avisa que hay tildadas fuera de la búsqueda actual —
                  algo que solo pasa en el índice. `seleccionadasVisibles` se
                  calcula sobre el índice, así que en una pestaña no aplica. */}
              Quitar selección{!isTabMode && selected.size > seleccionadasVisibles ? ` (${selected.size})` : ""}
            </button>
          )}

          {/* El botón de exportar salió de la barra: ocupaba lugar fijo para
              algo ocasional. Ahora está en el click derecho — sobre las filas
              (exporta la selección) y sobre una pestaña (la exporta entera). */}

          {/* Estado del índice. «Reconstruir» vive adentro de este menú y no
              suelto en la barra: tarda varios minutos y, desde que cada carga
              masiva reconstruye sola, casi nunca hace falta a mano. */}
          {indice && !isTabMode && (
            <div className="relative shrink-0" ref={indiceMenuRef}>
              <button
                onClick={() => setIndiceMenuOpen((v) => !v)}
                title="Estado del índice de búsqueda"
                className="inline-flex items-center gap-1.5 px-2.5 rounded-[9px] text-[12px] whitespace-nowrap transition-colors"
                style={{
                  height: TOOLBAR_H, background: "oklch(0.16 0.005 270)", border: PANEL_BORDER,
                  color: "oklch(0.6 0 0)", cursor: "pointer",
                }}
              >
                {reconstruyendo
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "#fcd34d" }} />
                  : <Database className="w-3.5 h-3.5" style={{ color: "#86efac" }} />}
                {reconstruyendo ? "Reconstruyendo…" : indice.filas.toLocaleString("es-AR")}
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>

              {indiceMenuOpen && (
                <div
                  className="absolute right-0 top-[calc(100%+6px)] z-50 animate-in fade-in slide-in-from-top-1 duration-150"
                  style={{
                    width: 280, background: "oklch(0.205 0.005 270)", border: PANEL_BORDER,
                    borderRadius: 10, padding: 12, boxShadow: "0 14px 32px -16px rgba(0,0,0,0.6)",
                  }}
                >
                  <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: "oklch(0.55 0 0)" }}>
                    Índice de búsqueda
                  </p>
                  <p className="text-[12.5px] mb-1" style={{ color: "oklch(0.85 0 0)" }}>
                    <span className="font-medium">{indice.filas.toLocaleString("es-AR")}</span> filas indexadas
                  </p>
                  {indice.actualizado && (
                    <p className="text-[11.5px] mb-2.5" style={{ color: "oklch(0.55 0 0)" }}>
                      Actualizado el {fmtFechaISO(indice.actualizado)}
                    </p>
                  )}
                  <p className="text-[11.5px] leading-relaxed mb-3" style={{ color: "oklch(0.5 0 0)" }}>
                    Se reconstruye solo después de cargar Envíos, SIC, MATRICULAS o
                    Transacciones. Hacelo a mano solo si cambiaste un Material/Servicio
                    o el catálogo y no querés esperar a la próxima carga.
                  </p>
                  <button
                    onClick={handleReconstruir}
                    disabled={reconstruyendo}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-[8px] text-[12.5px] font-medium transition-colors disabled:opacity-50"
                    style={{ background: "oklch(0.22 0.005 270)", border: PANEL_BORDER, color: "oklch(0.75 0 0)", cursor: "pointer" }}
                  >
                    {reconstruyendo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {reconstruyendo ? "Reconstruyendo…" : "Reconstruir ahora"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Contador — en una pestaña cuenta sus filas, no resultados del índice. */}
        {isTabMode && !loadingTab && tabFilas.length > 0 && (
          <p className="text-[12px] px-0.5" style={{ color: "oklch(0.55 0 0)", margin: 0 }}>
            <span className="text-foreground font-medium">{tabFilasEnRango.length.toLocaleString("es-AR")}</span>
            {query.trim() || fechaAplicada ? ` de ${tabFilas.length} fila(s)` : " fila(s)"}
            {agrupar && gruposCount > 0 && (() => {
              const nombre = agruparPor === "articulo" ? "matrícula" : agruparPor === "numero_sic" ? "SIC" : "OP";
              return ` en ${gruposCount.toLocaleString("es-AR")} ${nombre}${gruposCount === 1 || agruparPor !== "articulo" ? "" : "s"}`;
            })()}
            {" · ctrl+click para elegir varias · doble click para editar · click derecho para exportar y más"}
            {puedeArrastrar && " · arrastrá para reordenar"}
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
              {" · ctrl+click para elegir varias · click derecho para exportar y más"}
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
        {/* `minHeight` (mismo cálculo que el `maxHeight` del scroll de la
            tabla, más abajo) hace que el panel llegue siempre hasta abajo de
            la ventana, tenga pocos resultados o ninguno — antes se achicaba
            al tamaño del contenido y dejaba un vacío gris debajo. Con MUCHOS
            resultados el `maxHeight` de la tabla sigue cortando ahí: el panel
            no crece sin límite, scrollea puertas adentro. */}
        <div
          className="rounded-[10px] overflow-hidden flex flex-col"
          style={{ background: PANEL_BG, border: PANEL_BORDER, minHeight: "calc(100vh - 190px)" }}
        >
          {isTabMode && loadingTab ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />Cargando pestaña…
            </div>
          ) : isTabMode && !tabFilas.length ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-sm text-muted-foreground">
              <ListPlus className="w-10 h-10 opacity-20" />
              Esta pestaña está vacía.
              <span className="text-[12px]">
                Andá a «Índice maestro», tildá las filas que quieras seguir y usá «Agregar a pestaña».
              </span>
            </div>
          ) : !isTabMode && loading ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {/* Ordenar re-consulta al servidor (el orden va en la query, no
                  después — ver el efecto de búsqueda), así que el cartel tiene
                  que decir eso y no "cargando las OP más recientes", que era el
                  texto fijo de antes y confundía: aparecía igual al ordenar por
                  SIC. */}
              {ordenServidor ? "Ordenando…" : query.trim() ? "Buscando…" : "Cargando las OP más recientes…"}
            </div>
          ) : !isTabMode && !sorted.length ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-sm text-muted-foreground">
              <PackageOpen className="w-10 h-10 opacity-20" />
              {query.trim() ? `Sin resultados para «${query.trim()}».` : "El índice no tiene filas todavía."}
              {indice?.filas === 0 && <span className="text-[12px]">El índice está vacío — probá «Reconstruir índice».</span>}
            </div>
          ) : !visibleCols.length ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-sm text-muted-foreground">
              <Columns3 className="w-10 h-10 opacity-20" />
              Ocultaste todas las columnas — abrí «Columnas» para mostrar alguna.
            </div>
          ) : (
            // Alto calculado en vez de un % fijo: con la barra compacta la
            // tabla puede ocupar casi toda la ventana.
            <div className="flex-1 overflow-auto" style={{ maxHeight: "calc(100vh - 190px)" }}>
              <table style={{ tableLayout: "fixed", width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
                <colgroup>
                  {/* Columna de acciones: fija, no reordenable ni ocultable.
                      En el índice maestro lleva el check de selección y el pin;
                      dentro de una pestaña, el handle de arrastre y el borrar. */}
                  <col style={{ width: isTabMode ? 78 : 58 }} />
                  {visibleCols.map((c) => (
                    <col key={c.key} style={{ width: effWidths[c.key] ?? DEFAULT_COL_WIDTHS[c.key] }} />
                  ))}
                  {isTabMode && visibleTrackCols.map((c) => (
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
                      {/* Seleccionar / limpiar todo lo que está a la vista.
                          Dejó de ser un checkbox junto con los de cada fila:
                          ahora la selección se hace con click (ctrl/shift), y
                          este botón es el atajo para "todo". */}
                      {!isTabMode && sorted.length > 0 && (
                        <button
                          title={seleccionadasVisibles === sorted.length ? "Limpiar selección" : "Seleccionar todo lo visible"}
                          onClick={() => {
                            // Solo agrega/saca lo VISIBLE: lo seleccionado en
                            // otra búsqueda se conserva en vez de perderse acá.
                            const visibles = sorted.map((r) => String(r.id));
                            setSelected((prev) => {
                              const s = new Set(prev);
                              if (seleccionadasVisibles === sorted.length) visibles.forEach((k) => s.delete(k));
                              else visibles.forEach((k) => s.add(k));
                              return s;
                            });
                          }}
                          className="grid place-items-center mx-auto"
                          style={{
                            width: 16, height: 16, borderRadius: 4, cursor: "pointer",
                            border: `1px solid ${seleccionadasVisibles > 0 ? "#8B5CF6" : "oklch(1 0 0 / 0.18)"}`,
                            background: seleccionadasVisibles === sorted.length ? "#8B5CF6" : "transparent",
                          }}
                        >
                          {seleccionadasVisibles > 0 && (
                            seleccionadasVisibles === sorted.length
                              ? <Check className="w-3 h-3" style={{ color: "#fff" }} strokeWidth={3} />
                              : <span style={{ width: 7, height: 2, borderRadius: 1, background: "#8B5CF6" }} />
                          )}
                        </button>
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
                              resizingRef.current = { col: c.key, startX: e.clientX, startWidth: effWidths[c.key] ?? DEFAULT_COL_WIDTHS[c.key] };
                            }}
                          />
                        </th>
                      );
                    })}

                    {/* Columnas de seguimiento: no vienen del índice, las
                        escribe el usuario. Fondo propio para diferenciarlas. */}
                    {isTabMode && visibleTrackCols.map((c) => {
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
                            boxShadow: `inset 0 2.5px 0 0 ${GROUP_META.track.color}`,
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
                  {displayItems.map((item, i) => {
                    // Encabezado de matrícula: ocupa toda la fila y pliega el grupo.
                    if (item.tipo === "grupo") {
                      const cerrado = colapsados.has(item.gkey);
                      return (
                        <tr key={item.key}>
                          <td
                            colSpan={1 + visibleCols.length + (isTabMode ? visibleTrackCols.length : 0)}
                            style={{
                              padding: 0,
                              background: "oklch(0.245 0.008 270)",
                              borderBottom: "1px solid oklch(1 0 0 / 0.07)",
                              borderTop: "1px solid oklch(1 0 0 / 0.05)",
                            }}
                          >
                            <div
                              className="w-full flex items-center gap-1 pl-3 pr-2 py-2 transition-colors"
                              onMouseEnter={(e) => { e.currentTarget.style.background = "oklch(0.28 0.008 270)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                              onContextMenu={(e) => abrirMenuGrupo(e, item)}
                            >
                              <button
                                onClick={() => toggleGrupo(item.gkey)}
                                title={cerrado ? "Abrir grupo" : "Cerrar grupo"}
                                className="shrink-0 grid place-items-center rounded-[5px]"
                                style={{ width: 22, height: 22, cursor: "pointer" }}
                              >
                                {cerrado
                                  ? <ChevronRight className="w-4 h-4" style={{ color: "#fcd34d" }} />
                                  : <ChevronDown  className="w-4 h-4" style={{ color: "#fcd34d" }} />}
                              </button>
                              {puedoEditar && (
                                <button
                                  onClick={() => handleDeleteGrupo(item.filaIds, item.titulo)}
                                  title={`Quitar de la pestaña las ${item.count} fila(s) de «${item.titulo}»`}
                                  className="shrink-0 grid place-items-center rounded-[5px] transition-colors"
                                  style={{ width: 22, height: 22, color: "oklch(0.5 0 0)", cursor: "pointer" }}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = "#fca5a5"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = "oklch(0.5 0 0)"; }}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                onClick={() => toggleGrupo(item.gkey)}
                                className="flex-1 flex items-center gap-2 text-left min-w-0"
                                style={{ cursor: "pointer" }}
                              >
                                <span style={{
                                  fontFamily: "ui-monospace, monospace", fontSize: 12.5,
                                  fontWeight: 600, color: "hsl(var(--foreground))",
                                }}>
                                  {item.titulo}
                                </span>
                                <span className="truncate" style={{ fontSize: 12, color: "oklch(0.62 0 0)", flex: 1 }}>
                                  {item.subtitulo}
                                </span>
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                                  background: "oklch(0.30 0.10 155 / 0.35)", color: "#86efac",
                                  border: "1px solid oklch(0.55 0.15 155 / 0.4)", whiteSpace: "nowrap",
                                }}>
                                  {item.count} línea{item.count === 1 ? "" : "s"}
                                </span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    const { key, filaId, data } = item;
                    const isPinned = !isTabMode && pinnedRows.length > 0 && i < pinnedRows.length;
                    const isLastPinned = isPinned && i === pinnedRows.length - 1;
                    const isLastRow = i === displayItems.length - 1;
                    const pinnedBg = "color-mix(in oklab, var(--accent-violet) 8%, transparent)";
                    const bottomBorder = isLastPinned
                      ? "2px solid color-mix(in oklab, var(--accent-violet) 50%, transparent)"
                      : isLastRow ? "none" : "1px solid oklch(1 0 0 / 0.05)";
                    const isSel = selected.has(key);
                    const isDragOver = isTabMode && dragOverFilaId === filaId;
                    // El resaltado ámbar de "fila en la que estoy" se retiró:
                    // lo hacía un click suelto, que ahora selecciona. La fila
                    // seleccionada (violeta) cumple la misma función de no
                    // perderla de vista al scrollear en horizontal.
                    const rowBg = isDragOver
                      ? "oklch(0.27 0.005 270)"
                      : isSel ? "color-mix(in oklab, var(--accent-violet) 12%, transparent)"
                      : isPinned ? pinnedBg : undefined;
                    // Dentro de una pestaña la fila es una copia editable, no
                    // tiene sentido atenuar por fuente.
                    const dim = !isTabMode && data.fuente === "catalogo";

                    return (
                      <Fragment key={key}>
                      <tr
                        className="transition-colors"
                        onClick={(e) => handleRowClick(e, key)}
                        // Con el agrupado activo el arrastre se desactiva: mover
                        // una fila entre matrículas no tiene sentido y el regrupado
                        // la devolvería a su grupo igual.
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
                        style={{ opacity: dim ? 0.72 : 1, background: rowBg }}
                        onMouseEnter={(e) => { if (!rowBg) (e.currentTarget as HTMLTableRowElement).style.background = "oklch(0.25 0.005 270 / 0.5)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = rowBg ?? ""; }}
                      >
                        {/* Acciones de la fila */}
                        <td
                          style={{ padding: "6px 4px", borderBottom: bottomBorder }}
                          onContextMenu={(e) => abrirMenuFila(e, { key, filaId, data })}
                        >
                          <span className="flex items-center justify-center gap-1">
                            {isTabMode ? (
                              <>
                                <span
                                  className={cn("grid place-items-center", puedeArrastrar && "cursor-grab active:cursor-grabbing")}
                                  title={puedeArrastrar ? "Arrastrar para reordenar" : "Desactivá el agrupado para reordenar"}
                                  style={{ color: puedeArrastrar ? "oklch(0.42 0 0)" : "oklch(0.28 0 0)" }}
                                >
                                  <GripVertical className="w-3.5 h-3.5" />
                                </span>
                                {/* Indicador de que la fila alimenta la tarjeta
                                    «Próximas Entregas». Sin esto no habría
                                    forma de saber qué se mandó: la marca dejó
                                    de tener columna propia. */}
                                {String(data[TRACK_KEYS.enTarjeta] ?? "") === "true" && (
                                  <span
                                    className="grid place-items-center"
                                    title="En «Próximas Entregas» — click derecho para quitarla"
                                    style={{ width: 16, height: 16, color: GROUP_META.track.color }}
                                  >
                                    <CalendarClock className="w-3.5 h-3.5" strokeWidth={2.2} />
                                  </span>
                                )}
                                {/* Borrar salió de acá: era una acción
                                    destructiva a un click suelto al lado del
                                    handle de arrastre. Ahora está en el menú
                                    contextual (click derecho). */}
                              </>
                            ) : (
                              <>
                                {/* Fijar salió de acá: se hace con click
                                    derecho. Igual la fila fijada se reconoce
                                    sola — va arriba de todo, con fondo violeta
                                    y un separador debajo del último. El ícono
                                    solo se muestra como indicador. */}
                                {isPinned && (
                                  <span
                                    className="grid place-items-center"
                                    title="Fijada arriba — click derecho para quitarla"
                                    style={{ width: 20, height: 20, color: "#c4b5fd" }}
                                  >
                                    <Pin className="w-3.5 h-3.5" strokeWidth={2} fill="#c4b5fd" />
                                  </span>
                                )}
                              </>
                            )}
                          </span>
                        </td>

                        {/* Columnas del índice. En una pestaña son copias, así
                            que se editan con doble click. */}
                        {visibleCols.map((c) => {
                          // Las columnas manuales de OP (descripción / zona) se
                          // editan TAMBIÉN en el índice maestro, donde no hay
                          // filaId: la clave de edición es la fila visible.
                          const esManualOp = OP_MANUAL_COLS.has(c.key as string);
                          const numeroOp   = String(data.numero_op ?? "");
                          const editKey    = isTabMode ? filaId : key;
                          const editable   = esManualOp
                            ? (puedoEditar && !!numeroOp)
                            : (isTabMode && puedoEditar);
                          const editando = editing?.filaId === editKey && editing?.key === c.key;
                          return (
                            <td
                              key={c.key}
                              className={cn(
                                !editando && !editable && "truncate",
                                editable && !editando && "group/celda",
                                c.num ? "text-right tabular-nums" : "text-left",
                              )}
                              style={{
                                padding: editando ? "2px 6px" : "7px 12px",
                                borderBottom: bottomBorder,
                                fontFamily: (c.num || c.mono) ? "ui-monospace, monospace" : undefined,
                                color: c.key === "articulo" ? "hsl(var(--foreground))" : undefined,
                                fontWeight: c.key === "articulo" ? 500 : undefined,
                                cursor: editable ? "text" : undefined,
                              }}
                              title={
                                esManualOp
                                  ? (!numeroOp ? "Esta fila no tiene OP"
                                     : !puedoEditar ? "Solo lectura — pedile al dueño permiso de edición"
                                     : `Doble click para editar — se guarda para toda la OP ${numeroOp}`)
                                : isTabMode ? (puedoEditar ? "Doble click para editar" : "Solo lectura — pedile al dueño permiso de edición")
                                  : c.key === "descripcion" ? String(data.descripcion ?? "") : undefined
                              }
                              onDoubleClick={editable ? () => {
                                setEditValue(String(data[c.key] ?? ""));
                                setEditing({ filaId: editKey!, key: c.key });
                              } : undefined}
                              onContextMenu={(e) => abrirMenuFila(e, { key, filaId, data, colKey: c.key as string })}
                            >
                              {editando ? (
                                <input
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={() => commitEdit(isTabMode ? filaId ?? null : null, c.key, editValue, numeroOp)}
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
                              ) : editable ? (
                                // Lápiz al pasar el mouse: el doble click es el
                                // único gesto de edición y sin esto no se
                                // anuncia por ningún lado. Vale sobre todo para
                                // Zona y Descripción OP, que arrancan vacías.
                                <span className="flex items-center gap-1.5" style={{ justifyContent: c.num ? "flex-end" : "flex-start" }}>
                                  <span className="truncate">
                                    {c.render
                                      ? c.render(data as unknown as BusquedaRow)
                                      : c.num ? fmtNum(data[c.key] as number) : ((data[c.key] ?? "") as ReactNode)}
                                  </span>
                                  <Pencil
                                    className="w-3 h-3 shrink-0 opacity-0 group-hover/celda:opacity-100 transition-opacity"
                                    style={{ color: "oklch(0.5 0 0)" }}
                                  />
                                </span>
                              ) : (
                                c.render
                                  ? c.render(data as unknown as BusquedaRow)
                                  : c.num ? fmtNum(data[c.key] as number) : ((data[c.key] ?? "") as ReactNode)
                              )}
                            </td>
                          );
                        })}

                        {/* Columnas de seguimiento */}
                        {isTabMode && visibleTrackCols.map((c) => {
                          const editando = editing?.filaId === filaId && editing?.key === c.key;
                          const val = String(data[c.key] ?? "");
                          const est = c.tipo === "estado" ? ESTADO_STYLE[val] : undefined;
                          return (
                            <td
                              key={c.key}
                              className={cn(
                                !editando && !puedoEditar && "truncate",
                                puedoEditar && !editando && "group/celda",
                              )}
                              style={{
                                padding: editando ? "2px 6px" : "7px 12px",
                                borderBottom: bottomBorder,
                                // Estas columnas pintan su propio fondo (para
                                // distinguirse como "de seguimiento") y si no
                                // se mezcla acá, tapan el resaltado de fila.
                                background: isSel ? "color-mix(in oklab, var(--accent-violet) 12%, transparent)" : TRACK_BG,
                                cursor: puedoEditar ? "text" : "default",
                              }}
                              title={!puedoEditar ? "Solo lectura — pedile al dueño permiso de edición" : c.tipo === "texto" ? val : "Doble click para editar"}
                              onDoubleClick={puedoEditar ? () => {
                                setEditValue(val);
                                setEditing({ filaId: filaId!, key: c.key });
                              } : undefined}
                              onContextMenu={(e) => abrirMenuFila(e, { key, filaId, data, colKey: c.key })}
                            >
                              {editando && c.tipo === "estado" ? (
                                <select
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
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
                                  onClick={(e) => e.stopPropagation()}
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
                              ) : (
                                // Mismo lápiz en hover que las columnas del
                                // índice: anuncia que la celda es editable.
                                <span className="flex items-center gap-1.5">
                                  <span className="truncate flex-1">
                                    {est ? (
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
                                  </span>
                                  {puedoEditar && (
                                    <Pencil
                                      className="w-3 h-3 shrink-0 opacity-0 group-hover/celda:opacity-100 transition-opacity"
                                      style={{ color: "oklch(0.5 0 0)" }}
                                    />
                                  )}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>

                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {ctxMenu && <RowContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />}

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
