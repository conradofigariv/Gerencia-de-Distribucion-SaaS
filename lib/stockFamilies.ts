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
        familia:    row.familia    ?? "",
        subfamilia: row.subfamilia ?? "",
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
        familia:    r.familia    ?? "",
        subfamilia: r.subfamilia ?? "",
        tipo:       r.tipo       || null,
      })),
      { onConflict: "articulo" }
    );
  return error?.message ?? null;
}

/** Info maestra de una matrícula (catálogo oficial cargado en "Carga de datos"). */
export interface MatriculaInfo {
  descripcion: string;
  udm:         string;
  tipo:        ArticuloTipo;   // derivado de la columna `mat_serv` de la planilla
}

/** Normaliza el valor de la columna Mat/Serv del catálogo a material/servicio. */
function normalizeMatServ(raw: string | null | undefined): ArticuloTipo {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s.startsWith("s")) return "servicio";   // Servicio / Serv / S
  if (s.startsWith("m")) return "material";   // Material / Mat / M
  return "";
}

/**
 * Lee el catálogo maestro `matriculas` (la lista más actualizada de matrículas
 * con su descripción, UDM y tipo Material/Servicio). Devuelve un Map
 * articulo → { descripcion, udm, tipo }. Pagina de a 1000 porque Supabase
 * limita el tamaño de respuesta.
 */
export async function getMatriculasInfo(): Promise<Map<string, MatriculaInfo>> {
  const map = new Map<string, MatriculaInfo>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("matriculas")
      .select("articulo, descripcion, unidad_medida, mat_serv")
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data as { articulo: string; descripcion: string | null; unidad_medida: string | null; mat_serv: string | null }[]) {
      if (r.articulo) map.set(r.articulo, {
        descripcion: r.descripcion ?? "",
        udm:         r.unidad_medida ?? "",
        tipo:        normalizeMatServ(r.mat_serv),
      });
    }
    if (data.length < PAGE) break;
  }
  return map;
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
