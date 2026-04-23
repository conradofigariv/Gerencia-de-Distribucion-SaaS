"use client";

import { useState, useRef, useEffect } from "react";
import { Layers } from "lucide-react";
import type { BgEffect } from "@/components/canvas-background";

const OPTIONS: { value: BgEffect; label: string }[] = [
  { value: "pipeline", label: "Pipeline" },
  { value: "aurora",   label: "Aurora" },
  { value: "swirl",    label: "Swirl" },
  { value: "coalesce", label: "Coalesce" },
  { value: "shift",    label: "Shift" },
  { value: "none",     label: "Sin fondo" },
];

interface BgSelectorProps {
  value: BgEffect;
  onChange: (v: BgEffect) => void;
}

export function BgSelector({ value, onChange }: BgSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="Fondo animado"
        className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 ${value !== "none" ? "text-accent hover:bg-secondary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
      >
        <Layers className="w-5 h-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-card border border-border rounded-lg shadow-lg z-50 py-1">
          {OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${o.value === value ? "text-accent font-medium bg-accent/5" : "text-foreground hover:bg-secondary"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
