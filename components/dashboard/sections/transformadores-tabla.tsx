"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { Loader2, RefreshCw, Search, ChevronDown, ChevronUp } from "lucide-react";

const KVA_ROWS = [5, 10, 16, 25, 50, 63, 80, 100, 125, 160, 200, 250, 315, 500, 630, 800, 1000];
const REL33_ROWS = [25, 63, 160, 315, 500, 630];

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
  };
  created_at: string;
}

export function TransformadoresTablaSection() {
  const [rows, setRows] = useState<PlanillaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

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

  const computeTotals = (p: PlanillaRow) => {
    const totTerceros = Object.values(p.datos.terceros).reduce((s, r) => s + r.t + r.m, 0);
    const totTaller   = Object.values(p.datos.taller).reduce((s, r) => s + r.t + r.m, 0);
    const totGeneral  = totTerceros + totTaller;
    const totAuto     = Object.values(p.datos.autorizados).reduce((s, v) => s + v, 0);
    const totDisp     = totGeneral - totAuto;
    return { totGeneral, totTerceros, totTaller, totAuto, totDisp };
  };

  const filtered = rows.filter(r => r.fecha.includes(search));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Buscar por fecha..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 rounded-lg bg-card border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          onClick={fetchData}
          disabled={loading}
          className="p-2 rounded-lg bg-accent/10 border border-accent/20 hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 text-accent ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 text-accent animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground bg-card/30 rounded-lg">
          No hay planillas guardadas
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(planilla => {
            const totals = computeTotals(planilla);
            const isExpanded = expandedId === planilla.id;
            return (
              <div key={planilla.id} className="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
                {/* Accordion header */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : planilla.id)}
                  className="w-full px-6 py-4 flex items-center gap-4 hover:bg-card/80 transition-colors group"
                >
                  {isExpanded
                    ? <ChevronUp className="w-5 h-5 text-accent flex-shrink-0" />
                    : <ChevronDown className="w-5 h-5 text-muted-foreground group-hover:text-accent flex-shrink-0 transition-colors" />}
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-lg text-foreground">Informe de Reservas — {planilla.fecha}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      <span className="text-accent font-medium">{totals.totGeneral}</span> total
                      {" | "}
                      <span className="text-green-400">{totals.totDisp}</span> disponibles
                      {" | "}
                      <span className="text-blue-400">{totals.totTerceros}</span> terceros
                      {" | "}
                      <span className="text-amber-400">{totals.totTaller}</span> taller
                    </p>
                  </div>
                  <span className="text-xs bg-accent/20 text-accent px-3 py-1 rounded-full font-medium flex-shrink-0">
                    {new Date(planilla.created_at).toLocaleDateString("es-AR")}
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-border">
                    {/* Reporte header */}
                    <div className="px-5 py-2.5 bg-slate-800 flex items-center justify-between">
                      <span className="text-sm font-bold text-white tracking-wide">REPORTE DE TRANSFORMADORES</span>
                      <span className="text-xs text-slate-400">Actualización 08:00 HS</span>
                    </div>

                    {/* ── Top 3 panels ── */}
                    <div className="grid grid-cols-3 divide-x divide-border border-b border-border">

                      {/* 1. Terceros (azul) */}
                      <div className="min-w-0 overflow-x-auto">
                        <div className="bg-blue-700 px-3 py-2">
                          <span className="text-[11px] font-bold text-white uppercase tracking-wide">Nuevos y Reparados por Terceros</span>
                        </div>
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="bg-muted/20 border-b border-border">
                              <th className="px-3 py-2 text-left text-muted-foreground font-semibold">KVA</th>
                              <th className="px-2 py-2 text-center text-blue-400 font-semibold">T</th>
                              <th className="px-2 py-2 text-center text-purple-400 font-semibold">M</th>
                              <th className="px-2 py-2 text-center text-amber-400 font-semibold">C/T</th>
                              <th className="px-2 py-2 text-center text-accent font-semibold">TOT</th>
                              <th className="px-2 py-2 text-left text-muted-foreground font-semibold">TIPO</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/40">
                            {KVA_ROWS.map((kva, idx) => {
                              const r = planilla.datos.terceros[String(kva)] ?? { t: 0, m: 0, ct: 0 };
                              const tot = r.t + r.m;
                              return (
                                <tr key={kva} className={idx % 2 === 0 ? "bg-card/30" : ""}>
                                  <td className="px-3 py-1.5 font-medium text-foreground">{kva}</td>
                                  <td className="px-2 py-1.5 text-center text-blue-400">{r.t || ""}</td>
                                  <td className="px-2 py-1.5 text-center text-purple-400">{r.m || ""}</td>
                                  <td className="px-2 py-1.5 text-center text-amber-400">{r.ct || ""}</td>
                                  <td className="px-2 py-1.5 text-center font-semibold text-accent">{tot || ""}</td>
                                  <td className="px-2 py-1.5 text-blue-300 text-[10px]">{r.tipo ?? ""}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* 2. Taller (verde) */}
                      <div className="min-w-0 overflow-x-auto">
                        <div className="bg-green-700 px-3 py-2">
                          <span className="text-[11px] font-bold text-white uppercase tracking-wide">Reparados por Taller de Transformadores</span>
                        </div>
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="bg-muted/20 border-b border-border">
                              <th className="px-3 py-2 text-left text-muted-foreground font-semibold">KVA</th>
                              <th className="px-2 py-2 text-center text-blue-400 font-semibold">T</th>
                              <th className="px-2 py-2 text-center text-purple-400 font-semibold">M</th>
                              <th className="px-2 py-2 text-center text-amber-400 font-semibold">C/T</th>
                              <th className="px-2 py-2 text-center text-accent font-semibold">TOT</th>
                              <th className="px-2 py-2 text-left text-muted-foreground font-semibold">TIPO</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/40">
                            {KVA_ROWS.map((kva, idx) => {
                              const r = planilla.datos.taller[String(kva)] ?? { t: 0, m: 0, ct: 0 };
                              const tot = r.t + r.m;
                              return (
                                <tr key={kva} className={idx % 2 === 0 ? "bg-card/30" : ""}>
                                  <td className="px-3 py-1.5 font-medium text-foreground">{kva}</td>
                                  <td className="px-2 py-1.5 text-center text-blue-400">{r.t || ""}</td>
                                  <td className="px-2 py-1.5 text-center text-purple-400">{r.m || ""}</td>
                                  <td className="px-2 py-1.5 text-center text-amber-400">{r.ct || ""}</td>
                                  <td className="px-2 py-1.5 text-center font-semibold text-accent">{tot || ""}</td>
                                  <td className="px-2 py-1.5 text-green-300 text-[10px]">{r.tipo ?? ""}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* 3. Totales (violeta) */}
                      <div className="min-w-0 overflow-x-auto">
                        <div className="bg-purple-700 px-3 py-2">
                          <span className="text-[11px] font-bold text-white uppercase tracking-wide">Total de Transformadores</span>
                        </div>
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="bg-muted/20 border-b border-border">
                              <th className="px-2 py-2 text-center text-accent font-semibold">TOTAL</th>
                              <th className="px-2 py-2 text-center text-yellow-400 font-semibold leading-tight">Autorizados<br/>Pend. Retiro</th>
                              <th className="px-2 py-2 text-center text-green-400 font-semibold">Disponibles</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/40">
                            {KVA_ROWS.map((kva, idx) => {
                              const terc = planilla.datos.terceros[String(kva)] ?? { t: 0, m: 0, ct: 0 };
                              const tall = planilla.datos.taller[String(kva)]   ?? { t: 0, m: 0, ct: 0 };
                              const total = terc.t + terc.m + tall.t + tall.m;
                              const auto  = planilla.datos.autorizados[String(kva)] ?? 0;
                              const disp  = total - auto;
                              return (
                                <tr key={kva} className={idx % 2 === 0 ? "bg-card/30" : ""}>
                                  <td className="px-2 py-1.5 text-center font-semibold text-accent">{total || ""}</td>
                                  <td className="px-2 py-1.5 text-center text-yellow-400">{auto || ""}</td>
                                  <td className="px-2 py-1.5 text-center text-green-400">{disp || ""}</td>
                                </tr>
                              );
                            })}
                            <tr className="bg-purple-900/30 border-t-2 border-purple-600/50 font-bold">
                              <td className="px-2 py-2 text-center text-accent">{totals.totGeneral}</td>
                              <td className="px-2 py-2 text-center text-yellow-400">{totals.totAuto || ""}</td>
                              <td className="px-2 py-2 text-center text-green-400">{totals.totDisp}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* ── Bottom 2 panels ── */}
                    <div className="grid grid-cols-2 divide-x divide-border">

                      {/* 4. Relación 33/0,4 KV (naranja) */}
                      <div>
                        <div className="bg-orange-600 px-3 py-2">
                          <span className="text-[11px] font-bold text-white uppercase tracking-wide">Relación: 33/0,4 KV</span>
                        </div>
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="bg-muted/20">
                              <th className="px-3 py-1.5 text-left text-muted-foreground font-semibold" rowSpan={2}>KVA</th>
                              <th className="px-2 py-1.5 text-center text-green-400 font-semibold" colSpan={2}>Trafos Nuevos</th>
                              <th className="px-2 py-1.5 text-center text-orange-400 font-semibold" colSpan={2}>Trafos Reparados</th>
                            </tr>
                            <tr className="bg-muted/10 border-b border-border">
                              <th className="px-3 py-1.5 text-center text-blue-400 font-semibold">T</th>
                              <th className="px-3 py-1.5 text-center text-purple-400 font-semibold">M</th>
                              <th className="px-3 py-1.5 text-center text-blue-400 font-semibold">T</th>
                              <th className="px-3 py-1.5 text-center text-purple-400 font-semibold">M</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/40">
                            {REL33_ROWS.map((kva, idx) => {
                              const r = planilla.datos.rel33[String(kva)] ?? { tN: 0, mN: 0, tR: 0, mR: 0 };
                              return (
                                <tr key={kva} className={idx % 2 === 0 ? "bg-card/30" : ""}>
                                  <td className="px-3 py-2 font-medium text-foreground">{kva}</td>
                                  <td className="px-3 py-2 text-center text-blue-400">{r.tN || ""}</td>
                                  <td className="px-3 py-2 text-center text-purple-400">{r.mN || ""}</td>
                                  <td className="px-3 py-2 text-center text-blue-400">{r.tR || ""}</td>
                                  <td className="px-3 py-2 text-center text-purple-400">{r.mR || ""}</td>
                                </tr>
                              );
                            })}
                            <tr className="bg-orange-900/20 border-t-2 border-orange-600/50 font-bold">
                              <td className="px-3 py-2 text-foreground">TOTAL</td>
                              <td className="px-3 py-2 text-center text-blue-400">
                                {Object.values(planilla.datos.rel33).reduce((s, r) => s + (r.tN || 0), 0) || ""}
                              </td>
                              <td className="px-3 py-2 text-center text-purple-400">
                                {Object.values(planilla.datos.rel33).reduce((s, r) => s + (r.mN || 0), 0) || ""}
                              </td>
                              <td className="px-3 py-2 text-center text-blue-400">
                                {Object.values(planilla.datos.rel33).reduce((s, r) => s + (r.tR || 0), 0) || ""}
                              </td>
                              <td className="px-3 py-2 text-center text-purple-400">
                                {Object.values(planilla.datos.rel33).reduce((s, r) => s + (r.mR || 0), 0) || ""}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* 5. Observaciones (oscuro) */}
                      <div className="flex flex-col">
                        <div className="bg-slate-700 px-3 py-2">
                          <span className="text-[11px] font-bold text-white uppercase tracking-wide">Observaciones</span>
                        </div>
                        <div className="p-4 space-y-3 flex-1 bg-background/20">
                          {planilla.datos.obs && (
                            <div className="p-3 bg-blue-950/40 rounded-lg border border-blue-800/30">
                              <p className="text-[10px] font-bold text-blue-300 mb-1.5 uppercase tracking-wider">Observaciones</p>
                              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{planilla.datos.obs}</p>
                            </div>
                          )}
                          {planilla.datos.pend && (
                            <div className="p-3 bg-amber-950/40 rounded-lg border border-amber-800/30">
                              <p className="text-[10px] font-bold text-amber-300 mb-1.5 uppercase tracking-wider">Pendientes de Entregas</p>
                              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{planilla.datos.pend}</p>
                            </div>
                          )}
                          {!planilla.datos.obs && !planilla.datos.pend && (
                            <p className="text-xs text-muted-foreground text-center py-6">Sin observaciones</p>
                          )}
                          <p className="text-[10px] text-muted-foreground/50 text-right pt-2 border-t border-border/30">
                            HORA DE ACTUALIZACIÓN: 08:00 HS
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
