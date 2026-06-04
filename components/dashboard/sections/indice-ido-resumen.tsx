"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Gauge, Loader2, RefreshCw, Calendar, SlidersHorizontal, ChevronDown,
} from "lucide-react";
import { getRows, computeIdo, DEFAULT_METAS } from "@/lib/idoStorage";
import type { IdoRow, IdoCalc, IdoMetas } from "@/lib/idoStorage";

// ─── Formato ───────────────────────────────────────────────────────────────────

function fmtNum(v: number | null): string {
  return v === null ? "—" : v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(v: number | null, dec = 0): string {
  return v === null ? "—" : `${(v * 100).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`;
}

// Color de un KPI binario / resultado técnico (0, 0.5, 1)
function kpiColor(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  if (v >= 1) return "text-emerald-400";
  if (v > 0) return "text-amber-400";
  return "text-red-400";
}
// Color del IDO por bandas
function idoStyle(v: number | null): { color: string; bg: string } {
  if (v === null) return { color: "var(--muted-foreground, #888)", bg: "transparent" };
  if (v >= 0.85) return { color: "#86efac", bg: "rgba(134,239,172,0.12)" };
  if (v >= 0.70) return { color: "#bef264", bg: "rgba(190,242,100,0.12)" };
  if (v >= 0.50) return { color: "#fcd34d", bg: "rgba(252,211,77,0.12)" };
  return { color: "#fca5a5", bg: "rgba(252,165,165,0.12)" };
}

export function IndiceIdoResumenSection() {
  const [periodo, setPeriodo] = useState(String(new Date().getFullYear()));
  const [rows, setRows] = useState<IdoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [metas, setMetas] = useState<IdoMetas>(DEFAULT_METAS);
  const [metasOpen, setMetasOpen] = useState(false);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setRows(await getRows(p));
    setLoading(false);
  }, []);

  useEffect(() => { load(periodo); }, [periodo, load]);

  const calc: IdoCalc[] = useMemo(() => rows.map((r) => computeIdo(r, metas)), [rows, metas]);
  const hasS2 = useMemo(() => rows.some((r) => r.fmik_s2 !== null || r.dmik_s2 !== null), [rows]);

  const idosValidos = calc.map((c) => c.ido).filter((x): x is number => x !== null);
  const idoPromedio = idosValidos.length ? idosValidos.reduce((a, b) => a + b, 0) / idosValidos.length : null;

  function setMeta(key: keyof IdoMetas, value: string) {
    const n = Number(value.replace(",", "."));
    setMetas((m) => ({ ...m, [key]: Number.isFinite(n) ? n : m[key] }));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Gauge className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Índice IDO — Resumen</h2>
            <p className="text-sm text-muted-foreground">
              KPIs, Resultado Técnico, POVA, Mantenimiento e IDO calculados por zona.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <label className="text-sm text-muted-foreground">Período</label>
            <input
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
              className="w-24 h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent"
            />
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

      {/* KPI destacado: IDO promedio */}
      {idoPromedio !== null && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="rounded-xl border border-border bg-card/40 px-5 py-3">
            <div className="text-xs text-muted-foreground">IDO promedio ({calc.filter(c=>c.ido!==null).length} zonas)</div>
            <div className="text-2xl font-semibold font-mono" style={{ color: idoStyle(idoPromedio).color }}>
              {fmtPct(idoPromedio, 1)}
            </div>
          </div>
        </div>
      )}

      {/* Metas (editables, no persistidas) */}
      <div className="rounded-xl border border-border bg-card/40">
        <button
          onClick={() => setMetasOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-foreground"
        >
          <SlidersHorizontal className="w-4 h-4 text-accent" />
          Metas / umbrales
          <span className="text-xs text-muted-foreground font-normal">
            (FMIK S1 ≤ {metas.fmikS1} · DMIK S1 ≤ {metas.dmikS1} · POVA obj. {metas.povaObjetivo}%)
          </span>
          <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${metasOpen ? "rotate-180" : ""}`} />
        </button>
        {metasOpen && (
          <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {([
              ["fmikS1", "FMIK S1 ≤"], ["fmikS2", "FMIK S2 ≤"],
              ["dmikS1", "DMIK S1 ≤"], ["dmikS2", "DMIK S2 ≤"],
              ["povaObjetivo", "POVA objetivo (%)"],
            ] as [keyof IdoMetas, string][]).map(([k, label]) => (
              <label key={k} className="flex flex-col gap-1 text-xs text-muted-foreground">
                {label}
                <input
                  type="text"
                  inputMode="decimal"
                  value={String(metas[k])}
                  onChange={(e) => setMeta(k, e.target.value)}
                  className="h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent"
                />
              </label>
            ))}
            <p className="col-span-full text-[11px] text-muted-foreground/70">
              Los cambios son temporales (no se guardan). El KPI semestral es 100% si el valor cumple ≤ la meta, 0% si no.
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
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th rowSpan={2} className="text-left font-medium px-3 py-2 sticky left-0 bg-card/90 z-10 align-bottom">Zona</th>
                <th colSpan={hasS2 ? 5 : 3} className="text-center font-semibold text-foreground/80 px-3 py-1.5 border-l border-border">FMIK</th>
                <th colSpan={hasS2 ? 5 : 3} className="text-center font-semibold text-foreground/80 px-3 py-1.5 border-l border-border">DMIK</th>
                <th rowSpan={2} className="text-center font-semibold text-foreground/80 px-3 py-2 border-l border-border align-bottom">Result.<br/>Técnico</th>
                <th rowSpan={2} className="text-center font-semibold text-foreground/80 px-3 py-2 border-l border-border align-bottom">POVA</th>
                <th rowSpan={2} className="text-center font-semibold text-foreground/80 px-3 py-2 border-l border-border align-bottom">Manten.</th>
                <th rowSpan={2} className="text-center font-semibold text-foreground px-3 py-2 border-l border-border align-bottom">IDO</th>
              </tr>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-right font-medium px-3 py-1.5 border-l border-border">S1</th>
                <th className="text-right font-medium px-3 py-1.5">KPI S1</th>
                {hasS2 && <th className="text-right font-medium px-3 py-1.5">S2</th>}
                {hasS2 && <th className="text-right font-medium px-3 py-1.5">KPI S2</th>}
                <th className="text-right font-medium px-3 py-1.5">KPI</th>
                <th className="text-right font-medium px-3 py-1.5 border-l border-border">S1</th>
                <th className="text-right font-medium px-3 py-1.5">KPI S1</th>
                {hasS2 && <th className="text-right font-medium px-3 py-1.5">S2</th>}
                {hasS2 && <th className="text-right font-medium px-3 py-1.5">KPI S2</th>}
                <th className="text-right font-medium px-3 py-1.5">KPI</th>
              </tr>
            </thead>
            <tbody>
              {calc.map((c) => {
                const ido = idoStyle(c.ido);
                return (
                  <tr key={c.zona} className="border-b border-border/50 hover:bg-secondary/20">
                    <td className="px-3 py-1.5 font-semibold text-foreground sticky left-0 bg-card/90 z-10">{c.zona}</td>
                    {/* FMIK */}
                    <td className="px-3 py-1.5 text-right font-mono border-l border-border text-foreground/90">{fmtNum(c.fmikS1)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono font-semibold ${kpiColor(c.kpiFmikS1)}`}>{fmtPct(c.kpiFmikS1)}</td>
                    {hasS2 && <td className="px-3 py-1.5 text-right font-mono text-foreground/90">{fmtNum(c.fmikS2)}</td>}
                    {hasS2 && <td className={`px-3 py-1.5 text-right font-mono font-semibold ${kpiColor(c.kpiFmikS2)}`}>{fmtPct(c.kpiFmikS2)}</td>}
                    <td className={`px-3 py-1.5 text-right font-mono font-semibold ${kpiColor(c.kpiFmik)}`}>{fmtPct(c.kpiFmik)}</td>
                    {/* DMIK */}
                    <td className="px-3 py-1.5 text-right font-mono border-l border-border text-foreground/90">{fmtNum(c.dmikS1)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono font-semibold ${kpiColor(c.kpiDmikS1)}`}>{fmtPct(c.kpiDmikS1)}</td>
                    {hasS2 && <td className="px-3 py-1.5 text-right font-mono text-foreground/90">{fmtNum(c.dmikS2)}</td>}
                    {hasS2 && <td className={`px-3 py-1.5 text-right font-mono font-semibold ${kpiColor(c.kpiDmikS2)}`}>{fmtPct(c.kpiDmikS2)}</td>}
                    <td className={`px-3 py-1.5 text-right font-mono font-semibold ${kpiColor(c.kpiDmik)}`}>{fmtPct(c.kpiDmik)}</td>
                    {/* Resultado / POVA / Mant / IDO */}
                    <td className={`px-3 py-1.5 text-right font-mono font-semibold border-l border-border ${kpiColor(c.resultadoTecnico)}`}>{fmtPct(c.resultadoTecnico)}</td>
                    <td className="px-3 py-1.5 text-right font-mono border-l border-border text-foreground/90">{fmtPct(c.pova)}</td>
                    <td className="px-3 py-1.5 text-right font-mono border-l border-border text-foreground/90">{fmtPct(c.mantenimiento)}</td>
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
