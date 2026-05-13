import { supabase } from "@/lib/supabaseClient";

export interface FamilyRow {
  articulo:   string;
  familia:    string;
  subfamilia: string;
}

export async function getFamilies(): Promise<FamilyRow[]> {
  const { data, error } = await supabase
    .from("stock_article_families")
    .select("articulo, familia, subfamilia");
  if (error || !data) return [];
  return data.map(r => ({
    articulo:   r.articulo,
    familia:    r.familia   ?? "",
    subfamilia: r.subfamilia ?? "",
  }));
}

export async function upsertFamily(row: FamilyRow): Promise<string | null> {
  const { error } = await supabase
    .from("stock_article_families")
    .upsert(
      { articulo: row.articulo, familia: row.familia, subfamilia: row.subfamilia || null },
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
