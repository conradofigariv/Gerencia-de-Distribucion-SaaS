// ─────────────────────────────────────────────────────────────────────────────
// Plan de Compras — caché en memoria de las filas de Global.
//
// Carga de datos y Resumen leen las mismas ~23.000 filas. Al cambiar de
// sección la pantalla se desmonta, y antes cada entrada volvía a pedir todo a
// Supabase (varios segundos). Ahora la primera carga queda en memoria
// (compartida por las dos pantallas mientras la pestaña esté abierta):
//
//   • Al volver, las filas aparecen al instante desde la caché.
//   • En segundo plano se compara la «firma» del plan (cantidad de filas +
//     última modificación): si alguien lo editó o lo reimportó, se recarga.
//   • Las ediciones de Carga de datos se escriben acá al instante, así
//     Resumen las ve sin recargar.
//   • «Actualizar» fuerza la recarga.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabaseClient";
import {
  getItemsEditables,
  type PlanCompras, type PlanComprasItem, type PlanFamilia, type PlanCuenta,
} from "@/lib/planCompras";

interface Entrada {
  items:   PlanComprasItem[];
  edicion: boolean;
  /** Firma del plan en la base cuando se cargó (o tras el último guardado propio). */
  firma:   string;
}

const cache = new Map<string, Entrada>();
/** Planes guardados a la vez (cada uno pesa decenas de MB en memoria). */
const MAX_PLANES = 2;

/** Cantidad de filas + última modificación: cambia con cualquier edición o reimportación. */
export async function firmaPlan(planId: string): Promise<string> {
  const [cnt, ult] = await Promise.all([
    supabase.from("plan_compras_items").select("id", { count: "exact", head: true }).eq("plan_id", planId),
    supabase.from("plan_compras_items").select("updated_at").eq("plan_id", planId)
      .order("updated_at", { ascending: false }).limit(1),
  ]);
  if (cnt.error) throw cnt.error;
  if (ult.error) throw ult.error;
  const u = (ult.data?.[0] as { updated_at?: string } | undefined)?.updated_at ?? "";
  return `${cnt.count ?? 0}|${u}`;
}

/** Lo que haya en caché para el plan (sin ir a la base). */
export function itemsEnCache(planId: string): { items: PlanComprasItem[]; edicion: boolean } | null {
  const e = cache.get(planId);
  return e ? { items: e.items, edicion: e.edicion } : null;
}

/** Trae las filas de la base y las deja en caché. */
export async function cargarItemsPlan(
  planId: string,
  onProgreso?: (cargadas: number, total: number) => void,
): Promise<{ items: PlanComprasItem[]; edicion: boolean }> {
  // La firma se toma ANTES de leer: si alguien edita durante la lectura, la
  // próxima comparación lo detecta (en el peor caso se recarga de más).
  const firma = await firmaPlan(planId).catch(() => "");
  const r = await getItemsEditables(planId, onProgreso);
  cache.delete(planId);
  cache.set(planId, { ...r, firma });
  while (cache.size > MAX_PLANES) cache.delete(cache.keys().next().value!);
  return r;
}

/** ¿La base tiene algo distinto de lo que está en caché? */
export async function planCambio(planId: string): Promise<boolean> {
  const e = cache.get(planId);
  if (!e) return true;
  try {
    return (await firmaPlan(planId)) !== e.firma;
  } catch {
    return false; // sin red: se sigue con lo que hay
  }
}

/** Escribe en la caché las filas editadas (no toca la firma). */
export function actualizarItemsCache(planId: string, items: PlanComprasItem[]): void {
  const e = cache.get(planId);
  if (e) e.items = items;
}

/** Tras guardar ediciones propias: la firma nueva es «nuestra», no un cambio ajeno. */
export async function refrescarFirma(planId: string): Promise<void> {
  const e = cache.get(planId);
  if (!e) return;
  try { e.firma = await firmaPlan(planId); } catch { /* la próxima comparación recarga */ }
}

export function olvidarPlan(planId: string): void {
  cache.delete(planId);
}

// ─── Planes, plan elegido y tablas chicas (Prioridad / cuentas) ──────────────
// También quedan en memoria para que la pantalla aparezca sin esperar nada;
// se revalidan en segundo plano (son pedidos chicos).


let planesCache: PlanCompras[] | null = null;
let planRecordado: string | null = null;
const extras = new Map<string, { familias: PlanFamilia[]; cuentas: PlanCuenta[] }>();

export const planesEnCache = () => planesCache;
export const guardarPlanesCache = (ps: PlanCompras[]) => { planesCache = ps; };
/** Último plan elegido en cualquiera de las dos pantallas. */
export const planElegido = () => planRecordado;
export const recordarPlan = (id: string | null) => { planRecordado = id; };

export const extrasEnCache = (planId: string) => extras.get(planId) ?? null;
export function guardarExtrasCache(planId: string, e: { familias: PlanFamilia[]; cuentas: PlanCuenta[] }): void {
  extras.set(planId, e);
  while (extras.size > MAX_PLANES) extras.delete(extras.keys().next().value!);
}
