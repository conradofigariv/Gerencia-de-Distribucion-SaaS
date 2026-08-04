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

/**
 * Acota qué meses entran en el cálculo. Es distinto de `FiltroConsumo`: aquel
 * filtra celdas dentro de un mes, este elige qué meses se consideran.
 */
export interface FiltroPeriodo {
  /** Año calendario. `undefined` = todos. */
  anio?: number;
  /** Mes del año (1–12), para comparar el mismo mes entre años. `undefined` = todos. */
  mesDelAnio?: number;
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

/** Consumo acumulado de una categoría (una potencia, un sector) en el período. */
export interface PuntoAgregado {
  /** Valor crudo de la categoría: `"315"` o `"Mant. Sur"`. */
  clave: string;
  /** Cómo se muestra en el eje del gráfico. */
  etiqueta: string;
  total: number;
  /** `total` dividido los meses con registro, para comparar contra el promedio. */
  promedio: number;
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

/** Años presentes en los registros, de más nuevo a más viejo. */
export function aniosDisponibles(registros: readonly ConsumoMes[]): number[] {
  const set = new Set<number>();
  for (const r of registros) {
    const a = Number(r.mes.slice(0, 4));
    if (Number.isFinite(a)) set.add(a);
  }
  return [...set].sort((x, y) => y - x);
}

/** Deja solo los meses que caen dentro del período. */
export function filtrarPorPeriodo(
  registros: readonly ConsumoMes[],
  periodo: FiltroPeriodo = {}
): ConsumoMes[] {
  const { anio, mesDelAnio } = periodo;
  if (anio === undefined && mesDelAnio === undefined) return [...registros];
  return registros.filter(r => {
    const a = Number(r.mes.slice(0, 4));
    const m = Number(r.mes.slice(5, 7));
    return (anio === undefined || a === anio) && (mesDelAnio === undefined || m === mesDelAnio);
  });
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
  filtro: FiltroConsumo = {},
  periodo: FiltroPeriodo = {}
): PuntoSerie[] {
  return filtrarPorPeriodo(registros, periodo)
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

// ─── Desgloses para gráficos ──────────────────────────────────────────────────

/**
 * Recorre las celdas que pasan el filtro dentro del período y las entrega una
 * por una. Devuelve cuántos meses se recorrieron, que es el denominador del
 * promedio — el mismo criterio que `promedios`: meses **con registro**.
 */
function recorrerCeldas(
  registros: readonly ConsumoMes[],
  filtro: FiltroConsumo,
  periodo: FiltroPeriodo,
  visitar: (sector: string, potencia: string, cantidad: number) => void
): number {
  const sectores  = filtro.sectores?.length ? new Set(filtro.sectores) : null;
  const potencias = filtro.potencias?.length ? new Set(filtro.potencias.map(String)) : null;

  const meses = filtrarPorPeriodo(registros, periodo);

  for (const { datos } of meses) {
    const bloques: ConsumoPorSector[] = [];
    if (filtro.tipo !== "reparados") bloques.push(datos.nuevos);
    if (filtro.tipo !== "nuevos")    bloques.push(datos.reparados);

    for (const bloque of bloques) {
      for (const [sector, porPot] of Object.entries(bloque)) {
        if (sectores && !sectores.has(sector)) continue;
        for (const [pot, cant] of Object.entries(porPot)) {
          if (potencias && !potencias.has(pot)) continue;
          if (cant > 0) visitar(sector, pot, cant);
        }
      }
    }
  }
  return meses.length;
}

/** Arma los puntos ya divididos por la cantidad de meses. */
function agregados(
  acum: Map<string, number>,
  meses: number,
  orden: (claves: string[]) => string[],
  etiquetar: (clave: string) => string
): PuntoAgregado[] {
  return orden([...acum.keys()]).map(clave => {
    const total = acum.get(clave) ?? 0;
    return { clave, etiqueta: etiquetar(clave), total, promedio: meses > 0 ? total / meses : 0 };
  });
}

/**
 * Consumo por potencia en el período. Se ordena por kVA creciente y no por
 * volumen: la potencia es una escala, y leerla desordenada esconde justamente
 * la forma de la distribución.
 */
export function totalesPorPotencia(
  registros: readonly ConsumoMes[],
  filtro: FiltroConsumo = {},
  periodo: FiltroPeriodo = {}
): PuntoAgregado[] {
  const acum = new Map<string, number>();
  const meses = recorrerCeldas(registros, filtro, periodo, (_s, pot, cant) => {
    acum.set(pot, (acum.get(pot) ?? 0) + cant);
  });
  return agregados(acum, meses, claves => claves.sort((a, b) => Number(a) - Number(b)), c => `${c} kVA`);
}

/**
 * Consumo por sector en el período, de mayor a menor. Acá sí ordena el volumen:
 * entre sectores no hay orden natural, y lo que se busca es el ranking.
 */
export function totalesPorSector(
  registros: readonly ConsumoMes[],
  filtro: FiltroConsumo = {},
  periodo: FiltroPeriodo = {}
): PuntoAgregado[] {
  const acum = new Map<string, number>();
  const meses = recorrerCeldas(registros, filtro, periodo, (sector, _p, cant) => {
    acum.set(sector, (acum.get(sector) ?? 0) + cant);
  });
  return agregados(
    acum,
    meses,
    claves => claves.sort((a, b) => (acum.get(b) ?? 0) - (acum.get(a) ?? 0)),
    c => c
  );
}

// ─── Presentación ─────────────────────────────────────────────────────────────

const MESES_CORTOS = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

/** Nombres completos, indexados por mes − 1. */
export const NOMBRES_MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const;

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
