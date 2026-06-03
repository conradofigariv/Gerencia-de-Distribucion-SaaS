"use client";

import { Gauge, BarChart3, Construction } from "lucide-react";

export function IndiceIdoResumenSection() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Gauge className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Índice IDO — Resumen</h2>
          <p className="text-sm text-muted-foreground">
            Visualización y análisis del Índice IDO a partir de los datos cargados.
          </p>
        </div>
      </div>

      {/* Placeholder de contenido — se completará al definir el origen de datos */}
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-12 flex flex-col items-center justify-center text-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-secondary/60 flex items-center justify-center">
          <BarChart3 className="w-7 h-7 text-muted-foreground" />
        </div>
        <div className="space-y-1 max-w-md">
          <h3 className="text-base font-medium text-foreground">Resumen aún sin datos</h3>
          <p className="text-sm text-muted-foreground">
            Cargá información desde la sección <span className="text-accent font-medium">Carga de datos</span> para
            comenzar a ver el resumen del Índice IDO. El diseño de KPIs y gráficos se definirá una vez
            disponible el formato de las planillas.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground bg-secondary/40 border border-border rounded-full px-3 py-1.5">
          <Construction className="w-3.5 h-3.5" />
          En construcción
        </div>
      </div>
    </div>
  );
}
