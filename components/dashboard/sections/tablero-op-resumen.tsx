"use client";

import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { ClipboardList, Loader2, RefreshCw, Search, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { runTablero, getZonas, type TableroRow } from "@/lib/tableroOp";

// ─── Helpers ───────────────────────────────────────────────────────────────

// Primer día del año actual y hoy, en formato YYYY-MM-DD (para inputs date).
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const yearStart = () => isoDate(new Date(new Date().getFullYear(), 0, 1));
const today = () => isoDate(new Date());

const fmtNum = (n: number | null | undefined) =>
  n == null ? "" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });

// Color del badge según el estado de "Control".
const controlClass = (c: string) => {
  switch (c) {
    case "TOTAL ENTREGADO": return "bg-success/15 text-success";
    case "ENTREGA PARCIAL": return "bg-warning/15 text-warning";
    case "TOTAL ADEUDADO":  return "bg-destructive/15 text-destructive";
    default:                return "bg-secondary text-muted-foreground";
  }
};

// ─── Columnas de la tabla ────────────────────────────────────────────────────

interface ColDef {
  key:    keyof TableroRow;
  label:  string;
  num?:   boolean;       // alineación derecha + formato numérico
  render?: (r: TableroRow) => ReactNode;
}

const COLS: ColDef[] = [
  { key: "numero_sic",    label: "SIC" },
  { key: "linea",         label: "Línea" },
  { key: "articulo",      label: "Artículo" },
  { key: "descripcion",   label: "Descripción" },
  { key: "cantidad",      label: "Cantidad",  num: true },
  { key: "udm",           label: "UDM" },
  { key: "ctd_entregada", label: "Ctd Entreg.", num: true },
  { key: "numero_op",     label: "OP" },
  { key: "proveedor",     label: "Proveedor" },
  {
    key: "control", label: "Control",
    render: (r) => (
      <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap", controlClass(r.control))}>
        {r.control}
      </span>
    ),
  },
  { key: "stock",        label: "Stock",       num: true },
  { key: "recibido",     label: "Recibido",    num: true },
  { key: "devoluciones", label: "Devoluc.",    num: true },
  { key: "aceptado",     label: "Aceptado",    num: true },
  { key: "entregado",    label: "Entregado",   num: true },
  {
    key: "control2", label: "Control 2",
    render: (r) => (
      <span className={cn(
        "px-2 py-0.5 rounded-full text-[11px] font-medium",
        r.control2 === "OK" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
      )}>
        {r.control2}
      </span>
    ),
  },
];

// ─── Componente ──────────────────────────────────────────────────────────────

export function TableroOpResumenSection() {
  const [desde, setDesde] = useState(yearStart());
  const [hasta, setHasta] = useState(today());
  const [zona, setZona]   = useState("");
  const [zonas, setZonas] = useState<string[]>([]);

  const [rows, setRows]           = useState<TableroRow[]>([]);
  const [loading, setLoading]     = useState(false);
  const [loaded, setLoaded]       = useState(false);
  const [query, setQuery]         = useState("");
  const [soloConRecibido, setSoloConRecibido] = useState(false);

  // Carga las zonas disponibles para el selector de stock.
  useEffect(() => {
    getZonas().then(setZonas).catch(() => {});
  }, []);

  const calcular = useCallback(async () => {
    if (!desde || !hasta) { toast.error("Elegí el rango de fechas."); return; }
    if (desde > hasta)    { toast.error("La fecha 'desde' no puede ser mayor que 'hasta'."); return; }
    setLoading(true);
    try {
      const data = await runTablero(desde, hasta, zona);
      setRows(data);
      setLoaded(true);
      if (!data.length) toast.info("No hay filas de seguimiento para mostrar.");
    } catch (e) {
      toast.error(`Error al calcular: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [desde, hasta, zona]);

  // Calcula automáticamente al abrir (año actual → hoy).
  useEffect(() => { calcular(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Filtro de texto local (SIC, artículo, descripción, OP, proveedor) + filtro de recibido.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (soloConRecibido && (r.recibido ?? 0) === 0) return false;
      if (!q) return true;
      return (
        String(r.numero_sic).includes(q) ||
        (r.articulo ?? "").toLowerCase().includes(q) ||
        (r.descripcion ?? "").toLowerCase().includes(q) ||
        String(r.numero_op ?? "").includes(q) ||
        (r.proveedor ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, soloConRecibido]);

  const exportCSV = useCallback(() => {
    if (!filtered.length) { toast.error("No hay datos para exportar."); return; }
    const head = COLS.map((c) => c.label).join(";");
    const body = filtered.map((r) =>
      COLS.map((c) => {
        const v = r[c.key];
        const s = v == null ? "" : String(v);
        return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(";")
    ).join("\n");
    const blob = new Blob(["﻿" + head + "\n" + body], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `tablero-op_${desde}_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered, desde, hasta]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Tablero OP — Resumen</h2>
          <p className="text-sm text-muted-foreground">
            Cruce de SIC a seguir con transacciones y stock en el rango de fechas elegido.
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Desde</label>
          <input
            type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
            className="bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Hasta</label>
          <input
            type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
            className="bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Zona (stock)</label>
          <select
            value={zona} onChange={(e) => setZona(e.target.value)}
            className="bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 min-w-[120px]"
          >
            <option value="">— Todas —</option>
            {zonas.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>

        <button
          onClick={calcular} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Calcular
        </button>

        <button
          onClick={() => setSoloConRecibido((v) => !v)}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors",
            soloConRecibido
              ? "bg-success/15 border-success/40 text-success hover:bg-success/25"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
          )}
        >
          Material recibido
        </button>

        {/* Búsqueda + export, alineados a la derecha */}
        <div className="flex items-center gap-2 ml-auto">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar SIC, artículo, OP, proveedor…"
              className="bg-secondary/40 border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-foreground w-64 focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
          <button
            onClick={exportCSV} disabled={!filtered.length}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-40 transition-colors"
          >
            <Download className="w-4 h-4" />CSV
          </button>
        </div>
      </div>

      {/* Contador */}
      {loaded && (
        <div className="text-xs text-muted-foreground">
          {filtered.length.toLocaleString("es-AR")}
          {query && ` de ${rows.length.toLocaleString("es-AR")}`} fila(s)
        </div>
      )}

      {/* Tabla */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />Calculando cruce…
          </div>
        ) : !filtered.length ? (
          <div className="flex flex-col items-center gap-2 p-10 text-sm text-muted-foreground">
            <AlertTriangle className="w-5 h-5 text-warning" />
            {loaded ? "Sin resultados para los filtros actuales." : "Elegí filtros y calculá."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  {COLS.map((c) => (
                    <th
                      key={c.key}
                      className={cn(
                        "px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap sticky top-0 bg-card",
                        c.num ? "text-right" : "text-left"
                      )}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr
                    key={`${r.numero_sic}|${r.linea ?? ""}|${i}`}
                    className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
                  >
                    {COLS.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          "px-3 py-2 whitespace-nowrap",
                          c.num ? "text-right tabular-nums" : "text-left",
                          c.key === "descripcion" && "max-w-[280px] truncate",
                          c.key === "numero_sic" && "font-medium text-foreground"
                        )}
                        title={c.key === "descripcion" ? (r.descripcion ?? "") : undefined}
                      >
                        {c.render ? c.render(r) : c.num ? fmtNum(r[c.key] as number) : (r[c.key] ?? "") as ReactNode}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
