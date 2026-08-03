// Front-end de PDF para el informe de transformadores entregados.
//
// Un PDF no tiene celdas: solo fragmentos de texto con coordenadas. Para poder
// reusar el mismo parseo que el Excel hay que reconstruir la cuadrícula, y eso
// se hace agrupando por posición: los fragmentos que comparten altura son una
// fila, y los que comparten posición horizontal son una columna.

import { parseConsumoGrid, type Grid, type ParseConsumoResult } from "./parse-consumo-grid";

interface Fragmento {
  texto: string;
  /** Centro horizontal, no borde izquierdo: es lo único estable entre filas. */
  x: number;
  y: number;
  alto: number;
}

/** Agrupa valores cercanos y devuelve el centro de cada grupo, ordenado. */
function agrupar(valores: number[], tolerancia: number): number[] {
  if (valores.length === 0) return [];
  const ordenados = [...valores].sort((a, b) => a - b);

  const centros: number[] = [];
  let grupo: number[] = [ordenados[0]];

  for (const v of ordenados.slice(1)) {
    if (v - grupo[grupo.length - 1] <= tolerancia) {
      grupo.push(v);
    } else {
      centros.push(grupo.reduce((a, b) => a + b, 0) / grupo.length);
      grupo = [v];
    }
  }
  centros.push(grupo.reduce((a, b) => a + b, 0) / grupo.length);
  return centros;
}

/**
 * Tolerancia para separar columnas, deducida del espaciado real de la tabla.
 *
 * No sirve derivarla del tamaño de fuente: en este informe las cantidades de
 * algunas filas están corridas ~10 puntos respecto del encabezado, más que el
 * alto de la letra, así que una tolerancia chica las manda a una columna
 * fantasma y sus valores se pierden. El espaciado entre columnas (~30) sí es
 * regular, y media distancia entre columnas separa bien sin partir de más.
 */
function toleranciaColumnas(centros: number[], minimo: number): number {
  if (centros.length < 3) return minimo;
  const huecos: number[] = [];
  for (let i = 1; i < centros.length; i++) huecos.push(centros[i] - centros[i - 1]);
  huecos.sort((a, b) => a - b);
  const mediana = huecos[Math.floor(huecos.length / 2)];
  return Math.max(mediana * 0.45, minimo);
}

/** Índice del centro más cercano. */
function indiceMasCercano(centros: number[], valor: number): number {
  let mejor = 0;
  let dist = Infinity;
  centros.forEach((c, i) => {
    const d = Math.abs(c - valor);
    if (d < dist) { dist = d; mejor = i; }
  });
  return mejor;
}

/**
 * Reconstruye una grilla a partir de fragmentos posicionados.
 *
 * Las columnas se calculan sobre TODA la página, no fila por fila: si cada fila
 * definiera sus propias columnas, una fila con celdas vacías correría los
 * valores hacia la izquierda y dejarían de alinearse con el encabezado de
 * potencias, que es justamente lo que da sentido a cada número.
 */
function fragmentosAGrilla(frags: Fragmento[]): Grid {
  if (frags.length === 0) return [];

  const altoMediano =
    [...frags.map(f => f.alto)].sort((a, b) => a - b)[Math.floor(frags.length / 2)] || 10;

  const tolFila = Math.max(altoMediano * 0.6, 2);

  const filasY = agrupar(frags.map(f => f.y), tolFila);
  // Dos pasadas: la primera revela el espaciado de la tabla, la segunda agrupa
  // con una tolerancia acorde a ese espaciado.
  const preliminar = agrupar(frags.map(f => f.x), Math.max(altoMediano * 0.4, 2));
  const colsX = agrupar(frags.map(f => f.x), toleranciaColumnas(preliminar, altoMediano * 0.9));

  // El PDF numera Y de abajo hacia arriba: se invierte para leer de arriba abajo.
  const ordenFilas = [...filasY].sort((a, b) => b - a);

  const grid: Grid = ordenFilas.map(() => new Array(colsX.length).fill(null));

  for (const f of frags) {
    const yCentro = filasY[indiceMasCercano(filasY, f.y)];
    const fila = ordenFilas.indexOf(yCentro);
    const col = indiceMasCercano(colsX, f.x);
    if (fila < 0) continue;

    const previo = grid[fila][col];
    // Dos fragmentos en la misma celda son un texto partido: se reconstruye.
    grid[fila][col] = previo === null ? f.texto : `${previo} ${f.texto}`;
  }

  // Los números quedan como string tras la extracción; se convierten para que
  // el encabezado de potencias y las cantidades se lean como tales.
  return grid.map(fila =>
    fila.map(celda => {
      if (typeof celda !== "string") return celda;
      const t = celda.trim();
      if (t === "") return null;
      return /^-?\d+(?:[.,]\d+)?$/.test(t) ? Number(t.replace(",", ".")) : t;
    })
  );
}

/**
 * Al cargarse, pdfjs ejecuta `new DOMMatrix()` a nivel de módulo (una matriz de
 * escala reusada al renderizar a canvas), sin condicionarlo a que esa API
 * exista. `DOMMatrix` es del navegador; en Node, pdfjs intenta reemplazarla
 * requiriendo el paquete opcional `@napi-rs/canvas` (un binario nativo), y si
 * eso falla se limita a advertir y sigue sin definirla. El import entero
 * revienta ahí mismo con "ReferenceError: DOMMatrix is not defined", antes de
 * llegar a parsear nada — es justamente lo que pasaba en Vercel, donde ese
 * binario nativo no resuelve para su plataforma.
 *
 * Acá solo se extrae texto con `getTextContent()`, nunca se renderiza una
 * página a canvas, así que ningún método real de `DOMMatrix` se invoca jamás:
 * alcanza con un stub que no explote al construirse. Se define ANTES de
 * importar pdfjs para que ni siquiera intente cargar el binario nativo —
 * depender de que un paquete nativo resuelva igual en todas las plataformas de
 * deploy es exactamente la causa raíz de este bug.
 */
function asegurarPolyfillDOMMatrix(): void {
  const g = globalThis as { DOMMatrix?: unknown };
  if (typeof g.DOMMatrix !== "undefined") return;
  g.DOMMatrix = class DOMMatrixStub {
    constructor(..._args: unknown[]) {}
  };
}

/** Extrae el consumo del mes desde los bytes de un PDF. */
export async function parseConsumoPdf(buf: ArrayBuffer | Buffer): Promise<ParseConsumoResult> {
  asegurarPolyfillDOMMatrix();

  // Import diferido y del build legacy: pdfjs es ESM y trae APIs de browser que
  // rompen si se resuelve al cargar el módulo en el servidor.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const data = buf instanceof Buffer ? new Uint8Array(buf) : new Uint8Array(buf);
  const tarea = pdfjs.getDocument({ data, useSystemFonts: true });
  const doc = await tarea.promise;

  const avisos: string[] = [];
  const frags: Fragmento[] = [];
  let desplazamientoY = 0;

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    const alto = page.getViewport({ scale: 1 }).height;

    for (const item of items) {
      if (!("str" in item)) continue;
      const t = item.str.trim();
      if (!t) continue;
      frags.push({
        texto: t,
        x: item.transform[4] + (item.width ?? 0) / 2,
        // Las páginas se apilan para que un informe partido en dos siga siendo
        // un solo flujo de filas.
        y: item.transform[5] - desplazamientoY,
        alto: Math.abs(item.height) || 10,
      });
    }
    desplazamientoY += alto;
  }

  await tarea.destroy();

  if (frags.length === 0) {
    throw new Error(
      "El PDF no tiene texto extraíble. Si es un escaneo o una imagen, " +
      "cargá el mes a mano o usá el Excel."
    );
  }

  return parseConsumoGrid(fragmentosAGrilla(frags), avisos);
}
