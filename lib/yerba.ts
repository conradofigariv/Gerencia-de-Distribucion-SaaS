import { supabase } from "@/lib/supabaseClient";

// ─── Control de Yerba ───────────────────────────────────────────────────────
// De quién es el turno de comprar. Ver supabase/yerba.sql para el modelo.
//
// La regla de la oficina: cada compra es 1 kg de UNA marca, o 1/2 kg de DOS
// marcas (para poder comparar). `KILOS_POR_MARCAS` la deja en un solo lugar.

export const KILOS_POR_MARCAS: Record<number, number> = { 1: 1, 2: 0.5 };

export interface Participante {
  id:      string;
  user_id: string | null;   // null = cargado a mano, solo con nombre
  nombre:  string;
  orden:   number;
  activo:  boolean;
}

export interface CompraMarca {
  marca: string;
  kilos: number;
}

export interface Compra {
  id:              string;
  participante_id: string;
  fecha:           string;         // ISO YYYY-MM-DD
  nota:            string | null;
  marcas:          CompraMarca[];
}

/** Participante + su última compra, que es lo que la pantalla muestra. */
export interface FilaTurno {
  participante: Participante;
  ultima:       Compra | null;
  compras:      number;
  esProximo:    boolean;
}

// ─── Lecturas ───────────────────────────────────────────────────────────────

export async function fetchParticipantes(): Promise<Participante[]> {
  const { data, error } = await supabase
    .from("yerba_participantes")
    .select("id, user_id, nombre, orden, activo")
    .order("orden")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Participante[];
}

export async function fetchCompras(): Promise<Compra[]> {
  const { data, error } = await supabase
    .from("yerba_compras")
    .select("id, participante_id, fecha, nota, yerba_compra_marca(marca, kilos)")
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  type Row = Omit<Compra, "marcas"> & { yerba_compra_marca: CompraMarca[] | null };
  return ((data ?? []) as Row[]).map((c) => ({
    id: c.id, participante_id: c.participante_id, fecha: c.fecha, nota: c.nota,
    marcas: c.yerba_compra_marca ?? [],
  }));
}

/** Marcas ya compradas alguna vez, para sugerir al cargar (sin repetir). */
export async function fetchMarcasUsadas(): Promise<string[]> {
  const { data, error } = await supabase
    .from("yerba_compra_marca")
    .select("marca")
    .order("marca");
  if (error) throw new Error(error.message);
  return [...new Set(((data ?? []) as { marca: string }[]).map((m) => m.marca))];
}

// ─── Turno ──────────────────────────────────────────────────────────────────

/**
 * Arma las filas de la pantalla y marca de quién es el próximo turno.
 *
 * Rotación en ORDEN FIJO: el próximo es el que sigue —dando la vuelta— al que
 * compró último. No se guarda un puntero de "turno actual" en la base a
 * propósito: derivarlo del historial hace imposible que queden desincronizados
 * (y que borrar o corregir una compra deje el turno apuntando a cualquier
 * lado).
 *
 * `compras` tiene que venir ordenada de más nueva a más vieja, como la
 * devuelve `fetchCompras`.
 *
 * Casos borde que importan:
 *  • Sin compras todavía → le toca al primero de la lista.
 *  • El último comprador ya no está activo (o lo sacaron) → se busca hacia
 *    atrás en el historial al último comprador que SÍ siga activo. Sin esto,
 *    dar de baja a alguien dejaría el turno colgado sin referencia.
 *  • Nadie del historial sigue activo → arranca de nuevo por el primero.
 */
export function construirTurnos(participantes: Participante[], compras: Compra[]): FilaTurno[] {
  const activos = participantes.filter((p) => p.activo);

  const ultimaPorParticipante = new Map<string, Compra>();
  const contadas = new Map<string, number>();
  for (const c of compras) {
    if (!ultimaPorParticipante.has(c.participante_id)) ultimaPorParticipante.set(c.participante_id, c);
    contadas.set(c.participante_id, (contadas.get(c.participante_id) ?? 0) + 1);
  }

  let proximoId: string | null = activos[0]?.id ?? null;
  if (activos.length) {
    const idxUltimo = compras.findIndex((c) => activos.some((p) => p.id === c.participante_id));
    if (idxUltimo !== -1) {
      const pos = activos.findIndex((p) => p.id === compras[idxUltimo].participante_id);
      proximoId = activos[(pos + 1) % activos.length].id;
    }
  }

  return participantes.map((p) => ({
    participante: p,
    ultima:       ultimaPorParticipante.get(p.id) ?? null,
    compras:      contadas.get(p.id) ?? 0,
    esProximo:    p.id === proximoId,
  }));
}

// ─── Escrituras ─────────────────────────────────────────────────────────────

export async function agregarParticipante(
  nombre: string,
  userId: string | null,
  ordenFinal: number,
): Promise<void> {
  const { error } = await supabase
    .from("yerba_participantes")
    .insert({ nombre: nombre.trim(), user_id: userId, orden: ordenFinal });
  if (error) {
    // El índice único sobre user_id es la única forma realista de chocar acá.
    if (error.code === "23505") throw new Error("Esa persona ya está en la ronda.");
    throw new Error(error.message);
  }
}

export async function borrarParticipante(id: string): Promise<void> {
  const { error } = await supabase.from("yerba_participantes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setActivo(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from("yerba_participantes").update({ activo }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Reescribe el `orden` de toda la lista según el array recibido. */
export async function guardarOrden(ids: string[]): Promise<void> {
  const updates = ids.map((id, i) =>
    supabase.from("yerba_participantes").update({ orden: i }).eq("id", id)
  );
  const res = await Promise.all(updates);
  const err = res.find((r) => r.error)?.error;
  if (err) throw new Error(err.message);
}

/**
 * Registra una compra con sus marcas.
 *
 * Valida la regla del kilo acá y no solo en la UI: es la única forma de que no
 * dependa de qué pantalla llame a esta función.
 */
export async function registrarCompra(
  participanteId: string,
  fecha: string,
  marcas: string[],
  nota: string | null,
): Promise<void> {
  const limpias = marcas.map((m) => m.trim()).filter(Boolean);
  const kilos = KILOS_POR_MARCAS[limpias.length];
  if (!kilos) throw new Error("Tiene que ser 1 kg de una marca, o ½ kg de dos marcas.");

  const { data, error } = await supabase
    .from("yerba_compras")
    .insert({ participante_id: participanteId, fecha, nota: nota?.trim() || null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const compraId = (data as { id: string }).id;
  const { error: errM } = await supabase
    .from("yerba_compra_marca")
    .insert(limpias.map((marca) => ({ compra_id: compraId, marca, kilos })));
  if (errM) {
    // Sin las marcas la compra no cumple la regla y ensuciaría el historial:
    // se deshace para no dejar una compra a medio guardar.
    await supabase.from("yerba_compras").delete().eq("id", compraId);
    throw new Error(errM.message);
  }
}

export async function borrarCompra(id: string): Promise<void> {
  const { error } = await supabase.from("yerba_compras").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
