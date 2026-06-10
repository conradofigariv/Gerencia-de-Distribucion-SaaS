"use client";

import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
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

// ─── Anchos de columna (ajustables, persistidos) ────────────────────────────

const COLWIDTHS_KEY = "tablero-op-resumen-colwidths";

const DEFAULT_COL_WIDTHS: Record<string, number> = {
  numero_sic:    90,
  linea:         70,
  articulo:      110,
  descripcion:   280,
  cantidad:      90,
  udm:           70,
  ctd_entregada: 100,
  numero_op:     90,
  proveedor:     160,
  control:       140,
  stock:         90,
  recibido:      90,
  devoluciones:  90,
  aceptado:      90,
  entregado:     90,
  control2:      100,
};

// Header sticky: bg-card tiene alpha → transparente al hacer scroll. Fondo opaco propio.
const STICKY_BG = "oklch(0.16 0.01 260)";

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

  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS);
  const colWidthsLoaded = useRef(false);
  const resizingRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);

  // Carga anchos de columna guardados.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLWIDTHS_KEY);
      if (raw) setColWidths((c) => ({ ...c, ...JSON.parse(raw) }));
    } catch { /* ignorar */ }
    colWidthsLoaded.current = true;
  }, []);

  // Persiste anchos de columna.
  useEffect(() => {
    if (!colWidthsLoaded.current) return;
    try { localStorage.setItem(COLWIDTHS_KEY, JSON.stringify(colWidths)); } catch { /* ignorar */ }
  }, [colWidths]);

  // Resize de columnas con el mouse.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const { col, startX, startWidth } = resizingRef.current;
      const newW = Math.max(50, startWidth + e.clientX - startX);
      setColWidths((p) => ({ ...p, [col]: newW }));
    };
    const onUp = () => { resizingRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

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

  // Filtro de texto local (busca en todas las columnas) + filtro de recibido.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (soloConRecibido && (r.recibido ?? 0) === 0) return false;
      if (!q) return true;
      return COLS.some((c) => {
        const v = r[c.key];
        return v != null && String(v).toLowerCase().includes(q);
      });
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
              placeholder="Buscar en cualquier columna…"
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
          <div className="overflow-auto" style={{ maxHeight: "70vh" }}>
            <table style={{ tableLayout: "fixed", width: "100%", borderCollapse: "separate", borderSpacing: 0 }} className="text-sm">
              <colgroup>
                {COLS.map((c) => (
                  <col key={c.key} style={{ width: colWidths[c.key] ?? DEFAULT_COL_WIDTHS[c.key] }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th
                      key={c.key}
                      className={cn(
                        "relative px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border",
                        c.num ? "text-right" : "text-left"
                      )}
                      style={{ position: "sticky", top: 0, zIndex: 2, background: STICKY_BG }}
                    >
                      <span className="block truncate">{c.label}</span>
                      <ResizeHandle
                        onStart={(e) => {
                          resizingRef.current = { col: c.key, startX: e.clientX, startWidth: colWidths[c.key] ?? DEFAULT_COL_WIDTHS[c.key] };
                        }}
                      />
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
                          "px-3 py-2 truncate",
                          c.num ? "text-right tabular-nums" : "text-left",
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
