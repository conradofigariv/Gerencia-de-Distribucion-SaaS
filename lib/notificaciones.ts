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

/**
 * Un evaluador por tipo. Las partes 2-4 suman su entrada acá y quedan
 * enganchadas al resto del sistema (campana, descartes, RLS) sin tocar nada
 * más de este archivo.
 */
const EVALUADORES: Partial<Record<TipoRegla, Evaluador>> = {
  carga: evaluarCargas,
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
