// ─────────────────────────────────────────────────────────────────────────────
// Plan de Compras — lectura del Excel PC_ANUAL_GD.
//
// Lee las pestañas «Global», «Prioridad» y «Resumen», arma lo que va a la base
// y VERIFICA el cálculo: para cada fila recalcula las columnas fórmula con
// `calcularFila` y las compara con el valor que el propio Excel tiene
// guardado. Si el plan quedó bien replicado, las diferencias son 0.
//
// Corre dentro de un Web Worker (planComprasImport.worker.ts): la hoja Global
// pesa ~80 MB descomprimida y leerla en el hilo principal congelaría la
// pantalla varios segundos. Por eso este módulo no toca Supabase ni React.
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from "xlsx";
import {
  COLUMNAS, CLAVES_TEXTO, CLAVES_NUMERO, esCalculada, calcularFila, itemVacio,
  type ClaveColumna, type ClaveCalc, type PlanComprasItemInput, type ParametrosCalc,
} from "./planComprasCalc";

// ─── Tipos del resultado ─────────────────────────────────────────────────────

export interface ItemImportado extends PlanComprasItemInput {
  /** Fila del Excel menos el encabezado (1 = fila 2 de la hoja). */
  orden: number;
}

export interface FamiliaImportada {
  familia:   string;
  prioridad: number | null;
  orden:     number;
}

export interface CuentaImportada {
  cuenta: string;
  total:  number | null;
  orden:  number;
}

export interface DiferenciaVerificacion {
  /** Fila de la hoja Global (como la ve Excel, con el encabezado en la 1). */
  fila:     number;
  articulo: string;
  clave:    ClaveColumna;
  excel:    string;
  app:      string;
}

export interface VerificacionColumna {
  clave:       ClaveColumna;
  titulo:      string;
  comparadas:  number;
  diferencias: number;
}

export interface VerificacionFamilia {
  familia:       string;
  excelTotal:    number | null;
  appTotal:      number;
  excelCantidad: number | null;
  appCantidad:   number;
  ok:            boolean;
}

export interface VerificacionPlan {
  filas:            number;
  celdasComparadas: number;
  diferencias:      number;
  porColumna:       VerificacionColumna[];
  /** Las primeras diferencias encontradas, para mostrarlas. */
  ejemplos:         DiferenciaVerificacion[];
  /** Pestaña «Prioridad»: total GD $ y cantidad de matrículas por familia. */
  familias:         VerificacionFamilia[];
}

export interface ImportacionPlan {
  archivo:        string;
  anio:           number;
  nombre:         string;
  tipo_cambio:    number;
  pct_mayoracion: number;
  /** Encabezado real de cada columna en este Excel. */
  etiquetas:      Partial<Record<ClaveColumna, string>>;
  /** Celdas sueltas al pie de Global (TC y PC USD de años anteriores). */
  pie:            { etiqueta: string; valor: number }[];
  items:          ItemImportado[];
  familias:       FamiliaImportada[];
  cuentas:        CuentaImportada[];
  verificacion:   VerificacionPlan;
  /** Cosas que no frenan la importación pero conviene mirar. */
  advertencias:   string[];
}

export class ErrorImportacion extends Error {}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Celda = unknown;
type Fila = Celda[];

/** Encabezado comparable: sin tildes, minúsculas, espacios colapsados. */
export function normEncabezado(v: Celda): string {
  return String(v ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

/** Código de artículo sin el sufijo ".0" del export (igual que lib/parseo). */
function normArticulo(v: Celda): string | null {
  if (v == null) return null;
  const s = String(v).trim().replace(/\.0+$/, "");
  return s || null;
}

/** Texto de una celda. Un 0 numérico en una columna de texto es la celda
 *  vacía que devuelve un BUSCARV sin resultado: va como null. */
function texto(v: Celda): string | null {
  if (v == null) return null;
  if (typeof v === "number") return v === 0 ? null : String(v);
  if (typeof v === "boolean") return null;
  const s = String(v).trim();
  return s || null;
}

/** Número es-AR (o el número crudo de la celda). Vacío, texto o 0 → null:
 *  para las fórmulas una celda vacía vale 0, y así la base no guarda miles
 *  de ceros. */
function numero(v: Celda): number | null {
  if (v == null || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) && v !== 0 ? v : null;
  let s = String(v).trim().replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** Número tal cual lo guardó Excel (para verificar); null si no es número. */
function numCrudo(v: Celda): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function iguales(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

const fmt = (v: unknown): string =>
  v == null ? "(vacío)" : typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : String(v);

// ─── Encabezados de «Global» ─────────────────────────────────────────────────
// Cómo reconocer cada columna por su encabezado. Las que llevan año («2023P»,
// «GD 2025», «Total 2026 $») van por patrón: el mismo importador sirve para el
// Excel del año que viene. Se buscan en el orden de COLUMNAS y cada columna
// del Excel se usa una sola vez, así «2023P» y «2024P» (mismo patrón) caen en
// hist_1 y hist_3 por orden de aparición.
const MATCHERS: Record<ClaveColumna, string | RegExp> = {
  articulo: "articulo", descripcion: "descripcion", unidad: "unidad", mat_serv: "m/s",
  familia: "familia", familia_vieja: "familias viejas", subfamilia: "subfamilia", a_cargo_de: "a cargo de",
  ultima_sic_area: "ultima sic", ultima_sic_solicitante: "ultima sic2",
  hist_1: /^\d{4} ?p$/, hist_2: /^\d{4} ?c$/, hist_3: /^\d{4} ?p$/, max_hist: /^max\b/,
  d_acr: "acr", d_aord: "aord", d_mantenimiento: "mantenimiento", d_seas: "seas",
  d_sistemas: "sistemas", d_servicios: "servicios", za: "za",
  d_zb: "zb", d_zc: "zc", d_zd: "zd", d_ze: "ze", d_zf: "zf", d_zg: "zg", d_zh: "zh", interior: "interior",
  d_med: "med", d_tele: "tele", d_tct: "tct", d_trafos: "trafos", d_reg_ten: /^reg\.? ?ten\.?$/,
  d_obras: "obras", d_impacto: /^impacto\b/,
  total: "total", ajuste: "ajuste", gd: /^gd\b/, recorte: "recorte",
  cant_aprobadas: /^cant\.? ?aprobadas$/, analisis: "analisis",
  stock: "stock", pendientes: "pendientes", consumo_promedio: "consumo promedio",
  analisis_cons: /^analisis cons/, analisis2: "analisis2",
  pu_sic: "pu sic", pu_op: "pu op", pu_sic_mas: /^pu sic ?\+/, pu_est_usd: /^pu est \(usd\)$/,
  pu_est_pesos: /^pu est \(\$\)$/, verif_precio: /^verif\.? ?precio$/,
  total_plan: /^total \d{4} ?\$$/, incidencia: /^% ?incidencia$/,
  pu_ajustado: "pu ajustado", total_ajustado: /^total ajustado\b/,
  dif_pu: /^dif pu ?%$/, dif_global: /^dif global ?%$/,
  partida: "partida", partida_descripcion: "descripcion partida",
};

function mapearEncabezados(encabezado: Fila): { indice: Partial<Record<ClaveColumna, number>>; faltan: string[] } {
  const norm = encabezado.map(normEncabezado);
  const usados = new Set<number>();
  const indice: Partial<Record<ClaveColumna, number>> = {};
  const faltan: string[] = [];
  for (const c of COLUMNAS) {
    const m = MATCHERS[c.clave];
    const i = norm.findIndex((h, j) => !usados.has(j) && (typeof m === "string" ? h === m : m.test(h)));
    if (i >= 0) {
      indice[c.clave] = i;
      usados.add(i);
    } else if (!esCalculada(c.clave)) {
      // Una columna fórmula que falta solo deja sin verificar esa columna;
      // una de carga que falta es un Excel con otra estructura.
      faltan.push(`${c.titulo} (${c.letra})`);
    }
  }
  return { indice, faltan };
}

// ─── Lectura ─────────────────────────────────────────────────────────────────

function buscarHoja(wb: XLSX.WorkBook, nombre: string): XLSX.WorkSheet | null {
  const n = normEncabezado(nombre);
  const real = wb.SheetNames.find((s) => normEncabezado(s) === n);
  return real ? wb.Sheets[real] ?? null : null;
}

function filasDe(ws: XLSX.WorkSheet): Fila[] {
  return XLSX.utils.sheet_to_json<Fila>(ws, { header: 1, raw: true, defval: null, blankrows: true });
}

/**
 * Lee el libro completo. `data` es el contenido del .xlsx.
 * Lanza `ErrorImportacion` si el archivo no tiene la estructura de Global.
 */
export function leerLibroPlan(data: ArrayBuffer, archivo: string): ImportacionPlan {
  const wb = XLSX.read(data, {
    type: "array",
    // Solo las tres pestañas que se usan: las ocultas (stock, Envíos, OPS,
    // SIC, PREPARADOR) son reportes del sistema que la app ya carga por su
    // lado, y parsearlas duplicaría el tiempo y la memoria.
    sheets: ["Global", "Prioridad", "Resumen"],
    dense: true,
    cellFormula: false, cellHTML: false, cellText: false, cellStyles: false, cellNF: false,
  });
  const wsGlobal = buscarHoja(wb, "Global");
  if (!wsGlobal) throw new ErrorImportacion("El archivo no tiene la pestaña «Global».");
  const wsPrioridad = buscarHoja(wb, "Prioridad");
  const wsResumen   = buscarHoja(wb, "Resumen");
  return armarImportacion(
    filasDe(wsGlobal),
    wsPrioridad ? filasDe(wsPrioridad) : null,
    wsResumen ? filasDe(wsResumen) : null,
    archivo,
  );
}

/** Arma la importación a partir de las filas crudas de cada pestaña. */
export function armarImportacion(
  global: Fila[],
  prioridad: Fila[] | null,
  resumen: Fila[] | null,
  archivo: string,
): ImportacionPlan {
  const advertencias: string[] = [];
  if (global.length < 2) throw new ErrorImportacion("La pestaña «Global» está vacía.");

  // ── Encabezados ────────────────────────────────────────────────────────────
  const { indice, faltan } = mapearEncabezados(global[0]);
  if (faltan.length) {
    throw new ErrorImportacion(
      `La pestaña «Global» no tiene la estructura esperada. Faltan: ${faltan.join(", ")}.`,
    );
  }
  const col = (f: Fila, k: ClaveColumna): Celda => {
    const i = indice[k];
    return i == null ? null : f[i];
  };
  const etiquetas: Partial<Record<ClaveColumna, string>> = {};
  for (const c of COLUMNAS) {
    const i = indice[c.clave];
    if (i != null) etiquetas[c.clave] = String(global[0][i] ?? "").trim() || c.titulo;
  }

  // ── Año del plan ───────────────────────────────────────────────────────────
  // Del encabezado «Total 2026 $»; si no, del nombre del archivo
  // («PC_ANUAL_GD_26» → 2026).
  let anio = Number(etiquetas.total_plan?.match(/\d{4}/)?.[0] ?? NaN);
  if (!Number.isFinite(anio)) {
    const yy = archivo.match(/_(\d{2})(?:_|\b)/)?.[1];
    anio = yy ? 2000 + Number(yy) : new Date().getFullYear() + 1;
    advertencias.push(`No se encontró el año en los encabezados; se tomó ${anio}.`);
  }

  // ── Filas de datos: hasta la primera fila sin Artículo (la de totales) ─────
  const iArt = indice.articulo!;
  let fin = 1;
  while (fin < global.length && normArticulo(global[fin]?.[iArt]) != null) fin++;
  const filas = global.slice(1, fin);
  if (filas.length === 0) throw new ErrorImportacion("La pestaña «Global» no tiene filas con Artículo.");
  const filaTotales: Fila = global[fin] ?? [];
  const pieFilas = global.slice(fin + 1);

  const items: ItemImportado[] = filas.map((f, i) => {
    const it = itemVacio() as ItemImportado;
    for (const k of CLAVES_TEXTO) {
      (it as unknown as Record<string, string | null>)[k] = k === "articulo" ? normArticulo(col(f, k)) : texto(col(f, k));
    }
    for (const k of CLAVES_NUMERO) {
      (it as unknown as Record<string, number | null>)[k] = numero(col(f, k));
    }
    it.orden = i + 1;
    return it;
  });

  // ── Pie de Global: pares «etiqueta / valor» (TC y PC USD por año) ──────────
  // Las etiquetas están en la columna de Verif. Precio y los valores en la de
  // Total $ (BA / BB). Las del año del plan son fórmulas que dependen del
  // filtro activo al guardar el Excel: no se guardan.
  const pie: { etiqueta: string; valor: number }[] = [];
  const iLab = indice.verif_precio, iVal = indice.total_plan;
  if (iLab != null && iVal != null) {
    for (const f of pieFilas) {
      const etiqueta = typeof f?.[iLab] === "string" ? String(f[iLab]).trim() : "";
      const valor = numCrudo(f?.[iVal]);
      if (etiqueta && valor != null && !etiqueta.includes(String(anio))) pie.push({ etiqueta, valor });
    }
  }

  // ── Tipo de cambio: «TC PLAN» de Prioridad; si no, el primer TC del pie ────
  let tipoCambio: number | null = null;
  if (prioridad) {
    for (const f of prioridad) {
      const j = f.findIndex((v) => normEncabezado(v).startsWith("tc plan"));
      if (j >= 0) { tipoCambio = numCrudo(f[j + 1]); if (tipoCambio != null) break; }
    }
  }
  if (tipoCambio == null) tipoCambio = pie.find((p) => /^tc\b/i.test(p.etiqueta))?.valor ?? null;
  if (tipoCambio == null || tipoCambio <= 0) {
    tipoCambio = 1;
    advertencias.push("No se encontró el tipo de cambio del plan («TC PLAN»); quedó en 1. Corregilo en los parámetros del plan.");
  }

  // ── % de mayoración de «Pu Sic + 20%» ─────────────────────────────────────
  // En el Excel es un 1,2 escrito dentro de la fórmula: no viene como dato.
  // Se deduce de las filas (Pu Sic + 20% / MAX(Pu Sic; Pu OP)) y se redondea
  // a 2 decimales; la verificación de abajo confirma que es el correcto.
  const pct = deducirMayoracion(filas, indice) ?? 0.2;

  const params: ParametrosCalc = { tipo_cambio: tipoCambio, pct_mayoracion: pct };

  // ── Prioridad (familias) ───────────────────────────────────────────────────
  const familias: FamiliaImportada[] = [];
  const prioridadExcel = new Map<string, { total: number | null; cantidad: number | null }>();
  if (prioridad && prioridad.length > 1) {
    const enc = prioridad[0].map(normEncabezado);
    const iFam = enc.indexOf("familia");
    const iPri = enc.indexOf("prioridad");
    const iCant = enc.findIndex((h) => h.startsWith("cantidad matriculas"));
    const iTot = enc.findIndex((h) => h === "total gd $");
    if (iFam >= 0) {
      const vistas = new Set<string>();
      for (let r = 1; r < prioridad.length; r++) {
        const fam = texto(prioridad[r][iFam]);
        if (!fam) break;
        if (vistas.has(fam)) continue;
        vistas.add(fam);
        familias.push({ familia: fam, prioridad: iPri >= 0 ? numCrudo(prioridad[r][iPri]) : null, orden: familias.length + 1 });
        prioridadExcel.set(fam, {
          total: iTot >= 0 ? numCrudo(prioridad[r][iTot]) : null,
          cantidad: iCant >= 0 ? numCrudo(prioridad[r][iCant]) : null,
        });
      }
    }
  }
  if (familias.length === 0) advertencias.push("No se encontró la pestaña «Prioridad» (familias y prioridades).");

  // ── Resumen (cuentas contables) ────────────────────────────────────────────
  const cuentas: CuentaImportada[] = [];
  if (resumen) {
    const r0 = resumen.findIndex((f) => normEncabezado(f?.[0]) === "cuenta");
    if (r0 >= 0) {
      const iTotal = resumen[r0].findIndex((v) => normEncabezado(v) === "total");
      for (let r = r0 + 1; r < resumen.length; r++) {
        const cuenta = texto(resumen[r]?.[0]);
        if (!cuenta || !/^\d{4}-\d{12}-/.test(cuenta)) continue;
        cuentas.push({ cuenta, total: iTotal >= 0 ? numCrudo(resumen[r][iTotal]) : null, orden: cuentas.length + 1 });
      }
    }
  }

  // ── Verificación contra los valores del Excel ──────────────────────────────
  const verificacion = verificar(filas, items, indice, filaTotales, params, prioridadExcel, etiquetas);

  return {
    archivo,
    anio,
    nombre: `Plan de Compras Anual GD ${anio}`,
    tipo_cambio: tipoCambio,
    pct_mayoracion: pct,
    etiquetas,
    pie,
    items,
    familias,
    cuentas,
    verificacion,
    advertencias,
  };
}

function deducirMayoracion(filas: Fila[], indice: Partial<Record<ClaveColumna, number>>): number | null {
  const iSic = indice.pu_sic, iOp = indice.pu_op, iMas = indice.pu_sic_mas;
  if (iSic == null || iOp == null || iMas == null) return null;
  const ratios: number[] = [];
  for (const f of filas) {
    const base = Math.max(numCrudo(f[iSic]) ?? 0, numCrudo(f[iOp]) ?? 0);
    const mas = numCrudo(f[iMas]);
    // Con bases chicas el redondeo a entero distorsiona el cociente.
    if (base >= 1000 && mas != null) ratios.push(mas / base);
  }
  if (ratios.length === 0) return null;
  ratios.sort((a, b) => a - b);
  const mediana = ratios[Math.floor(ratios.length / 2)];
  return Math.round((mediana - 1) * 100) / 100;
}

// ─── Verificación ────────────────────────────────────────────────────────────

const MAX_EJEMPLOS = 25;

function verificar(
  filas: Fila[],
  items: ItemImportado[],
  indice: Partial<Record<ClaveColumna, number>>,
  filaTotales: Fila,
  params: ParametrosCalc,
  prioridadExcel: Map<string, { total: number | null; cantidad: number | null }>,
  etiquetas: Partial<Record<ClaveColumna, string>>,
): VerificacionPlan {
  const calcCols = COLUMNAS.filter((c) => esCalculada(c.clave) && indice[c.clave] != null);
  const porColumna = new Map<ClaveColumna, VerificacionColumna>(
    calcCols.map((c) => [c.clave, { clave: c.clave, titulo: etiquetas[c.clave] ?? c.titulo, comparadas: 0, diferencias: 0 }]),
  );
  const ejemplos: DiferenciaVerificacion[] = [];
  let celdas = 0, difs = 0;

  // % Incidencia del Excel se calculó contra el SUBTOTAL de la fila de
  // totales (que depende del filtro activo al guardar): se verifica contra
  // ese mismo denominador.
  const iTot = indice.total_plan;
  const denomIncidencia = iTot != null ? numCrudo(filaTotales[iTot]) : null;

  const famTotal = new Map<string, number>();
  const famCant = new Map<string, number>();

  for (let r = 0; r < filas.length; r++) {
    const f = filas[r];
    const it = items[r];
    const calc = calcularFila(it, params);

    if ((it.a_cargo_de ?? "").toUpperCase() === "GD" && it.familia) {
      famTotal.set(it.familia, (famTotal.get(it.familia) ?? 0) + calc.total_plan);
      if (calc.gd > 0) famCant.set(it.familia, (famCant.get(it.familia) ?? 0) + 1);
    }

    for (const c of calcCols) {
      const clave = c.clave as ClaveCalc;
      let app: number | null;
      if (clave === "incidencia") {
        if (denomIncidencia == null || denomIncidencia === 0) continue;
        app = calc.total_plan / denomIncidencia;
      } else {
        app = calc[clave];
      }
      const excelRaw = f[indice[clave]!];
      const excelNum = numCrudo(excelRaw);
      // Celda de texto en el Excel («No se compro en 2023», «Sin Datos») ⇔
      // null en la app. Celda vacía en el Excel ⇔ 0.
      const ok =
        excelRaw == null ? app === 0 || app === null
        : excelNum == null ? app === null
        : app !== null && iguales(excelNum, app);
      celdas++;
      const pc = porColumna.get(clave)!;
      pc.comparadas++;
      if (!ok) {
        difs++;
        pc.diferencias++;
        if (ejemplos.length < MAX_EJEMPLOS) {
          ejemplos.push({ fila: r + 2, articulo: it.articulo ?? "", clave, excel: fmt(excelRaw), app: fmt(app) });
        }
      }
    }
  }

  const familias: VerificacionFamilia[] = [...prioridadExcel.entries()].map(([familia, ex]) => {
    const appTotal = famTotal.get(familia) ?? 0;
    const appCantidad = famCant.get(familia) ?? 0;
    const ok =
      (ex.total == null || iguales(ex.total, appTotal)) &&
      (ex.cantidad == null || ex.cantidad === appCantidad);
    return { familia, excelTotal: ex.total, appTotal, excelCantidad: ex.cantidad, appCantidad, ok };
  });

  return {
    filas: filas.length,
    celdasComparadas: celdas,
    diferencias: difs,
    porColumna: [...porColumna.values()],
    ejemplos,
    familias,
  };
}
