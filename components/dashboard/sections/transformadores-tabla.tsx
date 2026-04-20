"use client";

import React, { useState } from "react";

type FilterType = "Todos" | "Rural" | "Urbano" | "Con reparaciones";

interface TrafoRow {
  kva: number;
  tipo: "Rural" | "Urbano";
  t: number;
  m: number;
  ct: number;
}

const DATA: TrafoRow[] = [
  { kva: 5,    tipo: "Rural",  t: 0, m: 0, ct: 0 },
  { kva: 10,   tipo: "Rural",  t: 0, m: 0, ct: 0 },
  { kva: 16,   tipo: "Rural",  t: 0, m: 1, ct: 0 },
  { kva: 25,   tipo: "Rural",  t: 2, m: 0, ct: 0 },
  { kva: 50,   tipo: "Urbano", t: 0, m: 0, ct: 0 },
  { kva: 63,   tipo: "Urbano", t: 4, m: 0, ct: 1 },
  { kva: 80,   tipo: "Urbano", t: 0, m: 0, ct: 0 },
  { kva: 100,  tipo: "Urbano", t: 0, m: 0, ct: 0 },
  { kva: 125,  tipo: "Urbano", t: 0, m: 0, ct: 0 },
  { kva: 160,  tipo: "Urbano", t: 5, m: 0, ct: 3 },
  { kva: 200,  tipo: "Urbano", t: 0, m: 0, ct: 0 },
  { kva: 250,  tipo: "Urbano", t: 7, m: 0, ct: 5 },
  { kva: 315,  tipo: "Urbano", t: 0, m: 0, ct: 0 },
  { kva: 500,  tipo: "Urbano", t: 0, m: 0, ct: 0 },
  { kva: 630,  tipo: "Urbano", t: 7, m: 0, ct: 0 },
  { kva: 800,  tipo: "Urbano", t: 8, m: 0, ct: 4 },
  { kva: 1000, tipo: "Urbano", t: 2, m: 0, ct: 1 },
];

const T_COLOR  = "#185FA5";
const M_COLOR  = "#0F6E56";
const CT_COLOR = "#854F0B";
const DASH     = { color: "#9ca3af" };
const RURAL    = { background: "#EAF3DE", color: "#27500A" };
const URBANO   = { background: "#E6F1FB", color: "#0C447C" };

const FILTERS: FilterType[] = ["Todos", "Rural", "Urbano", "Con reparaciones"];

export function TablaTransformadores() {
  const [filter, setFilter] = useState<FilterType>("Todos");

  const filtered = DATA.filter(row => {
    if (filter === "Rural")            return row.tipo === "Rural";
    if (filter === "Urbano")           return row.tipo === "Urbano";
    if (filter === "Con reparaciones") return row.t + row.m > 0;
    return true;
  });

  const totalAll = DATA.reduce((s, r) => s + r.t + r.m, 0);
  const totalT   = DATA.reduce((s, r) => s + r.t,       0);
  const totalM   = DATA.reduce((s, r) => s + r.m,       0);
  const totalCT  = DATA.reduce((s, r) => s + r.ct,      0);

  const fT  = filtered.reduce((s, r) => s + r.t,       0);
  const fM  = filtered.reduce((s, r) => s + r.m,       0);
  const fCT = filtered.reduce((s, r) => s + r.ct,      0);
  const fTot = filtered.reduce((s, r) => s + r.t + r.m, 0);

  return (
    <div className="space-y-6">

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total transformadores", value: totalAll, color: "text-foreground" },
          { label: "Trifásicos (T)",         value: totalT,   color: "",  hex: T_COLOR  },
          { label: "Monofásicos (M)",        value: totalM,   color: "",  hex: M_COLOR  },
          { label: "Con tanque",             value: totalCT,  color: "",  hex: CT_COLOR },
        ].map(card => (
          <div key={card.label} className="bg-card border border-border rounded-xl p-5 space-y-1 shadow-sm">
            <p className={`text-3xl font-bold ${card.color}`} style={card.hex ? { color: card.hex } : {}}>
              {card.value}
            </p>
            <p className="text-xs text-muted-foreground">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Filter Pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-all ${
              filter === f
                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                : "bg-transparent text-muted-foreground border-border hover:border-blue-400 hover:text-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 text-xs flex-wrap">
        <span className="font-semibold text-foreground">Leyenda:</span>
        <span style={{ color: T_COLOR  }}>● Trifásico (T)</span>
        <span style={{ color: M_COLOR  }}>● Monofásico (M)</span>
        <span style={{ color: CT_COLOR }}>● Con tanque (C/T)</span>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={RURAL}>Rural</span>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={URBANO}>Urbano</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground">KVA</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground">Tipo</th>
              <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide" style={{ color: T_COLOR  }}>T</th>
              <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide" style={{ color: M_COLOR  }}>M</th>
              <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide" style={{ color: CT_COLOR }}>C/Tanque</th>
              <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-foreground">Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, idx) => {
              const total = row.t + row.m;
              return (
                <tr
                  key={row.kva}
                  className={`border-b border-border/50 hover:bg-accent/5 transition-colors ${idx % 2 === 0 ? "" : "bg-card/30"}`}
                >
                  <td className="px-4 py-2.5 font-semibold text-foreground">{row.kva}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={row.tipo === "Rural" ? RURAL : URBANO}>
                      {row.tipo}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center font-medium" style={row.t  ? { color: T_COLOR  } : DASH}>{row.t  || "—"}</td>
                  <td className="px-4 py-2.5 text-center font-medium" style={row.m  ? { color: M_COLOR  } : DASH}>{row.m  || "—"}</td>
                  <td className="px-4 py-2.5 text-center font-medium" style={row.ct ? { color: CT_COLOR } : DASH}>{row.ct || "—"}</td>
                  <td className="px-4 py-2.5 text-center font-bold text-foreground">{total || "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-card/60">
              <td className="px-4 py-3 font-bold text-xs uppercase tracking-wide text-foreground" colSpan={2}>Total</td>
              <td className="px-4 py-3 text-center font-bold" style={{ color: T_COLOR  }}>{fT  || "—"}</td>
              <td className="px-4 py-3 text-center font-bold" style={{ color: M_COLOR  }}>{fM  || "—"}</td>
              <td className="px-4 py-3 text-center font-bold" style={{ color: CT_COLOR }}>{fCT || "—"}</td>
              <td className="px-4 py-3 text-center font-bold text-foreground">{fTot || "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// backward-compat alias used in app/page.tsx
export { TablaTransformadores as TransformadoresTablaSection };
