"use client";

// Piezas compartidas del sistema de diseño IDO (design-system.md) para las
// tablas de solo lectura: Stock por Zona → Resumen y Matrículas → Catálogo.
// Todo lo de acá depende de los tokens `--ido-*`, que solo existen debajo de
// `.ido-terminal` — usar siempre dentro de ese contenedor (o re-aplicar la
// clase en lo que se portalee a <body>).

import { ChevronUp, Package, Wrench } from "lucide-react";

// ─── Densidad de fila (§4.19) ──────────────────────────────────────────────────

export type Density = "compacta" | "normal" | "comoda";
export const DENSITY_ROW_H: Record<Density, number> = { compacta: 32, normal: 40, comoda: 52 };
export const DENSITY_LABEL: Record<Density, string> = { compacta: "Compacta", normal: "Normal", comoda: "Cómoda" };
export const DENSITY_ORDER: Density[] = ["compacta", "normal", "comoda"];
export const isDensity = (v: unknown): v is Density => v === "compacta" || v === "normal" || v === "comoda";

// ─── Encabezado ordenable (§4.11) ──────────────────────────────────────────────

export type SortDir = "asc" | "desc";

// Una sola flecha que rota 180° según la dirección y se pone verde en la
// columna activa; no un ícono distinto por estado (eso no es lo que documenta
// el sistema de diseño).
export function SortArrow({ active, dir, className }: { active: boolean; dir: SortDir; className?: string }) {
  return (
    <ChevronUp
      className={className}
      style={{
        transition: "transform 160ms var(--ido-ease), color 120ms var(--ido-ease), opacity 120ms var(--ido-ease)",
        transform: dir === "desc" ? "rotate(180deg)" : "none",
        color: active ? "var(--ido-accent)" : "var(--ido-text-dim)",
        opacity: active ? 1 : 0.4,
      }}
    />
  );
}

// ─── Checkbox (§4.16) ──────────────────────────────────────────────────────────

export function IdoCheckbox({
  checked, indeterminate, onClick, label,
}: { checked: boolean; indeterminate?: boolean; onClick: (e: React.MouseEvent) => void; label: string }) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      aria-label={label}
      style={{
        width: 16, height: 16, borderRadius: 4, display: "grid", placeItems: "center", flexShrink: 0,
        border: `1px solid ${on ? "var(--ido-accent)" : "rgba(255,255,255,.16)"}`,
        background: on ? "var(--ido-accent)" : "transparent",
        transition: "all 100ms var(--ido-ease)", cursor: "pointer",
      }}
    >
      {checked && !indeterminate && (
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--ido-accent-ink)" strokeWidth="2.5"><path d="M3 8l3.5 3.5L13 4.5" /></svg>
      )}
      {indeterminate && <span style={{ width: 8, height: 2, background: "var(--ido-accent-ink)", borderRadius: 1 }} />}
    </button>
  );
}

// ─── Tipo (Material / Servicio) ────────────────────────────────────────────────

export type TipoMatServ = "" | "material" | "servicio";

export function tipoMeta(tipo: TipoMatServ) {
  if (tipo === "servicio") return { label: "Servicio", color: "var(--ido-text)", bg: "rgba(255,255,255,.06)", border: "rgba(255,255,255,.14)", Icon: Wrench };
  if (tipo === "material") return { label: "Material", color: "var(--ido-accent)", bg: "rgba(63,207,142,.12)", border: "rgba(63,207,142,.35)", Icon: Package };
  return null;
}

export function TipoPill({ tipo }: { tipo: TipoMatServ }) {
  const m = tipoMeta(tipo);
  if (!m) return null;
  const Icon = m.Icon;
  return (
    <span className="ido-chip" style={{ background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>
      <Icon className="w-3 h-3" strokeWidth={2.2} />
      {m.label}
    </span>
  );
}

// ─── Medición de texto con canvas (doble clic de §4.15, pisos de §4.18) ────────

// `ctx.font` NO resuelve variables CSS: "13px var(--font-mono)" es inválido, el
// canvas lo ignora en silencio y mide con su fuente por defecto (10px
// sans-serif), o sea de menos. Hay que resolver la familia real antes.
// `weight` importa: una celda en negrita es más ancha que en peso normal.
function cssFamily(varName: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  } catch {
    return ""; // SSR o entorno sin DOM
  }
}

export function monoFont(px: number, weight = 400): string {
  const family = cssFamily("--font-mono");
  return `${weight} ${px}px ${family ? `${family}, ` : ""}ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
}

export function sansFont(px: number, weight = 400): string {
  const family = cssFamily("--font-sans");
  return `${weight} ${px}px ${family ? `${family}, ` : ""}system-ui, sans-serif`;
}

/** Ancho que necesita el valor más ancho de la lista + 24px de padding de celda. */
export function autoFitTextWidth(ctx: CanvasRenderingContext2D, values: string[], floor: number): number {
  let widest = 0;
  for (const v of values) {
    if (!v) continue;
    const w = ctx.measureText(v).width;
    if (w > widest) widest = w;
  }
  return Math.max(floor, Math.round(widest) + 24);
}
