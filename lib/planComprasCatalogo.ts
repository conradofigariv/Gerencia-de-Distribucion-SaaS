// ─────────────────────────────────────────────────────────────────────────────
// Plan de Compras — cruce del Excel importado contra el catálogo propio
// (tabla `matriculas`).
//
// Antes de subir un plan, el modal de importación lista:
//   • las matrículas del Excel que NO están en el catálogo (con botón para
//     darlas de alta), y
//   • las que están pero con datos distintos (descripción, unidad, M/S).
//
// El cruce es por la clave normalizada `normArticulo` — la misma regla que
// `gd_norm_articulo` en SQL: se quita SOLO el sufijo «.0» del export de Excel.
// Así «00021126.0» del plan y «00021126» de otra fuente son la misma matrícula,
// pero lo que se guarda (en el plan y en el catálogo) es el código literal.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabaseClient";
import { listMatriculas, tipoFromMatServ, type Matricula } from "@/lib/matriculas";
import type { PlanComprasItemInput } from "@/lib/planComprasCalc";

/** Clave de cruce: trim + sin el sufijo «.0»/«.00» (nunca «.1»). */
export function normArticulo(raw: string | null | undefined): string {
  return String(raw ?? "").trim().replace(/\.0+$/, "");
}

/** «00000000» es un relleno del Excel, no una matrícula: no se cruza. */
const esRelleno = (clave: string) => /^0+$/.test(clave);

export interface FaltanteCatalogo {
  articulo:    string;  // literal, como viene en el Excel
  descripcion: string;
  unidad:      string;
  mat_serv:    string;
  familia:     string;
  a_cargo_de:  string;
}

export type CampoCatalogo = "Descripción" | "Unidad" | "M/S";

export interface DiferenciaCatalogo {
  articulo: string;   // literal del Excel
  campo:    CampoCatalogo;
  plan:     string;
  catalogo: string;
}

export interface CruceCatalogo {
  /** Matrículas distintas del Excel que se cruzaron (sin rellenos). */
  revisadas:   number;
  /** Cuántas de esas ya están en el catálogo. */
  enCatalogo:  number;
  faltantes:   FaltanteCatalogo[];
  diferencias: DiferenciaCatalogo[];
  /** Tamaño del catálogo al momento del cruce. */
  catalogo:    number;
}

const txt = (v: unknown) => String(v ?? "").trim();
/** Para comparar textos: sin mayúsculas ni espacios de más. */
const comparable = (v: unknown) => txt(v).replace(/\s+/g, " ").toLocaleUpperCase("es-AR");

/** Cruza los ítems del Excel con el catálogo. Puro: no toca la base. */
export function cruzarConCatalogo(
  items: PlanComprasItemInput[],
  catalogo: Pick<Matricula, "articulo" | "descripcion" | "unidad_medida" | "mat_serv">[],
): CruceCatalogo {
  const porClave = new Map<string, (typeof catalogo)[number]>();
  for (const m of catalogo) {
    const k = normArticulo(m.articulo);
    if (k && !porClave.has(k)) porClave.set(k, m);
  }

  const vistas = new Set<string>();
  const faltantes: FaltanteCatalogo[] = [];
  const diferencias: DiferenciaCatalogo[] = [];
  let enCatalogo = 0;

  for (const it of items) {
    const clave = normArticulo(it.articulo);
    if (!clave || esRelleno(clave) || vistas.has(clave)) continue;
    vistas.add(clave);

    const m = porClave.get(clave);
    if (!m) {
      faltantes.push({
        articulo:    txt(it.articulo),
        descripcion: txt(it.descripcion),
        unidad:      txt(it.unidad),
        mat_serv:    txt(it.mat_serv),
        familia:     txt(it.familia),
        a_cargo_de:  txt(it.a_cargo_de),
      });
      continue;
    }
    enCatalogo++;

    // Solo se avisa cuando los DOS lados tienen dato: un vacío no es una
    // contradicción, es información que falta de un lado.
    const dif = (campo: CampoCatalogo, plan: unknown, cat: unknown, igual: boolean) => {
      if (!txt(plan) || !txt(cat) || igual) return;
      diferencias.push({ articulo: txt(it.articulo), campo, plan: txt(plan), catalogo: txt(cat) });
    };
    dif("Descripción", it.descripcion, m.descripcion, comparable(it.descripcion) === comparable(m.descripcion));
    dif("Unidad", it.unidad, m.unidad_medida, comparable(it.unidad) === comparable(m.unidad_medida));
    const tp = tipoFromMatServ(it.mat_serv), tc = tipoFromMatServ(m.mat_serv);
    dif("M/S", it.mat_serv, m.mat_serv, !tp || !tc || tp === tc);
  }

  return {
    revisadas: vistas.size, enCatalogo, faltantes, diferencias, catalogo: catalogo.length,
  };
}

/** Descarga el catálogo y cruza. */
export async function revisarContraCatalogo(items: PlanComprasItemInput[]): Promise<CruceCatalogo> {
  return cruzarConCatalogo(items, await listMatriculas());
}

/**
 * Da de alta en el catálogo las matrículas faltantes, con el código literal
 * del Excel. Antes de insertar vuelve a leer el catálogo: si entre la revisión
 * y el clic alguien cargó alguna, no se duplica. Devuelve cuántas insertó.
 *
 * No reconstruye el índice del Buscador (ver `reconstruirIndiceEnSegundoPlano`:
 * tarda minutos y no es para altas sueltas); se hace desde el Buscador.
 */
export async function altaEnCatalogo(
  faltantes: FaltanteCatalogo[],
  onProgreso?: (hechas: number, total: number) => void,
): Promise<number> {
  const existentes = new Set((await listMatriculas()).map((m) => normArticulo(m.articulo)));
  const ahora = new Date().toISOString();
  const filas = faltantes
    .filter((f) => !existentes.has(normArticulo(f.articulo)))
    .map((f) => ({
      articulo:      f.articulo,
      descripcion:   f.descripcion,
      unidad_medida: f.unidad,
      mat_serv:      f.mat_serv,
      estado:        "",
      updated_at:    ahora,
    }));

  const LOTE = 500;
  for (let i = 0; i < filas.length; i += LOTE) {
    const { error } = await supabase.from("matriculas").insert(filas.slice(i, i + LOTE));
    if (error) {
      throw new Error(
        `Se dieron de alta ${i.toLocaleString("es-AR")} de ${filas.length.toLocaleString("es-AR")}; ` +
        `el resto falló: ${error.message}`,
      );
    }
    onProgreso?.(Math.min(i + LOTE, filas.length), filas.length);
  }
  return filas.length;
}

// ─── CSV (mismo formato que el Catálogo: UTF-16LE + BOM + tabulador) ─────────

const SEP = "\t";
const celda = (v: string) => (/[\t"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function utf16le(text: string): ArrayBuffer {
  const s = "﻿" + text;
  const buf = new ArrayBuffer(s.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < s.length; i++) view.setUint16(i * 2, s.charCodeAt(i), true);
  return buf;
}

export function descargarCsv(nombre: string, encabezados: string[], filas: string[][]): void {
  const lineas = [encabezados, ...filas].map((f) => f.map(celda).join(SEP));
  const blob = new Blob([utf16le(lineas.join("\r\n"))], { type: "text/csv;charset=utf-16le;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nombre}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
