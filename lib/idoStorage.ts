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

// ─── Cálculo del IDO ──────────────────────────────────────────────────────────────────────
// KPI semestral binario (valor ≤ meta → 100%). KPI final = promedio de los
// semestres cargados. Resultado Técnico: ambos 100% → 100%, uno → 50%, ninguno → 0%.
// IDO = Técnico×0,5 + POVA×0,25 + Mantenimiento×0,25.

export interface IdoMetas {
  // Umbrales técnicos (usados en el KPI binario)
  fmikS1: number;
  fmikS2: number;
  dmikS1: number;
  dmikS2: number;
  // POVA — el objetivo de Transferido (≥) es el que usa el cálculo; el resto es referencia
  povaTransferido: number;
  povaFinObra: number;
  povaCreados: number;
  // Mantenimiento — metas de referencia (no alteran el cálculo: Mant = promedio)
  podaMt: number;
  podaBt: number;
  termografia: number;
}

export const DEFAULT_METAS: IdoMetas = {
  fmikS1: 3.16,
  fmikS2: 2.58,
  dmikS1: 1.1,
  dmikS2: 0.66,
  povaTransferido: 95,
  povaFinObra: 100,
  povaCreados: 0,
  podaMt: 95,
  podaBt: 80,
  termografia: 100,
};

export interface IdoCalc {
  zona: string;
  fmikS1: number | null;
  fmikS2: number | null;
  dmikS1: number | null;
  dmikS2: number | null;
  kpiFmikS1: number | null; // 1 | 0 | null
  kpiFmikS2: number | null;
  kpiFmik: number | null;    // promedio de los semestres cargados (0..1)
  kpiDmikS1: number | null;
  kpiDmikS2: number | null;
  kpiDmik: number | null;
  resultadoTecnico: number | null; // 0 | 0.5 | 1
  pova: number | null;             // 0..1
  mantenimiento: number | null;    // 0..1
  ido: number | null;              // 0..1
}

function kpiBin(value: number | null, meta: number): number | null {
  if (value === null) return null;
  return value <= meta ? 1 : 0;
}

function avgDefined(...xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// Normaliza un porcentaje a fracción 0..1 (acepta puntos 0–100 o fracción 0–1).
function toFrac(v: number): number {
  return v > 1 ? v / 100 : v;
}

export function computeIdo(row: IdoRow, metas: IdoMetas = DEFAULT_METAS): IdoCalc {
  const kpiFmikS1 = kpiBin(row.fmik_s1, metas.fmikS1);
  const kpiFmikS2 = kpiBin(row.fmik_s2, metas.fmikS2);
  const kpiDmikS1 = kpiBin(row.dmik_s1, metas.dmikS1);
  const kpiDmikS2 = kpiBin(row.dmik_s2, metas.dmikS2);
  const kpiFmik = avgDefined(kpiFmikS1, kpiFmikS2);
  const kpiDmik = avgDefined(kpiDmikS1, kpiDmikS2);

  let resultadoTecnico: number | null = null;
  if (kpiFmik !== null && kpiDmik !== null) {
    const cF = kpiFmik === 1;
    const cD = kpiDmik === 1;
    resultadoTecnico = cF && cD ? 1 : cF || cD ? 0.5 : 0;
  }

  // POVA = mín(100%, Ejecutado / objetivo); Ejecutado = (Transferido + Fin de obra) / Total
  let pova: number | null = null;
  if (row.pova_transferido !== null && row.pova_fin_obra !== null && row.pova_total) {
    const ejec = (row.pova_transferido + row.pova_fin_obra) / row.pova_total;
    pova = Math.min(1, ejec / (metas.povaTransferido / 100));
  }

  // Mantenimiento = promedio de Poda BT, Poda MT y Termografía. Siempre divide por 3
  // (valores faltantes cuentan como 0).
  const mantRaw = [row.mant_poda_bt, row.mant_poda_mt, row.mant_termografia];
  const mantenimiento = mantRaw.every((x) => x === null)
    ? null
    : mantRaw.reduce((a, x) => a + (x !== null ? toFrac(x) : 0), 0) / 3;

  let ido: number | null = null;
  if (resultadoTecnico !== null && pova !== null && mantenimiento !== null) {
    ido = resultadoTecnico * 0.5 + pova * 0.25 + mantenimiento * 0.25;
  }

  return {
    zona: row.zona,
    fmikS1: row.fmik_s1, fmikS2: row.fmik_s2,
    dmikS1: row.dmik_s1, dmikS2: row.dmik_s2,
    kpiFmikS1, kpiFmikS2, kpiFmik,
    kpiDmikS1, kpiDmikS2, kpiDmik,
    resultadoTecnico, pova, mantenimiento, ido,
  };
}

// ─── Metas persistidas (tabla ido_metas, una fila por periodo) ────────────────

function pick(v: unknown, def: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}

export async function getMetas(periodo: string): Promise<IdoMetas> {
  const { data, error } = await supabase
    .from("ido_metas")
    .select("*")
    .eq("periodo", periodo)
    .maybeSingle();
  if (error || !data) return { ...DEFAULT_METAS };
  const d = data as Record<string, unknown>;
  return {
    fmikS1: pick(d.fmik_s1, DEFAULT_METAS.fmikS1),
    fmikS2: pick(d.fmik_s2, DEFAULT_METAS.fmikS2),
    dmikS1: pick(d.dmik_s1, DEFAULT_METAS.dmikS1),
    dmikS2: pick(d.dmik_s2, DEFAULT_METAS.dmikS2),
    povaTransferido: pick(d.pova_transferido, DEFAULT_METAS.povaTransferido),
    povaFinObra: pick(d.pova_fin_obra, DEFAULT_METAS.povaFinObra),
    povaCreados: pick(d.pova_creados, DEFAULT_METAS.povaCreados),
    podaMt: pick(d.poda_mt, DEFAULT_METAS.podaMt),
    podaBt: pick(d.poda_bt, DEFAULT_METAS.podaBt),
    termografia: pick(d.termografia, DEFAULT_METAS.termografia),
  };
}

export async function saveMetas(periodo: string, m: IdoMetas): Promise<string | null> {
  const { error } = await supabase.from("ido_metas").upsert(
    {
      periodo,
      fmik_s1: m.fmikS1, fmik_s2: m.fmikS2,
      dmik_s1: m.dmikS1, dmik_s2: m.dmikS2,
      pova_transferido: m.povaTransferido, pova_fin_obra: m.povaFinObra, pova_creados: m.povaCreados,
      poda_mt: m.podaMt, poda_bt: m.podaBt, termografia: m.termografia,
    },
    { onConflict: "periodo" }
  );
  return error?.message ?? null;
}

// Lista de períodos con datos cargados (para el desplegable de años).
export async function listPeriodos(): Promise<string[]> {
  const { data, error } = await supabase.from("ido_datos").select("periodo");
  if (error || !data) return [];
  return [...new Set((data as { periodo: string }[]).map((r) => r.periodo))].sort().reverse();
}
