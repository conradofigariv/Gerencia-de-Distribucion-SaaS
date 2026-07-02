"use client";

import { useState, useEffect, useRef, useMemo } from "react";
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
  Wrench,
  Layers,
  LockOpen,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  getColumnLabels,
  saveColumnLabel,
  resetColumnLabel,
  resetAllColumnLabels,
  type ColumnLabelMap,
} from "@/lib/columnLabels";
import { getMatriculasInfo, getFamilies, type ArticuloTipo } from "@/lib/stockFamilies";
import { normArticulo } from "@/lib/tableroOp";

// Scope de las etiquetas editables para esta sección.
const LABELS_SCOPE = "servicios-resumen";

type Alerta = {
  id: string;
  tipo: "Vencimiento 3M" | "Vencimiento 4M" | "Consumo 30%" | "Consumo 40%";
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
  { db: "op",                    label: "OP"              },
  { db: "matricula",             label: "MATRÍCULA"       },
  { db: "descripcion_matricula", label: "DESCRIPCIÓN"     },
  { db: "cantidad",              label: "CANTIDAD"        },
  { db: "saldo_linea",           label: "SALDO"           },
  { db: "fecha_pactada",         label: "FECHA PACTADA"   },
  { db: "dias_vencer",           label: "DÍAS P/ VENCER"  },
  { db: "estado",                label: "ESTADO"          },
  { db: "proveedor",             label: "PROVEEDOR"       },
];
const RAW_COLS_T     = new Set(["op", "op_madre", "linea"]);
const PAGE_SIZE      = 50;

const DEFAULT_WIDTHS_R: Record<string, number> = {
  zona: 80, nombre_corto: 140, op: 90, matricula: 110, descripcion_matricula: 240,
  cantidad: 90, saldo_linea: 100, fecha_pactada: 120, dias_vencer: 130,
  estado: 100, proveedor: 170,
};

type SeguimientoRow = Record<string, unknown>;

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

export function ServiciosResumenSection() {
  // Carga única de los datos; todo lo demás se deriva en memoria.
  const [allRows,     setAllRows]     = useState<SeguimientoRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [tipoMap,     setTipoMap]     = useState<Map<string, ArticuloTipo>>(new Map());

  // Universo: tipo (servicios vs. todas) y estado de la OP (abierto), filtros independientes.
  const [soloServicios, setSoloServicios] = useState(true);
  const [filtroAbierto, setFiltroAbierto] = useState(true);

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

  // ── Carga única: filas de seguimiento + clasificación de matrículas ────────
  useEffect(() => {
    (async () => {
      setLoadingData(true);
      try {
        const PAGE = 1000; const all: SeguimientoRow[] = []; let from = 0;
        while (true) {
          const { data, error } = await supabase.from("seguimiento").select("*").range(from, from + PAGE - 1);
          if (error || !data?.length) break;
          all.push(...data); if (data.length < PAGE) break; from += PAGE;
        }
        setAllRows(all);

        // Clasificación Material/Servicio: catálogo (matriculas.mat_serv) +
        // override manual (stock_article_families.tipo). El override gana.
        const [matInfo, fams] = await Promise.all([getMatriculasInfo(), getFamilies()]);
        const map = new Map<string, ArticuloTipo>();
        const setTipo = (art: string, tipo: ArticuloTipo) => {
          if (!art || !tipo) return;
          map.set(art, tipo);
          const n = normArticulo(art);
          if (n !== art && !map.has(n)) map.set(n, tipo);   // fallback normalizado
        };
        for (const [art, info] of matInfo) setTipo(art, info.tipo);
        for (const f of fams) if (f.tipo) setTipo(f.articulo, f.tipo);
        setTipoMap(map);
      } catch { /* la UI degrada con datos vacíos */ }
      setLoadingData(false);
    })();
  }, []);

  // Tipo efectivo de una matrícula (override > catálogo). "" si no se conoce.
  const tipoOf = (matricula: unknown): ArticuloTipo => {
    const raw = String(matricula ?? "");
    return tipoMap.get(raw) ?? tipoMap.get(normArticulo(raw)) ?? "";
  };

  // ── Universo base: tipo (servicios/todas) y estado (abierto), combinables ──
  const baseRows = useMemo(() => {
    let rows = allRows;
    if (soloServicios && tipoMap.size > 0) rows = rows.filter(r => tipoOf(r.matricula) === "servicio");
    if (filtroAbierto) rows = rows.filter(r => isAbierto(r.estado));
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, soloServicios, filtroAbierto, tipoMap]);

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
  useEffect(() => { setTablePage(0); }, [tableRows.length, soloServicios, filtroAbierto]);

  // Alertas recientes (por vencer / alto consumo) sobre el universo base.
  const alertas = useMemo(() => {
    const today = new Date();
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

      if (fecha_pactada && fecha_pactada >= today && fecha_pactada.getTime() - today.getTime() <= 3 * 30 * MS_DAY) {
        const id = `${alertId}-3m`;
        if (!alertIds.has(id)) { alertasGen.push({ id, tipo: "Vencimiento 3M", op, zona, descripcion, fecha: fecha_pactada.toISOString().split("T")[0], severity: "high" }); alertIds.add(id); }
      } else if (fecha_pactada && fecha_pactada >= today && fecha_pactada.getTime() - today.getTime() <= 4 * 30 * MS_DAY) {
        const id = `${alertId}-4m`;
        if (!alertIds.has(id)) { alertasGen.push({ id, tipo: "Vencimiento 4M", op, zona, descripcion, fecha: fecha_pactada.toISOString().split("T")[0], severity: "medium" }); alertIds.add(id); }
      }

      if (cantidad > 0 && razon <= 0.3) {
        const id = `${alertId}-30p`;
        if (!alertIds.has(id)) { alertasGen.push({ id, tipo: "Consumo 30%", op, zona, descripcion, fecha: today.toISOString().split("T")[0], severity: "high" }); alertIds.add(id); }
      } else if (cantidad > 0 && razon <= 0.4) {
        const id = `${alertId}-40p`;
        if (!alertIds.has(id)) { alertasGen.push({ id, tipo: "Consumo 40%", op, zona, descripcion, fecha: today.toISOString().split("T")[0], severity: "medium" }); alertIds.add(id); }
      }
    }
    alertasGen.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    return alertasGen.slice(0, 10);
  }, [baseRows]);

  const cycleVencer  = () => { const i = CYCLE_VENCER.indexOf(filtroVencer);   setFiltroVencer(CYCLE_VENCER[(i + 1) % CYCLE_VENCER.length]);   };
  const cycleConsumo = () => { const i = CYCLE_CONSUMO.indexOf(filtroConsumo); setFiltroConsumo(CYCLE_CONSUMO[(i + 1) % CYCLE_CONSUMO.length]); };

  const tableLoading = loadingData;
  const fmt = (n: number | null) => n === null ? "—" : n.toLocaleString("es-AR");
  const totalPages = Math.ceil(tableRows.length / PAGE_SIZE);
  const pagedRows  = tableRows.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE);
  const todayRef   = useMemo(() => new Date(), []);

  return (
    <div className="space-y-6">
      {/* Universo: tipo (servicios/todas) + estado (abierto), filtros independientes */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="inline-flex items-center rounded-xl border border-border bg-card p-1 gap-1">
            <button
              onClick={() => setSoloServicios(true)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                soloServicios
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
              title="Solo matrículas de tipo Servicio"
            >
              <Wrench className="w-4 h-4" />Solo servicios
            </button>
            <button
              onClick={() => setSoloServicios(false)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                !soloServicios
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
              title="Todas las líneas (materiales y servicios)"
            >
              <Layers className="w-4 h-4" />Todas
            </button>
          </div>

          <button
            onClick={() => setFiltroAbierto(v => !v)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all",
              filtroAbierto
                ? "border-success/40 bg-success/15 text-success shadow-sm"
                : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-success/30"
            )}
            title="Solo líneas con OP abierta"
          >
            <LockOpen className="w-4 h-4" />Abierto
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {soloServicios ? "Servicios (Mat/Serv = Servicio)" : "Todas las líneas"}
          {filtroAbierto && " · OP abierta"}
          {!loadingData && <> · <span className="text-foreground font-medium">{baseRows.length.toLocaleString("es-AR")}</span> líneas</>}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Activos — toggle */}
        <button
          onClick={() => setFiltroActivos(v => !v)}
          className={cn(
            "bg-card rounded-xl p-5 text-left transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 duration-500",
            filtroActivos
              ? "border-2 border-success shadow-[0_0_0_1px_oklch(0.55_0.18_145/0.3)]"
              : "border border-border hover:border-success/40"
          )}
          style={{ animationFillMode: "both" }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Activos</span>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-success/10">
              <CheckCircle2 className="w-5 h-5 text-success" />
            </div>
          </div>
          <p className="text-2xl font-bold text-foreground">{fmt(activos)}</p>
          <p className={cn("text-xs mt-1.5 font-medium", filtroActivos ? "text-success" : "text-muted-foreground/50")}>
            {filtroActivos ? "Filtro activo" : "Sin selección"}
          </p>
        </button>

        {/* Por vencer — ciclo */}
        <button
          onClick={cycleVencer}
          className={cn(
            "bg-card rounded-xl p-5 text-left transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 duration-500",
            filtroVencer !== null
              ? "border-2 border-warning shadow-[0_0_0_1px_oklch(0.75_0.18_80/0.3)]"
              : "border border-border hover:border-warning/40"
          )}
          style={{ animationDelay: "75ms", animationFillMode: "both" }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Por vencer</span>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-warning/10">
              <CalendarClock className="w-5 h-5 text-warning" />
            </div>
          </div>
          <p className="text-2xl font-bold text-foreground">{fmt(porVencer)}</p>
          <p className={cn("text-xs mt-1.5 font-medium", filtroVencer !== null ? "text-warning" : "text-muted-foreground/50")}>
            {filtroVencer !== null ? `Próximos ${filtroVencer} meses · clic para cambiar` : "Sin selección · clic para activar"}
          </p>
        </button>

        {/* Por Consumirse — ciclo */}
        <button
          onClick={cycleConsumo}
          className={cn(
            "bg-card rounded-xl p-5 text-left transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 duration-500",
            filtroConsumo !== null
              ? "border-2 border-orange-400 shadow-[0_0_0_1px_oklch(0.75_0.18_50/0.3)]"
              : "border border-border hover:border-orange-400/40"
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
            "bg-card rounded-xl p-5 text-left transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 duration-500",
            filtroVencidos
              ? "border-2 border-destructive shadow-[0_0_0_1px_oklch(0.55_0.22_25/0.3)]"
              : "border border-border hover:border-destructive/40"
          )}
          style={{ animationDelay: "225ms", animationFillMode: "both" }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Vencidos</span>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-destructive/10">
              <XCircle className="w-5 h-5 text-destructive" />
            </div>
          </div>
          <p className="text-2xl font-bold text-foreground">{fmt(vencidos)}</p>
          <p className={cn("text-xs mt-1.5 font-medium", filtroVencidos ? "text-destructive" : "text-muted-foreground/50")}>
            {filtroVencidos ? "Filtro activo" : "Sin selección"}
          </p>
        </button>

      </div>

      {/* Tabla filtrada */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-secondary/30">
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
                {tableRows.length} resultado{tableRows.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {tableLoading && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
            {editingHeaders && (
              <button
                onClick={restoreLabels}
                disabled={savingLabels}
                title="Restaurar los nombres por defecto"
                className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs text-muted-foreground hover:text-foreground border border-border hover:bg-secondary transition-colors disabled:opacity-40"
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
                  : "text-muted-foreground hover:text-foreground border-border hover:bg-secondary"
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
              <table className="text-xs" style={{ tableLayout: "fixed", width: 40 + TABLE_COLS.reduce((s, c) => s + (colWidths[c.db] ?? DEFAULT_WIDTHS_R[c.db] ?? 100), 0) }}>
                <colgroup>
                  <col style={{ width: 40 }} />
                  {TABLE_COLS.map(c => <col key={c.db} style={{ width: colWidths[c.db] ?? DEFAULT_WIDTHS_R[c.db] ?? 100 }} />)}
                </colgroup>
                <thead>
                  <tr className="border-b border-border">
                    <th className="sticky top-0 z-10 bg-panel-header py-2.5 px-3 text-left text-muted-foreground font-semibold">#</th>
                    {TABLE_COLS.map(c => (
                      <th
                        key={c.db}
                        style={{ width: colWidths[c.db] ?? DEFAULT_WIDTHS_R[c.db] ?? 100 }}
                        className="sticky top-0 z-10 bg-panel-header relative group/th py-2.5 pl-3 pr-4 text-left text-muted-foreground font-semibold whitespace-nowrap uppercase tracking-wider"
                        onPointerMove={e => {
                          if (!resizing.current) return;
                          const newW = Math.max(50, resizing.current.startW + (e.clientX - resizing.current.startX));
                          setColWidths(prev => ({ ...prev, [resizing.current!.col]: newW }));
                        }}
                        onPointerUp={e => {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                          resizing.current = null;
                          setIsResizing(false);
                        }}
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
                            className="w-full bg-secondary border border-accent rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-foreground focus:outline-none focus:ring-1 focus:ring-accent normal-case"
                            style={{ textTransform: "none" }}
                          />
                        ) : (
                          <span className="block truncate" title={labelOf(c.db, c.label)}>{labelOf(c.db, c.label)}</span>
                        )}
                        {!editingHeaders && (
                          <div
                            className="absolute right-0 top-0 h-full w-2 flex items-center justify-center cursor-col-resize group/handle hover:bg-accent/10"
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
                              e.currentTarget.releasePointerCapture(e.pointerId);
                              resizing.current = null;
                              setIsResizing(false);
                            }}
                          >
                            <div className="w-px h-4 bg-border group-hover/handle:bg-accent transition-colors" />
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row, idx) => (
                    <tr key={idx} className="border-b border-border last:border-0 even:bg-secondary/20 hover:bg-secondary/40 transition-colors">
                      <td className="py-2.5 px-3 text-muted-foreground">{tablePage * PAGE_SIZE + idx + 1}</td>
                      {TABLE_COLS.map(c => {
                        // Columna calculada: días para vencer + color por riesgo.
                        if (c.db === "dias_vencer") {
                          const dias  = diasParaVencer(row.fecha_pactada, todayRef);
                          const saldo = Number(row.saldo_linea);
                          let content = <span className="text-muted-foreground">—</span>;
                          if (dias !== null) {
                            if (dias < 0) {
                              content = saldo > 0
                                ? <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-destructive/15 text-destructive">Vencido {Math.abs(dias)} d</span>
                                : <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-secondary text-muted-foreground">Vencido</span>;
                            } else {
                              const tone = dias <= 90 ? "bg-destructive/15 text-destructive"
                                         : dias <= 120 ? "bg-warning/15 text-warning"
                                         : "bg-success/15 text-success";
                              content = <span className={cn("px-1.5 py-0.5 rounded text-[11px] font-medium", tone)}>{dias} d</span>;
                            }
                          }
                          return <td key={c.db} className="py-2.5 px-3 whitespace-nowrap overflow-hidden">{content}</td>;
                        }

                        const val     = row[c.db];
                        const display = typeof val === "number" && !RAW_COLS_T.has(c.db)
                          ? val.toLocaleString("es-AR")
                          : String(val ?? "");

                        // Estado de cierre como pill (Abierto = verde).
                        if (c.db === "estado") {
                          return (
                            <td key={c.db} className="py-2.5 px-3 whitespace-nowrap overflow-hidden" title={display}>
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[11px] font-medium",
                                isAbierto(val) ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"
                              )}>{display || "—"}</span>
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
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/30">
                <span className="text-xs text-muted-foreground">
                  {tableRows.length} resultado{tableRows.length !== 1 ? "s" : ""}
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setTablePage(p => p - 1)} disabled={tablePage === 0}
                    className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    Anterior
                  </button>
                  <span className="px-3 py-1.5 rounded-lg text-xs bg-accent text-accent-foreground font-medium">
                    {tablePage + 1} / {totalPages}
                  </span>
                  <button onClick={() => setTablePage(p => p + 1)} disabled={tablePage >= totalPages - 1}
                    className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Alertas recientes */}
      <div className="bg-card border border-border rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 delay-400">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-foreground">Alertas recientes</h3>
            <p className="text-sm text-muted-foreground mt-0.5">Servicios por vencer o con alto consumo</p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-destructive font-medium bg-destructive/10 px-2.5 py-1 rounded-full">
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
                className="flex items-center justify-between px-5 py-3.5 hover:bg-secondary/30 transition-colors duration-150 animate-in fade-in slide-in-from-left-2"
                style={{ animationDelay: `${i * 40}ms`, animationFillMode: "both" }}
              >
                <div className="flex items-center gap-3">
                  <div className={cn("w-2 h-2 rounded-full shrink-0 mt-0.5", alerta.severity === "high" ? "bg-destructive" : "bg-warning")} />
                  <div>
                    <p className="text-sm text-foreground truncate max-w-[700px]">
                      <span className="font-bold">OP {alerta.op}</span>
                      <span className="font-bold"> · {alerta.tipo === "Vencimiento 3M" ? "Vence en 3 meses" :
                       alerta.tipo === "Vencimiento 4M" ? "Vence en 4 meses" :
                       alerta.tipo === "Consumo 30%"    ? "Consumo ≤30%"     : "Consumo ≤40%"}</span>
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
    </div>
  );
}
