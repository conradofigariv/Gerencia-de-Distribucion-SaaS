"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, CheckIcon } from "lucide-react";

// ─── BeastSelect (dropdown unificado — mismo estilo que Stock por Zona /
// Informe Técnico). Extraído para reutilizar en secciones nuevas sin
// duplicar el componente otra vez. ──────────────────────────────────────────

export interface BeastOption { value: string; label: string; node?: React.ReactNode }

export function BeastSelect({
  options, value, onChange, placeholder, clearable = false, minWidth = 170, align = "left", portal = false,
}: {
  options: BeastOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  clearable?: boolean;   // si true, agrega una opción que limpia (value "")
  minWidth?: number;
  align?: "left" | "right";
  portal?: boolean;      // si true, renderiza el menú en document.body (escapa contenedores con overflow)
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left?: number; right?: number; minWidth: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  useEffect(() => {
    if (!open || !portal) return;
    const update = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.max(minWidth, r.width);
      // Anclar a la derecha si abrir a la izquierda se saldría del viewport
      const overflowsRight = r.left + w > window.innerWidth - 8;
      const anchorRight = align === "right" || overflowsRight;
      setCoords({
        top: r.bottom + 6,
        ...(anchorRight ? { right: Math.max(8, window.innerWidth - r.right) } : { left: r.left }),
        minWidth: w,
      });
    };
    update();
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", update); };
  }, [open, portal, align, minWidth]);

  const selected = options.find(o => o.value === value);
  const showPlaceholder = !selected;

  const renderItem = (label: string, node: React.ReactNode | undefined, isActive: boolean, onClick: () => void, key: string) => (
    <button
      key={key}
      onClick={onClick}
      className="w-full text-left flex items-center gap-2.5 transition-colors"
      style={{
        padding: "8px 10px", borderRadius: 7, border: "none",
        background: isActive ? "oklch(0.27 0.005 270)" : "transparent", cursor: "pointer",
      }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.25 0.005 270)"; }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    >
      <span className="flex-1 truncate text-[13px]" style={{ color: isActive ? "oklch(0.97 0 0)" : "oklch(0.82 0 0)", fontWeight: isActive ? 500 : 400 }}>
        {node ?? label}
      </span>
      {isActive && <CheckIcon className="w-3.5 h-3.5 shrink-0" style={{ color: "#8B5CF6" }} strokeWidth={2.6} />}
    </button>
  );

  const menuItems = (
    <>
      {clearable && renderItem(placeholder, undefined, value === "", () => { onChange(""); setOpen(false); }, "__clear__")}
      {options.map(o => renderItem(o.label, o.node, o.value === value, () => { onChange(o.value); setOpen(false); }, o.value))}
    </>
  );

  const menuStyle: React.CSSProperties = {
    background: "oklch(0.205 0.005 270)",
    border: "1px solid oklch(1 0 0 / 0.07)",
    borderRadius: 10,
    boxShadow: "0 14px 32px -16px rgba(0,0,0,0.6), 0 0 0 1px oklch(1 0 0 / 0.02) inset",
    padding: 4,
    maxHeight: 320, overflowY: "auto",
  };

  return (
    <div ref={ref} className="relative" style={{ flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2"
        style={{
          height: 38, padding: "0 12px", borderRadius: 9, minWidth, width: "100%",
          background: "oklch(0.16 0.005 270)",
          border: `1px solid ${open ? "oklch(0.55 0.20 295 / 0.55)" : "oklch(1 0 0 / 0.07)"}`,
          color: "oklch(0.97 0 0)", fontSize: 13,
          transition: "border-color .15s, box-shadow .15s",
          boxShadow: open ? "0 0 0 3px oklch(0.55 0.20 295 / 0.15)" : "none",
        }}
      >
        <span className="truncate flex-1 text-left flex items-center gap-2" style={{ color: showPlaceholder ? "oklch(0.55 0 0)" : "oklch(0.90 0 0)" }}>
          {selected ? (selected.node ?? selected.label) : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "oklch(0.55 0 0)" }} />
      </button>

      {open && portal && coords && createPortal(
        <div
          ref={menuRef}
          className="overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
          style={{ position: "fixed", zIndex: 300, top: coords.top, left: coords.left, right: coords.right, minWidth: coords.minWidth, ...menuStyle }}
        >
          {menuItems}
        </div>,
        document.body,
      )}

      {open && !portal && (
        <div
          ref={menuRef}
          className="absolute z-50 top-[calc(100%+6px)] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
          style={{ [align]: 0, minWidth: Math.max(minWidth, 200), ...menuStyle } as React.CSSProperties}
        >
          {menuItems}
        </div>
      )}
    </div>
  );
}
