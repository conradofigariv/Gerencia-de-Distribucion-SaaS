import { supabase } from "@/lib/supabaseClient";

/**
 * Catálogo de matrículas (tabla `matriculas`). Es la lista maestra de
 * materiales/servicios. La carga masiva (Excel) vive en "Carga de datos →
 * MATRICULAS"; esta sección permite mantenerla viva agregando, editando o
 * eliminando matrículas de a una.
 */
export interface Matricula {
  id?:            string;
  articulo:       string;
  descripcion:    string;
  unidad_medida:  string;
  estado:         string;
  mat_serv:       string;
  updated_at?:    string | null;
}

/** Campos editables/cargables de una matrícula. */
export type MatriculaInput = Omit<Matricula, "id" | "updated_at">;

const str = (v: unknown): string => String(v ?? "").trim();

/** Normaliza una entrada de formulario a los campos persistibles. */
export function cleanInput(m: MatriculaInput): MatriculaInput {
  return {
    articulo:      str(m.articulo),
    descripcion:   str(m.descripcion),
    unidad_medida: str(m.unidad_medida),
    estado:        str(m.estado),
    mat_serv:      str(m.mat_serv),
  };
}

/**
 * Descarga TODO el catálogo. Supabase corta cada respuesta en ~1000 filas, así
 * que pide la 1ª página con el conteo exacto y el resto en paralelo.
 */
export async function listMatriculas(): Promise<Matricula[]> {
  const PAGE = 1000;
  const COLS = "id, articulo, descripcion, unidad_medida, estado, mat_serv, updated_at";
  const out: Matricula[] = [];

  const first = await supabase
    .from("matriculas")
    .select(COLS, { count: "exact" })
    .order("articulo", { ascending: true })
    .range(0, PAGE - 1);
  if (first.error) throw new Error(first.error.message);
  out.push(...((first.data ?? []) as Matricula[]));

  const total = first.count ?? out.length;
  if (total > PAGE) {
    const requests = [];
    for (let from = PAGE; from < total; from += PAGE) {
      requests.push(
        supabase
          .from("matriculas")
          .select(COLS)
          .order("articulo", { ascending: true })
          .range(from, from + PAGE - 1),
      );
    }
    const results = await Promise.all(requests);
    for (const res of results) {
      if (res.error) throw new Error(res.error.message);
      out.push(...((res.data ?? []) as Matricula[]));
    }
  }
  return out;
}

/** ¿Existe ya una matrícula con ese número de artículo? (excluye `exceptId`). */
export async function articuloExists(articulo: string, exceptId?: string): Promise<boolean> {
  let q = supabase.from("matriculas").select("id").eq("articulo", str(articulo)).limit(1);
  if (exceptId) q = q.neq("id", exceptId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/** Crea una matrícula nueva (no pisa el resto del catálogo). */
export async function createMatricula(input: MatriculaInput): Promise<Matricula> {
  const row = { ...cleanInput(input), updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from("matriculas")
    .insert(row)
    .select("id, articulo, descripcion, unidad_medida, estado, mat_serv, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return data as Matricula;
}

/** Edita una matrícula existente por id. */
export async function updateMatricula(id: string, input: MatriculaInput): Promise<Matricula> {
  const row = { ...cleanInput(input), updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from("matriculas")
    .update(row)
    .eq("id", id)
    .select("id, articulo, descripcion, unidad_medida, estado, mat_serv, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return data as Matricula;
}

/** Elimina una matrícula por id. */
export async function deleteMatricula(id: string): Promise<void> {
  const { error } = await supabase.from("matriculas").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Tipo derivado de la columna Mat/Serv (material | servicio | ""). */
export function tipoFromMatServ(raw: string | null | undefined): "material" | "servicio" | "" {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s.startsWith("s")) return "servicio";
  if (s.startsWith("m")) return "material";
  return "";
}
