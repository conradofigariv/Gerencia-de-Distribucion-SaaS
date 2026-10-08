import { supabase } from "@/lib/supabaseClient";
import {
  CLAVES_TEXTO, CLAVES_NUMERO,
  type ClaveColumna, type PlanComprasItem, type PlanComprasItemInput,
} from "@/lib/planComprasCalc";
import type { ImportacionPlan } from "@/lib/planComprasImport";

// ─────────────────────────────────────────────────────────────────────────────
// Plan de Compras — capa de datos (Supabase).
//
// Las columnas, tipos y fórmulas viven en lib/planComprasCalc.ts (módulo puro,
// también lo usa el importador dentro del Web Worker). Acá solo se lee y se
// escribe. SQL: supabase/plan_compras.sql · Doc: docs/plan-compras.md.
// ─────────────────────────────────────────────────────────────────────────────

export * from "@/lib/planComprasCalc";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface PlanCompras {
  id:             string;
  anio:           number;
  nombre:         string | null;
  tipo_cambio:    number;
  pct_mayoracion: number;
  /** Encabezado de cada columna tal cual vino en el Excel. */
  etiquetas:      Partial<Record<ClaveColumna, string>>;
  /** Celdas sueltas al pie de Global (TC y PC USD de años anteriores). */
  pie:            { etiqueta: string; valor: number }[];
  archivo:        string | null;
  importado_at:   string | null;
  importado_por:  string | null;
  activo:         boolean;
}

export interface PlanFamilia {
  familia:   string;
  prioridad: number | null;
  orden:     number;
}

const COLS_PLAN =
  "id, anio, nombre, tipo_cambio, pct_mayoracion, etiquetas, pie, archivo, importado_at, importado_por, activo";

const COLS_ITEM = ["id", "plan_id", "orden", ...CLAVES_TEXTO, ...CLAVES_NUMERO].join(", ");

// ─── Errores ─────────────────────────────────────────────────────────────────

/** Si el error es que todavía no se corrió el SQL, lo dice en criollo. */
export function mensajeErrorPlan(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (
    /does not exist|schema cache|Could not find the (table|function)|column .* does not exist/i.test(msg)
  ) {
    return "La base todavía no tiene las tablas del Plan de Compras: hay que correr supabase/plan_compras.sql en Supabase.";
  }
  return msg;
}

// ─── Concurrencia ────────────────────────────────────────────────────────────

/** Corre las tareas de a `n` a la vez, en orden. Corta en el primer error. */
async function enParalelo<T>(tareas: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tareas.length);
  let sig = 0;
  async function trabajador() {
    while (sig < tareas.length) {
      const i = sig++;
      out[i] = await tareas[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, tareas.length) }, trabajador));
  return out;
}

// ─── Lectura ─────────────────────────────────────────────────────────────────

/** Planes activos (uno por año), el más nuevo primero. */
export async function listPlanes(): Promise<PlanCompras[]> {
  const { data, error } = await supabase
    .from("plan_compras")
    .select(COLS_PLAN)
    .eq("activo", true)
    .order("anio", { ascending: false });
  if (error) throw new Error(mensajeErrorPlan(error));
  return (data ?? []) as PlanCompras[];
}

const PAGINA = 1000; // tope de filas por request de Supabase

/**
 * Trae todos los ítems del plan en el orden del Excel.
 *
 * Supabase corta en 1.000 filas por request: el plan 2026 tiene 22.950, así
 * que se pagina — y en paralelo (de a 4), porque de a una son ~23 viajes
 * seguidos y la pantalla tardaría el triple en aparecer.
 */
export async function getItems(
  planId: string,
  onProgreso?: (cargadas: number, total: number) => void,
): Promise<PlanComprasItem[]> {
  const { count, error } = await supabase
    .from("plan_compras_items")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId);
  if (error) throw new Error(mensajeErrorPlan(error));
  const total = count ?? 0;
  if (total === 0) return [];

  let cargadas = 0;
  const paginas = Math.ceil(total / PAGINA);
  const lotes = await enParalelo(
    Array.from({ length: paginas }, (_, p) => async () => {
      const { data, error: err } = await supabase
        .from("plan_compras_items")
        .select(COLS_ITEM)
        .eq("plan_id", planId)
        .order("orden", { ascending: true })
        .order("id", { ascending: true })
        .range(p * PAGINA, p * PAGINA + PAGINA - 1);
      if (err) throw new Error(mensajeErrorPlan(err));
      const lote = (data ?? []) as unknown as PlanComprasItem[];
      cargadas += lote.length;
      onProgreso?.(cargadas, total);
      return lote;
    }),
    4,
  );
  return lotes.flat();
}

export async function getFamilias(planId: string): Promise<PlanFamilia[]> {
  const { data, error } = await supabase
    .from("plan_compras_familias")
    .select("familia, prioridad, orden")
    .eq("plan_id", planId)
    .order("orden", { ascending: true });
  if (error) throw new Error(mensajeErrorPlan(error));
  return (data ?? []) as PlanFamilia[];
}

// ─── Parámetros ──────────────────────────────────────────────────────────────

/** Cambia los parámetros del plan. Recalcula toda la grilla sin tocar filas. */
export async function actualizarPlan(
  id: string,
  cambios: Partial<Pick<PlanCompras, "nombre" | "tipo_cambio" | "pct_mayoracion">>,
): Promise<void> {
  const { error } = await supabase.from("plan_compras").update(cambios).eq("id", id);
  if (error) throw new Error(mensajeErrorPlan(error));
}

// ─── Importación del Excel ───────────────────────────────────────────────────

export interface ProgresoImportacion {
  fase:   "preparando" | "items" | "familias" | "activando";
  hechos: number;
  total:  number;
}

const LOTE_INSERT = 500;

/** Saca las claves en null: la base las completa con su default (null) y el
 *  request pesa la mitad. supabase-js arma `columns=` con la unión de claves
 *  del lote, así que las filas pueden traer claves distintas. */
function sinNulos(o: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v != null) r[k] = v;
  return r;
}

/**
 * Sube una importación del Excel como versión NUEVA del plan de ese año.
 *
 * 1. Crea la cabecera inactiva.
 * 2. Carga ítems (de a 500, 3 requests en paralelo), familias y cuentas.
 * 3. Desactiva la versión anterior del año, activa la nueva y borra la
 *    anterior (sus ítems se van en cascada).
 *
 * Si algo falla antes de activar, se borra la versión nueva y el plan anterior
 * queda como estaba. El índice único parcial de la base impide que queden dos
 * versiones activas del mismo año.
 *
 * Esto antes era una función en la base (plan_compras_activar). Se pasó acá
 * porque el SQL con funciones llegaba alterado al SQL Editor de Supabase.
 */
export async function importarPlan(
  imp: ImportacionPlan,
  onProgreso?: (p: ProgresoImportacion) => void,
): Promise<PlanCompras> {
  const total = imp.items.length;
  onProgreso?.({ fase: "preparando", hechos: 0, total });

  const { data: userData } = await supabase.auth.getUser();

  // Restos de una importación anterior que se cortó (cabecera inactiva).
  const { error: errLimpieza } = await supabase
    .from("plan_compras")
    .delete()
    .eq("anio", imp.anio)
    .eq("activo", false);
  if (errLimpieza) throw new Error(mensajeErrorPlan(errLimpieza));

  const { data: plan, error: errPlan } = await supabase
    .from("plan_compras")
    .insert({
      anio:           imp.anio,
      nombre:         imp.nombre,
      tipo_cambio:    imp.tipo_cambio,
      pct_mayoracion: imp.pct_mayoracion,
      etiquetas:      imp.etiquetas,
      pie:            imp.pie,
      archivo:        imp.archivo,
      importado_at:   new Date().toISOString(),
      importado_por:  userData.user?.id ?? null,
      activo:         false,
    })
    .select(COLS_PLAN)
    .single();
  if (errPlan) throw new Error(mensajeErrorPlan(errPlan));
  const nuevo = plan as PlanCompras;

  try {
    let hechos = 0;
    const lotes: (PlanComprasItemInput & { orden: number })[][] = [];
    for (let i = 0; i < total; i += LOTE_INSERT) lotes.push(imp.items.slice(i, i + LOTE_INSERT));
    await enParalelo(
      lotes.map((lote) => async () => {
        const filas = lote.map((it) => sinNulos({ ...it, plan_id: nuevo.id }));
        const { error } = await supabase.from("plan_compras_items").insert(filas);
        if (error) throw new Error(mensajeErrorPlan(error));
        hechos += lote.length;
        onProgreso?.({ fase: "items", hechos, total });
      }),
      3,
    );

    onProgreso?.({ fase: "familias", hechos: total, total });
    if (imp.familias.length) {
      const { error } = await supabase
        .from("plan_compras_familias")
        .insert(imp.familias.map((f) => ({ ...f, plan_id: nuevo.id })));
      if (error) throw new Error(mensajeErrorPlan(error));
    }
    if (imp.cuentas.length) {
      const { error } = await supabase
        .from("plan_compras_cuentas")
        .insert(imp.cuentas.map((c) => ({ ...c, plan_id: nuevo.id })));
      if (error) throw new Error(mensajeErrorPlan(error));
    }

    onProgreso?.({ fase: "activando", hechos: total, total });
    await activar(nuevo);
  } catch (e) {
    // Deshace la versión a medio cargar; el plan anterior sigue activo.
    await supabase.from("plan_compras").delete().eq("id", nuevo.id);
    throw e;
  }

  // Ya activa: borrar las versiones anteriores del año (los ítems se van en
  // cascada). Si esto falla no se pierde nada: quedan inactivas, no se ven, y
  // la próxima importación las limpia al arrancar.
  const { error: errBorrar } = await supabase
    .from("plan_compras")
    .delete()
    .eq("anio", imp.anio)
    .eq("activo", false);
  if (errBorrar) console.warn("[plan-compras] no se pudo borrar la versión anterior:", errBorrar.message);
  return { ...nuevo, activo: true };
}

/**
 * Deja activa la versión nueva. Primero apaga la anterior y después prende la
 * nueva: al revés chocaría con el índice único parcial (una activa por año).
 * Si prender la nueva falla, vuelve a prender la anterior antes de propagar el
 * error, así el año no queda sin plan visible.
 */
async function activar(nuevo: PlanCompras): Promise<void> {
  const { data: previos, error: errPrev } = await supabase
    .from("plan_compras")
    .select("id")
    .eq("anio", nuevo.anio)
    .eq("activo", true);
  if (errPrev) throw new Error(mensajeErrorPlan(errPrev));
  const idsPrevios = ((previos ?? []) as { id: string }[]).map((p) => p.id).filter((id) => id !== nuevo.id);

  if (idsPrevios.length) {
    const { error } = await supabase.from("plan_compras").update({ activo: false }).in("id", idsPrevios);
    if (error) throw new Error(mensajeErrorPlan(error));
  }

  const { data: activado, error: errAct } = await supabase
    .from("plan_compras")
    .update({ activo: true })
    .eq("id", nuevo.id)
    .select("id");
  if (errAct || !activado || activado.length !== 1) {
    if (idsPrevios.length) {
      await supabase.from("plan_compras").update({ activo: true }).in("id", idsPrevios);
    }
    throw new Error(errAct ? mensajeErrorPlan(errAct) : "No se pudo activar el plan importado.");
  }
}
