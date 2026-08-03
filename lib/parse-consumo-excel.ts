// Parser de la hoja "3-TRAFOS. ENTREGADOS" del informe mensual.
//
// La hoja trae tres bloques con la misma grilla de sectores × potencias:
// NUEVOS, REPARADOS POR TERCEROS y REPARADOS POR EPEC. Los dos de reparados
// se suman en un único bloque "reparados": no interesa quién reparó.

import * as XLSX from "xlsx";
import {
  SECTORES,
  POT_CONSUMO,
  type ConsumoDatos,
  type ConsumoPorSector,
} from "./consumo-transformadores";

const TITULO_BLOQUE = "CANTIDADES POR POTENCIA";
const NOMBRE_HOJA   = "TRAFOS. ENTREGADOS";

export interface ParseConsumoResult {
  /** "YYYY-MM" si se pudo leer del título del informe. */
  mes: string | null;
  datos: ConsumoDatos;
  /** Diferencias entre el archivo y lo esperado, para mostrar al usuario. */
  avisos: string[];
}

// ─── Normalización ────────────────────────────────────────────────────────────

/** Saca acentos, puntuación y mayúsculas para comparar nombres de sector. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SECTOR_POR_NORM = new Map(SECTORES.map(s => [norm(s), s]));
const POT_VALIDAS = new Set<number>(POT_CONSUMO);

const MESES: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04",
  mayo: "05", junio: "06", julio: "07", agosto: "08",
  septiembre: "09", setiembre: "09", octubre: "10",
  noviembre: "11", diciembre: "12",
};

// ─── Lectura de celdas ────────────────────────────────────────────────────────

type Grid = (string | number | null)[][];

/** Vuelca la hoja a una matriz densa, para recorrerla por índices. */
function toGrid(ws: XLSX.WorkSheet): Grid {
  return XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
}

const texto = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v).trim();

const numero = (v: unknown): number =>
  typeof v === "number" ? v : Number(texto(v)) || 0;

// ─── Parseo ───────────────────────────────────────────────────────────────────

/** Elige la hoja de transformadores entregados, tolerando variantes de nombre. */
function elegirHoja(wb: XLSX.WorkBook): string | null {
  const objetivo = norm(NOMBRE_HOJA);
  return (
    wb.SheetNames.find(n => norm(n).includes(objetivo)) ??
    wb.SheetNames.find(n => norm(n).includes("entregados")) ??
    null
  );
}

/** "INFORME MES ENERO 2025 - ..." → "2025-01" */
function mesDesdeTitulo(grid: Grid): string | null {
  for (const fila of grid.slice(0, 6)) {
    for (const celda of fila) {
      const t = norm(texto(celda));
      if (!t.includes("informe mes")) continue;
      const m = /informe mes ([a-z]+) (\d{4})/.exec(t);
      if (m && MESES[m[1]]) return `${m[2]}-${MESES[m[1]]}`;
    }
  }
  return null;
}

/** Suma un bloque sobre el acumulador, en lugar de pisarlo. */
function acumularBloque(
  destino: ConsumoPorSector,
  grid: Grid,
  filaTitulo: number,
  avisos: string[]
): void {
  // La fila siguiente al título es el encabezado con SECTOR y las potencias.
  const filaHeader = filaTitulo + 1;
  const header = grid[filaHeader];
  if (!header) return;

  const colDePotencia = new Map<number, number>();
  header.forEach((celda, col) => {
    const p = numero(celda);
    if (p > 0 && POT_VALIDAS.has(p)) colDePotencia.set(col, p);
  });
  if (colDePotencia.size === 0) return;

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
      const cand = SECTOR_POR_NORM.get(norm(texto(celda)));
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

  if (vistos < SECTORES.length) {
    avisos.push(`Se encontraron ${vistos} de ${SECTORES.length} sectores en un bloque.`);
  }
}

/** Extrae el consumo del mes desde un workbook ya abierto. */
export function parseConsumoWorkbook(wb: XLSX.WorkBook): ParseConsumoResult {
  const avisos: string[] = [];

  const nombreHoja = elegirHoja(wb);
  if (!nombreHoja) {
    throw new Error(
      `No se encontró la hoja "3-${NOMBRE_HOJA}". Hojas del archivo: ${wb.SheetNames.join(", ")}`
    );
  }

  const grid = toGrid(wb.Sheets[nombreHoja]);
  const datos: ConsumoDatos = { nuevos: {}, reparados: {} };

  let bloques = 0;
  grid.forEach((fila, r) => {
    for (const celda of fila) {
      const t = texto(celda).toUpperCase();
      if (!t.includes(TITULO_BLOQUE)) continue;
      bloques++;
      // Todo lo que no sea "NUEVOS" se acumula como reparado, sin distinguir
      // si lo reparó EPEC o un tercero.
      const destino = t.includes("NUEVOS") ? datos.nuevos : datos.reparados;
      acumularBloque(destino, grid, r, avisos);
      break;
    }
  });

  if (bloques === 0) {
    throw new Error(`La hoja "${nombreHoja}" no tiene bloques de "${TITULO_BLOQUE}".`);
  }
  if (bloques !== 3) {
    avisos.push(`Se esperaban 3 bloques (nuevos + 2 de reparados) y se encontraron ${bloques}.`);
  }

  return { mes: mesDesdeTitulo(grid), datos, avisos };
}

/** Igual que `parseConsumoWorkbook`, partiendo de los bytes del archivo. */
export function parseConsumoExcel(buf: ArrayBuffer | Buffer): ParseConsumoResult {
  return parseConsumoWorkbook(XLSX.read(buf, { type: "buffer" }));
}
