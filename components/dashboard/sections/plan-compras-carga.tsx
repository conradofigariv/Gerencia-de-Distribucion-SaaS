"use client";

import { ShoppingCart, Construction } from "lucide-react";
import { PlanComprasPlaceholder } from "./plan-compras-placeholder";

/**
 * Plan de Compras — Carga de datos.
 *
 * Placeholder: la grilla editable (estilo Excel) sobre `plan_compras_items`
 * llega en la etapa siguiente. La sección existe desde ya para que el ítem del
 * sidebar sea navegable y el picker de permisos de Configuración la ofrezca.
 */
export function PlanComprasCargaSection() {
  return (
    <PlanComprasPlaceholder
      icon={ShoppingCart}
      titulo="Plan de Compras — Carga de datos"
      descripcion="Acá va la grilla editable tipo Excel: navegación con teclado, pegado de rangos desde el Excel, columnas calculadas (Pu Sic + 20%, Pu Est ($), Verif. Precio, Total del período) e importación de la pestaña «Global»."
      pendiente={[
        "Tablas `plan_compras` / `plan_compras_items` en Supabase",
        "Capa de datos `lib/planCompras.ts`",
        "Grilla editable virtualizada (22.950 filas)",
        "Importación del .xlsx y validación por celda",
      ]}
      marca={Construction}
    />
  );
}
