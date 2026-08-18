import { supabase } from "@/lib/supabaseClient";
import { normArticulo } from "@/lib/tableroOp";

// ─── Construcción de filas de `seguimiento` ──────────────────────────────────
//
// Estas piezas vivían dentro de la pantalla «Crear seguimiento» (retirada:
// el único camino para escribir en `seguimiento` es ahora enviar filas
// marcadas desde una pestaña del Buscador — ver `enviarMarcadasASeguimiento`
// en `lib/buscadorTabs.ts`).
//
// ⚠ Es importante que sea el MISMO cálculo y no una copia parecida: los KPIs y
//   las alertas del Resumen cuelgan de `estado_plazo`, `estado_cantidades`,
//   `saldo_linea` y `disponibilidad_meses`, que NO existen en el índice del
//   Buscador — se derivan acá, cruzando contra `planillas_op`. Si un camino los
//   calculara distinto, la misma OP daría números distintos según por dónde se
//   la cargó.

export const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };
export const str = (v: unknown) => String(v ?? "").trim();
const isoDate = (d: Date | null) => d ? d.toISOString().split("T")[0] : null;

/**
 * Texto crudo de `planillas_op.fecha_pactada`/`fecha_creacion` → Date, o null.
 *
 * Convive con TRES formatos posibles en esa columna (es texto libre, cargado
 * por distintas versiones del import de «Carga de datos»):
 *   • ISO            "2024-07-23"
 *   • Date.toString  "Tue Jul 23 2024 00:00:48 GMT-03"
 *   • Serie de Excel "45658" — cuando la celda del Excel NO estaba formateada
 *     como fecha (solo un número), el import viejo la guardaba tal cual en
 *     vez de convertirla (ver fechaStr en servicios-planillas.tsx). `new
 *     Date("45658")` no tira NaN: V8 la interpreta como el año 45658, que
 *     `toISOString()` serializa como "+045658-01-01" — un string que Postgres
 *     rechaza al insertar («time zone displacement out of range», 22009) y
 *     que sin este chequeo tumbaba «Traer del Buscador» entero por una sola
 *     fila con una fecha vieja mal cargada.
 *
 * Se detecta reconociendo el patrón numérico ANTES de intentar `new Date()`
 * genérico (que lo aceptaría como año) y se convierte con el epoch de Excel
 * (30/12/1899). Cualquier resultado con año fuera de un rango plausible
 * (1990–2100) se descarta como null en vez de propagar un Date corrupto.
 */
function parseFechaOP(raw: unknown): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    // Epoch de Excel: 30/12/1899. (Se ignora a propósito el bug histórico del
    // 29/02/1900 inexistente que arrastra Excel — un día de diferencia no
    // importa acá, es una fecha de referencia, no un cálculo financiero.)
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  return y >= 1990 && y <= 2100 ? d : null;
}

export type OpRow  = {
  numero: string; linea: string; articulo: string;
  cantidad: unknown; cantidad_recibida: unknown;
  fecha_creacion: unknown; fecha_pactada: unknown;
  proveedor: unknown; estado_cierre: unknown;
};
export type MatRow = { articulo: string; descripcion: unknown };

export interface SeguimientoRowNueva {
  zona:                   string;
  op:                     number;
  op_madre:               number;
  linea:                  number;
  matricula:              string;
  descripcion_matricula:  string;
  cantidad:               number;
  cantidad_recibida:      number;
  saldo_linea:            number;
  fecha_pactada:          string | null;
  proveedor:              string;
  fecha_redeterminacion:  null;
  precio_redeterminacion: number | null;
  estado:                 string;
  estado_plazo:           string;
  estado_cantidades:      string;
  revision:               string;
  observacion:            string | null;
  disponibilidad_meses:   number;
}

/** Métricas calculadas de una fila de OP (cantidades, estado, plazos). */
export function opMetrics(opRow: OpRow | undefined, today: Date) {
  const cantidad         = num(opRow?.cantidad);
  const cantidadRecibida = num(opRow?.cantidad_recibida);
  const saldoLinea       = cantidad - cantidadRecibida;
  const fechaCreac = parseFechaOP(opRow?.fecha_creacion);
  const fechaPact  = parseFechaOP(opRow?.fecha_pactada);
  const estadoPlazo      = fechaPact && fechaPact < today ? "VENCIDA" : "OK";
  const estadoCantidades = Math.round(saldoLinea) === 0   ? "SIN SALDO" : "VIGENTE";
  const revision         = estadoPlazo === "VENCIDA" || estadoCantidades === "SIN SALDO" ? "CERRAR" : "OK";
  const dias      = fechaCreac ? Math.floor((today.getTime() - fechaCreac.getTime()) / 86_400_000) : 0;
  const meses     = dias / 30;
  const consMes   = meses === 0 ? 0 : cantidadRecibida / meses;
  const dispMeses = consMes === 0 ? 0 : saldoLinea / consMes;
  return {
    cantidad, cantidadRecibida,
    saldo_linea: parseFloat(saldoLinea.toFixed(4)),
    fecha_pactada: isoDate(fechaPact),
    proveedor: String(opRow?.proveedor ?? ""),
    estado: String(opRow?.estado_cierre ?? ""),
    estado_plazo: estadoPlazo, estado_cantidades: estadoCantidades, revision,
    disponibilidad_meses: parseFloat(dispMeses.toFixed(2)),
  };
}

/**
 * Clave de cruce OP robusta: Número Pedido + Línea normalizados a número
 * (ignora el sufijo .0 y los ceros, que rompen el match por texto).
 * Independiente de `relacion`, que puede venir vacía o con otro formato.
 */
export const opCrossKey = (op: unknown, linea: unknown) => `${num(op)}|${num(linea)}`;

async function fetchAll<T extends Record<string, unknown>>(table: string, columns: string): Promise<T[]> {
  const PAGE = 1000;
  const result: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`Error cargando ${table}: ${error.message}`);
    if (!data?.length) break;
    result.push(...(data as unknown as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return result;
}

/** Mapas de cruce: OP por (número|línea) y matrículas por artículo. */
export async function loadCrossMaps() {
  const [opData, matData] = await Promise.all([
    fetchAll<OpRow> ("planillas_op", "numero, linea, articulo, cantidad, cantidad_recibida, fecha_creacion, fecha_pactada, proveedor, estado_cierre"),
    fetchAll<MatRow>("matriculas",   "articulo, descripcion"),
  ]);
  const opMap = new Map<string, OpRow>();
  for (const r of opData) {
    const k = opCrossKey(r.numero, r.linea);
    if (!opMap.has(k)) opMap.set(k, r);   // primer envío de la línea
  }
  const matMap = new Map<string, MatRow>();
  for (const r of matData) {
    const a = String(r.articulo);
    matMap.set(a, r);                        // literal (con .0)
    const n = normArticulo(a);
    if (!matMap.has(n)) matMap.set(n, r);    // respaldo sin .0
  }
  return { opData, opMap, matMap };
}

/**
 * Fila de `seguimiento` a partir de (zona, OP, línea, matrícula), cruzando
 * contra `planillas_op` para las cantidades/estado y contra `matriculas` para
 * la descripción. Devuelve también los errores de cruce para poder avisar
 * cuáles no se pudieron resolver.
 */
export function buildSeguimientoRow(
  input: { zona: string; op: number; op_madre: number; linea: number; matricula: string; descripcion?: string; observacion?: string | null },
  opMap: Map<string, OpRow>,
  matMap: Map<string, MatRow>,
  today: Date,
): { row: SeguimientoRowNueva; errors: string[] } {
  const opRow  = opMap.get(opCrossKey(input.op, input.linea));
  const matRow = matMap.get(input.matricula) ?? matMap.get(normArticulo(input.matricula));

  const errors: string[] = [];
  if (!opRow)  errors.push(`OP "${input.op}/${input.linea}" no encontrada en planillas_op`);
  if (!matRow) errors.push(`MATRÍCULA "${input.matricula}" no está en el catálogo (matriculas)`);

  const m = opMetrics(opRow, today);
  return {
    row: {
      zona: input.zona, op: input.op, op_madre: input.op_madre, linea: input.linea,
      matricula: input.matricula,
      // Descripción: catálogo primero; si la matrícula no está, la que vino.
      descripcion_matricula: String(matRow?.descripcion ?? input.descripcion ?? ""),
      cantidad: m.cantidad, cantidad_recibida: m.cantidadRecibida, saldo_linea: m.saldo_linea,
      fecha_pactada: m.fecha_pactada, proveedor: m.proveedor,
      fecha_redeterminacion: null, precio_redeterminacion: null,
      estado: m.estado, estado_plazo: m.estado_plazo, estado_cantidades: m.estado_cantidades,
      revision: m.revision, observacion: input.observacion ?? null,
      disponibilidad_meses: m.disponibilidad_meses,
    },
    errors,
  };
}
