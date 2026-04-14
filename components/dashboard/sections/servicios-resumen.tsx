"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  XCircle,
  CalendarClock,
  Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

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

const TABLE_COLS: { db: string; label: string }[] = [
  { db: "zona",                  label: "ZONA"                    },
  { db: "op",                    label: "OP"                      },
  { db: "op_madre",              label: "OP MADRE"                },
  { db: "sc",                    label: "SC"                      },
  { db: "descripcion_sc",        label: "DESCRIPCIÓN SC"          },
  { db: "linea",                 label: "LÍNEA"                   },
  { db: "matricula",             label: "MATRICULA"               },
  { db: "cantidad",              label: "CANTIDAD"                },
  { db: "cantidad_recibida",     label: "CANT. RECIBIDA"          },
  { db: "saldo_linea",           label: "SALDO"                   },
  { db: "fecha_pactada",         label: "FECHA PACTADA"           },
  { db: "proveedor",             label: "PROVEEDOR"               },
  { db: "estado",                label: "ESTADO"                  },
  { db: "estado_plazo",          label: "E. PLAZO"                },
  { db: "estado_cantidades",     label: "E. CANT."                },
  { db: "revision",              label: "REVISION"                },
  { db: "disponibilidad_meses",  label: "DISPONIB."               },
];
const STATUS_COLS_T = new Set(["estado_plazo", "estado_cantidades", "revision"]);
const RAW_COLS_T    = new Set(["op", "op_madre", "linea"]);
const PAGE_SIZE     = 50;

type SeguimientoRow = Record<string, unknown>;

export function ServiciosResumenSection() {
  const [activos,       setActivos]       = useState<number | null>(null);
  const [vencidos,      setVencidos]      = useState<number | null>(null);
  const [porVencer,     setPorVencer]     = useState<number | null>(null);
  const [porConsumirse, setPorConsumirse] = useState<number | null>(null);

  // filtros: null = sin selección
  const [filtroVencer,   setFiltroVencer]   = useState<FiltroVencer>(null);
  const [filtroConsumo,  setFiltroConsumo]  = useState<FiltroConsumo>(null);
  const [filtroActivos,  setFiltroActivos]  = useState(false);
  const [filtroVencidos, setFiltroVencidos] = useState(false);

  const [tableRows,    setTableRows]    = useState<SeguimientoRow[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [tablePage,    setTablePage]    = useState(0);
  const [alertas,      setAlertas]      = useState<Alerta[]>([]);

  // Conteos fijos (siempre activos)
  useEffect(() => {
    (async () => {
      const [actRes, venRes] = await Promise.all([
        supabase.from("seguimiento").select("*", { count: "exact", head: true }).eq("estado_plazo", "OK").eq("estado_cantidades", "VIGENTE"),
        supabase.from("seguimiento").select("*", { count: "exact", head: true }).eq("estado_plazo", "VENCIDA"),
      ]);
      setActivos(actRes.count ?? 0);
      setVencidos(venRes.count ?? 0);
    })();
  }, []);

  // Conteo Por vencer
  useEffect(() => {
    if (filtroVencer === null) { setPorVencer(null); return; }
    (async () => {
      setPorVencer(null);
      const today = new Date(); const limite = new Date(today);
      limite.setMonth(limite.getMonth() + filtroVencer);
      const { count } = await supabase.from("seguimiento")
        .select("*", { count: "exact", head: true })
        .gte("fecha_pactada", today.toISOString().split("T")[0])
        .lte("fecha_pactada", limite.toISOString().split("T")[0]);
      setPorVencer(count ?? 0);
    })();
  }, [filtroVencer]);

  // Conteo Por consumirse
  useEffect(() => {
    if (filtroConsumo === null) { setPorConsumirse(null); return; }
    (async () => {
      setPorConsumirse(null);
      const PAGE = 1000; const rows: { saldo_linea: unknown; cantidad: unknown }[] = []; let from = 0;
      while (true) {
        const { data, error } = await supabase.from("seguimiento").select("saldo_linea, cantidad").range(from, from + PAGE - 1);
        if (error || !data?.length) break;
        rows.push(...data); if (data.length < PAGE) break; from += PAGE;
      }
      const pct = filtroConsumo / 100;
      setPorConsumirse(rows.filter(r => { const c = Number(r.cantidad); const s = Number(r.saldo_linea); return c > 0 && s / c <= pct; }).length);
    })();
  }, [filtroConsumo]);

  // Tabla — re-ejecuta cuando cambia cualquier filtro
  useEffect(() => {
    (async () => {
      setTableLoading(true); setTablePage(0);
      const todayStr = new Date().toISOString().split("T")[0];
      const PAGE = 1000; const all: SeguimientoRow[] = []; let from = 0;
      while (true) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q: any = supabase.from("seguimiento").select("*");
        if (filtroVencer !== null) {
          const l = new Date(); l.setMonth(l.getMonth() + filtroVencer);
          q = q.gte("fecha_pactada", todayStr).lte("fecha_pactada", l.toISOString().split("T")[0]);
        }
        if (filtroActivos)  q = q.eq("estado_plazo", "OK").eq("estado_cantidades", "VIGENTE");
        if (filtroVencidos) q = q.eq("estado_plazo", "VENCIDA");
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error || !data?.length) break;
        all.push(...data); if (data.length < PAGE) break; from += PAGE;
      }
      let result = all;
      if (filtroConsumo !== null) {
        const pct = filtroConsumo / 100;
        result = all.filter(r => { const c = Number(r.cantidad); const s = Number(r.saldo_linea); return c > 0 && s / c <= pct; });
      }
      setTableRows(result); setTableLoading(false);
    })();
  }, [filtroVencer, filtroConsumo, filtroActivos, filtroVencidos]);

  // Generar alertas dinámicamente
  useEffect(() => {
    (async () => {
      const PAGE = 1000; const all: SeguimientoRow[] = []; let from = 0;
      while (true) {
        const { data, error } = await supabase.from("seguimiento").select("*").range(from, from + PAGE - 1);
        if (error || !data?.length) break;
        all.push(...data); if (data.length < PAGE) break; from += PAGE;
      }
      const today = new Date();
      const alertasGen: Alerta[] = [];
      const alertIds = new Set<string>();
      for (const row of all) {
        const op = Number(row.op);
        const zona = String(row.zona ?? "—");
        const descripcion = String(row.descripcion_sc ?? row.descripcion_matricula ?? "");
        const fecha_pactada = row.fecha_pactada ? new Date(String(row.fecha_pactada)) : null;
        const cantidad = Number(row.cantidad);
        const saldo = Number(row.saldo_linea);
        const razon = cantidad > 0 ? saldo / cantidad : 1;
        const alertId = `${op}-${zona}`;

        // Vencimiento 3M (rojo)
        if (fecha_pactada && fecha_pactada >= today && fecha_pactada.getTime() - today.getTime() <= 3 * 30 * 86400000) {
          const id = `${alertId}-3m`;
          if (!alertIds.has(id)) {
            alertasGen.push({ id, tipo: "Vencimiento 3M", op, zona, descripcion, fecha: fecha_pactada.toISOString().split("T")[0], severity: "high" });
            alertIds.add(id);
          }
        }
        // Vencimiento 4M (amarillo)
        else if (fecha_pactada && fecha_pactada >= today && fecha_pactada.getTime() - today.getTime() <= 4 * 30 * 86400000) {
          const id = `${alertId}-4m`;
          if (!alertIds.has(id)) {
            alertasGen.push({ id, tipo: "Vencimiento 4M", op, zona, descripcion, fecha: fecha_pactada.toISOString().split("T")[0], severity: "medium" });
            alertIds.add(id);
          }
        }

        // Consumo 30% (rojo)
        if (cantidad > 0 && razon <= 0.3) {
          const id = `${alertId}-30p`;
          if (!alertIds.has(id)) {
            alertasGen.push({ id, tipo: "Consumo 30%", op, zona, descripcion, fecha: today.toISOString().split("T")[0], severity: "high" });
            alertIds.add(id);
          }
        }
        // Consumo 40% (amarillo)
        else if (cantidad > 0 && razon <= 0.4) {
          const id = `${alertId}-40p`;
          if (!alertIds.has(id)) {
            alertasGen.push({ id, tipo: "Consumo 40%", op, zona, descripcion, fecha: today.toISOString().split("T")[0], severity: "medium" });
            alertIds.add(id);
          }
        }
      }
      alertasGen.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
      setAlertas(alertasGen.slice(0, 10));
    })();
  }, []);

  const cycleVencer  = () => { const i = CYCLE_VENCER.indexOf(filtroVencer);   setFiltroVencer(CYCLE_VENCER[(i + 1) % CYCLE_VENCER.length]);   };
  const cycleConsumo = () => { const i = CYCLE_CONSUMO.indexOf(filtroConsumo); setFiltroConsumo(CYCLE_CONSUMO[(i + 1) % CYCLE_CONSUMO.length]); };

  const fmt = (n: number | null) => n === null ? "—" : n.toLocaleString("es-AR");
  const totalPages = Math.ceil(tableRows.length / PAGE_SIZE);
  const pagedRows  = tableRows.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
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
          {tableLoading && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
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
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="py-2.5 px-3 text-left text-muted-foreground font-semibold">#</th>
                    {TABLE_COLS.map(c => (
                      <th key={c.db} className="py-2.5 px-3 text-left text-muted-foreground font-semibold whitespace-nowrap uppercase tracking-wider">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row, idx) => (
                    <tr key={idx} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                      <td className="py-2.5 px-3 text-muted-foreground">{tablePage * PAGE_SIZE + idx + 1}</td>
                      {TABLE_COLS.map(c => {
                        const val     = row[c.db];
                        const display = typeof val === "number" && !RAW_COLS_T.has(c.db)
                          ? val.toLocaleString("es-AR")
                          : String(val ?? "");
                        const isStat  = STATUS_COLS_T.has(c.db);
                        return (
                          <td key={c.db} className="py-2.5 px-3 whitespace-nowrap max-w-[160px] truncate" title={display}>
                            {isStat ? (
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[11px] font-medium",
                                val === "VENCIDA" || val === "CERRAR" ? "bg-destructive/15 text-destructive" :
                                val === "SIN SALDO"                   ? "bg-warning/15 text-warning"         :
                                val === "OK" || val === "VIGENTE"     ? "bg-success/15 text-success"         :
                                "bg-secondary text-muted-foreground"
                              )}>{display || "—"}</span>
                            ) : (
                              <span className="text-foreground">{display || "—"}</span>
                            )}
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
                    <p className="text-sm font-semibold text-foreground truncate max-w-[700px]">
                      {alerta.tipo === "Vencimiento 3M" ? "Vence en 3 meses" :
                       alerta.tipo === "Vencimiento 4M" ? "Vence en 4 meses" :
                       alerta.tipo === "Consumo 30%"    ? "Consumo ≤30%"     : "Consumo ≤40%"}
                      <span className="font-normal text-muted-foreground"> · OP {alerta.op}</span>
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
