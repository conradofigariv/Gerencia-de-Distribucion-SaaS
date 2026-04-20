"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { Loader2, RefreshCw, Search, ChevronDown, ChevronUp } from "lucide-react";

interface PlanillaRow {
  id: number;
  fecha: string;
  datos: {
    terceros: Record<string, { t: number; m: number; ct: number }>;
    taller: Record<string, { t: number; m: number; ct: number }>;
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

  const computeTotals = (planilla: PlanillaRow) => {
    const { terceros, taller, autorizados } = planilla.datos;
    const totTerceros = Object.values(terceros).reduce((s, r) => s + r.t + r.m, 0);
    const totTaller = Object.values(taller).reduce((s, r) => s + r.t + r.m, 0);
    const totGeneral = totTerceros + totTaller;
    const totAuto = Object.values(autorizados).reduce((s, v) => s + v, 0);
    const totDisp = totGeneral - totAuto;
    return { totGeneral, totTerceros, totTaller, totAuto, totDisp };
  };

  const filtered = rows.filter(r => r.fecha.includes(search));

  return (
    <div className="space-y-6">
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
          <p>No hay planillas guardadas</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(planilla => {
            const totals = computeTotals(planilla);
            const isExpanded = expandedId === planilla.id;
            return (
              <div key={planilla.id} className="border border-border rounded-xl bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : planilla.id)}
                  className="w-full px-6 py-4 flex items-center gap-4 hover:bg-card/80 transition-colors group"
                >
                  {isExpanded ? <ChevronUp className="w-5 h-5 text-accent flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-muted-foreground group-hover:text-accent flex-shrink-0 transition-colors" />}
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-lg text-foreground">{planilla.fecha}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      <span className="text-accent font-medium">{totals.totGeneral}</span> transformadores total
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
                  <div className="border-t border-border px-6 py-6 bg-background/50 space-y-8">
                    {/* TERCEROS TABLE */}
                    <div>
                      <h3 className="text-sm font-bold text-foreground mb-4 uppercase tracking-wide">Nuevos y Reparados por Terceros</h3>
                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-accent/10 border-b border-border">
                              <th className="px-4 py-3 text-left font-semibold text-foreground">KVA</th>
                              <th className="px-4 py-3 text-center font-semibold text-blue-400">T</th>
                              <th className="px-4 py-3 text-center font-semibold text-purple-400">M</th>
                              <th className="px-4 py-3 text-center font-semibold text-amber-400">CON TANQUE</th>
                              <th className="px-4 py-3 text-center font-semibold text-accent">TOTAL</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {[5, 10, 16, 25, 50, 63, 80, 100, 125, 160, 200, 250, 315, 500, 630, 800, 1000].map((kva, idx) => {
                              const row = planilla.datos.terceros[String(kva)] || { t: 0, m: 0, ct: 0 };
                              const total = row.t + row.m;
                              return (
                                <tr key={kva} className={idx % 2 === 0 ? "bg-card/30" : ""}>
                                  <td className="px-4 py-2 font-medium text-foreground">{kva}</td>
                                  <td className="px-4 py-2 text-center text-blue-400">{row.t || "—"}</td>
                                  <td className="px-4 py-2 text-center text-purple-400">{row.m || "—"}</td>
                                  <td className="px-4 py-2 text-center text-amber-400">{row.ct || "—"}</td>
                                  <td className="px-4 py-2 text-center font-semibold text-accent">{total || "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* TALLER TABLE */}
                    <div>
                      <h3 className="text-sm font-bold text-foreground mb-4 uppercase tracking-wide">Reparados por Taller de Transformadores</h3>
                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-accent/10 border-b border-border">
                              <th className="px-4 py-3 text-left font-semibold text-foreground">KVA</th>
                              <th className="px-4 py-3 text-center font-semibold text-foreground">TIPO</th>
                              <th className="px-4 py-3 text-center font-semibold text-blue-400">T</th>
                              <th className="px-4 py-3 text-center font-semibold text-purple-400">M</th>
                              <th className="px-4 py-3 text-center font-semibold text-amber-400">CON TANQUE</th>
                              <th className="px-4 py-3 text-center font-semibold text-accent">TOTAL</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {[5, 10, 16, 25, 50, 63, 80, 100, 125, 160, 200, 250, 315, 500, 630, 800, 1000].map((kva, idx) => {
                              const row = planilla.datos.taller[String(kva)] || { tipo: "", t: 0, m: 0, ct: 0 };
                              const total = row.t + row.m;
                              return (
                                <tr key={kva} className={idx % 2 === 0 ? "bg-card/30" : ""}>
                                  <td className="px-4 py-2 font-medium text-foreground">{kva}</td>
                                  <td className="px-4 py-2 text-center text-xs text-muted-foreground">{row.tipo || "—"}</td>
                                  <td className="px-4 py-2 text-center text-blue-400">{row.t || "—"}</td>
                                  <td className="px-4 py-2 text-center text-purple-400">{row.m || "—"}</td>
                                  <td className="px-4 py-2 text-center text-amber-400">{row.ct || "—"}</td>
                                  <td className="px-4 py-2 text-center font-semibold text-accent">{total || "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* REL33 TABLE */}
                    <div>
                      <h3 className="text-sm font-bold text-foreground mb-4 uppercase tracking-wide">Relación 33/0,4 KV</h3>
                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-accent/10 border-b border-border">
                              <th className="px-4 py-3 text-left font-semibold text-foreground" rowSpan={2}>KVA</th>
                              <th className="px-4 py-3 text-center font-semibold text-green-400" colSpan={2}>TRAFOS NUEVOS</th>
                              <th className="px-4 py-3 text-center font-semibold text-orange-400" colSpan={2}>TRAFOS REPARADOS</th>
                            </tr>
                            <tr className="bg-accent/5 border-b border-border">
                              <th className="px-4 py-2 text-center font-semibold text-blue-400">T</th>
                              <th className="px-4 py-2 text-center font-semibold text-purple-400">M</th>
                              <th className="px-4 py-2 text-center font-semibold text-blue-400">T</th>
                              <th className="px-4 py-2 text-center font-semibold text-purple-400">M</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {[25, 63, 160, 315, 500, 630].map((kva, idx) => {
                              const row = planilla.datos.rel33[String(kva)] || { tN: 0, mN: 0, tR: 0, mR: 0 };
                              return (
                                <tr key={kva} className={idx % 2 === 0 ? "bg-card/30" : ""}>
                                  <td className="px-4 py-2 font-medium text-foreground">{kva}</td>
                                  <td className="px-4 py-2 text-center text-blue-400">{row.tN || "—"}</td>
                                  <td className="px-4 py-2 text-center text-purple-400">{row.mN || "—"}</td>
                                  <td className="px-4 py-2 text-center text-blue-400">{row.tR || "—"}</td>
                                  <td className="px-4 py-2 text-center text-purple-400">{row.mR || "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* OBS & PEND */}
                    <div className="grid grid-cols-2 gap-6">
                      {planilla.datos.obs && (
                        <div className="p-4 bg-card/50 rounded-lg border border-border">
                          <h4 className="text-xs font-bold text-foreground mb-3 uppercase tracking-wide">Observaciones</h4>
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{planilla.datos.obs}</p>
                        </div>
                      )}
                      {planilla.datos.pend && (
                        <div className="p-4 bg-card/50 rounded-lg border border-border">
                          <h4 className="text-xs font-bold text-foreground mb-3 uppercase tracking-wide">Pendientes</h4>
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{planilla.datos.pend}</p>
                        </div>
                      )}
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
