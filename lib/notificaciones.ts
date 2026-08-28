import { supabase } from "./supabaseClient";

// ─── Motor de notificaciones ────────────────────────────────────────────────
// Ver supabase/notificaciones.sql para el modelo de datos.
//
// UN solo camino para que algo llegue a la campana: se define una REGLA (por
// usuario), un evaluador la convierte en NOTIFICACIONES, y los DESCARTES
// filtran lo que el usuario ya vio.
//
// Parte 1 implementa el tipo 'carga' (recordatorios de planillas). Los otros
// tres tipos ('servicios', 'transformadores', 'stock') se enchufan agregando
// su evaluador a EVALUADORES — nada más de este archivo cambia.

export type TipoRegla = "carga" | "servicios" | "transformadores" | "stock";

export interface Regla {
  id:      string;
  user_id: string;
  tipo:    TipoRegla;
  config:  Record<string, unknown>;
  activa:  boolean;
}

export type Severidad = "alta" | "media" | "baja";

export interface Notificacion {
  /** Identifica la alarma. Estable entre evaluaciones: es la clave del descarte. */
  clave:     string;
  /**
   * El ESTADO que disparó la alarma. Si cambia, un descarte previo deja de
   * aplicar y la notificación reaparece sola (ver notificaciones.sql).
   * Tiene que incluir todo lo que haga que valga la pena volver a avisar, y
   * NADA que cambie solo (un timestamp acá haría reaparecer todo siempre).
   */
  huella:    string;
  tipo:      TipoRegla;
  titulo:    string;
  detalle:   string;
  severidad: Severidad;
  /** Sección del sidebar a la que lleva el click, si aplica. */
  seccion?:  string;
}

// ─── Recordatorios de carga ─────────────────────────────────────────────────

/**
 * Las cargas periódicas que se pueden vigilar. La `key` tiene que coincidir
 * con la que la sección pasa a `markUpdated`, o el recordatorio nunca se va a
 * enterar de que se cargó.
 *
 * ⚠ Al agregar una sección de carga nueva: sumarla acá Y llamar a
 *   `markUpdated` con la misma clave desde el guardado de esa sección.
 */
export const CARGAS_VIGILABLES: { key: string; label: string; seccion: string; grupo: string }[] = [
  { key: "planillas-OP",            label: "OP — Envíos (órdenes de compra)",     seccion: "servicios-planillas",             grupo: "Carga de datos" },
  { key: "planillas-SIC",           label: "SICs",                                seccion: "servicios-planillas",             grupo: "Carga de datos" },
  { key: "planillas-TRANSACCIONES", label: "TRANSACCIONES — Log de movimientos",  seccion: "servicios-planillas",             grupo: "Carga de datos" },
  { key: "planillas-MATRICULAS",    label: "MATRÍCULAS — Catálogo de materiales", seccion: "servicios-planillas",             grupo: "Carga de datos" },
  { key: "transformadores-carga",   label: "Reserva de transformadores",          seccion: "transformadores-carga",           grupo: "Transformadores" },
  { key: "transformadores-consumo", label: "Consumo de transformadores",          seccion: "transformadores-consumo-carga",   grupo: "Transformadores" },
  { key: "stock-zona",              label: "Stock por zona",                      seccion: "stock-zona",                      grupo: "Stock" },
];

/** Frecuencia por defecto de una carga que el usuario todavía no configuró. */
export const FRECUENCIA_DEFAULT = 7;

export interface ConfigCarga {
  section_id:      string;
  frecuencia_dias: number;
  hora:            string | null;   // "HH:MM", opcional
}

/** Última carga de cada sección — dato COMPARTIDO (ver notificaciones.sql). */
export interface UltimaCarga {
  section_id:      string;
  last_updated_at: string | null;
}

const sbErr = (e: { message?: string } | null) =>
  new Error(e?.message ?? "Error desconocido de Supabase");

const DIA_MS = 86_400_000;

export async function fetchReglas(userId: string): Promise<Regla[]> {
  const { data, error } = await supabase
    .from("notif_reglas")
    .select("id, user_id, tipo, config, activa")
    .eq("user_id", userId);
  if (error) throw sbErr(error);
  return (data ?? []) as Regla[];
}

export async function fetchUltimasCargas(): Promise<UltimaCarga[]> {
  const { data, error } = await supabase
    .from("section_reminders")
    .select("section_id, last_updated_at");
  if (error) throw sbErr(error);
  return (data ?? []) as UltimaCarga[];
}

/**
 * Guarda (o crea) la regla de carga de una sección para este usuario.
 * `activa: false` = "no me interesa que me recuerden esta carga".
 */
export async function guardarReglaCarga(
  userId: string,
  sectionId: string,
  frecuenciaDias: number,
  hora: string | null,
  activa: boolean
): Promise<void> {
  const existentes = await supabase
    .from("notif_reglas")
    .select("id")
    .eq("user_id", userId)
    .eq("tipo", "carga")
    .eq("config->>section_id", sectionId)
    .maybeSingle();

  const fila = {
    user_id: userId,
    tipo:    "carga" as const,
    config:  { section_id: sectionId, frecuencia_dias: frecuenciaDias, hora },
    activa,
    updated_at: new Date().toISOString(),
  };

  const { error } = existentes.data?.id
    ? await supabase.from("notif_reglas").update(fila).eq("id", existentes.data.id)
    : await supabase.from("notif_reglas").insert(fila);
  if (error) throw sbErr(error);
}

// ─── Descartes ──────────────────────────────────────────────────────────────

export interface Descarte {
  clave:  string;
  huella: string;
}

export async function fetchDescartes(userId: string): Promise<Descarte[]> {
  const { data, error } = await supabase
    .from("notif_descartes")
    .select("clave, huella")
    .eq("user_id", userId);
  if (error) throw sbErr(error);
  return (data ?? []) as Descarte[];
}

/** Silencia una notificación mientras su estado (huella) no cambie. */
export async function descartar(userId: string, clave: string, huella: string): Promise<void> {
  const { error } = await supabase
    .from("notif_descartes")
    .upsert(
      { user_id: userId, clave, huella, descartado_at: new Date().toISOString() },
      { onConflict: "user_id,clave" }
    );
  if (error) throw sbErr(error);
}

// ─── Evaluación ─────────────────────────────────────────────────────────────

/** Todo lo que los evaluadores pueden necesitar. Cada uno usa lo suyo. */
export interface ContextoEval {
  ultimasCargas: UltimaCarga[];
  servicios:     FilaServicio[];
  ahora:         Date;
}

type Evaluador = (reglas: Regla[], ctx: ContextoEval) => Notificacion[];

/**
 * Recordatorios de carga: avisa cuando pasaron más días de los configurados
 * desde la última vez que ALGUIEN subió esa planilla.
 *
 * La huella es la fecha de la última carga: mientras nadie cargue nada, el
 * descarte aguanta; apenas se sube una planilla nueva y vuelve a vencer, la
 * huella cambia y el aviso vuelve. Deliberadamente NO incluye los días de
 * atraso — si no, cambiaría todos los días y el descarte no serviría de nada.
 */
const evaluarCargas: Evaluador = (reglas, ctx) => {
  const porSeccion = new Map(ctx.ultimasCargas.map((u) => [u.section_id, u.last_updated_at]));

  return reglas.flatMap((r) => {
    const cfg = r.config as unknown as ConfigCarga;
    const meta = CARGAS_VIGILABLES.find((c) => c.key === cfg.section_id);
    if (!meta) return [];   // regla de una carga que ya no existe

    const ultima = porSeccion.get(cfg.section_id) ?? null;
    const frecuencia = cfg.frecuencia_dias || FRECUENCIA_DEFAULT;

    // Nunca se cargó: se avisa siempre, no hay contra qué comparar.
    if (!ultima) {
      return [{
        clave: `carga:${cfg.section_id}`,
        huella: "nunca",
        tipo: "carga" as const,
        titulo: meta.label,
        detalle: "Sin ninguna carga registrada",
        severidad: "alta" as const,
        seccion: meta.seccion,
      }];
    }

    const dias = (ctx.ahora.getTime() - new Date(ultima).getTime()) / DIA_MS;
    if (dias < frecuencia) return [];

    // Con hora configurada, recién molesta a partir de esa hora del día.
    if (cfg.hora) {
      const [h, m] = cfg.hora.split(":").map(Number);
      const disparo = new Date(ctx.ahora);
      disparo.setHours(h, m, 0, 0);
      if (ctx.ahora < disparo) return [];
    }

    const enteros = Math.floor(dias);
    return [{
      clave: `carga:${cfg.section_id}`,
      huella: ultima,
      tipo: "carga" as const,
      titulo: meta.label,
      detalle: enteros === 0 ? "Vence hoy"
             : enteros === 1 ? "Última carga hace 1 día"
             : `Última carga hace ${enteros} días`,
      severidad: dias >= frecuencia * 2 ? "alta" : "media",
      seccion: meta.seccion,
    }];
  });
};

// ─── Control de servicios ───────────────────────────────────────────────────

/** Lo que el evaluador necesita de una línea de `seguimiento`. */
export interface FilaServicio {
  op:            number | string | null;
  zona:          string | null;
  descripcion:   string | null;
  fecha_pactada: string | null;
  cantidad:      number | null;
  saldo_linea:   number | null;
}

/**
 * Los cuatro umbrales, todos configurables.
 *
 * ⚠ Los de saldo son «cuánto QUEDA», no «cuánto se consumió»: la alerta salta
 *   cuando `saldo/cantidad` cae por debajo del porcentaje. Los valores viejos
 *   hardcodeados eran 30% (crítico) y 40% (aviso) — se mantienen de default
 *   para que nadie note un cambio de criterio al migrar.
 */
export interface ConfigServicios {
  vence_critico_meses: number;   // default 3
  vence_aviso_meses:   number;   // default 4
  saldo_critico_pct:   number;   // default 30
  saldo_aviso_pct:     number;   // default 40
}

export const SERVICIOS_DEFAULT: ConfigServicios = {
  vence_critico_meses: 3,
  vence_aviso_meses:   4,
  saldo_critico_pct:   30,
  saldo_aviso_pct:     40,
};

/** Mes calendario, no 30 días fijos. El código viejo usaba `3 * 30 * MS_DAY`,
 *  que corre la fecha ~5 días por año — acá se suma el mes de verdad. */
const sumarMeses = (d: Date, meses: number): Date => {
  const r = new Date(d);
  r.setMonth(r.getMonth() + meses);
  return r;
};

/**
 * Alertas de control de servicios. Se resumen por umbral en vez de emitir una
 * notificación por línea: hay miles de líneas y la campana quedaría inusable.
 * El detalle sigue estando en la sección, que es donde se trabaja.
 *
 * La huella es la CANTIDAD de líneas afectadas: mientras el número no se mueva
 * el descarte aguanta; si aparece una línea más (o se resuelve una), vuelve a
 * avisar. Deliberadamente no incluye qué líneas son — si no, cualquier cambio
 * de zona o descripción reabriría el aviso sin que haya nada nuevo que hacer.
 */
const evaluarServicios: Evaluador = (reglas, ctx) => {
  const filas = ctx.servicios;
  if (!filas.length) return [];

  return reglas.flatMap((r) => {
    const cfg = { ...SERVICIOS_DEFAULT, ...(r.config as unknown as Partial<ConfigServicios>) };
    const hoy = ctx.ahora;

    const limiteCritico = sumarMeses(hoy, cfg.vence_critico_meses);
    const limiteAviso   = sumarMeses(hoy, cfg.vence_aviso_meses);

    // Una línea entra en UN solo balde por eje, el más grave: si vence en 2
    // meses no tiene sentido contarla también en «vence dentro de 4».
    let venceCritico = 0, venceAviso = 0, saldoCritico = 0, saldoAviso = 0;

    for (const f of filas) {
      const pactada = f.fecha_pactada ? new Date(String(f.fecha_pactada)) : null;
      if (pactada && !Number.isNaN(pactada.getTime()) && pactada >= hoy) {
        if      (pactada <= limiteCritico) venceCritico++;
        else if (pactada <= limiteAviso)   venceAviso++;
      }

      const cant  = Number(f.cantidad);
      const saldo = Number(f.saldo_linea);
      if (cant > 0) {
        const pct = (saldo / cant) * 100;
        if      (pct <= cfg.saldo_critico_pct) saldoCritico++;
        else if (pct <= cfg.saldo_aviso_pct)   saldoAviso++;
      }
    }

    const n: Notificacion[] = [];
    const push = (
      sufijo: string, cant: number, titulo: string, detalle: string, severidad: Severidad
    ) => {
      if (cant > 0) {
        n.push({
          clave: `servicios:${sufijo}`, huella: String(cant), tipo: "servicios" as const,
          titulo, detalle, severidad, seccion: "servicios-resumen",
        });
      }
    };

    const lineas = (c: number) => (c === 1 ? "1 línea" : `${c} líneas`);

    push("vence-critico", venceCritico,
      `Vencen dentro de ${cfg.vence_critico_meses} ${cfg.vence_critico_meses === 1 ? "mes" : "meses"}`,
      `${lineas(venceCritico)} en control de servicios`, "alta");
    push("vence-aviso", venceAviso,
      `Vencen dentro de ${cfg.vence_aviso_meses} ${cfg.vence_aviso_meses === 1 ? "mes" : "meses"}`,
      `${lineas(venceAviso)} en control de servicios`, "media");
    push("saldo-critico", saldoCritico,
      `Saldo por debajo del ${cfg.saldo_critico_pct}%`,
      `${lineas(saldoCritico)} casi sin saldo`, "alta");
    push("saldo-aviso", saldoAviso,
      `Saldo por debajo del ${cfg.saldo_aviso_pct}%`,
      `${lineas(saldoAviso)} con saldo bajo`, "media");

    return n;
  });
};

/** Lee `seguimiento` para el evaluador de servicios. Solo las columnas que
 *  usa: la tabla tiene decenas y son miles de filas. */
export async function fetchServicios(): Promise<FilaServicio[]> {
  const { data, error } = await supabase
    .from("seguimiento")
    .select("op, zona, descripcion_matricula, fecha_pactada, cantidad, saldo_linea");
  if (error) throw sbErr(error);

  type Row = Omit<FilaServicio, "descripcion"> & { descripcion_matricula: string | null };
  return ((data ?? []) as Row[]).map((r) => ({
    op: r.op, zona: r.zona, descripcion: r.descripcion_matricula,
    fecha_pactada: r.fecha_pactada, cantidad: r.cantidad, saldo_linea: r.saldo_linea,
  }));
}

/** Crea o actualiza la regla de servicios del usuario (hay una sola por
 *  usuario: los cuatro umbrales viven juntos en la misma config). */
export async function guardarReglaServicios(
  userId: string, cfg: ConfigServicios, activa: boolean
): Promise<void> {
  const existente = await supabase
    .from("notif_reglas")
    .select("id")
    .eq("user_id", userId)
    .eq("tipo", "servicios")
    .maybeSingle();

  const fila = {
    user_id: userId, tipo: "servicios" as const,
    config: cfg as unknown as Record<string, unknown>,
    activa, updated_at: new Date().toISOString(),
  };

  const { error } = existente.data?.id
    ? await supabase.from("notif_reglas").update(fila).eq("id", existente.data.id)
    : await supabase.from("notif_reglas").insert(fila);
  if (error) throw sbErr(error);
}

/** La regla de servicios del usuario, o los defaults si todavía no la creó. */
export function reglaServicios(reglas: Regla[]): ConfigServicios & { activa: boolean } {
  const r = reglas.find((x) => x.tipo === "servicios");
  return {
    ...SERVICIOS_DEFAULT,
    ...((r?.config ?? {}) as Partial<ConfigServicios>),
    activa: r?.activa ?? false,
  };
}

/**
 * Un evaluador por tipo. Las partes 3-4 suman su entrada acá y quedan
 * enganchadas al resto del sistema (campana, descartes, RLS) sin tocar nada
 * más de este archivo.
 */
const EVALUADORES: Partial<Record<TipoRegla, Evaluador>> = {
  carga:     evaluarCargas,
  servicios: evaluarServicios,
};

/**
 * Evalúa TODAS las reglas activas y descuenta lo descartado.
 *
 * Una notificación descartada solo se oculta si la huella coincide: si el
 * estado cambió, vuelve a aparecer aunque el usuario la haya descartado antes
 * (ver el comentario del descarte por huella en notificaciones.sql).
 */
export function evaluar(
  reglas: Regla[],
  descartes: Descarte[],
  ctx: ContextoEval
): Notificacion[] {
  const activas = reglas.filter((r) => r.activa);
  const silenciadas = new Map(descartes.map((d) => [d.clave, d.huella]));

  const todas = (Object.keys(EVALUADORES) as TipoRegla[]).flatMap((tipo) => {
    const evaluador = EVALUADORES[tipo];
    const delTipo = activas.filter((r) => r.tipo === tipo);
    return evaluador && delTipo.length ? evaluador(delTipo, ctx) : [];
  });

  const orden: Record<Severidad, number> = { alta: 0, media: 1, baja: 2 };
  return todas
    .filter((n) => silenciadas.get(n.clave) !== n.huella)
    .sort((a, b) => orden[a.severidad] - orden[b.severidad]);
}

/**
 * Reglas de carga del usuario, completadas con las cargas que todavía no
 * configuró — así la pantalla de configuración las lista todas, no solo las
 * que ya tienen fila en la base.
 *
 * `activa: false` en las que no existen todavía: un usuario nuevo no arranca
 * con siete recordatorios encima, elige los que le importan.
 */
export function reglasDeCargaCompletas(reglas: Regla[]): (ConfigCarga & { activa: boolean })[] {
  return CARGAS_VIGILABLES.map((c) => {
    const r = reglas.find(
      (x) => x.tipo === "carga" && (x.config as unknown as ConfigCarga).section_id === c.key
    );
    const cfg = r?.config as unknown as ConfigCarga | undefined;
    return {
      section_id:      c.key,
      frecuencia_dias: cfg?.frecuencia_dias ?? FRECUENCIA_DEFAULT,
      hora:            cfg?.hora ?? null,
      activa:          r?.activa ?? false,
    };
  });
}

/**
 * Marca que una carga se hizo recién. Es el dato COMPARTIDO: vale para toda
 * la oficina, no para el usuario que subió el archivo.
 */
export async function markUpdated(sectionId: string, sectionName: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("section_reminders")
    .upsert(
      {
        section_id:      sectionId,
        section_name:    sectionName,
        last_updated_at: new Date().toISOString(),
        last_updated_by: userId,
      },
      { onConflict: "section_id" }
    );
  if (error) throw sbErr(error);
}
