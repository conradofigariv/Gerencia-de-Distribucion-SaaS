"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText, Trash2, Loader2, ClipboardPaste,
  Search, X, PackageOpen, RefreshCw, ChevronDown,
  ChevronUp, ChevronsUpDown,
} from "lucide-react";
import { parseTSV, saveUpload, getUploads, removeUpload, COL_MAP } from "@/lib/stockStorage";
import type { ZonaUpload, CompraRow } from "@/lib/stockStorage";
import { toast } from "sonner";

type Tab            = "resumen" | "cargar";
type ArticuloFiltro = "nro" | "nombre";

// SortCol is "articulo" | "descArticulo" | "udmPrimaria" | "total" | <zonaName>
type SortDir = "asc" | "desc";

interface PivotRow {
  articulo:     string;
  descArticulo: string;
  udmPrimaria:  string;
  total:        number;
  byZona:       Record<string, number>;
}

// ─── Zone colors ──────────────────────────────────────────────────────────────

const ZONA_COLORS = [
  "bg-chart-1/20 text-chart-1 border-chart-1/30",
  "bg-chart-2/20 text-chart-2 border-chart-2/30",
  "bg-chart-3/20 text-chart-3 border-chart-3/30",
  "bg-chart-4/20 text-chart-4 border-chart-4/30",
  "bg-chart-5/20 text-chart-5 border-chart-5/30",
  "bg-accent/20 text-accent border-accent/30",
];

function useZonaColorMap(zonas: string[]) {
  const map: Record<string, string> = {};
  zonas.forEach((z, i) => { map[z] = ZONA_COLORS[i % ZONA_COLORS.length]; });
  return map;
}

// ─── Custom zone dropdown ─────────────────────────────────────────────────────

function ZonaSelect({ zonas, value, onChange, colorMap }: {
  zonas: string[];
  value: string;
  onChange: (v: string) => void;
  colorMap: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const badgeCls = value !== "todos" ? colorMap[value] : "bg-secondary text-muted-foreground border-border";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground hover:border-accent/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all min-w-[160px]"
      >
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${badgeCls}`}>
          {value === "todos" ? "Todas las zonas" : value}
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground ml-auto transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-[calc(100%+4px)] left-0 min-w-full bg-card border border-border rounded-lg shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <button
            onClick={() => { onChange("todos"); setOpen(false); }}
            className={`w-full flex items-center px-3 py-2.5 text-sm hover:bg-secondary/60 transition-colors text-left ${value === "todos" ? "bg-secondary/40" : ""}`}
          >
            <span className="text-xs px-2 py-0.5 rounded-full border bg-secondary text-muted-foreground border-border">Todas las zonas</span>
          </button>
          {zonas.map(z => (
            <button
              key={z}
              onClick={() => { onChange(z); setOpen(false); }}
              className={`w-full flex items-center px-3 py-2.5 text-sm hover:bg-secondary/60 transition-colors text-left ${value === z ? "bg-secondary/40" : ""}`}
            >
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${colorMap[z]}`}>{z}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

export function StockZonaSection() {
  const [tab, setTab]                       = useState<Tab>("resumen");
  const [uploads, setUploads]               = useState<ZonaUpload[]>([]);
  const [loading, setLoading]               = useState(true);
  const [text, setText]                     = useState("");
  const [saving, setSaving]                 = useState(false);
  const [deletingZona, setDeletingZona]     = useState<string | null>(null);

  // Resumen filters
  const [filterZona, setFilterZona]         = useState("todos");
  const [filterSearch, setFilterSearch]     = useState("");
  const [articuloFiltro, setArticuloFiltro] = useState<ArticuloFiltro>("nro");
  const [sortCol, setSortCol]               = useState("articulo");
  const [sortDir, setSortDir]               = useState<SortDir>("asc");

  const handleSort = (col: string) => {
    if (col === sortCol) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir(col === "articulo" || col === "descArticulo" || col === "udmPrimaria" ? "asc" : "desc"); }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setUploads(await getUploads());
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const zonas     = uploads.map(u => u.zona);
  const colorMap  = useZonaColorMap(zonas);

  const lastUpdate = uploads.reduce<string | null>((latest, u) => {
    if (!latest || u.uploadedAt > latest) return u.uploadedAt;
    return latest;
  }, null);

  // Build pivot: one row per artículo, one column per zona
  const pivotMap = new Map<string, PivotRow>();
  for (const upload of uploads) {
    for (const row of upload.rows) {
      if (!pivotMap.has(row.articulo)) {
        pivotMap.set(row.articulo, {
          articulo: row.articulo, descArticulo: row.descArticulo,
          udmPrimaria: row.udmPrimaria, total: 0, byZona: {},
        });
      }
      const pivot = pivotMap.get(row.articulo)!;
      const qty = parseFloat(String(row.enMano).replace(",", ".")) || 0;
      pivot.total += qty;
      pivot.byZona[upload.zona] = (pivot.byZona[upload.zona] ?? 0) + qty;
    }
  }

  const pivotRows = Array.from(pivotMap.values())
    .filter(r => {
      const zonaOk   = filterZona === "todos" || (r.byZona[filterZona] ?? 0) > 0;
      const lo       = filterSearch.toLowerCase();
      const searchOk = !filterSearch || (
        articuloFiltro === "nro"
          ? r.articulo.toLowerCase().includes(lo)
          : r.descArticulo.toLowerCase().includes(lo)
      );
      return zonaOk && searchOk;
    })
    .sort((a, b) => {
      let va: number | string;
      let vb: number | string;
      if (sortCol === "total") {
        va = a.total; vb = b.total;
      } else if (sortCol === "articulo" || sortCol === "descArticulo" || sortCol === "udmPrimaria") {
        va = a[sortCol as keyof Pick<PivotRow, "articulo" | "descArticulo" | "udmPrimaria">];
        vb = b[sortCol as keyof Pick<PivotRow, "articulo" | "descArticulo" | "udmPrimaria">];
        const cmp = String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" });
        return sortDir === "asc" ? cmp : -cmp;
      } else {
        // zona column
        va = a.byZona[sortCol] ?? 0;
        vb = b.byZona[sortCol] ?? 0;
      }
      return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });

  // ── Carga handlers ─────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!text.trim()) { toast.error("Pegá el texto antes de importar."); return; }

    setSaving(true);
    const { rows, error } = parseTSV(text.trim());
    if (error) { toast.error(error); setSaving(false); return; }

    const byZona = new Map<string, CompraRow[]>();
    for (const row of rows) {
      const z = row.organizacion || "Sin zona";
      if (!byZona.has(z)) byZona.set(z, []);
      byZona.get(z)!.push(row);
    }

    const errors: string[] = [];
    for (const [zona, zonaRows] of byZona) {
      const err = await saveUpload({ zona, rows: zonaRows, fileName: "pegado manual", uploadedAt: new Date().toISOString() });
      if (err) errors.push(`${zona}: ${err}`);
    }

    if (errors.length > 0) {
      toast.error(`Errores al guardar: ${errors.join(", ")}`);
    } else {
      const zonaNames = [...byZona.keys()].join(", ");
      toast.success(`${rows.length} registros · ${byZona.size} zona${byZona.size > 1 ? "s" : ""}: ${zonaNames}`);
      setText("");
      setTab("resumen");
      await refresh();
    }
    setSaving(false);
  };

  const handleDelete = async (z: string) => {
    setDeletingZona(z);
    const err = await removeUpload(z);
    if (err) toast.error(`Error al eliminar: ${err}`);
    else { toast.success(`Zona "${z}" eliminada`); await refresh(); }
    setDeletingZona(null);
  };

  const previewZonas = (() => {
    if (!text.trim()) return [];
    const { rows } = parseTSV(text.trim());
    return [...new Set(rows.map(r => r.organizacion).filter(Boolean))];
  })();

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Stock por Zona</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {lastUpdate
              ? <>Última actualización: <span className="text-foreground">{new Date(lastUpdate).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</span></>
              : "Consulta y carga de stock por organización"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="shrink-0">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg w-fit">
        {(["resumen", "cargar"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "resumen" ? "Resumen de stock" : "Cargar datos"}
          </button>
        ))}
      </div>

      {/* ── RESUMEN ── */}
      {tab === "resumen" && (
        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />Cargando datos...
            </div>
          ) : uploads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground">
              <PackageOpen className="w-12 h-12 opacity-30" />
              <p className="text-sm">No hay datos cargados. Usá "Cargar datos" para importar.</p>
            </div>
          ) : (
            <>
              {/* Filters */}
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
                <ZonaSelect zonas={zonas} value={filterZona} onChange={setFilterZona} colorMap={colorMap} />

                <div className="flex rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={() => { setArticuloFiltro("nro"); setFilterSearch(""); }}
                    className={`h-10 px-3 text-sm transition-colors whitespace-nowrap ${articuloFiltro === "nro" ? "bg-accent text-accent-foreground font-medium" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
                  >
                    Artículo Nro
                  </button>
                  <button
                    onClick={() => { setArticuloFiltro("nombre"); setFilterSearch(""); }}
                    className={`h-10 px-3 text-sm transition-colors whitespace-nowrap border-l border-border ${articuloFiltro === "nombre" ? "bg-accent text-accent-foreground font-medium" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
                  >
                    Artículo Nombre
                  </button>
                </div>

                <div className="relative flex-1 min-w-[180px] max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={filterSearch}
                    onChange={e => setFilterSearch(e.target.value)}
                    placeholder={articuloFiltro === "nro" ? "Buscar por número..." : "Buscar por nombre..."}
                    className="w-full h-10 pl-10 pr-8 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all"
                  />
                  {filterSearch && (
                    <button onClick={() => setFilterSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <p className="text-sm text-muted-foreground sm:ml-auto whitespace-nowrap">
                  {pivotRows.length} de {pivotMap.size} artículos
                </p>
              </div>

              {/* Pivot Table */}
              <Card className="border-border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-max">
                    <thead>
                      <tr className="border-b border-border bg-secondary/60">
                        {(
                          [
                            { col: "articulo",     label: "Matrícula",   align: "left"  },
                            { col: "descArticulo", label: "Descripción", align: "left"  },
                            { col: "udmPrimaria",  label: "UDM",         align: "left"  },
                            { col: "total",        label: "Total",       align: "right" },
                          ] as { col: string; label: string; align: "left" | "right" }[]
                        ).map(({ col, label, align }) => {
                          const active = sortCol === col;
                          const Icon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
                          return (
                            <th
                              key={col}
                              onClick={() => handleSort(col)}
                              className={`px-4 py-3 font-medium text-xs uppercase tracking-wide cursor-pointer select-none whitespace-nowrap transition-colors ${align === "right" ? "text-right" : "text-left"} ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                            >
                              <span className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
                                {label}
                                <Icon className={`w-3.5 h-3.5 shrink-0 transition-opacity ${active ? "opacity-100" : "opacity-30"}`} />
                              </span>
                            </th>
                          );
                        })}
                        {zonas.map(zona => {
                          const active = sortCol === zona;
                          const Icon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
                          return (
                            <th
                              key={zona}
                              onClick={() => handleSort(zona)}
                              className={`px-4 py-3 font-medium text-xs uppercase tracking-wide cursor-pointer select-none whitespace-nowrap transition-colors text-right ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                            >
                              <span className="inline-flex items-center justify-end gap-1.5">
                                <Icon className={`w-3.5 h-3.5 shrink-0 transition-opacity ${active ? "opacity-100" : "opacity-30"}`} />
                                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${colorMap[zona] ?? ZONA_COLORS[0]}`}>{zona}</span>
                              </span>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {pivotRows.length === 0 ? (
                        <tr>
                          <td colSpan={4 + zonas.length} className="text-center py-12 text-muted-foreground text-sm">
                            No hay registros que coincidan con los filtros
                          </td>
                        </tr>
                      ) : (
                        pivotRows.map((row, i) => (
                          <tr key={i} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                            <td className="px-4 py-2.5 font-mono text-xs text-accent whitespace-nowrap">{row.articulo}</td>
                            <td className="px-4 py-2.5 text-foreground max-w-[260px] truncate">{row.descArticulo}</td>
                            <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{row.udmPrimaria}</td>
                            <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-foreground">{row.total.toLocaleString("es-AR")}</td>
                            {zonas.map(zona => {
                              const qty = row.byZona[zona];
                              return (
                                <td key={zona} className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                                  {qty != null && qty > 0 ? qty.toLocaleString("es-AR") : <span className="opacity-30">—</span>}
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Loaded zones with delete */}
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-base font-medium">Zonas cargadas</CardTitle>
                  <CardDescription>Datos disponibles en la base de datos</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {uploads.map(u => (
                      <div key={u.zona} className="flex items-center justify-between p-3 rounded-lg bg-secondary/40 border border-border">
                        <div className="flex items-center gap-3">
                          <FileText className="w-4 h-4 text-accent shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-foreground">{u.zona}</p>
                            <p className="text-xs text-muted-foreground">
                              {u.rows.length} registros · {new Date(u.uploadedAt).toLocaleDateString("es-AR")}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDelete(u.zona)}
                          disabled={deletingZona === u.zona}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                        >
                          {deletingZona === u.zona
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ── CARGAR ── */}
      {tab === "cargar" && (
        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">Pegar datos</CardTitle>
              <CardDescription>
                Copiá el contenido desde el sistema y pegalo acá. Las zonas se detectan desde la columna Organización.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={"Pegá aquí el texto copiado del sistema (Ctrl+V)...\n\nDebe contener las columnas: Artículo, Desc Artículo, UDM Primaria, En Mano, Organización"}
                rows={10}
                className="w-full px-3 py-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 font-mono resize-y"
              />

              {previewZonas.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Zonas detectadas:</span>
                  {previewZonas.map(z => (
                    <span key={z} className="text-xs px-2 py-0.5 rounded-full bg-accent/15 border border-accent/30 text-accent">{z}</span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3">
                <Button
                  onClick={handleImport}
                  disabled={saving || !text.trim()}
                  className="bg-accent hover:bg-accent/90 text-accent-foreground"
                >
                  {saving
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importando...</>
                    : <><ClipboardPaste className="w-4 h-4 mr-2" />Importar</>}
                </Button>
                {text.trim() && (
                  <button onClick={() => setText("")} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                    Limpiar
                  </button>
                )}
              </div>

              <div className="p-3 rounded-lg bg-secondary/40 border border-border space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Columnas requeridas</p>
                <div className="flex flex-wrap gap-2">
                  {Object.values(COL_MAP).map(col => (
                    <span key={col} className="text-xs px-2 py-1 rounded-md bg-secondary border border-border text-foreground">{col}</span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
