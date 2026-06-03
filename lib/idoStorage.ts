import { supabase } from "@/lib/supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// Índice IDO — almacenamiento de los datos CRUDOS que se cargan por pegado.
// Los KPIs, Resultado Técnico, POVA, Mantenimiento e IDO NO se persisten:
// se calculan en el Resumen a partir de estos valores + las metas.
// Una fila por (periodo, zona).
// ─────────────────────────────────────────────────────────────────────────────

export interface IdoRow {
  periodo: string;
  zona: string;
  // Técnico (valores crudos del indicador — menos es mejor)
  fmik_s1: number | null;
  fmik_s2: number | null;
  dmik_s1: number | null;
  dmik_s2: number | null;
  // POVA / Obras (conteos)
  pova_transferido: number | null;
  pova_fin_obra: number | null;
  pova_creadas: number | null;
  pova_total: number | null;
  // Mantenimiento (cumplimientos en puntos porcentuales 0–100)
  mant_poda_bt: number | null;
  mant_poda_mt: number | null;
  mant_termografia: number | null;
}

// Campos numéricos de cada bloque (para merge y upsert)
export const TECNICO_FIELDS = ["fmik_s1", "fmik_s2", "dmik_s1", "dmik_s2"] as const;
export const POVA_FIELDS = ["pova_transferido", "pova_fin_obra", "pova_creadas", "pova_total"] as const;
export const MANT_FIELDS = ["mant_poda_bt", "mant_poda_mt", "mant_termografia"] as const;

export type Bloque = "tecnico" | "pova" | "mant";

// Sinónimos de encabezados aceptados por bloque (normalizados: minúscula, sin acentos)
const COLSPEC: Record<Bloque, Record<string, string[]>> = {
  tecnico: {
    fmik_s1: ["fmik s1", "fmik 1"],
    fmik_s2: ["fmik s2", "fmik 2"],
    dmik_s1: ["dmik s1", "dmik 1"],
    dmik_s2: ["dmik s2", "dmik 2"],
  },
  pova: {
    pova_transferido: ["transferido", "transferidos"],
    pova_fin_obra: ["fin de obra", "fin obra"],
    pova_creadas: ["creadas", "creados", "creada"],
    pova_total: ["total obras", "total"],
  },
  mant: {
    mant_poda_bt: ["poda bt"],
    mant_poda_mt: ["poda mt"],
    mant_termografia: ["termografia", "termografias"],
  },
};

// ─── Helpers de parseo ───────────────────────────────────────────────────────

function norm(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Parsea un número en formato es-AR. "0,84" → 0.84 · "1.234,5" → 1234.5 · "95%" → 95 */
export function parseNum(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/%/g, "").replace(/\s/g, "");
  if (s.includes(",")) {
    // coma = decimal → quito puntos de miles y convierto coma en punto
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Mantenimiento se guarda en puntos porcentuales (0–100). Si viene como fracción (≤1), lo escala. */
function parsePercent(raw: string): number | null {
  const n = parseNum(raw);
  if (n === null) return null;
  return n > 0 && n <= 1 && !raw.includes("%") ? n * 100 : n;
}

export interface ParsedBlock {
  values: Record<string, Record<string, number | null>>; // zona → { campo: valor }
  zonas: string[];
  error?: string;
}

/** Parsea un bloque pegado (TSV con encabezado). Detecta la columna Zona y los campos por nombre. */
export function parseBlock(text: string, bloque: Bloque): ParsedBlock {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { values: {}, zonas: [], error: "Pegá el encabezado y al menos una fila." };

  const headers = lines[0].split("\t").map((h) => norm(h));
  const spec = COLSPEC[bloque];

  // Columna de zona: la que se llame "zona", o la primera columna por defecto
  let zonaIdx = headers.findIndex((h) => h === "zona");
  if (zonaIdx === -1) zonaIdx = 0;

  // Mapear cada campo del bloque a su índice de columna
  const fieldIdx: Record<string, number> = {};
  for (const [field, syns] of Object.entries(spec)) {
    const idx = headers.findIndex((h) => syns.includes(h));
    if (idx !== -1) fieldIdx[field] = idx;
  }
  if (Object.keys(fieldIdx).length === 0) {
    const wanted = Object.values(spec).map((s) => s[0]).join(", ");
    return { values: {}, zonas: [], error: `No encontré columnas conocidas. Esperaba alguna de: ${wanted}.` };
  }

  const values: Record<string, Record<string, number | null>> = {};
  const zonas: string[] = [];
  const isPercent = bloque === "mant";

  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    const zona = (cols[zonaIdx] ?? "").trim().toUpperCase();
    if (!zona) continue;
    const rec: Record<string, number | null> = {};
    for (const [field, idx] of Object.entries(fieldIdx)) {
      const cell = cols[idx] ?? "";
      rec[field] = isPercent ? parsePercent(cell) : parseNum(cell);
    }
    values[zona] = rec;
    zonas.push(zona);
  }

  if (zonas.length === 0) return { values: {}, zonas: [], error: "No se detectaron filas con zona." };
  return { values, zonas };
}

// ─── Supabase ────────────────────────────────────────────────────────────────

const ALL_FIELDS = [...TECNICO_FIELDS, ...POVA_FIELDS, ...MANT_FIELDS] as const;

function emptyRow(periodo: string, zona: string): IdoRow {
  const r = { periodo, zona } as IdoRow;
  for (const f of ALL_FIELDS) (r as unknown as Record<string, unknown>)[f] = null;
  return r;
}

export async function getRows(periodo: string): Promise<IdoRow[]> {
  const { data, error } = await supabase
    .from("ido_datos")
    .select("*")
    .eq("periodo", periodo)
    .order("zona", { ascending: true });
  if (error || !data) return [];
  return data as IdoRow[];
}

export async function saveRows(rows: IdoRow[]): Promise<string | null> {
  if (rows.length === 0) return null;
  const { error } = await supabase
    .from("ido_datos")
    .upsert(rows, { onConflict: "periodo,zona" });
  return error?.message ?? null;
}

export async function deleteRow(periodo: string, zona: string): Promise<string | null> {
  const { error } = await supabase
    .from("ido_datos")
    .delete()
    .eq("periodo", periodo)
    .eq("zona", zona);
  return error?.message ?? null;
}

/** Combina filas existentes con lo recién parseado por bloque (no pisa campos con null). */
export function mergeRows(
  periodo: string,
  existing: IdoRow[],
  parsed: Partial<Record<Bloque, ParsedBlock>>
): IdoRow[] {
  const byZona = new Map<string, IdoRow>();
  for (const r of existing) byZona.set(r.zona, { ...r });

  for (const block of Object.values(parsed)) {
    if (!block) continue;
    for (const [zona, rec] of Object.entries(block.values)) {
      const row = byZona.get(zona) ?? emptyRow(periodo, zona);
      for (const [field, val] of Object.entries(rec)) {
        if (val !== null) (row as unknown as Record<string, unknown>)[field] = val;
      }
      byZona.set(zona, row);
    }
  }

  return [...byZona.values()].sort((a, b) => a.zona.localeCompare(b.zona));
}
