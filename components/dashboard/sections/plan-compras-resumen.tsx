"use client";

import { LayoutGrid, Construction } from "lucide-react";
import { PlanComprasPlaceholder } from "./plan-compras-placeholder";

/**
 * Plan de Compras — Resumen.
 *
 * Placeholder: los KPIs y gráficos se arman sobre los mismos datos que carga
 * la pantalla de Carga, una vez definido el modelo.
 */
export function PlanComprasResumenSection() {
  return (
    <PlanComprasPlaceholder
      icon={LayoutGrid}
      titulo="Plan de Compras — Resumen"
      descripcion="Acá van los KPIs del plan (total del período, incidencia por artículo, desvío de precio), los filtros por sector / familia / unidad y la exportación a Excel."
      pendiente={[
        "Total del período y % de incidencia por artículo",
        "Agrupado por «A cargo de» y por familia",
        "Alertas de Verif. Precio fuera de umbral",
        "Exportación a .xlsx / CSV",
      ]}
      marca={Construction}
    />
  );
}
