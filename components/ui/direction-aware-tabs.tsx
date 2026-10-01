"use client";

import * as React from "react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";

export interface DirectionTab {
  id: string;
  label: React.ReactNode;
}

interface DirectionAwareTabsProps {
  tabs: DirectionTab[];
  value: string;
  onChange: (id: string) => void;
  children: React.ReactNode;
  /** Clases extra para la barra de pills. */
  className?: string;
  /** Override del radio de la barra (por defecto `rounded-full`). */
  rounded?: string;
  /** Clases extra para el contenedor de contenido. */
  contentClassName?: string;
  /** Contenido extra a la derecha de la barra de pills (misma fila). */
  end?: React.ReactNode;
}

/**
 * Barra de pestañas con indicador "burbuja" que se desliza entre opciones
 * (layout animation de motion). El contenido NO se remonta al cambiar —
 * el caller decide qué renderizar según `value`, evitando que los
 * virtualizadores pierdan su ref al scroll container.
 */
export function DirectionAwareTabs({
  tabs,
  value,
  onChange,
  children,
  className,
  rounded,
  contentClassName,
  end,
}: DirectionAwareTabsProps) {
  const handleClick = (id: string) => {
    if (id !== value) onChange(id);
  };

  const bar = (
      <div
        className={cn(
          // Mobile: ocupa todo el ancho en una sola fila (sin que ningún botón baje).
          // sm+: pill compacto alineado a la izquierda.
          "flex w-full flex-nowrap items-center gap-0.5 p-1 shadow-inner",
          "sm:inline-flex sm:w-auto sm:self-start sm:gap-1 sm:shrink-0",
          rounded ?? "rounded-full",
          className,
        )}
        style={{ background: "oklch(0.18 0.005 270)", border: "1px solid oklch(1 0 0 / 0.06)" }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === value;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleClick(tab.id)}
              className={cn(
                "relative flex flex-1 items-center justify-center overflow-hidden rounded-full outline-none whitespace-nowrap font-medium transition-colors duration-150 min-w-0",
                "px-2 py-[7px] text-[12px] sm:flex-none sm:px-4 sm:text-[13px]",
                isActive ? "text-white" : "text-neutral-500 hover:text-neutral-200",
              )}
              style={{ WebkitTapHighlightColor: "transparent" }}
            >
              {isActive && (
                <motion.span
                  layoutId="direction-aware-bubble"
                  className="absolute inset-0 z-10"
                  style={{ borderRadius: 9999, background: "oklch(0.32 0.006 270)", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }}
                  transition={{ type: "spring", bounce: 0.19, duration: 0.4 }}
                />
              )}
              <span className="relative z-20 inline-flex items-center gap-1 sm:gap-1.5 min-w-0 [&>svg]:shrink-0">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
  );

  return (
    <div className="flex flex-col w-full">
      {end ? (
        <div className="flex items-center justify-between gap-x-3 gap-y-2 flex-wrap">
          {bar}
          {/* flex-basis 0 + min-width automático (= su min-content): la fila
              solo salta de línea si ni el MÍNIMO de `end` entra al lado de las
              pestañas. Si no, `end` ocupa el resto y lo que sea achicable
              adentro (ej. el nombre de la licitación) se trunca con "…". */}
          <div className="flex items-center justify-end gap-2.5" style={{ flex: "1 1 0" }}>{end}</div>
        </div>
      ) : (
        bar
      )}

      <div className={cn("w-full", contentClassName)}>
        {children}
      </div>
    </div>
  );
}
