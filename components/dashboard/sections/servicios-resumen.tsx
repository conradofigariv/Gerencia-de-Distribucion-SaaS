"use client";

import { useState, useEffect, useRef, useMemo, Fragment, type ElementType, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  XCircle,
  CalendarClock,
  Loader2,
  Pencil,
  Check,
  RotateCcw,
  Download,
  Trash2,
  Copy,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { fetchReglas, reglaServicios, SERVICIOS_DEFAULT, type ConfigServicios } from "@/lib/notificaciones";
import { toast } from "sonner";
import {
  getColumnLabels,
  saveColumnLabel,
  resetColumnLabel,
  resetAllColumnLabels,
  type ColumnLabelMap,
} from "@/lib/columnLabels";
import { fetchTabs, enviarMarcadasASeguimiento, type BuscadorTab } from "@/lib/buscadorTabs";

// Scope de las etiquetas editables para esta sección.
const LABELS_SCOPE = "servicios-resumen";

type Alerta = {
  id: string;
  // `tipo` es la CLASE de alerta; el texto que se muestra va en `etiqueta`.
  // Antes `tipo` era un literal con el umbral adentro ("Vencimiento 3M"), lo
  // que dejaba de compilar apenas los umbrales pasaron a ser configurables.
  tipo: "vence" | "saldo";
  etiqueta: string;
  op: number;
  zona: string;
  descripcion: string;
  fecha: string;
  severity: "high" | "medium";
};


const CYCLE_VENCER  = [3, 4, null]  as const;
const CYCLE_CONSUMO = [30, 40, null] as const;
type FiltroVencer  = 3 | 4 | null;
type FiltroConsumo = 30 | 40 | null;

// Columnas por defecto del Resumen, enfocadas en el control de vencimientos de
// servicios (grano del cubo). `dias_vencer` es calculada (no existe en la BD).
// Los nombres son editables desde el sistema (ver ui_column_labels).
const TABLE_COLS: { db: string; label: string }[] = [
  { db: "zona",                  label: "ZONA"            },
  { db: "nombre_corto",          label: "NOMBRE CORTO"    },
  { db: "observacion",           label: "OBSERVACIONES"   },
  { db: "op",                    label: "OP"              },
  { db: "linea",                 label: "LÍNEA"           },
  { db: "matricula",             label: "MATRÍCULA"       },
  { db: "descripcion_matricula", label: "DESCRIPCIÓN"     },
  { db: "cantidad",              label: "CANTIDAD"        },
  { db: "saldo_linea",           label: "SALDO RESTANTE"  },
  { db: "fecha_pactada",         label: "FECHA PACTADA"   },
  { db: "dias_vencer",           label: "DÍAS P/ VENCER"  },
  { db: "estado",                label: "ESTADO"          },
  { db: "proveedor",             label: "PROVEEDOR"       },
];
const RAW_COLS_T     = new Set(["op", "op_madre", "linea"]);
// Columnas editables inline desde el Resumen (mismo mecanismo que Lista de
// seguimiento). "zona" NO está: ahora se trae de la pestaña «Servicios» del
// Buscador en cada sincronización, y un valor editado a mano acá se perdería
// en el próximo «Traer del Buscador» sin ningún aviso — mejor no ofrecerlo.
const EDITABLE_COLS  = new Set(["nombre_corto", "observacion"]);
const PAGE_SIZE      = 50;

const DEFAULT_WIDTHS_R: Record<string, number> = {
  zona: 80, nombre_corto: 140, op: 90, linea: 70, matricula: 110, descripcion_matricula: 240,
  cantidad: 90, saldo_linea: 100, fecha_pactada: 120, dias_vencer: 130,
  estado: 100, proveedor: 170, observacion: 200,
};

// Orden de columnas persistido (drag & drop) — por navegador.
// v3: se agregó Línea y se reubicó Observaciones (reset del orden guardado viejo).
const COLORDER_KEY = "servicios-resumen-colorder-v3";

type SeguimientoRow = Record<string, unknown> & { id: string };

const MS_DAY = 86_400_000;

// Días hasta la fecha pactada (negativo = vencido). null si no hay fecha válida.
function diasParaVencer(fechaPactada: unknown, today: Date): number | null {
  if (!fechaPactada) return null;
  const d = new Date(String(fechaPactada));
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - today.getTime()) / MS_DAY);
}

// ¿La OP de esta fila está abierta? (estado guarda el estado_cierre de la OP)
function isAbierto(estado: unknown): boolean {
  return String(estado ?? "").trim().toLowerCase().startsWith("abiert");
}

// ── Menú contextual de fila (click derecho) ─────────────────────────────────
// Mismo patrón que el Buscador: reemplaza al botón de fijar (que se sacó) y al
// ícono de borrar suelto en la fila — las acciones de una fila viven todas acá,
// y hay lugar para sumar más sin agregar otro ícono a la tabla.

interface CtxItem {
  label:     string;
  icon:      ElementType;
  onClick:   () => void;
  danger?:   boolean;
  disabled?: boolean;
}
interface CtxState { x: number; y: number; items: (CtxItem | "sep")[] }

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
      className="fixed z-[200] min-w-[190px] p-1.5 rounded-xl border border-hairline bg-panel shadow-xl animate-in fade-in zoom-in-95 duration-100"
      style={{ left: pos.x, top: pos.y }}
    >
      {state.items.map((it, i) =>
        it === "sep" ? (
          <div key={`s${i}`} className="h-px my-1 mx-1.5 bg-hairline" />
        ) : (
          <button
            key={it.label}
            disabled={it.disabled}
            onClick={() => { it.onClick(); onClose(); }}
            className={cn(
              "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-sm transition-colors disabled:opacity-35 disabled:cursor-default",
              it.danger ? "text-accent-red hover:bg-accent-red/10" : "text-foreground hover:bg-panel-2"
            )}
          >
            <it.icon className="w-3.5 h-3.5 shrink-0" />
            {it.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}

export function ServiciosResumenSection() {
  // Carga única de los datos; todo lo demás se deriva en memoria.
  const [allRows,     setAllRows]     = useState<SeguimientoRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Pestaña del Buscador que alimenta esta pantalla. Se resuelve por NOMBRE,
  // fija — mismo criterio que la tarjeta «Próximas Entregas» de
  // Transformadores: sobrevive a que la borren y recreen con el mismo nombre,
  // al costo de que un renombre la deja sin efecto (avisado en el botón).
  const [tabs, setTabs]                   = useState<BuscadorTab[]>([]);
  const [sincronizando, setSincronizando] = useState(false);

  // Umbrales de alerta del usuario. Son los MISMOS que usa la campana (ver
  // lib/notificaciones.ts): si esta pantalla usara los valores fijos viejos,
  // la campana avisaría por un criterio y la tabla mostraría otro.
  const [umbrales, setUmbrales] = useState<ConfigServicios>(SERVICIOS_DEFAULT);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      fetchTabs(data.user.id).then(setTabs).catch(() => { /* sin pestañas, el botón queda deshabilitado */ });
      fetchReglas(data.user.id)
        .then((rs) => { const { activa: _a, ...cfg } = reglaServicios(rs); setUmbrales(cfg); })
        .catch(() => { /* sin config propia, quedan los defaults */ });
    });
  }, []);

  const tabActiva = useMemo(
    () => tabs.find((t) => t.nombre.trim().toLowerCase() === "servicios") ?? null,
    [tabs]
  );

  /**
   * Trae a `seguimiento` lo marcado en la pestaña «Servicios» del Buscador.
   *
   * Es una ESCRITURA, no un filtro: el Resumen lee `seguimiento`, así que una
   * fila marcada en una pestaña no aparecía acá hasta existir en esa tabla.
   * Solo reemplaza las filas que este mismo camino creó (`origen='buscador'`);
   * lo cargado a mano o por la masiva de SICs no se toca.
   */
  const sincronizarDesdeBuscador = async () => {
    if (!tabActiva) return;
    setSincronizando(true);
    try {
      const { escritas, errores, totalEnPestana } = await enviarMarcadasASeguimiento(tabActiva.id);
      await recargarSeguimiento();
      if (escritas === 0) {
        // Diagnóstico temporal: distingue "la pestaña está vacía" de "tiene
        // filas pero ninguna marcada" — el mensaje genérico de antes daba lo
        // mismo en los dos casos y no dejaba saber cuál era.
        toast.info(
          totalEnPestana === 0
            ? `La pestaña «${tabActiva.nombre}» está vacía — agregale filas desde el índice maestro.`
            : `Ninguna de las ${totalEnPestana} fila${totalEnPestana === 1 ? "" : "s"} de «${tabActiva.nombre}» está marcada. Seleccionalas ahí y usá «Enviar a Tarjeta».`
        );
      } else {
        toast.success(`${escritas} fila${escritas === 1 ? "" : "s"} traída${escritas === 1 ? "" : "s"} al seguimiento.`);
      }
      // Los errores de cruce no abortan el resto: se avisa cuáles quedaron sin
      // resolver contra planillas_op y se sigue con las que sí cruzaron.
      if (errores.length) {
        toast.warning(`${errores.length} fila${errores.length === 1 ? "" : "s"} con problemas de cruce: ${errores.slice(0, 3).join(" · ")}${errores.length > 3 ? "…" : ""}`, { duration: 10000 });
      }
    } catch (e) {
      toast.error(`No se pudo sincronizar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSincronizando(false);
    }
  };

  // filtros: null = sin selección
  const [filtroVencer,   setFiltroVencer]   = useState<FiltroVencer>(null);
  const [filtroConsumo,  setFiltroConsumo]  = useState<FiltroConsumo>(null);
  const [filtroActivos,  setFiltroActivos]  = useState(false);
  const [filtroVencidos, setFiltroVencidos] = useState(false);

  const [tablePage,    setTablePage]    = useState(0);
  const [colWidths,    setColWidths]    = useState<Record<string, number>>(DEFAULT_WIDTHS_R);
  const [isResizing,   setIsResizing]   = useState(false);
  const resizing = useRef<{ col: string; startX: number; startW: number } | null>(null);

  // ── Nombres de columna editables (solo visual; la columna real no cambia) ──
  const [labels,         setLabels]         = useState<ColumnLabelMap>({});
  const [editingHeaders, setEditingHeaders] = useState(false);
  const [savingLabels,   setSavingLabels]   = useState(false);

  // ── Edición inline de celdas (zona, nombre_corto, observacion) ─────────────
  const [editingCell,  setEditingCell]  = useState<{ rowId: string; col: string } | null>(null);
  const [editingValue, setEditingValue] = useState("");

  // ── Selección y borrado de filas ────────────────────────────────────────────
  const [selected,        setSelected]        = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);

  // ── Orden de columnas (drag & drop), persistido por navegador ──────────────
  const [colOrder, setColOrder] = useState<string[]>(TABLE_COLS.map(c => c.db));
  const [dragCol,  setDragCol]  = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const colOrderLoaded = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLORDER_KEY);
      if (raw) {
        const saved: string[] = JSON.parse(raw);
        const known = new Set(TABLE_COLS.map(c => c.db));
        // Conserva el orden guardado; agrega al final columnas nuevas que no estaban guardadas.
        const merged = [...saved.filter(k => known.has(k)), ...TABLE_COLS.map(c => c.db).filter(k => !saved.includes(k))];
        setColOrder(merged);
      }
    } catch { /* ignorar */ }
    colOrderLoaded.current = true;
  }, []);

  useEffect(() => {
    if (!colOrderLoaded.current) return;
    try { localStorage.setItem(COLORDER_KEY, JSON.stringify(colOrder)); } catch { /* ignorar */ }
  }, [colOrder]);

  // ── Agrupado por OP: siempre activo — es como se controla el estado de
  //    cada servicio, no tiene sentido ofrecer una vista plana sin OP. ──────
  const [expandedOps, setExpandedOps] = useState<Set<string>>(new Set());

  const toggleOp = (op: string) => setExpandedOps(prev => {
    const n = new Set(prev);
    n.has(op) ? n.delete(op) : n.add(op);
    return n;
  });

  const orderedCols = useMemo(
    () => colOrder.map(db => TABLE_COLS.find(c => c.db === db)).filter((c): c is { db: string; label: string } => !!c),
    [colOrder]
  );

  const handleColDrop = (targetDb: string) => {
    if (!dragCol || dragCol === targetDb) { setDragCol(null); setDragOverCol(null); return; }
    setColOrder(prev => {
      const arr = [...prev];
      const from = arr.indexOf(dragCol);
      const to   = arr.indexOf(targetDb);
      if (from === -1 || to === -1) return prev;
      arr.splice(from, 1);
      arr.splice(to, 0, dragCol);
      return arr;
    });
    setDragCol(null);
    setDragOverCol(null);
  };

  useEffect(() => { getColumnLabels(LABELS_SCOPE).then(setLabels).catch(() => {}); }, []);

  // Nombre visible de una columna: override del usuario o el label por defecto.
  const labelOf = (col: string, fallback: string) => labels[col] ?? fallback;

  // Guarda el nuevo nombre de una columna (o lo revierte si queda vacío/igual).
  const commitLabel = async (col: string, fallback: string, raw: string) => {
    const next = raw.trim();
    const current = labels[col] ?? "";
    if (next === current || (next === "" && !(col in labels))) return;
    // Optimista
    setLabels(prev => {
      const n = { ...prev };
      if (next === "" || next === fallback) delete n[col];
      else n[col] = next;
      return n;
    });
    try {
      if (next === "" || next === fallback) {
        // Revertir a default = borrar override
        await resetColumnLabel(LABELS_SCOPE, col);
      } else {
        await saveColumnLabel(LABELS_SCOPE, col, next);
      }
    } catch (e) {
      toast.error(`No se pudo guardar el nombre: ${e instanceof Error ? e.message : "error"}`);
      getColumnLabels(LABELS_SCOPE).then(setLabels).catch(() => {});
    }
  };

  // Restaura todos los nombres por defecto.
  const restoreLabels = async () => {
    setSavingLabels(true);
    const prev = labels;
    setLabels({});
    try {
      await resetAllColumnLabels(LABELS_SCOPE);
      toast.success("Nombres de columna restaurados");
    } catch (e) {
      setLabels(prev);
      toast.error(`No se pudo restaurar: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setSavingLabels(false);
    }
  };

  // ── Edición inline (zona, nombre_corto, observacion) ────────────────────────
  const startEdit = (rowId: string, col: string, val: unknown) => {
    setEditingCell({ rowId, col });
    setEditingValue(val == null ? "" : String(val));
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    const { rowId, col } = editingCell;
    setEditingCell(null);
    const newVal = editingValue.trim() === "" ? null : editingValue.trim();
    // Optimista
    setAllRows(prev => prev.map(r => r.id === rowId ? { ...r, [col]: newVal } : r));
    const { error } = await supabase.from("seguimiento").update({ [col]: newVal }).eq("id", rowId);
    if (error) {
      toast.error(`Error al guardar: ${error.message}`);
      // Revertir consultando de nuevo la fila
      const { data } = await supabase.from("seguimiento").select("*").eq("id", rowId).single();
      if (data) setAllRows(prev => prev.map(r => r.id === rowId ? (data as SeguimientoRow) : r));
    }
  };

  // ── Borrado de filas ─────────────────────────────────────────────────────────
  const handleDeleteRow = async (id: string) => {
    const prevRows = allRows;
    setAllRows(prev => prev.filter(r => r.id !== id));
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
    const { error } = await supabase.from("seguimiento").delete().eq("id", id);
    if (error) { toast.error(`Error al eliminar: ${error.message}`); setAllRows(prevRows); }
  };

  const handleDeleteSelected = async () => {
    if (!selected.size) return;
    if (!confirm(`¿Eliminar ${selected.size} fila${selected.size !== 1 ? "s" : ""} del seguimiento?`)) return;
    setDeletingSelected(true);
    const ids = [...selected];
    const { error } = await supabase.from("seguimiento").delete().in("id", ids);
    if (error) {
      toast.error(`Error al eliminar: ${error.message}`);
    } else {
      setAllRows(prev => prev.filter(r => !selected.has(r.id)));
      setSelected(new Set());
      toast.success(`${ids.length} fila${ids.length !== 1 ? "s" : ""} eliminada${ids.length !== 1 ? "s" : ""}`);
    }
    setDeletingSelected(false);
  };

  // ── Menú contextual de fila (click derecho) ─────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<CtxState | null>(null);

  const abrirMenuFila = (e: ReactMouseEvent, row: SeguimientoRow) => {
    e.preventDefault();
    const rowId = String(row.id);
    const items: (CtxItem | "sep")[] = [
      {
        label: "Copiar matrícula",
        icon: Copy,
        disabled: !row.matricula,
        onClick: () => {
          navigator.clipboard.writeText(String(row.matricula ?? ""))
            .then(() => toast.success("Copiado."))
            .catch(() => toast.error("No se pudo copiar."));
        },
      },
      "sep",
      {
        label: "Eliminar fila",
        icon: Trash2,
        danger: true,
        onClick: () => handleDeleteRow(rowId),
      },
    ];
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  };

  /** Relee `seguimiento`. Se usa en la carga inicial y después de sincronizar
   *  desde el Buscador, que inserta filas nuevas en esa tabla. */
  const recargarSeguimiento = async () => {
    const PAGE = 1000; const all: SeguimientoRow[] = []; let from = 0;
    while (true) {
      const { data, error } = await supabase.from("seguimiento").select("*").range(from, from + PAGE - 1);
      if (error || !data?.length) break;
      all.push(...data); if (data.length < PAGE) break; from += PAGE;
    }
    setAllRows(all);
  };

  // ── Carga única: filas de seguimiento + clasificación de matrículas ────────
  useEffect(() => {
    (async () => {
      setLoadingData(true);
      try {
        // Ya no se carga la clasificación Material/Servicio: se usaba solo para
        // el filtro «Solo servicios», que se quitó. Lo que llega acá ya viene
        // elegido desde la pestaña del Buscador.
        await recargarSeguimiento();
      } catch { /* la UI degrada con datos vacíos */ }
      setLoadingData(false);
    })();
  }, []);

  // ── Universo base: todo el seguimiento, más el estado de la OP ────────────
  // Todo el dashboard cuelga de acá: KPIs, tabla y agrupado por OP derivan de
  // baseRows, así que filtrar en este único punto se propaga solo.
  const baseRows = allRows;

  // KPIs fijos (Activos / Vencidos) sobre el universo base.
  const { activos, vencidos } = useMemo(() => {
    let a = 0, v = 0;
    for (const r of baseRows) {
      if (r.estado_plazo === "OK" && r.estado_cantidades === "VIGENTE") a++;
      if (r.estado_plazo === "VENCIDA") v++;
    }
    return { activos: a, vencidos: v };
  }, [baseRows]);

  // Conteo "Por vencer" según el bucket seleccionado (3M / 4M).
  const porVencer = useMemo(() => {
    if (filtroVencer === null) return null;
    const t = new Date(); const lim = new Date(t); lim.setMonth(lim.getMonth() + filtroVencer);
    const ts = t.toISOString().split("T")[0]; const ls = lim.toISOString().split("T")[0];
    return baseRows.filter(r => {
      const f = r.fecha_pactada ? String(r.fecha_pactada).split("T")[0] : null;
      return f !== null && f >= ts && f <= ls;
    }).length;
  }, [baseRows, filtroVencer]);

  // Conteo "Por consumirse" (saldo / cantidad ≤ pct).
  const porConsumirse = useMemo(() => {
    if (filtroConsumo === null) return null;
    const pct = filtroConsumo / 100;
    return baseRows.filter(r => { const c = Number(r.cantidad); const s = Number(r.saldo_linea); return c > 0 && s / c <= pct; }).length;
  }, [baseRows, filtroConsumo]);

  // Filas de la tabla: universo base + filtros activos.
  const tableRows = useMemo(() => {
    let res = baseRows;
    if (filtroVencer !== null) {
      const t = new Date(); const lim = new Date(t); lim.setMonth(lim.getMonth() + filtroVencer);
      const ts = t.toISOString().split("T")[0]; const ls = lim.toISOString().split("T")[0];
      res = res.filter(r => { const f = r.fecha_pactada ? String(r.fecha_pactada).split("T")[0] : null; return f !== null && f >= ts && f <= ls; });
    }
    if (filtroActivos)  res = res.filter(r => r.estado_plazo === "OK" && r.estado_cantidades === "VIGENTE");
    if (filtroVencidos) res = res.filter(r => r.estado_plazo === "VENCIDA");
    if (filtroConsumo !== null) {
      const pct = filtroConsumo / 100;
      res = res.filter(r => { const c = Number(r.cantidad); const s = Number(r.saldo_linea); return c > 0 && s / c <= pct; });
    }
    return res;
  }, [baseRows, filtroVencer, filtroConsumo, filtroActivos, filtroVencidos]);

  // Reinicia la paginación cuando cambia el conjunto mostrado.
  useEffect(() => { setTablePage(0); }, [tableRows.length]);

  // Alertas recientes (por vencer / alto consumo) sobre el universo base.
  const alertas = useMemo(() => {
    const today = new Date();
    // Mes calendario, no 30 días fijos: `3 * 30` corría la fecha ~5 días por
    // año y no coincidía con lo que evalúa la campana.
    const enMeses = (m: number) => { const d = new Date(today); d.setMonth(d.getMonth() + m); return d; };
    const limiteCritico = enMeses(umbrales.vence_critico_meses);
    const limiteAviso   = enMeses(umbrales.vence_aviso_meses);
    const alertasGen: Alerta[] = [];
    const alertIds = new Set<string>();
    for (const row of baseRows) {
      const op = Number(row.op);
      const zona = String(row.zona ?? "—");
      const descripcion = String(row.descripcion_matricula ?? row.descripcion_sc ?? "");
      const fecha_pactada = row.fecha_pactada ? new Date(String(row.fecha_pactada)) : null;
      const cantidad = Number(row.cantidad);
      const saldo = Number(row.saldo_linea);
      const razon = cantidad > 0 ? saldo / cantidad : 1;
      const alertId = `${op}-${zona}`;

      if (fecha_pactada && fecha_pactada >= today && fecha_pactada <= limiteCritico) {
        const id = `${alertId}-vc`;
        if (!alertIds.has(id)) { alertasGen.push({ id, tipo: "vence", etiqueta: `Vence en ${umbrales.vence_critico_meses} ${umbrales.vence_critico_meses === 1 ? "mes" : "meses"}`, op, zona, descripcion, fecha: fecha_pactada.toISOString().split("T")[0], severity: "high" }); alertIds.add(id); }
      } else if (fecha_pactada && fecha_pactada >= today && fecha_pactada <= limiteAviso) {
        const id = `${alertId}-va`;
        if (!alertIds.has(id)) { alertasGen.push({ id, tipo: "vence", etiqueta: `Vence en ${umbrales.vence_aviso_meses} ${umbrales.vence_aviso_meses === 1 ? "mes" : "meses"}`, op, zona, descripcion, fecha: fecha_pactada.toISOString().split("T")[0], severity: "medium" }); alertIds.add(id); }
      }

      if (cantidad > 0 && razon * 100 <= umbrales.saldo_critico_pct) {
        const id = `${alertId}-sc`;
        if (!alertIds.has(id)) { alertasGen.push({ id, tipo: "saldo", etiqueta: `Saldo ≤${umbrales.saldo_critico_pct}%`, op, zona, descripcion, fecha: today.toISOString().split("T")[0], severity: "high" }); alertIds.add(id); }
      } else if (cantidad > 0 && razon * 100 <= umbrales.saldo_aviso_pct) {
        const id = `${alertId}-sa`;
        if (!alertIds.has(id)) { alertasGen.push({ id, tipo: "saldo", etiqueta: `Saldo ≤${umbrales.saldo_aviso_pct}%`, op, zona, descripcion, fecha: today.toISOString().split("T")[0], severity: "medium" }); alertIds.add(id); }
      }
    }
    alertasGen.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    return alertasGen.slice(0, 10);
  }, [baseRows, umbrales]);

  const cycleVencer  = () => { const i = CYCLE_VENCER.indexOf(filtroVencer);   setFiltroVencer(CYCLE_VENCER[(i + 1) % CYCLE_VENCER.length]);   };
  const cycleConsumo = () => { const i = CYCLE_CONSUMO.indexOf(filtroConsumo); setFiltroConsumo(CYCLE_CONSUMO[(i + 1) % CYCLE_CONSUMO.length]); };

  const tableLoading = loadingData;
  const fmt = (n: number | null) => n === null ? "—" : n.toLocaleString("es-AR");
  const todayRef   = useMemo(() => new Date(), []);

  // ── Agrupación por OP: agrupa las filas ya filtradas/ordenadas ──────────────
  const groups = useMemo(() => {
    const map = new Map<string, SeguimientoRow[]>();
    for (const r of tableRows) {
      const k = String(r.op ?? "—");
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return [...map.entries()].map(([op, rows]) => ({
      op, rows,
      saldo: rows.reduce((s, r) => s + (Number(r.saldo_linea) || 0), 0),
    }));
  }, [tableRows]);

  // Paginación por grupo (OP).
  const totalPages  = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const pagedGroups = groups.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE);

  // OPs con una sola línea van sueltas (sin agrupar) — agrupar no aporta nada
  // ahí y era la mayoría de las filas, tapando de entrada las OPs con más de
  // una línea que sí necesitan desplegarse para comparar.
  const gruposMulti = useMemo(() => groups.filter(g => g.rows.length > 1), [groups]);

  // Filas visibles (sueltas + grupos multilínea desplegados) — para selección por rango.
  const visibleRows = pagedGroups.flatMap(g => (g.rows.length === 1 || expandedOps.has(g.op) ? g.rows : []));

  // ── Selección de filas: click / ctrl+click / shift+click, estilo Windows ────
  // (sin checkboxes — un click selecciona sola, ctrl suma/saca, shift arma
  // el rango contra la última fila clickeada, tomando el orden visible).
  const lastClicked = useRef<string | null>(null);

  const handleRowClick = (e: ReactMouseEvent, row: SeguimientoRow) => {
    const rowId = String(row.id);
    if (e.shiftKey && lastClicked.current) {
      const ids = visibleRows.map(r => String(r.id));
      const a = ids.indexOf(lastClicked.current);
      const b = ids.indexOf(rowId);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = ids.slice(lo, hi + 1);
        setSelected(prev => { const n = new Set(prev); range.forEach(id => n.add(id)); return n; });
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected(prev => { const n = new Set(prev); n.has(rowId) ? n.delete(rowId) : n.add(rowId); return n; });
    } else {
      setSelected(new Set([rowId]));
    }
    lastClicked.current = rowId;
  };

  // Render de una fila de datos (reutilizado por cada grupo de OP).
  const renderDataRow = (row: SeguimientoRow) => {
    const rowId = String(row.id);
    const isSelected = selected.has(rowId);
    return (
      <Fragment key={rowId}>
      <tr
        onClick={(e) => handleRowClick(e, row)}
        onContextMenu={(e) => abrirMenuFila(e, row)}
        style={{ boxShadow: "inset 0 -1px 0 hsl(var(--border))" }}
        className={cn(
          "cursor-pointer transition-colors",
          isSelected ? "bg-accent/15 hover:bg-accent/20" : "even:bg-panel-2/20 hover:bg-panel-2/40"
        )}>
        <td className="py-2.5 px-3" />
        {orderedCols.map(c => {
          if (c.db === "dias_vencer") {
            const dias  = diasParaVencer(row.fecha_pactada, todayRef);
            const saldo = Number(row.saldo_linea);
            let content = <span className="text-muted-foreground">—</span>;
            if (dias !== null) {
              if (dias < 0) {
                content = saldo > 0
                  ? <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-accent-red/15 text-accent-red">Vencido {Math.abs(dias)} d</span>
                  : <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-panel-2 text-muted-foreground">Vencido</span>;
              } else {
                const tone = dias <= 90 ? "bg-accent-red/15 text-accent-red" : dias <= 120 ? "bg-accent-amber/15 text-accent-amber" : "bg-accent-green/15 text-accent-green";
                content = <span className={cn("px-1.5 py-0.5 rounded text-[11px] font-medium", tone)}>{dias} d</span>;
              }
            }
            return <td key={c.db} className="py-2.5 px-3 whitespace-nowrap overflow-hidden">{content}</td>;
          }

          const val     = row[c.db];
          const display = typeof val === "number" && !RAW_COLS_T.has(c.db) ? val.toLocaleString("es-AR") : String(val ?? "");

          if (c.db === "estado") {
            return (
              <td key={c.db} className="py-2.5 px-3 whitespace-nowrap overflow-hidden" title={display}>
                <span className={cn("px-1.5 py-0.5 rounded text-[11px] font-medium", isAbierto(val) ? "bg-accent-green/15 text-accent-green" : "bg-panel-2 text-muted-foreground")}>{display || "—"}</span>
              </td>
            );
          }

          if (EDITABLE_COLS.has(c.db)) {
            const isEditing = editingCell?.rowId === rowId && editingCell.col === c.db;
            return (
              <td key={c.db} className="py-1.5 px-3 whitespace-nowrap overflow-hidden group" title={isEditing ? undefined : display}>
                {isEditing ? (
                  <input
                    autoFocus value={editingValue}
                    onChange={e => setEditingValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveEdit(); } if (e.key === "Escape") { setEditingCell(null); } }}
                    onBlur={saveEdit}
                    className="w-full min-w-[80px] bg-panel-2 border border-accent rounded px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                ) : (
                  <div className="flex items-center justify-between gap-1.5 cursor-pointer" onClick={() => startEdit(rowId, c.db, val)}>
                    <span className="text-foreground truncate block">{display || "—"}</span>
                    <Pencil className="w-3 h-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity duration-150 ml-auto" />
                  </div>
                )}
              </td>
            );
          }

          return (
            <td key={c.db} className="py-2.5 px-3 whitespace-nowrap overflow-hidden" title={display}>
              <span className="text-foreground truncate block">{display || "—"}</span>
            </td>
          );
        })}
      </tr>
      </Fragment>
    );
  };

  return (
    <div className="space-y-6">
      {/* Origen de los datos: lo que se trajo del Buscador. Único filtro: el
          estado de la OP. */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Traer lo marcado del Buscador. Es una escritura en `seguimiento`,
              no un filtro: sin esto, marcar filas en la pestaña no las hace
              aparecer acá porque esta pantalla no lee el índice del Buscador. */}
          <button
            onClick={sincronizarDesdeBuscador}
            disabled={!tabActiva || sincronizando}
            title={
              !tabActiva
                ? 'No hay una pestaña «Servicios» en el Buscador todavía — creala ahí con ese nombre.'
                : "Traer al seguimiento las filas marcadas con «Enviar a Tarjeta» en la pestaña Servicios"
            }
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-hairline bg-panel text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-accent/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sincronizando
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />}
            Traer del Buscador
          </button>

        </div>
        <p className="text-xs text-muted-foreground">
          {tabActiva
            ? <>Desde la pestaña <span className="text-foreground font-medium">{tabActiva.nombre}</span></>
            : "Sin pestaña «Servicios» en el Buscador"}
          {!loadingData && <> · <span className="text-foreground font-medium">{baseRows.length.toLocaleString("es-AR")}</span> líneas</>}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Activos — toggle */}
        <button
          onClick={() => setFiltroActivos(v => !v)}
          className={cn(
            "bg-panel rounded-xl p-5 text-left transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 duration-500",
            filtroActivos
              ? "border-2 border-accent-green shadow-[0_0_0_1px_oklch(0.55_0.18_145/0.3)]"
              : "border border-hairline hover:border-accent-green/40"
          )}
          style={{ animationFillMode: "both" }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Activos</span>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-accent-green/10">
              <CheckCircle2 className="w-5 h-5 text-accent-green" />
            </div>
          </div>
          <p className="text-2xl font-bold text-foreground">{fmt(activos)}</p>
          <p className={cn("text-xs mt-1.5 font-medium", filtroActivos ? "text-accent-green" : "text-muted-foreground/50")}>
            {filtroActivos ? "Filtro activo" : "Sin selección"}
          </p>
        </button>

        {/* Por vencer — ciclo */}
        <button
          onClick={cycleVencer}
          className={cn(
            "bg-panel rounded-xl p-5 text-left transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 duration-500",
            filtroVencer !== null
              ? "border-2 border-accent-amber shadow-[0_0_0_1px_oklch(0.75_0.18_80/0.3)]"
              : "border border-hairline hover:border-accent-amber/40"
          )}
          style={{ animationDelay: "75ms", animationFillMode: "both" }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Por vencer</span>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-accent-amber/10">
              <CalendarClock className="w-5 h-5 text-accent-amber" />
            </div>
          </div>
          <p className="text-2xl font-bold text-foreground">{fmt(porVencer)}</p>
          <p className={cn("text-xs mt-1.5 font-medium", filtroVencer !== null ? "text-accent-amber" : "text-muted-foreground/50")}>
            {filtroVencer !== null ? `Próximos ${filtroVencer} meses · clic para cambiar` : "Sin selección · clic para activar"}
          </p>
        </button>

        {/* Por Consumirse — ciclo */}
        <button
          onClick={cycleConsumo}
          className={cn(
            "bg-panel rounded-xl p-5 text-left transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 duration-500",
            filtroConsumo !== null
              ? "border-2 border-orange-400 shadow-[0_0_0_1px_oklch(0.75_0.18_50/0.3)]"
              : "border border-hairline hover:border-orange-400/40"
          )}
          style={{ animationDelay: "150ms", animationFillMode: "both" }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Por Consumirse</span>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-orange-400/10">
              <TrendingDown className="w-5 h-5 text-orange-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-foreground">{fmt(porConsumirse)}</p>
          <p className={cn("text-xs mt-1.5 font-medium", filtroConsumo !== null ? "text-orange-400" : "text-muted-foreground/50")}>
            {filtroConsumo !== null ? `≤${filtroConsumo}% restante · clic para cambiar` : "Sin selección · clic para activar"}
          </p>
        </button>

        {/* Vencidos — toggle */}
        <button
          onClick={() => setFiltroVencidos(v => !v)}
          className={cn(
            "bg-panel rounded-xl p-5 text-left transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 duration-500",
            filtroVencidos
              ? "border-2 border-accent-red shadow-[0_0_0_1px_oklch(0.55_0.22_25/0.3)]"
              : "border border-hairline hover:border-accent-red/40"
          )}
          style={{ animationDelay: "225ms", animationFillMode: "both" }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Vencidos</span>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-accent-red/10">
              <XCircle className="w-5 h-5 text-accent-red" />
            </div>
          </div>
          <p className="text-2xl font-bold text-foreground">{fmt(vencidos)}</p>
          <p className={cn("text-xs mt-1.5 font-medium", filtroVencidos ? "text-accent-red" : "text-muted-foreground/50")}>
            {filtroVencidos ? "Filtro activo" : "Sin selección"}
          </p>
        </button>

      </div>

      {/* Tabla filtrada */}
      <div className="bg-panel border border-hairline rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-hairline bg-panel-2/30">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {[
                filtroActivos  && "Activos",
                filtroVencer  !== null && `Próximos ${filtroVencer} meses`,
                filtroConsumo !== null && `≤${filtroConsumo}% restante`,
                filtroVencidos && "Vencidos",
              ].filter(Boolean).join(" · ") || "Todos los servicios"}
            </p>
            {!tableLoading && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {tableRows.length} resultado{tableRows.length !== 1 ? "s" : ""} · {groups.length} OP
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {tableLoading && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
            {gruposMulti.length > 0 && (
              <button
                onClick={() => setExpandedOps(prev => prev.size >= gruposMulti.length ? new Set() : new Set(gruposMulti.map(g => g.op)))}
                title="Desplegar o colapsar las OPs con más de una línea"
                className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs text-muted-foreground hover:text-foreground border border-hairline hover:bg-panel-2 transition-colors"
              >
                {expandedOps.size >= gruposMulti.length ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {expandedOps.size >= gruposMulti.length ? "Colapsar" : "Desplegar"} OPs con varias líneas
              </button>
            )}
            {selected.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={deletingSelected}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs text-accent-red bg-accent-red/10 hover:bg-accent-red/20 border border-accent-red/30 transition-colors disabled:opacity-50"
              >
                {deletingSelected ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Eliminar seleccionadas ({selected.size})
              </button>
            )}
            {editingHeaders && (
              <button
                onClick={restoreLabels}
                disabled={savingLabels}
                title="Restaurar los nombres por defecto"
                className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs text-muted-foreground hover:text-foreground border border-hairline hover:bg-panel-2 transition-colors disabled:opacity-40"
              >
                {savingLabels ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                Restaurar
              </button>
            )}
            <button
              onClick={() => setEditingHeaders(v => !v)}
              title={editingHeaders ? "Terminar de editar nombres" : "Editar los nombres de las columnas"}
              className={cn(
                "flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs border transition-colors",
                editingHeaders
                  ? "bg-accent/15 text-accent border-accent/40"
                  : "text-muted-foreground hover:text-foreground border-hairline hover:bg-panel-2"
              )}
            >
              {editingHeaders ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
              {editingHeaders ? "Listo" : "Editar columnas"}
            </button>
          </div>
        </div>

        {tableLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-accent animate-spin" />
          </div>
        ) : tableRows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Sin resultados para los filtros seleccionados
          </div>
        ) : (
          <>
            <div className={cn("overflow-auto max-h-[62vh]", isResizing && "select-none cursor-col-resize")}>
              <table className="text-xs" style={{ tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0, width: 32 + orderedCols.reduce((s, c) => s + (colWidths[c.db] ?? DEFAULT_WIDTHS_R[c.db] ?? 100), 0) }}>
                {/*
                  ⚠ El <colgroup> tiene que tener EXACTAMENTE un <col> por
                  columna real (1 checkbox + orderedCols). Antes declaraba 3
                  <col> de más (32/40 al principio, 40 al final) que quedaron
                  de cuando esta tabla tenía pin/#/borrar como columnas propias
                  — se les sacó el <th>/<td> en su momento pero no el <col>.
                  El navegador asigna cada <col> por POSICIÓN, no por
                  contenido, así que esos <col> sobrantes corrían el ancho de
                  cada columna real un lugar (o tres) a la derecha: todo se
                  veía desalineado aunque los datos en sí estuvieran bien.
                */}
                <colgroup>
                  <col style={{ width: 32 }} />
                  {orderedCols.map(c => <col key={c.db} style={{ width: colWidths[c.db] ?? DEFAULT_WIDTHS_R[c.db] ?? 100 }} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th className="sticky top-0 z-10 bg-panel-header border-b border-hairline py-2.5 px-3" />

                    {orderedCols.map(c => (
                      <th
                        key={c.db}
                        style={{ width: colWidths[c.db] ?? DEFAULT_WIDTHS_R[c.db] ?? 100 }}
                        className={cn(
                          "sticky top-0 z-10 bg-panel-header border-b border-hairline group/th py-2.5 pl-3 pr-4 text-left text-muted-foreground font-semibold whitespace-nowrap uppercase tracking-wider transition-opacity",
                          dragCol === c.db && "opacity-40",
                          dragOverCol === c.db && dragCol !== c.db && "bg-accent/10 ring-1 ring-inset ring-accent/40"
                        )}
                        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragCol && dragCol !== c.db) setDragOverCol(c.db); }}
                        onDragLeave={() => setDragOverCol(prev => (prev === c.db ? null : prev))}
                        onDrop={e => { e.preventDefault(); handleColDrop(c.db); }}
                        onPointerMove={e => {
                          if (!resizing.current) return;
                          const newW = Math.max(50, resizing.current.startW + (e.clientX - resizing.current.startX));
                          setColWidths(prev => ({ ...prev, [resizing.current!.col]: newW }));
                        }}
                        onPointerUp={e => {
                          // Solo soltar la captura si este <th> la tomó. La captura
                          // se pide en el handle de resize, no acá: en un click común
                          // sobre el header el pointerId no está capturado y
                          // releasePointerCapture tira NotFoundError, que rompía el
                          // handler justo al tocar el header (y con él, el arrastre).
                          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                            e.currentTarget.releasePointerCapture(e.pointerId);
                          }
                          if (!resizing.current) return;
                          resizing.current = null;
                          setIsResizing(false);
                        }}
                      >
                        <div
                          className={cn("flex items-center gap-1 w-full", !editingHeaders && "cursor-grab active:cursor-grabbing")}
                          draggable={!editingHeaders}
                          onDragStart={e => {
                            setDragCol(c.db);
                            // dataTransfer.setData es obligatorio para que el drag
                            // arranque en Firefox — sin esto, dragstart dispara pero
                            // dragover/drop nunca llegan y el arrastre queda muerto
                            // (Chrome lo tolera, por eso pasaba desapercibido).
                            // Mismo bug que ya se arregló en el panel «Columnas» del
                            // Buscador (commit 0a4b9ac).
                            e.dataTransfer.setData("text/plain", c.db);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => { setDragCol(null); setDragOverCol(null); }}
                        >
                          {editingHeaders ? (
                            <input
                              defaultValue={labelOf(c.db, c.label)}
                              onClick={e => e.stopPropagation()}
                              onKeyDown={e => {
                                if (e.key === "Enter")  { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                                if (e.key === "Escape") { (e.target as HTMLInputElement).value = labelOf(c.db, c.label); (e.target as HTMLInputElement).blur(); }
                              }}
                              onBlur={e => commitLabel(c.db, c.label, e.target.value)}
                              placeholder={c.label}
                              className="w-full bg-panel-2 border border-accent rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-foreground focus:outline-none focus:ring-1 focus:ring-accent normal-case"
                              style={{ textTransform: "none" }}
                            />
                          ) : (
                            <span className="block truncate" title={labelOf(c.db, c.label)}>{labelOf(c.db, c.label)}</span>
                          )}
                        </div>
                        {!editingHeaders && (
                          <div
                            className="absolute right-0 top-0 h-full w-2 flex items-center justify-center cursor-col-resize group/handle hover:bg-accent/10"
                            draggable={false}
                            onPointerDown={e => {
                              e.preventDefault(); e.stopPropagation();
                              e.currentTarget.setPointerCapture(e.pointerId);
                              resizing.current = { col: c.db, startX: e.clientX, startW: colWidths[c.db] ?? DEFAULT_WIDTHS_R[c.db] ?? 100 };
                              setIsResizing(true);
                            }}
                            onPointerMove={e => {
                              if (!resizing.current) return;
                              const newW = Math.max(50, resizing.current.startW + (e.clientX - resizing.current.startX));
                              setColWidths(prev => ({ ...prev, [resizing.current!.col]: newW }));
                            }}
                            onPointerUp={e => {
                              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                                e.currentTarget.releasePointerCapture(e.pointerId);
                              }
                              resizing.current = null;
                              setIsResizing(false);
                            }}
                          >
                            <div className="w-px h-4 bg-hairline group-hover/handle:bg-accent transition-colors" />
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedGroups.map(g => {
                    // OP de una sola línea: va suelta, sin cabecera de grupo —
                    // agrupar acá no aporta nada y era la mayoría de las filas.
                    if (g.rows.length === 1) return renderDataRow(g.rows[0]);

                    const isExp = expandedOps.has(g.op);
                    return (
                      <Fragment key={g.op}>
                        <tr
                          onClick={() => toggleOp(g.op)}
                          style={{ boxShadow: "inset 0 -1px 0 hsl(var(--border))" }}
                          className="cursor-pointer bg-panel-2/40 hover:bg-panel-2/60 transition-colors"
                        >
                          <td colSpan={orderedCols.length + 1} className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              {isExp ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                              <span className="font-semibold text-foreground tabular-nums">OP {g.op}</span>
                              <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-accent/15 text-accent">
                                {g.rows.length} línea{g.rows.length !== 1 ? "s" : ""}
                              </span>
                              <span className="ml-auto text-xs text-muted-foreground">
                                Saldo total: <span className="text-foreground font-medium tabular-nums">{fmt(g.saldo)}</span>
                              </span>
                            </div>
                          </td>
                        </tr>
                        {isExp && g.rows.map((r) => renderDataRow(r))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-hairline bg-panel-2/30">
                <span className="text-xs text-muted-foreground">
                  {tableRows.length} resultado{tableRows.length !== 1 ? "s" : ""}
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setTablePage(p => p - 1)} disabled={tablePage === 0}
                    className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-panel-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    Anterior
                  </button>
                  <span className="px-3 py-1.5 rounded-lg text-xs bg-accent text-accent-foreground font-medium">
                    {tablePage + 1} / {totalPages}
                  </span>
                  <button onClick={() => setTablePage(p => p + 1)} disabled={tablePage >= totalPages - 1}
                    className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-panel-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Alertas recientes */}
      <div className="bg-panel border border-hairline rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 delay-400">
        <div className="flex items-center justify-between p-5 border-b border-hairline">
          <div>
            <h3 className="text-base font-semibold text-foreground">Alertas recientes</h3>
            <p className="text-sm text-muted-foreground mt-0.5">Servicios por vencer o con alto consumo</p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-accent-red font-medium bg-accent-red/10 px-2.5 py-1 rounded-full">
            <AlertTriangle className="w-3 h-3" />
            {alertas.filter((a) => a.severity === "high").length} críticas
          </span>
        </div>
        <div className="divide-y divide-border">
          {alertas.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              Sin alertas — todos los servicios están en buen estado
            </div>
          ) : (
            alertas.map((alerta, i) => (
              <div
                key={alerta.id}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-panel-2/30 transition-colors duration-150 animate-in fade-in slide-in-from-left-2"
                style={{ animationDelay: `${i * 40}ms`, animationFillMode: "both" }}
              >
                <div className="flex items-center gap-3">
                  <div className={cn("w-2 h-2 rounded-full shrink-0 mt-0.5", alerta.severity === "high" ? "bg-accent-red" : "bg-accent-amber")} />
                  <div>
                    <p className="text-sm text-foreground truncate max-w-[700px]">
                      <span className="font-bold">OP {alerta.op}</span>
                      <span className="font-bold"> · {alerta.etiqueta}</span>
                      {alerta.descripcion && (
                        <span className="font-normal text-muted-foreground"> — {alerta.descripcion.length > 60 ? alerta.descripcion.slice(0, 60) + "…" : alerta.descripcion}</span>
                      )}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 ml-4">{alerta.fecha}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {ctxMenu && <RowContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />}
    </div>
  );
}
