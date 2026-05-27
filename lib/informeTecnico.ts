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

// ─── Licitaciones ──────────────────────────────────────────────────

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
