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

// Fila tal cual sale de la base — incluye `id` (PK uuid). `numero_sic` NO es
// único: una SIC puede traer varias líneas (distintos artículos pedidos juntos)
// e incluso líneas "ampliadas" (recompra/recontratación) con notación 1,1 / 2,2.
// La clave real es (numero_sic, linea).
export interface SeguimientoDbRow extends SeguimientoRow {
  id: string;
}

export interface TransaccionRow {
  tipo:          string;
  importe:       number;
  fecha:         string; // ISO timestamp
  articulo:      string;
  numero_pedido: number;
  linea:         string | null;
  proveedor:     string | null;
}

export interface StockRow {
  organizacion: string;
  articulo:     string;
  en_mano:      number;
}

// Fila calculada que devuelve la RPC gd_tablero (cruce de seguimiento +
// transacciones + stock por zona). Ver supabase/tablero_op_funcion.sql.
export interface TableroRow {
  numero_sic:    number;
  linea:         string | null;
  articulo:      string;
  descripcion:   string | null;
  cantidad:      number | null;
  udm:           string | null;
  ctd_entregada: number;
  numero_op:     number | null;
  proveedor:     string;
  control:       string;       // TOTAL ADEUDADO | TOTAL ENTREGADO | ENTREGA PARCIAL
  stock:         number;
  recibido:      number;
  devoluciones:  number;
  aceptado:      number;
  entregado:     number;
  control2:      string;       // OK | VER
  fecha_pactada: string | null; // Fecha pactada de entrega (texto crudo del Excel)
  entregas:      string[];      // Fechas reales de entrega (ISO YYYY-MM-DD), ordenadas
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

// Parsea fecha en formato "dd/mm/yyyy" o "dd/mm/yyyy hh:mm:ss" (es-AR / SIGA).
// Si no matchea, intenta Date nativo (acepta ISO). Devuelve timestamp ISO o null.
export function parseFechaArg(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, d, mo, y, h = "0", mi = "0", se = "0"] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi.padStart(2, "0")}:${se.padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ─── Helpers genéricos de import (reemplazar todo) ───────────────────────────

export async function getTableCount(table: string): Promise<number> {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// Borra todas las filas de `table` (vía `notNullCol IS NOT NULL`, siempre cierto
// para una columna NOT NULL) e inserta `rows` en lotes de 500.
export async function replaceTable<T extends Record<string, unknown>>(
  table: string,
  notNullCol: string,
  rows: T[]
): Promise<void> {
  const { error: delErr } = await supabase.from(table).delete().not(notNullCol, "is", null);
  if (delErr) throw new Error(delErr.message);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
}

// ─── CRUD de tablero_op_seguimiento ──────────────────────────────────────────

export async function getSeguimiento(): Promise<SeguimientoDbRow[]> {
  const { data, error } = await supabase
    .from("tablero_op_seguimiento")
    .select("id, numero_sic, linea, articulo, descripcion, cantidad, udm, ctd_entregada, numero_op")
    .order("numero_sic", { ascending: true })
    .order("linea", { ascending: true })
    .order("numero_op", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SeguimientoDbRow[];
}

// Upsert por (numero_sic, linea, numero_op) — clave única real. Una SIC trae
// varias líneas y una misma línea puede estar cubierta por varias OPs
// (ampliación/recompra); cada combinación (SIC, línea, OP) es una fila distinta.
// numero_sic+linea solo no alcanza: colapsaría las OPs y se perderían filas.
export async function upsertSeguimiento(rows: SeguimientoRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("tablero_op_seguimiento")
      .upsert(rows.slice(i, i + 500), { onConflict: "numero_sic,linea,numero_op" });
    if (error) throw new Error(error.message);
  }
}

export async function deleteSeguimiento(id: string): Promise<void> {
  const { error } = await supabase
    .from("tablero_op_seguimiento")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteSeguimientoBulk(ids: string[]): Promise<void> {
  const { error } = await supabase
    .from("tablero_op_seguimiento")
    .delete()
    .in("id", ids);
  if (error) throw new Error(error.message);
}

export async function clearSeguimiento(): Promise<void> {
  const { error } = await supabase
    .from("tablero_op_seguimiento")
    .delete()
    .not("numero_sic", "is", null);
  if (error) throw new Error(error.message);
}

// ─── Resumen / RPC ───────────────────────────────────────────────────────────

// Lista de zonas (organizacion) cargadas en stock, para el selector del resumen.
export async function getZonas(): Promise<string[]> {
  const { data, error } = await supabase
    .from("tablero_op_stock")
    .select("organizacion");
  if (error) throw new Error(error.message);
  const set = new Set<string>();
  for (const r of (data ?? []) as { organizacion: string }[]) {
    if (r.organizacion) set.add(r.organizacion);
  }
  return [...set].sort();
}

// Ejecuta el cruce gd_tablero(p_desde, p_hasta, p_zona). La zona solo afecta la
// columna de stock: "" (o null) suma el stock de todas las zonas; una zona
// concreta filtra por esa zona. Se pide un rango amplio porque PostgREST corta
// en 1000 filas por defecto y el seguimiento puede tener más.
export async function runTablero(
  desde: string,
  hasta: string,
  zona: string
): Promise<TableroRow[]> {
  const { data, error } = await supabase
    .rpc("gd_tablero", { p_desde: desde, p_hasta: hasta, p_zona: zona })
    .range(0, 99999);
  if (error) throw new Error(error.message);
  return (data ?? []) as TableroRow[];
}
