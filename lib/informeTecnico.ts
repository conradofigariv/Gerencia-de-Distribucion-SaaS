import { supabase } from "@/lib/supabaseClient";

export type LicitacionEstado = "borrador" | "en_evaluacion" | "adjudicada" | "archivada";

export interface Licitacion {
  id: string;
  numero_sic: string;
  titulo: string;
  fecha_apertura: string | null;
  fd_sic_fecha: string | null;
  fd_sic_valor: number | null;
  fd_op_fecha: string | null;
  fd_op_valor: number | null;
  umbral_economico_pct: number;
  estado: LicitacionEstado;
  created_at: string;
  updated_at: string;
}

export interface Renglon {
  id: string;
  licitacion_id: string;
  numero: number;
  condicion_adjudicacion: string | null;
}

export interface Item {
  id: string;
  renglon_id: string;
  numero_item: number;
  matricula: string | null;
  descripcion: string | null;
  cantidad: number;
  precio_sic_pesos: number | null;
}

export interface RenglonConItems extends Renglon {
  items: Item[];
}

export interface Oferente {
  id: string;
  licitacion_id: string;
  nombre: string;
}

export type Divisa = "USD" | "ARS";

export interface Oferta {
  id: string;
  oferente_id: string;
  item_id: string;
  precio_unitario: number;
  divisa: Divisa;
}

export interface EvaluacionTecnica {
  id: string;
  oferente_id: string;
  renglon_id: string;
  cumple: boolean | null;
  observaciones: string | null;
}

export interface Adjudicacion {
  id: string;
  renglon_id: string;
  oferente_id: string;
  confirmado_por: string | null;
  confirmado_at: string;
}

// ─── Licitaciones ────────────────────────────────────────────

export async function listLicitaciones(): Promise<Licitacion[]> {
  const { data, error } = await supabase
    .from("licitaciones")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Licitacion[];
}

export async function createLicitacion(input: {
  numero_sic: string;
  titulo: string;
}): Promise<Licitacion> {
  const { data, error } = await supabase
    .from("licitaciones")
    .insert({ numero_sic: input.numero_sic, titulo: input.titulo })
    .select("*")
    .single();
  if (error) throw error;
  return data as Licitacion;
}

export async function updateLicitacion(
  id: string,
  patch: Partial<Omit<Licitacion, "id" | "created_at" | "updated_at">>,
): Promise<Licitacion> {
  const { data, error } = await supabase
    .from("licitaciones")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Licitacion;
}

export async function deleteLicitacion(id: string): Promise<void> {
  const { error } = await supabase.from("licitaciones").delete().eq("id", id);
  if (error) throw error;
}

// ─── Renglones ──────────────────────────────────────────────────

export async function listRenglonesConItems(
  licitacionId: string,
): Promise<RenglonConItems[]> {
  const { data: renglones, error: rErr } = await supabase
    .from("licitacion_renglones")
    .select("*")
    .eq("licitacion_id", licitacionId)
    .order("numero", { ascending: true });
  if (rErr) throw rErr;

  const renglonIds = (renglones ?? []).map((r) => r.id);
  if (renglonIds.length === 0) return [];

  const { data: items, error: iErr } = await supabase
    .from("licitacion_items")
    .select("*")
    .in("renglon_id", renglonIds)
    .order("numero_item", { ascending: true });
  if (iErr) throw iErr;

  const byRenglon = new Map<string, Item[]>();
  for (const it of (items ?? []) as Item[]) {
    const arr = byRenglon.get(it.renglon_id) ?? [];
    arr.push(it);
    byRenglon.set(it.renglon_id, arr);
  }

  return (renglones as Renglon[]).map((r) => ({
    ...r,
    items: byRenglon.get(r.id) ?? [],
  }));
}

export async function createRenglon(input: {
  licitacion_id: string;
  numero: number;
  condicion_adjudicacion?: string | null;
}): Promise<Renglon> {
  const { data, error } = await supabase
    .from("licitacion_renglones")
    .insert({
      licitacion_id: input.licitacion_id,
      numero: input.numero,
      condicion_adjudicacion: input.condicion_adjudicacion ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Renglon;
}

export async function updateRenglon(
  id: string,
  patch: Partial<Omit<Renglon, "id" | "licitacion_id">>,
): Promise<Renglon> {
  const { data, error } = await supabase
    .from("licitacion_renglones")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Renglon;
}

export async function deleteRenglon(id: string): Promise<void> {
  const { error } = await supabase
    .from("licitacion_renglones")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// ─── Ítems ──────────────────────────────────────────────────────

export async function createItem(input: {
  renglon_id: string;
  numero_item: number;
  matricula?: string | null;
  descripcion?: string | null;
  cantidad?: number;
  precio_sic_pesos?: number | null;
}): Promise<Item> {
  const { data, error } = await supabase
    .from("licitacion_items")
    .insert({
      renglon_id: input.renglon_id,
      numero_item: input.numero_item,
      matricula: input.matricula ?? null,
      descripcion: input.descripcion ?? null,
      cantidad: input.cantidad ?? 1,
      precio_sic_pesos: input.precio_sic_pesos ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Item;
}

export async function updateItem(
  id: string,
  patch: Partial<Omit<Item, "id" | "renglon_id">>,
): Promise<Item> {
  const { data, error } = await supabase
    .from("licitacion_items")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Item;
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase
    .from("licitacion_items")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
