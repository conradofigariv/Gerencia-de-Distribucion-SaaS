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
    let bloques = 0;
    let mencionaEntrega = false;

    for (const fila of toGrid(wb.Sheets[nombre])) {
      for (const celda of fila) {
        const t = texto(celda).toUpperCase();
        if (!t) continue;
        if (t.includes(TITULO_BLOQUE)) bloques++;
        if (t.includes("ENTREGAD") || t.includes("ENTREGARON")) mencionaEntrega = true;
      }
    }

    if (bloques === 0) continue;
    const puntaje = bloques + (mencionaEntrega ? 10 : 0);
    if (!mejor || puntaje > mejor.puntaje) mejor = { nombre, puntaje };
  }

  return mejor?.nombre ?? null;
}

/** "INFORME MES ENERO 2025 …" o "INFORME DEL MES DE ENERO 2021…" → "2025-01" */
function mesDesdeTitulo(grid: Grid): string | null {
  for (const fila of grid.slice(0, 6)) {
    for (const celda of fila) {
      const t = norm(texto(celda));
      if (!t.includes("informe")) continue;
      const m = /informe(?:\s+\w+){0,3}?\s*mes(?:\s+de)?\s+([a-z]+)\s+(\d{4})/.exec(t);
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

  // La cantidad de sectores cambia según el año (los informes viejos no traen
  // todos), así que solo se avisa si prácticamente no se reconoció ninguno.
  if (vistos < 5) {
    avisos.push(`Solo se reconocieron ${vistos} sectores en un bloque; revisá los totales.`);
  }
}

/** Extrae el consumo del mes desde un workbook ya abierto. */
export function parseConsumoWorkbook(wb: XLSX.WorkBook): ParseConsumoResult {
  const avisos: string[] = [];

  const nombreHoja = elegirHoja(wb);
  if (!nombreHoja) {
    throw new Error(
      `Ninguna hoja del archivo tiene bloques de "${TITULO_BLOQUE}". ` +
      `Hojas encontradas: ${wb.SheetNames.join(", ")}`
    );
  }

  const grid = toGrid(wb.Sheets[nombreHoja]);
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
    throw new Error(`La hoja "${nombreHoja}" no tiene bloques de "${TITULO_BLOQUE}".`);
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

/** Igual que `parseConsumoWorkbook`, partiendo de los bytes del archivo. */
export function parseConsumoExcel(buf: ArrayBuffer | Buffer): ParseConsumoResult {
  return parseConsumoWorkbook(XLSX.read(buf, { type: "buffer" }));
}
