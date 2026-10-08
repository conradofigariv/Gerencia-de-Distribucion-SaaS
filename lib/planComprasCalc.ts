// ─────────────────────────────────────────────────────────────────────────────
// Plan de Compras — columnas de la pestaña «Global» y sus fórmulas.
//
// Módulo PURO (sin Supabase ni React): lo usan la grilla, el importador (que
// corre en un Web Worker) y la verificación contra el Excel. Por eso no
// importa nada.
//
// Regla: en la base se guarda solo lo que en el Excel es un dato; todo lo que
// es fórmula se calcula acá, con el mismo redondeo que Excel. Doc completo en
// docs/plan-compras.md.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Claves ──────────────────────────────────────────────────────────────────

/** Columnas de texto que se cargan (A–J, BH–BI). */
export const CLAVES_TEXTO = [
  "articulo", "descripcion", "unidad", "mat_serv",
  "familia", "familia_vieja", "subfamilia", "a_cargo_de",
  "ultima_sic_area", "ultima_sic_solicitante",
  "partida", "partida_descripcion",
] as const;

/** Columnas numéricas que se cargan. */
export const CLAVES_NUMERO = [
  "hist_1", "hist_2", "hist_3",
  "d_acr", "d_aord", "d_mantenimiento", "d_seas", "d_sistemas", "d_servicios",
  "d_zb", "d_zc", "d_zd", "d_ze", "d_zf", "d_zg", "d_zh",
  "d_med", "d_tele", "d_tct", "d_trafos", "d_reg_ten", "d_obras", "d_impacto",
  "ajuste", "cant_aprobadas",
  "stock", "pendientes", "consumo_promedio",
  "pu_sic", "pu_op", "pu_est_usd", "pu_ajustado",
] as const;

/** Columnas que en el Excel son fórmula: se calculan, nunca se guardan. */
export const CLAVES_CALC = [
  "max_hist", "za", "interior", "total", "gd", "recorte", "analisis",
  "analisis_cons", "analisis2", "pu_sic_mas", "pu_est_pesos", "verif_precio",
  "total_plan", "incidencia", "total_ajustado", "dif_pu", "dif_global",
] as const;

export type ClaveTexto  = (typeof CLAVES_TEXTO)[number];
export type ClaveNumero = (typeof CLAVES_NUMERO)[number];
export type ClaveCalc   = (typeof CLAVES_CALC)[number];
export type ClaveCarga  = ClaveTexto | ClaveNumero;
export type ClaveColumna = ClaveCarga | ClaveCalc;

const SET_CALC = new Set<string>(CLAVES_CALC);
export const esCalculada = (k: ClaveColumna): k is ClaveCalc => SET_CALC.has(k);

// ─── Tipos de fila ───────────────────────────────────────────────────────────

/** Lo que se carga de una fila (lo único que va a la base). Una celda vacía
 *  o en 0 del Excel se guarda como null: para las fórmulas es lo mismo. */
export type PlanComprasItemInput =
  { [K in ClaveTexto]: string | null } &
  { [K in ClaveNumero]: number | null };

/** Ítem tal como sale de la base. */
export interface PlanComprasItem extends PlanComprasItemInput {
  id:      string;
  plan_id: string;
  orden:   number;
}

/** Parámetros del plan que intervienen en las fórmulas. */
export interface ParametrosCalc {
  /** $ por USD — «TC PLAN» de Prioridad / «TC 11/07/2025» al pie de Global. */
  tipo_cambio:    number;
  /** El «+20%» de Pu Sic + 20%, como fracción (0.20). */
  pct_mayoracion: number;
}

/**
 * Valores derivados de una fila — las columnas fórmula de «Global».
 *
 * `null` en los porcentajes = el texto del SI.ERROR del Excel («No se compro
 * en 2023» en Análisis, «Sin Datos» en DIF PU% / DIF GLOBAL %).
 * `incidencia` no está acá: depende del total de las filas visibles (ver
 * `incidencia()`).
 */
export interface PlanComprasCalc {
  /** N  · MAX 2023 = MAX(2023P; 2023C; 2024P) */
  max_hist:       number;
  /** U  · ZA = SUMA(ACR:SERVICIOS) */
  za:             number;
  /** AC · INTERIOR = SUMA(ZB:ZH) */
  interior:       number;
  /** AK · TOTAL = ZA + INTERIOR + MED + TELE + TCT + TRAFOS + OBRAS + REG.TEN. + Impacto */
  total:          number;
  /** AM · GD 2025 = TOTAL − AJUSTE */
  gd:             number;
  /** AN · Recorte = CANT. APROBADAS − GD 2025 */
  recorte:        number;
  /** AP · Análisis = SI.ERROR(TOTAL / MAX 2023 − 1; "No se compro en 2023") */
  analisis:       number | null;
  /** AT · Análisis Cons. Prom = Consumo Promedio − Pendientes − Stock */
  analisis_cons:  number;
  /** AU · Análisis2 = GD 2025 − Stock − Pendientes */
  analisis2:      number;
  /** AX · Pu Sic + 20% = REDONDEAR(MAX(Pu Sic; Pu OP) × 1,2; 0) */
  pu_sic_mas:     number;
  /** AZ · Pu Est ($) = REDONDEAR.MAS(Pu Est (USD) × TC; 0) */
  pu_est_pesos:   number;
  /** BA · Verif. Precio = SI.ERROR(Pu Est ($) / Pu Sic + 20% − 1; 0) */
  verif_precio:   number;
  /** BB · Total 2026 $ = Pu Est ($) × GD 2025 */
  total_plan:     number;
  /** BE · Total Ajustado 2026 $ = Pu ajustado × CANT. APROBADAS
   *  (en el Excel está pegado como valor; coincide con la cuenta en el 100%
   *  de las filas del plan 2026). */
  total_ajustado: number;
  /** BF · DIF PU% = SI.ERROR(Pu ajustado / Pu Est ($) − 1; "Sin Datos") */
  dif_pu:         number | null;
  /** BG · DIF GLOBAL % = SI.ERROR(Total Ajustado / Total 2026 $ − 1; "Sin Datos") */
  dif_global:     number | null;
}

// ─── Redondeo como Excel ─────────────────────────────────────────────────────

/**
 * Limpia el ruido del punto flotante antes de redondear, como hace Excel, que
 * trabaja con 15 dígitos significativos. Sin esto, 203,98406374502 × 1255 da
 * 256000,00000000003 en JS y REDONDEAR.MAS lo empuja a 256001 — un peso de
 * más contra el Excel en las filas cuyo Pu Est (USD) viene de una división.
 */
function limpiar(n: number): number {
  return Number(n.toPrecision(15));
}

/** REDONDEAR(x; 0): el medio se aleja del cero (no redondeo bancario). */
export function redondearExcel(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(limpiar(n)));
}

/** REDONDEAR.MAS(x; 0): siempre se aleja del cero. */
export function redondearMasExcel(n: number): number {
  return Math.sign(n) * Math.ceil(Math.abs(limpiar(n)));
}

/** Una celda vacía cuenta como 0, igual que en el Excel. */
const n0 = (v: number | null | undefined): number => (v == null ? 0 : v);

// ─── Fórmulas ────────────────────────────────────────────────────────────────

/** Calcula las columnas fórmula de una fila (todas menos % Incidencia). */
export function calcularFila(it: PlanComprasItemInput, p: ParametrosCalc): PlanComprasCalc {
  const maxHist  = Math.max(n0(it.hist_1), n0(it.hist_2), n0(it.hist_3));
  const za       = n0(it.d_acr) + n0(it.d_aord) + n0(it.d_mantenimiento)
                 + n0(it.d_seas) + n0(it.d_sistemas) + n0(it.d_servicios);
  const interior = n0(it.d_zb) + n0(it.d_zc) + n0(it.d_zd) + n0(it.d_ze)
                 + n0(it.d_zf) + n0(it.d_zg) + n0(it.d_zh);
  // Mismo orden de suma que la fórmula del Excel (U, AC, AD, AE, AF, TRAFOS,
  // OBRAS, REG.TEN., Impacto): con decimales, el orden cambia el último bit.
  const total    = za + interior + n0(it.d_med) + n0(it.d_tele) + n0(it.d_tct)
                 + n0(it.d_trafos) + n0(it.d_obras) + n0(it.d_reg_ten) + n0(it.d_impacto);
  const gd       = total - n0(it.ajuste);
  const stock    = n0(it.stock);
  const pend     = n0(it.pendientes);

  // ⚠ Pu Sic + 20% NO es Pu Sic × 1,2: es el MÁXIMO entre Pu Sic y Pu OP,
  // mayorado.
  const puSicMas   = redondearExcel(Math.max(n0(it.pu_sic), n0(it.pu_op)) * (1 + p.pct_mayoracion));
  const puEstPesos = redondearMasExcel(n0(it.pu_est_usd) * p.tipo_cambio);
  // ⚠ El total multiplica por GD 2025 (lo pedido neto), NO por las aprobadas.
  const totalPlan  = puEstPesos * gd;
  const totalAj    = n0(it.pu_ajustado) * n0(it.cant_aprobadas);

  return {
    max_hist:       maxHist,
    za,
    interior,
    total,
    gd,
    recorte:        n0(it.cant_aprobadas) - gd,
    analisis:       maxHist === 0 ? null : total / maxHist - 1,
    analisis_cons:  n0(it.consumo_promedio) - pend - stock,
    analisis2:      gd - stock - pend,
    pu_sic_mas:     puSicMas,
    pu_est_pesos:   puEstPesos,
    verif_precio:   puSicMas === 0 ? 0 : puEstPesos / puSicMas - 1,
    total_plan:     totalPlan,
    total_ajustado: totalAj,
    dif_pu:         puEstPesos === 0 ? null : n0(it.pu_ajustado) / puEstPesos - 1,
    dif_global:     totalPlan === 0 ? null : totalAj / totalPlan - 1,
  };
}

/**
 * BC · % Incidencia = Total $ de la fila / Total $ de la fila de totales.
 *
 * En el Excel el total es un SUBTOTAL(109), que suma SOLO las filas visibles
 * del filtro activo: la incidencia es «sobre lo que estás mirando». La grilla
 * replica eso pasando el total de las filas filtradas. Con total 0 el Excel
 * da #¡DIV/0! → null.
 */
export function incidencia(totalFila: number, totalVisible: number): number | null {
  return totalVisible === 0 ? null : totalFila / totalVisible;
}

/** Texto que muestra el Excel cuando Análisis no se puede calcular. */
export function textoSinCompra(etiquetaMax: string | undefined): string {
  const anio = etiquetaMax?.match(/\d{4}/)?.[0];
  return anio ? `No se compró en ${anio}` : "Sin histórico";
}

// ─── Catálogo de columnas (orden de «Global») ────────────────────────────────

/** Cómo se muestra un valor. */
export type FormatoColumna =
  | "codigo"   // mono, alineado a la izquierda (Artículo, Partida)
  | "texto"    // sans, alineado a la izquierda
  | "cantidad" // número con hasta 2 decimales
  | "pesos"    // importe en $ con hasta 2 decimales
  | "usd"      // importe en USD con 2 decimales
  | "pct";     // porcentaje con 1 decimal

export interface ColumnaPlan {
  clave:   ClaveColumna;
  /** Letra de la columna en «Global». */
  letra:   string;
  /** Encabezado del Excel del plan 2026. El de cada plan viene en
   *  `plan_compras.etiquetas` (el año cambia). */
  titulo:  string;
  grupo:   GrupoId;
  formato: FormatoColumna;
  /** Ancho natural en px (§4.18: pisos reales por tipo de dato). */
  ancho:   number;
}

export type GrupoId =
  | "matricula" | "clasificacion" | "ultima_sic" | "historico" | "zona_a"
  | "interior" | "otros" | "cantidades" | "stock" | "precios" | "totales"
  | "aprobado" | "partida";

export interface GrupoPlan {
  id:     GrupoId;
  titulo: string;
  /** Columna que queda visible con el grupo colapsado (§4.14). Solo los
   *  grupos que en el Excel ya tienen su columna de subtotal. */
  resumen?: ClaveColumna;
}

export const GRUPOS: GrupoPlan[] = [
  { id: "matricula",     titulo: "Matrícula" },
  { id: "clasificacion", titulo: "Clasificación" },
  { id: "ultima_sic",    titulo: "Última SIC" },
  { id: "historico",     titulo: "Histórico",      resumen: "max_hist" },
  { id: "zona_a",        titulo: "Zona A",         resumen: "za" },
  { id: "interior",      titulo: "Interior",       resumen: "interior" },
  { id: "otros",         titulo: "Otros sectores" },
  { id: "cantidades",    titulo: "Cantidades" },
  { id: "stock",         titulo: "Stock y consumo" },
  { id: "precios",       titulo: "Precios" },
  { id: "totales",       titulo: "Total del plan" },
  { id: "aprobado",      titulo: "Aprobado" },
  { id: "partida",       titulo: "Partida" },
];

// Pisos por tipo (§4.18) subidos lo justo para que entren el encabezado
// (10px uppercase + flecha de orden) y un importe de miles de millones.
const W_CANT = 88, W_PESOS = 128, W_PCT = 88;

/** Las 61 columnas de «Global», en el orden del Excel (A → BI). */
export const COLUMNAS: ColumnaPlan[] = [
  { clave: "articulo",               letra: "A",  titulo: "Artículo",              grupo: "matricula",     formato: "codigo",   ancho: 104 },
  { clave: "descripcion",            letra: "B",  titulo: "Descripción",           grupo: "matricula",     formato: "texto",    ancho: 300 },
  { clave: "unidad",                 letra: "C",  titulo: "Unidad",                grupo: "matricula",     formato: "texto",    ancho: 92 },
  { clave: "mat_serv",               letra: "D",  titulo: "M/S",                   grupo: "matricula",     formato: "texto",    ancho: 104 },
  { clave: "familia",                letra: "E",  titulo: "FAMILIA",               grupo: "clasificacion", formato: "texto",    ancho: 200 },
  { clave: "familia_vieja",          letra: "F",  titulo: "FAMILIAS VIEJAS",       grupo: "clasificacion", formato: "texto",    ancho: 180 },
  { clave: "subfamilia",             letra: "G",  titulo: "SUBFAMILIA",            grupo: "clasificacion", formato: "texto",    ancho: 150 },
  { clave: "a_cargo_de",             letra: "H",  titulo: "A CARGO DE",            grupo: "clasificacion", formato: "texto",    ancho: 120 },
  { clave: "ultima_sic_area",        letra: "I",  titulo: "ULTIMA SIC",            grupo: "ultima_sic",    formato: "texto",    ancho: 130 },
  { clave: "ultima_sic_solicitante", letra: "J",  titulo: "ULTIMA SIC2",           grupo: "ultima_sic",    formato: "texto",    ancho: 180 },
  { clave: "hist_1",                 letra: "K",  titulo: "2023P",                 grupo: "historico",     formato: "cantidad", ancho: W_CANT },
  { clave: "hist_2",                 letra: "L",  titulo: "2023C",                 grupo: "historico",     formato: "cantidad", ancho: W_CANT },
  { clave: "hist_3",                 letra: "M",  titulo: "2024P",                 grupo: "historico",     formato: "cantidad", ancho: W_CANT },
  { clave: "max_hist",               letra: "N",  titulo: "MAX 2023",              grupo: "historico",     formato: "cantidad", ancho: 100 },
  { clave: "d_acr",                  letra: "O",  titulo: "ACR",                   grupo: "zona_a",        formato: "cantidad", ancho: W_CANT },
  { clave: "d_aord",                 letra: "P",  titulo: "AORD",                  grupo: "zona_a",        formato: "cantidad", ancho: W_CANT },
  { clave: "d_mantenimiento",        letra: "Q",  titulo: "MANTENIMIENTO",         grupo: "zona_a",        formato: "cantidad", ancho: 124 },
  { clave: "d_seas",                 letra: "R",  titulo: "SEAS",                  grupo: "zona_a",        formato: "cantidad", ancho: W_CANT },
  { clave: "d_sistemas",             letra: "S",  titulo: "SISTEMAS",              grupo: "zona_a",        formato: "cantidad", ancho: W_CANT },
  { clave: "d_servicios",            letra: "T",  titulo: "SERVICIOS",             grupo: "zona_a",        formato: "cantidad", ancho: 96 },
  { clave: "za",                     letra: "U",  titulo: "ZA",                    grupo: "zona_a",        formato: "cantidad", ancho: W_CANT },
  { clave: "d_zb",                   letra: "V",  titulo: "ZB",                    grupo: "interior",      formato: "cantidad", ancho: W_CANT },
  { clave: "d_zc",                   letra: "W",  titulo: "ZC",                    grupo: "interior",      formato: "cantidad", ancho: W_CANT },
  { clave: "d_zd",                   letra: "X",  titulo: "ZD",                    grupo: "interior",      formato: "cantidad", ancho: W_CANT },
  { clave: "d_ze",                   letra: "Y",  titulo: "ZE",                    grupo: "interior",      formato: "cantidad", ancho: W_CANT },
  { clave: "d_zf",                   letra: "Z",  titulo: "ZF",                    grupo: "interior",      formato: "cantidad", ancho: W_CANT },
  { clave: "d_zg",                   letra: "AA", titulo: "ZG",                    grupo: "interior",      formato: "cantidad", ancho: W_CANT },
  { clave: "d_zh",                   letra: "AB", titulo: "ZH",                    grupo: "interior",      formato: "cantidad", ancho: W_CANT },
  { clave: "interior",               letra: "AC", titulo: "INTERIOR",              grupo: "interior",      formato: "cantidad", ancho: W_CANT },
  { clave: "d_med",                  letra: "AD", titulo: "MED",                   grupo: "otros",         formato: "cantidad", ancho: W_CANT },
  { clave: "d_tele",                 letra: "AE", titulo: "TELE",                  grupo: "otros",         formato: "cantidad", ancho: W_CANT },
  { clave: "d_tct",                  letra: "AF", titulo: "TCT",                   grupo: "otros",         formato: "cantidad", ancho: W_CANT },
  { clave: "d_trafos",               letra: "AG", titulo: "TRAFOS",                grupo: "otros",         formato: "cantidad", ancho: W_CANT },
  { clave: "d_reg_ten",              letra: "AH", titulo: "REG.TEN.",              grupo: "otros",         formato: "cantidad", ancho: W_CANT },
  { clave: "d_obras",                letra: "AI", titulo: "OBRAS",                 grupo: "otros",         formato: "cantidad", ancho: W_CANT },
  { clave: "d_impacto",              letra: "AJ", titulo: "Impacto 2025",          grupo: "otros",         formato: "cantidad", ancho: 116 },
  { clave: "total",                  letra: "AK", titulo: "TOTAL",                 grupo: "cantidades",    formato: "cantidad", ancho: W_CANT },
  { clave: "ajuste",                 letra: "AL", titulo: "AJUSTE",                grupo: "cantidades",    formato: "cantidad", ancho: W_CANT },
  { clave: "gd",                     letra: "AM", titulo: "GD 2025",               grupo: "cantidades",    formato: "cantidad", ancho: W_CANT },
  { clave: "recorte",                letra: "AN", titulo: "Recorte",               grupo: "cantidades",    formato: "cantidad", ancho: W_CANT },
  { clave: "cant_aprobadas",         letra: "AO", titulo: "CANT. APROBADAS",       grupo: "cantidades",    formato: "cantidad", ancho: 140 },
  { clave: "analisis",               letra: "AP", titulo: "Análisis",              grupo: "cantidades",    formato: "pct",      ancho: 140 },
  { clave: "stock",                  letra: "AQ", titulo: "Stock",                 grupo: "stock",         formato: "cantidad", ancho: W_CANT },
  { clave: "pendientes",             letra: "AR", titulo: "Pendientes",            grupo: "stock",         formato: "cantidad", ancho: 104 },
  { clave: "consumo_promedio",       letra: "AS", titulo: "Consumo Promedio",      grupo: "stock",         formato: "cantidad", ancho: 144 },
  { clave: "analisis_cons",          letra: "AT", titulo: "Análisis Cons. Prom",   grupo: "stock",         formato: "cantidad", ancho: 164 },
  { clave: "analisis2",              letra: "AU", titulo: "Análisis2",             grupo: "stock",         formato: "cantidad", ancho: 96 },
  { clave: "pu_sic",                 letra: "AV", titulo: "Pu Sic",                grupo: "precios",       formato: "pesos",    ancho: W_PESOS },
  { clave: "pu_op",                  letra: "AW", titulo: "Pu OP",                 grupo: "precios",       formato: "pesos",    ancho: W_PESOS },
  { clave: "pu_sic_mas",             letra: "AX", titulo: "Pu Sic + 20%",          grupo: "precios",       formato: "pesos",    ancho: W_PESOS },
  { clave: "pu_est_usd",             letra: "AY", titulo: "Pu Est (USD)",          grupo: "precios",       formato: "usd",      ancho: 120 },
  { clave: "pu_est_pesos",           letra: "AZ", titulo: "Pu Est ($)",            grupo: "precios",       formato: "pesos",    ancho: W_PESOS },
  { clave: "verif_precio",           letra: "BA", titulo: "Verif. Precio",         grupo: "precios",       formato: "pct",      ancho: 124 },
  { clave: "total_plan",             letra: "BB", titulo: "Total 2026 $",          grupo: "totales",       formato: "pesos",    ancho: 144 },
  { clave: "incidencia",             letra: "BC", titulo: "% Incidencia",          grupo: "totales",       formato: "pct",      ancho: 120 },
  { clave: "pu_ajustado",            letra: "BD", titulo: "Pu ajustado",           grupo: "aprobado",      formato: "pesos",    ancho: W_PESOS },
  { clave: "total_ajustado",         letra: "BE", titulo: "Total Ajustado 2026 $", grupo: "aprobado",      formato: "pesos",    ancho: 184 },
  { clave: "dif_pu",                 letra: "BF", titulo: "DIF PU%",               grupo: "aprobado",      formato: "pct",      ancho: W_PCT },
  { clave: "dif_global",             letra: "BG", titulo: "DIF GLOBAL %",          grupo: "aprobado",      formato: "pct",      ancho: 120 },
  { clave: "partida",                letra: "BH", titulo: "Partida",               grupo: "partida",       formato: "codigo",   ancho: 124 },
  { clave: "partida_descripcion",    letra: "BI", titulo: "Descripción Partida",   grupo: "partida",       formato: "texto",    ancho: 240 },
];

export const COLUMNA_POR_CLAVE: Record<ClaveColumna, ColumnaPlan> =
  Object.fromEntries(COLUMNAS.map((c) => [c.clave, c])) as Record<ClaveColumna, ColumnaPlan>;

/** Encabezados por defecto (los del Excel 2026), para mezclar con los del plan. */
export const ETIQUETAS_DEFAULT: Record<ClaveColumna, string> =
  Object.fromEntries(COLUMNAS.map((c) => [c.clave, c.titulo])) as Record<ClaveColumna, string>;

/** Fila vacía (todas las columnas de carga en null). */
export function itemVacio(): PlanComprasItemInput {
  const o: Record<string, null> = {};
  for (const k of CLAVES_TEXTO) o[k] = null;
  for (const k of CLAVES_NUMERO) o[k] = null;
  return o as unknown as PlanComprasItemInput;
}
