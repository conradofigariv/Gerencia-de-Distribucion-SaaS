"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Gauge, Loader2, RefreshCw, Calendar, SlidersHorizontal, ChevronDown, Download, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { getRows, computeIdo, getMetas, listPeriodos, DEFAULT_METAS } from "@/lib/idoStorage";
import type { IdoRow, IdoCalc, IdoMetas } from "@/lib/idoStorage";

// ─── Formato ───────────────────────────────────────────────────────────────────

function fmtNum(v: number | null): string {
  return v === null ? "—" : v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(v: number | null, dec = 0): string {
  return v === null ? "—" : `${(v * 100).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`;
}
// KPI binario / Resultado Técnico: verde ≥1, ámbar >0, rojo el resto (3 bandas semánticas).
function kpiColor(v: number | null): string {
  if (v === null) return "var(--ido-text-dim)";
  if (v >= 1) return "var(--ido-accent)";
  if (v > 0) return "var(--ido-warning)";
  return "var(--ido-danger)";
}
// IDO final: mismas 3 bandas, con el tinte de badge documentado (design-system.md §4.3).
function idoStyle(v: number | null): { color: string; bg: string } {
  if (v === null) return { color: "var(--ido-text-dim)", bg: "transparent" };
  if (v >= 0.70) return { color: "var(--ido-accent)", bg: "rgba(63,207,142,.12)" };
  if (v >= 0.50) return { color: "var(--ido-warning)", bg: "rgba(245,165,36,.12)" };
  return { color: "var(--ido-danger)", bg: "rgba(229,72,77,.12)" };
}

const MONO = "var(--font-mono, ui-monospace, monospace)";
const HEADER_LABEL_STYLE: React.CSSProperties = {
  fontSize: 10, fontWeight: 500, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ido-text-dim)",
};

// Ajuste de ancho al viewport: columnas fijas (no absorben sobrante) y columna
// de cierre (absorbe el doble). Ver design-system.md — sección 06.
const FIXED_IDS = new Set(["sel", "zona", "fmik_s1", "fmik_s2", "dmik_s1", "dmik_s2"]);
const CLOSING_ID = "ido";

// ─── Export CSV ──────────────────────────────────────────────────────────────
// Mismo formato que matriculas.tsx: tabulador + UTF-16LE con BOM, el único que
// Excel reconoce siempre sin ambigüedad de codificación regional.
const CSV_SEP = "\t";
function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /["\t\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toUtf16LeBytes(text: string): ArrayBuffer {
  const withBom = "﻿" + text;
  const buf = new ArrayBuffer(withBom.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < withBom.length; i++) view.setUint16(i * 2, withBom.charCodeAt(i), true);
  return buf;
}

// ─── Persistencia de layout (design-system.md — sección 07) ─────────────────
// Por usuario y por id estable de tabla: `ds.tableLayout.v1.<userId>.<tableId>`.
// Solo lo que existe hoy en este módulo: anchos de columna redimensionados a
// mano (no hay orden por arrastre, grupos colapsables ni selector de columnas
// en IDO Resumen). Selección de fila, celda activa, scroll y filtros quedan
// fuera — son estado de sesión.
const LAYOUT_NS = "ds.tableLayout.v1";
const TABLE_ID = "indiceIdoResumen";
const KNOWN_COL_IDS = new Set([
  "sel", "zona", "fmik_s1", "fmik_kpi_s1", "fmik_s2", "fmik_kpi_s2", "fmik_kpi",
  "dmik_s1", "dmik_kpi_s1", "dmik_s2", "dmik_kpi_s2", "dmik_kpi",
  "tecnico", "pova", "mant", "ido",
]);
interface TableLayout {
  colW?: Record<string, number> | null;
}
function loadLayout(userId: string): TableLayout {
  try {
    const raw = localStorage.getItem(`${LAYOUT_NS}.${userId}.${TABLE_ID}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveLayout(userId: string, patch: TableLayout) {
  try {
    const current = loadLayout(userId);
    localStorage.setItem(`${LAYOUT_NS}.${userId}.${TABLE_ID}`, JSON.stringify({ ...current, ...patch }));
  } catch {
    // localStorage puede no estar disponible (modo privado, cuota) — se ignora.
  }
}

export function IndiceIdoResumenSection() {
  const [periodo, setPeriodo] = useState(String(new Date().getFullYear()));
  const [periodos, setPeriodos] = useState<string[]>([]);
  const [dropOpen, setDropOpen] = useState(false);
  const [rows, setRows] = useState<IdoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [metas, setMetas] = useState<IdoMetas>(DEFAULT_METAS);
  const [metasOpen, setMetasOpen] = useState(false);

  // Usuario actual (para namespacear la persistencia de layout por cuenta)
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Anchos de columna ajustables (manuales — salen del reparto automático)
  const [colW, setColW] = useState<Record<string, number>>({});
  const colWRef = useRef(colW);
  useEffect(() => { colWRef.current = colW; }, [colW]);
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizing = useRef<{ id: string; startX: number; startW: number } | null>(null);

  // "Restablecer vista": confirmación temporal (1.5 s)
  const [resetMsg, setResetMsg] = useState(false);
  const resetMsgT = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetMsgT.current) clearTimeout(resetMsgT.current); }, []);

  // Selección de fila
  const [selMode, setSelMode] = useState<"simple" | "multi">("simple");
  const [selIds, setSelIds] = useState<string[]>([]);
  const [selAnchor, setSelAnchor] = useState<number | null>(null);

  // Ancho real del contenedor (para el reparto automático de columnas)
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const r = resizing.current;
      if (!r) return;
      const w = Math.max(64, r.startW + (e.clientX - r.startX));
      setColW((p) => ({ ...p, [r.id]: w }));
    }
    function onUp() {
      resizing.current = null;
      setResizingCol(null);
      if (userIdRef.current) saveLayout(userIdRef.current, { colW: colWRef.current });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // Hidrata el ancho de columnas guardado para este usuario y esta tabla.
  // Referencias a columnas que ya no existen se descartan en silencio.
  useEffect(() => {
    if (!userId) return;
    const saved = loadLayout(userId).colW;
    if (!saved) return;
    const known: Record<string, number> = {};
    for (const [k, v] of Object.entries(saved)) {
      if (KNOWN_COL_IDS.has(k) && typeof v === "number") known[k] = v;
    }
    if (Object.keys(known).length) setColW(known);
  }, [userId]);

  function resetLayout() {
    setColW({});
    if (userId) saveLayout(userId, { colW: null });
    setResetMsg(true);
    if (resetMsgT.current) clearTimeout(resetMsgT.current);
    resetMsgT.current = setTimeout(() => setResetMsg(false), 1500);
  }

  // Cierre del desplegable de años al hacer click afuera
  const dropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    getMetas(p).then(setMetas);
    setRows(await getRows(p));
    setLoading(false);
  }, []);

  useEffect(() => { load(periodo); }, [periodo, load]);

  // Años guardados (para el desplegable). Si hay datos, arranca en el más reciente.
  useEffect(() => {
    listPeriodos().then((ps) => {
      setPeriodos(ps);
      if (ps.length) setPeriodo((cur) => (ps.includes(cur) ? cur : ps[0]));
    });
  }, []);

  const calc: IdoCalc[] = useMemo(() => rows.map((r) => computeIdo(r, metas)), [rows, metas]);
  const hasS2 = useMemo(() => rows.some((r) => r.fmik_s2 !== null || r.dmik_s2 !== null), [rows]);

  const idosValidos = calc.map((c) => c.ido).filter((x): x is number => x !== null);
  const idoPromedio = idosValidos.length ? idosValidos.reduce((a, b) => a + b, 0) / idosValidos.length : null;

  // Columnas hoja (para grid-template-columns + resize). w = ancho natural/mínimo.
  const leafCols = useMemo(() => {
    const c: { id: string; w: number }[] = [{ id: "sel", w: 44 }, { id: "zona", w: 56 }];
    c.push({ id: "fmik_s1", w: 72 }, { id: "fmik_kpi_s1", w: 64 });
    if (hasS2) c.push({ id: "fmik_s2", w: 72 }, { id: "fmik_kpi_s2", w: 64 });
    c.push({ id: "fmik_kpi", w: 64 });
    c.push({ id: "dmik_s1", w: 72 }, { id: "dmik_kpi_s1", w: 64 });
    if (hasS2) c.push({ id: "dmik_s2", w: 72 }, { id: "dmik_kpi_s2", w: 64 });
    c.push({ id: "dmik_kpi", w: 64 });
    c.push({ id: "tecnico", w: 86 }, { id: "pova", w: 72 }, { id: "mant", w: 86 }, { id: "ido", w: 90 });
    return c;
  }, [hasS2]);
  const defW = useMemo(() => Object.fromEntries(leafCols.map((c) => [c.id, c.w])), [leafCols]);

  const colIndex = useCallback((id: string) => leafCols.findIndex((c) => c.id === id) + 1, [leafCols]);

  // Columnas redimensionadas a mano: fijas, salen del reparto automático.
  const manualCols = useMemo(() => new Set(Object.keys(colW)), [colW]);
  const isAbsorber = useCallback((id: string) => !FIXED_IDS.has(id) && !manualCols.has(id), [manualCols]);

  // Reparto del sobrante: identificadora/checkbox/referencias cortas fijas; el resto
  // (las columnas calculadas) absorbe en partes iguales, IDO (columna de cierre) al
  // doble; ninguna crece más de 2× su ancho natural; el excedente pasa a padding.
  const fitted = useMemo(() => {
    const natural: Record<string, number> = {};
    for (const c of leafCols) natural[c.id] = manualCols.has(c.id) ? colW[c.id] : c.w;
    const pool = leafCols.filter((c) => isAbsorber(c.id)).map((c) => c.id);
    const weight = (id: string) => (id === CLOSING_ID ? 2 : 1);
    const out: Record<string, number> = { ...natural };
    const sumNatural = leafCols.reduce((a, c) => a + natural[c.id], 0);
    let rest = Math.max(0, containerW - sumNatural);
    let active = [...pool];
    while (rest > 0.5 && active.length) {
      const tw = active.reduce((a, id) => a + weight(id), 0);
      let used = 0;
      const next: string[] = [];
      for (const id of active) {
        const cap = natural[id] * 2 - out[id];
        const add = Math.min((rest * weight(id)) / tw, cap);
        out[id] += add; used += add;
        if (cap - add > 0.5) next.push(id);
      }
      if (used < 0.5) break;
      rest -= used;
      active = next;
    }
    return { widths: out, pad: Math.max(0, Math.round(rest / 2)) };
  }, [leafCols, colW, manualCols, isAbsorber, containerW]);

  const gridTemplateColumns = useMemo(
    () => leafCols.map((c) => `${Math.round(fitted.widths[c.id])}px`).join(" "),
    [leafCols, fitted]
  );
  const fittedTotalWidth = useMemo(
    () => leafCols.reduce((a, c) => a + fitted.widths[c.id], 0),
    [leafCols, fitted]
  );
  // Guía de arrastre: offset acumulado hasta (e incluyendo) la columna que se está redimensionando.
  const resizeOffsetX = useMemo(() => {
    if (!resizingCol) return 0;
    let x = 0;
    for (const c of leafCols) {
      x += fitted.widths[c.id] ?? c.w;
      if (c.id === resizingCol) break;
    }
    return x;
  }, [resizingCol, leafCols, fitted]);

  function startResize(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    const startW = colW[id] ?? fitted.widths[id] ?? defW[id];
    resizing.current = { id, startX: e.clientX, startW };
    setResizingCol(id);
  }
  const Resizer = ({ id }: { id: string }) => {
    const active = resizingCol === id;
    return (
      <span
        onMouseDown={(e) => startResize(e, id)}
        className="group absolute top-0 right-[-4px] bottom-0 w-2 cursor-col-resize z-20 flex justify-center"
      >
        <span
          className={`w-[2px] h-full transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          style={{ background: "var(--ido-accent)", transitionDuration: "100ms", transitionTimingFunction: "var(--ido-ease)" }}
        />
      </span>
    );
  };
  // Marca de "absorbe sobrante" (§06): barra verde bajo el encabezado — el doble de
  // opacidad para la columna de cierre, que además absorbe el doble de proporción.
  const AbsorbBar = ({ id }: { id: string }) => {
    if (!isAbsorber(id)) return null;
    const closing = id === CLOSING_ID;
    return (
      <span
        title={closing ? "Absorbe el doble de proporción" : "Absorbe el sobrante"}
        style={{ position: "absolute", bottom: 0, left: 12, right: 12, height: 2, background: "var(--ido-accent)", opacity: closing ? 1 : 0.5, pointerEvents: "none" }}
      />
    );
  };

  const periodoOptions = useMemo(
    () => [...new Set([periodo, ...periodos])].sort().reverse(),
    [periodo, periodos]
  );

  // Selección de fila: clic simple exclusivo · ⌘/Ctrl clic acumula · ⇧ clic rango.
  function handleRowClick(i: number, e: React.MouseEvent) {
    const id = calc[i].zona;
    if (e.shiftKey) {
      const a = selAnchor ?? i;
      const lo = Math.min(a, i), hi = Math.max(a, i);
      setSelMode("multi");
      setSelIds(calc.slice(lo, hi + 1).map((c) => c.zona));
      setSelAnchor(a);
    } else if (e.metaKey || e.ctrlKey) {
      setSelMode("multi");
      setSelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
      setSelAnchor(i);
    } else {
      setSelMode("simple");
      setSelIds([id]);
      setSelAnchor(i);
    }
  }
  function clearSelection() {
    setSelIds([]);
    setSelAnchor(null);
  }

  // Exporta a CSV las zonas seleccionadas (único botón real de la barra en
  // lote — Bloquear/Eliminar no aplican: esta tabla es de solo lectura).
  function exportSelected() {
    const selected = calc.filter((c) => selIds.includes(c.zona));
    if (selected.length === 0) return;
    const header = [
      "Zona", "FMIK S1", "FMIK KPI S1", ...(hasS2 ? ["FMIK S2", "FMIK KPI S2"] : []), "FMIK KPI",
      "DMIK S1", "DMIK KPI S1", ...(hasS2 ? ["DMIK S2", "DMIK KPI S2"] : []), "DMIK KPI",
      "Resultado Técnico", "POVA", "Mantenimiento", "IDO",
    ];
    const lines = [header.map(csvCell).join(CSV_SEP)];
    for (const c of selected) {
      const row = [
        c.zona, fmtNum(c.fmikS1), fmtPct(c.kpiFmikS1),
        ...(hasS2 ? [fmtNum(c.fmikS2), fmtPct(c.kpiFmikS2)] : []), fmtPct(c.kpiFmik),
        fmtNum(c.dmikS1), fmtPct(c.kpiDmikS1),
        ...(hasS2 ? [fmtNum(c.dmikS2), fmtPct(c.kpiDmikS2)] : []), fmtPct(c.kpiDmik),
        fmtPct(c.resultadoTecnico), fmtPct(c.pova), fmtPct(c.mantenimiento), fmtPct(c.ido, 1),
      ];
      lines.push(row.map(csvCell).join(CSV_SEP));
    }
    const blob = new Blob([toUtf16LeBytes(lines.join("\r\n"))], { type: "text/csv;charset=utf-16le;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ido_resumen_${periodo}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`${selected.length} zona(s) exportada(s)`);
  }

  const fmikStart = colIndex("fmik_s1");
  const fmikEnd = colIndex("fmik_kpi");
  const dmikStart = colIndex("dmik_s1");
  const dmikEnd = colIndex("dmik_kpi");
  const showSelBar = selMode === "multi" && selIds.length >= 2;

  return (
    <div className="ido-terminal">
      <div className="ido-card">
        {/* ── Toolbar ────────────────────────────────────────────────────── */}
        <div className="ido-toolbar">
          <Gauge className="w-4 h-4" style={{ color: "var(--ido-text-dim)" }} />
          <span className="ido-title">IDO — Resumen</span>
          <span className="ido-divider" />
          <span className="ido-subtitle">KPIs, Resultado Técnico, POVA, Mantenimiento e IDO por zona</span>

          <div style={{ flex: 1 }} />

          <span className="ido-reset-confirm" style={{ opacity: resetMsg ? 1 : 0 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg>
            Vista restablecida
          </span>
          <button
            className="ido-btn ido-btn-text"
            onClick={resetLayout}
            title="Restaura el ancho de columnas a su valor por defecto"
          >
            Restablecer vista
          </button>

          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5" style={{ color: "var(--ido-text-dim)" }} />
            <div className="relative" ref={dropRef}>
              <button
                onClick={() => setDropOpen((o) => !o)}
                className="ido-field inline-flex items-center justify-between gap-2"
                style={{ width: 96 }}
                aria-label="Período"
              >
                <span style={{ fontFamily: MONO }}>{periodo}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropOpen ? "rotate-180" : ""}`} />
              </button>
              {dropOpen && (
                <div className="ido-menu" style={{ position: "absolute", left: "auto", right: 0, top: "calc(100% + 4px)", width: 128 }}>
                  {periodoOptions.length === 0 ? (
                    <div className="ido-menu-item" style={{ cursor: "default", color: "var(--ido-text-dim)" }}>Sin años guardados</div>
                  ) : (
                    periodoOptions.map((p) => (
                      <div
                        key={p}
                        className="ido-menu-item"
                        onClick={() => { setPeriodo(p); setDropOpen(false); }}
                        style={{ fontFamily: MONO, color: p === periodo ? "var(--ido-accent)" : undefined, cursor: "pointer" }}
                      >
                        {p}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <button className="ido-btn ido-btn-ghost" onClick={() => load(periodo)} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Recargar
          </button>
        </div>

        {/* ── IDO promedio ──────────────────────────────────────────────── */}
        {idoPromedio !== null && (
          <div style={{ padding: "16px 20px 0" }}>
            <div className="ido-stat">
              <span className="ido-stat-label">IDO promedio ({calc.filter((c) => c.ido !== null).length} zonas)</span>
              <span className="ido-stat-value" style={{ color: idoStyle(idoPromedio).color }}>
                {fmtPct(idoPromedio, 1)}
              </span>
            </div>
          </div>
        )}

        {/* ── Criterios / metas (lectura — se editan en Carga de datos) ───── */}
        <div style={{ marginTop: 16 }}>
          <button onClick={() => setMetasOpen((o) => !o)} className="ido-chevron-row">
            <span className="ido-chevron-btn" data-open={metasOpen}>
              <ChevronDown className="w-3 h-3" />
            </span>
            <SlidersHorizontal className="w-3.5 h-3.5" style={{ color: "var(--ido-text-dim)" }} />
            Criterios / metas usadas
            <span className="ido-hint" style={{ marginTop: 0 }}>
              (FMIK S1 ≤ {metas.fmikS1} · DMIK S1 ≤ {metas.dmikS1} · Obj. POVA {metas.povaTransferido}%)
            </span>
          </button>
          {metasOpen && (
            <div className="ido-criterios" style={{ borderBottom: 0 }}>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {([
                  ["FMIK S1 ≤", metas.fmikS1], ["FMIK S2 ≤", metas.fmikS2],
                  ["DMIK S1 ≤", metas.dmikS1], ["DMIK S2 ≤", metas.dmikS2],
                  ["Objetivo POVA", `${metas.povaTransferido}%`],
                  ["POVA Fin obra", `${metas.povaFinObra}%`], ["POVA Creados =", metas.povaCreados],
                ] as [string, string | number][]).map(([label, val]) => (
                  <div key={label} className="ido-criterio">
                    <span>{label}</span>
                    <span style={{ fontFamily: MONO, color: "var(--ido-text)" }}>{val}</span>
                  </div>
                ))}
              </div>
              <p className="ido-hint">
                Estos valores se editan en <span className="ido-note-calc">Carga de datos → Criterios estratégicos</span>.
              </p>
            </div>
          )}
        </div>

        {/* ── Tabla calculada (CSS grid, ancho ajustado al viewport) ──────── */}
        <div style={{ position: "relative", marginTop: 16, borderTop: "1px solid var(--ido-line)" }}>
          <div ref={containerRef} style={{ overflowX: "auto" }}>
            {calc.length === 0 ? (
              <div className="ido-loading" style={{ height: 140 }}>
                {loading ? "Cargando…" : `Sin datos para el período ${periodo}. Cargá valores en "Carga de datos".`}
              </div>
            ) : (
              <div style={{ padding: `0 ${fitted.pad}px`, transition: "padding 200ms var(--ido-ease)" }}>
                <div style={{ position: "relative", minWidth: fittedTotalWidth }}>
                  {/* Guía de arrastre: 1px verde de punta a punta + etiqueta de ancho */}
                  {resizingCol && (
                    <>
                      <div
                        style={{
                          position: "absolute", top: 0, bottom: 0, left: resizeOffsetX, width: 1,
                          background: "var(--ido-accent)", pointerEvents: "none", zIndex: 30,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute", top: 44, left: resizeOffsetX + 6, padding: "4px 8px",
                          borderRadius: 6, background: "var(--ido-surface-hover)", border: "1px solid var(--ido-line)",
                          fontFamily: MONO, fontSize: 11, color: "var(--ido-text)", whiteSpace: "nowrap",
                          pointerEvents: "none", zIndex: 31,
                        }}
                      >
                        {Math.round(fitted.widths[resizingCol] ?? defW[resizingCol])} px
                      </div>
                    </>
                  )}

                  {/* Header: 2 filas de grid (grupo FMIK/DMIK + métricas hoja) */}
                  <div
                    className="grid"
                    style={{ gridTemplateColumns, gridTemplateRows: "24px 34px", background: "var(--ido-surface)", borderBottom: "1px solid var(--ido-line-strong)", transition: "grid-template-columns 200ms var(--ido-ease)" }}
                  >
                    <div
                      className="sticky left-0 z-10 flex items-center justify-center"
                      style={{ gridRow: "1 / 3", gridColumn: `${colIndex("sel")}`, background: "var(--ido-surface)" }}
                    >
                      <span style={{ width: 16, height: 16, border: "1px solid rgba(255,255,255,.16)", borderRadius: 4, display: "inline-block" }} />
                    </div>
                    <div
                      className="relative sticky z-10 flex items-end"
                      style={{ gridRow: "1 / 3", gridColumn: `${colIndex("zona")}`, left: 44, background: "var(--ido-surface)", padding: "0 12px 6px 12px", ...HEADER_LABEL_STYLE }}
                    >
                      Zona
                      <Resizer id="zona" />
                    </div>

                    <div className="ido-band-group relative" style={{ gridRow: "1", gridColumn: `${fmikStart} / ${fmikEnd + 1}`, borderLeft: "1px solid var(--ido-line-strong)" }}>FMIK</div>
                    <div className="ido-band-group relative" style={{ gridRow: "1", gridColumn: `${dmikStart} / ${dmikEnd + 1}`, borderLeft: "1px solid var(--ido-line-strong)" }}>DMIK</div>

                    <div
                      className="relative flex items-end justify-center text-center"
                      style={{ gridRow: "1 / 3", gridColumn: `${colIndex("tecnico")}`, borderLeft: "1px solid var(--ido-line-strong)", padding: "0 12px 6px", ...HEADER_LABEL_STYLE }}
                    >
                      Result.<br />Técnico
                      <Resizer id="tecnico" />
                      <AbsorbBar id="tecnico" />
                    </div>
                    <div
                      className="relative flex items-end justify-center text-center"
                      style={{ gridRow: "1 / 3", gridColumn: `${colIndex("pova")}`, borderLeft: "1px solid var(--ido-line-strong)", padding: "0 12px 6px", ...HEADER_LABEL_STYLE }}
                    >
                      POVA
                      <Resizer id="pova" />
                      <AbsorbBar id="pova" />
                    </div>
                    <div
                      className="relative flex items-end justify-center text-center"
                      style={{ gridRow: "1 / 3", gridColumn: `${colIndex("mant")}`, borderLeft: "1px solid var(--ido-line-strong)", padding: "0 12px 6px", ...HEADER_LABEL_STYLE }}
                    >
                      Manten.
                      <Resizer id="mant" />
                      <AbsorbBar id="mant" />
                    </div>
                    <div
                      className="relative flex items-end justify-center text-center"
                      style={{ gridRow: "1 / 3", gridColumn: `${colIndex("ido")}`, borderLeft: "1px solid var(--ido-line-strong)", padding: "0 12px 6px", color: "var(--ido-text)", fontSize: 10, fontWeight: 500, letterSpacing: ".1em", textTransform: "uppercase" }}
                    >
                      IDO
                      <Resizer id="ido" />
                      <AbsorbBar id="ido" />
                    </div>

                    <div className="relative flex items-center justify-end" style={{ gridRow: "2", gridColumn: `${colIndex("fmik_s1")}`, borderLeft: "1px solid var(--ido-line-strong)", padding: "0 12px", ...HEADER_LABEL_STYLE }}>S1<Resizer id="fmik_s1" /></div>
                    <div className="relative flex items-center justify-end" style={{ gridRow: "2", gridColumn: `${colIndex("fmik_kpi_s1")}`, padding: "0 12px", ...HEADER_LABEL_STYLE }}>KPI S1<Resizer id="fmik_kpi_s1" /><AbsorbBar id="fmik_kpi_s1" /></div>
                    {hasS2 && <div className="relative flex items-center justify-end" style={{ gridRow: "2", gridColumn: `${colIndex("fmik_s2")}`, padding: "0 12px", ...HEADER_LABEL_STYLE }}>S2<Resizer id="fmik_s2" /></div>}
                    {hasS2 && <div className="relative flex items-center justify-end" style={{ gridRow: "2", gridColumn: `${colIndex("fmik_kpi_s2")}`, padding: "0 12px", ...HEADER_LABEL_STYLE }}>KPI S2<Resizer id="fmik_kpi_s2" /><AbsorbBar id="fmik_kpi_s2" /></div>}
                    <div className="relative flex items-center justify-end" style={{ gridRow: "2", gridColumn: `${colIndex("fmik_kpi")}`, padding: "0 12px", ...HEADER_LABEL_STYLE }}>KPI<Resizer id="fmik_kpi" /><AbsorbBar id="fmik_kpi" /></div>

                    <div className="relative flex items-center justify-end" style={{ gridRow: "2", gridColumn: `${colIndex("dmik_s1")}`, borderLeft: "1px solid var(--ido-line-strong)", padding: "0 12px", ...HEADER_LABEL_STYLE }}>S1<Resizer id="dmik_s1" /></div>
                    <div className="relative flex items-center justify-end" style={{ gridRow: "2", gridColumn: `${colIndex("dmik_kpi_s1")}`, padding: "0 12px", ...HEADER_LABEL_STYLE }}>KPI S1<Resizer id="dmik_kpi_s1" /><AbsorbBar id="dmik_kpi_s1" /></div>
                    {hasS2 && <div className="relative flex items-center justify-end" style={{ gridRow: "2", gridColumn: `${colIndex("dmik_s2")}`, padding: "0 12px", ...HEADER_LABEL_STYLE }}>S2<Resizer id="dmik_s2" /></div>}
                    {hasS2 && <div className="relative flex items-center justify-end" style={{ gridRow: "2", gridColumn: `${colIndex("dmik_kpi_s2")}`, padding: "0 12px", ...HEADER_LABEL_STYLE }}>KPI S2<Resizer id="dmik_kpi_s2" /><AbsorbBar id="dmik_kpi_s2" /></div>}
                    <div className="relative flex items-center justify-end" style={{ gridRow: "2", gridColumn: `${colIndex("dmik_kpi")}`, padding: "0 12px", ...HEADER_LABEL_STYLE }}>KPI<Resizer id="dmik_kpi" /><AbsorbBar id="dmik_kpi" /></div>
                  </div>

                  {/* Filas */}
                  <div>
                    {calc.map((c, i) => {
                      const ido = idoStyle(c.ido);
                      const on = selIds.includes(c.zona);
                      const selClass = on ? (selMode === "multi" ? "ido-row-selected-multi" : "ido-row-selected") : "";
                      const checked = on && selMode === "multi";
                      return (
                        <div
                          key={c.zona}
                          className={`ido-table-row grid ${selClass}`}
                          style={{ gridTemplateColumns, height: 36, borderBottom: "1px solid var(--ido-row-line)", cursor: "pointer", transition: "grid-template-columns 200ms var(--ido-ease), background 120ms var(--ido-ease), box-shadow 120ms var(--ido-ease)" }}
                          onClick={(e) => handleRowClick(i, e)}
                        >
                          <div className="sticky left-0 z-10 flex items-center justify-center" style={{ background: "inherit" }}>
                            <span
                              style={{
                                width: 16, height: 16, borderRadius: 4, display: "grid", placeItems: "center",
                                border: `1px solid ${checked ? "var(--ido-accent)" : "rgba(255,255,255,.16)"}`,
                                background: checked ? "var(--ido-accent)" : "transparent",
                                transition: "all 100ms var(--ido-ease)",
                              }}
                            >
                              {checked && (
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--ido-accent-ink)" strokeWidth="2.5"><path d="M3 8l3.5 3.5L13 4.5" /></svg>
                              )}
                            </span>
                          </div>
                          <div className="sticky z-10 flex items-center truncate font-semibold" style={{ left: 44, background: "inherit", padding: "0 12px 0 12px" }}>
                            <span className="ido-zona">{c.zona}</span>
                          </div>
                          <div className="flex items-center justify-end truncate" style={{ borderLeft: "1px solid var(--ido-line-strong)", padding: "0 12px", fontFamily: MONO, color: "var(--ido-text)", fontVariantNumeric: "tabular-nums" }}>{fmtNum(c.fmikS1)}</div>
                          <div className="flex items-center justify-end font-semibold" style={{ padding: "0 12px", fontFamily: MONO, color: kpiColor(c.kpiFmikS1), fontVariantNumeric: "tabular-nums" }}>{fmtPct(c.kpiFmikS1)}</div>
                          {hasS2 && <div className="flex items-center justify-end truncate" style={{ padding: "0 12px", fontFamily: MONO, color: "var(--ido-text)", fontVariantNumeric: "tabular-nums" }}>{fmtNum(c.fmikS2)}</div>}
                          {hasS2 && <div className="flex items-center justify-end font-semibold" style={{ padding: "0 12px", fontFamily: MONO, color: kpiColor(c.kpiFmikS2), fontVariantNumeric: "tabular-nums" }}>{fmtPct(c.kpiFmikS2)}</div>}
                          <div className="flex items-center justify-end font-semibold" style={{ padding: "0 12px", fontFamily: MONO, color: kpiColor(c.kpiFmik), fontVariantNumeric: "tabular-nums" }}>{fmtPct(c.kpiFmik)}</div>

                          <div className="flex items-center justify-end truncate" style={{ borderLeft: "1px solid var(--ido-line-strong)", padding: "0 12px", fontFamily: MONO, color: "var(--ido-text)", fontVariantNumeric: "tabular-nums" }}>{fmtNum(c.dmikS1)}</div>
                          <div className="flex items-center justify-end font-semibold" style={{ padding: "0 12px", fontFamily: MONO, color: kpiColor(c.kpiDmikS1), fontVariantNumeric: "tabular-nums" }}>{fmtPct(c.kpiDmikS1)}</div>
                          {hasS2 && <div className="flex items-center justify-end truncate" style={{ padding: "0 12px", fontFamily: MONO, color: "var(--ido-text)", fontVariantNumeric: "tabular-nums" }}>{fmtNum(c.dmikS2)}</div>}
                          {hasS2 && <div className="flex items-center justify-end font-semibold" style={{ padding: "0 12px", fontFamily: MONO, color: kpiColor(c.kpiDmikS2), fontVariantNumeric: "tabular-nums" }}>{fmtPct(c.kpiDmikS2)}</div>}
                          <div className="flex items-center justify-end font-semibold" style={{ padding: "0 12px", fontFamily: MONO, color: kpiColor(c.kpiDmik), fontVariantNumeric: "tabular-nums" }}>{fmtPct(c.kpiDmik)}</div>

                          <div className="flex items-center justify-end font-semibold" style={{ borderLeft: "1px solid var(--ido-line-strong)", padding: "0 12px", fontFamily: MONO, color: kpiColor(c.resultadoTecnico), fontVariantNumeric: "tabular-nums" }}>{fmtPct(c.resultadoTecnico)}</div>
                          <div className="flex items-center justify-end" style={{ borderLeft: "1px solid var(--ido-line-strong)", padding: "0 12px", fontFamily: MONO, color: "var(--ido-accent)", fontStyle: "italic", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{fmtPct(c.pova)}</div>
                          <div className="flex items-center justify-end" style={{ borderLeft: "1px solid var(--ido-line-strong)", padding: "0 12px", fontFamily: MONO, color: "var(--ido-accent)", fontStyle: "italic", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{fmtPct(c.mantenimiento)}</div>
                          <div className="flex items-center justify-end" style={{ borderLeft: "1px solid var(--ido-line-strong)", padding: "0 12px" }}>
                            <span className="inline-block font-semibold" style={{ padding: "2px 10px", borderRadius: 999, fontFamily: MONO, color: ido.color, background: ido.bg, fontVariantNumeric: "tabular-nums" }}>
                              {fmtPct(c.ido, 1)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Barra flotante de selección en lote */}
          {showSelBar && (
            <div className="ido-selbar">
              <span className="ido-selbar-count"><b>{selIds.length}</b> seleccionadas</span>
              <span className="ido-selbar-sep" />
              <button className="ido-btn ido-btn-ghost" onClick={exportSelected}>
                <Download className="w-3.5 h-3.5" /> Exportar
              </button>
              <button className="ido-selbar-close" title="Liberar selección" onClick={clearSelection}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
