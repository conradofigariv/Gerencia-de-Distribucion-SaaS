"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Plan de Compras — filtro de columna estilo Excel (autofiltro).
//
// Confirmado con el usuario (design-system.md): menú en cada encabezado
// (§4.10 / §4.5: panel `ido-pop` con buscador §4.2, «Seleccionar todo», lista
// de valores con checkbox y cantidad, Ordenar), indicador de columna filtrada
// (§1, elemento activo: embudo verde) y chips de filtros activos (§4.3, en la
// grilla). Como en Excel, la lista muestra los valores de las filas que pasan
// los DEMÁS filtros, y los cambios se aplican con «Aceptar».
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { ArrowDownAZ, ArrowUpZA, Search } from "lucide-react";
import { IdoCheckbox } from "@/components/dashboard/ido-kit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Valor de una celda tal como lo ve el filtro. */
export interface ValorFiltro {
  /** Identidad del valor (dos celdas con la misma clave son «el mismo valor»). */
  clave: string;
  /** Lo que se muestra en la lista. */
  label: string;
  /** Valor numérico para las condiciones (null si la celda no es un número). */
  num:   number | null;
}

export type OpNumero = "gt" | "gte" | "lt" | "lte" | "eq" | "between" | "ne0" | "eq0";

export interface CondNumero {
  op: OpNumero;
  a:  number | null;
  b:  number | null;
}

export interface FiltroColumna {
  /** Claves permitidas. null = todas. */
  valores: string[] | null;
  /** Condición numérica (solo columnas numéricas). */
  cond:    CondNumero | null;
}

export const OPS_NUMERO: { v: OpNumero; label: string; args: 0 | 1 | 2 }[] = [
  { v: "gt",      label: "Mayor que",       args: 1 },
  { v: "gte",     label: "Mayor o igual a", args: 1 },
  { v: "lt",      label: "Menor que",       args: 1 },
  { v: "lte",     label: "Menor o igual a", args: 1 },
  { v: "eq",      label: "Igual a",         args: 1 },
  { v: "between", label: "Entre",           args: 2 },
  { v: "ne0",     label: "Distinto de 0",   args: 0 },
  { v: "eq0",     label: "Igual a 0 / vacío", args: 0 },
];

// ─── Lógica ──────────────────────────────────────────────────────────────────

export function cumpleCond(c: CondNumero, n: number | null): boolean {
  const v = n ?? 0;
  switch (c.op) {
    case "ne0":     return v !== 0;
    case "eq0":     return v === 0;
    case "gt":      return c.a == null || v > c.a;
    case "gte":     return c.a == null || v >= c.a;
    case "lt":      return c.a == null || v < c.a;
    case "lte":     return c.a == null || v <= c.a;
    case "eq":      return c.a == null || v === c.a;
    case "between": {
      const lo = Math.min(c.a ?? -Infinity, c.b ?? Infinity);
      const hi = Math.max(c.a ?? -Infinity, c.b ?? Infinity);
      return v >= lo && v <= hi;
    }
  }
}

/** ¿La celda pasa el filtro? Para las columnas numéricas, una celda que no es
 *  número («Sin Datos») no cumple ninguna condición. */
export function pasaFiltro(f: FiltroColumna, v: ValorFiltro, set?: Set<string>): boolean {
  if (f.valores && !(set ?? new Set(f.valores)).has(v.clave)) return false;
  if (f.cond && (v.num == null || !cumpleCond(f.cond, v.num))) return false;
  return true;
}

const F_NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 });

/** Texto corto para el chip del filtro activo. */
export function resumenFiltro(f: FiltroColumna, labelDe: (clave: string) => string): string {
  const partes: string[] = [];
  if (f.cond) {
    const op = OPS_NUMERO.find((o) => o.v === f.cond!.op)!;
    const a = f.cond.a == null ? "…" : F_NUM.format(f.cond.a);
    const b = f.cond.b == null ? "…" : F_NUM.format(f.cond.b);
    partes.push(op.args === 0 ? op.label.toLowerCase() : op.args === 1 ? `${op.label.toLowerCase()} ${a}` : `entre ${a} y ${b}`);
  }
  if (f.valores) {
    const v = f.valores;
    partes.push(v.length === 0 ? "ninguno" : v.length <= 2 ? v.map(labelDe).join(", ") : `${v.length.toLocaleString("es-AR")} valores`);
  }
  return partes.join(" · ");
}

// ─── Menú ────────────────────────────────────────────────────────────────────

/** Tope de valores listados: con miles de precios distintos la lista sería
 *  inmanejable; el buscador filtra el resto. */
const MAX_LISTA = 500;

export interface OpcionValor {
  clave: string;
  label: string;
  n:     number;
}

export function MenuFiltroColumna({
  titulo, numerica, opciones, filtro, onAplicar, onOrdenar, onCerrar,
}: {
  titulo:    string;
  numerica:  boolean;
  /** Valores posibles (de las filas que pasan los otros filtros), ya ordenados. */
  opciones:  OpcionValor[];
  filtro:    FiltroColumna | null;
  onAplicar: (f: FiltroColumna | null) => void;
  onOrdenar: (dir: "asc" | "desc") => void;
  onCerrar:  () => void;
}) {
  const todas = useMemo(() => opciones.map((o) => o.clave), [opciones]);
  // Borrador: se aplica recién con «Aceptar», como en Excel.
  const [elegidas, setElegidas] = useState<Set<string>>(
    () => new Set(filtro?.valores ?? todas),
  );
  const [cond, setCond] = useState<CondNumero | null>(filtro?.cond ?? null);
  const [busca, setBusca] = useState("");

  const q = busca.trim().toLowerCase();
  const visibles = useMemo(
    () => (q ? opciones.filter((o) => o.label.toLowerCase().includes(q)) : opciones),
    [opciones, q],
  );
  const mostradas = visibles.slice(0, MAX_LISTA);
  const todasVisiblesOn = visibles.length > 0 && visibles.every((o) => elegidas.has(o.clave));
  const algunaVisibleOn = visibles.some((o) => elegidas.has(o.clave));

  function toggle(clave: string) {
    setElegidas((prev) => {
      const next = new Set(prev);
      if (next.has(clave)) next.delete(clave); else next.add(clave);
      return next;
    });
  }
  function toggleTodas() {
    setElegidas((prev) => {
      const next = new Set(prev);
      for (const o of visibles) {
        if (todasVisiblesOn) next.delete(o.clave); else next.add(o.clave);
      }
      return next;
    });
  }

  function aceptar() {
    // Con búsqueda, Excel filtra SOLO por lo encontrado (no suma lo de antes).
    const base = q ? new Set(visibles.filter((o) => elegidas.has(o.clave)).map((o) => o.clave)) : elegidas;
    const todoElegido = todas.every((c) => base.has(c));
    const condValida = cond && (OPS_NUMERO.find((o) => o.v === cond.op)!.args === 0 || cond.a != null) ? cond : null;
    onAplicar(todoElegido && !condValida ? null : { valores: todoElegido ? null : [...base], cond: condValida });
  }

  const opInfo = cond ? OPS_NUMERO.find((o) => o.v === cond.op)! : null;
  const parseNum = (s: string): number | null => {
    const t = s.trim().replace(/\./g, "").replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const itemCls = "ido-pop-item";
  return (
    <div
      className="flex flex-col"
      style={{ gap: 2 }}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); aceptar(); } }}
    >
      <div className="ido-pop-label" title={titulo} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {titulo}
      </div>
      <button type="button" className={itemCls} onClick={() => { onOrdenar("asc"); onCerrar(); }}>
        <ArrowDownAZ className="w-3.5 h-3.5" />{numerica ? "Ordenar de menor a mayor" : "Ordenar de A a Z"}
      </button>
      <button type="button" className={itemCls} onClick={() => { onOrdenar("desc"); onCerrar(); }}>
        <ArrowUpZA className="w-3.5 h-3.5" />{numerica ? "Ordenar de mayor a menor" : "Ordenar de Z a A"}
      </button>
      <div className="ido-pop-sep" />

      {numerica && (
        <div className="flex flex-col" style={{ gap: 6, padding: "4px 6px 6px" }}>
          <span className="ido-pop-label" style={{ padding: 0 }}>Filtro de número</span>
          <Select
            value={cond?.op ?? "__ninguno"}
            onValueChange={(v) => setCond(v === "__ninguno" ? null : { op: v as OpNumero, a: cond?.a ?? null, b: cond?.b ?? null })}
          >
            <SelectTrigger size="sm" className="ido-selectbtn w-full shadow-none focus-visible:ring-0" style={{ height: 32, color: "var(--ido-text)" }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="ido-terminal ido-pop border-0 z-[10001]">
              <SelectItem value="__ninguno" className="ido-pop-item focus:bg-white/5 focus:text-[var(--ido-text)] data-[state=checked]:text-[var(--ido-text)]">
                Sin condición
              </SelectItem>
              {OPS_NUMERO.map((o) => (
                <SelectItem key={o.v} value={o.v} className="ido-pop-item focus:bg-white/5 focus:text-[var(--ido-text)] data-[state=checked]:text-[var(--ido-text)]">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {opInfo && opInfo.args > 0 && (
            <div className="flex items-center" style={{ gap: 6 }}>
              <input
                className="ido-input ido-input-mono"
                style={{ height: 32 }}
                inputMode="decimal"
                placeholder={opInfo.args === 2 ? "desde" : "valor"}
                defaultValue={cond?.a != null ? String(cond.a).replace(".", ",") : ""}
                onChange={(e) => setCond((c) => (c ? { ...c, a: parseNum(e.target.value) } : c))}
                autoFocus
              />
              {opInfo.args === 2 && (
                <input
                  className="ido-input ido-input-mono"
                  style={{ height: 32 }}
                  inputMode="decimal"
                  placeholder="hasta"
                  defaultValue={cond?.b != null ? String(cond.b).replace(".", ",") : ""}
                  onChange={(e) => setCond((c) => (c ? { ...c, b: parseNum(e.target.value) } : c))}
                />
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: "4px 6px" }}>
        <div className="ido-inputbox" style={{ height: 32, gap: 6 }}>
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--ido-text-2)" }} />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar valor…"
            aria-label="Buscar valor"
            autoFocus={!numerica}
          />
        </div>
      </div>

      <div style={{ maxHeight: 240, overflowY: "auto", padding: "2px 0" }}>
        {visibles.length === 0 ? (
          <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--ido-text-2)" }}>Ningún valor coincide.</div>
        ) : (
          <>
            <div className={itemCls} onClick={toggleTodas} role="checkbox" aria-checked={todasVisiblesOn ? "true" : algunaVisibleOn ? "mixed" : "false"}>
              <IdoCheckbox checked={todasVisiblesOn} indeterminate={!todasVisiblesOn && algunaVisibleOn} onClick={toggleTodas} label="Seleccionar todo" />
              <span style={{ color: "var(--ido-text)" }}>{q ? "(Seleccionar todos los resultados)" : "(Seleccionar todo)"}</span>
            </div>
            {mostradas.map((o) => (
              <div key={o.clave} className={itemCls} onClick={() => toggle(o.clave)} role="checkbox" aria-checked={elegidas.has(o.clave)} title={o.label}>
                <IdoCheckbox checked={elegidas.has(o.clave)} onClick={() => toggle(o.clave)} label={o.label} />
                <span
                  className={numerica ? "font-mono tabular-nums" : undefined}
                  style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {o.label}
                </span>
                <span style={{ marginLeft: "auto", paddingLeft: 8, fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11, color: "var(--ido-text-2)" }}>
                  {o.n.toLocaleString("es-AR")}
                </span>
              </div>
            ))}
            {visibles.length > MAX_LISTA && (
              <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--ido-warning)" }}>
                Se muestran {MAX_LISTA} de {visibles.length.toLocaleString("es-AR")} valores: usá el buscador.
              </div>
            )}
          </>
        )}
      </div>

      <div className="ido-pop-sep" />
      <div className="flex items-center justify-end" style={{ gap: 6, padding: "2px 4px 4px" }}>
        <button type="button" className="ido-btn ido-btn-text" style={{ height: 30, marginRight: "auto" }} onClick={() => { onAplicar(null); onCerrar(); }}>
          Quitar filtro
        </button>
        <button type="button" className="ido-btn ido-btn-text" style={{ height: 30 }} onClick={onCerrar}>
          Cancelar
        </button>
        <button type="button" className="ido-btn ido-btn-primary" style={{ height: 30 }} onClick={() => { aceptar(); onCerrar(); }}>
          Aceptar
        </button>
      </div>
    </div>
  );
}
