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
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <input
          type="text"
          placeholder="Buscar por fecha..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-2 rounded-lg bg-card border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          onClick={fetchData}
          disabled={loading}
          className="p-2 rounded-lg bg-card border border-border hover:bg-card/80 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 text-accent animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No hay planillas guardadas
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(planilla => {
            const totals = computeTotals(planilla);
            const isExpanded = expandedId === planilla.id;
            return (
              <div key={planilla.id} className="border border-border rounded-lg bg-card overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : planilla.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-card/80 transition-colors"
                >
                  {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  <div className="flex-1 text-left">
                    <p className="font-medium text-foreground">{planilla.fecha}</p>
                    <p className="text-xs text-muted-foreground">
                      Total: {totals.totGeneral} | Terceros: {totals.totTerceros} | Taller: {totals.totTaller} | Disponibles: {totals.totDisp}
                    </p>
                  </div>
                  <span className="text-xs bg-accent/20 text-accent px-2 py-1 rounded">
                    {new Date(planilla.created_at).toLocaleDateString("es-AR")}
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-border px-4 py-4 bg-card/50 space-y-4 text-sm">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="font-medium text-foreground mb-2">NUEVOS Y REPARADOS POR TERCEROS</p>
                        <div className="space-y-1 text-xs text-muted-foreground">
                          {Object.entries(planilla.datos.terceros).map(([kva, row]) => {
                            const total = row.t + row.m;
                            if (total === 0) return null;
                            return <div key={kva}>{kva} KVA: T={row.t} M={row.m} CT={row.ct}</div>;
                          })}
                        </div>
                      </div>
                      <div>
                        <p className="font-medium text-foreground mb-2">REPARADOS POR TALLER</p>
                        <div className="space-y-1 text-xs text-muted-foreground">
                          {Object.entries(planilla.datos.taller).map(([kva, row]) => {
                            const total = row.t + row.m;
                            if (total === 0) return null;
                            return <div key={kva}>{kva} KVA {row.tipo}: T={row.t} M={row.m} CT={row.ct}</div>;
                          })}
                        </div>
                      </div>
                    </div>

                    {planilla.datos.obs && (
                      <div>
                        <p className="font-medium text-foreground mb-1">Observaciones</p>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{planilla.datos.obs}</p>
                      </div>
                    )}

                    {planilla.datos.pend && (
                      <div>
                        <p className="font-medium text-foreground mb-1">Pendientes</p>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{planilla.datos.pend}</p>
                      </div>
                    )}
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
