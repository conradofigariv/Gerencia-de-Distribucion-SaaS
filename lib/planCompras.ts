import { supabase } from "@/lib/supabaseClient";

/**
 * Plan de Compras — plan anual de matrículas con cantidades y precios.
 *
 * Reemplaza el Excel «PC ANUAL GD» (pestaña Global). SQL en
 * `supabase/plan_compras.sql`, que explica el modelo en detalle.
 *
 * Lo importante de este archivo son las FÓRMULAS (`calcularItem`): en el Excel
 * la mitad de las columnas son cálculos, y acá se replican exactas para que
 * los números den igual que en el archivo que la oficina viene usando.
 */

export interface PlanCompra {
  id:          string;
  anio:        number;
  nombre:      string;
  tipo_cambio: number;
  created_at?: string;
  updated_at?: string;
}

export interface PlanCompraItem {
  id:      string;
  plan_id: string;
  articulo:    string;
  descripcion: string;
  unidad:      string;
  mat_serv:            string;
  familia:             string;
  subfamilia:          string;
  a_cargo_de:          string;
  partida:             string;
  descripcion_partida: string;
  gd:            number;
  cant_aprobada: number;
  pu_sic:     number;
  pu_op:      number;
  pu_est_usd: number;
}

/** Campos de un ítem que se editan a mano (todo menos id/plan_id). */
export type PlanCompraItemInput = Omit<PlanCompraItem, "id" | "plan_id">;

/** Los valores derivados de un ítem — no se guardan, se calculan. */
export interface PlanCompraCalculado {
  recorte:       number;
  puSicMas20:    number;
  puEstArs:      number;
  verifPrecio:   number;
  totalArs:      number;
}

const ITEM_COLS =
  "id, plan_id, articulo, descripcion, unidad, mat_serv, familia, subfamilia, " +
  "a_cargo_de, partida, descripcion_partida, gd, cant_aprobada, pu_sic, pu_op, pu_est_usd";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const str = (v: unknown): string => String(v ?? "").trim();

// ─── Fórmulas ───────────────────────────────────────────────────────────────

/**
 * Replica las columnas calculadas del Excel. `tipoCambio` es el del plan
 * (una sola celda en el archivo original, ver el SQL).
 *
 * ⚠ Los redondeos NO son decorativos: el Excel usa ROUND en «Pu Sic + 20%» y
 *   ROUNDUP en «Pu Est ($)». Si acá se redondeara distinto, los totales del
 *   plan no coincidirían con los que la oficina ya conoce.
 */
export function calcularItem(item: PlanCompraItem, tipoCambio: number): PlanCompraCalculado {
  const gd    = num(item.gd);
  const puSic = num(item.pu_sic);
  const puOp  = num(item.pu_op);

  // =ROUND(MAX(Pu Sic; Pu OP) * 1,2; 0)
  const puSicMas20 = Math.round(Math.max(puSic, puOp) * 1.2);
  // =ROUNDUP(Pu Est (USD) * TC; 0)
  const puEstArs   = Math.ceil(num(item.pu_est_usd) * num(tipoCambio));
  // =IFERROR(Pu Est ($) / Pu Sic + 20% - 1; 0) — el IFERROR cubre el divisor 0
  const verifPrecio = puSicMas20 ? puEstArs / puSicMas20 - 1 : 0;

  return {
    recorte: num(item.cant_aprobada) - gd,
    puSicMas20,
    puEstArs,
    verifPrecio,
    totalArs: puEstArs * gd,
  };
}

/** Total del plan en $ — el denominador de «% Incidencia». */
export function totalPlan(items: PlanCompraItem[], tipoCambio: number): number {
  return items.reduce((acc, it) => acc + calcularItem(it, tipoCambio).totalArs, 0);
}

/**
 * Peso de un ítem sobre el total del plan. Se pasa el total ya calculado
 * porque quien renderiza la tabla lo necesita una sola vez, no por fila.
 */
export function incidencia(totalItemArs: number, totalPlanArs: number): number {
  return totalPlanArs ? totalItemArs / totalPlanArs : 0;
}

// ─── Planes ─────────────────────────────────────────────────────────────────

/** Todos los planes, del año más nuevo al más viejo. */
export async function listPlanes(): Promise<PlanCompra[]> {
  const { data, error } = await supabase
    .from("planes_compra")
    .select("id, anio, nombre, tipo_cambio, created_at, updated_at")
    .order("anio", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PlanCompra[];
}

/** Crea el plan de un año. Falla si ese año ya tiene plan (UNIQUE en la base). */
export async function createPlan(
  anio: number, nombre: string, tipoCambio: number, userId?: string | null,
): Promise<PlanCompra> {
  const { data, error } = await supabase
    .from("planes_compra")
    .insert({
      anio,
      nombre: str(nombre) || `Plan de Compras ${anio}`,
      tipo_cambio: num(tipoCambio),
      created_by: userId ?? null,
    })
    .select("id, anio, nombre, tipo_cambio, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return data as PlanCompra;
}

/** Edita el encabezado del plan (nombre y/o tipo de cambio). */
export async function updatePlan(
  id: string, campos: Partial<Pick<PlanCompra, "nombre" | "tipo_cambio">>,
): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (campos.nombre      !== undefined) patch.nombre      = str(campos.nombre);
  if (campos.tipo_cambio !== undefined) patch.tipo_cambio = num(campos.tipo_cambio);

  const { error } = await supabase.from("planes_compra").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Borra un plan y, en cascada, todos sus ítems. */
export async function deletePlan(id: string): Promise<void> {
  const { error } = await supabase.from("planes_compra").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ─── Ítems ──────────────────────────────────────────────────────────────────

/** Ítems de un plan, ordenados por matrícula. */
export async function listItems(planId: string): Promise<PlanCompraItem[]> {
  const PAGE = 1000;
  const out: PlanCompraItem[] = [];

  const first = await supabase
    .from("plan_compra_items")
    .select(ITEM_COLS, { count: "exact" })
    .eq("plan_id", planId)
    .order("articulo", { ascending: true })
    .range(0, PAGE - 1);
  if (first.error) throw new Error(first.error.message);
  out.push(...((first.data ?? []) as unknown as PlanCompraItem[]));

  const total = first.count ?? out.length;
  for (let from = PAGE; from < total; from += PAGE) {
    const res = await supabase
      .from("plan_compra_items")
      .select(ITEM_COLS)
      .eq("plan_id", planId)
      .order("articulo", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error) throw new Error(res.error.message);
    out.push(...((res.data ?? []) as unknown as PlanCompraItem[]));
  }
  return out;
}

/**
 * Suma matrículas al plan. Las que ya estaban se ignoran (no se pisan): el
 * `onConflict` con `ignoreDuplicates` evita borrar lo ya cargado a mano si
 * alguien vuelve a pegar una lista que se solapa.
 *
 * Devuelve cuántas entraron de verdad.
 */
export async function agregarItems(
  planId: string,
  filas: DatosCatalogo[],
): Promise<number> {
  if (filas.length === 0) return 0;

  const rows = filas.map((f) => ({
    plan_id:     planId,
    articulo:    str(f.articulo),
    descripcion: str(f.descripcion),
    unidad:      str(f.unidad),
    mat_serv:    str(f.mat_serv),
  }));

  const { data, error } = await supabase
    .from("plan_compra_items")
    .upsert(rows, { onConflict: "plan_id,articulo", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** Guarda los campos editados de un ítem. */
export async function updateItem(
  id: string, campos: Partial<PlanCompraItemInput>,
): Promise<void> {
  const textos = [
    "descripcion", "unidad", "familia", "subfamilia",
    "a_cargo_de", "partida", "descripcion_partida",
  ] as const;
  const numeros = ["gd", "cant_aprobada", "pu_sic", "pu_op", "pu_est_usd"] as const;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of textos)  if (campos[k] !== undefined) patch[k] = str(campos[k]);
  for (const k of numeros) if (campos[k] !== undefined) patch[k] = num(campos[k]);

  const { error } = await supabase.from("plan_compra_items").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Saca una matrícula del plan. */
export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from("plan_compra_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ─── Pegado de matrículas ───────────────────────────────────────────────────

/**
 * Separa una lista pegada en matrículas sueltas. Tolera saltos de línea, tabs,
 * comas y punto y coma (según de dónde se copie), y descarta repetidas.
 */
export function parseMatriculasPegadas(texto: string): string[] {
  return [...new Set(
    texto.split(/[\r\n\t,;]+/).map((s) => s.trim()).filter(Boolean),
  )];
}

/** Los datos que el catálogo aporta a una fila del plan. */
export interface DatosCatalogo {
  articulo:    string;
  descripcion: string;
  unidad:      string;
  mat_serv:    string;
}

export interface CruceCatalogo {
  /** Matrículas que existen en el catálogo, con sus datos. */
  reconocidas:   DatosCatalogo[];
  /** Las que no aparecen en `matriculas` — se informan y no se agregan. */
  noEncontradas: string[];
}

/**
 * Cruza las matrículas pegadas contra el catálogo (`matriculas`), trayendo
 * descripción, unidad y Mat/Serv. El cruce es por igualdad exacta de
 * `articulo`, igual que en el resto del sistema (el número va con su `.0` y
 * sus ceros).
 */
export async function cruzarContraCatalogo(articulos: string[]): Promise<CruceCatalogo> {
  if (articulos.length === 0) return { reconocidas: [], noEncontradas: [] };

  // De a tandas: un `in` con miles de valores no entra en la URL del request.
  const LOTE = 200;
  const encontrados = new Map<string, Omit<DatosCatalogo, "articulo">>();

  for (let i = 0; i < articulos.length; i += LOTE) {
    const lote = articulos.slice(i, i + LOTE);
    const { data, error } = await supabase
      .from("matriculas")
      .select("articulo, descripcion, unidad_medida, mat_serv")
      .in("articulo", lote);
    if (error) throw new Error(error.message);
    for (const m of data ?? []) {
      encontrados.set(String(m.articulo), {
        descripcion: str(m.descripcion),
        unidad:      str(m.unidad_medida),
        mat_serv:    str(m.mat_serv),
      });
    }
  }

  const reconocidas: CruceCatalogo["reconocidas"] = [];
  const noEncontradas: string[] = [];
  for (const a of articulos) {
    const hit = encontrados.get(a);
    if (hit) reconocidas.push({ articulo: a, ...hit });
    else     noEncontradas.push(a);
  }
  return { reconocidas, noEncontradas };
}
