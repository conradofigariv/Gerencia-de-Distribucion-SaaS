import * as React from "react";
import { cn } from "@/lib/utils";

// ─── Shell visual de tabla ("beast") ────────────────────────────────────────
//
// El ASPECTO de las tablas densas del sistema (Buscador, Matrículas, Informe
// Técnico…), en un solo lugar. Comparte SOLO la presentación: el
// comportamiento —selección, agrupado, edición inline, virtualización— vive
// en cada sección, porque es distinto en cada una y meterlo acá haría un
// componente imposible de usar.
//
// ⚠ Todo sale de tokens (--panel-2, --panel-header, --hairline), NUNCA de
//   `oklch()` literal: es la regla del CLAUDE.md. El Buscador todavía
//   hardcodea estos mismos valores —son idénticos, verificados uno por uno—
//   y queda para migrar incremental.
//
// La densidad es deliberada: 7px de alto de celda y 12px de fuente. Estas
// tablas muestran miles de filas y el objetivo es ver la mayor cantidad
// posible de un vistazo, no que respire.

/** Contenedor: panel oscuro, borde tenue, esquinas 10px. Scrollea adentro. */
export function DataTablePanel({
  className, children, ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[10px] overflow-hidden flex flex-col bg-panel-2 border border-hairline",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * El área que scrollea. Va entre el panel y la <table>.
 *
 * Acepta `ref` como prop normal (React 19) — lo necesita quien virtualice:
 * `useVirtualizer` mide el scroll sobre este elemento.
 */
export function DataTableScroll({
  className, children, ref, ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className={cn("overflow-auto flex-1 min-h-0", className)} {...props}>
      {children}
    </div>
  );
}

/**
 * La <table>. `tableLayout: fixed` + `borderSpacing: 0` es lo que permite
 * columnas de ancho fijo redimensionables y bordes que no se duplican.
 */
export function DataTableRoot({
  width, className, children, ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { width?: number }) {
  return (
    <table
      className={cn("text-[12px]", className)}
      style={{ tableLayout: "fixed", width, borderCollapse: "separate", borderSpacing: 0 }}
      {...props}
    >
      {children}
    </table>
  );
}

/**
 * Celda de encabezado: sticky arriba, mayúsculas chicas, fondo OPACO.
 *
 * ⚠ El fondo tiene que ser `bg-panel-header` (opaco). NUNCA `bg-secondary`:
 *   ese token lleva alpha (`/ 0.85`) y al scrollear se transparenta y se ven
 *   las filas pasando por atrás. Es un bug que ya apareció antes.
 */
export function DataTableHead({
  align = "left", active, className, children, ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & {
  align?: "left" | "right";
  /** Resaltado (ej. la columna por la que se está ordenando). */
  active?: boolean;
}) {
  return (
    <th
      className={cn(
        "sticky top-0 z-[2] px-3 py-2 select-none",
        "text-[12px] font-semibold uppercase tracking-[0.5px]",
        "bg-panel-header border-b border-border",
        align === "right" ? "text-right" : "text-left",
        active ? "text-foreground" : "text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </th>
  );
}

/**
 * Celda de datos. `num` alinea a la derecha y usa cifras tabulares +
 * monoespaciada, para que las columnas de números se lean en bloque; `mono`
 * hace lo mismo sin alinear a la derecha (códigos, matrículas).
 */
export function DataTableCell({
  num, mono, last, className, style, children, ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  num?:  boolean;
  mono?: boolean;
  /** Última fila: sin borde inferior, para no duplicarlo con el del panel. */
  last?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-3 py-[7px] truncate",
        num ? "text-right tabular-nums" : "text-left",
        (num || mono) && "font-mono",
        className
      )}
      style={{
        borderBottom: last ? undefined : "1px solid hsl(var(--border))",
        ...style,
      }}
      {...props}
    >
      {children}
    </td>
  );
}

/** Fila con el hover del sistema. */
export function DataTableRow({
  className, children, ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("group transition-colors hover:bg-panel-header/50", className)}
      {...props}
    >
      {children}
    </tr>
  );
}

/**
 * Handle para redimensionar una columna. Se pone DENTRO de un
 * `DataTableHead` (que ya es `position: sticky`, o sea contexto posicional).
 */
export function DataTableResize({ onStart }: { onStart: (e: MouseEvent) => void }) {
  return (
    <div
      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none group/rh"
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onStart(e.nativeEvent); }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute right-0 top-1/4 h-1/2 w-px bg-border group-hover/rh:bg-accent/60 transition-colors" />
    </div>
  );
}
