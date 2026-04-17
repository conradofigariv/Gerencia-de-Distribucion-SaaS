"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, Search, ChevronUp, ChevronDown, Image as ImageIcon, X,
} from "lucide-react";

interface Transformador {
  id:         string;
  numero:     string;
  tipo:       string | null;
  potencia:   string | null;
  tension:    string | null;
  estado:     string | null;
  ubicacion:  string | null;
  imagen_url: string | null;
  created_at: string;
}

const ESTADO_COLORS: Record<string, string> = {
  "Disponible":    "bg-green-500/15 text-green-400",
  "En servicio":   "bg-blue-500/15 text-blue-400",
  "En reparación": "bg-amber-500/15 text-amber-400",
  "Baja":          "bg-red-500/15 text-red-400",
};

type SortKey = keyof Transformador;
type SortDir = "asc" | "desc";

export function TransformadoresTablaSection() {
  const [rows, setRows]         = useState<Transformador[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [sortKey, setSortKey]   = useState<SortKey>("numero");
  const [sortDir, setSortDir]   = useState<SortDir>("asc");
  const [preview, setPreview]   = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("transformadores")
      .select("*")
      .order("numero", { ascending: true });
    if (error) {
      toast.error(error.message);
    } else {
      setRows(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const filtered = rows.filter(r =>
    [r.numero, r.tipo, r.potencia, r.tension, r.estado, r.ubicacion]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const sorted = [...filtered].sort((a, b) => {
    const av = String(a[sortKey] ?? "");
    const bv = String(b[sortKey] ?? "");
    return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all"
          />
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
        <span className="ml-auto text-sm text-muted-foreground">{sorted.length} registros</span>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                {([
                  ["numero",   "Número"],
                  ["tipo",     "Tipo"],
                  ["potencia", "Potencia"],
                  ["tension",  "Tensión"],
                  ["estado",   "Estado"],
                  ["ubicacion","Ubicación"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <Th key={key} label={label} sortKey={sortKey} currentKey={key} dir={sortDir} onSort={handleSort} />
                ))}
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Imagen</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Cargando…
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-muted-foreground text-sm">
                    No hay transformadores registrados.
                  </td>
                </tr>
              ) : sorted.map((row, i) => (
                <tr
                  key={row.id}
                  className={`border-b border-border last:border-0 hover:bg-secondary/30 transition-colors ${i % 2 === 0 ? "" : "bg-secondary/10"}`}
                >
                  <td className="px-4 py-3 font-mono font-semibold text-foreground">{row.numero}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.tipo ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.potencia ? `${row.potencia} kVA` : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.tension ?? "—"}</td>
                  <td className="px-4 py-3">
                    {row.estado ? (
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_COLORS[row.estado] ?? "bg-secondary text-muted-foreground"}`}>
                        {row.estado}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[180px] truncate">{row.ubicacion ?? "—"}</td>
                  <td className="px-4 py-3">
                    {row.imagen_url ? (
                      <button
                        onClick={() => setPreview(row.imagen_url)}
                        className="w-9 h-9 rounded-lg overflow-hidden border border-border hover:border-accent transition-colors"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={row.imagen_url} alt={row.numero} className="w-full h-full object-cover" />
                      </button>
                    ) : (
                      <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-secondary border border-border text-muted-foreground">
                        <ImageIcon className="w-4 h-4" />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Image lightbox */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div className="relative max-w-2xl w-full mx-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setPreview(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-background border border-border flex items-center justify-center hover:bg-secondary transition-colors z-10"
            >
              <X className="w-4 h-4 text-foreground" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Preview" className="w-full rounded-xl border border-border shadow-2xl object-contain max-h-[80vh]" />
          </div>
        </div>
      )}
    </div>
  );
}

function Th({
  label, sortKey: current, currentKey, dir, onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = current === currentKey;
  return (
    <th
      className="px-4 py-3 text-left font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => onSort(currentKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="flex flex-col -space-y-1">
          <ChevronUp className={`w-3 h-3 ${active && dir === "asc" ? "text-accent" : "opacity-30"}`} />
          <ChevronDown className={`w-3 h-3 ${active && dir === "desc" ? "text-accent" : "opacity-30"}`} />
        </span>
      </span>
    </th>
  );
}
