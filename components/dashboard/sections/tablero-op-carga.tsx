"use client";

import { UploadCloud } from "lucide-react";

export function TableroOpCargaSection() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <UploadCloud className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Tablero OP — Carga de datos</h2>
          <p className="text-sm text-muted-foreground">
            Carga de datos para el Tablero OP.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
        Sección en construcción.
      </div>
    </div>
  );
}
