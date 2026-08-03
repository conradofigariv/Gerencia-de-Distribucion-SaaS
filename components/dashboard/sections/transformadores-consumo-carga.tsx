"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { Loader2, CheckCircle2, Eraser } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  POT_CONSUMO,
  SECTORES,
  SECTORES_ZONA_A,
  normalizarDatos,
  etiquetaMes,
  type ConsumoDatos,
  type ConsumoPorSector,
  type TipoConsumo,
} from "@/lib/consumo-transformadores";

// Sector | 16 potencias | Total
const GRID_COLS = `150px repeat(${POT_CONSUMO.length},minmax(0,1fr)) 52px`;

/** Mes actual como "YYYY-MM". */
function mesActual(): string {
  return new Date().toISOString().slice(0, 7);
}

// ─── Celda editable ───────────────────────────────────────────────────────────

function EInput({ val, onChange }: { val: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(val || 0));

  useEffect(() => { setText(String(val || 0)); }, [val]);

  const commit = () => {
    const n = parseInt(text, 10);
    if (Number.isNaN(n) || n < 0) { setText(String(val || 0)); return; }
    onChange(n);
    setText(String(n));
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={e => setText(e.target.value.replace(/[^\d]/g, ""))}
      onFocus={e => e.target.select()}
      onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={cn(
        "w-full text-center text-[11px] leading-[1.1] font-semibold tabular-nums rounded-md bg-panel-input border border-border py-0.5 text-foreground",
        "focus:outline-none focus:border-accent focus:bg-accent/10 focus:ring-1 focus:ring-accent/30 transition-colors",
        val === 0 && "text-muted-foreground/50"
      )}
    />
  );
}

// ─── Helpers de estado ────────────────────────────────────────────────────────

/** Suma todas las celdas de un bloque. */
function totalBloque(b: ConsumoPorSector): number {
  let t = 0;
  for (const porPot of Object.values(b)) for (const v of Object.values(porPot)) t += v || 0;
  return t;
}

/** Suma la fila de un sector. */
function totalSector(b: ConsumoPorSector, sector: string): number {
  const porPot = b[sector];
  if (!porPot) return 0;
  let t = 0;
  for (const v of Object.values(porPot)) t += v || 0;
  return t;
}

/** Escribe un valor manteniendo el objeto disperso: los ceros se borran. */
function setCelda(
  b: ConsumoPorSector,
  sector: string,
  pot: number,
  val: number
): ConsumoPorSector {
  const next: ConsumoPorSector = { ...b, [sector]: { ...(b[sector] ?? {}) } };
  if (val > 0) next[sector][String(pot)] = val;
  else delete next[sector][String(pot)];
  if (Object.keys(next[sector]).length === 0) delete next[sector];
  return next;
}

// ─── Sección ──────────────────────────────────────────────────────────────────

export function TransformadoresConsumoCargaSection() {
  const [mes, setMes]         = useState<string>(mesActual);
  const [tipo, setTipo]       = useState<TipoConsumo>("nuevos");
  const [datos, setDatos]     = useState<ConsumoDatos>({ nuevos: {}, reparados: {} });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [dirty, setDirty]     = useState(false);
  const [existe, setExiste]   = useState(false);

  // Carga el registro del mes seleccionado.
  const cargarMes = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("consumo_transformadores")
        .select("datos")
        .eq("mes", `${m}-01`)
        .maybeSingle();
      if (error) throw error;
      setDatos(data ? normalizarDatos(data.datos) : { nuevos: {}, reparados: {} });
      setExiste(Boolean(data));
      setDirty(false);
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "No se pudo cargar el mes");
      setDatos({ nuevos: {}, reparados: {} });
      setExiste(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargarMes(mes); }, [mes, cargarMes]);

  const bloque = datos[tipo];

  const setValor = (sector: string, pot: number, val: number) => {
    setDatos(prev => ({ ...prev, [tipo]: setCelda(prev[tipo], sector, pot, val) }));
    setDirty(true);
  };

  const totNuevos    = useMemo(() => totalBloque(datos.nuevos),    [datos.nuevos]);
  const totReparados = useMemo(() => totalBloque(datos.reparados), [datos.reparados]);

  const handleGuardar = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("consumo_transformadores")
        .upsert(
          { mes: `${mes}-01`, datos, updated_at: new Date().toISOString() },
          { onConflict: "mes" }
        );
      if (error) throw error;
      toast.success(`Consumo de ${etiquetaMes(mes)} guardado`, { duration: 1500 });
      setExiste(true);
      setDirty(false);
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleLimpiar = () => {
    setDatos({ nuevos: {}, reparados: {} });
    setDirty(true);
  };

  const groupHeaderCls = "text-center text-[9px] font-bold tracking-[.08em] uppercase py-1 rounded-t-md";
  const colHeaderCls   = "text-center text-[9px] font-semibold tracking-[.03em] text-foreground";

  return (
    <div className="rounded-xl border border-border bg-secondary/30 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap px-5 py-2 border-b border-border">
        <div className="text-[12px] text-muted-foreground flex items-center gap-1.5 flex-wrap min-w-0">
          <span>Transformadores entregados · mes</span>
          <input
            type="month"
            value={mes}
            onChange={e => setMes(e.target.value)}
            className="bg-panel-input border border-border rounded-md px-2 py-1 text-[12px] text-foreground focus:outline-none focus:border-accent"
          />
          {loading
            ? <span className="flex items-center gap-1 text-[11px]"><Loader2 className="w-3 h-3 animate-spin" /> cargando…</span>
            : existe
              ? <span className="text-[11px] text-accent-green">· ya cargado</span>
              : <span className="text-[11px] text-muted-foreground/60">· sin datos</span>}
        </div>

        {/* Alternador Nuevos / Reparados */}
        <div className="flex items-center gap-1 rounded-[7px] border border-border bg-panel-input p-0.5 shrink-0">
          {(["nuevos", "reparados"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTipo(t)}
              className={cn(
                "px-3 py-1 rounded-[5px] text-[11.5px] font-semibold capitalize transition-colors",
                tipo === t
                  ? "bg-accent/20 text-accent-green"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Grilla */}
      <div className="overflow-x-auto">
        <div className="min-w-[1120px]">

          {/* Encabezado sticky */}
          <div className="sticky top-0 z-10 bg-panel-header/95 backdrop-blur border-b border-border pt-1.5">
            <div className="grid px-5" style={{ gridTemplateColumns: GRID_COLS }}>
              <div />
              <div
                className={cn(groupHeaderCls, "bg-accent/15 text-accent-green")}
                style={{ gridColumn: `2/${POT_CONSUMO.length + 2}` }}
              >
                Cantidades por potencia (kVA) — {tipo}
              </div>
              <div />
            </div>
            <div className="grid px-5 pt-1 pb-1" style={{ gridTemplateColumns: GRID_COLS }}>
              <div className={cn(colHeaderCls, "text-left font-bold")}>Sector</div>
              {POT_CONSUMO.map(p => <div key={p} className={colHeaderCls}>{p}</div>)}
              <div className={cn(colHeaderCls, "font-bold text-accent-green")}>Total</div>
            </div>
          </div>

          {/* Filas */}
          {SECTORES.map((sector, i) => {
            const tot = totalSector(bloque, sector);
            const zonaA = SECTORES_ZONA_A.includes(sector);
            return (
              <div
                key={sector}
                className={cn(
                  "grid items-center px-5 py-px border-t border-hairline transition-colors hover:bg-secondary/40",
                  i % 2 === 1 && "bg-secondary/15",
                  tot > 0 && "bg-accent/[0.06]"
                )}
                style={{ gridTemplateColumns: GRID_COLS }}
              >
                <div className="flex items-center gap-1.5 min-w-0 pr-2">
                  {zonaA && (
                    <span className="text-[8px] font-bold text-muted-foreground/50 tracking-wider shrink-0">
                      A
                    </span>
                  )}
                  <span className="text-[11px] font-semibold text-foreground truncate">{sector}</span>
                </div>

                {POT_CONSUMO.map(p => (
                  <div key={p} className="px-1">
                    <EInput
                      val={bloque[sector]?.[String(p)] ?? 0}
                      onChange={v => setValor(sector, p, v)}
                    />
                  </div>
                ))}

                <div className={cn(
                  "text-center text-[12px] font-bold tabular-nums",
                  tot > 0 ? "text-accent-green" : "text-muted-foreground/40"
                )}>
                  {tot || "–"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-4 flex-wrap px-5 py-3 border-t border-border">
        <div className="flex items-center gap-6 text-[12px] text-muted-foreground">
          <span>Nuevos: <strong className="text-foreground text-[15px] tabular-nums ml-0.5">{totNuevos}</strong></span>
          <span>Reparados: <strong className="text-foreground text-[15px] tabular-nums ml-0.5">{totReparados}</strong></span>
          <span>Total: <strong className="text-accent-green text-[15px] tabular-nums ml-0.5">{totNuevos + totReparados}</strong></span>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleLimpiar}
            className="flex items-center gap-1.5 px-4 py-2 rounded-[7px] border border-destructive/40 text-accent-red text-[12px] font-semibold hover:bg-destructive/10 transition-colors"
          >
            <Eraser className="w-3.5 h-3.5" /> Limpiar
          </button>
          <button
            onClick={handleGuardar}
            disabled={saving || !dirty}
            className="flex items-center gap-2 px-[18px] py-2 rounded-[7px] bg-accent text-accent-foreground text-[12px] font-bold hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {saving
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando…</>
              : <><CheckCircle2 className="w-3.5 h-3.5" /> Guardar cambios</>}
          </button>
        </div>
      </div>
    </div>
  );
}
