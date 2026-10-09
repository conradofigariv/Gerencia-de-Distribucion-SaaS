"use client";

// Piezas de UI compartidas por las pantallas del Plan de Compras (Carga de
// datos y Resumen).

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

/** Con un solo plan muestra el título; con varios, el selector de año. */
export function SelectorPlan({
  planes, planId, onChange,
}: {
  planes: PlanCompras[];
  planId: string | null;
  onChange: (id: string) => void;
}) {
  const plan = planes.find((p) => p.id === planId) ?? null;
  if (planes.length > 1) {
    return (
      <Select value={planId ?? ""} onValueChange={onChange}>
        <SelectTrigger size="sm" className="ido-selectbtn shrink-0 shadow-none focus-visible:ring-0" style={{ height: 32, color: "var(--ido-text)" }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="ido-terminal ido-pop border-0">
          {planes.map((p) => (
            <SelectItem key={p.id} value={p.id} className={ITEM}>
              Plan {p.anio}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return plan ? <span className="ido-title shrink-0">Plan {plan.anio}</span> : null;
}
