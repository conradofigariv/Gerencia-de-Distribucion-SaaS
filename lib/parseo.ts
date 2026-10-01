// Parseo y normalización de valores que vienen de planillas Excel / SIGA
// (formato es-AR). Lo usan Carga de datos, el armado de seguimiento y el Plan
// de compras. Antes vivía en lib/tableroOp.ts, que se borró junto con la
// sección Tablero OP (reemplazada por el Buscador).

// ─── Helpers de normalización ────────────────────────────────────────────────

// Normaliza el código de artículo: quita el sufijo ".0" que agrega el export de
// Excel manteniendo el zero-padding original (ej. "00013242.0" → "00013242").
// El cruce entre tablas solo funciona si TODAS normalizan igual.
export function normArticulo(raw: unknown): string {
  return String(raw ?? "").trim().replace(/\.0+$/, "");
}

// Parsea un número con coma decimal y/o puntos de miles (formato es-AR).
export function parseNum(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/\s/g, "");
  if (s.includes(",")) {
    // coma = decimal → quito puntos de miles y convierto coma en punto
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Parsea un entero (bigint en BD). Acepta el sufijo ".0" del export de Excel.
export function parseEntero(raw: unknown): number | null {
  const n = parseNum(raw);
  if (n === null) return null;
  return Math.trunc(n);
}

// Parsea fecha en formato "dd/mm/yyyy" o "dd/mm/yyyy hh:mm:ss" (es-AR / SIGA).
// Si no matchea, intenta Date nativo (acepta ISO). Devuelve timestamp ISO o null.
export function parseFechaArg(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, d, mo, y, h = "0", mi = "0", se = "0"] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi.padStart(2, "0")}:${se.padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
