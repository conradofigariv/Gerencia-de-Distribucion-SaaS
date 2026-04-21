"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Loader2, TrendingUp, Package, Zap } from "lucide-react";
import { toast } from "sonner";

interface StockSummary {
  totalNuevos: number;
  totalReparados: number;
  totalDisponible: number;
  totalReservado: number;
}

export function TransformadoresResumenSection() {
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const { data, error } = await supabase
          .from("planillas_reserva")
          .select("*")
          .order("fecha", { ascending: false })
          .limit(1);

        if (error) {
          toast.error(error.message);
          return;
        }

        if (data && data.length > 0) {
          const latest = data[0];
          const datos = latest.datos || {};

          const terceros = datos.terceros || {};
          const taller = datos.taller || {};

          const totalNuevos = Object.values(terceros as any).reduce((s: number, r: any) => s + (r.t || 0), 0);
          const totalReparados = Object.values(taller as any).reduce((s: number, r: any) => s + (r.m || 0), 0);

          setSummary({
            totalNuevos,
            totalReparados,
            totalDisponible: totalNuevos + totalReparados,
            totalReservado: 0,
          });
        }
      } catch (err) {
        console.error(err);
        toast.error("Error al cargar datos");
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 text-accent animate-spin" />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="text-center py-12 text-muted-foreground bg-card/30 rounded-lg">
        No hay datos disponibles
      </div>
    );
  }

  const stats = [
    {
      label: "Transformadores Nuevos",
      value: summary.totalNuevos,
      icon: Zap,
      color: "from-blue-600 to-blue-700",
    },
    {
      label: "Transformadores Reparados",
      value: summary.totalReparados,
      icon: Package,
      color: "from-emerald-600 to-emerald-700",
    },
    {
      label: "Stock Disponible",
      value: summary.totalDisponible,
      icon: TrendingUp,
      color: "from-purple-600 to-purple-700",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className={`bg-gradient-to-r ${stat.color} rounded-lg p-6 text-white`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium opacity-90">{stat.label}</p>
                  <p className="text-4xl font-bold mt-2">{stat.value}</p>
                </div>
                <Icon className="w-12 h-12 opacity-20" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
