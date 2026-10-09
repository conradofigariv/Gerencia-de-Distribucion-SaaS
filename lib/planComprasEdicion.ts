// ─────────────────────────────────────────────────────────────────────────────
// Plan de Compras — edición en celda de la grilla «Global» (puro).
//
//   • Qué se puede editar: las columnas de DATO. Las 17 fórmula se recalculan
//     solas y Artículo no se toca (es la identidad de la fila).
//   • Validación: números en formato es-AR («1.234,5») o con punto decimal
//     («1234.5», lo que pega Excel en inglés). 0 se guarda como null, igual
//     que en la importación.
//   • «Modificada»: la primera vez que se edita una celda se guarda su valor
//     importado en `importado[clave]`; si se vuelve a ese valor, la marca se
//     va. «Restaurar» vuelve al valor importado.
// ─────────────────────────────────────────────────────────────────────────────

import {
  COLUMNA_POR_CLAVE, CLAVES_NUMERO, esCalculada,
  type ClaveCarga, type ClaveColumna, type PlanComprasItem,
} from "@/lib/planComprasCalc";

const NUMERICAS = new Set<string>(CLAVES_NUMERO);
/** Columnas de dato que no se editan. */
const BLOQUEADAS = new Set<ClaveColumna>(["articulo"]);

/**
 * Dónde se guarda lo que se escribe en una columna. Casi siempre es la misma
 * clave; «Total Ajustado» es fórmula (PU ajustado × CANT. APROBADAS) pero se
 * puede pisar a mano, y el monto escrito va a `total_ajustado_dato`.
 * null = la columna no se edita (fórmula o Artículo).
 */
export function claveDato(k: ClaveColumna): ClaveCarga | null {
  if (k === "total_ajustado") return "total_ajustado_dato";
  if (esCalculada(k) || BLOQUEADAS.has(k)) return null;
  return k as ClaveCarga;
}

export const esEditable = (k: ClaveColumna): boolean => claveDato(k) != null;
export const esNumericaCarga = (k: ClaveCarga) => NUMERICAS.has(k);

export type Valor = string | number | null;

export type Parseo = { ok: true; valor: Valor } | { ok: false; error: string };

/**
 * Número escrito o pegado → number. Acepta «1.234,56», «1234,56», «1234.56»,
 * «1.234.567», «$ 1.234», «-5». Vacío → null. 0 → null (como la importación).
 */
export function parseNumero(texto: string): Parseo {
  let t = texto.trim().replace(/\s|\$| /g, "");
  if (t === "" || t === "-" || t === "–") return { ok: true, valor: null };
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(t)) {
    t = t.replace(/\./g, "");                       // 1.234.567 → miles
  } else if (/^-?\d{1,3}\.\d{3}$/.test(t) && !/^-?0\./.test(t)) {
    t = t.replace(".", "");                         // 1.234 → mil doscientos… (es-AR)
  }
  if (!/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(t)) return { ok: false, error: `«${texto.trim()}» no es un número` };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, error: `«${texto.trim()}» no es un número` };
  return { ok: true, valor: n === 0 ? null : n };
}

export function parseValor(col: ClaveColumna, texto: string): Parseo {
  const k = claveDato(col);
  if (!k) return { ok: false, error: "La columna no se edita" };
  if (esNumericaCarga(k)) {
    const r = parseNumero(texto);
    // Total Ajustado escrito en 0 es un dato («no se aprobó»), no «vacío =
    // calcular»: vaciarlo con Supr es lo que vuelve a la fórmula.
    if (r.ok && r.valor == null && k === "total_ajustado_dato" && !["", "-", "–"].includes(texto.trim())) return { ok: true, valor: 0 };
    return r;
  }
  const t = texto.trim();
  return { ok: true, valor: t === "" ? null : t };
}

const F_EDIT = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 10, useGrouping: false });

/** Texto con el que arranca el editor (y el que se copia): número sin miles,
 *  coma decimal, para que Excel en es-AR lo pegue como número. */
export function textoDeValor(v: Valor | undefined): string {
  if (v == null) return "";
  return typeof v === "number" ? F_EDIT.format(v) : v;
}

const iguales = (a: Valor | undefined, b: Valor | undefined) => (a ?? null) === (b ?? null);

/** Valor actual de una celda de dato. */
export const valorCelda = (it: PlanComprasItem, k: ClaveCarga): Valor =>
  (it as unknown as Record<ClaveCarga, Valor>)[k];

/**
 * Devuelve la fila con la celda cambiada (sin mutar). Lleva la marca de
 * «modificada»: guarda el valor importado la primera vez y la saca si se
 * vuelve a ese valor. null si no hay cambio.
 */
export function conCambio(it: PlanComprasItem, col: ClaveColumna, valor: Valor): PlanComprasItem | null {
  const k = claveDato(col);
  if (!k) return null;
  const actual = valorCelda(it, k);
  if (iguales(actual, valor)) return null;
  const imp = { ...(it.importado ?? {}) };
  if (!(k in imp)) imp[k] = actual;
  else if (iguales(imp[k], valor)) delete imp[k];
  return { ...it, [k]: valor, importado: Object.keys(imp).length ? imp : null };
}

export const estaModificada = (it: PlanComprasItem, col: ClaveColumna) => {
  const k = claveDato(col);
  return !!k && !!it.importado && Object.prototype.hasOwnProperty.call(it.importado, k);
};

/** Fila con la celda vuelta a su valor importado (null si no estaba modificada). */
export function restaurada(it: PlanComprasItem, col: ClaveColumna): PlanComprasItem | null {
  const k = claveDato(col);
  if (!k || !estaModificada(it, col)) return null;
  return conCambio(it, col, it.importado![k] ?? null);
}

/** Descripción del valor importado para el tooltip de una celda modificada. */
export function textoImportado(it: PlanComprasItem, col: ClaveColumna): string {
  const k = claveDato(col);
  const v = k ? it.importado?.[k] : null;
  if (v == null) return col === "total_ajustado" ? "(calculado: PU ajustado × CANT. APROBADAS)" : "(vacía)";
  return typeof v === "number" ? textoDeValor(v) : `«${v}»`;
}

// ─── Portapapeles (formato de Excel: tabulador + salto de línea) ─────────────

/** Bloque pegado → matriz de textos. Respeta celdas entre comillas con saltos. */
export function parseTsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { celda += '"'; i++; } else comillas = false;
      } else celda += ch;
    } else if (ch === '"' && celda === "") {
      comillas = true;
    } else if (ch === "\t") {
      fila.push(celda); celda = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda); filas.push(fila); fila = []; celda = "";
    } else celda += ch;
  }
  if (celda !== "" || fila.length) { fila.push(celda); filas.push(fila); }
  // Excel termina el bloque con un salto de línea: la última fila vacía sobra.
  while (filas.length && filas[filas.length - 1].every((c) => c === "")) filas.pop();
  return filas;
}

/** Celda de texto para el portapapeles. */
export function celdaTsv(v: string): string {
  return /[\t\n\r"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Título de la columna para mensajes («CANT. APROBADAS»). */
export const tituloColumna = (k: ClaveColumna) => COLUMNA_POR_CLAVE[k]?.titulo ?? k;
