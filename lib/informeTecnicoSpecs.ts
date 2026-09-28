/**
 * Especificaciones técnicas — lógica pura (sin Supabase) del resultado por oferente.
 *
 * Modelo:
 *  - La LISTA de especificaciones es común al renglón
 *    (`licitacion_renglones.especificaciones`, ver `EspecificacionRenglon`).
 *  - El RESULTADO es por oferente y vive en
 *    `licitacion_evaluaciones_tecnicas.observaciones` (texto con JSON).
 *
 * Formatos que puede tener `observaciones` (todos se siguen leyendo):
 *  1. Texto plano (muy viejo)            → una nota de texto.
 *  2. Array de `SpecItem` (formato v1)   → especificaciones propias del
 *     oferente, anteriores a la lista común. Se conservan tal cual.
 *  3. `{ v: 2, resultados, items }`       → formato actual.
 *
 * Si un oferente no tiene resultados sobre la lista común, se sigue guardando
 * en formato v1 (array), así los datos viejos quedan exactamente igual.
 */
import type { EspecificacionRenglon } from "@/lib/informeTecnico";

/** Ítem propio del oferente: nota de texto, o especificación cargada antes de la lista común (legado). */
export type SpecItem =
  | { id: string; kind: "check"; label: string; checked: boolean; nota?: string }
  | { id: string; kind: "text"; text: string };

export type EstadoSpec = "cumple" | "no_cumple";

/** Resultado de un oferente sobre una especificación común. Sin `estado` = sin evaluar. */
export interface ResultadoSpec {
  estado?: EstadoSpec;
  nota?: string;
}

export interface EvalOferente {
  /** Clave = id de la especificación común del renglón. */
  resultados: Record<string, ResultadoSpec>;
  /** Notas de texto del oferente + especificaciones propias de legado. */
  items: SpecItem[];
}

export const specSid = () => Math.random().toString(36).slice(2, 9);

function parseItems(arr: unknown[]): SpecItem[] {
  return arr
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .filter((x) => x.kind === "check" || x.kind === "text")
    .map((x): SpecItem =>
      x.kind === "check"
        ? {
            id: String(x.id ?? specSid()),
            kind: "check",
            label: String(x.label ?? ""),
            checked: !!x.checked,
            ...(x.nota ? { nota: String(x.nota) } : {}),
          }
        : { id: String(x.id ?? specSid()), kind: "text", text: String(x.text ?? "") },
    );
}

function parseResultados(raw: unknown): Record<string, ResultadoSpec> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, ResultadoSpec> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const res: ResultadoSpec = {};
    if (r.estado === "cumple" || r.estado === "no_cumple") res.estado = r.estado;
    if (typeof r.nota === "string" && r.nota) res.nota = r.nota;
    if (res.estado || res.nota !== undefined) out[id] = res;
  }
  return out;
}

export function parseEvalOferente(raw: string | null): EvalOferente {
  const vacio: EvalOferente = { resultados: {}, items: [] };
  if (!raw) return vacio;
  const t = raw.trim();
  if (!t) return vacio;
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) return { resultados: {}, items: parseItems(arr) };
    } catch { /* cae a texto plano */ }
  }
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t);
      if (o && typeof o === "object" && o.v === 2) {
        return {
          resultados: parseResultados(o.resultados),
          items: Array.isArray(o.items) ? parseItems(o.items) : [],
        };
      }
    } catch { /* cae a texto plano */ }
  }
  // Observación en texto plano (formato más viejo) → una sola nota.
  return { resultados: {}, items: [{ id: specSid(), kind: "text", text: raw }] };
}

export function serializeEvalOferente(e: EvalOferente): string | null {
  const resultados: Record<string, ResultadoSpec> = {};
  for (const [id, r] of Object.entries(e.resultados)) {
    const limpio: ResultadoSpec = {};
    if (r.estado) limpio.estado = r.estado;
    if (r.nota && r.nota.trim()) limpio.nota = r.nota;
    if (limpio.estado || limpio.nota) resultados[id] = limpio;
  }
  const hayResultados = Object.keys(resultados).length > 0;
  if (!hayResultados && e.items.length === 0) return null;
  // Sin resultados sobre la lista común → formato v1, idéntico al de siempre.
  if (!hayResultados) return JSON.stringify(e.items);
  return JSON.stringify({ v: 2, resultados, items: e.items });
}

/**
 * Estado técnico que surge de las especificaciones (comunes + legado del oferente).
 *  - `undefined`: no hay especificaciones, o ninguna fue evaluada → no pisa el estado manual.
 *  - `false`: alguna no cumple.
 *  - `true`: todas cumplen.
 *  - `null`: evaluación parcial → Pendiente.
 * Las especificaciones de legado son binarias como siempre (tildada = cumple, sin tildar = no cumple).
 */
export function derivarCumple(
  comunes: EspecificacionRenglon[],
  e: EvalOferente,
): boolean | null | undefined {
  const estados: (EstadoSpec | undefined)[] = [
    ...comunes.map((s) => e.resultados[s.id]?.estado),
    ...e.items
      .filter((x): x is Extract<SpecItem, { kind: "check" }> => x.kind === "check")
      .map((c): EstadoSpec => (c.checked ? "cumple" : "no_cumple")),
  ];
  if (estados.length === 0) return undefined;
  if (estados.some((x) => x === "no_cumple")) return false;
  if (estados.every((x) => x === "cumple")) return true;
  if (estados.some((x) => x !== undefined)) return null;
  return undefined;
}

/** Cuántas especificaciones comunes evaluó el oferente. */
export function progresoComunes(
  comunes: EspecificacionRenglon[],
  e: EvalOferente,
): { evaluadas: number; total: number } {
  const evaluadas = comunes.filter((s) => e.resultados[s.id]?.estado).length;
  return { evaluadas, total: comunes.length };
}
