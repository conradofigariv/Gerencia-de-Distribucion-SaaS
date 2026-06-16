"use client";

import { useState, useRef, forwardRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── FloatingInput ─────────────────────────────────────────────────────────────
// Campo de texto con label flotante animado. El label está centrado dentro del
// campo en reposo y "sube" sobre el borde superior al enfocar o tener valor.

export interface FloatingInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  /**
   * Color de fondo del contenedor padre. Se usa como "máscara" detrás del label
   * cuando flota, para que el borde no se vea por debajo del texto.
   */
  cardBg?: string;
  /** Ícono opcional a la izquierda del campo. */
  icon?: React.ReactNode;
  /** Elemento a la derecha (ej: botón de mostrar contraseña / limpiar). */
  rightElement?: React.ReactNode;
  /** Alto del campo en px (por defecto 50). */
  fieldHeight?: number;
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
      fieldHeight = 50,
      style,
      ...props
    },
    ref,
  ) => {
    const [focused, setFocused] = useState(false);
    const hasValue = String(value ?? "").length > 0;
    const floated = focused || hasValue;

    const paddingLeft = icon ? 38 : 14;
    const paddingRight = rightElement ? 40 : 14;

    return (
      <div style={{ position: "relative", ...style }} className={cn("w-full", className)}>
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
              zIndex: 2,
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
            height: fieldHeight,
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
            left: paddingLeft - 2,
            top: floated ? 0 : "50%",
            transform: floated
              ? "translateY(-50%) scale(0.82)"
              : "translateY(-50%) scale(1)",
            transformOrigin: "left center",
            pointerEvents: "none",
            transition:
              "top 160ms cubic-bezier(0.4,0,0.2,1), transform 160ms cubic-bezier(0.4,0,0.2,1), color 160ms, background-color 160ms, padding 160ms",
            fontSize: "0.875rem",
            whiteSpace: "nowrap",
            backgroundColor: floated ? cardBg : "transparent",
            padding: floated ? "0 5px" : "0",
            color: floated
              ? focused
                ? "#86efac"
                : "oklch(0.62 0 0)"
              : "oklch(0.48 0 0)",
            zIndex: 1,
          }}
        >
          {label}
        </label>

        {/* Right element */}
        {rightElement && (
          <span
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              zIndex: 2,
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
// Barra de búsqueda: reutiliza FloatingInput (mismo label flotante animado) con
// ícono de lupa a la izquierda y botón de limpiar a la derecha.

export interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Texto del label flotante (antes "placeholder"). */
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  width?: number | string;
  /** Alto del campo (por defecto 42). */
  height?: number;
  inputRef?: React.RefObject<HTMLInputElement>;
  autoFocus?: boolean;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar…",
  className,
  style,
  width,
  height = 42,
  inputRef: externalRef,
  autoFocus,
}: SearchInputProps) {
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;

  return (
    <FloatingInput
      ref={inputRef}
      label={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      fieldHeight={height}
      className={className}
      style={{ width: width ?? "auto", ...style }}
      icon={<Search style={{ width: 15, height: 15 }} />}
      rightElement={
        value ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            style={{ color: "oklch(0.50 0 0)", display: "flex", alignItems: "center" }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = "oklch(0.85 0 0)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = "oklch(0.50 0 0)")
            }
          >
            <X style={{ width: 14, height: 14 }} />
          </button>
        ) : undefined
      }
    />
  );
}
