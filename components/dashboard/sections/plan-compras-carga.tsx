"use client";

import {
  useState, useEffect, useMemo, useRef, useCallback, useDeferredValue, memo,
  type CSSProperties, type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import {
  Search, RefreshCw, AlertTriangle, FileSpreadsheet, Columns3, ChevronLeft, X,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { loadTableLayout, saveTableLayout } from "@/lib/tableLayout";
import { tipoFromMatServ } from "@/lib/matriculas";
import {
  type Density, type SortDir, DENSITY_ROW_H, DENSITY_LABEL, DENSITY_ORDER, isDensity,
  SortArrow, IdoCheckbox, TipoPill, monoFont, sansFont, autoFitTextWidth, CargandoFilas,
} from "@/components/dashboard/ido-kit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listPlanes, getItems, mensajeErrorPlan, calcularFila, incidencia, textoSinCompra, esCalculada,
  COLUMNAS, GRUPOS, ETIQUETAS_DEFAULT,
  type PlanCompras, type PlanComprasItem, type PlanComprasCalc, type ClaveColumna, type ColumnaPlan,
  type GrupoId, type GrupoPlan,
} from "@/lib/planCompras";
import type { ImportacionPlan } from "@/lib/planComprasImport";
import { PlanComprasImportarModal } from "./plan-compras-importar";

// ─────────────────────────────────────────────────────────────────────────────
// Plan de Compras — Carga de datos: la pestaña «Global» del Excel.
//
// Sistema de diseño IDO (design-system.md), confirmado con el usuario:
//   §4.11 tabla en CSS grid con encabezado fijo opaco y etiquetas de grupo ·
//   §4.14 grupos colapsables (Histórico → MAX, Zona A → ZA, Interior →
//   INTERIOR: los que en el Excel ya tienen su subtotal) · §4.15 redimensionado
//   + doble clic · §4.17/§4.18 Artículo y Descripción anclados a la izquierda
//   con scroll horizontal y sombra · §4.19/§4.20 densidad y layout por usuario
//   · §4.10 menú Columnas · §4.8 filtros · §4.12 barra de estado · §1 valor
//   calculado en verde itálica.
// Esta etapa es de lectura + importación; la edición en celda (§4.4, §4.5)
// llega en la siguiente.
//
// Las columnas fórmula no se guardan: se calculan acá con lib/planComprasCalc
// (verificado contra el Excel: 0 diferencias en las 22.950 filas).
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_ID = "planComprasGlobal";
const MIN_W = 64;           // §4.15
const GRUPO_H = 22;         // fila de etiquetas de grupo
const HEADER_H = 34;        // fila de encabezados de columna
const ANCLADAS: ClaveColumna[] = ["articulo", "descripcion"];
const ABSORBE: ClaveColumna = "descripcion";
/** Grupos que no se pueden ocultar: sin la matrícula la fila no se identifica. */
const GRUPOS_FIJOS = new Set<GrupoId>(["matricula"]);

const COLLATOR = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

// ─── Formato es-AR ───────────────────────────────────────────────────────────

const F_CANT  = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const F_USD   = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const F_PCT   = new Intl.NumberFormat("es-AR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const F_EXACT = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 10 });
const F_ENT   = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

function formatear(c: ColumnaPlan, v: number): string {
  switch (c.formato) {
    case "usd": return F_USD.format(v);
    case "pct": return F_PCT.format(v);
    default:    return F_CANT.format(v);
  }
}

const esNumerica = (c: ColumnaPlan) => c.formato !== "texto" && c.formato !== "codigo";

// ─── Filas ───────────────────────────────────────────────────────────────────

interface Fila {
  it:   PlanComprasItem;
  c:    PlanComprasCalc;
  /** Artículo + descripción sin tildes ni mayúsculas, para el buscador. */
  busq: string;
}

const normBusq = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Valor crudo de una columna (incidencia aparte: depende de lo visible). */
function valorDe(f: Fila, k: ClaveColumna): string | number | null {
  if (k === "incidencia") return null;
  if (esCalculada(k)) return f.c[k as keyof PlanComprasCalc];
  return (f.it as unknown as Record<string, string | number | null>)[k];
}

// ─── Fórmulas (tooltip de los encabezados calculados) ────────────────────────

function formulas(e: (k: ClaveColumna) => string, plan: PlanCompras | null): Partial<Record<ClaveColumna, string>> {
  const tc = plan ? F_CANT.format(plan.tipo_cambio) : "TC";
  const mayor = plan ? F_CANT.format(1 + plan.pct_mayoracion) : "1,2";
  return {
    max_hist:       `MAX(${e("hist_1")}; ${e("hist_2")}; ${e("hist_3")})`,
    za:             `SUMA(${e("d_acr")} … ${e("d_servicios")})`,
    interior:       `SUMA(${e("d_zb")} … ${e("d_zh")})`,
    total:          `${e("za")} + ${e("interior")} + ${e("d_med")} + ${e("d_tele")} + ${e("d_tct")} + ${e("d_trafos")} + ${e("d_obras")} + ${e("d_reg_ten")} + ${e("d_impacto")}`,
    gd:             `${e("total")} − ${e("ajuste")}`,
    recorte:        `${e("cant_aprobadas")} − ${e("gd")}`,
    analisis:       `${e("total")} / ${e("max_hist")} − 1`,
    analisis_cons:  `${e("consumo_promedio")} − ${e("pendientes")} − ${e("stock")}`,
    analisis2:      `${e("gd")} − ${e("stock")} − ${e("pendientes")}`,
    pu_sic_mas:     `REDONDEAR(MAX(${e("pu_sic")}; ${e("pu_op")}) × ${mayor}; 0)`,
    pu_est_pesos:   `REDONDEAR.MAS(${e("pu_est_usd")} × TC ${tc}; 0)`,
    verif_precio:   `${e("pu_est_pesos")} / ${e("pu_sic_mas")} − 1`,
    total_plan:     `${e("pu_est_pesos")} × ${e("gd")}`,
    incidencia:     `${e("total_plan")} / total de las filas visibles`,
    total_ajustado: `${e("pu_ajustado")} × ${e("cant_aprobadas")}`,
    dif_pu:         `${e("pu_ajustado")} / ${e("pu_est_pesos")} − 1`,
    dif_global:     `${e("total_ajustado")} / ${e("total_plan")} − 1`,
  };
}

// ─── Fila de la grilla (memo: al scrollear solo se montan las nuevas) ────────

interface FilaProps {
  fila:        Fila;
  cols:        ColumnaPlan[];
  inicioGrupo: Set<ClaveColumna>;
  template:    string;
  anclaX:      Partial<Record<ClaveColumna, number>>;
  top:         number;
  h:           number;
  sel:         boolean;
  totalVis:    number;
  sinCompra:   string;
  onSel:       (id: string) => void;
}

const FilaGrilla = memo(function FilaGrilla({
  fila, cols, inicioGrupo, template, anclaX, top, h, sel, totalVis, sinCompra, onSel,
}: FilaProps) {
  return (
    <div
      onClick={() => onSel(fila.it.id)}
      className={`ido-table-row grid ${sel ? "ido-row-selected" : ""}`}
      style={{
        gridTemplateColumns: template, position: "absolute", top: 0, left: 0, width: "100%",
        height: h, transform: `translateY(${top}px)`, fontSize: 12.5,
        borderBottom: "1px solid var(--ido-row-line)",
      }}
    >
      {cols.map((c, i) => {
        const k = c.clave;
        const calc = esCalculada(k);
        const num = esNumerica(c);
        const x = anclaX[k];
        const anclada = x != null;
        let cls = "pc-celda";
        if (num) cls += " is-num";
        if (c.formato === "codigo") cls += " is-cod";
        if (calc) cls += " is-calc";
        if (inicioGrupo.has(k) && i > 0) cls += " is-ini";
        if (anclada) cls += " ido-sticky-cell";
        if (k === ANCLADAS[ANCLADAS.length - 1]) cls += " pc-ancla-fin";
        const style: CSSProperties | undefined = anclada
          // boxShadow inherit en la primera: si no, su fondo opaco taparía el
          // borde verde de fila seleccionada (un inset shadow de la fila).
          ? { position: "sticky", left: x, zIndex: 1, ...(i === 0 ? { boxShadow: "inherit" } : null) }
          : undefined;

        let contenido: ReactNode;
        let title: string | undefined;
        if (k === "mat_serv") {
          const t = tipoFromMatServ(fila.it.mat_serv);
          contenido = t ? <TipoPill tipo={t} /> : <span className="pc-vacio">—</span>;
          title = fila.it.mat_serv ?? undefined;
        } else {
          const v = k === "incidencia" ? incidencia(fila.c.total_plan, totalVis) : valorDe(fila, k);
          if (v == null) {
            // null en un % calculado = el texto del SI.ERROR del Excel.
            const txt = k === "analisis" ? sinCompra : k === "dif_pu" || k === "dif_global" ? "Sin Datos" : null;
            contenido = txt
              ? <span className="pc-texto-calc">{txt}</span>
              : <span className="pc-vacio">–</span>;
            title = txt ?? undefined;
          } else if (typeof v === "number") {
            if (v === 0) {
              contenido = <span className="pc-vacio">–</span>;
              title = "0";
            } else {
              contenido = <span>{formatear(c, v)}</span>;
              title = F_EXACT.format(v);
              if (calc && c.formato === "pct" && v < 0) cls += " is-neg";
            }
          } else {
            contenido = <span>{v}</span>;
            title = v;
          }
        }
        return (
          <div key={k} className={cls} style={style} title={title}>
            {contenido}
          </div>
        );
      })}
    </div>
  );
});

// ─── Select de filtro (shadcn Select con el panel IDO) ───────────────────────

function FiltroSelect({
  value, onChange, opciones, todos, ancho,
}: {
  value: string;
  onChange: (v: string) => void;
  opciones: { v: string; label: string; n: number }[];
  todos: string;
  ancho: number;
}) {
  const activo = value !== "__todos";
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        className={`ido-selectbtn shrink-0 shadow-none focus-visible:ring-0 ${activo ? "is-on" : ""}`}
        style={{ height: 32, maxWidth: ancho, minWidth: 120, color: "var(--ido-text)" }}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="ido-terminal ido-pop border-0 max-h-[360px]">
        <SelectItem
          value="__todos"
          className="ido-pop-item focus:bg-white/5 focus:text-[var(--ido-text)] data-[state=checked]:text-[var(--ido-text)]"
        >
          {todos}
        </SelectItem>
        {opciones.map((o) => (
          <SelectItem
            key={o.v}
            value={o.v}
            className="ido-pop-item focus:bg-white/5 focus:text-[var(--ido-text)] data-[state=checked]:text-[var(--ido-text)]"
          >
            <span className="truncate">{o.label}</span>
            <span style={{ marginLeft: "auto", paddingLeft: 12, fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11, color: "var(--ido-text-2)" }}>
              {o.n.toLocaleString("es-AR")}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Sección ─────────────────────────────────────────────────────────────────

export function PlanComprasCargaSection({ onSummaryChange }: { onSummaryChange?: (s: string | null) => void } = {}) {
  // ── Usuario (layout por usuario, §4.20) ────────────────────────────────────
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // ── Datos ──────────────────────────────────────────────────────────────────
  const [planes, setPlanes] = useState<PlanCompras[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [items, setItems] = useState<PlanComprasItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [progreso, setProgreso] = useState<{ n: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);

  const plan = useMemo(() => planes.find((p) => p.id === planId) ?? null, [planes, planId]);

  // Pedido en curso: si se cambia de plan a mitad de la carga, la respuesta
  // vieja no tiene que pisar la nueva.
  const pedido = useRef(0);
  const cargar = useCallback(async (preferido?: string) => {
    const yo = ++pedido.current;
    setCargando(true);
    setError(null);
    setProgreso(null);
    try {
      const ps = await listPlanes();
      if (yo !== pedido.current) return;
      setPlanes(ps);
      const elegido = ps.find((p) => p.id === preferido) ?? ps[0] ?? null;
      setPlanId(elegido?.id ?? null);
      if (!elegido) { setItems([]); return; }
      const its = await getItems(elegido.id, (n, total) => {
        if (yo === pedido.current) setProgreso({ n, total });
      });
      if (yo !== pedido.current) return;
      setItems(its);
    } catch (e) {
      if (yo === pedido.current) setError(mensajeErrorPlan(e));
    } finally {
      if (yo === pedido.current) { setCargando(false); setProgreso(null); }
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const elegirPlan = (id: string) => { if (id !== planId) cargar(id); };

  const onImportado = (p: PlanCompras, imp: ImportacionPlan) => {
    setImportando(false);
    toast.success(`Plan ${p.anio} importado: ${imp.items.length.toLocaleString("es-AR")} filas`);
    cargar(p.id);
  };

  // ── Etiquetas: el encabezado real del Excel de este plan ──────────────────
  const etiqueta = useCallback(
    (k: ClaveColumna) => plan?.etiquetas?.[k] ?? ETIQUETAS_DEFAULT[k],
    [plan],
  );
  const tooltipsFormula = useMemo(() => formulas(etiqueta, plan), [etiqueta, plan]);

  // ── Filas con sus cálculos ─────────────────────────────────────────────────
  const filas = useMemo<Fila[]>(() => {
    if (!plan) return [];
    const params = { tipo_cambio: plan.tipo_cambio, pct_mayoracion: plan.pct_mayoracion };
    return items.map((it) => ({
      it,
      c: calcularFila(it, params),
      busq: normBusq(`${it.articulo ?? ""} ${it.descripcion ?? ""}`),
    }));
  }, [items, plan]);

  // ── Filtros (§4.8) ─────────────────────────────────────────────────────────
  const [busqueda, setBusqueda] = useState("");
  const busquedaDiferida = useDeferredValue(busqueda);
  const [aCargo, setACargo] = useState("__todos");
  const [familia, setFamilia] = useState("__todos");
  const [soloDemanda, setSoloDemanda] = useState(false);

  const opcionesDe = useCallback((k: "a_cargo_de" | "familia") => {
    const cnt = new Map<string, number>();
    for (const f of filas) {
      const v = f.it[k] ?? "";
      if (v) cnt.set(v, (cnt.get(v) ?? 0) + 1);
    }
    return [...cnt.entries()]
      // «Sin Datos» al final: es el «no clasificado» del Excel.
      .sort((a, b) => (a[0] === "Sin Datos" ? 1 : b[0] === "Sin Datos" ? -1 : COLLATOR.compare(a[0], b[0])))
      .map(([v, n]) => ({ v, label: v, n }));
  }, [filas]);
  const opcionesACargo = useMemo(() => opcionesDe("a_cargo_de"), [opcionesDe]);
  const opcionesFamilia = useMemo(() => opcionesDe("familia"), [opcionesDe]);

  // ── Orden ──────────────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<ClaveColumna | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const toggleSort = (k: ClaveColumna) => {
    if (sortKey !== k) { setSortKey(k); setSortDir(esNumerica(COLUMNAS.find((c) => c.clave === k)!) ? "desc" : "asc"); return; }
    if (sortDir === (esNumerica(COLUMNAS.find((c) => c.clave === k)!) ? "desc" : "asc")) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      // Tercer clic: vuelve al orden del Excel.
      setSortKey(null);
    }
  };

  const filtradas = useMemo(() => {
    const q = normBusq(busquedaDiferida.trim());
    const out = filas.filter((f) => {
      if (aCargo !== "__todos" && f.it.a_cargo_de !== aCargo) return false;
      if (familia !== "__todos" && f.it.familia !== familia) return false;
      // «Con cantidades»: pedido, neto o aprobado. Solo TOTAL/GD dejaría
      // afuera las filas aprobadas que nadie pidió este año.
      if (soloDemanda && f.c.total === 0 && f.c.gd === 0 && !f.it.cant_aprobadas) return false;
      if (q && !f.busq.includes(q)) return false;
      return true;
    });
    if (sortKey && sortKey !== "incidencia") {
      const dir = sortDir === "asc" ? 1 : -1;
      const col = COLUMNAS.find((c) => c.clave === sortKey)!;
      if (esNumerica(col)) {
        // null (textos del SI.ERROR) siempre al final, en cualquier dirección.
        out.sort((a, b) => {
          const va = valorDe(a, sortKey) as number | null, vb = valorDe(b, sortKey) as number | null;
          if (va == null || vb == null) return va == null ? (vb == null ? 0 : 1) : -1;
          return dir * (va - vb);
        });
      } else {
        out.sort((a, b) => dir * COLLATOR.compare(String(valorDe(a, sortKey) ?? ""), String(valorDe(b, sortKey) ?? "")));
      }
    } else if (sortKey === "incidencia") {
      // La incidencia es proporcional al Total $: mismo orden.
      const dir = sortDir === "asc" ? 1 : -1;
      out.sort((a, b) => dir * (a.c.total_plan - b.c.total_plan));
    }
    return out;
  }, [filas, aCargo, familia, soloDemanda, busquedaDiferida, sortKey, sortDir]);

  const totales = useMemo(() => {
    let vis = 0, visAj = 0, todo = 0;
    for (const f of filtradas) { vis += f.c.total_plan; visAj += f.c.total_ajustado; }
    for (const f of filas) todo += f.c.total_plan;
    return { vis, visAj, todo };
  }, [filtradas, filas]);

  const hayFiltro = aCargo !== "__todos" || familia !== "__todos" || soloDemanda || busquedaDiferida.trim() !== "";
  const limpiarFiltros = () => { setBusqueda(""); setACargo("__todos"); setFamilia("__todos"); setSoloDemanda(false); };

  // Conteo en el header global (como Matrículas).
  useEffect(() => {
    if (!onSummaryChange) return;
    if (cargando) { onSummaryChange("Cargando…"); return; }
    if (!plan) { onSummaryChange(null); return; }
    const n = filtradas.length, N = filas.length;
    onSummaryChange(`Plan ${plan.anio} · ${n === N ? `${N.toLocaleString("es-AR")} filas` : `${n.toLocaleString("es-AR")} de ${N.toLocaleString("es-AR")} filas`}`);
  }, [onSummaryChange, cargando, plan, filtradas.length, filas.length]);
  useEffect(() => () => onSummaryChange?.(null), [onSummaryChange]);

  // ── Layout: densidad, anchos, grupos (§4.19/§4.20) ─────────────────────────
  // Compacta por defecto: con 61 columnas la grilla siempre desborda (§4.18).
  const [density, setDensity] = useState<Density>("compacta");
  const [colW, setColW] = useState<Partial<Record<ClaveColumna, number>>>({});
  const colWRef = useRef(colW);
  useEffect(() => { colWRef.current = colW; }, [colW]);
  const [colapsados, setColapsados] = useState<Set<GrupoId>>(new Set());
  const [ocultos, setOcultos] = useState<Set<GrupoId>>(new Set());
  const [resetMsg, setResetMsg] = useState(false);
  const resetT = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetT.current) clearTimeout(resetT.current); }, []);

  useEffect(() => {
    if (!userId) return;
    const s = loadTableLayout(userId, TABLE_ID);
    // Evolución del esquema (§4.20): lo que ya no existe se descarta en silencio.
    const claves = new Set<string>(COLUMNAS.map((c) => c.clave));
    const grupos = new Set<string>(GRUPOS.map((g) => g.id));
    if (s.colW) {
      const ok: Partial<Record<ClaveColumna, number>> = {};
      for (const [k, v] of Object.entries(s.colW)) if (claves.has(k) && typeof v === "number") ok[k as ClaveColumna] = v;
      setColW(ok);
    }
    if (isDensity(s.density)) setDensity(s.density);
    if (s.colapsados) setColapsados(new Set(s.colapsados.filter((g) => grupos.has(g)) as GrupoId[]));
    if (s.ocultos) setOcultos(new Set(s.ocultos.filter((g) => grupos.has(g) && !GRUPOS_FIJOS.has(g as GrupoId)) as GrupoId[]));
  }, [userId]);

  const guardarLayout = (patch: Parameters<typeof saveTableLayout>[2]) => {
    if (userIdRef.current) saveTableLayout(userIdRef.current, TABLE_ID, patch);
  };

  function cycleDensity() {
    const next = DENSITY_ORDER[(DENSITY_ORDER.indexOf(density) + 1) % DENSITY_ORDER.length];
    setDensity(next);
    guardarLayout({ density: next });
  }
  function toggleColapso(g: GrupoId) {
    setColapsados((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      guardarLayout({ colapsados: [...next] });
      return next;
    });
  }
  function toggleOculto(g: GrupoId) {
    if (GRUPOS_FIJOS.has(g)) return;
    setOcultos((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      guardarLayout({ ocultos: [...next] });
      return next;
    });
  }
  function resetLayout() {
    setColW({});
    setDensity("compacta");
    setColapsados(new Set());
    setOcultos(new Set());
    guardarLayout({ colW: null, density: null, colapsados: null, ocultos: null });
    setResetMsg(true);
    if (resetT.current) clearTimeout(resetT.current);
    resetT.current = setTimeout(() => setResetMsg(false), 1500);
  }

  // ── Columnas visibles ──────────────────────────────────────────────────────
  const gruposVisibles = useMemo(() => {
    const out: { g: GrupoPlan; cols: ColumnaPlan[]; colapsado: boolean }[] = [];
    for (const g of GRUPOS) {
      if (ocultos.has(g.id)) continue;
      const todas = COLUMNAS.filter((c) => c.grupo === g.id);
      const colapsado = !!g.resumen && colapsados.has(g.id);
      out.push({ g, cols: colapsado ? todas.filter((c) => c.clave === g.resumen) : todas, colapsado });
    }
    return out;
  }, [ocultos, colapsados]);

  const cols = useMemo(() => gruposVisibles.flatMap((x) => x.cols), [gruposVisibles]);
  const inicioGrupo = useMemo(() => new Set(gruposVisibles.map((x) => x.cols[0].clave)), [gruposVisibles]);

  // ── Anchos (§4.17): Descripción absorbe el sobrante si la grilla entra ─────
  const scrollRef = useRef<HTMLDivElement>(null);
  const [availW, setAvailW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const medir = () => setAvailW(el.clientWidth);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cargando, plan]);

  const anchos = useMemo(() => {
    const w = {} as Record<ClaveColumna, number>;
    for (const c of cols) w[c.clave] = colW[c.clave] ?? c.ancho;
    if (colW[ABSORBE] == null) {
      const usado = cols.reduce((s, c) => s + w[c.clave], 0);
      w[ABSORBE] += Math.max(0, availW - usado);
    }
    return w;
  }, [cols, colW, availW]);
  const absorbiendo = colW[ABSORBE] == null && cols.reduce((s, c) => s + (colW[c.clave] ?? c.ancho), 0) < availW;

  const template = useMemo(() => cols.map((c) => `${anchos[c.clave]}px`).join(" "), [cols, anchos]);
  const contentW = cols.reduce((s, c) => s + anchos[c.clave], 0);
  const anclaX = useMemo(() => {
    const out: Partial<Record<ClaveColumna, number>> = {};
    let x = 0;
    for (const k of ANCLADAS) { out[k] = x; x += anchos[k]; }
    return out;
  }, [anchos]);
  const anchoAnclado = ANCLADAS.reduce((s, k) => s + anchos[k], 0);

  // ── Redimensionado (§4.15) ─────────────────────────────────────────────────
  const [resizingCol, setResizingCol] = useState<ClaveColumna | null>(null);
  const resizing = useRef<{ id: ClaveColumna; startX: number; startW: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Tras soltar el tirador, el click que sigue no tiene que ordenar la columna.
  const finResize = useRef(0);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const r = resizing.current;
      if (!r) return;
      const w = Math.max(MIN_W, r.startW + (e.clientX - r.startX));
      setColW((p) => ({ ...p, [r.id]: w }));
    }
    function onUp() {
      if (!resizing.current) return;
      resizing.current = null;
      finResize.current = Date.now();
      setResizingCol(null);
      if (userIdRef.current) saveTableLayout(userIdRef.current, TABLE_ID, { colW: colWRef.current as Record<string, number> });
    }
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
    return () => { window.removeEventListener("mousemove", onMove, true); window.removeEventListener("mouseup", onUp, true); };
  }, []);

  function startResize(e: React.MouseEvent, id: ClaveColumna) {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { id, startX: e.clientX, startW: anchos[id] };
    setResizingCol(id);
  }

  // Doble clic: ajusta al contenido más ancho de lo filtrado y nunca por
  // debajo de lo que pide el título.
  function autoFit(e: React.MouseEvent, c: ColumnaPlan) {
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current ?? (canvasRef.current = document.createElement("canvas"));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const num = esNumerica(c);
    ctx.font = num || c.formato === "codigo" ? monoFont(12.5, esCalculada(c.clave) ? 500 : 400) : sansFont(12.5);
    const valores = filtradas.map((f) => {
      const v = c.clave === "incidencia" ? incidencia(f.c.total_plan, totales.vis) : valorDe(f, c.clave);
      return typeof v === "number" ? (v === 0 ? "–" : formatear(c, v)) : String(v ?? "");
    });
    // autoFitTextWidth suma 24 de padding (12 + 12); acá la celda lleva 8 + 8.
    // M/S se muestra como chip (ícono + padding + borde): ~30px más que el texto.
    const fit = Math.max(MIN_W, autoFitTextWidth(ctx, valores, MIN_W) - 8 + (c.clave === "mat_serv" ? 30 : 0));
    ctx.font = sansFont(10, 500);
    const label = etiqueta(c.clave).toUpperCase();
    const labelW = Math.ceil(ctx.measureText(label).width + label.length * 1 + 16 + 16);
    const w = Math.max(fit, labelW);
    setColW((p) => ({ ...p, [c.clave]: w }));
    if (userIdRef.current) saveTableLayout(userIdRef.current, TABLE_ID, { colW: { ...colWRef.current, [c.clave]: w } as Record<string, number> });
  }

  const colRightX = (id: ClaveColumna) => {
    let x = 0;
    for (const c of cols) { x += anchos[c.clave]; if (c.clave === id) break; }
    return x;
  };

  // ── Scroll horizontal: sombra de las columnas ancladas (§4.18) ─────────────
  const [scrolledX, setScrolledX] = useState(false);
  const onScroll = () => {
    const x = (scrollRef.current?.scrollLeft ?? 0) > 0;
    if (x !== scrolledX) setScrolledX(x);
  };

  // ── Virtualización ─────────────────────────────────────────────────────────
  const ROW_H = DENSITY_ROW_H[density];
  const virtualizer = useVirtualizer({
    count: filtradas.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });
  useEffect(() => { virtualizer.measure(); }, [density]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selección de fila (§4.11: fila seleccionada) ───────────────────────────
  const [selId, setSelId] = useState<string | null>(null);
  const onSel = useCallback((id: string) => setSelId((p) => (p === id ? null : id)), []);

  const sinCompra = textoSinCompra(etiqueta("max_hist"));
  const vItems = virtualizer.getVirtualItems();
  const fecha = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const tituloTotal = etiqueta("total_plan");

  // ── Render ─────────────────────────────────────────────────────────────────
  const renderResizer = (id: ClaveColumna, c: ColumnaPlan) => {
    const activo = resizingCol === id;
    return (
      <span
        onMouseDown={(e) => startResize(e, id)}
        onDoubleClick={(e) => autoFit(e, c)}
        onClick={(e) => e.stopPropagation()}
        title="Arrastrá para cambiar el ancho · doble clic para ajustar al contenido"
        className="group absolute top-0 right-[-4px] bottom-0 w-2 cursor-col-resize z-20 flex justify-center"
      >
        <span
          className={`w-[2px] h-full transition-opacity ${activo ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          style={{ background: "var(--ido-accent)", transitionDuration: "100ms", transitionTimingFunction: "var(--ido-ease)" }}
        />
      </span>
    );
  };

  const vacio = !cargando && !error && !plan;

  return (
    <div className="ido-terminal flex flex-col h-[calc(100vh-96px)] sm:h-[calc(100vh-112px)] min-h-[360px]">
      <div className="ido-card flex flex-col flex-1 min-h-0" style={{ position: "relative" }}>
        {/* ── Toolbar (§4.10) + filtros (§4.8) ─────────────────────────────── */}
        <div className="ido-toolbar" style={{ padding: "10px 16px", gap: 8 }}>
          {planes.length > 1 ? (
            <Select value={planId ?? ""} onValueChange={elegirPlan}>
              <SelectTrigger size="sm" className="ido-selectbtn shrink-0 shadow-none focus-visible:ring-0" style={{ height: 32, color: "var(--ido-text)" }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="ido-terminal ido-pop border-0">
                {planes.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="ido-pop-item focus:bg-white/5 focus:text-[var(--ido-text)] data-[state=checked]:text-[var(--ido-text)]">
                    Plan {p.anio}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : plan ? (
            <span className="ido-title shrink-0">Plan {plan.anio}</span>
          ) : null}
          {plan && (
            <span
              className="ido-chipbtn shrink-0"
              style={{ cursor: "default" }}
              title={`Tipo de cambio del plan ($ por USD) y mayoración de «${etiqueta("pu_sic_mas")}». Pu Est ($) = Pu Est (USD) × TC.`}
            >
              TC <b>{F_CANT.format(plan.tipo_cambio)}</b>
              <span style={{ color: "var(--ido-border-strong)" }}>·</span>
              Mayoración <b>{F_PCT.format(plan.pct_mayoracion).replace(",0", "")}</b>
            </span>
          )}

          {plan && (
            <>
              <span className="ido-divider" />
              <div className="ido-inputbox" style={{ height: 32, flex: "1 1 200px", maxWidth: 320, gap: 6 }}>
                <Search className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--ido-text-2)" }} />
                <input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar artículo o descripción…"
                  aria-label="Buscar artículo o descripción"
                />
                {busqueda && (
                  <button type="button" className="ido-icon-btn" style={{ width: 20, height: 20 }} onClick={() => setBusqueda("")} title="Borrar búsqueda">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <FiltroSelect value={aCargo} onChange={setACargo} opciones={opcionesACargo} todos="A cargo de: todos" ancho={190} />
              <FiltroSelect value={familia} onChange={setFamilia} opciones={opcionesFamilia} todos="Familia: todas" ancho={240} />
              <button
                type="button"
                className={`ido-btn ido-btn-ghost ${soloDemanda ? "is-on" : ""}`}
                style={{ height: 32 }}
                onClick={() => setSoloDemanda((v) => !v)}
                title={`Solo las filas con ${etiqueta("total")}, ${etiqueta("gd")} o ${etiqueta("cant_aprobadas")} distinto de 0`}
              >
                Con cantidades
              </button>
              {hayFiltro && (
                <button type="button" className="ido-btn ido-btn-text" style={{ height: 32 }} onClick={limpiarFiltros}>
                  Limpiar filtros
                </button>
              )}
            </>
          )}

          <div className="flex items-center gap-1.5 flex-wrap" style={{ marginLeft: "auto" }}>
            {resetMsg && (
              <span className="ido-reset-confirm">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg>
                Vista restablecida
              </span>
            )}
            {plan && (
              <>
                <button type="button" className="ido-btn ido-btn-text" style={{ height: 32 }} onClick={resetLayout} title="Restaura anchos, densidad y grupos de columnas">
                  Restablecer vista
                </button>
                <button type="button" className="ido-btn ido-btn-text" style={{ height: 32 }} onClick={cycleDensity} title="Altura de fila: compacta 32px · normal 40px · cómoda 52px">
                  Densidad: {DENSITY_LABEL[density]}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="ido-btn ido-btn-ghost" style={{ height: 32 }}>
                      <Columns3 className="w-3.5 h-3.5" />
                      Columnas
                      <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11, color: "var(--ido-text-2)" }}>
                        {GRUPOS.length - ocultos.size}/{GRUPOS.length}
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="ido-terminal ido-pop border-0 w-[240px]">
                    <div className="ido-pop-label">Grupos de columnas</div>
                    {GRUPOS.map((g) => {
                      const fijo = GRUPOS_FIJOS.has(g.id);
                      const n = COLUMNAS.filter((c) => c.grupo === g.id).length;
                      return (
                        <DropdownMenuItem
                          key={g.id}
                          disabled={fijo}
                          // preventDefault: el menú queda abierto para tildar varios.
                          onSelect={(e) => { e.preventDefault(); toggleOculto(g.id); }}
                          className="ido-pop-item focus:bg-white/5 focus:text-[var(--ido-text)]"
                        >
                          <IdoCheckbox checked={!ocultos.has(g.id)} onClick={() => {}} label={g.titulo} />
                          <span className="truncate">{g.titulo}</span>
                          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11, color: "var(--ido-text-2)" }}>{n}</span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                <span style={{ width: 1, height: 20, background: "var(--ido-line)", margin: "0 4px" }} />
              </>
            )}
            <button type="button" className="ido-btn ido-btn-text" style={{ height: 32 }} onClick={() => cargar(planId ?? undefined)} disabled={cargando}>
              <RefreshCw className={`w-3.5 h-3.5${cargando ? " animate-spin" : ""}`} />Actualizar
            </button>
            {/* Sin plan, el botón primario es el del centro (un solo primario
                por pantalla, regla del acento §1). */}
            {!vacio && (
              <button type="button" className="ido-btn ido-btn-primary" style={{ height: 32 }} onClick={() => setImportando(true)}>
                <FileSpreadsheet className="w-4 h-4" />Importar Excel
              </button>
            )}
          </div>
        </div>

        {/* ── Cuerpo ─────────────────────────────────────────────────────── */}
        {error ? (
          <div className="ido-loading" style={{ flexDirection: "column", gap: 10, flex: 1, textAlign: "center", padding: "0 24px" }}>
            <AlertTriangle className="w-5 h-5" style={{ color: "var(--ido-warning)" }} />
            <span style={{ maxWidth: 520 }}>{error}</span>
            <button type="button" className="ido-btn ido-btn-ghost" style={{ height: 32 }} onClick={() => cargar(planId ?? undefined)}>
              Reintentar
            </button>
          </div>
        ) : cargando ? (
          <CargandoFilas
            texto={progreso ? "Cargando filas…" : "Cargando plan…"}
            n={progreso?.n}
            total={progreso?.total}
            style={{ flex: 1 }}
          />
        ) : vacio ? (
          <div className="ido-loading" style={{ flexDirection: "column", gap: 12, flex: 1, textAlign: "center", padding: "0 24px" }}>
            <FileSpreadsheet className="w-6 h-6" style={{ color: "var(--ido-text-2)" }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ido-text)" }}>Todavía no hay un plan cargado</span>
            <span style={{ maxWidth: 460, fontSize: 13, lineHeight: 1.55, color: "var(--ido-text-2)" }}>
              Importá el Excel del plan (PC_ANUAL_GD): se cargan las pestañas{" "}
              <span style={{ color: "var(--ido-accent)" }}>Global</span>, Prioridad y Resumen, y las columnas fórmula se{" "}
              <span style={{ color: "var(--ido-accent)" }}>recalculan</span> y se comparan contra el archivo.
            </span>
            <button type="button" className="ido-btn ido-btn-primary" style={{ height: 38 }} onClick={() => setImportando(true)}>
              <FileSpreadsheet className="w-4 h-4" />Importar Excel
            </button>
          </div>
        ) : (
          <>
            {/* Tabla (CSS grid, §4.11): UN solo contenedor de scroll para los
                dos ejes, con el encabezado sticky adentro. */}
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className={`pc-scroll flex-1 min-h-0 ${scrolledX ? "is-scrolled-x" : ""}`}
              style={{ overflow: "auto" }}
            >
              <div style={{ width: contentW, minWidth: "100%", minHeight: "100%", position: "relative" }}>
                {resizingCol && (
                  <>
                    <div style={{ position: "absolute", top: 0, bottom: 0, left: colRightX(resizingCol), width: 1, background: "var(--ido-accent)", pointerEvents: "none", zIndex: 30 }} />
                    <div
                      style={{
                        position: "absolute", top: GRUPO_H + HEADER_H + 6, left: colRightX(resizingCol) + 6, zIndex: 31,
                        padding: "4px 8px", borderRadius: 6, background: "var(--ido-surface-hover)", border: "1px solid var(--ido-line)",
                        fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11, color: "var(--ido-text)",
                        whiteSpace: "nowrap", pointerEvents: "none",
                      }}
                    >
                      {Math.round(anchos[resizingCol])} px
                    </div>
                  </>
                )}

                {/* Encabezado sticky: fila de grupos + fila de columnas. Fondo
                    opaco (bg.header): las filas pasan por debajo al scrollear. */}
                <div style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--ido-header)", borderBottom: "1px solid var(--ido-border-strong)" }}>
                  <div className="grid" style={{ gridTemplateColumns: template, height: GRUPO_H }}>
                    {gruposVisibles.map(({ g, cols: gc, colapsado }) => {
                      // Matrícula: la etiqueta cubre solo las columnas ancladas
                      // y queda fija con ellas; el resto del grupo, vacío.
                      if (g.id === "matricula") {
                        const nAncla = gc.filter((c) => ANCLADAS.includes(c.clave)).length;
                        return [
                          <div
                            key="matricula"
                            className="pc-grupo ido-sticky-cell"
                            style={{ gridColumn: `span ${nAncla}`, position: "sticky", left: 0, zIndex: 2, borderLeft: 0, background: "var(--ido-header)" }}
                          >
                            <span className="pc-grupo-marca" />{g.titulo}
                          </div>,
                          gc.length > nAncla ? <div key="matricula-resto" style={{ gridColumn: `span ${gc.length - nAncla}` }} /> : null,
                        ];
                      }
                      const total = COLUMNAS.filter((c) => c.grupo === g.id).length;
                      return (
                        <div key={g.id} className="pc-grupo" style={{ gridColumn: `span ${gc.length}` }} title={g.titulo}>
                          <span className="pc-grupo-in" style={{ left: anchoAnclado + 8 }}>
                            <span className="pc-grupo-marca" />
                            {/* Colapsado queda una sola columna angosta: el nombre
                                del grupo va en el tooltip y el encabezado de la
                                columna resumen (MAX / ZA / INTERIOR) ya lo dice. */}
                            {colapsado
                              ? <span className="pc-grupo-n" title={`${g.titulo}: ${total - 1} columnas ocultas`}>+{total - 1}</span>
                              : <span className="truncate">{g.titulo}</span>}
                            {g.resumen && (
                              <button
                                type="button"
                                className={`pc-colapsar ${colapsado ? "is-colapsado" : ""}`}
                                onClick={() => toggleColapso(g.id)}
                                title={colapsado ? `Expandir ${g.titulo}` : `Colapsar ${g.titulo} a ${etiqueta(g.resumen)}`}
                                aria-label={colapsado ? `Expandir ${g.titulo}` : `Colapsar ${g.titulo}`}
                              >
                                <ChevronLeft className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid" style={{ gridTemplateColumns: template, height: HEADER_H }}>
                    {cols.map((c, i) => {
                      const activa = sortKey === c.clave;
                      const anclada = anclaX[c.clave] != null;
                      const label = etiqueta(c.clave);
                      const formula = tooltipsFormula[c.clave];
                      return (
                        <div
                          key={c.clave}
                          onClick={() => { if (Date.now() - finResize.current > 200) toggleSort(c.clave); }}
                          className={`pc-th ${esNumerica(c) ? "is-num" : ""} ${activa ? "is-activa" : ""} ${inicioGrupo.has(c.clave) && i > 0 ? "is-ini" : ""} ${c.clave === ANCLADAS[ANCLADAS.length - 1] ? "pc-ancla-fin" : ""}`}
                          title={`${label} · columna ${c.letra}${formula ? `\n= ${formula}` : ""}`}
                          style={anclado(anclada, anclaX[c.clave])}
                        >
                          <span className="truncate" style={esCalculada(c.clave) ? { fontStyle: "italic" } : undefined}>{label}</span>
                          <SortArrow active={activa} dir={activa ? sortDir : "asc"} className="w-3 h-3 shrink-0" />
                          {renderResizer(c.clave, c)}
                          {c.clave === ABSORBE && absorbiendo && (
                            <span
                              title="Absorbe el sobrante"
                              style={{ position: "absolute", bottom: 0, left: 8, right: 8, height: 2, background: "var(--ido-accent)", opacity: 0.5, pointerEvents: "none" }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Filas */}
                {filtradas.length === 0 ? (
                  <div className="ido-loading" style={{ flexDirection: "column", gap: 10, height: 200, position: "sticky", left: 0, width: availW || "100%" }}>
                    <AlertTriangle className="w-5 h-5" style={{ color: "var(--ido-warning)" }} />
                    Ninguna fila coincide con los filtros.
                    <button type="button" className="ido-btn ido-btn-text" style={{ height: 32 }} onClick={limpiarFiltros}>Limpiar filtros</button>
                  </div>
                ) : (
                  <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                    {vItems.map((vi) => {
                      const f = filtradas[vi.index];
                      return (
                        <FilaGrilla
                          key={f.it.id}
                          fila={f}
                          cols={cols}
                          inicioGrupo={inicioGrupo}
                          template={template}
                          anclaX={anclaX}
                          top={vi.start}
                          h={ROW_H}
                          sel={selId === f.it.id}
                          totalVis={totales.vis}
                          sinCompra={sinCompra}
                          onSel={onSel}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── Barra de estado (§4.12) ──────────────────────────────────── */}
            <div className="pc-estado">
              <span title={`Suma de «${tituloTotal}» de las filas visibles. La incidencia de cada fila se calcula sobre este total, igual que el SUBTOTAL del Excel.`}>
                {tituloTotal}{hayFiltro ? " (visible)" : ""}: <b>$ {F_ENT.format(totales.vis)}</b>
                {plan && plan.tipo_cambio > 0 && <> · USD <b>{F_ENT.format(totales.vis / plan.tipo_cambio)}</b></>}
              </span>
              {hayFiltro && (
                <span>
                  Plan completo: <b>$ {F_ENT.format(totales.todo)}</b>
                </span>
              )}
              <span>
                {etiqueta("total_ajustado")}: <b>$ {F_ENT.format(totales.visAj)}</b>
              </span>
              <span style={{ marginLeft: "auto" }}>
                <b>{filtradas.length.toLocaleString("es-AR")}</b>
                {filtradas.length !== filas.length && <> de <b>{filas.length.toLocaleString("es-AR")}</b></>} filas
              </span>
              {plan && (
                <span className="pc-estado-dim" title={plan.archivo ?? undefined}>
                  Importado {fecha(plan.importado_at)}{plan.archivo ? ` · ${plan.archivo}` : ""}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {importando && (
        <PlanComprasImportarModal
          planActual={plan}
          onClose={() => setImportando(false)}
          onImportado={onImportado}
        />
      )}
    </div>
  );
}

/** Estilo de una celda de encabezado anclada a la izquierda. */
function anclado(anclada: boolean, x: number | undefined): CSSProperties | undefined {
  return anclada ? { position: "sticky", left: x, zIndex: 2, background: "var(--ido-header)" } : undefined;
}
