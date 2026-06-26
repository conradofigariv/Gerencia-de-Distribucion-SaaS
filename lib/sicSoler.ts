import { supabase } from "@/lib/supabaseClient";

// ─── Planilla maestra de SICs del Ing. Soler ─────────────────────────────────
//
// Tabla seguimiento_sic_soler. Se sube desde "Carga de datos" y alimenta la
// carga masiva de "Crear seguimiento". Ver supabase/seguimiento_sic_soler.sql.

export interface SicSolerRow {
  numero_sic:     string;
  linea:          string;
  articulo:       string;
  descripcion:    string;
  cantidad:       number | null;
  udm:            string;
  preparador:     string;
  numero_op:      string;
  fecha_creacion: string;
}

export interface SicSolerDbRow extends SicSolerRow {
  id:          string;
  uploaded_at: string;
}

const TABLE = "seguimiento_sic_soler";
const BATCH = 500;

function isTableMissing(message: string): boolean {
  return (
    message.includes("does not exist") ||
    message.includes("Invalid path") ||
    message.includes("schema cache") ||
    message.includes("Could not find the table") ||
    message.includes("Invalid api key")
  );
}

// Estado para la card de "Carga de datos": cantidad de filas + última subida.
export async function getSicSolerStatus(): Promise<{ count: number; uploadedAt: string | null }> {
  const [cntRes, tsRes] = await Promise.all([
    supabase.from(TABLE).select("*", { count: "exact", head: true }),
    supabase.from(TABLE).select("uploaded_at").order("uploaded_at", { ascending: false }).limit(1),
  ]);
  if (cntRes.error && !isTableMissing(cntRes.error.message)) {
    throw new Error(cntRes.error.message);
  }
  const ts = (tsRes.data as { uploaded_at: string }[] | null)?.[0]?.uploaded_at ?? null;
  return { count: cntRes.count ?? 0, uploadedAt: ts };
}

// Trae toda la planilla (paginando de a 1000).
export async function getSicSoler(): Promise<SicSolerDbRow[]> {
  const PAGE = 1000;
  const all: SicSolerDbRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(TABLE).select("*").range(from, from + PAGE - 1);
    if (error) {
      if (isTableMissing(error.message)) break;
      throw new Error(error.message);
    }
    if (!data?.length) break;
    all.push(...(data as SicSolerDbRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// Sobreescribir: borra todo e inserta de cero.
export async function replaceSicSoler(rows: SicSolerRow[]): Promise<void> {
  const { error: delErr } = await supabase.from(TABLE).delete().not("numero_sic", "is", null);
  if (delErr) throw new Error(delErr.message);
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase.from(TABLE).insert(rows.slice(i, i + BATCH).map(r => ({ ...r, uploaded_at: now })));
    if (error) throw new Error(error.message);
  }
}

// Actualizar lo existente: upsert por (numero_sic, linea). Actualiza las filas
// que coinciden, agrega las nuevas y conserva las que no vienen en el archivo.
export async function upsertSicSoler(rows: SicSolerRow[]): Promise<void> {
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from(TABLE)
      .upsert(rows.slice(i, i + BATCH).map(r => ({ ...r, uploaded_at: now })), { onConflict: "numero_sic,linea" });
    if (error) throw new Error(error.message);
  }
}

export async function clearSicSoler(): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().not("numero_sic", "is", null);
  if (error) throw new Error(error.message);
}
