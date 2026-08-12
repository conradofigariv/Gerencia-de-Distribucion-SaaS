import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { BusquedaRow } from "@/lib/busqueda";

/**
 * `error.message` de Supabase muchas veces es genérico ("new row violates
 * row-level security policy for table X") y no dice POR QUÉ — el motivo real
 * suele venir en `details`/`hint`/`code`, que se descartaban en cada
 * `throw new Error(error.message)` de este archivo. Esta función junta todo
 * lo disponible para que el toast de error en pantalla ya traiga la pista,
 * sin tener que ir a mirar la Network tab cada vez.
 */
function errorSupabase(error: PostgrestError): Error {
  const partes = [error.message];
  if (error.details) partes.push(`Detalle: ${error.details}`);
  if (error.hint)    partes.push(`Pista: ${error.hint}`);
  if (error.code)    partes.push(`(código ${error.code})`);
  return new Error(partes.join(" — "));
}

// ─── Pestañas del Buscador ───────────────────────────────────────────────────
// Listas de seguimiento privadas: se copian filas del índice maestro y desde
// ahí son del usuario (editables, reordenables). Ver supabase/buscador_tabs.sql.
//
// ⚠ Es una COPIA, no una referencia viva al índice. `row_key` solo guarda de
//   dónde salió, para avisar de duplicados y para el refresco manual.

/** Claves de las columnas de seguimiento dentro de `datos`. El guion bajo evita
 *  que choquen con una columna del índice, ahora o en el futuro. */
export const TRACK_KEYS = {
  nota:           "_nota",
  estado:         "_estado",
  responsable:    "_responsable",
  fechaRevision:  "_fecha_revision",
  // Marca de "mostrar esta fila en la tarjeta Próximas Entregas" del Resumen de
  // Transformadores. Se guarda como "true" / "" (string) y no como booleano
  // para no romper las filas ya existentes, cuyo `datos` no tiene la clave: el
  // resto del código de seguimiento ya trata todo con String(datos[k] ?? "").
  enTarjeta:      "_en_tarjeta",
} as const;

export const ESTADOS = ["Pendiente", "En curso", "Resuelto"] as const;
export type Estado = (typeof ESTADOS)[number];

/** Eje de agrupado de una pestaña — igual a las claves de BusquedaRow que se
 *  usan como criterio (matrícula usa `articulo_key`/`articulo`, no una clave
 *  propia, por eso "articulo" es un alias especial en vez de una columna real). */
export type AgruparPor = "articulo" | "numero_sic" | "numero_op";

export interface TabConfig {
  order?:      string[];
  hidden?:     string[];
  widths?:     Record<string, number>;
  // Vista de agrupado — cada pestaña puede mirar sus filas agrupadas por un eje
  // distinto (o sin agrupar), independiente de las demás.
  agrupar?:    boolean;
  agruparPor?: AgruparPor;
  // Claves de los grupos que quedaron PLEGADOS. Se guarda lo cerrado y no lo
  // abierto porque los grupos nacen abiertos: así una pestaña recién creada, o
  // una OP nueva que aparece después, arranca visible sin necesidad de que
  // alguien la agregue a una lista.
  colapsados?: string[];
}

export interface BuscadorTab {
  id:         string;
  user_id:    string;
  nombre:     string;
  orden:      number;
  color:      string | null;
  config:     TabConfig;
  created_at: string;
  updated_at: string;
}

/** Una fila copiada. `datos` tiene la fila completa del índice más las claves
 *  de seguimiento; todo es editable. */
export interface TabFila {
  id:         string;
  tab_id:     string;
  datos:      Record<string, unknown>;
  row_key:    string | null;
  orden:      number;
  created_at: string;
  updated_at: string;
}

// ─── Pestañas ────────────────────────────────────────────────────────────────

/**
 * Todas las pestañas visibles para el usuario: las propias MÁS las que otros
 * compartieron con él. No se filtra por `user_id` acá — la RLS de
 * `buscador_tabs` (ver `supabase/buscador_tab_shares.sql`) ya solo devuelve lo
 * que este usuario puede leer, así que filtrar de nuevo en el cliente sería
 * redundante y escondería por error una pestaña compartida.
 */
export async function fetchTabs(userId: string): Promise<BuscadorTab[]> {
  const { data, error } = await supabase
    .from("buscador_tabs")
    .select("*")
    .order("orden", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw errorSupabase(error);
  return (data ?? []) as BuscadorTab[];
}

export async function createTab(userId: string, nombre: string, orden: number): Promise<BuscadorTab> {
  const { data, error } = await supabase
    .from("buscador_tabs")
    .insert({ user_id: userId, nombre, orden })
    .select()
    .single();
  if (error) throw errorSupabase(error);
  return data as BuscadorTab;
}

export async function renameTab(id: string, nombre: string): Promise<void> {
  const { error } = await supabase
    .from("buscador_tabs")
    .update({ nombre, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw errorSupabase(error);
}

export async function updateTabConfig(id: string, config: TabConfig): Promise<void> {
  const { error } = await supabase
    .from("buscador_tabs")
    .update({ config, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw errorSupabase(error);
}

/** Borra la pestaña. Las filas caen solas por ON DELETE CASCADE. */
export async function deleteTab(id: string): Promise<void> {
  const { error } = await supabase.from("buscador_tabs").delete().eq("id", id);
  if (error) throw errorSupabase(error);
}

// ─── Filas ───────────────────────────────────────────────────────────────────

export async function fetchTabFilas(tabId: string): Promise<TabFila[]> {
  const { data, error } = await supabase
    .from("buscador_tab_filas")
    .select("*")
    .eq("tab_id", tabId)
    .order("orden", { ascending: true });
  if (error) throw errorSupabase(error);
  return (data ?? []) as TabFila[];
}

/**
 * Copia filas del índice a una pestaña. Se agregan al final, en el orden en que
 * vienen. Devuelve las filas creadas.
 */
export async function addFilas(
  tabId: string,
  rows: BusquedaRow[],
  rowKeyOf: (r: BusquedaRow) => string,
  ordenBase: number
): Promise<TabFila[]> {
  if (!rows.length) return [];
  const payload = rows.map((r, i) => ({
    tab_id:  tabId,
    row_key: rowKeyOf(r),
    orden:   ordenBase + i,
    // La fila completa, más las columnas de seguimiento vacías.
    datos: {
      ...r,
      [TRACK_KEYS.nota]:          "",
      [TRACK_KEYS.estado]:        "",
      [TRACK_KEYS.responsable]:   "",
      [TRACK_KEYS.fechaRevision]: "",
    } as Record<string, unknown>,
  }));
  const { data, error } = await supabase.from("buscador_tab_filas").insert(payload).select();
  if (error) throw errorSupabase(error);
  return (data ?? []) as TabFila[];
}

/**
 * Las matrículas distintas de una pestaña, normalizadas.
 *
 * Se usa para filtrar otras secciones por «lo que puse en esta pestaña» — hoy
 * el Resumen de Control de servicios. Trae SOLO las dos claves que hacen falta
 * en vez del `datos` entero: una pestaña de cientos de filas pesa varios MB de
 * jsonb y acá alcanza con la lista de códigos.
 *
 * Es deliberado usar la pestaña como conjunto de matrículas y no como fuente de
 * números: las filas copiadas quedan congeladas al momento de agregarlas, pero
 * un código de matrícula no envejece, así que este cruce no arrastra ese
 * problema.
 */
export async function fetchTabMatriculas(tabId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("buscador_tab_filas")
    .select("ak:datos->>articulo_key, a:datos->>articulo")
    .eq("tab_id", tabId);
  if (error) throw errorSupabase(error);

  const out = new Set<string>();
  for (const r of (data ?? []) as unknown as { ak: string | null; a: string | null }[]) {
    // articulo_key ya viene normalizado del índice; `articulo` es el crudo del
    // Excel ("00009411.0") y necesita el mismo trim que gd_norm_articulo().
    const k = (r.ak ?? r.a ?? "").trim().replace(/\.0+$/, "");
    if (k) out.add(k);
  }
  return [...out];
}

/** Una fila marcada con «En tarjeta», ya reducida a lo que la tarjeta muestra. */
export interface FilaMarcada {
  id:            string;
  fechaPactada:  string | null;   // ISO o el crudo de la planilla; puede faltar
  // Respaldo cuando la fila no trae fecha pactada (típico de las fuentes
  // `transaccion` y `catalogo`, que no salen de la planilla OP): la fecha que
  // el usuario carga a mano en las columnas Personalizadas.
  fechaRevision: string | null;
  articulo:      string | null;
  descripcion:   string | null;
  numeroOp:      string | null;
  linea:         string | null;
  envio:         string | null;
  enviosLinea:   number | null;   // total de envíos de esa (OP, línea) → «1/2»
  proveedor:     string | null;
  zona:          string | null;
  cantidad:      number | null;
  pendiente:     number | null;
  estadoSeg:     string | null;
  responsable:   string | null;
}

/**
 * Filas de una pestaña marcadas con «En tarjeta» (`_en_tarjeta === "true"`).
 *
 * El filtro va en el servidor (`datos->>_en_tarjeta`) y no en el cliente: una
 * pestaña puede tener miles de filas y la tarjeta muestra un puñado, así que
 * traerlas todas para descartarlas acá sería tirar la mayor parte del payload.
 * El orden por fecha, en cambio, se hace en el cliente: `fecha_pactada` vive
 * dentro del jsonb y puede venir en formatos distintos según el import, así que
 * ordenar en SQL sobre el texto crudo daría un orden equivocado.
 */
export async function fetchFilasMarcadas(tabId: string): Promise<FilaMarcada[]> {
  const { data, error } = await supabase
    .from("buscador_tab_filas")
    .select("id, datos")
    .eq("tab_id", tabId)
    .eq(`datos->>${TRACK_KEYS.enTarjeta}`, "true");
  if (error) throw errorSupabase(error);

  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));

  return ((data ?? []) as { id: string; datos: Record<string, unknown> }[]).map((f) => ({
    id:            f.id,
    fechaPactada:  str(f.datos.fecha_pactada),
    fechaRevision: str(f.datos[TRACK_KEYS.fechaRevision]),
    articulo:      str(f.datos.articulo),
    descripcion:   str(f.datos.descripcion),
    numeroOp:      str(f.datos.numero_op),
    linea:         str(f.datos.linea),
    envio:         str(f.datos.envio),
    enviosLinea:   num(f.datos.envios_linea),
    proveedor:     str(f.datos.proveedor),
    zona:          str(f.datos.zona),
    cantidad:      num(f.datos.cantidad),
    pendiente:     num(f.datos.pendiente),
    estadoSeg:     str(f.datos[TRACK_KEYS.estado]),
    responsable:   str(f.datos[TRACK_KEYS.responsable]),
  }));
}

/**
 * Marca o desmarca varias filas para la tarjeta «Próximas Entregas».
 *
 * Se manda un update por fila en vez de un upsert masivo a propósito: el upsert
 * sería INSERT ... ON CONFLICT, y eso exige pasar también la policy de INSERT
 * de `buscador_tab_filas` — más superficie de RLS de la necesaria para lo que
 * en los hechos es siempre un UPDATE sobre filas que ya existen.
 *
 * `datos` se reescribe entero (no hay patch de jsonb desde el cliente), así que
 * se parte del que ya está en memoria y se le pisa una sola clave.
 */
export async function marcarEnTarjeta(
  filas: { id: string; datos: Record<string, unknown> }[],
  valor: boolean,
): Promise<void> {
  if (!filas.length) return;
  const ahora = new Date().toISOString();
  const results = await Promise.all(
    filas.map((f) =>
      supabase
        .from("buscador_tab_filas")
        .update({ datos: { ...f.datos, [TRACK_KEYS.enTarjeta]: valor ? "true" : "" }, updated_at: ahora })
        .eq("id", f.id)
    )
  );
  const fallo = results.find((r) => r.error);
  if (fallo?.error) throw errorSupabase(fallo.error);
}

/** Guarda el `datos` completo de una fila (una celda editada ya viene aplicada). */
export async function updateFilaDatos(id: string, datos: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("buscador_tab_filas")
    .update({ datos, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw errorSupabase(error);
}

export async function deleteFilas(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from("buscador_tab_filas").delete().in("id", ids);
  if (error) throw errorSupabase(error);
}

/** Persiste el orden manual después de un drag. Una llamada por fila movida. */
export async function reorderFilas(filas: { id: string; orden: number }[]): Promise<void> {
  if (!filas.length) return;
  const results = await Promise.all(
    filas.map((f) =>
      supabase.from("buscador_tab_filas").update({ orden: f.orden }).eq("id", f.id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}

// ─── Compartir pestañas ──────────────────────────────────────────────────────
// Ver supabase/buscador_tab_shares.sql para el modelo completo: se comparte
// con usuarios puntuales, con permiso «lectura» o «edición» por persona, y la
// vista (columnas/orden/agrupado) es LA MISMA para todo el que la abre — no
// hay una config por usuario. Solo el dueño gestiona quién tiene acceso.

export type Permiso = "lectura" | "edicion";

export interface TabShare {
  id:         string;
  tab_id:     string;
  user_id:    string;
  permiso:    Permiso;
  created_at: string;
}

/** Un colaborador con su nombre ya resuelto, para pintar la lista sin otra vuelta. */
export interface Colaborador extends TabShare {
  nombre:     string;
  apellido:   string;
  avatar_url: string | null;
}

/**
 * Colaboradores de una pestaña, con nombre y avatar ya resueltos desde
 * `profiles`. Dos consultas en vez de un join: `buscador_tab_shares.user_id`
 * apunta a `auth.users`, no a `profiles`, así que PostgREST no puede
 * embeberlas automáticamente (no hay FK declarada entre esas dos tablas).
 */
export async function fetchColaboradores(tabId: string): Promise<Colaborador[]> {
  const { data: shares, error } = await supabase
    .from("buscador_tab_shares")
    .select("*")
    .eq("tab_id", tabId)
    .order("created_at", { ascending: true });
  if (error) throw errorSupabase(error);
  const rows = (shares ?? []) as TabShare[];
  if (!rows.length) return [];

  const ids = rows.map((r) => r.user_id);
  const { data: perfiles } = await supabase
    .from("profiles")
    .select("id, nombre, apellido, avatar_url")
    .in("id", ids);
  const byId = new Map(
    ((perfiles ?? []) as { id: string; nombre: string | null; apellido: string | null; avatar_url: string | null }[])
      .map((p) => [p.id, p])
  );

  return rows.map((r) => {
    const p = byId.get(r.user_id);
    return { ...r, nombre: p?.nombre ?? "", apellido: p?.apellido ?? "", avatar_url: p?.avatar_url ?? null };
  });
}

/** Comparte (o cambia el permiso de) una pestaña con un usuario puntual. */
export async function compartirTab(tabId: string, userId: string, permiso: Permiso): Promise<void> {
  const { error } = await supabase
    .from("buscador_tab_shares")
    .upsert({ tab_id: tabId, user_id: userId, permiso }, { onConflict: "tab_id,user_id" });
  if (error) throw errorSupabase(error);
}

/** Saca a un colaborador — deja de ver la pestaña en su próxima carga. */
export async function descompartirTab(tabId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("buscador_tab_shares")
    .delete()
    .eq("tab_id", tabId)
    .eq("user_id", userId);
  if (error) throw errorSupabase(error);
}

/**
 * Permiso del usuario ACTUAL en cada pestaña compartida con él (no incluye las
 * propias — para esas, ser dueño ya implica edición completa). Una sola
 * consulta al entrar al Buscador, para no pedir el permiso pestaña por
 * pestaña cada vez que se abre una.
 */
export async function fetchMisPermisos(userId: string): Promise<Map<string, Permiso>> {
  const { data, error } = await supabase
    .from("buscador_tab_shares")
    .select("tab_id, permiso")
    .eq("user_id", userId);
  if (error) throw errorSupabase(error);
  return new Map(((data ?? []) as { tab_id: string; permiso: Permiso }[]).map((r) => [r.tab_id, r.permiso]));
}

/** Perfil mínimo para el picker de "compartir con...". */
export interface PerfilBasico {
  id:         string;
  email:      string;
  nombre:     string;
  apellido:   string;
  avatar_url: string | null;
}

/**
 * Todo el equipo, para elegir con quién compartir — buscable por nombre O por
 * email, porque no todos tienen el nombre completado en su perfil. El email
 * vive en `auth.users`, no en `profiles` (que es lo único legible directo
 * desde el cliente, ver `supabase/profile_cumpleanos.sql`), así que hace
 * falta pasar por `/api/team` (service role) en vez de una query directa.
 */
export async function fetchEquipo(): Promise<PerfilBasico[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/team", {
    headers: { Authorization: `Bearer ${session?.access_token}` },
  });
  if (!res.ok) throw new Error("No se pudo cargar el equipo");
  const json = await res.json();
  return (json.equipo ?? []) as PerfilBasico[];
}
