import { supabase } from "@/lib/supabaseClient";
import { normArticulo, parseNum } from "@/lib/tableroOp";

// ─────────────────────────────────────────────────────────────────────────────
// Plan de Compras — capa de datos y cálculo.
//
// Traduce la pestaña «Global» del Excel PC_ANUAL_GD. Sólo se persiste lo que se
// carga a mano; todo lo que en el Excel es fórmula se recalcula acá (ver
// `calcularFila`), para que cambiar el tipo de cambio del plan actualice las
// ~23.000 filas sin reescribir una sola.
// ─────────────────────────────────────────────────────────────────────────────

export { normArticulo, parseNum };

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Cabecera del plan: un plan por año, con los parámetros que en el Excel eran
 *  celdas sueltas al pie de la hoja. */
export interface PlanCompras {
  id:             string;
  anio:           number;
  nombre:         string | null;
  /** $ por USD — la celda «TC 11/07/2025» del Excel. */
  tipo_cambio:    number;
  /** El «+20%» de Pu Sic + 20%, como fracción (0.20). */
  pct_mayoracion: number;
}

/** Campos de un ítem que se cargan a mano (lo único que va a la base). */
export interface PlanComprasItemInput {
  orden:          number;
  articulo:       string | null;
  descripcion:    string | null;
  unidad:         string | null;
  a_cargo_de:     string | null;
  /** «GD 2025»: la cantidad que multiplica el total del plan. */
  cant_gd:        number | null;
  cant_aprobadas: number | null;
  pu_sic:         number | null;
  pu_op:          number | null;
  pu_est_usd:     number | null;
}

/** Ítem tal como sale de la base. */
export interface PlanComprasItem extends PlanComprasItemInput {
  id:      string;
  plan_id: string;
}

/** Los valores derivados de cada fila — el equivalente a las columnas fórmula
 *  del Excel. No se guardan. */
export interface PlanComprasCalc {
  /** ROUND(MAX(Pu Sic; Pu OP) × (1 + pct); 0) */
  pu_sic_mas:   number;
  /** ROUNDUP(Pu Est (USD) × TC; 0) */
  pu_est_pesos: number;
  /** Pu Est ($) / Pu Sic + 20% − 1, con 0 cuando el divisor es 0 (IFERROR). */
  verif_precio: number;
  /** Pu Est ($) × GD — ojo: multiplica por `cant_gd`, NO por `cant_aprobadas`. */
  total:        number;
  /** CANT. APROBADAS − GD */
  recorte:      number;
}

export const COLUMNAS_ITEM = [
  "id", "plan_id", "orden", "articulo", "descripcion", "unidad", "a_cargo_de",
  "cant_gd", "cant_aprobadas", "pu_sic", "pu_op", "pu_est_usd",
].join(", ");

// ─── Listas cerradas (valores reales del Excel) ──────────────────────────────

/** Sectores de «A CARGO DE», por frecuencia en el plan 2026. */
export const SECTORES = [
  "GD", "ALMACENES", "SyRT", "SERVICIOS GENERALES", "GTIC", "TELECOMUNICACIONES",
  "INGENIERIA", "COMERCIAL", "CENTRALES", "AUTOMOTORES", "GENERACION",
  "TRANSMISION", "FINANZAS", "ADJUDICACIONES", "Sin Datos",
] as const;

/** Unidades de medida del catálogo, por frecuencia. */
export const UNIDADES = [
  "Pieza", "Global", "Kgs", "Conjunto", "Metro", "Gramos", "Unidad", "Meses",
  "Unidad de Servicio", "Equipo", "Litros", "Juego", "Par", "Block",
  "Metro Cuadrado",
] as const;

/** Etiqueta de la columna `cant_gd`. En el Excel del plan 2026 se llama
 *  «GD 2025»: la demanda se arma el año anterior al del plan. */
export function etiquetaCantGd(anio: number): string {
  return `GD ${anio - 1}`;
}

/** Etiqueta de la columna «Total»: «Total 2026 $» para el plan 2026. */
export function etiquetaTotal(anio: number): string {
  return `Total ${anio} $`;
}

// ─── Cálculo (equivalente a las fórmulas del Excel) ──────────────────────────

/**
 * Limpia el ruido del punto flotante antes de redondear, como hace Excel, que
 * trabaja con 15 dígitos significativos.
 *
 * Sin esto, 203,98406374502 × 1255 da 256000,00000000003 en JS y ROUNDUP lo
 * empuja a 256001 — un peso de más contra el Excel, en las filas donde el Pu
 * Est (USD) viene de una división. Sobre el plan 2026 pasaba en 2 de 22.950
 * filas: poco, pero es un descuadre inexplicable para quien compara pantalla
 * contra planilla.
 */
function limpiar(n: number): number {
  return Number(n.toPrecision(15));
}

/** ROUND de Excel: el medio se redondea alejándose del cero, no al par. */
function roundExcel(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(limpiar(n)));
}

/** ROUNDUP de Excel: siempre se aleja del cero. */
function roundUpExcel(n: number): number {
  return Math.sign(n) * Math.ceil(Math.abs(limpiar(n)));
}

/** Una celda vacía cuenta como 0, igual que en el Excel. */
const num = (v: number | null | undefined): number => (v == null ? 0 : v);

/**
 * Calcula las columnas derivadas de una fila.
 *
 * ⚠ `pu_sic_mas` NO es `pu_sic × 1,2`: es el MÁXIMO entre Pu Sic y Pu OP,
 * mayorado. Una fila con Pu OP más alto que Pu Sic da distinto si se toma sólo
 * el primero.
 */
export function calcularFila(item: PlanComprasItemInput, plan: PlanCompras): PlanComprasCalc {
  const puSicMas    = roundExcel(Math.max(num(item.pu_sic), num(item.pu_op)) * (1 + plan.pct_mayoracion));
  const puEstPesos  = roundUpExcel(num(item.pu_est_usd) * plan.tipo_cambio);
  const verifPrecio = puSicMas === 0 ? 0 : puEstPesos / puSicMas - 1;

  return {
    pu_sic_mas:   puSicMas,
    pu_est_pesos: puEstPesos,
    verif_precio: verifPrecio,
    total:        puEstPesos * num(item.cant_gd),
    recorte:      num(item.cant_aprobadas) - num(item.cant_gd),
  };
}

/** Total del plan — el SUBTOTAL(109) de la fila de totales del Excel. */
export function totalPlan(items: PlanComprasItemInput[], plan: PlanCompras): number {
  return items.reduce((acc, it) => acc + calcularFila(it, plan).total, 0);
}

/** «% Incidencia»: cuánto pesa una fila sobre el total del plan. */
export function incidencia(total: number, totalGeneral: number): number {
  return totalGeneral === 0 ? 0 : total / totalGeneral;
}

// ─── CRUD de la cabecera ─────────────────────────────────────────────────────

export async function listPlanes(): Promise<PlanCompras[]> {
  const { data, error } = await supabase
    .from("plan_compras")
    .select("id, anio, nombre, tipo_cambio, pct_mayoracion")
    .order("anio", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PlanCompras[];
}

/** Devuelve el plan del año pedido, o null si todavía no existe. */
export async function getPlan(anio: number): Promise<PlanCompras | null> {
  const { data, error } = await supabase
    .from("plan_compras")
    .select("id, anio, nombre, tipo_cambio, pct_mayoracion")
    .eq("anio", anio)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PlanCompras | null) ?? null;
}

export async function crearPlan(
  anio: number,
  nombre: string | null = null,
  tipoCambio = 1,
  pctMayoracion = 0.2
): Promise<PlanCompras> {
  const { data, error } = await supabase
    .from("plan_compras")
    .insert({ anio, nombre, tipo_cambio: tipoCambio, pct_mayoracion: pctMayoracion })
    .select("id, anio, nombre, tipo_cambio, pct_mayoracion")
    .single();
  if (error) throw new Error(error.message);
  return data as PlanCompras;
}

/** Cambia los parámetros del plan (tipo de cambio, % de mayoración, nombre).
 *  Recalcula toda la grilla sin tocar ninguna fila. */
export async function actualizarPlan(
  id: string,
  cambios: Partial<Pick<PlanCompras, "nombre" | "tipo_cambio" | "pct_mayoracion">>
): Promise<void> {
  const { error } = await supabase.from("plan_compras").update(cambios).eq("id", id);
  if (error) throw new Error(error.message);
}

// ─── CRUD de los ítems ───────────────────────────────────────────────────────

const LOTE = 500;

/**
 * Trae todos los ítems del plan, en orden de grilla.
 *
 * Supabase corta en 1.000 filas por request, así que pagina: el plan 2026 tiene
 * ~23.000 ítems y una sola llamada devolvería la primera página en silencio.
 */
export async function getItems(planId: string): Promise<PlanComprasItem[]> {
  const PAGINA = 1000;
  const out: PlanComprasItem[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase
      .from("plan_compras_items")
      .select(COLUMNAS_ITEM)
      .eq("plan_id", planId)
      .order("orden", { ascending: true })
      .range(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as unknown as PlanComprasItem[];
    out.push(...lote);
    if (lote.length < PAGINA) return out;
  }
}

/** Inserta filas nuevas (las que la grilla creó y todavía no tienen id). */
export async function insertItems(
  planId: string,
  filas: PlanComprasItemInput[]
): Promise<PlanComprasItem[]> {
  const out: PlanComprasItem[] = [];
  for (let i = 0; i < filas.length; i += LOTE) {
    const { data, error } = await supabase
      .from("plan_compras_items")
      .insert(filas.slice(i, i + LOTE).map((f) => ({ ...f, plan_id: planId })))
      .select(COLUMNAS_ITEM);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as PlanComprasItem[]));
  }
  return out;
}

/** Guarda las filas editadas. Upsert por `id`, en lotes — la grilla puede
 *  mandar cientos de filas de una sola pegada. */
export async function upsertItems(items: PlanComprasItem[]): Promise<void> {
  for (let i = 0; i < items.length; i += LOTE) {
    const { error } = await supabase
      .from("plan_compras_items")
      .upsert(items.slice(i, i + LOTE), { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
}

export async function deleteItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  for (let i = 0; i < ids.length; i += LOTE) {
    const { error } = await supabase
      .from("plan_compras_items")
      .delete()
      .in("id", ids.slice(i, i + LOTE));
    if (error) throw new Error(error.message);
  }
}

/** Reemplaza el contenido completo del plan — lo que hace la importación del
 *  .xlsx. Borra y vuelve a insertar; el plan (y sus parámetros) sobrevive. */
export async function reemplazarItems(
  planId: string,
  filas: PlanComprasItemInput[]
): Promise<void> {
  const { error } = await supabase.from("plan_compras_items").delete().eq("plan_id", planId);
  if (error) throw new Error(error.message);
  await insertItems(planId, filas);
}

export async function contarItems(planId: string): Promise<number> {
  const { count, error } = await supabase
    .from("plan_compras_items")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
