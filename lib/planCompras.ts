import { supabase } from "@/lib/supabaseClient";

/**
 * Plan de Compras — plan anual de matrículas con cantidades y precios.
 *
 * Reemplaza el Excel «PC ANUAL GD» (pestaña Global). SQL en
 * `supabase/plan_compras.sql`, que explica el modelo en detalle.
 *
 * Lo importante de este archivo son las FÓRMULAS (`calcularItem`): en el Excel
 * la mitad de las columnas son cálculos, y acá se replican exactas para que
 * los números den igual que en el archivo que la oficina viene usando.
 */

export interface PlanCompra {
  id:          string;
  anio:        number;
  nombre:      string;
  tipo_cambio: number;
  created_at?: string;
  updated_at?: string;
}

export interface PlanCompraItem {
  id:      string;
  plan_id: string;
  articulo:    string;
  descripcion: string;
  unidad:      string;
  mat_serv:            string;
  familia:             string;
  subfamilia:          string;
  a_cargo_de:          string;
  partida:             string;
  descripcion_partida: string;
  gd:            number;
  cant_aprobada: number;
  pu_sic:     number;
  pu_op:      number;
  pu_est_usd: number;
}

/** Campos de un ítem que se editan a mano (todo menos id/plan_id). */
export type PlanCompraItemInput = Omit<PlanCompraItem, "id" | "plan_id">;

/**
 * Las columnas que se pueden cargar de a una para todo el plan.
 *
 * NO están ni `descripcion`/`unidad`/`mat_serv` (vienen del catálogo) ni las
 * calculadas (Recorte, Pu Est ($), Total $…): esas se derivan, cargarlas a
 * mano sería poder dejarlas en un valor que no se corresponde con su fórmula.
 */
export const CAMPOS_CARGABLES = [
  { campo: "familia",       label: "Familia",      numerico: false },
  { campo: "subfamilia",    label: "Subfamilia",   numerico: false },
  { campo: "a_cargo_de",    label: "A cargo de",   numerico: false },
  { campo: "gd",            label: "GD",           numerico: true  },
  { campo: "cant_aprobada", label: "Cant. aprobada", numerico: true },
  { campo: "pu_sic",        label: "Pu Sic",       numerico: true  },
  { campo: "pu_op",         label: "Pu OP",        numerico: true  },
  { campo: "pu_est_usd",    label: "Pu Est (USD)", numerico: true  },
] as const;

export type CampoCargable = (typeof CAMPOS_CARGABLES)[number]["campo"];
type CampoNumerico = "gd" | "cant_aprobada" | "pu_sic" | "pu_op" | "pu_est_usd";

const CAMPOS_NUMERICOS: CampoNumerico[] = ["gd", "cant_aprobada", "pu_sic", "pu_op", "pu_est_usd"];

export const esCampoNumerico = (campo: CampoCargable): boolean =>
  CAMPOS_NUMERICOS.includes(campo as CampoNumerico);

/** Los valores derivados de un ítem — no se guardan, se calculan. */
export interface PlanCompraCalculado {
  recorte:       number;
  puSicMas20:    number;
  puEstArs:      number;
  verifPrecio:   number;
  totalArs:      number;
}

const ITEM_COLS =
  "id, plan_id, articulo, descripcion, unidad, mat_serv, familia, subfamilia, " +
  "a_cargo_de, partida, descripcion_partida, gd, cant_aprobada, pu_sic, pu_op, pu_est_usd";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const str = (v: unknown): string => String(v ?? "").trim();

// ─── Fórmulas ───────────────────────────────────────────────────────────────

/**
 * Replica las columnas calculadas del Excel. `tipoCambio` es el del plan
 * (una sola celda en el archivo original, ver el SQL).
 *
 * ⚠ Los redondeos NO son decorativos: el Excel usa ROUND en «Pu Sic + 20%» y
 *   ROUNDUP en «Pu Est ($)». Si acá se redondeara distinto, los totales del
 *   plan no coincidirían con los que la oficina ya conoce.
 */
export function calcularItem(item: PlanCompraItem, tipoCambio: number): PlanCompraCalculado {
  const gd    = num(item.gd);
  const puSic = num(item.pu_sic);
  const puOp  = num(item.pu_op);

  // =ROUND(MAX(Pu Sic; Pu OP) * 1,2; 0)
  const puSicMas20 = Math.round(Math.max(puSic, puOp) * 1.2);
  // =ROUNDUP(Pu Est (USD) * TC; 0)
  const puEstArs   = Math.ceil(num(item.pu_est_usd) * num(tipoCambio));
  // =IFERROR(Pu Est ($) / Pu Sic + 20% - 1; 0) — el IFERROR cubre el divisor 0
  const verifPrecio = puSicMas20 ? puEstArs / puSicMas20 - 1 : 0;

  return {
    recorte: num(item.cant_aprobada) - gd,
    puSicMas20,
    puEstArs,
    verifPrecio,
    totalArs: puEstArs * gd,
  };
}

/** Total del plan en $ — el denominador de «% Incidencia». */
export function totalPlan(items: PlanCompraItem[], tipoCambio: number): number {
  return items.reduce((acc, it) => acc + calcularItem(it, tipoCambio).totalArs, 0);
}

/**
 * Peso de un ítem sobre el total del plan. Se pasa el total ya calculado
 * porque quien renderiza la tabla lo necesita una sola vez, no por fila.
 */
export function incidencia(totalItemArs: number, totalPlanArs: number): number {
  return totalPlanArs ? totalItemArs / totalPlanArs : 0;
}

// ─── Planes ─────────────────────────────────────────────────────────────────

/** Todos los planes, del año más nuevo al más viejo. */
export async function listPlanes(): Promise<PlanCompra[]> {
  const { data, error } = await supabase
    .from("planes_compra")
    .select("id, anio, nombre, tipo_cambio, created_at, updated_at")
    .order("anio", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PlanCompra[];
}

/** Crea el plan de un año. Falla si ese año ya tiene plan (UNIQUE en la base). */
export async function createPlan(
  anio: number, nombre: string, tipoCambio: number, userId?: string | null,
): Promise<PlanCompra> {
  const { data, error } = await supabase
    .from("planes_compra")
    .insert({
      anio,
      nombre: str(nombre) || `Plan de Compras ${anio}`,
      tipo_cambio: num(tipoCambio),
      created_by: userId ?? null,
    })
    .select("id, anio, nombre, tipo_cambio, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return data as PlanCompra;
}

/** Edita el encabezado del plan (nombre y/o tipo de cambio). */
export async function updatePlan(
  id: string, campos: Partial<Pick<PlanCompra, "nombre" | "tipo_cambio">>,
): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (campos.nombre      !== undefined) patch.nombre      = str(campos.nombre);
  if (campos.tipo_cambio !== undefined) patch.tipo_cambio = num(campos.tipo_cambio);

  const { error } = await supabase.from("planes_compra").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Borra un plan y, en cascada, todos sus ítems. */
export async function deletePlan(id: string): Promise<void> {
  const { error } = await supabase.from("planes_compra").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ─── Ítems ──────────────────────────────────────────────────────────────────

/** Ítems de un plan, ordenados por matrícula. */
export async function listItems(planId: string): Promise<PlanCompraItem[]> {
  const PAGE = 1000;
  const out: PlanCompraItem[] = [];

  const first = await supabase
    .from("plan_compra_items")
    .select(ITEM_COLS, { count: "exact" })
    .eq("plan_id", planId)
    .order("articulo", { ascending: true })
    .range(0, PAGE - 1);
  if (first.error) throw new Error(first.error.message);
  out.push(...((first.data ?? []) as unknown as PlanCompraItem[]));

  const total = first.count ?? out.length;
  for (let from = PAGE; from < total; from += PAGE) {
    const res = await supabase
      .from("plan_compra_items")
      .select(ITEM_COLS)
      .eq("plan_id", planId)
      .order("articulo", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error) throw new Error(res.error.message);
    out.push(...((res.data ?? []) as unknown as PlanCompraItem[]));
  }
  return out;
}

/**
 * Suma matrículas al plan. Las que ya estaban se ignoran (no se pisan): el
 * `onConflict` con `ignoreDuplicates` evita borrar lo ya cargado a mano si
 * alguien vuelve a pegar una lista que se solapa.
 *
 * Devuelve cuántas entraron de verdad.
 */
export async function agregarItems(
  planId: string,
  filas: DatosCatalogo[],
): Promise<number> {
  if (filas.length === 0) return 0;

  const rows = filas.map((f) => ({
    plan_id:     planId,
    articulo:    str(f.articulo),
    descripcion: str(f.descripcion),
    unidad:      str(f.unidad),
    mat_serv:    str(f.mat_serv),
  }));

  const { data, error } = await supabase
    .from("plan_compra_items")
    .upsert(rows, { onConflict: "plan_id,articulo", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** Guarda los campos editados de un ítem. */
export async function updateItem(
  id: string, campos: Partial<PlanCompraItemInput>,
): Promise<void> {
  const textos = [
    "descripcion", "unidad", "familia", "subfamilia",
    "a_cargo_de", "partida", "descripcion_partida",
  ] as const;
  const numeros = ["gd", "cant_aprobada", "pu_sic", "pu_op", "pu_est_usd"] as const;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of textos)  if (campos[k] !== undefined) patch[k] = str(campos[k]);
  for (const k of numeros) if (campos[k] !== undefined) patch[k] = num(campos[k]);

  const { error } = await supabase.from("plan_compra_items").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Carga UNA columna de golpe para las matrículas que ya están en el plan.
 *
 * Es la alternativa a tipear celda por celda: se pega «matrícula + valor» tal
 * como sale de copiar dos columnas del Excel. Solo pisa la columna elegida;
 * el resto de la fila queda como estaba.
 *
 * ⚠ Las matrículas que no estén en el plan hay que filtrarlas ANTES de llamar
 *   (lo hace `prepararColumna`): este upsert las insertaría como filas nuevas
 *   a medio llenar.
 */
export async function cargarColumna(
  planId: string,
  campo: CampoCargable,
  valores: { articulo: string; valor: string | number }[],
): Promise<number> {
  if (valores.length === 0) return 0;

  const LOTE = 500;
  let escritas = 0;

  for (let i = 0; i < valores.length; i += LOTE) {
    const rows = valores.slice(i, i + LOTE).map((v) => ({
      plan_id:  planId,
      articulo: str(v.articulo),
      // PostgREST hace ON CONFLICT DO UPDATE solo con las columnas que van en
      // el payload, así que mandar `plan_id`, `articulo` y el campo alcanza
      // para actualizar ese campo sin tocar los demás.
      [campo]: CAMPOS_NUMERICOS.includes(campo as CampoNumerico) ? num(v.valor) : str(v.valor),
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from("plan_compra_items")
      .upsert(rows, { onConflict: "plan_id,articulo" })
      .select("id");
    if (error) throw new Error(error.message);
    escritas += data?.length ?? 0;
  }
  return escritas;
}

/** Saca una matrícula del plan. */
export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from("plan_compra_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ─── Pegado de matrículas ───────────────────────────────────────────────────

/**
 * Separa una lista pegada en matrículas sueltas. Tolera saltos de línea, tabs,
 * comas y punto y coma (según de dónde se copie), y descarta repetidas.
 */
export function parseMatriculasPegadas(texto: string): string[] {
  return [...new Set(
    texto.split(/[\r\n\t,;]+/).map((s) => s.trim()).filter(Boolean),
  )];
}

/** Los datos que el catálogo aporta a una fila del plan. */
export interface DatosCatalogo {
  articulo:    string;
  descripcion: string;
  unidad:      string;
  mat_serv:    string;
}

/**
 * Interpreta un número escrito a la argentina o a la inglesa.
 *
 * Si hay coma, la coma es el decimal y los puntos son separadores de miles
 * («1.070,50»). Si no hay coma, el punto se toma como decimal («5.43»), que
 * es lo que aparece en los precios. El caso ambiguo —«1.070» -que puede ser
 * mil setenta o uno coma cero siete— cae del lado decimal, y por eso la UI
 * muestra el valor ya interpretado antes de escribir nada.
 */
export function parseNumero(texto: string): number | null {
  const t = String(texto ?? "").trim().replace(/\s|\$|%/g, "");
  if (t === "") return null;
  const limpio = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

export interface FilaColumna {
  articulo: string;
  /** El texto tal como se pegó — para mostrarlo si no se pudo interpretar. */
  crudo:    string;
  valor:    string | number;
}

export interface PreviewColumna {
  /** Van a escribirse: la matrícula está en el plan y el valor es válido. */
  aplicar:       FilaColumna[];
  /** Matrículas pegadas que no están en este plan — se omiten. */
  fueraDelPlan:  string[];
  /** Filas cuyo valor no se pudo interpretar como número — se omiten. */
  invalidas:     { articulo: string; crudo: string }[];
}

// ─── Pegado de un bloque de Excel ───────────────────────────────────────────
//
// El caso real: en la planilla la columna «Artículo» y la del dato (Pu Sic,
// GD, Familia…) están lejos entre sí, y Excel no deja copiar dos columnas no
// adyacentes y pegarlas una al lado de la otra. Entonces se pega el RANGO
// ENTERO con su fila de encabezados, y acá se reconoce cada columna por su
// título. Así el artículo viaja en el mismo bloque que los valores y no hay
// que confiar en que las filas queden en el mismo orden.

/** Encabezado normalizado: sin acentos, sin dobles espacios, en minúscula. */
function normHeader(h: string): string {
  return String(h ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Título de columna del Excel → campo del plan.
 *
 * El match es EXACTO sobre el encabezado normalizado, no por "contiene": hay
 * títulos que se parecen y no son lo mismo. «familias viejas» no es
 * «familia», y «pu sic + 20%» es una fórmula, no «pu sic» — mapearlos por
 * parecido escribiría datos en la columna equivocada.
 *
 * A «GD» se le saca el año antes de comparar («GD 2025», «GD 2027» → «gd»),
 * porque cambia de nombre en cada plan.
 */
const ALIAS_HEADERS: Record<string, CampoCargable> = {
  "familia":           "familia",
  "subfamilia":        "subfamilia",
  "a cargo de":        "a_cargo_de",
  "gd":                "gd",
  "cant. aprobadas":   "cant_aprobada",
  "cant aprobadas":    "cant_aprobada",
  "cant. aprobada":    "cant_aprobada",
  "cantidad aprobada": "cant_aprobada",
  "pu sic":            "pu_sic",
  "pu op":             "pu_op",
  "pu est (usd)":      "pu_est_usd",
  "pu est usd":        "pu_est_usd",
};

/** ¿Este encabezado es la columna de matrículas? */
function esHeaderArticulo(h: string): boolean {
  const n = normHeader(h);
  return n === "articulo" || n === "matricula" || n === "matriculas";
}

/** Campo al que corresponde un encabezado, o null si no se reconoce. */
export function campoDeHeader(header: string): CampoCargable | null {
  const n = normHeader(header).replace(/\s*\d{4}\s*$/, "").trim();
  return ALIAS_HEADERS[n] ?? null;
}

export interface BloqueParseado {
  headers: string[];
  filas:   string[][];
  /** Índice de la columna de matrículas, o -1 si no se encontró. */
  colArticulo: number;
  /** Mapeo propuesto: índice de columna → campo del plan. */
  mapeo: Record<number, CampoCargable>;
}

/**
 * Parte el bloque pegado en encabezados + filas, y propone qué es cada
 * columna. La primera línea SIEMPRE se toma como encabezado: es lo que hace
 * falta para reconocer las columnas, y pegar sin ella no permitiría saber
 * cuál es cuál.
 */
export function parseBloque(texto: string): BloqueParseado {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lineas.length === 0) return { headers: [], filas: [], colArticulo: -1, mapeo: {} };

  const sep = lineas[0].includes("\t") ? "\t" : lineas[0].includes(";") ? ";" : "\t";
  const corte = (l: string) => l.split(sep).map((c) => c.trim());

  const headers = corte(lineas[0]);
  const filas   = lineas.slice(1).map(corte);

  const colArticulo = headers.findIndex(esHeaderArticulo);

  const mapeo: Record<number, CampoCargable> = {};
  headers.forEach((h, i) => {
    if (i === colArticulo) return;
    const campo = campoDeHeader(h);
    // Una misma columna del plan no puede venir de dos columnas del pegado.
    if (campo && !Object.values(mapeo).includes(campo)) mapeo[i] = campo;
  });

  return { headers, filas, colArticulo, mapeo };
}

/** Una fila lista para escribir: la matrícula y los campos que trae. */
export interface FilaBloque {
  articulo: string;
  campos:   Partial<Record<CampoCargable, string | number>>;
}

export interface PreviewBloque {
  aplicar:      FilaBloque[];
  fueraDelPlan: string[];
  /** Celdas numéricas que no se pudieron interpretar (se dejan sin tocar). */
  invalidas:    { articulo: string; campo: CampoCargable; crudo: string }[];
}

/**
 * Cruza el bloque contra las matrículas del plan y arma lo que se va a
 * escribir. Las celdas VACÍAS se ignoran (no se escriben): en una planilla
 * grande lo normal es que muchas columnas estén en blanco, y tomarlas como
 * "poner en cero / borrar el texto" pisaría datos ya cargados.
 */
export function prepararBloque(
  bloque: BloqueParseado,
  mapeo: Record<number, CampoCargable>,
  articulosDelPlan: Set<string>,
): PreviewBloque {
  const out: PreviewBloque = { aplicar: [], fueraDelPlan: [], invalidas: [] };
  if (bloque.colArticulo < 0) return out;

  const vistos = new Set<string>();

  for (const fila of bloque.filas) {
    const articulo = (fila[bloque.colArticulo] ?? "").trim();
    if (!articulo || vistos.has(articulo)) continue;
    vistos.add(articulo);

    if (!articulosDelPlan.has(articulo)) { out.fueraDelPlan.push(articulo); continue; }

    const campos: FilaBloque["campos"] = {};
    for (const [idx, campo] of Object.entries(mapeo)) {
      const crudo = (fila[Number(idx)] ?? "").trim();
      if (crudo === "") continue;

      if (esCampoNumerico(campo)) {
        const n = parseNumero(crudo);
        if (n === null) { out.invalidas.push({ articulo, campo, crudo }); continue; }
        campos[campo] = n;
      } else {
        campos[campo] = crudo;
      }
    }
    if (Object.keys(campos).length > 0) out.aplicar.push({ articulo, campos });
  }
  return out;
}

/**
 * Escribe las filas del bloque. Cada fila puede traer varias columnas a la
 * vez; se manda solo lo que trae, así las columnas que el pegado no incluía
 * quedan como estaban.
 */
export async function cargarBloque(planId: string, filas: FilaBloque[]): Promise<number> {
  if (filas.length === 0) return 0;

  // ⚠ PostgREST exige que TODAS las filas de un mismo upsert tengan las
  //   mismas claves. Como cada fila trae solo las celdas que no venían
  //   vacías, se agrupan por "juego de columnas" y se manda un upsert por
  //   grupo. En la práctica son pocos grupos: las planillas suelen tener las
  //   mismas columnas llenas en casi todas las filas.
  const grupos = new Map<string, FilaBloque[]>();
  for (const f of filas) {
    const clave = Object.keys(f.campos).sort().join("|");
    const g = grupos.get(clave);
    if (g) g.push(f);
    else grupos.set(clave, [f]);
  }

  const LOTE = 500;
  let escritas = 0;

  for (const grupo of grupos.values()) {
    for (let i = 0; i < grupo.length; i += LOTE) {
      const rows = grupo.slice(i, i + LOTE).map((f) => ({
        plan_id:    planId,
        articulo:   f.articulo,
        ...f.campos,
        updated_at: new Date().toISOString(),
      }));

      const { data, error } = await supabase
        .from("plan_compra_items")
        .upsert(rows, { onConflict: "plan_id,articulo" })
        .select("id");
      if (error) throw new Error(error.message);
      escritas += data?.length ?? 0;
    }
  }
  return escritas;
}

/**
 * Separa una línea pegada en «matrícula» y «valor».
 *
 * El tab manda, porque es lo que produce copiar celdas de Excel. Si la línea
 * trae columnas del medio (copiaron un rango, no dos columnas sueltas), se
 * toman la PRIMERA como matrícula y la ÚLTIMA con contenido como valor.
 *
 * Recién si no hay tabs se prueba con `;` y por último con `,`, y ahí sí
 * corta en la primera aparición: un valor de texto puede tener comas adentro
 * («HERRAJES, MORSETERIA») y partirlo lo arruinaría.
 */
function partirLinea(linea: string): { articulo: string; crudo: string } | null {
  for (const sep of ["\t", ";"]) {
    if (linea.includes(sep)) {
      const partes = linea.split(sep).map((s) => s.trim());
      const articulo = partes[0];
      const valor = [...partes.slice(1)].reverse().find((p) => p !== "") ?? "";
      return articulo ? { articulo, crudo: valor } : null;
    }
  }
  const m = /^([^,]+),([\s\S]*)$/.exec(linea);
  if (!m) return null;
  const articulo = m[1].trim();
  return articulo ? { articulo, crudo: m[2].trim() } : null;
}

/**
 * Parte el pegado de «matrícula + valor» y lo contrasta contra las matrículas
 * que ya tiene el plan. Cada línea es una fila.
 */
export function prepararColumna(
  texto: string,
  campo: CampoCargable,
  articulosDelPlan: Set<string>,
): PreviewColumna {
  const numerico = esCampoNumerico(campo);
  const out: PreviewColumna = { aplicar: [], fueraDelPlan: [], invalidas: [] };
  const vistos = new Set<string>();

  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim()) continue;

    const partido = partirLinea(linea);
    if (!partido) continue;
    const { articulo, crudo } = partido;
    if (vistos.has(articulo)) continue;
    vistos.add(articulo);

    if (!articulosDelPlan.has(articulo)) { out.fueraDelPlan.push(articulo); continue; }

    if (numerico) {
      const n = parseNumero(crudo);
      if (n === null) { out.invalidas.push({ articulo, crudo }); continue; }
      out.aplicar.push({ articulo, crudo, valor: n });
    } else {
      out.aplicar.push({ articulo, crudo, valor: crudo });
    }
  }
  return out;
}

export interface CruceCatalogo {
  /** Matrículas que existen en el catálogo, con sus datos. */
  reconocidas:   DatosCatalogo[];
  /** Las que no aparecen en `matriculas` — se informan y no se agregan. */
  noEncontradas: string[];
}

/**
 * Cruza las matrículas pegadas contra el catálogo (`matriculas`), trayendo
 * descripción, unidad y Mat/Serv. El cruce es por igualdad exacta de
 * `articulo`, igual que en el resto del sistema (el número va con su `.0` y
 * sus ceros).
 */
export async function cruzarContraCatalogo(articulos: string[]): Promise<CruceCatalogo> {
  if (articulos.length === 0) return { reconocidas: [], noEncontradas: [] };

  // De a tandas: un `in` con miles de valores no entra en la URL del request.
  const LOTE = 200;
  const encontrados = new Map<string, Omit<DatosCatalogo, "articulo">>();

  for (let i = 0; i < articulos.length; i += LOTE) {
    const lote = articulos.slice(i, i + LOTE);
    const { data, error } = await supabase
      .from("matriculas")
      .select("articulo, descripcion, unidad_medida, mat_serv")
      .in("articulo", lote);
    if (error) throw new Error(error.message);
    for (const m of data ?? []) {
      encontrados.set(String(m.articulo), {
        descripcion: str(m.descripcion),
        unidad:      str(m.unidad_medida),
        mat_serv:    str(m.mat_serv),
      });
    }
  }

  const reconocidas: CruceCatalogo["reconocidas"] = [];
  const noEncontradas: string[] = [];
  for (const a of articulos) {
    const hit = encontrados.get(a);
    if (hit) reconocidas.push({ articulo: a, ...hit });
    else     noEncontradas.push(a);
  }
  return { reconocidas, noEncontradas };
}
