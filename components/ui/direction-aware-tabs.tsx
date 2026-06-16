"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";

export interface DirectionTab {
  id: string;
  label: React.ReactNode;
}

interface DirectionAwareTabsProps {
  tabs: DirectionTab[];
  value: string;
  onChange: (id: string) => void;
  /** Contenido de la pestaña activa (se re-monta y desliza al cambiar). */
  children: React.ReactNode;
  /** Clases extra para la barra de pills. */
  className?: string;
  /** Override del radio de la barra (por defecto `rounded-full`). */
  rounded?: string;
  /** Clases extra para el contenedor de contenido. */
  contentClassName?: string;
}

/**
 * Barra de pestañas con indicador "burbuja" que se desliza entre opciones
 * (layout animation) y contenido que entra/sale según la dirección del cambio.
 * Diseño basado en el patrón "Direction Aware Tabs".
 */
export function DirectionAwareTabs({
  tabs,
  value,
  onChange,
  children,
  className,
  rounded,
  contentClassName,
}: DirectionAwareTabsProps) {
  const activeIndex = Math.max(0, tabs.findIndex((t) => t.id === value));
  const prevIndex = React.useRef(activeIndex);
  const [direction, setDirection] = React.useState(0);

  React.useEffect(() => {
    if (activeIndex !== prevIndex.current) {
      setDirection(activeIndex > prevIndex.current ? 1 : -1);
      prevIndex.current = activeIndex;
    }
  }, [activeIndex]);

  const handleClick = (id: string) => {
    if (id === value) return;
    const idx = tabs.findIndex((t) => t.id === id);
    setDirection(idx > activeIndex ? 1 : -1);
    prevIndex.current = idx;
    onChange(id);
  };

  const variants = {
    initial: (dir: number) => ({ x: dir > 0 ? 64 : -64, opacity: 0, filter: "blur(4px)" }),
    active: { x: 0, opacity: 1, filter: "blur(0px)" },
    exit: (dir: number) => ({ x: dir > 0 ? -64 : 64, opacity: 0, filter: "blur(4px)" }),
  };

  return (
    <div className="flex flex-col w-full">
      <div
        className={cn(
          "inline-flex flex-wrap items-center gap-1 p-1 self-start shadow-inner",
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
                "relative rounded-full px-4 py-2 text-[13px] font-medium transition-colors outline-none whitespace-nowrap",
                isActive ? "text-white" : "text-neutral-400 hover:text-neutral-200",
              )}
              style={{ WebkitTapHighlightColor: "transparent" }}
            >
              {isActive && (
                <motion.span
                  layoutId="direction-aware-bubble"
                  className="absolute inset-0 z-10 mix-blend-difference"
                  style={{ borderRadius: 9999, background: "white" }}
                  transition={{ type: "spring", bounce: 0.19, duration: 0.4 }}
                />
              )}
              <span className="inline-flex items-center gap-1.5">{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className={cn("relative w-full overflow-hidden", contentClassName)}>
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={value}
            custom={direction}
            variants={variants}
            initial="initial"
            animate="active"
            exit="exit"
            transition={{ duration: 0.3, type: "spring", bounce: 0.18 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
