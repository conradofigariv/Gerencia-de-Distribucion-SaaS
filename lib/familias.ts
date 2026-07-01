import { supabase } from "@/lib/supabaseClient";
import { getMatriculasInfo, type MatriculaInfo, type ArticuloTipo, type FamilyRow } from "@/lib/stockFamilies";

// Reexporto para que la sección importe todo desde un solo lugar.
export { getMatriculasInfo };
export type { MatriculaInfo, ArticuloTipo };

/**
 * Familias como ENTIDAD propia (tabla `familias`). A diferencia del modelo
 * viejo (etiqueta pegada a cada matrícula), acá una familia existe por sí
 * misma aunque no tenga matrículas, y se puede renombrar/borrar globalmente.
 *
 * La asignación matrícula ↔ familia es many-to-many (`familia_matriculas`):
 * una matrícula puede pertenecer a varias familias.
 *
 * El override manual de Material/Servicio vive aparte (`matricula_tipo`),
 * porque es por-matrícula e independiente de las familias.
 */
export interface Familia {
  id:     string;
  nombre: string;
}

// ── Familias (entidad) ──────────────────────────────────────────────────────

export async function listFamilias(): Promise<Familia[]> {
  const { data, error } = await supabase
    .from("familias")
    .select("id, nombre")
    .order("nombre", { ascending: true });
  if (error || !data) return [];
  return data.map(r => ({ id: r.id as string, nombre: r.nombre as string }));
}

export async function createFamilia(nombre: string): Promise<{ id?: string; error?: string }> {
  const n = nombre.trim();
  if (!n) return { error: "El nombre no puede estar vacío." };
  const { data, error } = await supabase
    .from("familias")
    .insert({ nombre: n })
    .select("id")
    .single();
  if (error) {
    return { error: error.code === "23505" ? "Ya existe una familia con ese nombre." : error.message };
  }
  return { id: data.id as string };
}

export async function renameFamilia(id: string, nombre: string): Promise<string | null> {
  const n = nombre.trim();
  if (!n) return "El nombre no puede estar vacío.";
  const { error } = await supabase.from("familias").update({ nombre: n }).eq("id", id);
  if (error) return error.code === "23505" ? "Ya existe una familia con ese nombre." : error.message;
  return null;
}

export async function deleteFamilia(id: string): Promise<string | null> {
  // Las asignaciones se borran solas por ON DELETE CASCADE.
  const { error } = await supabase.from("familias").delete().eq("id", id);
  return error?.message ?? null;
}

// ── Asignaciones (many-to-many) ─────────────────────────────────────────────

export interface Asignacion {
  familiaId: string;
  articulo:  string;
}

const clean = (arr: string[]): string[] =>
  [...new Set(arr.map(a => a.trim()).filter(Boolean))];

/**
 * Trae TODAS las asignaciones. Supabase corta en ~1000 filas por respuesta,
 * así que pide la 1ª página con el conteo y el resto en paralelo.
 */
export async function listAsignaciones(): Promise<Asignacion[]> {
  const PAGE = 1000;
  const out: Asignacion[] = [];
  type Row = { familia_id: string; articulo: string };
  const ingest = (rows: Row[] | null) => {
    for (const r of rows ?? []) out.push({ familiaId: r.familia_id, articulo: r.articulo });
  };

  const first = await supabase
    .from("familia_matriculas")
    .select("familia_id, articulo", { count: "exact" })
    .range(0, PAGE - 1);
  if (first.error || !first.data) return out;
  ingest(first.data as Row[]);

  const total = first.count ?? first.data.length;
  if (total > PAGE) {
    const reqs = [];
    for (let from = PAGE; from < total; from += PAGE) {
      reqs.push(
        supabase.from("familia_matriculas").select("familia_id, articulo").range(from, from + PAGE - 1),
      );
    }
    const results = await Promise.all(reqs);
    for (const res of results) ingest(res.data as Row[] | null);
  }
  return out;
}

/** Asigna matrículas a una familia (idempotente; no pisa las existentes). */
export async function assignMatriculas(familiaId: string, articulos: string[]): Promise<string | null> {
  const list = clean(articulos);
  if (list.length === 0) return null;
  const { error } = await supabase
    .from("familia_matriculas")
    .upsert(
      list.map(articulo => ({ familia_id: familiaId, articulo })),
      { onConflict: "familia_id,articulo", ignoreDuplicates: true },
    );
  return error?.message ?? null;
}

/** Quita matrículas de una familia. */
export async function removeMatriculas(familiaId: string, articulos: string[]): Promise<string | null> {
  const list = clean(articulos);
  if (list.length === 0) return null;
  const { error } = await supabase
    .from("familia_matriculas")
    .delete()
    .eq("familia_id", familiaId)
    .in("articulo", list);
  return error?.message ?? null;
}

// ── Carga masiva (nombre de familia + lista de matrículas) ───────────────────

export interface Validacion {
  reconocidas:   string[];   // existen en el catálogo `matriculas`
  noEncontradas: string[];   // pegadas pero sin match exacto por número
}

/**
 * Separa las matrículas pegadas en reconocidas / no encontradas cruzando por
 * número EXACTO contra el catálogo maestro. No normaliza el formato (respeta
 * el `.0` y los ceros). Deduplica preservando el orden de aparición.
 */
export async function validarContraCatalogo(
  articulos: string[],
  catalogo?: Map<string, MatriculaInfo>,
): Promise<Validacion> {
  const cat = catalogo ?? await getMatriculasInfo();
  const reconocidas: string[] = [];
  const noEncontradas: string[] = [];
  const seen = new Set<string>();
  for (const raw of articulos) {
    const a = raw.trim();
    if (!a || seen.has(a)) continue;
    seen.add(a);
    (cat.has(a) ? reconocidas : noEncontradas).push(a);
  }
  return { reconocidas, noEncontradas };
}

/**
 * Crea la familia si no existe (match por nombre exacto) y le asigna las
 * matrículas indicadas. Devuelve la familia y cuántas quedaron asignadas.
 */
export async function bulkImport(
  nombre: string,
  articulos: string[],
): Promise<{ familiaId?: string; asignadas?: number; error?: string }> {
  const n = nombre.trim();
  if (!n) return { error: "El nombre de la familia no puede estar vacío." };

  const existing = await supabase.from("familias").select("id").eq("nombre", n).limit(1);
  if (existing.error) return { error: existing.error.message };

  let familiaId: string;
  if (existing.data && existing.data.length > 0) {
    familiaId = existing.data[0].id as string;
  } else {
    const created = await createFamilia(n);
    if (created.error || !created.id) return { error: created.error ?? "No se pudo crear la familia." };
    familiaId = created.id;
  }

  const err = await assignMatriculas(familiaId, articulos);
  if (err) return { error: err };
  return { familiaId, asignadas: clean(articulos).length };
}

// ── Override manual de tipo (Material / Servicio) ────────────────────────────

/** Map articulo → tipo override manual (los que no tienen override no aparecen). */
export async function getTipoOverrides(): Promise<Map<string, ArticuloTipo>> {
  const map = new Map<string, ArticuloTipo>();
  const { data, error } = await supabase.from("matricula_tipo").select("articulo, tipo");
  if (error || !data) return map;
  for (const r of data) {
    if (r.articulo && r.tipo) map.set(r.articulo as string, r.tipo as ArticuloTipo);
  }
  return map;
}

/** Setea (o borra, si tipo="") el override de una matrícula. */
export async function setTipoOverride(articulo: string, tipo: ArticuloTipo): Promise<string | null> {
  if (!tipo) {
    const { error } = await supabase.from("matricula_tipo").delete().eq("articulo", articulo);
    return error?.message ?? null;
  }
  const { error } = await supabase
    .from("matricula_tipo")
    .upsert({ articulo, tipo }, { onConflict: "articulo" });
  return error?.message ?? null;
}

// ── Compat (shape viejo) ─────────────────────────────────────────────────────

/**
 * Devuelve las familias con el shape LEGADO `FamilyRow` (articulo → familias[]
 * + tipo), armado desde las tablas nuevas. Solo lectura: lo usa Stock por Zona
 * para su filtro de familias/tipo sin tener que reescribir toda su lógica.
 */
export async function getFamilyRowsCompat(): Promise<FamilyRow[]> {
  const [familias, asignaciones, overrides] = await Promise.all([
    listFamilias(), listAsignaciones(), getTipoOverrides(),
  ]);
  const nombrePorId = new Map(familias.map(f => [f.id, f.nombre]));
  const byArticulo = new Map<string, Set<string>>();
  for (const a of asignaciones) {
    const nombre = nombrePorId.get(a.familiaId);
    if (!nombre) continue;
    if (!byArticulo.has(a.articulo)) byArticulo.set(a.articulo, new Set());
    byArticulo.get(a.articulo)!.add(nombre);
  }
  const articulos = new Set<string>([...byArticulo.keys(), ...overrides.keys()]);
  const out: FamilyRow[] = [];
  for (const articulo of articulos) {
    out.push({
      articulo,
      familias: [...(byArticulo.get(articulo) ?? [])],
      tipo:     overrides.get(articulo) ?? "",
    });
  }
  return out;
}
