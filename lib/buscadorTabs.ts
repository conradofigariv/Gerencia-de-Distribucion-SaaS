import { supabase } from "@/lib/supabaseClient";
import type { BusquedaRow } from "@/lib/busqueda";

// ─── Pestañas del Buscador ───────────────────────────────────────────────────
// Listas de seguimiento privadas: se copian filas del índice maestro y desde
// ahí son del usuario (editables, reordenables). Ver supabase/buscador_tabs.sql.
//
// ⚠ Es una COPIA, no una referencia viva al índice. `row_key` solo guarda de
//   dónde salió, para avisar de duplicados y para el refresco manual.

/** Claves de las columnas de seguimiento dentro de `datos`. El guion bajo evita
 *  que choquen con una columna del índice, ahora o en el futuro. */
export const TRACK_KEYS = {
  nota:           "_nota",
  estado:         "_estado",
  responsable:    "_responsable",
  fechaRevision:  "_fecha_revision",
} as const;

export const ESTADOS = ["Pendiente", "En curso", "Resuelto"] as const;
export type Estado = (typeof ESTADOS)[number];

export interface TabConfig {
  order?:  string[];
  hidden?: string[];
  widths?: Record<string, number>;
}

export interface BuscadorTab {
  id:         string;
  user_id:    string;
  nombre:     string;
  orden:      number;
  color:      string | null;
  config:     TabConfig;
  created_at: string;
  updated_at: string;
}

/** Una fila copiada. `datos` tiene la fila completa del índice más las claves
 *  de seguimiento; todo es editable. */
export interface TabFila {
  id:         string;
  tab_id:     string;
  datos:      Record<string, unknown>;
  row_key:    string | null;
  orden:      number;
  created_at: string;
  updated_at: string;
}

// ─── Pestañas ────────────────────────────────────────────────────────────────

export async function fetchTabs(userId: string): Promise<BuscadorTab[]> {
  const { data, error } = await supabase
    .from("buscador_tabs")
    .select("*")
    .eq("user_id", userId)
    .order("orden", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BuscadorTab[];
}

export async function createTab(userId: string, nombre: string, orden: number): Promise<BuscadorTab> {
  const { data, error } = await supabase
    .from("buscador_tabs")
    .insert({ user_id: userId, nombre, orden })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as BuscadorTab;
}

export async function renameTab(id: string, nombre: string): Promise<void> {
  const { error } = await supabase
    .from("buscador_tabs")
    .update({ nombre, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateTabConfig(id: string, config: TabConfig): Promise<void> {
  const { error } = await supabase
    .from("buscador_tabs")
    .update({ config, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Borra la pestaña. Las filas caen solas por ON DELETE CASCADE. */
export async function deleteTab(id: string): Promise<void> {
  const { error } = await supabase.from("buscador_tabs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ─── Filas ───────────────────────────────────────────────────────────────────

export async function fetchTabFilas(tabId: string): Promise<TabFila[]> {
  const { data, error } = await supabase
    .from("buscador_tab_filas")
    .select("*")
    .eq("tab_id", tabId)
    .order("orden", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TabFila[];
}

/**
 * Copia filas del índice a una pestaña. Se agregan al final, en el orden en que
 * vienen. Devuelve las filas creadas.
 */
export async function addFilas(
  tabId: string,
  rows: BusquedaRow[],
  rowKeyOf: (r: BusquedaRow) => string,
  ordenBase: number
): Promise<TabFila[]> {
  if (!rows.length) return [];
  const payload = rows.map((r, i) => ({
    tab_id:  tabId,
    row_key: rowKeyOf(r),
    orden:   ordenBase + i,
    // La fila completa, más las columnas de seguimiento vacías.
    datos: {
      ...r,
      [TRACK_KEYS.nota]:          "",
      [TRACK_KEYS.estado]:        "",
      [TRACK_KEYS.responsable]:   "",
      [TRACK_KEYS.fechaRevision]: "",
    } as Record<string, unknown>,
  }));
  const { data, error } = await supabase.from("buscador_tab_filas").insert(payload).select();
  if (error) throw new Error(error.message);
  return (data ?? []) as TabFila[];
}

/**
 * Las matrículas distintas de una pestaña, normalizadas.
 *
 * Se usa para filtrar otras secciones por «lo que puse en esta pestaña» — hoy
 * el Resumen de Control de servicios. Trae SOLO las dos claves que hacen falta
 * en vez del `datos` entero: una pestaña de cientos de filas pesa varios MB de
 * jsonb y acá alcanza con la lista de códigos.
 *
 * Es deliberado usar la pestaña como conjunto de matrículas y no como fuente de
 * números: las filas copiadas quedan congeladas al momento de agregarlas, pero
 * un código de matrícula no envejece, así que este cruce no arrastra ese
 * problema.
 */
export async function fetchTabMatriculas(tabId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("buscador_tab_filas")
    .select("ak:datos->>articulo_key, a:datos->>articulo")
    .eq("tab_id", tabId);
  if (error) throw new Error(error.message);

  const out = new Set<string>();
  for (const r of (data ?? []) as unknown as { ak: string | null; a: string | null }[]) {
    // articulo_key ya viene normalizado del índice; `articulo` es el crudo del
    // Excel ("00009411.0") y necesita el mismo trim que gd_norm_articulo().
    const k = (r.ak ?? r.a ?? "").trim().replace(/\.0+$/, "");
    if (k) out.add(k);
  }
  return [...out];
}

/** Guarda el `datos` completo de una fila (una celda editada ya viene aplicada). */
export async function updateFilaDatos(id: string, datos: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("buscador_tab_filas")
    .update({ datos, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteFilas(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from("buscador_tab_filas").delete().in("id", ids);
  if (error) throw new Error(error.message);
}

/** Persiste el orden manual después de un drag. Una llamada por fila movida. */
export async function reorderFilas(filas: { id: string; orden: number }[]): Promise<void> {
  if (!filas.length) return;
  const results = await Promise.all(
    filas.map((f) =>
      supabase.from("buscador_tab_filas").update({ orden: f.orden }).eq("id", f.id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}
