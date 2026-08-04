"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { Loader2, TrendingUp, CalendarRange, Sigma, Boxes, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, Legend,
} from "recharts";
import {
  POT_CONSUMO,
  SECTORES,
  TIPOS_CONSUMO,
  NOMBRES_MESES,
  aniosDisponibles,
  normalizarDatos,
  serieMensual,
  promedios,
  totalesPorPotencia,
  totalesPorSector,
  formatPromedio,
  etiquetaMes,
  type ConsumoMes,
  type FiltroConsumo,
  type FiltroPeriodo,
  type PuntoAgregado,
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

// ─── Gráficos ─────────────────────────────────────────────────────────────────

/**
 * Recharts pinta los colores como atributos SVG, donde `var(--token)` no
 * resuelve. Para no clavar literales de color en el componente —y que los
 * gráficos sigan al tema— se leen los tokens una sola vez y se pasan ya
 * resueltos. Los `--chart-*` no cambian entre claro y oscuro, así que alcanza
 * con leerlos al montar.
 */
const TOKENS_GRAFICO = [
  "--chart-1", "--chart-5", "--accent-green", "--hairline", "--muted-foreground", "--panel-2",
] as const;

type Paleta = Record<(typeof TOKENS_GRAFICO)[number], string>;

function usePaleta(): Paleta | null {
  const [paleta, setPaleta] = useState<Paleta | null>(null);
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    setPaleta(Object.fromEntries(
      TOKENS_GRAFICO.map(t => [t, cs.getPropertyValue(t).trim()])
    ) as Paleta);
  }, []);
  return paleta;
}

/** Alto del área de ploteo, igual en los tres gráficos. */
const ALTO_GRAFICO = 260;

/** Alto que suman los dos gráficos de barras para sus etiquetas en diagonal. */
const ALTO_EJE_X_ROTADO = 104;

const ejeTick = (p: Paleta, fontSize = 11) => ({ fontSize, fill: p["--muted-foreground"] });

/** Rótulo vertical del eje Y. */
const rotuloEjeY = (p: Paleta, value: string) => ({
  value,
  angle: -90 as const,
  position: "insideLeft" as const,
  style: { fill: p["--muted-foreground"], fontSize: 11, textAnchor: "middle" as const },
});

/**
 * Etiquetas de categoría en diagonal, compartidas por los dos gráficos de
 * barras. Los nombres de sector no entran en horizontal, y las potencias van
 * igual —con su "kVA" en cada tick— para que el par se lea como una sola cosa.
 */
const ejeXRotado = (p: Paleta) => ({
  tick: ejeTick(p, 10),
  axisLine: false,
  tickLine: false,
  interval: 0 as const,
  angle: -45,
  textAnchor: "end" as const,
  height: ALTO_EJE_X_ROTADO,
});

const estiloTooltip = (p: Paleta) => ({
  contentStyle: {
    background: p["--panel-2"],
    border: `1px solid ${p["--hairline"]}`,
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: p["--muted-foreground"] },
  itemStyle: { color: p["--accent-green"] },
});

/**
 * Las barras muestran el total del período, que depende de cuántos meses entren.
 * El promedio mensual va en el tooltip para poder comparar contra el KPI sin
 * cambiar la escala del gráfico cada vez que se toca el filtro de año.
 */
const formatearAgregado = (
  valor: number,
  _nombre: string,
  item: { payload?: PuntoAgregado }
): [string, string] => [
  `${valor} · ${formatPromedio(item.payload?.promedio ?? 0)} por mes`,
  "Consumo",
];

function PanelGrafico({
  title, subtitle, children, className,
}: {
  title: string; subtitle: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("rounded-[14px] border border-hairline bg-panel-2 p-5", className)}>
      <p className="text-[13px] font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** Mensaje centrado con el alto del gráfico, para que el panel no cambie de tamaño. */
function SinDatosGrafico({ alto, children }: { alto: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center text-[12px] text-muted-foreground" style={{ height: alto }}>
      {children}
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
  const [anio, setAnio]         = useState<string>(TODOS);
  const [mesDelAnio, setMesDelAnio] = useState<string>(TODOS);
  const [detalleAbierto, setDetalleAbierto] = useState(false);

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

  const periodo: FiltroPeriodo = useMemo(() => ({
    anio:       anio       === TODOS ? undefined : Number(anio),
    mesDelAnio: mesDelAnio === TODOS ? undefined : Number(mesDelAnio),
  }), [anio, mesDelAnio]);

  const anios = useMemo(() => aniosDisponibles(registros), [registros]);
  const serie = useMemo(() => serieMensual(registros, filtro, periodo), [registros, filtro, periodo]);
  const prom  = useMemo(() => promedios(serie), [serie]);

  const paleta      = usePaleta();
  const porPotencia = useMemo(() => totalesPorPotencia(registros, filtro, periodo), [registros, filtro, periodo]);
  const porSector   = useMemo(() => totalesPorSector(registros, filtro, periodo),   [registros, filtro, periodo]);

  // Recharts lee las etiquetas del propio dato, así que el mes va ya formateado.
  const serieGrafico = useMemo(
    () => serie.map(p => ({ ...p, etiqueta: etiquetaMes(p.mes) })),
    [serie]
  );

  const rango = useMemo(() => {
    if (serie.length === 0) return "sin datos";
    const desde = etiquetaMes(serie[0].mes);
    const hasta = etiquetaMes(serie[serie.length - 1].mes);
    return desde === hasta ? desde : `${desde} → ${hasta}`;
  }, [serie]);

  const hayFiltro =
    tipo !== TODOS || potencia !== TODOS || sector !== TODOS ||
    anio !== TODOS || mesDelAnio !== TODOS;

  // Anualizar un único mes del año no significa nada: doce eneros no son un año.
  const anualizable = mesDelAnio === TODOS;

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
          <Select value={anio} onValueChange={setAnio}>
            <SelectTrigger size="sm" className="w-[134px] text-[12px]">
              <SelectValue placeholder="Año" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos los años</SelectItem>
              {anios.map(a => (
                <SelectItem key={a} value={String(a)}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={mesDelAnio} onValueChange={setMesDelAnio}>
            <SelectTrigger size="sm" className="w-[136px] text-[12px]">
              <SelectValue placeholder="Mes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos los meses</SelectItem>
              {NOMBRES_MESES.map((n, i) => (
                <SelectItem key={n} value={String(i + 1)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>

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
          <div className={cn(
            "grid gap-3 p-5 sm:grid-cols-2",
            anualizable ? "xl:grid-cols-4" : "xl:grid-cols-3"
          )}>
            <Kpi
              icon={TrendingUp}
              label={anualizable
                ? "Promedio mensual"
                : `Promedio de ${NOMBRES_MESES[Number(mesDelAnio) - 1]}`}
              valor={formatPromedio(prom.mensual)}
              detalle={anualizable
                ? `sobre ${prom.meses} ${prom.meses === 1 ? "mes" : "meses"} con datos`
                : `sobre ${prom.meses} ${prom.meses === 1 ? "año" : "años"}`}
              acento
            />
            {/* Anualizar un solo mes del año no significa nada, y el promedio
                ya lo cubre el KPI anterior: se omite en vez de duplicarlo. */}
            {anualizable && (
              <Kpi
                icon={CalendarRange}
                label="Promedio anual"
                valor={formatPromedio(prom.anual)}
                detalle="proyección: mensual × 12"
                acento
              />
            )}
            <Kpi
              icon={Sigma}
              label="Total acumulado"
              valor={String(prom.total)}
              detalle={rango}
            />
            <Kpi
              icon={Boxes}
              label={anualizable ? "Meses cargados" : "Años comparados"}
              valor={String(prom.meses)}
              detalle={hayFiltro ? "con el filtro aplicado" : "sin filtros"}
            />
          </div>

          {serie.length === 0 && (
            <p className="px-5 pb-5 -mt-1 text-[11.5px] text-accent-amber">
              No hay meses cargados que coincidan con el período elegido.
            </p>
          )}

          {prom.meses > 0 && prom.total === 0 && (
            <p className="px-5 pb-5 -mt-1 text-[11.5px] text-accent-amber">
              No hay consumo registrado para esta combinación de filtros.
            </p>
          )}

          {/* Gráficos — todos leen la misma serie filtrada que los KPIs */}
          {paleta && (
            <div className="grid gap-3 px-5 pb-5 xl:grid-cols-2">
              <PanelGrafico
                className="xl:col-span-2"
                title="Evolución del consumo"
                subtitle={anualizable
                  ? "Transformadores entregados en cada mes (según filtros)"
                  : `${NOMBRES_MESES[Number(mesDelAnio) - 1]} de cada año (según filtros)`}
              >
                {serieGrafico.length < 2 ? (
                  <SinDatosGrafico alto={ALTO_GRAFICO}>
                    Se necesitan al menos 2 {anualizable ? "meses" : "años"} con datos.
                  </SinDatosGrafico>
                ) : (
                  <ResponsiveContainer width="100%" height={ALTO_GRAFICO}>
                    {/* Ojo: nada de envolver los hijos en <>…</>. Recharts los busca
                        por tipo usando react-is@18, que no reconoce los elementos de
                        React 19: un fragment le llega como un hijo opaco y el gráfico
                        sale vacío, sin líneas ni eje Y. Van sueltos o en un array. */}
                    <LineChart data={serieGrafico} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={paleta["--hairline"]} vertical={false} />
                      <XAxis dataKey="etiqueta" tick={ejeTick(paleta)} axisLine={false} tickLine={false} />
                      {/* Arranca en 0 a propósito: son unidades entregadas, y una
                          escala que no toca el cero exagera las subidas y bajadas. */}
                      <YAxis tick={ejeTick(paleta)} axisLine={false} tickLine={false} allowDecimals={false}
                        domain={[0, "auto"]} label={rotuloEjeY(paleta, "Consumo")} />
                      <ChartTooltip {...estiloTooltip(paleta)} />
                      {tipo === TODOS && <Legend wrapperStyle={{ fontSize: 11 }} />}
                      <Line type="monotone" dataKey="total"
                        name={tipo === TODOS ? "Total" : tipo === "nuevos" ? "Nuevos" : "Reparados"}
                        stroke={paleta["--accent-green"]} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      {/* Con un tipo elegido, `total` YA es ese tipo: agregar las
                          series crudas superpondría una línea idéntica sobre otra. */}
                      {tipo === TODOS && (
                        <Line type="monotone" dataKey="nuevos" name="Nuevos"
                          stroke={paleta["--chart-1"]} strokeWidth={1.5} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                      )}
                      {tipo === TODOS && (
                        <Line type="monotone" dataKey="reparados" name="Reparados"
                          stroke={paleta["--chart-5"]} strokeWidth={1.5} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </PanelGrafico>

              <PanelGrafico title="Consumo por potencia" subtitle={`Total de ${rango} · el tooltip trae el promedio mensual`}>
                {porPotencia.length === 0 ? (
                  <SinDatosGrafico alto={ALTO_GRAFICO + ALTO_EJE_X_ROTADO}>Sin consumo para estos filtros.</SinDatosGrafico>
                ) : (
                  <ResponsiveContainer width="100%" height={ALTO_GRAFICO + ALTO_EJE_X_ROTADO}>
                    <BarChart data={porPotencia} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={paleta["--hairline"]} vertical={false} />
                      {/* `etiqueta` ya trae el "kVA"; el eje va en diagonal igual que el de sector. */}
                      <XAxis dataKey="etiqueta" {...ejeXRotado(paleta)} />
                      <YAxis tick={ejeTick(paleta)} axisLine={false} tickLine={false} allowDecimals={false}
                        label={rotuloEjeY(paleta, "Consumo")} />
                      <ChartTooltip {...estiloTooltip(paleta)} cursor={{ fill: paleta["--hairline"] }}
                        formatter={formatearAgregado} />
                      <Bar dataKey="total" name="Consumo" fill={paleta["--chart-1"]} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </PanelGrafico>

              <PanelGrafico title="Consumo por sector" subtitle="Sectores de entrega, de mayor a menor">
                {porSector.length === 0 ? (
                  <SinDatosGrafico alto={ALTO_GRAFICO + ALTO_EJE_X_ROTADO}>Sin consumo para estos filtros.</SinDatosGrafico>
                ) : (
                  <ResponsiveContainer width="100%" height={ALTO_GRAFICO + ALTO_EJE_X_ROTADO}>
                    <BarChart data={porSector} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={paleta["--hairline"]} vertical={false} />
                      <XAxis dataKey="etiqueta" {...ejeXRotado(paleta)} />
                      <YAxis tick={ejeTick(paleta)} axisLine={false} tickLine={false} allowDecimals={false}
                        label={rotuloEjeY(paleta, "Consumo")} />
                      <ChartTooltip {...estiloTooltip(paleta)} cursor={{ fill: paleta["--hairline"] }}
                        formatter={formatearAgregado} />
                      <Bar dataKey="total" name="Consumo" fill={paleta["--chart-5"]} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </PanelGrafico>
            </div>
          )}

          {/* Detalle mes a mes */}
          <Collapsible open={detalleAbierto} onOpenChange={setDetalleAbierto}>
            <CollapsibleTrigger className="flex w-full items-center gap-1.5 border-t border-border px-5 py-2.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground">
              <ChevronRight
                className={cn("h-3.5 w-3.5 transition-transform", detalleAbierto && "rotate-90")}
              />
              Detalle mensual
              <span className="font-normal text-muted-foreground/60">
                ({serie.length} {serie.length === 1 ? "mes" : "meses"})
              </span>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="max-h-[420px] overflow-y-auto border-t border-hairline">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-panel-header">
                    <TableRow className="border-hairline hover:bg-transparent">
                      <TableHead className="h-8 pl-5 text-[10px] font-semibold uppercase tracking-[.06em] text-foreground">
                        Mes
                      </TableHead>
                      <TableHead className="h-8 text-right text-[10px] font-semibold uppercase tracking-[.06em] text-foreground">
                        Nuevos
                      </TableHead>
                      <TableHead className="h-8 text-right text-[10px] font-semibold uppercase tracking-[.06em] text-foreground">
                        Reparados
                      </TableHead>
                      <TableHead className="h-8 pr-5 text-right text-[10px] font-semibold uppercase tracking-[.06em] text-accent-green">
                        Total
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {serie.map((p, i) => (
                      <TableRow
                        key={p.mes}
                        className={cn(
                          "border-hairline hover:bg-secondary/40",
                          i % 2 === 1 && "bg-secondary/15"
                        )}
                      >
                        <TableCell className="py-1.5 pl-5 text-[12px] font-semibold text-foreground">
                          {etiquetaMes(p.mes)}
                        </TableCell>
                        <TableCell className={cn(
                          "py-1.5 text-right text-[12px] tabular-nums",
                          p.nuevos > 0 ? "text-foreground/80" : "text-muted-foreground/40"
                        )}>
                          {p.nuevos || "–"}
                        </TableCell>
                        <TableCell className={cn(
                          "py-1.5 text-right text-[12px] tabular-nums",
                          p.reparados > 0 ? "text-foreground/80" : "text-muted-foreground/40"
                        )}>
                          {p.reparados || "–"}
                        </TableCell>
                        <TableCell className={cn(
                          "py-1.5 pr-5 text-right text-[13px] font-bold tabular-nums",
                          p.total > 0 ? "text-accent-green" : "text-muted-foreground/40"
                        )}>
                          {p.total || "–"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>

                  <TableFooter className="bg-panel-header">
                    <TableRow className="border-hairline hover:bg-transparent">
                      <TableCell className="py-1.5 pl-5 text-[11px] font-bold uppercase tracking-wide text-foreground/80">
                        Promedio mensual
                      </TableCell>
                      <TableCell colSpan={2} />
                      <TableCell className="py-1.5 pr-5 text-right text-[13px] font-bold tabular-nums text-accent-green">
                        {formatPromedio(prom.mensual)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>

              {tipo !== TODOS && (
                <p className="border-t border-hairline px-5 py-2 text-[11px] text-muted-foreground">
                  Las columnas Nuevos y Reparados muestran siempre su valor real;
                  el filtro de tipo solo afecta la columna Total.
                </p>
              )}
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
    </div>
  );
}
