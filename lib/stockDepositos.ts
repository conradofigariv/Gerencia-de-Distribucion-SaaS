// Depósito de cada zona (Stock por Zona → Mapa). Tabla `stock_zona_depositos`
// — SQL en supabase/stock_zona_depositos.sql. Sin fila para una zona = se usa
// la localidad de la delegación sede.

import { supabase } from "@/lib/supabaseClient";
import type { UnidadCode } from "@/lib/mapaZonas";

export interface Deposito { unidad: UnidadCode; localidad: string; lat: number; lon: number }

const SIN_TABLA = "Falta crear la tabla de depósitos: corré supabase/stock_zona_depositos.sql en Supabase.";
const esSinTabla = (msg: string, code?: string) => code === "42P01" || code === "PGRST205" || /does not exist|could not find the table/i.test(msg);

/** Depósitos configurados. Si la tabla todavía no existe, devuelve [] (se usan las sedes). */
export async function getDepositos(): Promise<Deposito[]> {
  const { data, error } = await supabase.from("stock_zona_depositos").select("unidad, localidad, lat, lon");
  if (error || !data) return [];
  return data.map((r) => ({ unidad: r.unidad as UnidadCode, localidad: r.localidad as string, lat: Number(r.lat), lon: Number(r.lon) }));
}

/** Guarda (o reemplaza) el depósito de una zona. Devuelve un mensaje de error o null. */
export async function guardarDeposito(d: Deposito): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("stock_zona_depositos").upsert({
    unidad: d.unidad, localidad: d.localidad, lat: d.lat, lon: d.lon,
    updated_at: new Date().toISOString(), updated_by: u.user?.id ?? null,
  });
  if (!error) return null;
  return esSinTabla(error.message, error.code) ? SIN_TABLA : error.message;
}

/** Vuelve a usar la sede como depósito de la zona. */
export async function quitarDeposito(unidad: UnidadCode): Promise<string | null> {
  const { error } = await supabase.from("stock_zona_depositos").delete().eq("unidad", unidad);
  if (!error) return null;
  return esSinTabla(error.message, error.code) ? SIN_TABLA : error.message;
}
