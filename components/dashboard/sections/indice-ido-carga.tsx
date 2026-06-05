"use client";

import { UploadCloud, FileSpreadsheet, Construction } from "lucide-react";

export function IndiceIdoCargaSection() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <UploadCloud className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Índice IDO — Carga de datos</h2>
          <p className="text-sm text-muted-foreground">
            Subí la información de planillas y Excels provenientes de otro sistema.
          </p>
        </div>
      </div>

      {/* Placeholder de carga — se completará al definir el formato de las planillas */}
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-12 flex flex-col items-center justify-center text-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-secondary/60 flex items-center justify-center">
          <FileSpreadsheet className="w-7 h-7 text-muted-foreground" />
        </div>
        <div className="space-y-1 max-w-md">
          <h3 className="text-base font-medium text-foreground">Carga de datos pendiente de configuración</h3>
          <p className="text-sm text-muted-foreground">
            Acá se cargarán las planillas y Excels del otro sistema. El parser, las columnas y el
            destino en Supabase se implementarán cuando se defina el formato de los datos.
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
