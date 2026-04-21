"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
<<<<<<< HEAD
import { Loader2, RefreshCw, Search, ChevronDown, ChevronUp } from "lucide-react";
=======
import { Loader2, RefreshCw, Search, ChevronDown } from "lucide-react";
>>>>>>> claude/analyze-project-structure-epz20

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
<<<<<<< HEAD
=======
  const [expandedSections, setExpandedSections] = useState({
    nuevos: true,
    reparados: true,
    totales: true,
    relacion: true,
    notas: true,
  });
>>>>>>> claude/analyze-project-structure-epz20

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

<<<<<<< HEAD
  const filtered = rows.filter(r => r.fecha.includes(search));

  return (
    <div className="space-y-4">
=======
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
>>>>>>> claude/analyze-project-structure-epz20
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

<<<<<<< HEAD
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
=======
      {filtered.map((planilla) => {
        const totals = computeTotals(planilla);
        const isExpanded = expandedId === planilla.id;

        return (
          <div key={planilla.id} className="space-y-4">
            {/* Planilla Header */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : planilla.id)}
              className="w-full bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow text-left"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Informe de Reservas — {planilla.fecha}</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    <span className="font-semibold text-accent">{totals.totGeneral}</span> total
                    {" | "}
                    <span className="font-semibold text-green-600">{totals.totDisp}</span> disponibles
                    {" | "}
                    <span className="font-semibold text-blue-600">{totals.totTerceros}</span> terceros
                    {" | "}
                    <span className="font-semibold text-amber-600">{totals.totTaller}</span> taller
                  </p>
                </div>
                <ChevronDown className={`w-6 h-6 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </div>
            </button>

            {isExpanded && (
              <>
                {/* Reporte Header */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <h1 className="text-2xl font-bold text-slate-800">Reporte de Transformadores</h1>
                  <p className="text-sm text-slate-500 mt-1">Actualización: 08:00 HRS</p>
                </div>

                {/* Top 3 Panels */}
                <div className="grid grid-cols-3 gap-6">

                  {/* Nuevos y Reparados por Terceros */}
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => toggleSection("nuevos")}
                      className="w-full bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between hover:from-blue-700 hover:to-blue-800 transition-all"
                    >
                      <h2 className="text-sm font-semibold text-white uppercase tracking-wide">
                        Nuevos y Reparados por Terceros
                      </h2>
                      <svg
                        className={`w-5 h-5 text-white transition-transform ${expandedSections.nuevos ? "rotate-180" : ""}`}
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
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700">POTENCIA kVA</th>
                              <th className="px-3 py-3 text-center text-xs font-semibold text-slate-700">T</th>
                              <th className="px-3 py-3 text-center text-xs font-semibold text-slate-700">M</th>
                              <th className="px-3 py-3 text-center text-xs font-semibold text-slate-700">Con tanque</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700">TOTAL</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700">TIPO DE USO</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {KVA_ROWS.map((kva) => {
                              const r = planilla.datos.terceros[String(kva)] ?? { t: 0, m: 0, ct: 0 };
                              const tot = r.t + r.m;
                              return (
                                <tr key={kva} className="hover:bg-blue-50/50 transition-colors">
                                  <td className="px-4 py-2.5 text-sm font-medium text-center text-slate-900">{kva}</td>
                                  <td className="px-3 py-2.5 text-sm text-center text-slate-700">{r.t || ""}</td>
                                  <td className="px-3 py-2.5 text-sm text-center text-slate-700">{r.m || ""}</td>
                                  <td className="px-3 py-2.5 text-sm text-center text-slate-700">{r.ct || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center font-semibold text-blue-700">{tot || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-600">{r.tipo ?? ""}</td>
>>>>>>> claude/analyze-project-structure-epz20
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
<<<<<<< HEAD

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
=======
                    )}
                  </div>

                  {/* Reparados por Taller */}
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => toggleSection("reparados")}
                      className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-4 flex items-center justify-between hover:from-emerald-700 hover:to-emerald-800 transition-all"
                    >
                      <h2 className="text-sm font-semibold text-white uppercase tracking-wide">
                        Reparados por Taller de Transformadores
                      </h2>
                      <svg
                        className={`w-5 h-5 text-white transition-transform ${expandedSections.reparados ? "rotate-180" : ""}`}
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
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700">POTENCIA kVA</th>
                              <th className="px-3 py-3 text-center text-xs font-semibold text-slate-700">T</th>
                              <th className="px-3 py-3 text-center text-xs font-semibold text-slate-700">M</th>
                              <th className="px-3 py-3 text-center text-xs font-semibold text-slate-700">Con tanque</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700">TOTAL</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700">TIPO DE USO</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {KVA_ROWS.map((kva) => {
                              const r = planilla.datos.taller[String(kva)] ?? { t: 0, m: 0, ct: 0 };
                              const tot = r.t + r.m;
                              return (
                                <tr key={kva} className="hover:bg-emerald-50/50 transition-colors">
                                  <td className="px-4 py-2.5 text-sm font-medium text-center text-slate-900">{kva}</td>
                                  <td className="px-3 py-2.5 text-sm text-center text-slate-700">{r.t || ""}</td>
                                  <td className="px-3 py-2.5 text-sm text-center text-slate-700">{r.m || ""}</td>
                                  <td className="px-3 py-2.5 text-sm text-center text-slate-700">{r.ct || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center font-semibold text-emerald-700">{tot || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-600">{r.tipo ?? ""}</td>
>>>>>>> claude/analyze-project-structure-epz20
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
<<<<<<< HEAD

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
=======
                    )}
                  </div>

                  {/* Total de Transformadores */}
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => toggleSection("totales")}
                      className="w-full bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-4 flex items-center justify-between hover:from-purple-700 hover:to-purple-800 transition-all"
                    >
                      <h2 className="text-sm font-semibold text-white uppercase tracking-wide">
                        Total de Transformadores
                      </h2>
                      <svg
                        className={`w-5 h-5 text-white transition-transform ${expandedSections.totales ? "rotate-180" : ""}`}
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
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700">TOTAL</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 bg-yellow-50">Autorizados Pend. Retiro</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700">Disponible Retiro</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {KVA_ROWS.map((kva) => {
                              const terc = planilla.datos.terceros[String(kva)] ?? { t: 0, m: 0, ct: 0 };
                              const tall = planilla.datos.taller[String(kva)] ?? { t: 0, m: 0, ct: 0 };
                              const total = terc.t + terc.m + tall.t + tall.m;
                              const auto = planilla.datos.autorizados[String(kva)] ?? 0;
                              const disp = total - auto;
                              return (
                                <tr key={kva} className="hover:bg-purple-50/50 transition-colors">
                                  <td className="px-4 py-2.5 text-sm text-center font-semibold text-purple-700">{total || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center font-semibold text-yellow-700 bg-yellow-50/50">{auto || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-700">{disp || ""}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                            <tr>
                              <td className="px-4 py-3 text-sm font-bold text-slate-900 text-center">{totals.totGeneral}</td>
                              <td className="px-4 py-3 text-sm font-bold text-slate-900 text-center bg-yellow-50">{totals.totAuto || ""}</td>
                              <td className="px-4 py-3 text-sm font-bold text-slate-900 text-center">{totals.totDisp}</td>
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
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => toggleSection("relacion")}
                      className="w-full bg-gradient-to-r from-amber-600 to-amber-700 px-6 py-4 flex items-center justify-between hover:from-amber-700 hover:to-amber-800 transition-all"
                    >
                      <h2 className="text-sm font-semibold text-white uppercase tracking-wide">
                        Relación: 33/0.4 KV
                      </h2>
                      <svg
                        className={`w-5 h-5 text-white transition-transform ${expandedSections.relacion ? "rotate-180" : ""}`}
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
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700">POTENCIA</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700" colSpan={2}>TRAFOS NUEVOS</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700" colSpan={2}>TRAFOS REPARADOS</th>
                            </tr>
                            <tr className="bg-slate-50 border-b border-slate-200">
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700"></th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700">T</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700">M</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700">T</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700">M</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {REL33_ROWS.map((kva) => {
                              const r = planilla.datos.rel33[String(kva)] ?? { tN: 0, mN: 0, tR: 0, mR: 0 };
                              return (
                                <tr key={kva} className="hover:bg-amber-50/50 transition-colors">
                                  <td className="px-4 py-2.5 text-sm font-medium text-center text-slate-900">{kva}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-700">{r.tN || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-700">{r.mN || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-700">{r.tR || ""}</td>
                                  <td className="px-4 py-2.5 text-sm text-center text-slate-700">{r.mR || ""}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                            <tr>
                              <td className="px-4 py-3 text-sm font-bold text-slate-900 text-center">TOTAL</td>
                              <td className="px-4 py-3 text-sm font-bold text-slate-900 text-center">
                                {Object.values(planilla.datos.rel33).reduce((s, r) => s + (r.tN || 0), 0) || ""}
                              </td>
                              <td className="px-4 py-3 text-sm font-bold text-slate-900 text-center">
                                {Object.values(planilla.datos.rel33).reduce((s, r) => s + (r.mN || 0), 0) || ""}
                              </td>
                              <td className="px-4 py-3 text-sm font-bold text-slate-900 text-center">
                                {Object.values(planilla.datos.rel33).reduce((s, r) => s + (r.tR || 0), 0) || ""}
                              </td>
                              <td className="px-4 py-3 text-sm font-bold text-slate-900 text-center">
                                {Object.values(planilla.datos.rel33).reduce((s, r) => s + (r.mR || 0), 0) || ""}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Observaciones */}
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => toggleSection("notas")}
                      className="w-full bg-gradient-to-r from-slate-600 to-slate-700 px-6 py-4 flex items-center justify-between hover:from-slate-700 hover:to-slate-800 transition-all"
                    >
                      <h2 className="text-sm font-semibold text-white uppercase tracking-wide">
                        Observaciones
                      </h2>
                      <svg
                        className={`w-5 h-5 text-white transition-transform ${expandedSections.notas ? "rotate-180" : ""}`}
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
                          <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r">
                            <h3 className="text-sm font-semibold text-blue-900 mb-2">OBSERVACIONES:</h3>
                            <p className="text-xs text-blue-800 whitespace-pre-wrap">{planilla.datos.obs}</p>
                          </div>
                        )}
                        {planilla.datos.pend && (
                          <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded-r">
                            <h3 className="text-sm font-semibold text-green-900 mb-2">PENDIENTES DE ENTREGAS:</h3>
                            <p className="text-xs text-green-800 whitespace-pre-wrap">{planilla.datos.pend}</p>
                          </div>
                        )}
                        {!planilla.datos.obs && !planilla.datos.pend && (
                          <p className="text-sm text-slate-500 text-center py-4">Sin observaciones ni pendientes</p>
                        )}
                        <div className="bg-slate-100 rounded-lg p-4 text-center">
                          <p className="text-xs text-slate-600 font-medium">PLANILLA REALIZADA POR:</p>
                          <p className="text-xs text-slate-500 mt-1">HORA DE ACTUALIZACIÓN: 08:00 HRS</p>
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
>>>>>>> claude/analyze-project-structure-epz20
    </div>
  );
}
