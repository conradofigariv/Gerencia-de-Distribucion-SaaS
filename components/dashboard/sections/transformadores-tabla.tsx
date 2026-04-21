"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { Loader2, RefreshCw, Search, ChevronDown } from "lucide-react";

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
  const [expandedSections, setExpandedSections] = useState({
    nuevos: true,
    reparados: true,
    totales: true,
    relacion: true,
    notas: true,
  });

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

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const filtered = rows.filter(r => r.fecha.includes(search));

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 text-accent animate-spin" />
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground bg-card/30 rounded-lg">
        No hay planillas guardadas
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search Bar */}
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

      {filtered.map((planilla) => {
        const totals = computeTotals(planilla);
        const isExpanded = expandedId === planilla.id;

        return (
          <div key={planilla.id} className="space-y-4">
            {/* Planilla Header */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : planilla.id)}
              className="w-full bg-slate-800/40 rounded-xl shadow-sm border border-slate-700 p-6 hover:bg-slate-800/60 transition-colors text-left"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-foreground">Informe de Reservas — {planilla.fecha}</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    <span className="font-semibold text-blue-400">{totals.totGeneral}</span> total
                    {" | "}
                    <span className="font-semibold text-green-400">{totals.totDisp}</span> disponibles
                    {" | "}
                    <span className="font-semibold text-cyan-400">{totals.totTerceros}</span> terceros
                    {" | "}
                    <span className="font-semibold text-amber-400">{totals.totTaller}</span> taller
                  </p>
                </div>
                <ChevronDown className={`w-6 h-6 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </div>
            </button>

            {isExpanded && (
              <>
                {/* Reporte Header */}
                <div className="bg-slate-800/30 rounded-xl shadow-sm border border-slate-700 p-6">
                  <h1 className="text-2xl font-bold text-foreground">Reporte de Transformadores</h1>
                  <p className="text-sm text-muted-foreground mt-1">Actualización: 08:00 HRS</p>
                </div>

                {/* Top 3 Panels */}
                <div className="grid grid-cols-3 gap-6">

                  {/* Nuevos y Reparados por Terceros */}
                  <div className="bg-slate-800/30 rounded-xl shadow-sm border border-slate-700 overflow-hidden">
                    <button
                      onClick={() => toggleSection("nuevos")}
                      className="w-full bg-gradient-to-r from-blue-600/20 to-blue-700/20 border-b border-slate-700 px-6 py-4 flex items-center justify-between hover:from-blue-600/30 hover:to-blue-700/30 transition-all"
                    >
                      <h2 className="text-sm font-semibold text-blue-300 uppercase tracking-wide">
                        Nuevos y Reparados por Terceros
                      </h2>
                      <svg
                        className={`w-5 h-5 text-blue-400 transition-transform ${expandedSections.nuevos ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {expandedSections.nuevos && (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-slate-700/50 border-b border-slate-700">
                            <tr>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">POTENCIA KVA</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">T</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">M</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">Con tanque</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">TOTAL</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">TIPO DE USO</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-700/50">
                            {KVA_ROWS.map((kva) => {
                              const r = planilla.datos.terceros[String(kva)] ?? { t: 0, m: 0, ct: 0 };
                              const tot = r.t + r.m;
                              return (
                                <tr key={kva} className="hover:bg-blue-600/10 transition-colors">
                                  <td className="px-4 py-2.5 text-sm font-medium text-center text-foreground">{kva}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-300">{r.t || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-300">{r.m || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-300">{r.ct || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center font-semibold text-blue-400">{tot || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-400">{r.tipo ?? ""}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Reparados por Taller */}
                  <div className="bg-slate-800/30 rounded-xl shadow-sm border border-slate-700 overflow-hidden">
                    <button
                      onClick={() => toggleSection("reparados")}
                      className="w-full bg-gradient-to-r from-emerald-600/20 to-emerald-700/20 border-b border-slate-700 px-6 py-4 flex items-center justify-between hover:from-emerald-600/30 hover:to-emerald-700/30 transition-all"
                    >
                      <h2 className="text-sm font-semibold text-emerald-300 uppercase tracking-wide">
                        Reparados por Taller de Transformadores
                      </h2>
                      <svg
                        className={`w-5 h-5 text-emerald-400 transition-transform ${expandedSections.reparados ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {expandedSections.reparados && (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-slate-700/50 border-b border-slate-700">
                            <tr>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">POTENCIA KVA</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">T</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">M</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">Con tanque</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">TOTAL</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">TIPO DE USO</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-700/50">
                            {KVA_ROWS.map((kva) => {
                              const r = planilla.datos.taller[String(kva)] ?? { t: 0, m: 0, ct: 0 };
                              const tot = r.t + r.m;
                              return (
                                <tr key={kva} className="hover:bg-emerald-600/10 transition-colors">
                                  <td className="px-4 py-2.5 text-sm font-medium text-center text-foreground">{kva}</td>
                                  <td className="px-3 py-2.5 text-sm text-center text-slate-300">{r.t || ""}</td>
                                  <td className="px-3 py-2.5 text-sm text-center text-slate-300">{r.m || ""}</td>
                                  <td className="px-3 py-2.5 text-sm text-center text-slate-300">{r.ct || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center font-semibold text-emerald-400">{tot || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-400">{r.tipo ?? ""}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Total de Transformadores */}
                  <div className="bg-slate-800/30 rounded-xl shadow-sm border border-slate-700 overflow-hidden">
                    <button
                      onClick={() => toggleSection("totales")}
                      className="w-full bg-gradient-to-r from-purple-600/20 to-purple-700/20 border-b border-slate-700 px-6 py-4 flex items-center justify-between hover:from-purple-600/30 hover:to-purple-700/30 transition-all"
                    >
                      <h2 className="text-sm font-semibold text-purple-300 uppercase tracking-wide">
                        Total de Transformadores
                      </h2>
                      <svg
                        className={`w-5 h-5 text-purple-400 transition-transform ${expandedSections.totales ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {expandedSections.totales && (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-slate-700/50 border-b border-slate-700">
                            <tr>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">POTENCIA KVA</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">TOTAL DE TRANSFORMADORES</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">Autorizados Pendiente de Retiro</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">Disponibles para Retiro</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-700/50">
                            {KVA_ROWS.map((kva) => {
                              const terc = planilla.datos.terceros[String(kva)] ?? { t: 0, m: 0, ct: 0 };
                              const tall = planilla.datos.taller[String(kva)] ?? { t: 0, m: 0, ct: 0 };
                              const total = terc.t + terc.m + tall.t + tall.m;
                              const auto = planilla.datos.autorizados[String(kva)] ?? 0;
                              const disp = total - auto;
                              return (
                                <tr key={kva} className="hover:bg-purple-600/10 transition-colors">
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-300">{kva}</td>
                                  <td className="px-4 py-2.5 text-sm text-center font-semibold text-purple-400">{total || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center font-semibold text-amber-400">{auto || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-300">{disp || ""}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="bg-slate-700/50 border-t-2 border-slate-700">
                            <tr>
                              <td className="px-4 py-3 text-sm font-bold text-slate-300 text-center">TOTAL</td>
                              <td className="px-4 py-3 text-sm font-bold text-purple-300 text-center">{totals.totGeneral}</td>
                              <td className="px-4 py-3 text-sm font-bold text-amber-300 text-center">Tot. Disp.</td>
                              <td className="px-4 py-3 text-sm font-bold text-slate-300 text-center">{totals.totDisp}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom 2 Panels */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                  {/* Relación: 33/0.4 KV */}
                  <div className="bg-slate-800/30 rounded-xl shadow-sm border border-slate-700 overflow-hidden">
                    <button
                      onClick={() => toggleSection("relacion")}
                      className="w-full bg-gradient-to-r from-amber-600/20 to-amber-700/20 border-b border-slate-700 px-6 py-4 flex items-center justify-between hover:from-amber-600/30 hover:to-amber-700/30 transition-all"
                    >
                      <h2 className="text-sm font-semibold text-amber-300 uppercase tracking-wide">
                        Relación: 33/0.4 KV
                      </h2>
                      <svg
                        className={`w-5 h-5 text-amber-400 transition-transform ${expandedSections.relacion ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {expandedSections.relacion && (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-slate-700/50 border-b border-slate-700">
                            <tr>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">POTENCIA</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300" colSpan={2}>TRAFOS NUEVOS</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300" colSpan={2}>TRAFOS REPARADOS</th>
                            </tr>
                            <tr className="bg-slate-700/50 border-b border-slate-700">
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300"></th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">T</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">M</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">T</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300">M</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-700/50">
                            {REL33_ROWS.map((kva) => {
                              const r = planilla.datos.rel33[String(kva)] ?? { tN: 0, mN: 0, tR: 0, mR: 0 };
                              return (
                                <tr key={kva} className="hover:bg-amber-600/10 transition-colors">
                                  <td className="px-4 py-2.5 text-sm font-medium text-center text-foreground">{kva}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-300">{r.tN || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-300">{r.mN || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-300">{r.tR || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-300">{r.mR || ""}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="bg-slate-700/50 border-t-2 border-slate-700">
                            <tr>
                              <td className="px-4 py-3 text-sm font-bold text-amber-300 text-center">TOTAL</td>
                              <td className="px-4 py-3 text-sm font-bold text-amber-300 text-center">
                                {Object.values(planilla.datos.rel33).reduce((s, r) => s + (r.tN || 0), 0) || ""}
                              </td>
                              <td className="px-4 py-3 text-sm font-bold text-amber-300 text-center">
                                {Object.values(planilla.datos.rel33).reduce((s, r) => s + (r.mN || 0), 0) || ""}
                              </td>
                              <td className="px-4 py-3 text-sm font-bold text-amber-300 text-center">
                                {Object.values(planilla.datos.rel33).reduce((s, r) => s + (r.tR || 0), 0) || ""}
                              </td>
                              <td className="px-4 py-3 text-sm font-bold text-amber-300 text-center">
                                {Object.values(planilla.datos.rel33).reduce((s, r) => s + (r.mR || 0), 0) || ""}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Observaciones */}
                  <div className="bg-slate-800/30 rounded-xl shadow-sm border border-slate-700 overflow-hidden">
                    <button
                      onClick={() => toggleSection("notas")}
                      className="w-full bg-gradient-to-r from-slate-700/30 to-slate-800/30 border-b border-slate-700 px-6 py-4 flex items-center justify-between hover:from-slate-700/50 hover:to-slate-800/50 transition-all"
                    >
                      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
                        Observaciones
                      </h2>
                      <svg
                        className={`w-5 h-5 text-slate-400 transition-transform ${expandedSections.notas ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {expandedSections.notas && (
                      <div className="p-6 space-y-4">
                        {planilla.datos.obs && (
                          <div className="bg-blue-600/20 border-l-4 border-blue-400 p-4 rounded-r">
                            <h3 className="text-sm font-semibold text-blue-300 mb-2">OBSERVACIONES:</h3>
                            <p className="text-xs text-blue-200 whitespace-pre-wrap">{planilla.datos.obs}</p>
                          </div>
                        )}
                        {planilla.datos.pend && (
                          <div className="bg-green-600/20 border-l-4 border-green-400 p-4 rounded-r">
                            <h3 className="text-sm font-semibold text-green-300 mb-2">PENDIENTES DE ENTREGAS:</h3>
                            <p className="text-xs text-green-200 whitespace-pre-wrap">{planilla.datos.pend}</p>
                          </div>
                        )}
                        {!planilla.datos.obs && !planilla.datos.pend && (
                          <p className="text-sm text-muted-foreground text-center py-4">Sin observaciones ni pendientes</p>
                        )}
                        <div className="bg-slate-700/50 rounded-lg p-4 text-center">
                          <p className="text-xs text-slate-300 font-medium">PLANILLA REALIZADA POR:</p>
                          <p className="text-xs text-slate-400 mt-1">HORA DE ACTUALIZACIÓN: 08:00 HRS</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
