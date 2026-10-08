// Persistencia de layout de tabla (design-system.md §4.19–4.20).
// Por usuario y por id estable de tabla: `ds.tableLayout.v1.<userId>.<tableId>`.
// Solo lo que exista realmente en cada módulo (hoy: ancho de columna
// redimensionado a mano, densidad de fila). Selección de fila, celda activa,
// scroll y filtros quedan fuera — son estado de sesión.

const LAYOUT_NS = "ds.tableLayout.v1";

export interface TableLayout {
  colW?: Record<string, number> | null;
  density?: string | null;
  /** Vista elegida en pantallas con conmutador tarjetas/tabla (§10). */
  view?: string | null;
  /** Grupos de columnas colapsados (§4.14). */
  colapsados?: string[] | null;
  /** Grupos de columnas ocultos desde el menú Columnas (§4.10). */
  ocultos?: string[] | null;
}

export function loadTableLayout(userId: string, tableId: string): TableLayout {
  try {
    const raw = localStorage.getItem(`${LAYOUT_NS}.${userId}.${tableId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveTableLayout(userId: string, tableId: string, patch: TableLayout) {
  try {
    const current = loadTableLayout(userId, tableId);
    localStorage.setItem(`${LAYOUT_NS}.${userId}.${tableId}`, JSON.stringify({ ...current, ...patch }));
  } catch {
    // localStorage puede no estar disponible (modo privado, cuota) — se ignora.
  }
}
