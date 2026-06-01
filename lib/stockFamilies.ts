import { supabase } from "@/lib/supabaseClient";

export type ArticuloTipo = "" | "servicio" | "material";

export interface FamilyRow {
  articulo:   string;
  familia:    string;
  subfamilia: string;
  tipo:       ArticuloTipo;
}

export async function getFamilies(): Promise<FamilyRow[]> {
  // select("*") para no romper si la columna `tipo` todavía no fue creada en Supabase
  const { data, error } = await supabase
    .from("stock_article_families")
    .select("*");
  if (error || !data) return [];
  return data.map(r => ({
    articulo:   r.articulo,
    familia:    r.familia    ?? "",
    subfamilia: r.subfamilia ?? "",
    tipo:       (r.tipo      ?? "") as ArticuloTipo,
  }));
}

export async function upsertFamily(row: FamilyRow): Promise<string | null> {
  const { error } = await supabase
    .from("stock_article_families")
    .upsert(
      {
        articulo:   row.articulo,
        familia:    row.familia    || null,
        subfamilia: row.subfamilia || null,
        tipo:       row.tipo       || null,
      },
      { onConflict: "articulo" }
    );
  return error?.message ?? null;
}

/** Upsert de varios artículos a la vez (asignación masiva). */
export async function upsertFamiliesBulk(rows: FamilyRow[]): Promise<string | null> {
  if (rows.length === 0) return null;
  const { error } = await supabase
    .from("stock_article_families")
    .upsert(
      rows.map(r => ({
        articulo:   r.articulo,
        familia:    r.familia    || null,
        subfamilia: r.subfamilia || null,
        tipo:       r.tipo       || null,
      })),
      { onConflict: "articulo" }
    );
  return error?.message ?? null;
}

export async function deleteFamily(articulo: string): Promise<string | null> {
  const { error } = await supabase
    .from("stock_article_families")
    .delete()
    .eq("articulo", articulo);
  return error?.message ?? null;
}

/** Borra varios artículos a la vez. */
export async function deleteFamiliesBulk(articulos: string[]): Promise<string | null> {
  if (articulos.length === 0) return null;
  const { error } = await supabase
    .from("stock_article_families")
    .delete()
    .in("articulo", articulos);
  return error?.message ?? null;
}
