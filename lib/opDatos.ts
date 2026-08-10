import { supabase } from "@/lib/supabaseClient";

// ─── Datos manuales de la OP ────────────────────────────────────────────────
// Descripción real de la OP y zona real, cargadas a mano. Ver
// supabase/op_datos.sql para el modelo y el porqué de la tabla aparte.
//
// Son datos de la OP, NO de la fila: se cargan UNA vez por OP y valen para
// todas sus líneas y envíos, en todas las pestañas y para todo el equipo.

export interface OpDato {
  numero_op:   string;
  descripcion: string | null;
  zona:        string | null;
}

/** Claves de `busqueda_index` que en realidad viven en `op_datos`. */
export const OP_MANUAL_COLS = new Set(["op_descripcion", "zona"]);

/**
 * Normaliza el número de OP igual que `gd_norm_op()` en SQL: quita el sufijo
 * decimal del export de Excel. Hace falta del lado del cliente para que el
 * overlay case con lo guardado sin importar en qué forma vino cada uno.
 */
export const normOp = (raw: unknown): string =>
  String(raw ?? "").trim().replace(/\.0+$/, "");

/**
 * Todas las OPs anotadas a mano, indexadas por OP normalizada.
 *
 * Se trae la tabla entera de una: solo tiene fila por OP que alguien anotó, no
 * por OP existente, así que es chica. Traerla completa evita tener que pedirla
 * de nuevo cada vez que cambian las filas a la vista.
 */
export async function fetchOpDatos(): Promise<Map<string, OpDato>> {
  const { data, error } = await supabase.from("op_datos").select("numero_op, descripcion, zona");
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as OpDato[]).map((r) => [normOp(r.numero_op), r]));
}

/**
 * Carga o actualiza los datos manuales de una OP. Solo pisa los campos que se
 * pasan — mandar `{ zona }` no borra la descripción ya cargada.
 */
export async function upsertOpDato(
  numeroOp: string,
  campos: { descripcion?: string | null; zona?: string | null },
  userId?: string | null
): Promise<void> {
  const clave = normOp(numeroOp);
  if (!clave) throw new Error("La fila no tiene número de OP.");
  const { error } = await supabase
    .from("op_datos")
    .upsert(
      { numero_op: clave, ...campos, updated_at: new Date().toISOString(), updated_by: userId ?? null },
      { onConflict: "numero_op" }
    );
  if (error) throw new Error(error.message);
}

/**
 * Aplica los datos manuales sobre las filas que se van a mostrar.
 *
 * El rebuild ya deja estos valores dentro de `busqueda_index`, pero entre dos
 * reconstrucciones el índice queda viejo — y las filas copiadas a una pestaña
 * están congeladas desde el día que se copiaron. Este overlay hace que lo que
 * se ve sea siempre lo último cargado, sin depender de reconstruir nada.
 */
// Sin constraint sobre T a propósito: se llama con `BusquedaRow[]` (interface,
// sin index signature) y con `Record<string, unknown>[]` (el `datos` jsonb de
// una fila copiada). Pedir `T extends Record<string, unknown>` deja afuera a la
// primera, así que el acceso a los campos se hace con un cast puntual.
export function aplicarOpDatos<T>(filas: T[], opDatos: Map<string, OpDato>): T[] {
  if (!opDatos.size) return filas;
  return filas.map((f) => {
    const r = f as unknown as Record<string, unknown>;
    const d = opDatos.get(normOp(r.numero_op));
    if (!d) return f;
    return {
      ...f,
      op_descripcion: d.descripcion ?? r.op_descripcion ?? null,
      // La zona manual pisa a la de la planilla; si está vacía, queda la vieja.
      zona: d.zona != null && d.zona !== "" ? d.zona : r.zona,
    } as T;
  });
}
