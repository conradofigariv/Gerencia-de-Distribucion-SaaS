// ─────────────────────────────────────────────────────────────────────────────
// «La app se actualizó mientras la tenías abierta».
//
// Vercel redespliega con cada push a main y los nombres de los archivos de
// código cambian. Una pestaña abierta desde antes sigue pidiendo los archivos
// de SU versión cuando carga algo bajo demanda (el lector de Excel, xlsx, el
// mapa, el diagrama SIC…): esos ya no existen y el navegador recibe 404.
//
// El error que tira Turbopack es un `Error` común (no `ChunkLoadError`) con
// «Failed to load chunk /_next/static/chunks/<hash>.js from module N», y queda
// cacheado: reintentar sin recargar falla igual. La única salida es recargar.
// Este módulo lo reconoce y muestra un aviso con el botón «Recargar».
// ─────────────────────────────────────────────────────────────────────────────

import { toast } from "sonner";

/**
 * ¿El error es de código de una versión vieja que ya no está en el servidor?
 * Cubre Turbopack («Failed to load chunk»), webpack («Loading chunk N failed»,
 * ChunkLoadError), import() nativo de Chrome / Firefox / Safari y el worker
 * del lector de Excel (importScripts de un chunk que ya no existe).
 * No incluye «NetworkError» suelto: eso también es «sin internet».
 */
export function esErrorDeVersion(e: unknown): boolean {
  if (e == null) return false;
  const o = typeof e === "object" ? (e as { name?: unknown; message?: unknown }) : null;
  const texto = o ? `${String(o.name ?? "")} ${String(o.message ?? "")}` : String(e);
  return /Failed to load chunk|Loading (CSS )?chunk \S+ failed|ChunkLoadError|dynamically imported module|Importing a module script failed|importScripts/i.test(texto);
}

export const MENSAJE_VERSION_NUEVA =
  "La app se actualizó mientras la tenías abierta y esta pestaña quedó con la versión anterior. Recargá la página para seguir.";

/** Recarga la página (si hay ediciones sin guardar, el navegador pregunta antes). */
export function recargarPagina(): void {
  window.location.reload();
}

/**
 * Aviso persistente con botón «Recargar». Un solo aviso aunque fallen varias
 * cargas a la vez (mismo id).
 */
export function avisarVersionNueva(): void {
  toast.warning("Hay una versión nueva de la app", {
    id: "version-nueva",
    description: MENSAJE_VERSION_NUEVA,
    duration: Infinity,
    action: { label: "Recargar", onClick: recargarPagina },
  });
}

/**
 * Para los `catch` que muestran su propio mensaje: si el error es de versión
 * vieja, avisa y devuelve true (el llamador no muestra el error crudo).
 */
export function manejarErrorDeVersion(e: unknown): boolean {
  if (!esErrorDeVersion(e)) return false;
  avisarVersionNueva();
  return true;
}
