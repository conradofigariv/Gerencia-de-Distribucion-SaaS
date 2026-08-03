// Consumo de transformadores — modelo de datos y cálculos.
//
// Fuente: hoja "3-TRAFOS. ENTREGADOS" del informe mensual. Cada informe cubre
// un mes y desglosa las entregas en tres bloques: NUEVOS, REPARADOS POR
// TERCEROS y REPARADOS POR EPEC. Los dos bloques de reparados se unifican en
// un único tipo "reparados" — no interesa quién hizo la reparación.

/** Potencias (kVA) que usa el informe de consumo. */
export const POT_CONSUMO = [
  5, 10, 16, 25, 50, 63, 80, 100, 160, 200, 250, 315, 500, 630, 800, 1000,
] as const;

/**
 * Sectores de entrega, en el orden del informe. Los primeros seis pertenecen a
 * Zona A, que en el Excel figura como rótulo agrupador en la columna previa.
 */
export const SECTORES = [
  "Mant. Sur",
  "Mant. Norte",
  "Mant. Subterr.",
  "Constr. Redes",
  "Inspecciones",
  "Coordinacion Tecnica",
  "Zona B - La Falda",
  "Zona C - Villa María",
  "Zona D - San Francisco",
  "Zona E - Río Ceballos",
  "Zona F - Río Cuarto",
  "Zona G - Bell Ville",
  "Zona H - Alta Gracia",
  "Zona I - Carlos Paz",
] as const;

/** Sectores que el informe agrupa bajo "Zona A". */
export const SECTORES_ZONA_A: readonly string[] = SECTORES.slice(0, 6);

export const TIPOS_CONSUMO = ["nuevos", "reparados"] as const;
export type TipoConsumo = (typeof TIPOS_CONSUMO)[number];

/** sector → potencia (kVA como string) → cantidad. Disperso: solo valores > 0. */
export type ConsumoPorSector = Record<string, Record<string, number>>;

export interface ConsumoDatos {
  nuevos: ConsumoPorSector;
  reparados: ConsumoPorSector;
  obs?: string;
}

/** Un registro por mes. `mes` en formato "YYYY-MM". */
export interface ConsumoMes {
  mes: string;
  datos: ConsumoDatos;
}

export interface FiltroConsumo {
  /** `undefined` = ambos tipos. */
  tipo?: TipoConsumo;
  /** `undefined` o vacío = todas las potencias. */
  potencias?: readonly number[];
  /** `undefined` o vacío = todos los sectores. */
  sectores?: readonly string[];
}

export interface PuntoSerie {
  mes: string;
  nuevos: number;
  reparados: number;
  total: number;
}

export interface PromediosConsumo {
  /** Consumo promedio por mes sobre los meses con datos. */
  mensual: number;
  /** Proyección anualizada: `mensual * 12`. */
  anual: number;
  /** Cantidad de meses que entraron en el promedio. */
  meses: number;
  /** Suma de todos los meses considerados. */
  total: number;
}

// ─── Cálculos ─────────────────────────────────────────────────────────────────

const vacio = (): ConsumoDatos => ({ nuevos: {}, reparados: {} });

/** Normaliza un `datos` posiblemente incompleto que viene de la base. */
export function normalizarDatos(raw: unknown): ConsumoDatos {
  if (!raw || typeof raw !== "object") return vacio();
  const d = raw as Partial<ConsumoDatos>;
  return {
    nuevos: d.nuevos ?? {},
    reparados: d.reparados ?? {},
    obs: d.obs,
  };
}

/** Suma un bloque aplicando los filtros de potencia y sector. */
function sumarBloque(bloque: ConsumoPorSector, filtro: FiltroConsumo): number {
  const sectores = filtro.sectores?.length ? new Set(filtro.sectores) : null;
  const potencias = filtro.potencias?.length
    ? new Set(filtro.potencias.map(String))
    : null;

  let total = 0;
  for (const [sector, porPot] of Object.entries(bloque)) {
    if (sectores && !sectores.has(sector)) continue;
    for (const [pot, cant] of Object.entries(porPot)) {
      if (potencias && !potencias.has(pot)) continue;
      total += cant || 0;
    }
  }
  return total;
}

/** Consumo de un único mes bajo un filtro. */
export function totalDelMes(datos: ConsumoDatos, filtro: FiltroConsumo = {}): number {
  const { tipo } = filtro;
  let total = 0;
  if (tipo !== "reparados") total += sumarBloque(datos.nuevos, filtro);
  if (tipo !== "nuevos") total += sumarBloque(datos.reparados, filtro);
  return total;
}

/**
 * Serie mensual ordenada cronológicamente. El filtro de `tipo` NO se aplica a
 * las columnas `nuevos`/`reparados` — esas siempre traen su valor real para que
 * el detalle pueda mostrar el desglose. Solo `total` respeta el tipo.
 */
export function serieMensual(
  registros: readonly ConsumoMes[],
  filtro: FiltroConsumo = {}
): PuntoSerie[] {
  return registros
    .map(({ mes, datos }) => ({
      mes,
      nuevos: sumarBloque(datos.nuevos, filtro),
      reparados: sumarBloque(datos.reparados, filtro),
      total: totalDelMes(datos, filtro),
    }))
    .sort((a, b) => a.mes.localeCompare(b.mes));
}

/**
 * Promedios sobre los meses **con registro cargado**. Un mes sin planilla no
 * cuenta como cero: se excluye del denominador, porque no saber cuánto se
 * consumió no es lo mismo que no haber consumido nada.
 */
export function promedios(serie: readonly PuntoSerie[]): PromediosConsumo {
  const meses = serie.length;
  const total = serie.reduce((acc, p) => acc + p.total, 0);
  const mensual = meses > 0 ? total / meses : 0;
  return { mensual, anual: mensual * 12, meses, total };
}

// ─── Presentación ─────────────────────────────────────────────────────────────

const MESES_CORTOS = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

/** "2025-01" → "Ene 2025". Devuelve la entrada tal cual si no matchea. */
export function etiquetaMes(mes: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!m) return mes;
  const idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? `${MESES_CORTOS[idx]} ${m[1]}` : mes;
}

/** Redondea a un decimal, sin arrastrar ".0" cuando es entero. */
export function formatPromedio(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
