"use client";

import { GitMerge } from "lucide-react";

export function SicDiagramaSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Diagrama de flujo</h2>
        <p className="text-sm text-muted-foreground mt-1">Proceso SIC - SIGA</p>
      </div>

      <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center">
          <GitMerge className="w-7 h-7 text-accent" />
        </div>
        <p className="text-sm text-muted-foreground">El diagrama de flujo se mostrará aquí</p>
      </div>
    </div>
  );
}
