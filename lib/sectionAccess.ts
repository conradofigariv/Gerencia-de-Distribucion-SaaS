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

export interface PlantillaAcceso {
  id:        string;
  nombre:    string;
  secciones: string[];
}

/**
 * Qué secciones ve un usuario, resolviendo plantilla vs. allowlist propia.
 * `null` = sin restricción (ve todo). Ver supabase/acceso_plantillas.sql.
 *
 * Precedencia — la plantilla PISA a `secciones_permitidas`:
 *   1. Tiene plantilla  → mandan sus secciones (aunque sea un array vacío).
 *   2. Sin plantilla    → la allowlist propia, que es como funcionaba antes.
 *   3. Ninguna de las dos → sin restricción.
 *
 * Que la plantilla gane es lo que hace que asignarla sea un acto único y
 * predecible: si `secciones_permitidas` pudiera sumarse por encima, dos
 * usuarios con la misma plantilla podrían terminar viendo cosas distintas y
 * no habría forma de saberlo mirando la lista.
 */
export function resolverSecciones(
  plantilla: PlantillaAcceso | null | undefined,
  seccionesPropias: string[] | null | undefined,
): string[] | null {
  if (plantilla) return plantilla.secciones;
  return seccionesPropias ?? null;
}

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
