"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { Loader2, RefreshCw, ChevronRight, Trash2, Search, X, CheckCircle2 } from "lucide-react";
import { SearchInput } from "@/components/ui/floating-input";
import { cn } from "@/lib/utils";

const POT_13 = [5, 10, 16, 25, 50, 63, 80, 100, 125, 160, 200, 250, 315, 500, 630, 800, 1000];
const REL33_ROWS = [25, 63, 160, 315, 500, 630];
const RURAL_KVA = new Set([5, 10, 16, 25]);

interface Celda { t: number; m: number; ct: number; tipo?: string }
interface PlanillaRow {
  id: number;
  fecha: string;
  datos: {
    terceros: Record<string, Celda>;
    taller: Record<string, Celda>;
    autorizados: Record<string, number>;
    rel33: Record<string, { tN: number; mN: number; tR: number; mR: number }>;
    obs: string;
    pend: string;
    deposito?: string;
  };
  created_at: string;
}

// ─── Read-only report micro-components (mismo formato visual que Carga de datos) ──

function NV({ val }: { val: number }) {
  return (
    <div className="flex items-center justify-center mx-auto bg-panel-input border border-border rounded w-7 px-1 py-1">
      <span className="text-xs text-foreground select-none">{val || "0"}</span>
    </div>
  );
}

function TH({ c, rs, cs, children }: { c?: string; rs?: number; cs?: number; children: React.ReactNode }) {
  return (
    <th rowSpan={rs} colSpan={cs}
      className={`px-0.5 py-1 text-[8px] font-bold text-muted-foreground border border-border bg-panel-header uppercase tracking-wide leading-tight ${c ?? ""}`}>
      {children}
    </th>
  );
}

function TD({ c, children }: { c?: string; children: React.ReactNode }) {
  return (
    <td className={`px-0.5 py-1 text-[10px] border border-border text-center text-muted-foreground ${c ?? ""}`}>
      {children}
    </td>
  );
}

function TotalRow({ label, span, values }: { label: string; span?: number; values: (string | number | React.ReactNode)[] }) {
  return (
    <tr className="bg-panel-header font-bold">
      <td colSpan={span ?? 1} className="px-1 py-1 border border-border text-[10px] font-bold text-muted-foreground text-center">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="px-1 py-1 border border-border text-xs text-center text-accent-green font-bold">{v || "—"}</td>
      ))}
    </tr>
  );
}

type SortKey = "fecha" | "total" | "disp";

export function TransformadoresTablaSection() {
  const [rows, setRows] = useState<PlanillaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("fecha");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("planillas_reserva")
      .select("*")
      .order("fecha", { ascending: false });
    if (error) {
      toast.error(error.message);
    } else {
      setRows((data ?? []) as PlanillaRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (openId === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenId(null); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [openId]);

  const computeTotals = (p: PlanillaRow) => {
    const totTerceros = Object.values(p.datos.terceros).reduce((s, r) => s + r.t + r.m, 0);
    const totTaller   = Object.values(p.datos.taller).reduce((s, r) => s + r.t + r.m, 0);
    const totGeneral  = totTerceros + totTaller;
    const totAuto     = Object.values(p.datos.autorizados).reduce((s, v) => s + v, 0);
    const totDisp     = totGeneral - totAuto;
    return { totGeneral, totTerceros, totTaller, totAuto, totDisp };
  };

  const deleteRecord = async (id: number) => {
    if (!confirm("¿Está seguro de que desea eliminar este informe de reservas?")) {
      return;
    }
    try {
      const { error } = await supabase
        .from("planillas_reserva")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast.success("Informe eliminado correctamente");
      setRows(prev => prev.filter(r => r.id !== id));
      setOpenId(prev => (prev === id ? null : prev));
    } catch (err) {
      toast.error((err as Error).message || "Error al eliminar");
    }
  };

  const availableYears = [...new Set(rows.map(r => r.fecha.slice(0, 4)))].sort((a, b) => b.localeCompare(a));

  const MONTHS = [
    { value: "01", label: "Enero" }, { value: "02", label: "Febrero" },
    { value: "03", label: "Marzo" }, { value: "04", label: "Abril" },
    { value: "05", label: "Mayo"  }, { value: "06", label: "Junio"  },
    { value: "07", label: "Julio" }, { value: "08", label: "Agosto" },
    { value: "09", label: "Septiembre" }, { value: "10", label: "Octubre" },
    { value: "11", label: "Noviembre"  }, { value: "12", label: "Diciembre" },
  ];

  const filtered = rows.filter(r => {
    const [year, month] = r.fecha.split("-");
    if (filterYear  && year  !== filterYear)  return false;
    if (filterMonth && month !== filterMonth) return false;
    if (search) {
      const q = search.toLowerCase();
      const zona = (r.datos.deposito ?? "").toLowerCase();
      if (!r.fecha.includes(search) && !zona.includes(q)) return false;
    }
    return true;
  });

  // Filas enriquecidas con totales derivados + ordenamiento por columna
  const enriched = filtered.map(r => ({ r, totals: computeTotals(r) }));
  enriched.sort((a, b) => {
    let cmp = 0;
    if (sortKey === "fecha") cmp = a.r.fecha.localeCompare(b.r.fecha);
    if (sortKey === "total") cmp = a.totals.totGeneral - b.totals.totGeneral;
    if (sortKey === "disp")  cmp = a.totals.totDisp - b.totals.totDisp;
    return sortDir === "asc" ? cmp : -cmp;
  });

  // La fecha más reciente (entre las visibles) se resalta en la tabla
  const latestFecha = filtered.reduce((m, r) => (r.fecha > m ? r.fecha : m), "");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const openPlanilla = rows.find(r => r.id === openId) ?? null;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <select
          value={filterYear}
          onChange={e => setFilterYear(e.target.value)}
          className="px-3 py-2 rounded-lg bg-card border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">Todos los años</option>
          {availableYears.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          value={filterMonth}
          onChange={e => setFilterMonth(e.target.value)}
          className="px-3 py-2 rounded-lg bg-card border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">Todos los meses</option>
          {MONTHS.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar fecha o zona…"
          style={{ flex: 1, minWidth: 200 }}
        />
        {(filterYear || filterMonth || search) && (
          <button
            onClick={() => { setFilterYear(""); setFilterMonth(""); setSearch(""); }}
            className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-colors"
          >
            Limpiar
          </button>
        )}
        <button
          onClick={fetchData}
          disabled={loading}
          className="p-2 rounded-lg bg-accent/10 border border-accent/20 hover:bg-accent/20 transition-colors disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-4 h-4 text-accent ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* ── Historial: tabla densa (una fila por informe) ── */}
      <div className="bg-secondary/30 border border-border rounded-[10px] shadow-sm overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border">
          <p className="text-[13px] font-bold text-foreground">
            Informes de Reservas{" "}
            <span className="text-[11px] font-medium text-muted-foreground">· {filtered.length} informe{filtered.length !== 1 ? "s" : ""}</span>
          </p>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {rows.length === 0 ? "No hay planillas guardadas" : "No hay resultados para este filtro"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="px-5 py-2.5 text-left">
                    <button onClick={() => toggleSort("fecha")} className="text-[9px] font-bold tracking-[.06em] uppercase text-muted-foreground hover:text-foreground transition-colors">
                      Fecha {sortKey === "fecha" && (sortDir === "desc" ? "↓" : "↑")}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-left text-[9px] font-bold tracking-[.06em] uppercase text-muted-foreground">Zona</th>
                  <th className="px-3 py-2.5 text-right">
                    <button onClick={() => toggleSort("total")} className="text-[9px] font-bold tracking-[.06em] uppercase text-muted-foreground hover:text-foreground transition-colors">
                      Total {sortKey === "total" && (sortDir === "desc" ? "↓" : "↑")}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-right">
                    <button onClick={() => toggleSort("disp")} className="text-[9px] font-bold tracking-[.06em] uppercase text-muted-foreground hover:text-foreground transition-colors">
                      Disponibles {sortKey === "disp" && (sortDir === "desc" ? "↓" : "↑")}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-right text-[9px] font-bold tracking-[.06em] uppercase text-muted-foreground">Terceros</th>
                  <th className="px-3 py-2.5 text-right text-[9px] font-bold tracking-[.06em] uppercase text-muted-foreground">Taller</th>
                  <th className="w-[70px] px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {enriched.map(({ r, totals }) => (
                  <tr
                    key={r.id}
                    onClick={() => setOpenId(r.id)}
                    className={cn(
                      "group border-t border-hairline cursor-pointer hover:bg-secondary/40 transition-colors",
                      r.fecha === latestFecha && "bg-accent/5"
                    )}
                  >
                    <td className="px-5 py-[11px] font-bold text-foreground whitespace-nowrap">
                      {r.fecha.split("-").map((v, i) => i === 0 ? v.slice(2) : v).reverse().join("/")}
                    </td>
                    <td className="px-3 py-[11px] text-foreground/70">{r.datos.deposito ?? "—"}</td>
                    <td className="px-3 py-[11px] text-right font-extrabold text-foreground">{totals.totGeneral}</td>
                    <td className="px-3 py-[11px] text-right font-extrabold text-accent-green">{totals.totDisp}</td>
                    <td className="px-3 py-[11px] text-right text-muted-foreground">{totals.totTerceros}</td>
                    <td className="px-3 py-[11px] text-right text-muted-foreground">{totals.totTaller}</td>
                    <td className="px-5 py-[11px]">
                      <div className="flex items-center justify-end gap-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={e => { e.stopPropagation(); deleteRecord(r.id); }}
                          className="text-accent-red hover:scale-110 transition-transform"
                          title="Eliminar informe"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modal de informe (pantalla completa, fondo difuminado, mismo formato que Carga de datos) ── */}
      {openPlanilla && typeof document !== "undefined" && createPortal(
        (() => {
          const p = openPlanilla;
          const terceros = p.datos.terceros;
          const taller   = p.datos.taller;
          const auto     = p.datos.autorizados;
          const rel33    = p.datos.rel33;
          const sum2 = (r?: Celda) => (r ? r.t + r.m : 0);
          const totGeneral = POT_13.reduce((s, kva) => s + sum2(terceros[kva]) + sum2(taller[kva]), 0);
          const totAuto    = POT_13.reduce((s, kva) => s + (auto[kva] ?? 0), 0);
          const totDisp    = totGeneral - totAuto;
          const tot33N     = REL33_ROWS.reduce((s, kva) => { const r = rel33[kva]; return s + (r ? r.tN + r.mN : 0); }, 0);
          const tot33R     = REL33_ROWS.reduce((s, kva) => { const r = rel33[kva]; return s + (r ? r.tR + r.mR : 0); }, 0);

          return (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-5">
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpenId(null)} />
              <div className="relative w-full h-full bg-secondary/30 border border-border rounded-2xl shadow-2xl overflow-y-auto">

                {/* Title */}
                <div className="sticky top-0 z-10 border-b border-border bg-secondary/95 backdrop-blur px-4 py-3 flex items-center justify-between">
                  <div className="text-center flex-1">
                    <p className="text-xs font-bold text-muted-foreground tracking-wide">
                      RESERVA DE TRANSFORMADORES DE DISTRIBUCIÓN (RELAC: 13,2/0,4 — 33/0,4 KV)
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      ÁREA TÉCNICA — DPTO. TRANSFORMADORES — GCIA. TRANSMISIÓN
                      {" — "}
                      {p.fecha.split("-").reverse().join("/")}
                      {p.datos.deposito && ` — ${p.datos.deposito}`}
                    </p>
                  </div>
                  <button onClick={() => setOpenId(null)} className="absolute right-4 text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-4 space-y-5">

                  {/* ── Row 1: Terceros + Taller + Resumen ── */}
                  <div className="overflow-x-auto">
                  <div className="grid grid-cols-[5fr_6fr_4fr] gap-3 min-w-[1200px]">

                    {/* Table A: Nuevos y Reparados por Terceros */}
                    <div className="min-w-0">
                      <p className="text-[9px] font-bold text-center text-muted-foreground mb-1 uppercase tracking-wider">
                        Nuevos y Reparados por Terceros
                      </p>
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <TH>Pot. KVA</TH>
                            <TH>T</TH><TH>M</TH><TH c="leading-[1.1]">C/<br/>Tanque</TH>
                            <TH>Total</TH>
                          </tr>
                        </thead>
                        <tbody>
                          {POT_13.map(kva => {
                            const r = terceros[kva] ?? { t: 0, m: 0, ct: 0 };
                            const tot = r.t + r.m;
                            return (
                              <tr key={kva} className={tot > 0 ? "bg-accent/5" : ""}>
                                <TD c="font-semibold text-foreground">{kva}</TD>
                                <TD><NV val={r.t} /></TD>
                                <TD><NV val={r.m} /></TD>
                                <TD><NV val={r.ct} /></TD>
                                <TD c={tot > 0 ? "font-bold text-accent" : "text-muted-foreground"}>{tot || "—"}</TD>
                              </tr>
                            );
                          })}
                          <TotalRow label="TOTAL" span={4} values={[POT_13.reduce((s,kva)=>s+sum2(terceros[kva]),0)]} />
                        </tbody>
                      </table>
                    </div>

                    {/* Table B: Reparados por Taller */}
                    <div className="min-w-0">
                      <p className="text-[9px] font-bold text-center text-muted-foreground mb-1 uppercase tracking-wider">
                        Reparados por Taller de Transformadores
                      </p>
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <TH>Tipo</TH><TH>Pot. KVA</TH>
                            <TH>T</TH><TH>M</TH><TH c="leading-[1.1]">C/<br/>Tanque</TH>
                            <TH>Total</TH>
                          </tr>
                        </thead>
                        <tbody>
                          {POT_13.map(kva => {
                            const r = taller[kva] ?? { t: 0, m: 0, ct: 0 };
                            const tot = r.t + r.m;
                            return (
                              <tr key={kva} className={tot > 0 ? "bg-accent/5" : ""}>
                                {RURAL_KVA.has(kva)
                                  ? <TD c="text-[9px] text-muted-foreground">RURAL</TD>
                                  : <td className="px-0.5 py-1 text-[10px] text-center text-muted-foreground" />}
                                <TD c="font-semibold text-foreground">{kva}</TD>
                                <TD><NV val={r.t} /></TD>
                                <TD><NV val={r.m} /></TD>
                                <TD><NV val={r.ct} /></TD>
                                <TD c={tot > 0 ? "font-bold text-accent" : "text-muted-foreground"}>{tot || "—"}</TD>
                              </tr>
                            );
                          })}
                          <TotalRow label="TOTAL" span={5} values={[POT_13.reduce((s,kva)=>s+sum2(taller[kva]),0)]} />
                        </tbody>
                      </table>
                    </div>

                    {/* Table C: Resumen */}
                    <div>
                      <p className="text-[9px] font-bold text-center text-muted-foreground mb-1 uppercase tracking-wider">
                        Total de Transformadores
                      </p>
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <TH>Tipo</TH>
                            <TH c="leading-[1.1]">Total<br/>Trafos</TH>
                            <TH c="leading-[1.1]">Autorizados<br/>p/Retiro</TH>
                            <TH c="leading-[1.1]">Disponibles<br/>p/Retiro</TH>
                          </tr>
                        </thead>
                        <tbody>
                          {POT_13.map(kva => {
                            const tot  = sum2(terceros[kva]) + sum2(taller[kva]);
                            const a    = auto[kva] ?? 0;
                            const disp = Math.max(0, tot - a);
                            return (
                              <tr key={kva}>
                                {RURAL_KVA.has(kva)
                                  ? <TD c="text-[9px] text-muted-foreground">RURAL</TD>
                                  : <td className="px-0.5 py-1 text-[10px] text-center text-muted-foreground" />}
                                <TD><NV val={tot} /></TD>
                                <TD><NV val={a} /></TD>
                                <TD c={disp > 0 ? "text-accent-green font-bold" : "text-muted-foreground"}>{disp || "—"}</TD>
                              </tr>
                            );
                          })}
                          <tr className="bg-panel-header font-bold">
                            <td className="px-1 py-1 border border-border text-[9px] font-bold text-foreground text-center">TOTAL</td>
                            <td className="px-1 py-1 border border-border text-xs text-center text-accent font-bold">{totGeneral || "—"}</td>
                            <td className="px-1 py-1 border border-border text-xs text-center text-accent-amber font-bold">{totAuto || "—"}</td>
                            <td className="px-1 py-1 border border-border text-xs text-center text-accent-green font-bold">{totDisp || "—"}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  </div>

                  {/* ── Row 2: Relación 33 + Observaciones + Pendientes ── */}
                  <div className="overflow-x-auto">
                  <div className="grid grid-cols-1 md:grid-cols-[440px_1fr] gap-5 min-w-[900px]">

                    {/* Table D: Relación 33/0,4 kV */}
                    <div>
                      <p className="text-[9px] font-bold text-center text-muted-foreground mb-1 uppercase tracking-wider">
                        Relación 33/0,4 KV
                      </p>
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <TH rs={2}>Pot. KVA</TH>
                            <TH cs={2}>Trafos Nuevos</TH>
                            <TH cs={2}>Trafos Reparados</TH>
                          </tr>
                          <tr>
                            <TH>T</TH><TH>M</TH>
                            <TH>T</TH><TH>M</TH>
                          </tr>
                        </thead>
                        <tbody>
                          {REL33_ROWS.map(kva => {
                            const r = rel33[kva] ?? { tN: 0, mN: 0, tR: 0, mR: 0 };
                            return (
                              <tr key={kva}>
                                <TD c="font-semibold text-foreground">{kva}</TD>
                                <TD><NV val={r.tN} /></TD>
                                <TD><NV val={r.mN} /></TD>
                                <TD><NV val={r.tR} /></TD>
                                <TD><NV val={r.mR} /></TD>
                              </tr>
                            );
                          })}
                          <tr className="bg-panel-header font-bold">
                            <td className="px-1 py-1 border border-border text-[9px] font-bold text-foreground text-center">TOTAL</td>
                            <td colSpan={2} className="px-1 py-1 border border-border text-xs text-center text-accent font-bold">{tot33N || "—"}</td>
                            <td colSpan={2} className="px-1 py-1 border border-border text-xs text-center text-accent font-bold">{tot33R || "—"}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Observaciones + Pendientes */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                          Observaciones (13,2/0,4 KV)
                        </p>
                        <div className="flex-1 min-h-[120px] rounded-lg bg-panel-input border border-border px-2.5 py-2 text-xs text-foreground whitespace-pre-wrap">
                          {p.datos.obs || <span className="text-muted-foreground">Sin observaciones</span>}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                          Pendientes de Entregas
                        </p>
                        <div className="flex-1 min-h-[120px] rounded-lg bg-panel-input border border-border px-2.5 py-2 text-xs text-foreground whitespace-pre-wrap">
                          {p.datos.pend || <span className="text-muted-foreground">Sin pendientes</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 border-t border-border px-5 py-3 flex items-center justify-between bg-secondary/95 backdrop-blur">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Total: <strong className="text-accent-green">{totGeneral}</strong></span>
                    <span>Autorizados: <strong className="text-accent-amber">{totAuto}</strong></span>
                    <span>Disponibles: <strong className="text-accent-green">{totDisp}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => deleteRecord(p.id)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-red-400 hover:bg-red-500/20 text-sm font-medium transition-colors"
                    >
                      <Trash2 className="w-4 h-4" /> Eliminar
                    </button>
                    <button
                      onClick={() => setOpenId(null)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Cerrar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}
    </div>
  );
}
