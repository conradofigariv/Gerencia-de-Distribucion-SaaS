import { supabase } from "./supabaseClient";
import { getPreference, setPreference } from "./userPreferences";

// ─── Aviso sonoro del comienzo del día ──────────────────────────────────────
//
// Suena UNA vez por día, la primera vez que se abre la app y hay algo
// pendiente en la campana. No es un recordatorio nuevo: es la misma lista de
// siempre, pero avisada de entrada para no depender de que alguien mire el
// ícono.
//
// ── Dos preferencias con alcance DISTINTO, a propósito ──────────────────────
//
// • Si suena o no (on/off) es de ESTE DISPOSITIVO — va a localStorage. La
//   compu de la oficina puede querer sonido y el celular en una reunión no:
//   son decisiones independientes, no la misma preferencia en dos lugares.
//
// • QUÉ sonido usar es de la CUENTA — va a `user_preferences` (Supabase), la
//   misma tabla que ya usa el Buscador para anchos/orden de columnas. Si
//   subiste tu propio audio, tiene que sonar igual en cualquier dispositivo
//   donde entres, no solo en el que lo subiste.
//
// El audio elegido se sube a Storage (bucket "notif-sounds", mismo patrón que
// los avatares — ver supabase/storage_notif_sounds.sql) y la URL pública
// resultante es lo que se guarda en `user_preferences`. Sin sonido propio,
// se sintetiza un tono con WebAudio (sin archivo de por medio).
//
// ── La restricción de autoplay del navegador ─────────────────────────────────
// Los navegadores no dejan sonar audio hasta que hubo una interacción del
// usuario en la página. Al recargar con la sesión abierta puede no haber
// ninguna todavía. Por eso, si está bloqueado, el sonido queda ARMADO y se
// dispara con el primer click/tecla real — tanto el tono sintetizado como un
// audio propio pasan por el mismo mecanismo de armado.

const PREF_KEY_ON     = "notif-sonido";
const ULTIMO_KEY       = "notif-sonido-ultimo-dia";
const PREF_KEY_URL     = "notif-sonido-url";   // en user_preferences, no localStorage

const BUCKET       = "notif-sounds";
const MAX_BYTES     = 1 * 1024 * 1024;   // 1 MB — es un aviso corto, no una canción
const TIPOS_VALIDOS = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4", "audio/webm"];

/** Fecha local YYYY-MM-DD. No se usa toISOString(): en UTC-3 devuelve el día
 *  anterior antes de las 21:00 y el aviso "del día" saldría corrido. */
const hoyLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function sonidoActivado(): boolean {
  try { return localStorage.getItem(PREF_KEY_ON) !== "off"; } catch { return true; }
}

export function setSonidoActivado(v: boolean): void {
  try { localStorage.setItem(PREF_KEY_ON, v ? "on" : "off"); } catch { /* modo privado */ }
}

/** URL del sonido propio del usuario, o null si usa el tono por defecto. */
export async function fetchSonidoUrl(userId: string): Promise<string | null> {
  return getPreference<string>(userId, PREF_KEY_URL);
}

/**
 * Sube un audio propio y lo deja elegido. Reemplaza el anterior si había uno
 * (mismo nombre de archivo siempre — `sonido`, sin extensión variable — así
 * no quedan huérfanos acumulándose en el bucket).
 */
export async function subirSonido(userId: string, file: File): Promise<string> {
  if (!TIPOS_VALIDOS.includes(file.type)) {
    throw new Error("Formato no soportado. Usá MP3, WAV, OGG o M4A.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("El archivo no puede superar 1 MB — es un aviso corto, no hace falta más.");
  }

  const path = `${userId}/sonido`;
  const { error: upError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upError) throw new Error(`No se pudo subir el sonido: ${upError.message}`);

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);
  // Cache-bust: la URL pública es siempre la misma ruta, así que sin esto el
  // navegador (o un CDN) podría seguir sirviendo el audio viejo tras un
  // reemplazo.
  const url = `${publicUrl}?t=${Date.now()}`;
  await setPreference(userId, PREF_KEY_URL, url);
  return url;
}

/** Vuelve al tono por defecto (no borra el archivo del bucket, solo deja de usarlo). */
export async function quitarSonidoPropio(userId: string): Promise<void> {
  await setPreference(userId, PREF_KEY_URL, null);
}

/**
 * Reproduce el sonido elegido: el audio propio si hay uno, o dos notas cortas
 * sintetizadas con WebAudio si no. El tono sintetizado es deliberadamente
 * suave — esto avisa que abriste el día, no es una alarma de emergencia.
 */
function reproducir(sonidoUrl?: string | null): void {
  if (sonidoUrl) {
    // Un audio roto/borrado no debe dejar a alguien sin ningún aviso: si
    // falla, cae al tono sintetizado en vez de sonar silencio.
    const audio = new Audio(sonidoUrl);
    audio.volume = 0.7;
    audio.play().catch(() => reproducirTono());
    return;
  }
  reproducirTono();
}

function reproducirTono(): void {
  type WinAudio = Window & { webkitAudioContext?: typeof AudioContext };
  const Ctx = window.AudioContext ?? (window as WinAudio).webkitAudioContext;
  if (!Ctx) return;

  const ctx = new Ctx();

  const nota = (frecuencia: number, desde: number, dur: number) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frecuencia;
    // Rampa de subida y bajada: un gain que arranca y corta en seco produce un
    // "click" audible en vez de una nota limpia.
    gain.gain.setValueAtTime(0, ctx.currentTime + desde);
    gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + desde + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + desde + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + desde);
    osc.stop(ctx.currentTime + desde + dur);
  };

  nota(660, 0,    0.18);   // mi
  nota(880, 0.16, 0.28);   // la

  // Cerrar el contexto libera el recurso de audio; los navegadores limitan
  // cuántos puede haber abiertos a la vez.
  setTimeout(() => ctx.close().catch(() => {}), 900);
}

/**
 * Suena si corresponde: hay pendientes, está activado y todavía no sonó hoy.
 * Marca el día ANTES de reproducir — si el sonido queda armado esperando la
 * primera interacción, no tiene que volver a armarse en cada recarga.
 *
 * `sonidoUrl` es el audio propio del usuario (o null/undefined para el tono
 * por defecto) — lo trae quien llama, ya resuelto desde `fetchSonidoUrl`.
 *
 * Devuelve true si sonó o quedó armado, false si no correspondía.
 */
export function avisarInicioDelDia(hayPendientes: boolean, sonidoUrl?: string | null): boolean {
  if (!hayPendientes || !sonidoActivado()) return false;

  let ultimo: string | null = null;
  try { ultimo = localStorage.getItem(ULTIMO_KEY); } catch { /* modo privado */ }
  const hoy = hoyLocal();
  if (ultimo === hoy) return false;

  try { localStorage.setItem(ULTIMO_KEY, hoy); } catch { /* modo privado */ }

  // Con audio propio no hace falta sondear el AudioContext: <audio>.play()
  // ya devuelve una promesa rechazada si el navegador bloquea el autoplay, y
  // ese rechazo es lo que dispara el armado más abajo.
  const armar = (probar: () => void) => {
    const alInteractuar = () => {
      probar();
      window.removeEventListener("pointerdown", alInteractuar);
      window.removeEventListener("keydown", alInteractuar);
    };
    window.addEventListener("pointerdown", alInteractuar, { once: true });
    window.addEventListener("keydown", alInteractuar, { once: true });
  };

  if (sonidoUrl) {
    const audio = new Audio(sonidoUrl);
    audio.volume = 0.7;
    audio.play().catch(() => armar(() => reproducir(sonidoUrl)));
    return true;
  }

  type WinAudio = Window & { webkitAudioContext?: typeof AudioContext };
  const Ctx = window.AudioContext ?? (window as WinAudio).webkitAudioContext;
  if (!Ctx) return false;

  // Sonda para saber si el navegador nos deja sonar YA o hay que esperar un
  // gesto del usuario.
  const sonda = new Ctx();
  const bloqueado = sonda.state === "suspended";
  sonda.close().catch(() => {});

  if (!bloqueado) {
    reproducirTono();
    return true;
  }

  armar(reproducirTono);
  return true;
}

/** Suena una vez, sin condiciones. Para el botón "probar" de la config. */
export function probarSonido(sonidoUrl?: string | null): void {
  reproducir(sonidoUrl);
}
