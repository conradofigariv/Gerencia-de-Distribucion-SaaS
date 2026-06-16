"use client";

import { useState, useRef, forwardRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── FloatingInput ─────────────────────────────────────────────────────────────
// Campo de texto con label flotante animado. El label sube y se achica al enfocar
// o cuando el campo tiene valor.

export interface FloatingInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /**
   * Color de fondo del contenedor padre. Se usa como "máscara" detrás del label
   * cuando flota, para que el borde no se vea por debajo del texto.
   * Por defecto coincide con el fondo de cards "beast pure".
   */
  cardBg?: string;
  /** Ícono opcional (elemento React) que se muestra a la izquierda del campo. */
  icon?: React.ReactNode;
  /** Ícono adicional a la derecha (ej: botón de mostrar contraseña). */
  rightElement?: React.ReactNode;
}

export const FloatingInput = forwardRef<HTMLInputElement, FloatingInputProps>(
  (
    {
      label,
      cardBg = "oklch(0.235 0.005 270)",
      icon,
      rightElement,
      className,
      onFocus,
      onBlur,
      value,
      ...props
    },
    ref,
  ) => {
    const [focused, setFocused] = useState(false);
    const hasValue = String(value ?? "").length > 0;
    const floated = focused || hasValue;

    const paddingLeft = icon ? "2.5rem" : "1rem";
    const paddingRight = rightElement ? "2.75rem" : "1rem";

    return (
      <div style={{ position: "relative" }} className={cn("w-full", className)}>
        {/* Left icon */}
        {icon && (
          <span
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: focused ? "#86efac" : "oklch(0.50 0 0)",
              pointerEvents: "none",
              transition: "color 150ms",
              display: "flex",
              alignItems: "center",
            }}
          >
            {icon}
          </span>
        )}

        {/* Input */}
        <input
          ref={ref}
          value={value}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={{
            width: "100%",
            paddingTop: "0.875rem",
            paddingBottom: "0.875rem",
            paddingLeft,
            paddingRight,
            borderRadius: "0.75rem",
            border: `1.5px solid ${focused ? "oklch(0.55 0.15 155 / 0.7)" : "oklch(1 0 0 / 0.10)"}`,
            background: "oklch(0.16 0.005 270)",
            color: "oklch(0.95 0 0)",
            fontSize: "0.875rem",
            outline: "none",
            transition: "border-color 150ms cubic-bezier(0.4,0,0.2,1), box-shadow 150ms",
            boxShadow: focused ? "0 0 0 3px oklch(0.55 0.15 155 / 0.12)" : "none",
          }}
          {...props}
        />

        {/* Floating label */}
        <label
          style={{
            position: "absolute",
            left: icon ? 38 : 14,
            top: 0,
            pointerEvents: "none",
            transformOrigin: "left center",
            transition:
              "transform 150ms cubic-bezier(0.4,0,0.2,1), color 150ms, background-color 150ms, padding 150ms",
            fontSize: "0.875rem",
            ...(floated
              ? {
                  transform: "translateY(-50%) scale(0.8)",
                  backgroundColor: cardBg,
                  padding: "0 4px",
                  color: focused ? "#86efac" : "oklch(0.58 0 0)",
                }
              : {
                  transform: "translateY(0.9rem)",
                  color: "oklch(0.46 0 0)",
                }),
          }}
        >
          {label}
        </label>

        {/* Right element (ej: toggle password) */}
        {rightElement && (
          <span
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
            }}
          >
            {rightElement}
          </span>
        )}
      </div>
    );
  },
);
FloatingInput.displayName = "FloatingInput";

// ─── SearchInput ───────────────────────────────────────────────────────────────
// Barra de búsqueda con ícono izquierdo, lupa animada y botón de limpiar.

export interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Ancho del contenedor (por defecto auto). */
  width?: number | string;
  /** Altura del contenedor (por defecto 38px). */
  height?: number | string;
  /** Tamaño de fuente del input (por defecto 13px). */
  fontSize?: number | string;
  inputRef?: React.RefObject<HTMLInputElement>;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar…",
  className,
  style,
  width,
  height = 38,
  fontSize = 13,
  inputRef: externalRef,
}: SearchInputProps) {
  const [focused, setFocused] = useState(false);
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      style={{
        position: "relative",
        borderRadius: "0.75rem",
        border: `1.5px solid ${focused ? "oklch(0.55 0.15 155 / 0.7)" : "oklch(1 0 0 / 0.10)"}`,
        background: "oklch(0.16 0.005 270)",
        padding: "0 10px",
        height,
        transition: "border-color 150ms cubic-bezier(0.4,0,0.2,1), box-shadow 150ms",
        boxShadow: focused ? "0 0 0 3px oklch(0.55 0.15 155 / 0.12)" : "none",
        cursor: "text",
        width: width ?? "auto",
        ...style,
      }}
      onClick={() => inputRef.current?.focus()}
    >
      <Search
        style={{
          width: 14,
          height: 14,
          color: focused ? "#86efac" : "oklch(0.50 0 0)",
          flexShrink: 0,
          transition: "color 150ms",
        }}
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          fontSize,
          color: "oklch(0.95 0 0)",
          minWidth: 0,
        }}
      />
      {value && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange("");
            inputRef.current?.focus();
          }}
          style={{
            color: "oklch(0.50 0 0)",
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "oklch(0.85 0 0)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "oklch(0.50 0 0)")
          }
        >
          <X style={{ width: 12, height: 12 }} />
        </button>
      )}
    </div>
  );
}
