"use client";

// Piezas de UI compartidas por las pantallas del Plan de Compras (Carga de
// datos y Resumen).

import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PlanCompras } from "@/lib/planCompras";

const ITEM = "ido-pop-item focus:bg-white/5 focus:text-[var(--ido-text)] data-[state=checked]:text-[var(--ido-text)]";

// ─── Select de filtro (shadcn Select con el panel IDO) ───────────────────────

export function FiltroSelect({
  value, onChange, opciones, todos, ancho,
}: {
  value: string;
  onChange: (v: string) => void;
  opciones: { v: string; label: string; n: number }[];
  todos: string;
  ancho: number;
}) {
  const activo = value !== "__todos";
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        className={`ido-selectbtn shrink-0 shadow-none focus-visible:ring-0 ${activo ? "is-on" : ""}`}
        style={{ height: 32, maxWidth: ancho, minWidth: 120, color: "var(--ido-text)" }}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="ido-terminal ido-pop border-0 max-h-[360px]">
        <SelectItem
          value="__todos"
          className={ITEM}
        >
          {todos}
        </SelectItem>
        {opciones.map((o) => (
          <SelectItem
            key={o.v}
            value={o.v}
            className={ITEM}
          >
            <span className="truncate">{o.label}</span>
            <span style={{ marginLeft: "auto", paddingLeft: 12, fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11, color: "var(--ido-text-2)" }}>
              {o.n.toLocaleString("es-AR")}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Selector de plan (un plan activo por año) ───────────────────────────────

const IMPORTAR = "__importar";

/**
 * Selector de año del plan. Se muestra SIEMPRE (aunque haya un solo plan),
 * para que se vea que cada año es un plan aparte; con `onImportar`, la última
 * opción abre la importación de otro año.
 */
export function SelectorPlan({
  planes, planId, onChange, onImportar,
}: {
  planes: PlanCompras[];
  planId: string | null;
  onChange: (id: string) => void;
  onImportar?: () => void;
}) {
  if (!planes.length) return null;
  const actual = planes.find((p) => p.id === planId) ?? null;
  const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : null);
  return (
    <Select
      value={planId ?? ""}
      onValueChange={(v) => { if (v === IMPORTAR) onImportar?.(); else onChange(v); }}
    >
      <SelectTrigger
        size="sm"
        className="ido-selectbtn shrink-0 shadow-none focus-visible:ring-0"
        style={{ height: 32, color: "var(--ido-text)" }}
        title="Cada año es un plan aparte: elegí cuál ver"
      >
        {/* Texto fijo: el ítem lleva además la fecha de importación. */}
        <SelectValue>{actual ? `Plan ${actual.anio}` : null}</SelectValue>
      </SelectTrigger>
      <SelectContent className="ido-terminal ido-pop border-0">
        {planes.map((p) => (
          <SelectItem key={p.id} value={p.id} className={ITEM} style={{ paddingRight: 32 }}>
            <span>Plan {p.anio}</span>
            {fecha(p.importado_at) && (
              <span style={{ marginLeft: "auto", paddingLeft: 12, fontSize: 11, color: "var(--ido-text-2)" }}>
                importado {fecha(p.importado_at)}
              </span>
            )}
          </SelectItem>
        ))}
        {onImportar && (
          <>
            <SelectSeparator className="bg-[var(--ido-line)]" />
            <SelectItem value={IMPORTAR} className={ITEM}>
              <span style={{ color: "var(--ido-accent)" }}>+ Importar plan de otro año…</span>
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
