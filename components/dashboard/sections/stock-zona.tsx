"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  Upload, Loader2, Search, ChevronDown, ChevronRight,
  Trash2, RefreshCw, MapPin,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StockRow {
  id?: string;
  zona:        string;
  matricula:   string;
  descripcion: string;
  cantidad:    number | null;
  cargado_at?: string;
}

type Tab = "ver" | "cargar";

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseStockText(raw: string): { rows: StockRow[]; errors: string[] } {
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { rows: [], errors: ["El texto debe tener al menos una fila de encabezado y una de datos."] };

  const headers = lines[0].split("\t").map(h => h.trim().toLowerCase());
  const idx = {
    zona:        headers.findIndex(h => h.includes("zona")),
    matricula:   headers.findIndex(h => h.includes("matric") || h.includes("art")),
    descripcion: headers.findIndex(h => h.includes("desc") || h.includes("nombre") || h.includes("material")),
    cantidad:    headers.findIndex(h => h.includes("cant") || h.includes("stock") || h.includes("qty")),
  };

  const errors: string[] = [];
  if (idx.zona < 0)      errors.push("No se encontró columna ZONA.");
  if (idx.matricula < 0) errors.push("No se encontró columna MATRICULA (o ARTICULO).");
  if (errors.length) return { rows: [], errors };

  const rows: StockRow[] = [];
  lines.slice(1).forEach((line, i) => {
    const cols = line.split("\t");
    const zona      = (cols[idx.zona] ?? "").trim();
    const matricula = (cols[idx.matricula] ?? "").trim();
    if (!zona || !matricula) return;
    const descripcion = idx.descripcion >= 0 ? (cols[idx.descripcion] ?? "").trim() : "";
    const rawCant     = idx.cantidad >= 0 ? (cols[idx.cantidad] ?? "").trim() : "";
    const cantidad    = rawCant !== "" ? parseFloat(rawCant.replace(",", ".")) : null;
    if (rawCant !== "" && isNaN(cantidad!)) {
      errors.push(`Fila ${i + 2}: cantidad inválida "${rawCant}".`);
      return;
    }
    rows.push({ zona, matricula, descripcion, cantidad });
  });

  return { rows, errors };
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StockZonaSection() {
  const [tab, setTab]           = useState<Tab>("ver");
  const [rows, setRows]         = useState<StockRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  // Carga tab state
  const [rawText, setRawText]   = useState("");
  const [preview, setPreview]   = useState<StockRow[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [replaceAll, setReplaceAll]   = useState(true);

  // Ver tab state
  const [search, setSearch]         = useState("");
  const [zonaFilter, setZonaFilter] = useState<string>("__all__");
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("stock_zona")
      .select("*")
      .order("zona")
      .order("matricula");
    if (error) {
      toast.error(`Error al cargar: ${error.message}`);
    } else {
      setRows((data as StockRow[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Parse preview ─────────────────────────────────────────────────────────

  const handleParse = () => {
    const { rows: parsed, errors } = parseStockText(rawText);
    setParseErrors(errors);
    setPreview(errors.length === 0 ? parsed : null);
    if (errors.length === 0 && parsed.length === 0) {
      setParseErrors(["No se encontraron filas válidas en el texto."]);
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!preview || preview.length === 0) return;
    setSaving(true);
    try {
      if (replaceAll) {
        const { error: delErr } = await supabase.from("stock_zona").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        if (delErr) throw delErr;
      }
      const BATCH = 500;
      for (let i = 0; i < preview.length; i += BATCH) {
        const { error } = await supabase.from("stock_zona").insert(preview.slice(i, i + BATCH));
        if (error) throw error;
      }
      toast.success(`${preview.length} filas guardadas.`);
      setRawText("");
      setPreview(null);
      setParseErrors([]);
      setTab("ver");
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Error al guardar: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete all ────────────────────────────────────────────────────────────

  const handleClearAll = async () => {
    if (!confirm("¿Eliminar todo el stock cargado?")) return;
    const { error } = await supabase.from("stock_zona").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) { toast.error(error.message); return; }
    setRows([]);
    toast.success("Stock eliminado.");
  };

  // ── Derived data ──────────────────────────────────────────────────────────

  const zonas = Array.from(new Set(rows.map(r => r.zona))).sort();

  const filtered = rows.filter(r => {
    const matchZona = zonaFilter === "__all__" || r.zona === zonaFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || r.matricula.toLowerCase().includes(q) || r.descripcion.toLowerCase().includes(q);
    return matchZona && matchSearch;
  });

  const grouped = zonas
    .filter(z => zonaFilter === "__all__" || z === zonaFilter)
    .map(z => ({ zona: z, items: filtered.filter(r => r.zona === z) }))
    .filter(g => g.items.length > 0);

  const toggleZona = (z: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(z) ? n.delete(z) : n.add(z); return n; });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Stock por Zona</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {rows.length} materiales en {zonas.length} zona{zonas.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Actualizar
          </button>
          {rows.length > 0 && (
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-destructive hover:bg-destructive/10 border border-border transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg w-fit">
        {(["ver", "cargar"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
              tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "ver" ? "Ver stock" : "Cargar datos"}
          </button>
        ))}
      </div>

      {/* ── VER TAB ── */}
      {tab === "ver" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar matrícula o descripción..."
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <select
              value={zonaFilter}
              onChange={e => setZonaFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              <option value="__all__">Todas las zonas</option>
              {zonas.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Cargando...</span>
            </div>
          ) : grouped.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">
                {rows.length === 0
                  ? "No hay stock cargado. Usá la pestaña «Cargar datos»."
                  : "No hay resultados para el filtro aplicado."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {grouped.map(({ zona, items }) => (
                <div key={zona} className="rounded-xl border border-border bg-card overflow-hidden">
                  {/* Zona header */}
                  <button
                    onClick={() => toggleZona(zona)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {expanded.has(zona)
                        ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      <MapPin className="w-4 h-4 text-accent" />
                      <span className="font-semibold text-sm text-foreground">{zona}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{items.length} material{items.length !== 1 ? "es" : ""}</span>
                  </button>

                  {/* Zona rows */}
                  {expanded.has(zona) && (
                    <div className="border-t border-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-secondary/30">
                            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Matrícula</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Descripción</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">Cantidad</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {items.map((row, i) => (
                            <tr key={row.id ?? i} className="hover:bg-secondary/30 transition-colors">
                              <td className="px-4 py-2.5 font-mono text-xs text-foreground">{row.matricula}</td>
                              <td className="px-4 py-2.5 text-muted-foreground">{row.descripcion || "—"}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums font-medium text-foreground">
                                {row.cantidad != null ? row.cantidad.toLocaleString("es-AR") : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CARGAR TAB ── */}
      {tab === "cargar" && (
        <div className="space-y-4 max-w-3xl">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground mb-1">Pegá los datos desde Excel</p>
              <p className="text-xs text-muted-foreground">
                Formato esperado (separado por tabulaciones): <code className="bg-secondary px-1 rounded text-[11px]">ZONA · MATRICULA · DESCRIPCION · CANTIDAD</code>
                <br/>La primera fila debe ser el encabezado.
              </p>
            </div>
            <textarea
              value={rawText}
              onChange={e => { setRawText(e.target.value); setPreview(null); setParseErrors([]); }}
              placeholder={"ZONA\tMATRICULA\tDESCRIPCION\tCANTIDAD\nGBA\t123456\tCable eléctrico\t50\nCOR\t789012\tTransformador\t10"}
              rows={10}
              className="w-full rounded-lg bg-secondary border border-border text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 px-3 py-2 resize-y"
            />

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={replaceAll}
                  onChange={e => setReplaceAll(e.target.checked)}
                  className="rounded border-border"
                />
                Reemplazar todo el stock existente
              </label>
              <button
                onClick={handleParse}
                disabled={!rawText.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-sm font-medium text-foreground disabled:opacity-40 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Previsualizar
              </button>
            </div>
          </div>

          {/* Parse errors */}
          {parseErrors.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-1">
              {parseErrors.map((e, i) => (
                <p key={i} className="text-sm text-destructive">{e}</p>
              ))}
            </div>
          )}

          {/* Preview */}
          {preview && preview.length > 0 && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
                <span className="text-sm font-medium text-foreground">
                  Vista previa — {preview.length} fila{preview.length !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {saving ? "Guardando..." : "Guardar"}
                </button>
              </div>
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-secondary/80">
                    <tr>
                      {["Zona", "Matrícula", "Descripción", "Cantidad"].map(h => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.slice(0, 100).map((r, i) => (
                      <tr key={i} className="hover:bg-secondary/30">
                        <td className="px-4 py-2 text-foreground">{r.zona}</td>
                        <td className="px-4 py-2 font-mono text-xs text-foreground">{r.matricula}</td>
                        <td className="px-4 py-2 text-muted-foreground">{r.descripcion || "—"}</td>
                        <td className="px-4 py-2 tabular-nums text-foreground">{r.cantidad != null ? r.cantidad : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 100 && (
                  <p className="text-center text-xs text-muted-foreground py-2">
                    Mostrando 100 de {preview.length} filas
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
