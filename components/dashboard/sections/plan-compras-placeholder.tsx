"use client";

import React from "react";

interface PlanComprasPlaceholderProps {
  icon: React.ElementType;
  titulo: string;
  descripcion: string;
  pendiente: string[];
  marca: React.ElementType;
}

/**
 * Cartel provisorio compartido por las dos subsecciones de Plan de Compras.
 * Se borra entero cuando ambas pantallas tengan su contenido real.
 */
export function PlanComprasPlaceholder({
  icon: Icon,
  titulo,
  descripcion,
  pendiente,
  marca: Marca,
}: PlanComprasPlaceholderProps) {
  return (
    <div className="p-6">
      <div
        className="max-w-3xl mx-auto rounded-[14px] overflow-hidden"
        style={{ background: "var(--panel)", border: "1px solid var(--hairline)" }}
      >
        <div
          className="flex items-center gap-3 px-6 py-4"
          style={{ background: "var(--panel-header)", borderBottom: "1px solid var(--hairline)" }}
        >
          <Icon className="w-5 h-5" style={{ color: "var(--accent-green)" }} />
          <h2 className="text-[15px] font-semibold text-foreground">{titulo}</h2>
          <div className="flex-1" />
          <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <Marca className="w-3.5 h-3.5" />
            En construcción
          </span>
        </div>

        <div className="px-6 py-5 space-y-5">
          <p className="text-[13px] leading-relaxed text-muted-foreground">{descripcion}</p>

          <div
            className="rounded-[12px] px-5 py-4"
            style={{ background: "var(--panel-2)", border: "1px solid var(--hairline)" }}
          >
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Pendiente
            </p>
            <ul className="space-y-2">
              {pendiente.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-[12.5px] text-foreground/85">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0 mt-[6px]"
                    style={{ background: "var(--accent-amber)" }}
                  />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
