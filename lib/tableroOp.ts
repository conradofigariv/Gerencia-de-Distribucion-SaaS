import { supabase } from "@/lib/supabaseClient";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface SeguimientoRow {
  numero_sic:    number;
  linea:         string | null;
  articulo:      string;
  descripcion:   string | null;
  cantidad:      number | null;
  udm:           string | null;
  ctd_entregada: number;
  numero_op:     number | null;
}

// ─── Helpers de normalización ────────────────────────────────────────────────

// Normaliza el código de artículo: quita el sufijo ".0" que agrega el export de
// Excel manteniendo el zero-padding original (ej. "00013242.0" → "00013242").
// El cruce entre tablas solo funciona si TODAS normalizan igual.
export function normArticulo(raw: unknown): string {
  return String(raw ?? "").trim().replace(/\.0+$/, "");
}

// Parsea un número con coma decimal y/o puntos de miles (formato es-AR).
export function parseNum(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/\s/g, "");
  if (s.includes(",")) {
    // coma = decimal → quito puntos de miles y convierto coma en punto
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Parsea un entero (bigint en BD). Acepta el sufijo ".0" del export de Excel.
export function parseEntero(raw: unknown): number | null {
  const n = parseNum(raw);
  if (n === null) return null;
  return Math.trunc(n);
}

// ─── CRUD de tablero_op_seguimiento ──────────────────────────────────────────

export async function getSeguimiento(): Promise<SeguimientoRow[]> {
  const { data, error } = await supabase
    .from("tablero_op_seguimiento")
    .select("numero_sic, linea, articulo, descripcion, cantidad, udm, ctd_entregada, numero_op")
    .order("numero_sic", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SeguimientoRow[];
}

// Upsert por numero_sic (PK). Inserta nuevas y pisa existentes.
export async function upsertSeguimiento(rows: SeguimientoRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("tablero_op_seguimiento")
      .upsert(rows.slice(i, i + 500), { onConflict: "numero_sic" });
    if (error) throw new Error(error.message);
  }
}

export async function deleteSeguimiento(numeroSic: number): Promise<void> {
  const { error } = await supabase
    .from("tablero_op_seguimiento")
    .delete()
    .eq("numero_sic", numeroSic);
  if (error) throw new Error(error.message);
}

export async function deleteSeguimientoBulk(numeros: number[]): Promise<void> {
  const { error } = await supabase
    .from("tablero_op_seguimiento")
    .delete()
    .in("numero_sic", numeros);
  if (error) throw new Error(error.message);
}

export async function clearSeguimiento(): Promise<void> {
  const { error } = await supabase
    .from("tablero_op_seguimiento")
    .delete()
    .not("numero_sic", "is", null);
  if (error) throw new Error(error.message);
}
