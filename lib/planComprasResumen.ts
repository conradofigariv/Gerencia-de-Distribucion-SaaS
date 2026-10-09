// ─────────────────────────────────────────────────────────────────────────────
// Plan de Compras — Resumen: lo que el Excel calcula como resultado.
//
// Replica las pestañas «Prioridad» y «Resumen» a partir de las filas de Global
// (ya calculadas con `calcularFila`). Puro: sin Supabase ni React.
//
//   • Prioridad (Tabla7): por familia, SUMIFS / COUNTIFS sobre Global con
//     «A CARGO DE» = GD.
//   • Por partida: reemplaza la tabla dinámica de Resumen (que en el Excel
//     quedó desactualizada): cantidades aprobadas y Total Ajustado por partida.
//   • Cuentas contables (Tabla5): partida = EXTRAE(cuenta; 6; 12); la
//     descripción sale de Global (el BUSCARV del Excel apunta a columnas
//     corridas y da #N/A) y el total se recalcula para compararlo con el que
//     quedó pegado.
// ─────────────────────────────────────────────────────────────────────────────

import type { PlanComprasItemInput, PlanComprasCalc } from "@/lib/planComprasCalc";

export interface FilaCalc {
  it:   PlanComprasItemInput;
  calc: PlanComprasCalc;
}

/** Igual que los criterios de SUMIFS: sin distinguir mayúsculas. */
export const claveTexto = (v: string | null | undefined) => String(v ?? "").trim().toLocaleUpperCase("es-AR");

/** Filtra por «A cargo de» (null = todas las filas). */
export function filtrarACargo(filas: FilaCalc[], aCargo: string | null): FilaCalc[] {
  if (aCargo == null) return filas;
  const k = claveTexto(aCargo);
  return filas.filter((f) => claveTexto(f.it.a_cargo_de) === k);
}

const div = (a: number, b: number) => (b !== 0 ? a / b : null);

// ─── Prioridad ───────────────────────────────────────────────────────────────

export interface FilaPrioridad {
  familia:      string;
  prioridad:    number | null;
  orden:        number;
  /** false: la familia tiene filas en Global pero no estaba en la tabla del Excel. */
  enExcel:      boolean;
  /** CONTAR.SI.CONJUNTO(…; GD > 0). */
  matriculas:   number;
  totalGd:      number;
  totalAprobado: number;
  pctGd:        number | null;
  pctAprobado:  number | null;
  /** Total GD / Total Aprobado − 1 («Respecto Año pasado» en el Excel). */
  gdVsAprobado: number | null;
}

export interface ResumenPrioridad {
  filas: FilaPrioridad[];
  total: { matriculas: number; totalGd: number; totalAprobado: number; gdVsAprobado: number | null };
}

export function resumenPrioridad(
  filas: FilaCalc[],
  familias: { familia: string; prioridad: number | null; orden: number }[],
): ResumenPrioridad {
  const acc = new Map<string, { nombre: string; n: number; gd: number; ap: number }>();
  for (const { it, calc } of filas) {
    const k = claveTexto(it.familia);
    const a = acc.get(k) ?? { nombre: String(it.familia ?? "").trim(), n: 0, gd: 0, ap: 0 };
    if (calc.gd > 0) a.n++;
    a.gd += calc.total_plan;
    a.ap += calc.total_ajustado;
    acc.set(k, a);
  }

  const out: FilaPrioridad[] = [];
  const vistas = new Set<string>();
  const fila = (familia: string, prioridad: number | null, orden: number, enExcel: boolean, a?: { n: number; gd: number; ap: number }) => ({
    familia, prioridad, orden, enExcel,
    matriculas: a?.n ?? 0, totalGd: a?.gd ?? 0, totalAprobado: a?.ap ?? 0,
    pctGd: null, pctAprobado: null,
    gdVsAprobado: a ? div(a.gd, a.ap) : null,
  });
  for (const f of familias) {
    const k = claveTexto(f.familia);
    vistas.add(k);
    out.push(fila(f.familia, f.prioridad, f.orden, true, acc.get(k)));
  }
  // Familias que no estaban en la tabla del Excel: solo si suman algo (si no,
  // en el Excel tampoco aparecerían en ningún total).
  let orden = familias.reduce((m, f) => Math.max(m, f.orden), 0);
  for (const [k, a] of acc) {
    if (vistas.has(k) || (a.n === 0 && a.gd === 0 && a.ap === 0)) continue;
    out.push(fila(a.nombre || "(Sin familia)", null, ++orden, false, a));
  }

  const totalGd = out.reduce((s, f) => s + f.totalGd, 0);
  const totalAprobado = out.reduce((s, f) => s + f.totalAprobado, 0);
  for (const f of out) {
    f.pctGd = div(f.totalGd, totalGd);
    f.pctAprobado = div(f.totalAprobado, totalAprobado);
    if (f.gdVsAprobado != null) f.gdVsAprobado -= 1;
  }
  const gva = div(totalGd, totalAprobado);
  return {
    filas: out,
    total: {
      matriculas: out.reduce((s, f) => s + f.matriculas, 0),
      totalGd, totalAprobado,
      gdVsAprobado: gva == null ? null : gva - 1,
    },
  };
}

// ─── Por partida ─────────────────────────────────────────────────────────────

export interface FilaPartida {
  partida:       string;   // "" = sin partida
  descripcion:   string;
  /** Matrículas con cantidad aprobada. */
  matriculas:    number;
  cantAprobadas: number;
  totalGd:       number;
  totalAjustado: number;
  pctAjustado:   number | null;
}

export interface ResumenPartidas {
  filas: FilaPartida[];
  total: { matriculas: number; cantAprobadas: number; totalGd: number; totalAjustado: number };
}

/** Descripción de cada partida según Global (la más repetida). */
export function descripcionesPartida(filas: FilaCalc[]): Map<string, string> {
  const votos = new Map<string, Map<string, number>>();
  for (const { it } of filas) {
    const p = String(it.partida ?? "").trim();
    const d = String(it.partida_descripcion ?? "").trim();
    if (!p || !d) continue;
    const m = votos.get(p) ?? new Map<string, number>();
    m.set(d, (m.get(d) ?? 0) + 1);
    votos.set(p, m);
  }
  const out = new Map<string, string>();
  for (const [p, m] of votos) out.set(p, [...m].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}

export function resumenPartidas(filas: FilaCalc[], descripciones: Map<string, string>): ResumenPartidas {
  const acc = new Map<string, FilaPartida>();
  for (const { it, calc } of filas) {
    const p = String(it.partida ?? "").trim();
    const a = acc.get(p) ?? {
      partida: p, descripcion: descripciones.get(p) ?? "",
      matriculas: 0, cantAprobadas: 0, totalGd: 0, totalAjustado: 0, pctAjustado: null,
    };
    const cant = it.cant_aprobadas ?? 0;
    if (cant !== 0) a.matriculas++;
    a.cantAprobadas += cant;
    a.totalGd += calc.total_plan;
    a.totalAjustado += calc.total_ajustado;
    acc.set(p, a);
  }
  const out = [...acc.values()].sort((a, b) =>
    (a.partida === "" ? 1 : 0) - (b.partida === "" ? 1 : 0) || a.descripcion.localeCompare(b.descripcion, "es"));
  const totalAjustado = out.reduce((s, f) => s + f.totalAjustado, 0);
  for (const f of out) f.pctAjustado = div(f.totalAjustado, totalAjustado);
  return {
    filas: out,
    total: {
      matriculas: out.reduce((s, f) => s + f.matriculas, 0),
      cantAprobadas: out.reduce((s, f) => s + f.cantAprobadas, 0),
      totalGd: out.reduce((s, f) => s + f.totalGd, 0),
      totalAjustado,
    },
  };
}

// ─── Cuentas contables ───────────────────────────────────────────────────────

/** EXTRAE(cuenta; 6; 12): «3051-010102100001-000-…» → «010102100001». */
export const partidaDeCuenta = (cuenta: string) => cuenta.trim().slice(5, 17);

export interface FilaCuenta {
  orden:       number;
  cuenta:      string;
  partida:     string;
  descripcion: string | null;
  /** Total pegado en el Excel. */
  totalExcel:  number | null;
  /** Total Ajustado de Global para esa partida. null en una partida repetida. */
  totalCalc:   number | null;
  diferencia:  number | null;
  /** Orden de la cuenta anterior con la misma partida (su total ya se contó ahí). */
  repiteDe:    number | null;
}

export interface ResumenCuentas {
  filas: FilaCuenta[];
  total: { totalExcel: number; totalCalc: number };
  /** Partidas con Total Ajustado que no tienen ninguna cuenta contable. */
  sinCuenta: FilaPartida[];
}

export function resumenCuentas(
  cuentas: { orden: number; cuenta: string; total: number | null }[],
  partidas: ResumenPartidas,
  descripciones: Map<string, string>,
): ResumenCuentas {
  const porPartida = new Map(partidas.filas.map((p) => [p.partida, p]));
  const primera = new Map<string, number>();
  const filas: FilaCuenta[] = cuentas.map((c) => {
    const partida = partidaDeCuenta(c.cuenta);
    const repiteDe = primera.get(partida) ?? null;
    if (repiteDe == null) primera.set(partida, c.orden);
    const totalCalc = repiteDe != null ? null : porPartida.get(partida)?.totalAjustado ?? 0;
    return {
      orden: c.orden, cuenta: c.cuenta, partida,
      descripcion: descripciones.get(partida) ?? null,
      totalExcel: c.total,
      totalCalc,
      diferencia: totalCalc == null ? null : (c.total ?? 0) - totalCalc,
      repiteDe,
    };
  });
  return {
    filas,
    total: {
      totalExcel: filas.reduce((s, f) => s + (f.totalExcel ?? 0), 0),
      totalCalc: filas.reduce((s, f) => s + (f.totalCalc ?? 0), 0),
    },
    sinCuenta: partidas.filas.filter((p) => !primera.has(p.partida) && p.totalAjustado !== 0),
  };
}
