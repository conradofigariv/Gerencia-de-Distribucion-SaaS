"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { Loader2, TrendingUp, CalendarRange, Sigma, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  POT_CONSUMO,
  SECTORES,
  TIPOS_CONSUMO,
  normalizarDatos,
  serieMensual,
  promedios,
  formatPromedio,
  etiquetaMes,
  type ConsumoMes,
  type FiltroConsumo,
  type TipoConsumo,
} from "@/lib/consumo-transformadores";

const TODOS = "__todos__";

// ─── KPI ──────────────────────────────────────────────────────────────────────

function Kpi({
  icon: Icon, label, valor, detalle, acento,
}: {
  icon: React.ElementType;
  label: string;
  valor: string;
  detalle: string;
  acento?: boolean;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-panel px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <p className={cn(
        "mt-1.5 text-[26px] font-bold leading-none tabular-nums",
        acento ? "text-accent-green" : "text-foreground"
      )}>
        {valor}
      </p>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{detalle}</p>
    </div>
  );
}

// ─── Sección ──────────────────────────────────────────────────────────────────

export function TransformadoresConsumoSection() {
  const [registros, setRegistros] = useState<ConsumoMes[]>([]);
  const [loading, setLoading]     = useState(true);

  const [tipo, setTipo]         = useState<TipoConsumo | typeof TODOS>(TODOS);
  const [potencia, setPotencia] = useState<string>(TODOS);
  const [sector, setSector]     = useState<string>(TODOS);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("consumo_transformadores")
        .select("mes, datos")
        .order("mes", { ascending: true });
      if (error) throw error;
      setRegistros(
        (data ?? []).map(r => ({
          mes: String(r.mes).slice(0, 7),
          datos: normalizarDatos(r.datos),
        }))
      );
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "No se pudo cargar el consumo");
      setRegistros([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const filtro: FiltroConsumo = useMemo(() => ({
    tipo:      tipo     === TODOS ? undefined : tipo,
    potencias: potencia === TODOS ? undefined : [Number(potencia)],
    sectores:  sector   === TODOS ? undefined : [sector],
  }), [tipo, potencia, sector]);

  const serie = useMemo(() => serieMensual(registros, filtro), [registros, filtro]);
  const prom  = useMemo(() => promedios(serie), [serie]);

  const rango = useMemo(() => {
    if (serie.length === 0) return "sin datos";
    const desde = etiquetaMes(serie[0].mes);
    const hasta = etiquetaMes(serie[serie.length - 1].mes);
    return desde === hasta ? desde : `${desde} → ${hasta}`;
  }, [serie]);

  const hayFiltro = tipo !== TODOS || potencia !== TODOS || sector !== TODOS;

  return (
    <div className="rounded-xl border border-border bg-secondary/30 overflow-hidden">

      {/* Filtros */}
      <div className="flex items-center justify-between gap-4 flex-wrap px-5 py-2.5 border-b border-border">
        <div className="flex items-center gap-1 rounded-[7px] border border-border bg-panel-input p-0.5">
          {[TODOS, ...TIPOS_CONSUMO].map(t => (
            <button
              key={t}
              onClick={() => setTipo(t as TipoConsumo | typeof TODOS)}
              className={cn(
                "px-3 py-1 rounded-[5px] text-[11.5px] font-semibold capitalize transition-colors",
                tipo === t
                  ? "bg-accent/20 text-accent-green"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === TODOS ? "Todos" : t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <Select value={potencia} onValueChange={setPotencia}>
            <SelectTrigger size="sm" className="w-[172px] text-[12px]">
              <SelectValue placeholder="Potencia" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas las potencias</SelectItem>
              {POT_CONSUMO.map(p => (
                <SelectItem key={p} value={String(p)}>{p} kVA</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sector} onValueChange={setSector}>
            <SelectTrigger size="sm" className="w-[190px] text-[12px]">
              <SelectValue placeholder="Sector" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos los sectores</SelectItem>
              {SECTORES.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando consumo…
        </div>
      ) : registros.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[13px] font-semibold text-foreground">Todavía no hay consumo cargado</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Cargá un mes desde <span className="text-accent-green">Carga de consumo</span> para ver los promedios.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              icon={TrendingUp}
              label="Promedio mensual"
              valor={formatPromedio(prom.mensual)}
              detalle={`sobre ${prom.meses} ${prom.meses === 1 ? "mes" : "meses"} con datos`}
              acento
            />
            <Kpi
              icon={CalendarRange}
              label="Promedio anual"
              valor={formatPromedio(prom.anual)}
              detalle="proyección: mensual × 12"
              acento
            />
            <Kpi
              icon={Sigma}
              label="Total acumulado"
              valor={String(prom.total)}
              detalle={rango}
            />
            <Kpi
              icon={Boxes}
              label="Meses cargados"
              valor={String(prom.meses)}
              detalle={hayFiltro ? "con el filtro aplicado" : "sin filtros"}
            />
          </div>

          {prom.meses > 0 && prom.total === 0 && (
            <p className="px-5 pb-5 -mt-1 text-[11.5px] text-accent-amber">
              No hay consumo registrado para esta combinación de filtros.
            </p>
          )}
        </>
      )}
    </div>
  );
}
