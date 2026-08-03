// Parseo del informe de transformadores entregados, sobre una grilla ya
// extraída. Es el núcleo compartido: Excel y PDF solo se encargan de producir
// la grilla, y de acá en adelante el tratamiento es idéntico.
//
// El informe trae bloques con la misma cuadrícula de sectores × potencias:
// NUEVOS, REPARADOS POR TERCEROS y REPARADOS POR EPEC. Los dos de reparados se
// suman en uno solo: no interesa quién reparó. Los informes viejos traen un
// único bloque sin tipo, que cuenta como nuevos.

import {
  SECTORES,
  POT_CONSUMO,
  type ConsumoDatos,
  type ConsumoPorSector,
} from "./consumo-transformadores";

export const TITULO_BLOQUE = "CANTIDADES POR POTENCIA";

/** Matriz densa de celdas, indexada [fila][columna]. */
export type Grid = (string | number | null)[][];

export interface ParseConsumoResult {
  /** "YYYY-MM" si se pudo leer del título del informe. */
  mes: string | null;
  datos: ConsumoDatos;
  /** Diferencias entre el archivo y lo esperado, para mostrar al usuario. */
  avisos: string[];
}

// ─── Normalización ────────────────────────────────────────────────────────────

/** Saca acentos, puntuación y mayúsculas para comparar nombres de sector. */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const texto = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v).trim();

export const numero = (v: unknown): number =>
  typeof v === "number" ? v : Number(texto(v)) || 0;

const SECTOR_POR_NORM = new Map(SECTORES.map(s => [norm(s), s]));
const POT_VALIDAS = new Set<number>(POT_CONSUMO);

const MESES: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04",
  mayo: "05", junio: "06", julio: "07", agosto: "08",
  septiembre: "09", setiembre: "09", octubre: "10",
  noviembre: "11", diciembre: "12",
};

// ─── Parseo ───────────────────────────────────────────────────────────────────

/** "INFORME MES ENERO 2025 …" o "INFORME DEL MES DE ENERO 2021…" → "2025-01" */
function mesDesdeTitulo(grid: Grid): string | null {
  for (const fila of grid.slice(0, 8)) {
    for (const celda of fila) {
      const t = norm(texto(celda));
      if (!t.includes("informe")) continue;
      const m = /informe(?:\s+\w+){0,3}?\s*mes(?:\s+de)?\s+([a-z]+)\s+(\d{4})/.exec(t);
      if (m && MESES[m[1]]) return `${m[2]}-${MESES[m[1]]}`;
    }
  }
  return null;
}

/**
 * Reconoce un sector a partir del texto de una celda.
 *
 * Además del match exacto acepta que el nombre venga acompañado: al extraer de
 * un PDF, el rótulo de grupo "Zona A" flota junto a la primera fila de su grupo
 * y puede terminar pegado al nombre del sector en la misma celda. Se elige el
 * nombre más largo que aparezca, para que "Zona B - La Falda" no pierda contra
 * un candidato más corto contenido en él.
 */
function reconocerSector(celda: string): string | null {
  const t = norm(celda);
  if (!t) return null;

  const exacto = SECTOR_POR_NORM.get(t);
  if (exacto) return exacto;

  let mejor: string | null = null;
  for (const [clave, nombre] of SECTOR_POR_NORM) {
    if (t.includes(clave) && (!mejor || clave.length > norm(mejor).length)) mejor = nombre;
  }
  return mejor;
}

/** Suma un bloque sobre el acumulador, en lugar de pisarlo. */
function acumularBloque(
  destino: ConsumoPorSector,
  grid: Grid,
  filaTitulo: number,
  avisos: string[]
): void {
  // El encabezado con SECTOR y las potencias está justo debajo del título, pero
  // en PDF puede caer una fila más abajo si el título ocupa dos renglones.
  let filaHeader = -1;
  let colDePotencia = new Map<number, number>();

  for (let r = filaTitulo + 1; r <= filaTitulo + 3 && r < grid.length; r++) {
    const fila = grid[r];
    if (!fila) continue;
    const cols = new Map<number, number>();
    fila.forEach((celda, col) => {
      const p = numero(celda);
      if (p > 0 && POT_VALIDAS.has(p)) cols.set(col, p);
    });
    // Un encabezado real trae varias potencias, no un número suelto.
    if (cols.size >= 4) { filaHeader = r; colDePotencia = cols; break; }
  }
  if (filaHeader < 0) return;

  // Filas de sector, hasta agotar los conocidos o llegar al TOTAL del bloque.
  let vistos = 0;
  for (let r = filaHeader + 1; r < grid.length && vistos < SECTORES.length; r++) {
    const fila = grid[r];
    if (!fila) continue;

    const etiquetas = fila.map(texto).filter(Boolean);
    if (etiquetas.some(t => norm(t).startsWith("total"))) break;

    // El nombre del sector es la primera celda de texto que matchea el catálogo;
    // la columna previa puede traer el rótulo agrupador "Zona A".
    let sector: string | null = null;
    for (const celda of fila.slice(0, 3)) {
      const cand = reconocerSector(texto(celda));
      if (cand) { sector = cand; break; }
    }
    if (!sector) continue;
    vistos++;

    for (const [col, pot] of colDePotencia) {
      const cant = numero(fila[col]);
      if (cant <= 0) continue;
      destino[sector] ??= {};
      destino[sector][String(pot)] = (destino[sector][String(pot)] ?? 0) + cant;
    }
  }

  // La cantidad de sectores cambia según el año (los informes viejos no traen
  // todos), así que solo se avisa si prácticamente no se reconoció ninguno.
  if (vistos < 5) {
    avisos.push(`Solo se reconocieron ${vistos} sectores en un bloque; revisá los totales.`);
  }
}

/** ¿Cuántos bloques del informe tiene esta grilla? Sirve para elegir la hoja. */
export function contarBloques(grid: Grid): { bloques: number; mencionaEntrega: boolean } {
  let bloques = 0;
  let mencionaEntrega = false;
  for (const fila of grid) {
    for (const celda of fila) {
      const t = texto(celda).toUpperCase();
      if (!t) continue;
      if (t.includes(TITULO_BLOQUE)) bloques++;
      if (t.includes("ENTREGAD") || t.includes("ENTREGARON")) mencionaEntrega = true;
    }
  }
  return { bloques, mencionaEntrega };
}

/** Extrae el consumo del mes desde una grilla, venga de Excel o de PDF. */
export function parseConsumoGrid(grid: Grid, avisos: string[] = []): ParseConsumoResult {
  const datos: ConsumoDatos = { nuevos: {}, reparados: {} };

  let bloques = 0;
  let sinTipo = 0;

  grid.forEach((fila, r) => {
    for (const celda of fila) {
      const t = texto(celda).toUpperCase();
      if (!t.includes(TITULO_BLOQUE)) continue;
      bloques++;

      // Solo se acumula como reparado lo que lo dice explícitamente, sin
      // distinguir si lo reparó EPEC o un tercero. Los informes viejos traen
      // un único bloque sin tipo: esos cuentan como nuevos.
      const esReparado = t.includes("REPARADO");
      if (!esReparado && !t.includes("NUEVOS")) sinTipo++;

      acumularBloque(esReparado ? datos.reparados : datos.nuevos, grid, r, avisos);
      break;
    }
  });

  if (bloques === 0) {
    throw new Error(`No se encontraron bloques de "${TITULO_BLOQUE}" en el documento.`);
  }
  if (sinTipo > 0) {
    avisos.push(
      "El informe no separa nuevos de reparados; esos transformadores se cargaron como «nuevos»."
    );
  } else if (bloques !== 3) {
    avisos.push(`Se esperaban 3 bloques (nuevos + 2 de reparados) y se encontraron ${bloques}.`);
  }

  return { mes: mesDesdeTitulo(grid), datos, avisos };
}
