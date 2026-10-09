"use client";

// Piezas de UI compartidas por las pantallas del Plan de Compras (Carga de
// datos y Resumen).

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
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
const ELIMINAR = "__eliminar";

/**
 * Selector de año del plan. Se muestra SIEMPRE (aunque haya un solo plan),
 * para que se vea que cada año es un plan aparte; con `onImportar`, la última
 * opción abre la importación de otro año.
 */
export function SelectorPlan({
  planes, planId, onChange, onImportar, onEliminar,
}: {
  planes: PlanCompras[];
  planId: string | null;
  onChange: (id: string) => void;
  onImportar?: () => void;
  /** Borrar el plan que se está viendo (pide confirmación aparte). */
  onEliminar?: () => void;
}) {
  if (!planes.length) return null;
  const actual = planes.find((p) => p.id === planId) ?? null;
  const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : null);
  return (
    <Select
      value={planId ?? ""}
      onValueChange={(v) => {
        if (v === IMPORTAR) onImportar?.();
        else if (v === ELIMINAR) onEliminar?.();
        else onChange(v);
      }}
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
        {(onImportar || (onEliminar && actual)) && <SelectSeparator className="bg-[var(--ido-line)]" />}
        {onImportar && (
          <SelectItem value={IMPORTAR} className={ITEM}>
            <span style={{ color: "var(--ido-accent)" }}>+ Importar plan de otro año…</span>
          </SelectItem>
        )}
        {onEliminar && actual && (
          <SelectItem value={ELIMINAR} className={ITEM}>
            <span style={{ color: "var(--ido-error)" }}>Eliminar plan {actual.anio}…</span>
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

// ─── Confirmación para eliminar un plan ──────────────────────────────────────

/**
 * Borrar un plan no se puede deshacer: hay que escribir el año para habilitar
 * el botón (como GitHub con los repositorios).
 */
export function ConfirmarEliminarPlan({
  plan, onCancelar, onConfirmar,
}: {
  plan: PlanCompras;
  onCancelar: () => void;
  onConfirmar: () => Promise<void>;
}) {
  const [txt, setTxt] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tituloId = useId();
  const ok = txt.trim() === String(plan.anio);

  useEffect(() => {
    if (borrando) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) onCancelar(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [borrando, onCancelar]);

  const confirmar = async () => {
    if (!ok || borrando) return;
    setBorrando(true);
    setError(null);
    try {
      await onConfirmar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBorrando(false);
    }
  };

  const fecha = plan.importado_at
    ? new Date(plan.importado_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return createPortal(
    <div className="ido-terminal ido-modal-overlay" onClick={() => { if (!borrando) onCancelar(); }}>
      <div
        className="ido-modal flex flex-col"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ido-modal-head">
          <div className="flex items-center gap-2 min-w-0">
            <Trash2 className="w-4 h-4 shrink-0" style={{ color: "var(--ido-error)" }} />
            <span id={tituloId} className="ido-modal-title truncate">Eliminar plan {plan.anio}</span>
          </div>
        </div>
        <div className="flex flex-col gap-3" style={{ padding: 20 }}>
          <div
            className="flex items-start gap-2"
            style={{
              padding: "10px 12px", borderRadius: 8, fontSize: 13, lineHeight: 1.5, color: "var(--ido-text)",
              background: "rgba(229, 72, 77, 0.08)", border: "1px solid rgba(229, 72, 77, 0.25)",
            }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--ido-error)", marginTop: 2 }} />
            <span>
              Se borra el plan {plan.anio} completo: todas sus filas de Global (con las ediciones hechas en la app),
              las prioridades y las cuentas. <strong>No se puede deshacer.</strong> Los planes de otros años no se tocan.
            </span>
          </div>
          {(plan.archivo || fecha) && (
            <p style={{ fontSize: 12, color: "var(--ido-text-2)" }}>
              Importado{fecha && <> el {fecha}</>}{plan.archivo && <> desde «{plan.archivo}»</>}.
            </p>
          )}
          <label className="flex flex-col gap-1.5" style={{ fontSize: 13, color: "var(--ido-text-2)" }}>
            <span>Para confirmar, escribí <b style={{ color: "var(--ido-text)" }}>{plan.anio}</b>:</span>
            <input
              autoFocus
              className="ido-input ido-input-mono"
              style={{ width: 120 }}
              inputMode="numeric"
              maxLength={4}
              value={txt}
              disabled={borrando}
              onChange={(e) => setTxt(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter") void confirmar(); }}
            />
          </label>
          {error && <p style={{ fontSize: 12, color: "var(--ido-error)" }}>{error}</p>}
        </div>
        <div className="ido-modal-foot">
          <button type="button" className="ido-btn ido-btn-text" style={{ height: 38 }} onClick={onCancelar} disabled={borrando}>
            Cancelar
          </button>
          <button
            type="button"
            className="ido-btn ido-btn-danger"
            style={{ height: 38, border: "1px solid rgba(229, 72, 77, 0.4)", opacity: ok ? 1 : 0.45 }}
            disabled={!ok || borrando}
            onClick={() => void confirmar()}
          >
            {borrando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            {borrando ? "Eliminando…" : `Eliminar plan ${plan.anio}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
