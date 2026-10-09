"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Plan de Compras — Resumen: lo que el Excel calcula como resultado.
//
// Tres vistas (pestañas §4.7), todas recalculadas en vivo desde Global:
//   • Prioridad          → pestaña «Prioridad» del Excel (por familia).
//   • Por partida        → reemplaza la tabla dinámica de «Resumen».
//   • Cuentas contables  → tabla de cuentas de «Resumen», con la descripción
//                          corregida y el total recalculado vs. el pegado.
// La cuenta vive en lib/planComprasResumen.ts (puro).
//
// Sistema de diseño (confirmado): §4.7 pestañas · §4.8 filtros (plan +
// «A cargo de») · §4.11 tabla CSS grid con encabezado sticky opaco y fila de
// totales · §1 calculado en verde itálica, % negativo en rojo · §4.12 barra de
// estado · §4.25 «Cargando filas». Prioridad editable en la celda. Filtros de
// columna tipo Excel (mismo menú que Carga de datos): los % y los totales se
// recalculan sobre las filas visibles, como el SUBTOTAL del Excel.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { AlertTriangle, FileSpreadsheet, Filter, RefreshCw, X } from "lucide-react";
import { SortArrow, CargandoFilas, type SortDir } from "@/components/dashboard/ido-kit";
import {
  listPlanes, getFamilias, getCuentas, guardarPrioridad, mensajeErrorPlan, calcularFila,
  type PlanCompras, type PlanComprasItem, type PlanFamilia, type PlanCuenta,
} from "@/lib/planCompras";
import {
  filtrarACargo, resumenPrioridad, resumenPartidas, resumenCuentas, descripcionesPartida, claveTexto,
  reproporcionarPrioridad, reproporcionarPartidas, totalesCuentas,
  type FilaCalc, type FilaPrioridad, type FilaPartida, type FilaCuenta,
} from "@/lib/planComprasResumen";
import { FiltroSelect, SelectorPlan } from "./plan-compras-ui";
import {
  cargarItemsPlan, itemsEnCache, planCambio, planesEnCache, guardarPlanesCache, planElegido, recordarPlan,
  extrasEnCache, guardarExtrasCache,
} from "@/lib/planComprasCache";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  MenuFiltroColumna, pasaFiltro, resumenFiltro,
  type FiltroColumna, type ValorFiltro, type OpcionValor,
} from "./plan-compras-filtro-columna";

// ─── Formato ─────────────────────────────────────────────────────────────────

const F_ENT = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const F_CANT = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const F_PCT = new Intl.NumberFormat("es-AR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

const TODOS = "__todos";
const A_CARGO_DEFAULT = "GD";

type Vista = "prioridad" | "partida" | "cuentas";
const VISTAS: { id: Vista; titulo: string }[] = [
  { id: "prioridad", titulo: "Prioridad" },
  { id: "partida",   titulo: "Por partida" },
  { id: "cuentas",   titulo: "Cuentas contables" },
];
const TAB_BUBBLE_TRANSITION = { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };

// ─── Tabla genérica (§4.11) ──────────────────────────────────────────────────

type Formato = "texto" | "codigo" | "ent" | "cant" | "pct";

interface Col<T> {
  id:       string;
  titulo:   string;
  /** Pista de grid: «120px», «minmax(220px, 2fr)». */
  ancho:    string;
  /** Ancho mínimo en px (para el scroll horizontal en pantallas chicas). */
  min:      number;
  formato:  Formato;
  /** Valor calculado (§1): verde itálica. */
  calc?:    boolean;
  tooltip?: string;
  valor:    (f: T) => string | number | null;
  /** Celda a medida (pisa el formato). */
  render?:  (f: T) => ReactNode;
  total?:   ReactNode;
}

type Filtros = Partial<Record<string, FiltroColumna>>;

const esNumCol = <T,>(c: Col<T>) => c.formato !== "texto" && c.formato !== "codigo";

/** Valor de una celda para el filtro de columna (lo que se ve en la tabla). */
function valorFiltroCol<T>(c: Col<T>, f: T): ValorFiltro {
  const v = c.valor(f);
  if (esNumCol(c)) {
    const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
    return { clave: String(n), label: n === 0 ? "–" : celdaNumero(n, c.formato).texto, num: n };
  }
  const t = v == null || v === "" ? null : String(v);
  return t == null ? { clave: "∅", label: "(Vacías)", num: null } : { clave: t, label: t, num: null };
}

/** Filas que pasan los filtros de columna (`excluir`: el de esa columna no cuenta). */
function filtrarFilas<T>(filas: T[], cols: Col<T>[], filtros: Filtros, excluir?: string): T[] {
  const activos = Object.entries(filtros)
    .filter(([id, f]) => f && id !== excluir)
    .map(([id, f]) => ({ col: cols.find((c) => c.id === id), f: f!, set: f!.valores ? new Set(f!.valores) : undefined }))
    .filter((a): a is { col: Col<T>; f: FiltroColumna; set: Set<string> | undefined } => !!a.col);
  if (!activos.length) return filas;
  return filas.filter((r) => activos.every((a) => pasaFiltro(a.f, valorFiltroCol(a.col, r), a.set)));
}

function celdaNumero(v: number | null, formato: Formato): { texto: string; vacio: boolean } {
  if (v == null || v === 0 || !Number.isFinite(v)) return { texto: "–", vacio: true };
  return { texto: formato === "pct" ? F_PCT.format(v) : formato === "cant" ? F_CANT.format(v) : F_ENT.format(v), vacio: false };
}

function Tabla<T>({
  columnas, filas, todas, filtros, onFiltro, clave, total, vacia,
}: {
  columnas: Col<T>[];
  /** Filas visibles (ya filtradas y con los % recalculados). */
  filas: T[];
  /** Todas las filas: de acá salen los valores del menú de filtro. */
  todas: T[];
  filtros: Filtros;
  onFiltro: (id: string, f: FiltroColumna | null) => void;
  clave: (f: T) => string;
  total?: boolean;
  vacia: string;
}) {
  const [orden, setOrden] = useState<{ id: string; dir: SortDir } | null>(null);
  const [menuCol, setMenuCol] = useState<string | null>(null);

  // Valores del menú abierto: de las filas que pasan los DEMÁS filtros, como
  // el autofiltro de Excel.
  const opcionesMenu = useMemo<OpcionValor[]>(() => {
    if (!menuCol) return [];
    const col = columnas.find((c) => c.id === menuCol);
    if (!col) return [];
    const cnt = new Map<string, OpcionValor & { num: number | null }>();
    for (const f of filtrarFilas(todas, columnas, filtros, menuCol)) {
      const v = valorFiltroCol(col, f);
      const o = cnt.get(v.clave);
      if (o) o.n++; else cnt.set(v.clave, { clave: v.clave, label: v.label, n: 1, num: v.num });
    }
    const lista = [...cnt.values()];
    if (esNumCol(col)) lista.sort((a, b) => (a.num ?? 0) - (b.num ?? 0));
    else lista.sort((a, b) => (a.clave === "∅" ? 1 : b.clave === "∅" ? -1 : a.label.localeCompare(b.label, "es")));
    return lista;
  }, [menuCol, columnas, todas, filtros]);

  const activos = columnas.filter((c) => filtros[c.id]);
  // Cada encabezado lleva el embudo de filtro (18px + hueco): se suma a la
  // pista para que el título no se corte.
  const EMBUDO = 22;
  const plantilla = columnas.map((c) => c.ancho.replace(/(\d+)px/, (_, n) => `${Number(n) + EMBUDO}px`)).join(" ");
  const minW = columnas.reduce((s, c) => s + c.min + EMBUDO, 0);

  const ordenadas = useMemo(() => {
    if (!orden) return filas;
    const col = columnas.find((c) => c.id === orden.id);
    if (!col) return filas;
    const s = orden.dir === "asc" ? 1 : -1;
    return [...filas].sort((a, b) => {
      const va = col.valor(a), vb = col.valor(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "es")) * s;
    });
  }, [filas, columnas, orden]);

  // asc → desc → orden del Excel
  const ordenar = (id: string) => setOrden((o) =>
    !o || o.id !== id ? { id, dir: "asc" } : o.dir === "asc" ? { id, dir: "desc" } : null);

  const esNum = esNumCol;
  const labelDe = (c: Col<T>) => (clave: string) =>
    clave === "∅" ? "(Vacías)" : esNum(c) ? (Number(clave) === 0 ? "0" : celdaNumero(Number(clave), c.formato).texto) : clave;

  return (
    <>
    {/* Chips de filtros de columna activos (§4.3) */}
    {activos.length > 0 && (
      <div className="pc-chips">
        <Filter className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--ido-accent)" }} />
        {activos.map((c) => {
          const resumen = resumenFiltro(filtros[c.id]!, labelDe(c));
          return (
            <span key={c.id} className="pc-chip" title={`${c.titulo}: ${resumen}`}>
              <button type="button" className="pc-chip-txt" onClick={() => setMenuCol(c.id)}>
                <b>{c.titulo}</b>: {resumen}
              </button>
              <button type="button" className="pc-chip-x" onClick={() => onFiltro(c.id, null)} aria-label={`Quitar filtro de ${c.titulo}`}>
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}
        <button type="button" className="ido-btn ido-btn-text" style={{ height: 26 }} onClick={() => activos.forEach((c) => onFiltro(c.id, null))}>
          Quitar filtros de columna
        </button>
      </div>
    )}
    <div className="flex-1 min-h-0" style={{ overflow: "auto" }}>
      <div style={{ minWidth: Math.max(minW, 0), minHeight: "100%", display: "flex", flexDirection: "column" }}>
        <div
          className="grid"
          style={{
            gridTemplateColumns: plantilla, height: 36, position: "sticky", top: 0, zIndex: 2,
            background: "var(--ido-header)", borderBottom: "1px solid var(--ido-border-strong)",
          }}
        >
          {columnas.map((c) => {
            const activa = orden?.id === c.id;
            return (
              <div
                key={c.id}
                className={`pc-th ${esNum(c) ? "is-num" : ""} ${activa ? "is-activa" : ""}`}
                onClick={() => ordenar(c.id)}
                title={c.tooltip ?? c.titulo}
              >
                <span className="truncate" style={c.calc ? { fontStyle: "italic" } : undefined}>{c.titulo}</span>
                {activa && <SortArrow active dir={orden.dir} className="w-3 h-3 shrink-0" />}
                <Popover open={menuCol === c.id} onOpenChange={(o) => setMenuCol(o ? c.id : null)}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={`pc-filtro-btn ${filtros[c.id] ? "is-on" : ""}`}
                      onClick={(e) => e.stopPropagation()}
                      title={filtros[c.id] ? `Filtrado: ${resumenFiltro(filtros[c.id]!, labelDe(c))}` : `Filtrar ${c.titulo}`}
                      aria-label={`Filtrar ${c.titulo}`}
                    >
                      <Filter className="w-3 h-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align={esNum(c) ? "end" : "start"}
                    className="ido-terminal ido-pop border-0 p-1 w-[290px] z-[10000]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {menuCol === c.id && (
                      <MenuFiltroColumna
                        titulo={c.titulo}
                        numerica={esNum(c)}
                        opciones={opcionesMenu}
                        filtro={filtros[c.id] ?? null}
                        onAplicar={(f) => onFiltro(c.id, f)}
                        onOrdenar={(dir) => setOrden({ id: c.id, dir })}
                        onCerrar={() => setMenuCol(null)}
                      />
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            );
          })}
        </div>

        {ordenadas.length === 0 ? (
          <div className="ido-loading" style={{ flex: 1, minHeight: 120 }}>{vacia}</div>
        ) : (
          <div style={{ flex: 1 }}>
            {ordenadas.map((f) => (
              <div key={clave(f)} className="grid pcr-fila" style={{ gridTemplateColumns: plantilla }}>
                {columnas.map((c) => {
                  if (c.render) return <div key={c.id} className={`pc-celda ${esNum(c) ? "is-num" : ""}`}>{c.render(f)}</div>;
                  const v = c.valor(f);
                  if (!esNum(c)) {
                    const t = v == null || v === "" ? null : String(v);
                    return (
                      <div key={c.id} className={`pc-celda ${c.formato === "codigo" ? "is-cod" : ""}`} title={t ?? undefined}>
                        <span className={t == null ? "pc-vacio" : undefined}>{t ?? "–"}</span>
                      </div>
                    );
                  }
                  const n = typeof v === "number" ? v : null;
                  const { texto, vacio } = celdaNumero(n, c.formato);
                  const neg = c.formato === "pct" && n != null && n < 0;
                  return (
                    <div key={c.id} className={`pc-celda is-num ${c.calc && !vacio ? "is-calc" : ""} ${neg ? "is-neg" : ""}`}>
                      <span className={vacio ? "pc-vacio" : undefined}>{texto}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {total && ordenadas.length > 0 && (
          <div className="grid pcr-total" style={{ gridTemplateColumns: plantilla }}>
            {columnas.map((c) => (
              <div key={c.id} className={`pc-celda ${esNum(c) ? "is-num" : ""}`}>{c.total ?? null}</div>
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

/** Celda de la fila de totales: número calculado (o texto). */
function Tot({ v, formato = "ent", calc = true }: { v: number | null; formato?: Formato; calc?: boolean }) {
  const { texto, vacio } = celdaNumero(v, formato);
  const neg = formato === "pct" && v != null && v < 0;
  return <span className={vacio ? "pc-vacio" : `${calc ? "pcr-tot-calc" : ""} ${neg ? "is-neg" : ""}`}>{texto}</span>;
}

// ─── Prioridad editable en la celda ──────────────────────────────────────────

function CeldaPrioridad({ valor, onGuardar }: { valor: number | null; onGuardar: (v: number | null) => Promise<void> }) {
  const [editando, setEditando] = useState(false);
  const [txt, setTxt] = useState("");
  const [guardando, setGuardando] = useState(false);
  const cancelado = useRef(false);

  const empezar = () => { setTxt(valor == null ? "" : String(valor)); cancelado.current = false; setEditando(true); };
  const terminar = async () => {
    setEditando(false);
    if (cancelado.current) return;
    const limpio = txt.trim();
    const nuevo = limpio === "" ? null : Number(limpio);
    if (nuevo != null && (!Number.isInteger(nuevo) || nuevo < 0 || nuevo > 99)) {
      toast.error("La prioridad es un número entero (0 a 99).");
      return;
    }
    if (nuevo === valor) return;
    setGuardando(true);
    try { await onGuardar(nuevo); } finally { setGuardando(false); }
  };

  if (editando) {
    return (
      <input
        autoFocus
        className="pcr-edit"
        inputMode="numeric"
        maxLength={2}
        value={txt}
        onChange={(e) => setTxt(e.target.value.replace(/\D/g, ""))}
        onBlur={() => void terminar()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { cancelado.current = true; (e.target as HTMLInputElement).blur(); }
        }}
        aria-label="Prioridad"
      />
    );
  }
  return (
    <button
      type="button"
      className="pcr-editable"
      onClick={empezar}
      title="Clic para cambiar la prioridad"
      style={guardando ? { opacity: 0.5 } : undefined}
    >
      {valor == null ? <span className="pc-vacio">–</span> : valor}
    </button>
  );
}

// ─── Sección ─────────────────────────────────────────────────────────────────

export function PlanComprasResumenSection() {
  const [planes, setPlanes] = useState<PlanCompras[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [items, setItems] = useState<PlanComprasItem[]>([]);
  const [familias, setFamilias] = useState<PlanFamilia[]>([]);
  const [cuentas, setCuentas] = useState<PlanCuenta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [progreso, setProgreso] = useState<{ n: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("prioridad");
  const [aCargo, setACargo] = useState<string>(A_CARGO_DEFAULT);

  const plan = useMemo(() => planes.find((p) => p.id === planId) ?? null, [planes, planId]);

  const pedido = useRef(0);
  /**
   * Si el plan ya está en memoria (se abrió antes en Carga de datos o acá)
   * aparece al instante y se revalida en segundo plano; `forzar` (Actualizar)
   * va siempre a la base. Ver lib/planComprasCache.ts.
   */
  const cargar = useCallback(async (preferido?: string, forzar = false) => {
    const yo = ++pedido.current;
    setError(null);
    setProgreso(null);
    const traerExtras = async (id: string) => {
      const [fams, cts] = await Promise.all([getFamilias(id), getCuentas(id)]);
      guardarExtrasCache(id, { familias: fams, cuentas: cts });
      return { fams, cts };
    };

    // ── Camino rápido: caché ────────────────────────────────────────────────
    const psCache = planesEnCache();
    const pid = preferido ?? planElegido() ?? psCache?.[0]?.id ?? null;
    const enCache = !forzar && psCache && pid && psCache.some((p) => p.id === pid) ? itemsEnCache(pid) : null;
    if (enCache && psCache && pid) {
      const ex = extrasEnCache(pid);
      setPlanes(psCache);
      setPlanId(pid);
      recordarPlan(pid);
      setItems(enCache.items);
      if (ex) { setFamilias(ex.familias); setCuentas(ex.cuentas); }
      setCargando(!ex);
      try {
        const [ps, cambio, extrasNuevos] = await Promise.all([listPlanes(), planCambio(pid), traerExtras(pid)]);
        if (yo !== pedido.current) return;
        guardarPlanesCache(ps);
        setPlanes(ps);
        setFamilias(extrasNuevos.fams);
        setCuentas(extrasNuevos.cts);
        setCargando(false);
        if (!ps.some((p) => p.id === pid)) { void cargar(undefined, true); return; }
        if (cambio) {
          const r = await cargarItemsPlan(pid);
          if (yo !== pedido.current) return;
          setItems(r.items);
          toast.info("El plan tenía cambios hechos desde otra sesión: se actualizó.", { id: "pc-revalidado" });
        }
      } catch (e) {
        if (yo === pedido.current && !ex) setError(mensajeErrorPlan(e));
        if (yo === pedido.current) setCargando(false);
      }
      return;
    }

    // ── Camino normal: base ─────────────────────────────────────────────────
    setCargando(true);
    try {
      const ps = await listPlanes();
      if (yo !== pedido.current) return;
      guardarPlanesCache(ps);
      setPlanes(ps);
      const elegido = ps.find((p) => p.id === (preferido ?? planElegido())) ?? ps[0] ?? null;
      setPlanId(elegido?.id ?? null);
      recordarPlan(elegido?.id ?? null);
      if (!elegido) { setItems([]); setFamilias([]); setCuentas([]); return; }
      const [r, ex] = await Promise.all([
        cargarItemsPlan(elegido.id, (n, total) => { if (yo === pedido.current) setProgreso({ n, total }); }),
        traerExtras(elegido.id),
      ]);
      if (yo !== pedido.current) return;
      setItems(r.items);
      setFamilias(ex.fams);
      setCuentas(ex.cts);
    } catch (e) {
      if (yo === pedido.current) setError(mensajeErrorPlan(e));
    } finally {
      if (yo === pedido.current) { setCargando(false); setProgreso(null); }
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  // Prioridad editada acá → la caché queda al día para la próxima entrada.
  useEffect(() => {
    if (planId && !cargando) guardarExtrasCache(planId, { familias, cuentas });
  }, [planId, familias, cuentas, cargando]);

  // ── Cálculo ────────────────────────────────────────────────────────────────
  const filas = useMemo<FilaCalc[]>(() => {
    if (!plan) return [];
    const p = { tipo_cambio: plan.tipo_cambio, pct_mayoracion: plan.pct_mayoracion };
    return items.map((it) => ({ it, calc: calcularFila(it, p) }));
  }, [items, plan]);

  const opcionesACargo = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const { it } of filas) {
      const label = String(it.a_cargo_de ?? "").trim();
      if (!label) continue;
      const k = claveTexto(label);
      const e = m.get(k) ?? { label, n: 0 };
      e.n++;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n).map((e) => ({ v: e.label, label: e.label, n: e.n }));
  }, [filas]);

  // Un plan sin «GD» (o con otro nombre) no tiene que quedar vacío por el default.
  useEffect(() => {
    if (aCargo !== TODOS && opcionesACargo.length > 0 && !opcionesACargo.some((o) => claveTexto(o.v) === claveTexto(aCargo))) {
      setACargo(TODOS);
    }
  }, [opcionesACargo, aCargo]);

  const filtradas = useMemo(() => filtrarACargo(filas, aCargo === TODOS ? null : aCargo), [filas, aCargo]);
  const descripciones = useMemo(() => descripcionesPartida(filas), [filas]);
  const prioridadBase = useMemo(() => resumenPrioridad(filtradas, familias), [filtradas, familias]);
  const partidasBase = useMemo(() => resumenPartidas(filtradas, descripciones), [filtradas, descripciones]);
  const ctasBase = useMemo(() => resumenCuentas(cuentas, partidasBase, descripciones), [cuentas, partidasBase, descripciones]);

  // Filtros de columna, uno por pestaña (cambiar de pestaña no los pierde).
  const [filtrosVista, setFiltrosVista] = useState<Record<Vista, Filtros>>({ prioridad: {}, partida: {}, cuentas: {} });
  const onFiltro = (v: Vista) => (id: string, f: FiltroColumna | null) =>
    setFiltrosVista((prev) => {
      const next = { ...prev[v] };
      if (f) next[id] = f; else delete next[id];
      return { ...prev, [v]: next };
    });

  const tc = plan?.tipo_cambio ?? 0;
  const usd = (v: number) => (tc > 0 ? v / tc : null);
  const etq = (k: "total_plan" | "total_ajustado", fallback: string) => plan?.etiquetas?.[k] ?? fallback;
  const tituloTotal = etq("total_plan", "Total $");
  const tituloAjustado = etq("total_ajustado", "Total Ajustado $");
  const filtroTxt = aCargo === TODOS ? "todas las filas" : `«A cargo de» = ${aCargo}`;

  // ── Guardar prioridad ──────────────────────────────────────────────────────
  const onPrioridad = async (f: FilaPrioridad, valor: number | null) => {
    if (!planId) return;
    const antes = familias;
    setFamilias((fs) => fs.some((x) => x.familia === f.familia)
      ? fs.map((x) => (x.familia === f.familia ? { ...x, prioridad: valor } : x))
      : [...fs, { familia: f.familia, prioridad: valor, orden: f.orden }]);
    try {
      await guardarPrioridad(planId, f.familia, valor, f.orden);
    } catch (e) {
      setFamilias(antes);
      toast.error(`No se guardó la prioridad: ${mensajeErrorPlan(e)}`);
    }
  };

  // ── Columnas ───────────────────────────────────────────────────────────────
  // Las columnas reciben el resumen VISIBLE (con filtros de columna) para la
  // fila de totales; el filtro usa solo `valor`, que no depende de eso.
  const colsPrioridad = (prioridad: { total: ReturnType<typeof reproporcionarPrioridad>["total"] }): Col<FilaPrioridad>[] => [
    {
      id: "familia", titulo: "Familia", ancho: "minmax(220px, 2.2fr)", min: 220, formato: "texto", valor: (f) => f.familia,
      render: (f) => (
        <span className="flex items-center gap-2 min-w-0">
          <span className="truncate" title={f.familia}>{f.familia}</span>
          {!f.enExcel && <span className="ido-chip ido-badge-neutral shrink-0" title="Tiene filas en Global pero no estaba en la tabla Prioridad del Excel">No estaba en Prioridad</span>}
        </span>
      ),
      total: <span style={{ fontWeight: 600 }}>Total</span>,
    },
    {
      id: "prioridad", titulo: "Prioridad", ancho: "88px", min: 88, formato: "ent", valor: (f) => f.prioridad,
      tooltip: "Prioridad de la familia (0 a 99). Clic en la celda para cambiarla.",
      render: (f) => <CeldaPrioridad valor={f.prioridad} onGuardar={(v) => onPrioridad(f, v)} />,
    },
    {
      id: "matriculas", titulo: "Matrículas", ancho: "100px", min: 100, formato: "ent", calc: true, valor: (f) => f.matriculas,
      tooltip: "Matrículas de la familia con GD > 0 (CONTAR.SI.CONJUNTO del Excel)", total: <Tot v={prioridad.total.matriculas} />,
    },
    {
      id: "gd", titulo: "Total GD $", ancho: "minmax(140px, 1fr)", min: 140, formato: "ent", calc: true, valor: (f) => f.totalGd,
      tooltip: `Suma de «${tituloTotal}» de la familia`, total: <Tot v={prioridad.total.totalGd} />,
    },
    {
      id: "gd_usd", titulo: "Total GD USD", ancho: "minmax(120px, 0.9fr)", min: 120, formato: "ent", calc: true, valor: (f) => usd(f.totalGd),
      tooltip: "Total GD $ / TC del plan", total: <Tot v={usd(prioridad.total.totalGd)} />,
    },
    {
      id: "pct", titulo: "%", ancho: "76px", min: 76, formato: "pct", calc: true, valor: (f) => f.pctGd,
      tooltip: "Total GD $ de la familia / Total GD $", total: <Tot v={prioridad.total.totalGd ? 1 : null} formato="pct" />,
    },
    {
      id: "ap", titulo: "Total Aprobado $", ancho: "minmax(140px, 1fr)", min: 140, formato: "ent", calc: true, valor: (f) => f.totalAprobado,
      tooltip: `Suma de «${tituloAjustado}» de la familia`, total: <Tot v={prioridad.total.totalAprobado} />,
    },
    {
      id: "ap_usd", titulo: "Total Aprobado USD", ancho: "minmax(150px, 0.9fr)", min: 150, formato: "ent", calc: true, valor: (f) => usd(f.totalAprobado),
      tooltip: "Total Aprobado $ / TC del plan", total: <Tot v={usd(prioridad.total.totalAprobado)} />,
    },
    {
      id: "pct_aj", titulo: "% Aj.", ancho: "76px", min: 76, formato: "pct", calc: true, valor: (f) => f.pctAprobado,
      tooltip: "Total Aprobado $ de la familia / Total Aprobado $", total: <Tot v={prioridad.total.totalAprobado ? 1 : null} formato="pct" />,
    },
    {
      id: "dif", titulo: "GD vs. aprobado", ancho: "120px", min: 120, formato: "pct", calc: true, valor: (f) => f.gdVsAprobado,
      tooltip: "Total GD $ / Total Aprobado $ − 1. En el Excel la columna se llama «Respecto Año pasado».",
      total: <Tot v={prioridad.total.gdVsAprobado} formato="pct" />,
    },
  ];

  const colsPartida = (partidas: { total: ReturnType<typeof reproporcionarPartidas>["total"] }): Col<FilaPartida>[] => [
    {
      id: "partida", titulo: "Partida", ancho: "128px", min: 128, formato: "codigo", valor: (f) => f.partida || null,
      total: <span style={{ fontWeight: 600 }}>Total</span>,
    },
    {
      id: "descripcion", titulo: "Descripción", ancho: "minmax(220px, 2fr)", min: 220, formato: "texto",
      valor: (f) => (f.partida ? f.descripcion || null : "(Sin partida)"),
    },
    {
      id: "matriculas", titulo: "Matrículas", ancho: "100px", min: 100, formato: "ent", calc: true, valor: (f) => f.matriculas,
      tooltip: "Matrículas con cantidad aprobada", total: <Tot v={partidas.total.matriculas} />,
    },
    {
      id: "cant", titulo: "Cant. aprobadas", ancho: "minmax(120px, 0.8fr)", min: 120, formato: "cant", calc: true, valor: (f) => f.cantAprobadas,
      total: <Tot v={partidas.total.cantAprobadas} formato="cant" />,
    },
    {
      id: "gd", titulo: tituloTotal, ancho: "minmax(140px, 1fr)", min: 140, formato: "ent", calc: true, valor: (f) => f.totalGd,
      total: <Tot v={partidas.total.totalGd} />,
    },
    {
      id: "aj", titulo: tituloAjustado, ancho: "minmax(150px, 1fr)", min: 150, formato: "ent", calc: true, valor: (f) => f.totalAjustado,
      total: <Tot v={partidas.total.totalAjustado} />,
    },
    {
      id: "aj_usd", titulo: "Ajustado USD", ancho: "minmax(120px, 0.9fr)", min: 120, formato: "ent", calc: true, valor: (f) => usd(f.totalAjustado),
      tooltip: `${tituloAjustado} / TC del plan`, total: <Tot v={usd(partidas.total.totalAjustado)} />,
    },
    {
      id: "pct", titulo: "%", ancho: "76px", min: 76, formato: "pct", calc: true, valor: (f) => f.pctAjustado,
      tooltip: `${tituloAjustado} de la partida / total`, total: <Tot v={partidas.total.totalAjustado ? 1 : null} formato="pct" />,
    },
  ];

  const colsCuentas = (ctas: { total: ReturnType<typeof totalesCuentas> }): Col<FilaCuenta>[] => [
    {
      id: "cuenta", titulo: "Cuenta", ancho: "minmax(240px, 1.6fr)", min: 240, formato: "codigo", valor: (f) => f.cuenta,
      total: <span style={{ fontWeight: 600 }}>Total</span>,
    },
    { id: "partida", titulo: "Partida", ancho: "128px", min: 128, formato: "codigo", valor: (f) => f.partida, tooltip: "EXTRAE(cuenta; 6; 12)" },
    {
      id: "descripcion", titulo: "Descripción de partida", ancho: "minmax(200px, 1.4fr)", min: 200, formato: "texto", valor: (f) => f.descripcion,
      tooltip: "Sale de Global (en el Excel el BUSCARV apunta a columnas corridas y da #N/A)",
    },
    {
      id: "excel", titulo: "Total Excel $", ancho: "minmax(140px, 1fr)", min: 140, formato: "ent", valor: (f) => f.totalExcel,
      tooltip: "Total como quedó pegado en el Excel", total: <Tot v={ctas.total.totalExcel} calc={false} />,
    },
    {
      id: "calc", titulo: "Total calculado $", ancho: "minmax(150px, 1fr)", min: 150, formato: "ent", calc: true, valor: (f) => f.totalCalc,
      tooltip: `${tituloAjustado} de Global para esa partida (${filtroTxt})`,
      render: (f) => f.repiteDe != null
        ? <span className="pc-texto-calc truncate" title="La misma partida ya se sumó en una cuenta anterior">misma partida que la fila {f.repiteDe}</span>
        : <NumCalc v={f.totalCalc} />,
      total: <Tot v={ctas.total.totalCalc} />,
    },
    {
      id: "dif", titulo: "Diferencia $", ancho: "minmax(140px, 1fr)", min: 140, formato: "ent", calc: true, valor: (f) => f.diferencia,
      tooltip: "Total Excel − Total calculado",
      render: (f) => <NumCalc v={f.diferencia} signo />,
      total: <NumCalc v={ctas.total.totalExcel - ctas.total.totalCalc} signo />,
    },
  ];

  // ── Filas visibles (filtros de columna) ────────────────────────────────────
  const fPri = filtrosVista.prioridad, fPar = filtrosVista.partida, fCta = filtrosVista.cuentas;
  const hayF = (f: Filtros) => Object.values(f).some(Boolean);
  const prioridad = hayF(fPri) ? reproporcionarPrioridad(filtrarFilas(prioridadBase.filas, colsPrioridad(prioridadBase), fPri)) : prioridadBase;
  const partidas = hayF(fPar) ? reproporcionarPartidas(filtrarFilas(partidasBase.filas, colsPartida(partidasBase), fPar)) : partidasBase;
  const ctasFilas = hayF(fCta) ? filtrarFilas(ctasBase.filas, colsCuentas(ctasBase), fCta) : ctasBase.filas;
  const ctas = { ...ctasBase, filas: ctasFilas, total: hayF(fCta) ? totalesCuentas(ctasFilas) : ctasBase.total };
  const deN = (vis: number, todas: number) => (vis === todas ? `${vis}` : `${vis} de ${todas}`);

  // ── Render ─────────────────────────────────────────────────────────────────
  const vacio = !cargando && !error && !plan;
  const fecha = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const bubble = <motion.span layoutId="pc-resumen-tab-bubble" className="ido-dtab-bubble" transition={TAB_BUBBLE_TRANSITION} />;

  return (
    <div className="ido-terminal flex flex-col h-[calc(100vh-96px)] sm:h-[calc(100vh-112px)] min-h-[360px]">
      <div className="ido-card flex flex-col flex-1 min-h-0">
        {/* ── Toolbar + filtros (§4.8) ─────────────────────────────────────── */}
        <div className="ido-toolbar" style={{ padding: "10px 16px", gap: 8 }}>
          <SelectorPlan planes={planes} planId={planId} onChange={(id) => { if (id !== planId) cargar(id); }} />
          {plan && (
            <span className="ido-chipbtn shrink-0" style={{ cursor: "default" }} title="Tipo de cambio del plan ($ por USD): los totales en USD son $ / TC">
              TC <b>{F_CANT.format(plan.tipo_cambio)}</b>
            </span>
          )}
          {plan && (
            <>
              <span className="ido-divider" />
              <FiltroSelect value={aCargo} onChange={setACargo} opciones={opcionesACargo} todos="A cargo de: todos" ancho={220} />
            </>
          )}
          <div className="flex items-center gap-2" style={{ marginLeft: "auto" }}>
            <button type="button" className="ido-btn ido-btn-text" style={{ height: 32 }} onClick={() => cargar(planId ?? undefined, true)} disabled={cargando}>
              <RefreshCw className={`w-3.5 h-3.5${cargando ? " animate-spin" : ""}`} />Actualizar
            </button>
          </div>
        </div>

        {/* ── Pestañas (§4.7) ─────────────────────────────────────────────── */}
        {plan && !error && (
          <div className="ido-tabbar" style={{ padding: "8px 16px", marginBottom: 0 }}>
            {VISTAS.map((v) => (
              <button key={v.id} type="button" className={`ido-dtab${vista === v.id ? " is-active" : ""}`} onClick={() => setVista(v.id)}>
                {vista === v.id && bubble}
                <span>{v.titulo}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Cuerpo ─────────────────────────────────────────────────────── */}
        {error ? (
          <div className="ido-loading" style={{ flexDirection: "column", gap: 10, flex: 1, textAlign: "center", padding: "0 24px" }}>
            <AlertTriangle className="w-5 h-5" style={{ color: "var(--ido-warning)" }} />
            <span style={{ maxWidth: 520 }}>{error}</span>
            <button type="button" className="ido-btn ido-btn-ghost" style={{ height: 32 }} onClick={() => cargar(planId ?? undefined, true)}>
              Reintentar
            </button>
          </div>
        ) : cargando ? (
          <CargandoFilas texto={progreso ? "Cargando filas…" : "Cargando plan…"} n={progreso?.n} total={progreso?.total} style={{ flex: 1 }} />
        ) : vacio ? (
          <div className="ido-loading" style={{ flexDirection: "column", gap: 10, flex: 1, textAlign: "center", padding: "0 24px" }}>
            <FileSpreadsheet className="w-6 h-6" style={{ color: "var(--ido-text-2)" }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ido-text)" }}>Todavía no hay un plan cargado</span>
            <span style={{ maxWidth: 460, fontSize: 13, color: "var(--ido-text-2)" }}>
              Importalo desde Plan de Compras → Carga de datos.
            </span>
          </div>
        ) : vista === "prioridad" ? (
          <>
            <Tabla
              columnas={colsPrioridad(prioridad)} filas={prioridad.filas} todas={prioridadBase.filas}
              filtros={fPri} onFiltro={onFiltro("prioridad")}
              clave={(f) => f.familia} total vacia={hayF(fPri) ? "Ninguna familia pasa los filtros." : "No hay familias en este plan."}
            />
            <div className="pc-estado">
              <span>Total GD $: <b>$ {F_ENT.format(prioridad.total.totalGd)}</b>{tc > 0 && <> · USD <b>{F_ENT.format(prioridad.total.totalGd / tc)}</b></>}</span>
              <span>Total Aprobado $: <b>$ {F_ENT.format(prioridad.total.totalAprobado)}</b>{tc > 0 && <> · USD <b>{F_ENT.format(prioridad.total.totalAprobado / tc)}</b></>}</span>
              {prioridad.total.totalGd > 0 && (
                <span title="Total Aprobado $ / Total GD $ − 1">Ajuste: <b>{F_PCT.format(prioridad.total.totalAprobado / prioridad.total.totalGd - 1)}</b></span>
              )}
              <span style={{ marginLeft: "auto" }}><b>{deN(prioridad.filas.length, prioridadBase.filas.length)}</b> familias · {filtroTxt}</span>
              <span className="pc-estado-dim">Importado {fecha(plan!.importado_at)}</span>
            </div>
          </>
        ) : vista === "partida" ? (
          <>
            <Tabla
              columnas={colsPartida(partidas)} filas={partidas.filas} todas={partidasBase.filas}
              filtros={fPar} onFiltro={onFiltro("partida")}
              clave={(f) => f.partida || "∅"} total vacia={hayF(fPar) ? "Ninguna partida pasa los filtros." : "No hay filas con este filtro."}
            />
            <div className="pc-estado">
              <span>{tituloAjustado}: <b>$ {F_ENT.format(partidas.total.totalAjustado)}</b>{tc > 0 && <> · USD <b>{F_ENT.format(partidas.total.totalAjustado / tc)}</b></>}</span>
              <span>Cant. aprobadas: <b>{F_CANT.format(partidas.total.cantAprobadas)}</b></span>
              <span style={{ marginLeft: "auto" }}><b>{deN(partidas.filas.length, partidasBase.filas.length)}</b> partidas · {filtroTxt}</span>
            </div>
          </>
        ) : (
          <>
            {ctas.sinCuenta.length > 0 && (
              <div className="ido-banner-warning" style={{ padding: "8px 16px", borderBottom: "1px solid var(--ido-border)" }}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {ctas.sinCuenta.length === 1 ? "1 partida tiene" : `${ctas.sinCuenta.length} partidas tienen`} {tituloAjustado} sin cuenta contable:{" "}
                  {ctas.sinCuenta.map((p) => `${p.partida ? `${p.partida} ${p.descripcion}` : "(sin partida)"} $ ${F_ENT.format(p.totalAjustado)}`).join(" · ")}
                </span>
              </div>
            )}
            <Tabla
              columnas={colsCuentas(ctas)} filas={ctas.filas} todas={ctasBase.filas}
              filtros={fCta} onFiltro={onFiltro("cuentas")}
              clave={(f) => String(f.orden)} total vacia={hayF(fCta) ? "Ninguna cuenta pasa los filtros." : "El Excel de este plan no traía cuentas contables."}
            />
            <div className="pc-estado">
              <span>Total Excel: <b>$ {F_ENT.format(ctas.total.totalExcel)}</b></span>
              <span>Total calculado: <b>$ {F_ENT.format(ctas.total.totalCalc)}</b></span>
              <span>Diferencia: <b>$ {F_ENT.format(ctas.total.totalExcel - ctas.total.totalCalc)}</b></span>
              <span style={{ marginLeft: "auto" }}><b>{deN(ctas.filas.length, ctasBase.filas.length)}</b> cuentas · {filtroTxt}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Número calculado en una celda a medida (verde itálica; con `signo`, rojo si es negativo). */
function NumCalc({ v, signo = false }: { v: number | null; signo?: boolean }) {
  if (v == null || v === 0 || !Number.isFinite(v)) return <span className="pc-vacio">–</span>;
  const neg = signo && v < 0;
  return <span className={neg ? "pcr-tot-calc is-neg" : "pcr-tot-calc"}>{F_ENT.format(v)}</span>;
}
