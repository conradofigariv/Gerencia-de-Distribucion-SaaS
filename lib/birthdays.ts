import { supabase } from "./supabaseClient";

export interface BirthdayNotice {
  id:        string;
  name:      string;
  daysUntil: number; // 0 = hoy
  day:       number;
  month:     number;
}

const DAY_MS = 1000 * 60 * 60 * 24;

interface ProfileRow {
  id:         string;
  nombre:     string | null;
  apellido:   string | null;
  cumpleanos: string | null;
}

/**
 * Devuelve los cumpleaños del equipo que caen dentro de los próximos
 * `windowDays` días (incluyendo hoy), ordenados por cercanía.
 * El cumpleaños se guarda como `date` (YYYY-MM-DD); el año se ignora.
 */
export async function fetchUpcomingBirthdays(windowDays = 7): Promise<BirthdayNotice[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nombre, apellido, cumpleanos")
    .not("cumpleanos", "is", null);
  if (error) throw new Error(error.message);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const year = today.getFullYear();

  const notices: BirthdayNotice[] = [];

  for (const p of (data ?? []) as ProfileRow[]) {
    if (!p.cumpleanos) continue;
    const [, mmStr, ddStr] = p.cumpleanos.split("-");
    const month = Number(mmStr);
    const day   = Number(ddStr);
    if (!month || !day) continue;

    let next = new Date(year, month - 1, day);
    next.setHours(0, 0, 0, 0);
    if (next.getTime() < todayMs) next = new Date(year + 1, month - 1, day);

    const daysUntil = Math.round((next.getTime() - todayMs) / DAY_MS);
    if (daysUntil <= windowDays) {
      const name = [p.nombre, p.apellido].filter(Boolean).join(" ").trim() || "Usuario";
      notices.push({ id: p.id, name, daysUntil, day, month });
    }
  }

  notices.sort((a, b) => a.daysUntil - b.daysUntil);
  return notices;
}

export function birthdayLabel(daysUntil: number): string {
  if (daysUntil === 0) return "¡Es hoy!";
  if (daysUntil === 1) return "mañana";
  return `en ${daysUntil} días`;
}

// ─── Cartel de feliz cumpleaños (components/dashboard/birthday-modal.tsx) ────

export interface Cumpleanero {
  id:        string;
  nombre:    string; // nombre de pila (o el completo si no hay)
  completo:  string;
  /** Video subido por un admin (supabase/cumpleanos_imagenes.sql); "imagen"
   *  solo para lo subido antes de pasar a video. */
  media:     { url: string; tipo: "imagen" | "video" } | null;
  avatarUrl: string | null;
}

/** ¿El cumpleaños `YYYY-MM-DD` cae en `hoy`? Los del 29/2 se festejan el
 *  28/2 en los años no bisiestos (si no, no aparecerían nunca esos años). */
export function cumpleEsHoy(cumpleanos: string, hoy = new Date()): boolean {
  const [, mmStr, ddStr] = cumpleanos.split("-");
  const mes = Number(mmStr), dia = Number(ddStr);
  if (!mes || !dia) return false;
  const m = hoy.getMonth() + 1, d = hoy.getDate();
  if (mes === m && dia === d) return true;
  const y = hoy.getFullYear();
  const bisiesto = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return mes === 2 && dia === 29 && !bisiesto && m === 2 && d === 28;
}

/** Quiénes cumplen años hoy, con su video de cartel o foto de perfil. */
export async function fetchCumpleanerosDeHoy(): Promise<Cumpleanero[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nombre, apellido, cumpleanos, avatar_url")
    .not("cumpleanos", "is", null);
  if (error) throw new Error(error.message);

  type Row = ProfileRow & { avatar_url: string | null };
  const hoy = ((data ?? []) as Row[]).filter((p) => p.cumpleanos && cumpleEsHoy(p.cumpleanos));
  if (!hoy.length) return [];

  // Sin la tabla (SQL todavía no corrido) el cartel sale igual, con la foto
  // de perfil. Sin la columna `tipo` (SQL de la versión de imágenes) todo lo
  // guardado es imagen.
  const ids = hoy.map((p) => p.id);
  type MediaRow = { user_id: string; imagen_url: string; tipo?: "imagen" | "video" };
  const conTipo = await supabase.from("cumple_imagenes").select("user_id, imagen_url, tipo").in("user_id", ids);
  const filas = (conTipo.error
    ? (await supabase.from("cumple_imagenes").select("user_id, imagen_url").in("user_id", ids)).data
    : conTipo.data) as MediaRow[] | null;
  const mediaDe = new Map((filas ?? []).map((r) => [r.user_id, { url: r.imagen_url, tipo: r.tipo ?? "imagen" }]));

  return hoy
    .map((p) => {
      const completo = [p.nombre, p.apellido].filter(Boolean).join(" ").trim() || "Alguien del equipo";
      return {
        id: p.id,
        nombre: p.nombre?.trim() || completo,
        completo,
        media: mediaDe.get(p.id) ?? null,
        avatarUrl: p.avatar_url || null,
      };
    })
    .sort((a, b) => a.completo.localeCompare(b.completo, "es"));
}
