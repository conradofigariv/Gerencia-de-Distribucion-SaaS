"use client";

import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode, type CSSProperties } from "react";
import {
  ClipboardList, Loader2, RefreshCw, Search, X, Download, AlertTriangle,
  ChevronDown, ChevronUp, ChevronsUpDown, PackageCheck,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BeastSelect } from "@/components/dashboard/beast-select";
import { runTablero, getZonas, type TableroRow } from "@/lib/tableroOp";

// ─── Estilos beast pure (alineados con Stock por Zona) ──────────────────────

const CARD_BG      = "var(--panel)";
const PANEL_BG     = "var(--panel-2)";
const PANEL_BORDER = "1px solid var(--hairline)";
const STICKY_BG    = "var(--panel-header)";

const beastInput: CSSProperties = {
  height: 38, padding: "0 12px", borderRadius: 9,
  background: "var(--panel-input)",
  border: "1px solid var(--hairline)",
  color: "oklch(0.95 0 0)", fontSize: 13,
  outline: "none",
  colorScheme: "dark",
};

type PillTone = "green" | "amber" | "red" | "gray";

const PILL_STYLES: Record<PillTone, CSSProperties> = {
  green: { background: "color-mix(in oklab, var(--accent-emerald-deep) 45%, transparent)", color: "var(--accent-green)", border: "1px solid color-mix(in oklab, var(--accent-emerald) 50%, transparent)" },
  amber: { background: "oklch(0.30 0.10 50 / 0.4)",   color: "var(--accent-amber)", border: "1px solid oklch(0.6 0.15 60 / 0.5)" },
  red:   { background: "oklch(0.28 0.10 25 / 0.45)",  color: "var(--accent-red)", border: "1px solid oklch(0.55 0.15 25 / 0.5)" },
  gray:  { background: "oklch(0.25 0.005 270)",        color: "oklch(0.65 0 0)", border: "1px solid oklch(1 0 0 / 0.08)" },
};

function BeastPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 9px", borderRadius: 999,
      fontSize: 11, fontWeight: 600, letterSpacing: 0.2, whiteSpace: "nowrap",
      ...PILL_STYLES[tone],
    }}>
      {children}
    </span>
  );
}

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

// ─── Helpers ───────────────────────────────────────────────────────────────

// Primer día del año actual y hoy, en formato YYYY-MM-DD (para inputs date).
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const yearStart = () => isoDate(new Date(new Date().getFullYear(), 0, 1));
const today = () => isoDate(new Date());

const fmtNum = (n: number | null | undefined) =>
  n == null ? "" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });

// Tono del pill según el estado de "Control".
const controlTone = (c: string): PillTone => {
  switch (c) {
    case "TOTAL ENTREGADO": return "green";
    case "ENTREGA PARCIAL": return "amber";
    case "TOTAL ADEUDADO":  return "red";
    default:                return "gray";
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
    render: (r) => <BeastPill tone={controlTone(r.control)}>{r.control}</BeastPill>,
  },
  { key: "stock",        label: "Stock",       num: true },
  { key: "recibido",     label: "Recibido",    num: true },
  { key: "devoluciones", label: "Devoluc.",    num: true },
  { key: "aceptado",     label: "Aceptado",    num: true },
  { key: "entregado",    label: "Entregado",   num: true },
  {
    key: "control2", label: "Control 2",
    render: (r) => <BeastPill tone={r.control2 === "OK" ? "green" : "amber"}>{r.control2}</BeastPill>,
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
  control:       150,
  stock:         90,
  recibido:      95,
  devoluciones:  95,
  aceptado:      95,
  entregado:     95,
  control2:      105,
};

// ─── Componente ──────────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";

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
  const [sortCol, setSortCol]     = useState<keyof TableroRow>("numero_sic");
  const [sortDir, setSortDir]     = useState<SortDir>("asc");

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

  // Orden por columna (clic en el encabezado, como Stock por Zona).
  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [filtered, sortCol, sortDir]);

  const handleSort = (col: keyof TableroRow) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  };

  const exportCSV = useCallback(() => {
    if (!sorted.length) { toast.error("No hay datos para exportar."); return; }
    const head = COLS.map((c) => c.label).join(";");
    const body = sorted.map((r) =>
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
  }, [sorted, desde, hasta]);

  return (
    <div className="space-y-6">
      {/* Header bar: ícono + título + acciones */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div
            className="grid place-items-center mt-0.5"
            style={{
              width: 36, height: 36, borderRadius: 9,
              background: "color-mix(in oklab, var(--accent-emerald-deep) 45%, transparent)",
              border: "1px solid color-mix(in oklab, var(--accent-emerald) 50%, transparent)",
              color: "var(--accent-green)",
            }}
          >
            <ClipboardList className="w-[18px] h-[18px]" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-foreground" style={{ letterSpacing: -0.4, margin: 0 }}>
              Tablero OP — Resumen
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: "oklch(0.55 0 0)" }}>
              Cruce de SIC a seguir con transacciones y stock en el rango de fechas elegido.
            </p>
          </div>
        </div>
        <button
          onClick={calcular}
          disabled={loading}
          title="Recalcular"
          className="flex items-center justify-center w-8 h-8 mt-0.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-accent/40 transition-colors disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Content card */}
      <div
        className="px-4 py-6 sm:px-6 overflow-hidden space-y-5"
        style={{ background: CARD_BG, border: PANEL_BORDER, borderRadius: 14 }}
      >
        {/* Filter bar */}
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.6px]" style={{ color: "oklch(0.55 0 0)" }}>Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={beastInput} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.6px]" style={{ color: "oklch(0.55 0 0)" }}>Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={beastInput} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.6px]" style={{ color: "oklch(0.55 0 0)" }}>Zona (stock)</label>
            <BeastSelect
              value={zona}
              onChange={setZona}
              placeholder="Todas las zonas"
              clearable
              minWidth={170}
              options={zonas.map((z) => ({ value: z, label: `Zona ${z}` }))}
            />
          </div>

          <button
            onClick={calcular}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 rounded-[9px] text-[13px] font-semibold transition-all disabled:cursor-not-allowed"
            style={{
              height: 38,
              background: loading ? "oklch(0.25 0.005 270)" : "#8B5CF6",
              color: loading ? "oklch(0.55 0 0)" : "#fff",
              border: "none",
              boxShadow: loading ? "none" : "0 1px 0 rgba(255,255,255,0.1) inset, 0 8px 16px -10px rgba(139,92,246,0.6)",
            }}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Calcular
          </button>

          <button
            onClick={() => setSoloConRecibido((v) => !v)}
            className="inline-flex items-center gap-2 px-3.5 rounded-[9px] text-[13px] font-medium transition-all"
            style={{
              height: 38,
              background: soloConRecibido ? "#8B5CF6" : "var(--panel-input)",
              color: soloConRecibido ? "#fff" : "oklch(0.65 0 0)",
              border: soloConRecibido ? "1px solid transparent" : "1px solid var(--hairline)",
              boxShadow: soloConRecibido ? "0 8px 16px -10px rgba(139,92,246,0.6)" : "none",
              cursor: "pointer",
            }}
          >
            <PackageCheck className="w-3.5 h-3.5" strokeWidth={2} />
            Material recibido
          </button>

          {/* Búsqueda + export, alineados a la derecha */}
          <div className="flex items-end gap-2 ml-auto">
            <div
              className="flex items-center gap-2 px-3"
              style={{ ...beastInput, width: 260, display: "flex" }}
            >
              <Search className="w-3.5 h-3.5 shrink-0" style={{ color: "oklch(0.55 0 0)" }} />
              <input
                value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar en cualquier columna…"
                className="flex-1 bg-transparent border-none outline-none text-[13px] text-foreground placeholder:text-muted-foreground/50"
              />
              {query && (
                <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <button
              onClick={exportCSV} disabled={!sorted.length}
              className="inline-flex items-center gap-2 px-3.5 rounded-[9px] text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                height: 38,
                background: "var(--panel-input)",
                border: "1px solid var(--hairline)",
                color: "oklch(0.65 0 0)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.90 0 0)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.65 0 0)"; }}
            >
              <Download className="w-3.5 h-3.5" />CSV
            </button>
          </div>
        </div>

        {/* Contador */}
        {loaded && (
          <p className="text-[12.5px]" style={{ color: "oklch(0.55 0 0)", margin: 0 }}>
            <span className="text-foreground font-medium">{sorted.length.toLocaleString("es-AR")}</span>
            {(query || soloConRecibido) && <> de {rows.length.toLocaleString("es-AR")}</>} fila(s)
          </p>
        )}

        {/* Tabla */}
        <div className="rounded-[14px] overflow-hidden" style={{ background: PANEL_BG, border: PANEL_BORDER }}>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />Calculando cruce…
            </div>
          ) : !sorted.length ? (
            <div className="flex flex-col items-center gap-3 py-20 text-sm text-muted-foreground">
              <AlertTriangle className="w-10 h-10 opacity-20" />
              {loaded ? "Sin resultados para los filtros actuales." : "Elegí filtros y calculá."}
            </div>
          ) : (
            <div className="overflow-auto" style={{ maxHeight: "70vh" }}>
              <table style={{ tableLayout: "fixed", width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
                <colgroup>
                  {COLS.map((c) => (
                    <col key={c.key} style={{ width: colWidths[c.key] ?? DEFAULT_COL_WIDTHS[c.key] }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {COLS.map((c) => {
                      const active = sortCol === c.key;
                      const SortIcon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
                      return (
                        <th
                          key={c.key}
                          onClick={() => handleSort(c.key)}
                          style={{
                            padding: "12px 14px",
                            textAlign: c.num ? "right" : "left",
                            fontSize: 12, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase",
                            color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                            cursor: "pointer", userSelect: "none",
                            position: "sticky", top: 0, zIndex: 2,
                            background: STICKY_BG,
                            borderBottom: "1px solid hsl(var(--border))",
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
                  {sorted.map((r, i) => (
                    <tr
                      key={`${r.numero_sic}|${r.linea ?? ""}|${i}`}
                      className="transition-colors"
                      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "oklch(0.25 0.005 270 / 0.5)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = ""; }}
                    >
                      {COLS.map((c) => (
                        <td
                          key={c.key}
                          className={cn(
                            "truncate",
                            c.num ? "text-right tabular-nums" : "text-left",
                            c.key === "numero_sic" && "font-medium text-foreground"
                          )}
                          style={{
                            padding: "10px 14px",
                            borderBottom: i === sorted.length - 1 ? "none" : "1px solid oklch(1 0 0 / 0.05)",
                            fontFamily: (c.num || c.key === "numero_sic" || c.key === "articulo" || c.key === "numero_op")
                              ? "ui-monospace, monospace" : undefined,
                          }}
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
    </div>
  );
}
