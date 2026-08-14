import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";

// ─── Buscador global ─────────────────────────────────────────────────────────
// Fase 1: Matrículas + Planilla OP. Ver supabase/busqueda_global.sql.
//
// Jerarquía del dominio: SIC → OP (= OC en algunas bases) → línea → envío.
// La línea es QUÉ se compra (una matrícula por línea); el envío es en cuántas
// cuotas lo entrega el proveedor. Cada fila del índice es un (OP, línea, envío).

export interface BusquedaRow {
  id:                  number;
  // 'op'          → fila de compra de planillas_op
  // 'catalogo'    → matrícula que no aparece en ninguna OP ni movimiento
  // 'transaccion' → movimientos de una OP que ya no está en la planilla actual
  // 'sic'         → línea de SIC sin OP todavía (pedido pendiente)
  fuente:              "op" | "catalogo" | "transaccion" | "sic";

  // Matrícula
  articulo:            string | null;   // código crudo ("00009411.0")
  articulo_key:        string | null;   // normalizado ("00009411")
  descripcion:         string | null;
  unidad_medida:       string | null;
  estado_matricula:    string | null;   // activo / inactivo
  tipo:                string | null;   // material / servicio (matricula_tipo — manda)
  mat_serv:            string | null;   // material / servicio del catálogo (informativo)
  en_catalogo:         boolean;

  // SIC — el nivel de arriba de la OP. Se cruza por (Número Pedido + Artículo),
  // nunca por línea: la línea de la SIC y la de la OP son numeraciones distintas.
  numero_sic:          string | null;
  sic_linea:           string | null;
  sic_cantidad:        number | null;
  sic_udm:             string | null;
  sic_preparador:      string | null;
  sic_fecha_creacion:  string | null;

  // Compra
  relacion:            string | null;   // OP+línea; no es única (se repite por envío)
  numero_op:           string | null;
  linea:               string | null;
  envio:               string | null;
  envios_linea:        number | null;   // total de envíos de esa (OP, línea) → «1/2»
  proveedor:           string | null;
  // Descripción de la OP — NO la de la matrícula (que va en `descripcion`).
  // Se carga a mano en `op_datos`; ver lib/opDatos.ts.
  op_descripcion:      string | null;
  // Zona manual de `op_datos` si está cargada; si no, la de la planilla.
  zona:                string | null;

  // Cantidades
  cantidad:            number | null;
  cantidad_recibida:   number | null;
  ctd_aceptada:        number | null;
  pendiente:           number | null;
  cantidad_vencida:    number | null;
  cantidad_rechazada:  number | null;
  cantidad_facturada:  number | null;
  cantidad_cancelada:  number | null;

  // Fechas y estados
  fecha_creacion:      string | null;
  fecha_pactada:       string | null;
  estado_autorizacion: string | null;
  estado_cierre:       string | null;

  // Movimientos reales (tablero_op_transaccion), todo el histórico.
  // ⚠ Son totales POR LÍNEA: las transacciones no tienen dimensión de envío,
  // así que si la línea tiene varios envíos todas sus filas repiten el mismo
  // total. Sirven para leer el estado de la línea, no para sumar la columna.
  tx_recibido:         number | null;
  tx_aceptado:         number | null;
  tx_entregado:        number | null;
  tx_devoluciones:     number | null;
  tx_movimientos:      number | null;
  tx_primera_fecha:    string | null;   // ISO YYYY-MM-DD
  tx_ultima_fecha:     string | null;   // ISO YYYY-MM-DD

  // Stock en zona ZA de esa matrícula. NO viene del índice: se cruza en el
  // cliente contra `stock_uploads` (sección «Stock por Zona»), que guarda una
  // fila por zona con todo su stock en un jsonb. Se hace así, y no con un JOIN
  // en la reconstrucción, para que el stock quede fresco sin tener que
  // reconstruir el índice cada vez que se sube una planilla de stock.
  //
  // ⚠ NO es agregable: es el stock de la MATRÍCULA, así que se repite igual en
  //   todas las filas que la compartan (distintas OP, líneas y envíos). Sumar
  //   la columna multiplica el stock — misma regla que las columnas tx_*.
  stock_za?:           number | null;

  updated_at:          string;
}

/**
 * Clave estable de una fila del índice. NO se puede usar `id`: es un bigserial
 * que se borra y regenera entero en cada «Reconstruir» (DELETE + INSERT), así
 * que cambia con cada reconstrucción. Esta sale de los datos de negocio, que sí
 * son estables.
 */
/**
 * Fecha comparable (ms). Las fechas del índice viven como texto y llegan en tres
 * formatos según de qué import salieron: ISO (`2026-03-14`), `dd/mm/aaaa` tal
 * cual lo exporta SIGA, o el `toString()` de un Date. NaN cuando no hay fecha o
 * no se entiende — quien ordene decide qué hacer con eso (por convención, al
 * final).
 *
 * El caso dd/mm/aaaa se resuelve a mano y ANTES del `new Date()` genérico: JS
 * parsea "15/04/2026" como Invalid Date (espera mm/dd), así que sin esta rama
 * esas fechas darían NaN y se irían todas al final al ordenar.
 */
export const fechaMs = (v: unknown): number => {
  if (v == null || v === "") return NaN;
  const s = String(v);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (dmy) return Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]);
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? NaN : t;
};

export const rowKey = (r: BusquedaRow) =>
  `${r.fuente}|${r.articulo_key ?? ""}|${r.numero_op ?? ""}|${r.linea ?? ""}|${r.envio ?? ""}`;

/**
 * Normaliza el código de matrícula igual que gd_norm_articulo() en SQL: quita
 * SOLO el sufijo decimal del export de Excel (".0" / ".00"), nunca ".1" ni ".2"
 * — esos serían variantes distintas. "00009411.0" → "00009411".
 */
export const normArticulo = (raw: string) => raw.trim().replace(/\.0+$/, "");

/**
 * Todas las filas del índice de un conjunto de matrículas. Se usa para volcar
 * una familia entera a una pestaña de seguimiento.
 *
 * Devuelve la granularidad natural del índice: una fila por (OP, línea, envío),
 * más la fila de catálogo si la matrícula nunca se pidió.
 */
export async function buscarPorMatriculas(
  articulos: string[],
  limite = 5000
): Promise<BusquedaRow[]> {
  const keys = [...new Set(articulos.map(normArticulo).filter(Boolean))];
  if (!keys.length) return [];

  // .in() con muchas claves puede pasarse del largo máximo de URL, así que se
  // consulta de a tandas y se junta.
  const TANDA = 100;
  const out: BusquedaRow[] = [];
  for (let i = 0; i < keys.length; i += TANDA) {
    const { data, error } = await supabase
      .from("busqueda_index")
      .select("*")
      .in("articulo_key", keys.slice(i, i + TANDA))
      .order("articulo_key", { ascending: true })
      .order("numero_op",   { ascending: true })
      .order("linea",       { ascending: true })
      .order("envio",       { ascending: true })
      .range(0, limite - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as BusquedaRow[]));
    if (out.length >= limite) break;
  }
  return out.slice(0, limite);
}

/**
 * Campo único al que puede acotarse la búsqueda (selector al lado de la caja
 * de texto). `null`/`undefined` = todos los campos, el comportamiento de
 * siempre. Las claves son las mismas columnas de `BusquedaRow` — no hace
 * falta traducción entre lo que se muestra y lo que se manda.
 */
export type CampoBusqueda = "numero_sic" | "sic_preparador" | "numero_op" | "articulo" | "descripcion";

/**
 * Ejecuta la búsqueda. `q` vacío devuelve las primeras filas del índice.
 * `soloSic` acota el universo a las filas que tienen SIC asociada (vista
 * «SICs de Soler»); se combina con la búsqueda de texto, no la reemplaza.
 */
export async function buscar(
  q: string,
  limite = 500,
  campo?: CampoBusqueda | null,
  soloSic = false,
): Promise<BusquedaRow[]> {
  const { data, error } = await supabase
    .rpc("gd_buscar", { p_q: q, p_limite: limite, p_campo: campo ?? null, p_solo_sic: soloSic })
    .range(0, Math.max(limite - 1, 0));
  if (error) throw new Error(error.message);
  return (data ?? []) as BusquedaRow[];
}

/** Reconstruye el índice desde planillas_op + matriculas. Devuelve filas indexadas. */
export async function reconstruirIndice(): Promise<number> {
  const { data, error } = await supabase.rpc("gd_reconstruir_busqueda");
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

/**
 * Dispara la reconstrucción del índice en segundo plano, sin que la pantalla
 * que la llama tenga que esperarla ni saber nada de `busqueda_index`.
 *
 * Pensado para colgarlo del `finally` de un import masivo (OP, MATRICULAS, SIC,
 * transacciones): son las cuatro fuentes de `busqueda_index` y, al ser cargas
 * completas poco frecuentes (semanales), el usuario ya no tiene que acordarse
 * de ir al Buscador y tocar «Reconstruir» después de cada una.
 *
 * Deliberadamente NO se usa para ediciones sueltas (una matrícula, un override
 * de Material/Servicio, un renglón del catálogo): el RPC puede tardar hasta 10
 * minutos con el volumen real (ver `statement_timeout` en
 * `gd_reconstruir_busqueda`), así que dispararlo en cada edición chica dejaría
 * al usuario esperando por algo que no pidió. Para esos casos sigue estando el
 * botón manual «Reconstruir» del Buscador.
 */
export function reconstruirIndiceEnSegundoPlano(origen: string): void {
  reconstruirIndice()
    .then((n) => {
      toast.success(`Índice del Buscador actualizado tras ${origen} — ${n.toLocaleString("es-AR")} fila(s).`);
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (/timeout|57014/i.test(msg)) {
        toast.error(
          `El índice del Buscador no se reconstruyó solo (tardó demasiado tras ${origen}) — hacelo manualmente desde Buscador o corré «SELECT gd_reconstruir_busqueda();» en el SQL Editor.`,
          { duration: 12000 }
        );
      } else {
        toast.error(`No se pudo actualizar el índice del Buscador tras ${origen}: ${msg}`);
      }
    });
}

/** Cantidad de filas actualmente indexadas y fecha de la última reconstrucción. */
export async function estadoIndice(): Promise<{ filas: number; actualizado: string | null }> {
  const { count, error } = await supabase
    .from("busqueda_index")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);

  const { data } = await supabase
    .from("busqueda_index")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);

  return {
    filas: count ?? 0,
    actualizado: (data as { updated_at: string }[] | null)?.[0]?.updated_at ?? null,
  };
}

// ─── Detalle de entregas de una línea ────────────────────────────────────────
// Lo comprometido (envíos de planillas_op) contra lo entregado realmente
// (movimientos 'Entregar'), para la fila desplegable del Buscador. Ver
// supabase/buscador_entregas.sql para por qué es una consulta bajo demanda y
// no columnas precalculadas del índice.

/** Un envío de la línea: cuánto se comprometió y para cuándo. */
export interface EnvioLinea {
  envio:         string | null;
  cantidad:      number | null;
  /** Texto crudo del Excel — se formatea con `fechaMs`/`toLocaleDateString`. */
  fecha_pactada: string | null;
}

/** Un movimiento 'Entregar' concreto. */
export interface EntregaLinea {
  fecha:   string;   // ISO YYYY-MM-DD
  importe: number;
}

export interface DetalleEntregas {
  envios:   EnvioLinea[];
  entregas: EntregaLinea[];
  totales: {
    entregado:    number;
    n_entregas:   number;
    comprometido: number;
  };
}

/**
 * Trae el detalle de entregas de UNA línea. `desde`/`hasta` son opcionales:
 * sin ellos devuelve todo el histórico, que es como abre la fila desplegable.
 *
 * ⚠ El grano de `entregas` es la LÍNEA, no el envío: las transacciones no
 *   tienen dimensión de envío. Por eso dos filas del Buscador que solo
 *   difieran en el envío van a mostrar las mismas entregas.
 */
export async function fetchEntregasLinea(
  numeroOp: string,
  articulo: string,
  linea: string | null,
  desde?: string | null,
  hasta?: string | null,
): Promise<DetalleEntregas> {
  const { data, error } = await supabase.rpc("gd_entregas_linea", {
    p_numero_op: numeroOp,
    p_articulo:  articulo,
    p_linea:     linea ?? "",
    p_desde:     desde ?? null,
    p_hasta:     hasta ?? null,
  });
  if (error) throw new Error(error.message);

  // La función devuelve una sola fila; si la OP/línea no existe, ninguna.
  const row = (data as DetalleEntregas[] | null)?.[0];
  return row ?? { envios: [], entregas: [], totales: { entregado: 0, n_entregas: 0, comprometido: 0 } };
}
