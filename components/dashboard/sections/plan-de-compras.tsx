"use client";

import { ShoppingCart } from "lucide-react";

export function PlanDeComprasSection() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-hairline bg-panel py-24 text-center">
      <ShoppingCart className="w-10 h-10 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium text-foreground">Plan de Compras</p>
        <p className="text-xs text-muted-foreground mt-1">Esta sección todavía no tiene contenido.</p>
      </div>
    </div>
  );
}
