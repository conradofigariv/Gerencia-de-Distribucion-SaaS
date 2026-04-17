"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  Zap, CheckCircle2, Wrench, XCircle, RefreshCw, Loader2,
} from "lucide-react";

interface Transformador {
  id:         string;
  numero:     string;
  tipo:       string | null;
  potencia:   string | null;
  tension:    string | null;
  estado:     string | null;
  ubicacion:  string | null;
  imagen_url: string | null;
}

interface KpiCard {
  label:    string;
  value:    number;
  icon:     React.ElementType;
  color:    string;
  bgColor:  string;
}

const ESTADO_BADGE: Record<string, string> = {
  "Disponible":    "bg-green-500/15 text-green-400",
  "En servicio":   "bg-blue-500/15 text-blue-400",
  "En reparación": "bg-amber-500/15 text-amber-400",
  "Baja":          "bg-red-500/15 text-red-400",
};

export function TransformadoresResumenSection() {
  const [rows, setRows]       = useState<Transformador[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("transformadores").select("*");
    if (error) toast.error(error.message);
    else setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const total       = rows.length;
  const disponibles = rows.filter(r => r.estado === "Disponible").length;
  const enServicio  = rows.filter(r => r.estado === "En servicio").length;
  const reparacion  = rows.filter(r => r.estado === "En reparación").length;
  const baja        = rows.filter(r => r.estado === "Baja").length;

  const kpis: KpiCard[] = [
    { label: "Total registrados", value: total,       icon: Zap,         color: "text-accent",      bgColor: "bg-accent/10" },
    { label: "Disponibles",       value: disponibles, icon: CheckCircle2, color: "text-green-400",  bgColor: "bg-green-500/10" },
    { label: "En servicio",       value: enServicio,  icon: Zap,         color: "text-blue-400",   bgColor: "bg-blue-500/10" },
    { label: "En reparación",     value: reparacion,  icon: Wrench,      color: "text-amber-400",  bgColor: "bg-amber-500/10" },
    { label: "Bajas",             value: baja,        icon: XCircle,     color: "text-red-400",    bgColor: "bg-red-500/10" },
  ];

  // Group by tipo
  const byTipo = rows.reduce<Record<string, number>>((acc, r) => {
    const key = r.tipo ?? "Sin tipo";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  // Top 5 by ubicación count
  const byUbicacion = rows.reduce<Record<string, number>>((acc, r) => {
    const key = r.ubicacion ?? "Sin ubicación";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const topUbicaciones = Object.entries(byUbicacion).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Cargando datos…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Resumen del inventario de transformadores
        </p>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Actualizar
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {kpis.map(kpi => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col gap-2">
              <div className={`w-9 h-9 rounded-lg ${kpi.bgColor} flex items-center justify-center`}>
                <Icon className={`w-5 h-5 ${kpi.color}`} />
              </div>
              <p className="text-2xl font-bold text-foreground">{kpi.value}</p>
              <p className="text-xs text-muted-foreground leading-tight">{kpi.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* By tipo */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4">Distribución por tipo</h3>
          {Object.keys(byTipo).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(byTipo).sort((a, b) => b[1] - a[1]).map(([tipo, count]) => (
                <div key={tipo}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-foreground truncate">{tipo}</span>
                    <span className="text-muted-foreground ml-4 shrink-0">{count}</span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-500"
                      style={{ width: `${(count / total) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* By ubicación */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4">Top ubicaciones</h3>
          {topUbicaciones.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos</p>
          ) : (
            <div className="space-y-3">
              {topUbicaciones.map(([ubic, count]) => (
                <div key={ubic}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-foreground truncate">{ubic}</span>
                    <span className="text-muted-foreground ml-4 shrink-0">{count}</span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-chart-1 rounded-full transition-all duration-500"
                      style={{ width: `${(count / total) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Estado breakdown table */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground mb-4">Últimos registros</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay transformadores registrados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="pb-2 text-left font-medium">Número</th>
                  <th className="pb-2 text-left font-medium">Tipo</th>
                  <th className="pb-2 text-left font-medium">Potencia</th>
                  <th className="pb-2 text-left font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map(r => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="py-2 font-mono font-semibold text-foreground">{r.numero}</td>
                    <td className="py-2 text-muted-foreground">{r.tipo ?? "—"}</td>
                    <td className="py-2 text-muted-foreground">{r.potencia ? `${r.potencia} kVA` : "—"}</td>
                    <td className="py-2">
                      {r.estado ? (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_BADGE[r.estado] ?? "bg-secondary text-muted-foreground"}`}>
                          {r.estado}
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
