"use client";

// Piezas compartidas del sistema de diseño IDO (design-system.md) para las
// tablas de solo lectura: Stock por Zona → Resumen y Matrículas → Catálogo.
// Todo lo de acá depende de los tokens `--ido-*`, que solo existen debajo de
// `.ido-terminal` — usar siempre dentro de ese contenedor (o re-aplicar la
// clase en lo que se portalee a <body>).

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronUp, Loader2, Package, Trash2, Wrench, type LucideIcon } from "lucide-react";

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
  checked, indeterminate, onClick, label, disabled,
}: { checked: boolean; indeterminate?: boolean; onClick: (e: React.MouseEvent) => void; label: string; disabled?: boolean }) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(e); }}
      aria-label={label}
      style={{
        opacity: disabled ? 0.45 : 1,
        width: 16, height: 16, borderRadius: 4, display: "grid", placeItems: "center", flexShrink: 0,
        border: `1px solid ${on ? "var(--ido-accent)" : "rgba(255,255,255,.16)"}`,
        background: on ? "var(--ido-accent)" : "transparent",
        transition: "all 100ms var(--ido-ease)", cursor: disabled ? "default" : "pointer",
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

// ─── Modales (.ido-modal) ──────────────────────────────────────────────────────
// Reemplazan a window.confirm / window.prompt: el cuadro nativo no hereda el
// tema, se ve distinto en cada navegador y bloquea la pestaña entera.
// Se portalean a <body>, así que re-aplican `.ido-terminal` (tokens --ido-*).

function useEscape(onClose: () => void) {
  useEffect(() => {
    // `defaultPrevented`: un desplegable de Radix abierto adentro del modal
    // (Select, Popover) ya consumió ese Esc para cerrarse él — no el modal.
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
}

/** Confirmación. `danger` (default) = acción destructiva: ícono y botón rojos. */
export function IdoConfirmModal({
  title, children, confirmLabel, danger = true, icon: Icon = Trash2, onClose, onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  icon?: LucideIcon;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  useEscape(onClose);
  const run = async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } };
  return createPortal(
    <div className="ido-terminal ido-modal-overlay" onClick={onClose}>
      <div className="ido-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-3" style={{ padding: 20 }}>
          <div className="flex items-center gap-2.5">
            <span
              className="grid place-items-center shrink-0"
              style={{
                width: 34, height: 34, borderRadius: 999,
                background: danger ? "rgba(229,72,77,.12)" : "var(--ido-elevated)",
                color: danger ? "var(--ido-error)" : "var(--ido-text)",
              }}
            >
              <Icon className="w-4 h-4" />
            </span>
            <span className="ido-modal-title">{title}</span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ido-text-dim)" }}>{children}</div>
        </div>
        <div className="ido-modal-foot">
          <button type="button" className="ido-btn ido-btn-text" style={{ height: 38 }} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            autoFocus={!danger}
            className={`ido-btn ${danger ? "ido-btn-danger" : "ido-btn-primary"}`}
            style={{ height: 38 }}
            onClick={run}
            disabled={busy}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Pide un texto corto (ej. el nombre de una pestaña). Enter confirma, Esc cancela. */
export function IdoPromptModal({
  title, label, initial = "", placeholder, confirmLabel, icon: Icon, onClose, onConfirm,
}: {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel: string;
  icon?: LucideIcon;
  onClose: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  useEscape(onClose);
  const vacio = !value.trim();
  return createPortal(
    <div className="ido-terminal ido-modal-overlay" onClick={onClose}>
      <form
        className="ido-modal"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (!vacio) onConfirm(value.trim()); }}
      >
        <div className="ido-modal-head">
          <div className="flex items-center gap-2 min-w-0">
            {Icon && <Icon className="w-4 h-4 shrink-0" style={{ color: "var(--ido-text-dim)" }} />}
            <span className="ido-modal-title truncate">{title}</span>
          </div>
          <button type="button" className="ido-icon-btn" onClick={onClose} title="Cerrar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div style={{ padding: 20 }}>
          <label className="ido-label">{label}</label>
          <input
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="ido-input"
          />
        </div>
        <div className="ido-modal-foot">
          <button type="button" className="ido-btn ido-btn-text" style={{ height: 38 }} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="ido-btn ido-btn-primary" style={{ height: 38 }} disabled={vacio}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

type ConfirmOpts = Omit<Parameters<typeof IdoConfirmModal>[0], "onClose" | "onConfirm">;
type PromptOpts = Omit<Parameters<typeof IdoPromptModal>[0], "onClose" | "onConfirm">;
type DialogState =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (ok: boolean) => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void };

/**
 * Versión con promesa, para reemplazar `window.confirm` / `window.prompt` sin
 * reescribir el handler: `if (!(await confirmar({...}))) return;`.
 * Renderizar `dialogo` en algún lugar del componente.
 */
export function useIdoDialogs() {
  const [state, setState] = useState<DialogState | null>(null);
  const confirmar = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ kind: "confirm", opts, resolve })), [],
  );
  const pedirTexto = useCallback(
    (opts: PromptOpts) => new Promise<string | null>((resolve) => setState({ kind: "prompt", opts, resolve })), [],
  );
  const cerrar = useCallback(() => {
    setState((s) => { if (s?.kind === "confirm") s.resolve(false); else s?.resolve(null); return null; });
  }, []);

  let dialogo: ReactNode = null;
  if (state?.kind === "confirm") {
    dialogo = <IdoConfirmModal {...state.opts} onClose={cerrar} onConfirm={() => { state.resolve(true); setState(null); }} />;
  } else if (state?.kind === "prompt") {
    dialogo = <IdoPromptModal {...state.opts} onClose={cerrar} onConfirm={(v) => { state.resolve(v); setState(null); }} />;
  }
  return { confirmar, pedirTexto, dialogo };
}
