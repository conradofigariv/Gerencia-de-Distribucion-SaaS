"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Gauge, Loader2, RefreshCw, Calendar, SlidersHorizontal, ChevronDown,
} from "lucide-react";
import { getRows, computeIdo, getMetas, listPeriodos, DEFAULT_METAS } from "@/lib/idoStorage";
import type { IdoRow, IdoCalc, IdoMetas } from "@/lib/idoStorage";

// ─── Formato ───────────────────────────────────────────────────────────────────

function fmtNum(v: number | null): string {
  return v === null ? "—" : v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(v: number | null, dec = 0): string {
  return v === null ? "—" : `${(v * 100).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`;
}
function kpiColor(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  if (v >= 1) return "text-emerald-400";
  if (v > 0) return "text-amber-400";
  return "text-red-400";
}
function idoStyle(v: number | null): { color: string; bg: string } {
  if (v === null) return { color: "var(--muted-foreground, #888)", bg: "transparent" };
  if (v >= 0.85) return { color: "#86efac", bg: "rgba(134,239,172,0.12)" };
  if (v >= 0.70) return { color: "#bef264", bg: "rgba(190,242,100,0.12)" };
  if (v >= 0.50) return { color: "#fcd34d", bg: "rgba(252,211,77,0.12)" };
  return { color: "#fca5a5", bg: "rgba(252,165,165,0.12)" };
}

export function IndiceIdoResumenSection() {
  const [periodo, setPeriodo] = useState(String(new Date().getFullYear()));
  const [periodos, setPeriodos] = useState<string[]>([]);
  const [dropOpen, setDropOpen] = useState(false);
  const [rows, setRows] = useState<IdoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [metas, setMetas] = useState<IdoMetas>(DEFAULT_METAS);
  const [metasOpen, setMetasOpen] = useState(false);

  // Anchos de columna ajustables
  const [colW, setColW] = useState<Record<string, number>>({});
  const resizing = useRef<{ id: string; startX: number; startW: number } | null>(null);
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const r = resizing.current;
      if (!r) return;
      const w = Math.max(40, r.startW + (e.clientX - r.startX));
      setColW((p) => ({ ...p, [r.id]: w }));
    }
    function onUp() { resizing.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

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

  // Columnas hoja (para colgroup + resize). w = ancho por defecto.
  const leafCols = useMemo(() => {
    const c: { id: string; w: number }[] = [{ id: "zona", w: 56 }];
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

  function startResize(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { id, startX: e.clientX, startW: colW[id] ?? defW[id] };
  }
  const Resizer = ({ id }: { id: string }) => (
    <span
      onMouseDown={(e) => startResize(e, id)}
      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-accent/50"
    />
  );

  const periodoOptions = useMemo(
    () => [...new Set([periodo, ...periodos])].sort().reverse(),
    [periodo, periodos]
  );

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
            <Gauge className="w-[18px] h-[18px]" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-foreground" style={{ letterSpacing: -0.4, margin: 0 }}>
              Índice IDO — Resumen
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: "oklch(0.55 0 0)" }}>
              KPIs, Resultado Técnico, POVA, Mantenimiento e IDO calculados por zona.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Desplegable de años guardados */}
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <label className="text-sm text-muted-foreground">Período</label>
            <div className="relative" ref={dropRef}>
              <button
                onClick={() => setDropOpen((o) => !o)}
                className="w-28 h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground flex items-center justify-between gap-2 hover:border-accent transition-colors"
              >
                <span className="font-mono">{periodo}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${dropOpen ? "rotate-180" : ""}`} />
              </button>
              {dropOpen && (
                <div className="absolute right-0 mt-1 w-32 z-30 rounded-lg border border-border bg-card shadow-xl overflow-hidden">
                  {periodoOptions.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Sin años guardados</div>
                  ) : (
                    periodoOptions.map((p) => (
                      <button
                        key={p}
                        onClick={() => { setPeriodo(p); setDropOpen(false); }}
                        className={`w-full text-left px-3 py-2 text-sm font-mono hover:bg-secondary/60 transition-colors ${p === periodo ? "text-accent" : "text-foreground"}`}
                      >
                        {p}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => load(periodo)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Recargar
          </button>
        </div>
      </div>

      {/* IDO promedio */}
      {idoPromedio !== null && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="rounded-xl border border-border bg-card/40 px-5 py-3">
            <div className="text-xs text-muted-foreground">IDO promedio ({calc.filter((c) => c.ido !== null).length} zonas)</div>
            <div className="text-2xl font-semibold font-mono" style={{ color: idoStyle(idoPromedio).color }}>
              {fmtPct(idoPromedio, 1)}
            </div>
          </div>
        </div>
      )}

      {/* Metas (lectura — se editan en Carga de datos) */}
      <div className="rounded-xl border border-border bg-card/40">
        <button
          onClick={() => setMetasOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-foreground"
        >
          <SlidersHorizontal className="w-4 h-4 text-accent" />
          Criterios / metas usadas
          <span className="text-xs text-muted-foreground font-normal">
            (FMIK S1 ≤ {metas.fmikS1} · DMIK S1 ≤ {metas.dmikS1} · Obj. POVA {metas.povaTransferido}%)
          </span>
          <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${metasOpen ? "rotate-180" : ""}`} />
        </button>
        {metasOpen && (
          <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
            {([
              ["FMIK S1 ≤", metas.fmikS1], ["FMIK S2 ≤", metas.fmikS2],
              ["DMIK S1 ≤", metas.dmikS1], ["DMIK S2 ≤", metas.dmikS2],
              ["Objetivo POVA", `${metas.povaTransferido}%`],
              ["POVA Fin obra", `${metas.povaFinObra}%`], ["POVA Creados =", metas.povaCreados],
            ] as [string, string | number][]).map(([label, val]) => (
              <div key={label} className="flex flex-col">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono text-foreground">{val}</span>
              </div>
            ))}
            <p className="col-span-full text-[11px] text-muted-foreground/70">
              Estos valores se editan en <span className="text-accent">Carga de datos → Criterios estratégicos</span>.
            </p>
          </div>
        )}
      </div>

      {/* Tabla calculada */}
      <div className="rounded-xl border border-border bg-card/40 overflow-x-auto">
        {calc.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {loading ? "Cargando…" : `Sin datos para el período ${periodo}. Cargá valores en "Carga de datos".`}
          </div>
        ) : (
          <table className="text-xs border-collapse" style={{ tableLayout: "fixed", width: "100%" }}>
            <colgroup>
              {leafCols.map((c) => (
                <col key={c.id} style={{ width: `${colW[c.id] ?? c.w}px` }} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-border">
                <th rowSpan={2} className="relative text-left font-medium px-3 py-2 sticky left-0 bg-card/90 z-10 align-bottom">Zona<Resizer id="zona" /></th>
                <th colSpan={hasS2 ? 5 : 3} className="text-center font-semibold text-foreground/80 px-3 py-1.5 border-l border-border">FMIK</th>
                <th colSpan={hasS2 ? 5 : 3} className="text-center font-semibold text-foreground/80 px-3 py-1.5 border-l border-border">DMIK</th>
                <th rowSpan={2} className="relative text-center font-semibold text-foreground/80 px-3 py-2 border-l border-border align-bottom">Result.<br />Técnico<Resizer id="tecnico" /></th>
                <th rowSpan={2} className="relative text-center font-semibold text-foreground/80 px-3 py-2 border-l border-border align-bottom">POVA<Resizer id="pova" /></th>
                <th rowSpan={2} className="relative text-center font-semibold text-foreground/80 px-3 py-2 border-l border-border align-bottom">Manten.<Resizer id="mant" /></th>
                <th rowSpan={2} className="relative text-center font-semibold text-foreground px-3 py-2 border-l border-border align-bottom">IDO<Resizer id="ido" /></th>
              </tr>
              <tr className="border-b border-border text-muted-foreground">
                <th className="relative text-right font-medium px-3 py-1.5 border-l border-border">S1<Resizer id="fmik_s1" /></th>
                <th className="relative text-right font-medium px-3 py-1.5">KPI S1<Resizer id="fmik_kpi_s1" /></th>
                {hasS2 && <th className="relative text-right font-medium px-3 py-1.5">S2<Resizer id="fmik_s2" /></th>}
                {hasS2 && <th className="relative text-right font-medium px-3 py-1.5">KPI S2<Resizer id="fmik_kpi_s2" /></th>}
                <th className="relative text-right font-medium px-3 py-1.5">KPI<Resizer id="fmik_kpi" /></th>
                <th className="relative text-right font-medium px-3 py-1.5 border-l border-border">S1<Resizer id="dmik_s1" /></th>
                <th className="relative text-right font-medium px-3 py-1.5">KPI S1<Resizer id="dmik_kpi_s1" /></th>
                {hasS2 && <th className="relative text-right font-medium px-3 py-1.5">S2<Resizer id="dmik_s2" /></th>}
                {hasS2 && <th className="relative text-right font-medium px-3 py-1.5">KPI S2<Resizer id="dmik_kpi_s2" /></th>}
                <th className="relative text-right font-medium px-3 py-1.5">KPI<Resizer id="dmik_kpi" /></th>
              </tr>
            </thead>
            <tbody>
              {calc.map((c) => {
                const ido = idoStyle(c.ido);
                return (
                  <tr key={c.zona} className="border-b border-border/50 hover:bg-secondary/20">
                    <td className="px-3 py-1.5 font-semibold text-foreground sticky left-0 bg-card/90 z-10 truncate">{c.zona}</td>
                    <td className="px-3 py-1.5 text-right font-mono border-l border-border text-foreground/90 truncate">{fmtNum(c.fmikS1)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono font-semibold ${kpiColor(c.kpiFmikS1)}`}>{fmtPct(c.kpiFmikS1)}</td>
                    {hasS2 && <td className="px-3 py-1.5 text-right font-mono text-foreground/90 truncate">{fmtNum(c.fmikS2)}</td>}
                    {hasS2 && <td className={`px-3 py-1.5 text-right font-mono font-semibold ${kpiColor(c.kpiFmikS2)}`}>{fmtPct(c.kpiFmikS2)}</td>}
                    <td className={`px-3 py-1.5 text-right font-mono font-semibold ${kpiColor(c.kpiFmik)}`}>{fmtPct(c.kpiFmik)}</td>
                    <td className="px-3 py-1.5 text-right font-mono border-l border-border text-foreground/90 truncate">{fmtNum(c.dmikS1)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono font-semibold ${kpiColor(c.kpiDmikS1)}`}>{fmtPct(c.kpiDmikS1)}</td>
                    {hasS2 && <td className="px-3 py-1.5 text-right font-mono text-foreground/90 truncate">{fmtNum(c.dmikS2)}</td>}
                    {hasS2 && <td className={`px-3 py-1.5 text-right font-mono font-semibold ${kpiColor(c.kpiDmikS2)}`}>{fmtPct(c.kpiDmikS2)}</td>}
                    <td className={`px-3 py-1.5 text-right font-mono font-semibold ${kpiColor(c.kpiDmik)}`}>{fmtPct(c.kpiDmik)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono font-semibold border-l border-border ${kpiColor(c.resultadoTecnico)}`}>{fmtPct(c.resultadoTecnico)}</td>
                    <td className="px-3 py-1.5 text-right font-mono border-l border-border text-foreground/90 truncate">{fmtPct(c.pova)}</td>
                    <td className="px-3 py-1.5 text-right font-mono border-l border-border text-foreground/90 truncate">{fmtPct(c.mantenimiento)}</td>
                    <td className="px-3 py-1.5 text-right border-l border-border">
                      <span className="inline-block px-2 py-0.5 rounded font-mono font-semibold" style={{ color: ido.color, background: ido.bg }}>
                        {fmtPct(c.ido, 1)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
