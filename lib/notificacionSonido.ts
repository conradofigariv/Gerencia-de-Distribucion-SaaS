// ─── Aviso sonoro del comienzo del día ──────────────────────────────────────
//
// Suena UNA vez por día, la primera vez que se abre la app y hay algo
// pendiente en la campana. No es un recordatorio nuevo: es la misma lista de
// siempre, pero avisada de entrada para no depender de que alguien mire el
// ícono.
//
// ── Dos restricciones del navegador que definen el diseño ───────────────────
//
// 1. AUTOPLAY. Los navegadores no dejan sonar audio hasta que hubo una
//    interacción del usuario en la página. Al recargar con la sesión abierta
//    puede no haber ninguna todavía, y el AudioContext arranca 'suspended'.
//    Por eso, si está suspendido, el sonido queda ARMADO y se dispara con el
//    primer click/tecla real. Sin esto el aviso simplemente no se escucharía y
//    no habría forma de darse cuenta de por qué.
//
// 2. SIN ARCHIVO. El tono se sintetiza con WebAudio en vez de cargar un .mp3:
//    evita sumar un binario al repo y una request más, y suena igual en todos
//    lados.
//
// La preferencia se guarda en localStorage y no en la base a propósito: que
// suene o no es de ESTE dispositivo (la compu de la oficina sí, el celular en
// una reunión no), no de la cuenta.

const PREF_KEY  = "notif-sonido";
const ULTIMO_KEY = "notif-sonido-ultimo-dia";

/** Fecha local YYYY-MM-DD. No se usa toISOString(): en UTC-3 devuelve el día
 *  anterior antes de las 21:00 y el aviso "del día" saldría corrido. */
const hoyLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function sonidoActivado(): boolean {
  try { return localStorage.getItem(PREF_KEY) !== "off"; } catch { return true; }
}

export function setSonidoActivado(v: boolean): void {
  try { localStorage.setItem(PREF_KEY, v ? "on" : "off"); } catch { /* modo privado */ }
}

/**
 * Dos notas cortas ascendentes. Suave a propósito: esto suena al abrir la app,
 * no es una emergencia.
 */
function reproducir(): void {
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
 * Devuelve true si sonó o quedó armado, false si no correspondía.
 */
export function avisarInicioDelDia(hayPendientes: boolean): boolean {
  if (!hayPendientes || !sonidoActivado()) return false;

  let ultimo: string | null = null;
  try { ultimo = localStorage.getItem(ULTIMO_KEY); } catch { /* modo privado */ }
  const hoy = hoyLocal();
  if (ultimo === hoy) return false;

  try { localStorage.setItem(ULTIMO_KEY, hoy); } catch { /* modo privado */ }

  type WinAudio = Window & { webkitAudioContext?: typeof AudioContext };
  const Ctx = window.AudioContext ?? (window as WinAudio).webkitAudioContext;
  if (!Ctx) return false;

  // Sonda para saber si el navegador nos deja sonar YA o hay que esperar un
  // gesto del usuario (ver restricción 1 arriba).
  const sonda = new Ctx();
  const bloqueado = sonda.state === "suspended";
  sonda.close().catch(() => {});

  if (!bloqueado) {
    reproducir();
    return true;
  }

  const alInteractuar = () => {
    reproducir();
    window.removeEventListener("pointerdown", alInteractuar);
    window.removeEventListener("keydown", alInteractuar);
  };
  window.addEventListener("pointerdown", alInteractuar, { once: true });
  window.addEventListener("keydown", alInteractuar, { once: true });
  return true;
}

/** Suena una vez, sin condiciones. Para el botón "probar" de la config. */
export function probarSonido(): void {
  reproducir();
}
