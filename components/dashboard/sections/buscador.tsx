"use client";

import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode, type CSSProperties } from "react";
import {
  Search, Loader2, X, Download, RefreshCw, Database, PackageOpen,
  ChevronDown, ChevronUp, ChevronsUpDown, Wrench, Package,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { buscar, reconstruirIndice, estadoIndice, type BusquedaRow } from "@/lib/busqueda";

// ─── Estilos beast pure (alineados con Stock por Zona / Tablero OP) ─────────

const CARD_BG      = "oklch(0.235 0.005 270)";
const PANEL_BG     = "oklch(0.205 0.005 270)";
const PANEL_BORDER = "1px solid oklch(1 0 0 / 0.07)";
const STICKY_BG    = "oklch(0.255 0.006 270)";

const fmtNum = (n: number | null | undefined) =>
  n == null ? "" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });

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
  num?:    boolean;
  mono?:   boolean;
  render?: (r: BusquedaRow) => ReactNode;
}

// Todas las columnas de las dos fuentes, agrupadas: matrícula → compra →
// cantidades → fechas y estados. Se muestran todas; el ancho es ajustable y
// la tabla scrollea en horizontal.
const COLS: ColDef[] = [
  // ── Matrícula ──
  { key: "articulo",           label: "Matrícula",    mono: true },
  { key: "descripcion",        label: "Descripción" },
  { key: "tipo",               label: "Tipo",         render: (r) => <TipoPill tipo={r.tipo} /> },
  { key: "mat_serv",           label: "Mat/Serv cat." },
  { key: "estado_matricula",   label: "Estado",       render: (r) => <EstadoPill estado={r.estado_matricula} /> },
  { key: "unidad_medida",      label: "UDM" },

  // ── Compra ──
  { key: "relacion",           label: "Relación",     mono: true },
  { key: "numero_op",          label: "OP",           mono: true },
  { key: "linea",              label: "Línea",        mono: true },
  { key: "envio",              label: "Envío",        mono: true },
  { key: "proveedor",          label: "Proveedor" },
  { key: "zona",               label: "Zona" },

  // ── Cantidades ──
  { key: "cantidad",           label: "Cantidad",     num: true },
  { key: "cantidad_recibida",  label: "Recibida",     num: true },
  { key: "ctd_aceptada",       label: "Aceptada",     num: true },
  {
    key: "pendiente", label: "Pendiente", num: true,
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
    key: "cantidad_vencida", label: "Vencida", num: true,
    render: (r) => {
      if (r.cantidad_vencida == null) return "";
      const v = Number(r.cantidad_vencida);
      return <span style={{ color: v > 0 ? "#fca5a5" : undefined, fontWeight: v > 0 ? 600 : 400 }}>{fmtNum(v)}</span>;
    },
  },
  { key: "cantidad_rechazada", label: "Rechazada",    num: true },
  { key: "cantidad_facturada", label: "Facturada",    num: true },
  { key: "cantidad_cancelada", label: "Cancelada",    num: true },

  // ── Fechas y estados ──
  { key: "fecha_creacion",     label: "F. creación",  mono: true },
  { key: "fecha_pactada",      label: "F. pactada",   mono: true },
  { key: "estado_autorizacion", label: "Autorización" },
  { key: "estado_cierre",      label: "Cierre" },
  {
    // uploaded_at viene como timestamp ISO completo — se muestra solo la fecha.
    key: "cargado_at", label: "Cargado", mono: true,
    render: (r) => {
      if (!r.cargado_at) return "";
      const d = new Date(r.cargado_at);
      return Number.isNaN(d.getTime())
        ? r.cargado_at
        : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
    },
  },
];

const COLWIDTHS_KEY = "buscador-colwidths";

const DEFAULT_COL_WIDTHS: Record<string, number> = {
  articulo:            120,
  descripcion:         300,
  tipo:                110,
  mat_serv:            105,
  estado_matricula:    105,
  unidad_medida:       80,
  relacion:            110,
  numero_op:           90,
  linea:               70,
  envio:               70,
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
  cargado_at:          110,
};

type SortDir = "asc" | "desc";

// ─── Sección ─────────────────────────────────────────────────────────────────

export function BuscadorSection() {
  const [query, setQuery]     = useState("");
  const [rows, setRows]       = useState<BusquedaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [reconstruyendo, setReconstruyendo] = useState(false);
  const [indice, setIndice]   = useState<{ filas: number; actualizado: string | null } | null>(null);

  const [sortCol, setSortCol] = useState<keyof BusquedaRow | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS);
  const colWidthsLoaded = useRef(false);
  const resizingRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);

  // Anchos de columna persistidos.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLWIDTHS_KEY);
      if (raw) setColWidths((c) => ({ ...c, ...JSON.parse(raw) }));
    } catch { /* ignorar */ }
    colWidthsLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!colWidthsLoaded.current) return;
    try { localStorage.setItem(COLWIDTHS_KEY, JSON.stringify(colWidths)); } catch { /* ignorar */ }
  }, [colWidths]);
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

  const sorted = useMemo(() => {
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

  const handleSort = (col: keyof BusquedaRow) => {
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
    a.download = `busqueda_${query.trim().replace(/\s+/g, "-") || "todo"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sorted, query]);

  const conOp = sorted.filter((r) => r.fuente === "op").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div
            className="grid place-items-center mt-0.5"
            style={{
              width: 36, height: 36, borderRadius: 9,
              background: "oklch(0.30 0.10 155 / 0.45)",
              border: "1px solid oklch(0.55 0.15 155 / 0.5)",
              color: "#86efac",
            }}
          >
            <Search className="w-[18px] h-[18px]" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-foreground" style={{ letterSpacing: -0.4, margin: 0 }}>
              Buscador
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: "oklch(0.55 0 0)" }}>
              Buscá por matrícula, descripción, OP, proveedor o zona — cada resultado trae todo en una fila.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-0.5">
          {indice && (
            <span
              className="inline-flex items-center gap-2 px-3 rounded-[9px] text-[12px]"
              style={{ height: 32, background: "oklch(0.16 0.005 270)", border: PANEL_BORDER, color: "oklch(0.6 0 0)" }}
            >
              <Database className="w-3.5 h-3.5" style={{ color: "#86efac" }} />
              {indice.filas.toLocaleString("es-AR")} filas indexadas
            </span>
          )}
          <button
            onClick={handleReconstruir}
            disabled={reconstruyendo}
            title="Vuelve a leer Matrículas + Planilla OP y regenera el índice"
            className="inline-flex items-center gap-2 px-3.5 rounded-[9px] text-[13px] font-medium transition-colors disabled:opacity-50"
            style={{ height: 32, background: "oklch(0.22 0.005 270)", border: PANEL_BORDER, color: "oklch(0.75 0 0)", cursor: "pointer" }}
          >
            {reconstruyendo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {reconstruyendo ? "Reconstruyendo…" : "Reconstruir índice"}
          </button>
        </div>
      </div>

      {/* Card */}
      <div
        className="px-4 py-6 sm:px-6 overflow-hidden space-y-5"
        style={{ background: CARD_BG, border: PANEL_BORDER, borderRadius: 14 }}
      >
        {/* Omnibox */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div
            className="flex items-center gap-2.5 px-4 flex-1"
            style={{
              height: 46, minWidth: 280, borderRadius: 11,
              background: "oklch(0.16 0.005 270)",
              border: `1px solid ${query ? "oklch(0.55 0.20 295 / 0.5)" : "oklch(1 0 0 / 0.07)"}`,
              boxShadow: query ? "0 0 0 3px oklch(0.55 0.20 295 / 0.12)" : "none",
              transition: "border-color .15s, box-shadow .15s",
            }}
          >
            {loading
              ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" style={{ color: "#8B5CF6" }} />
              : <Search className="w-4 h-4 shrink-0" style={{ color: "oklch(0.55 0 0)" }} />}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Matrícula, descripción, OP, proveedor, zona…"
              className="flex-1 bg-transparent border-none outline-none text-[15px] text-foreground placeholder:text-muted-foreground/45"
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground shrink-0">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            onClick={exportCSV}
            disabled={!sorted.length}
            className="inline-flex items-center gap-2 px-3.5 rounded-[9px] text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ height: 46, background: "oklch(0.16 0.005 270)", border: PANEL_BORDER, color: "oklch(0.65 0 0)", cursor: "pointer" }}
          >
            <Download className="w-3.5 h-3.5" />CSV
          </button>
        </div>

        {/* Contador */}
        {buscado && !loading && (
          <p className="text-[12.5px]" style={{ color: "oklch(0.55 0 0)", margin: 0 }}>
            <span className="text-foreground font-medium">{sorted.length.toLocaleString("es-AR")}</span> resultado(s)
            {conOp > 0 && <> · {conOp.toLocaleString("es-AR")} con OP</>}
            {sorted.length >= 500 && <> · mostrando los primeros 500, afiná la búsqueda</>}
          </p>
        )}

        {/* Resultados */}
        <div className="rounded-[14px] overflow-hidden" style={{ background: PANEL_BG, border: PANEL_BORDER }}>
          {!query.trim() ? (
            <div className="flex flex-col items-center gap-3 py-20 text-sm text-muted-foreground">
              <Search className="w-10 h-10 opacity-20" />
              Escribí algo para buscar en Matrículas y Planilla OP.
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />Buscando…
            </div>
          ) : !sorted.length ? (
            <div className="flex flex-col items-center gap-3 py-20 text-sm text-muted-foreground">
              <PackageOpen className="w-10 h-10 opacity-20" />
              Sin resultados para «{query.trim()}».
              {indice?.filas === 0 && <span className="text-[12px]">El índice está vacío — probá «Reconstruir índice».</span>}
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
                          className="relative"
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
                      key={r.id}
                      className="transition-colors"
                      // Las filas que son solo catálogo (matrícula nunca pedida) van atenuadas.
                      style={{ opacity: r.fuente === "catalogo" ? 0.72 : 1 }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "oklch(0.25 0.005 270 / 0.5)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = ""; }}
                    >
                      {COLS.map((c) => (
                        <td
                          key={c.key}
                          className={cn("truncate", c.num ? "text-right tabular-nums" : "text-left")}
                          style={{
                            padding: "10px 14px",
                            borderBottom: i === sorted.length - 1 ? "none" : "1px solid oklch(1 0 0 / 0.05)",
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
