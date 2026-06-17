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
