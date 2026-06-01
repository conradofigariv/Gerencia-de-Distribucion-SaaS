import { supabase } from "@/lib/supabaseClient";

export type ArticuloTipo = "" | "servicio" | "material";

/**
 * Una matrícula puede pertenecer a VARIAS familias (etiquetas).
 * Se persiste en la columna `familia` de `stock_article_families` como un
 * array JSON (p.ej. ["Cables","Aluminio"]). Las filas viejas con una sola
 * familia en texto plano se migran solas al leerlas.
 */
export interface FamilyRow {
  articulo: string;
  familias: string[];
  tipo:     ArticuloTipo;   // override manual de Material/Servicio
}

/** Lee la columna `familia` (JSON array nuevo, o texto plano legado). */
function parseFamilias(raw: unknown): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return [...new Set(arr.map(x => String(x).trim()).filter(Boolean))];
    } catch { /* cae a texto plano */ }
  }
  return [s];   // familia única legada
}

/** Serializa la lista de familias para guardarla; null si está vacía. */
function serializeFamilias(familias: string[]): string | null {
  const clean = [...new Set(familias.map(f => f.trim()).filter(Boolean))];
  return clean.length ? JSON.stringify(clean) : null;
}

export async function getFamilies(): Promise<FamilyRow[]> {
  const { data, error } = await supabase
    .from("stock_article_families")
    .select("*");
  if (error || !data) return [];
  return data.map(r => ({
    articulo: r.articulo,
    familias: parseFamilias(r.familia),
    tipo:     (r.tipo ?? "") as ArticuloTipo,
  }));
}

export async function upsertFamily(row: FamilyRow): Promise<string | null> {
  const { error } = await supabase
    .from("stock_article_families")
    .upsert(
      {
        articulo:   row.articulo,
        familia:    serializeFamilias(row.familias),
        subfamilia: null,
        tipo:       row.tipo || null,
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
        familia:    serializeFamilias(r.familias),
        subfamilia: null,
        tipo:       r.tipo || null,
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
 * articulo → { descripcion, udm, tipo }.
 *
 * Para que sea rápido con ~20k+ filas: pide la primera página con el conteo
 * exacto y luego descarga el resto de las páginas EN PARALELO (Supabase limita
 * cada respuesta a ~1000 filas).
 */
export async function getMatriculasInfo(): Promise<Map<string, MatriculaInfo>> {
  const PAGE = 1000;
  const COLS = "articulo, descripcion, unidad_medida, mat_serv";
  const map = new Map<string, MatriculaInfo>();

  type Row = { articulo: string; descripcion: string | null; unidad_medida: string | null; mat_serv: string | null };
  const ingest = (rows: Row[] | null) => {
    for (const r of rows ?? []) {
      if (r.articulo) map.set(r.articulo, {
        descripcion: r.descripcion ?? "",
        udm:         r.unidad_medida ?? "",
        tipo:        normalizeMatServ(r.mat_serv),
      });
    }
  };

  // Primera página + conteo total
  const first = await supabase
    .from("matriculas")
    .select(COLS, { count: "exact" })
    .range(0, PAGE - 1);
  if (first.error || !first.data) return map;
  ingest(first.data as Row[]);

  const total = first.count ?? first.data.length;
  if (total > PAGE) {
    // Resto de páginas en paralelo
    const requests = [];
    for (let from = PAGE; from < total; from += PAGE) {
      requests.push(
        supabase.from("matriculas").select(COLS).range(from, from + PAGE - 1),
      );
    }
    const results = await Promise.all(requests);
    for (const res of results) ingest(res.data as Row[] | null);
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
