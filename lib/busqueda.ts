import { supabase } from "@/lib/supabaseClient";

// ─── Buscador global ─────────────────────────────────────────────────────────
// Fase 1: Matrículas + Planilla OP. Ver supabase/busqueda_global.sql.
//
// Jerarquía del dominio: SIC → OP (= OC en algunas bases) → línea → envío.
// La línea es QUÉ se compra (una matrícula por línea); el envío es en cuántas
// cuotas lo entrega el proveedor. Cada fila del índice es un (OP, línea, envío).

export interface BusquedaRow {
  id:                  number;
  // 'op'          → fila de compra de planillas_op
  // 'catalogo'    → matrícula que no aparece en ninguna OP ni movimiento
  // 'transaccion' → movimientos de una OP que ya no está en la planilla actual
  fuente:              "op" | "catalogo" | "transaccion";

  // Matrícula
  articulo:            string | null;   // código crudo ("00009411.0")
  articulo_key:        string | null;   // normalizado ("00009411")
  descripcion:         string | null;
  unidad_medida:       string | null;
  estado_matricula:    string | null;   // activo / inactivo
  tipo:                string | null;   // material / servicio (matricula_tipo — manda)
  mat_serv:            string | null;   // material / servicio del catálogo (informativo)
  en_catalogo:         boolean;

  // Compra
  relacion:            string | null;   // OP+línea; no es única (se repite por envío)
  numero_op:           string | null;
  linea:               string | null;
  envio:               string | null;
  envios_linea:        number | null;   // total de envíos de esa (OP, línea) → «1/2»
  proveedor:           string | null;
  zona:                string | null;

  // Cantidades
  cantidad:            number | null;
  cantidad_recibida:   number | null;
  ctd_aceptada:        number | null;
  pendiente:           number | null;
  cantidad_vencida:    number | null;
  cantidad_rechazada:  number | null;
  cantidad_facturada:  number | null;
  cantidad_cancelada:  number | null;

  // Fechas y estados
  fecha_creacion:      string | null;
  fecha_pactada:       string | null;
  estado_autorizacion: string | null;
  estado_cierre:       string | null;

  // Movimientos reales (tablero_op_transaccion), todo el histórico.
  // ⚠ Son totales POR LÍNEA: las transacciones no tienen dimensión de envío,
  // así que si la línea tiene varios envíos todas sus filas repiten el mismo
  // total. Sirven para leer el estado de la línea, no para sumar la columna.
  tx_recibido:         number | null;
  tx_aceptado:         number | null;
  tx_entregado:        number | null;
  tx_devoluciones:     number | null;
  tx_movimientos:      number | null;
  tx_primera_fecha:    string | null;   // ISO YYYY-MM-DD
  tx_ultima_fecha:     string | null;   // ISO YYYY-MM-DD

  updated_at:          string;
}

/** Ejecuta la búsqueda. `q` vacío devuelve las primeras filas del índice. */
export async function buscar(q: string, limite = 500): Promise<BusquedaRow[]> {
  const { data, error } = await supabase
    .rpc("gd_buscar", { p_q: q, p_limite: limite })
    .range(0, Math.max(limite - 1, 0));
  if (error) throw new Error(error.message);
  return (data ?? []) as BusquedaRow[];
}

/** Reconstruye el índice desde planillas_op + matriculas. Devuelve filas indexadas. */
export async function reconstruirIndice(): Promise<number> {
  const { data, error } = await supabase.rpc("gd_reconstruir_busqueda");
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

/** Cantidad de filas actualmente indexadas y fecha de la última reconstrucción. */
export async function estadoIndice(): Promise<{ filas: number; actualizado: string | null }> {
  const { count, error } = await supabase
    .from("busqueda_index")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);

  const { data } = await supabase
    .from("busqueda_index")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);

  return {
    filas: count ?? 0,
    actualizado: (data as { updated_at: string }[] | null)?.[0]?.updated_at ?? null,
  };
}
