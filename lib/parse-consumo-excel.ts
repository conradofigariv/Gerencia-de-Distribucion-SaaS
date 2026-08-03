// Front-end de Excel para el informe de transformadores entregados: convierte
// la hoja elegida en una grilla y delega el parseo en `parse-consumo-grid`.

import * as XLSX from "xlsx";
import {
  TITULO_BLOQUE,
  contarBloques,
  parseConsumoGrid,
  type Grid,
  type ParseConsumoResult,
} from "./parse-consumo-grid";

export type { ParseConsumoResult };

/** Vuelca la hoja a una matriz densa, para recorrerla por índices. */
function toGrid(ws: XLSX.WorkSheet): Grid {
  return XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
}

/**
 * Elige la hoja por su contenido. El nombre no importa: según el año, el
 * archivo puede venir como informe completo de varias pestañas o con la hoja
 * suelta y renombrada ("Hoja1").
 *
 * Hay que puntuar en vez de quedarse con la primera que tenga bloques, porque
 * en el informe completo TODAS las pestañas comparten la grilla de "CANTIDADES
 * POR POTENCIA". La de entregados se distingue por nombrar la entrega en sus
 * títulos y por traer más de un bloque.
 */
function elegirHoja(wb: XLSX.WorkBook): string | null {
  let mejor: { nombre: string; puntaje: number } | null = null;

  for (const nombre of wb.SheetNames) {
    const { bloques, mencionaEntrega } = contarBloques(toGrid(wb.Sheets[nombre]));
    if (bloques === 0) continue;
    const puntaje = bloques + (mencionaEntrega ? 10 : 0);
    if (!mejor || puntaje > mejor.puntaje) mejor = { nombre, puntaje };
  }

  return mejor?.nombre ?? null;
}

/** Extrae el consumo del mes desde un workbook ya abierto. */
export function parseConsumoWorkbook(wb: XLSX.WorkBook): ParseConsumoResult {
  const nombreHoja = elegirHoja(wb);
  if (!nombreHoja) {
    throw new Error(
      `Ninguna hoja del archivo tiene bloques de "${TITULO_BLOQUE}". ` +
      `Hojas encontradas: ${wb.SheetNames.join(", ")}`
    );
  }
  return parseConsumoGrid(toGrid(wb.Sheets[nombreHoja]));
}

/** Igual que `parseConsumoWorkbook`, partiendo de los bytes del archivo. */
export function parseConsumoExcel(buf: ArrayBuffer | Buffer): ParseConsumoResult {
  return parseConsumoWorkbook(XLSX.read(buf, { type: "buffer" }));
}
