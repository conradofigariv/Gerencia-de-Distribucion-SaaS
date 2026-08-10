// ─── Permisos de sección por usuario ────────────────────────────────────────
// Ver supabase/profile_secciones.sql para la columna y la traba anti-autoescalada.
//
// `secciones_permitidas` en `profiles`:
//   null / undefined → sin restricción configurada, ve TODO (default de
//                       siempre — así ningún usuario existente se rompe).
//   string[]         → allowlist explícita de IDs de sección (ver
//                       components/dashboard/sidebar.tsx → SIDEBAR_SECTIONS).
//                       Un array VACÍO es válido y significa "no ve nada del
//                       negocio" (igual sigue entrando a `settings`).
//
// Es una restricción de NAVEGACIÓN (qué aparece en el sidebar y a qué sección
// puede saltar), no un límite de datos a nivel de fila — no reemplaza RLS.
// Si dos secciones comparten una tabla de Supabase, restringir una sección no
// oculta esos datos si el usuario los alcanza por otro camino.

/** Nunca se restringe: hace falta para el perfil propio y cambiar contraseña. */
export const SECCION_SIEMPRE_VISIBLE = "settings";

export function puedeVerSeccion(
  nivelAcceso: string | null | undefined,
  seccionesPermitidas: string[] | null | undefined,
  seccionId: string
): boolean {
  if (seccionId === SECCION_SIEMPRE_VISIBLE) return true;
  // El administrador nunca se autobloquea, ni por error de configuración.
  if (nivelAcceso === "administrador") return true;
  if (seccionesPermitidas == null) return true;
  return seccionesPermitidas.includes(seccionId);
}
