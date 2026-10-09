"use client";

import {
  useState, useEffect, useMemo, useRef, useCallback, useDeferredValue, memo,
  type CSSProperties, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import {
  Search, RefreshCw, AlertTriangle, FileSpreadsheet, Columns3, ChevronLeft, X, Filter,
  Copy, ClipboardPaste, Eraser, Undo2, Check, Loader2, Lock,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { loadTableLayout, saveTableLayout } from "@/lib/tableLayout";
import { tipoFromMatServ } from "@/lib/matriculas";
import {
  type Density, type SortDir, DENSITY_ROW_H, DENSITY_LABEL, DENSITY_ORDER, isDensity,
  SortArrow, IdoCheckbox, TipoPill, monoFont, sansFont, autoFitTextWidth, CargandoFilas,
} from "@/components/dashboard/ido-kit";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listPlanes, guardarEdiciones, eliminarPlan, nombresUsuarios, puedeEditarPlan, mensajeErrorPlan, calcularFila, incidencia, textoSinCompra, esCalculada,
  COLUMNAS, GRUPOS, ETIQUETAS_DEFAULT, columnaEnPlan,
  type PlanCompras, type PlanComprasItem, type PlanComprasCalc, type ClaveColumna, type ClaveCarga, type ColumnaPlan,
  type GrupoId, type GrupoPlan,
} from "@/lib/planCompras";
import type { ImportacionPlan } from "@/lib/planComprasImport";
import {
  cargarItemsPlan, itemsEnCache, planCambio, actualizarItemsCache, refrescarFirma,
  planesEnCache, guardarPlanesCache, planElegido, recordarPlan, olvidarPlan,
} from "@/lib/planComprasCache";
import {
  esEditable, claveDato, parseValor, textoDeValor, conCambio, restaurada, estaModificada, textoImportado,
  parseTsv, celdaTsv, valorCelda, tituloColumna, type Valor,
} from "@/lib/planComprasEdicion";
import { PlanComprasImportarModal } from "./plan-compras-importar";
import { ConfirmarEliminarPlan, FiltroSelect, SelectorPlan } from "./plan-compras-ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  MenuFiltroColumna, pasaFiltro, resumenFiltro,
  type FiltroColumna, type ValorFiltro, type OpcionValor,
} from "./plan-compras-filtro-columna";

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
// Edición en celda (confirmada): §4.4 estados de celda (selección con
// teclado, edición, bloqueada, modificada, error) · §4.5 menú de clic derecho
// · pegado de bloques desde Excel · §4.10 indicador de guardado automático.
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
/** Las columnas ancladas nunca ocupan más que esta fracción del ancho visible:
 *  si Descripción se agranda (a mano o con doble clic sobre una descripción
 *  larguísima), al scrollear en X taparía todo el resto de la grilla. */
const MAX_ANCLADAS = 0.45;
const MAX_DESCRIPCION_AUTOFIT = 480;
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

/** Valor de la celda para el filtro de columna (lo que se ve en la grilla). */
function valorFiltro(f: Fila, c: ColumnaPlan, sinCompra: string): ValorFiltro {
  const v = valorDe(f, c.clave);
  if (esNumerica(c)) {
    if (v == null) {
      // % calculado sin valor = texto del SI.ERROR; dato numérico vacío = 0.
      if (esCalculada(c.clave)) {
        const txt = c.clave === "analisis" ? sinCompra : "Sin Datos";
        return { clave: `t:${txt}`, label: txt, num: null };
      }
      return { clave: "0", label: "0", num: 0 };
    }
    const n = v as number;
    return { clave: String(n), label: n === 0 ? "0" : formatear(c, n), num: n };
  }
  const t = v == null || v === "" ? null : String(v);
  return t == null ? { clave: "∅", label: "(Vacías)", num: null } : { clave: t, label: t, num: null };
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
    recorte:        plan?.formulas?.recorte === "gd_menos_aprobadas" ? `${e("gd")} − ${e("cant_aprobadas")}` : `${e("cant_aprobadas")} − ${e("gd")}`,
    analisis:       `${e("total")} / ${e(plan?.formulas?.analisis === "ppc_anterior" ? "ppc_anterior" : "max_hist")} − 1`,
    analisis_cons:  `${e("consumo_promedio")} − ${e("pendientes")} − ${e("stock")}`,
    analisis2:      `${e("gd")} − ${e("stock")} − ${e("pendientes")}`,
    pu_sic_mas:     `REDONDEAR(MAX(${e("pu_sic")}; ${e("pu_op")}) × ${mayor}; 0)`,
    pu_est_pesos:   `REDONDEAR.MAS(${e("pu_est_usd")} × TC ${tc}; 0)`,
    verif_precio:   `${e("pu_est_pesos")} / ${e("pu_sic_mas")} − 1`,
    total_plan:     `${e("pu_est_pesos")} × ${e("gd")}`,
    incidencia:     `${e("total_plan")} / total de las filas visibles`,
    total_ajustado: `${e("pu_ajustado")} × ${e("cant_aprobadas")} (salvo que el monto se haya escrito a mano: entonces va en blanco, no en verde)`,
    dif_pu:         `${e("pu_ajustado")} / ${e("pu_est_pesos")} − 1`,
    dif_global:     `${e("total_ajustado")} / ${e("total_plan")} − 1`,
  };
}

// ─── Fila de la grilla (memo: al scrollear solo se montan las nuevas) ────────

/** Valor pegado o escrito que no pasó la validación (estado Error, §4.4). */
interface ErrCelda { texto: string; error: string }

interface FilaProps {
  fila:        Fila;
  cols:        ColumnaPlan[];
  inicioGrupo: Set<ClaveColumna>;
  template:    string;
  anclaX:      Partial<Record<ClaveColumna, number>>;
  top:         number;
  h:           number;
  /** Celda seleccionada en ESTA fila (null en el resto: no se re-renderizan). */
  selK:        ClaveColumna | null;
  /** Input de edición, si se está editando la celda seleccionada. */
  editor:      ReactNode;
  errs:        Partial<Record<ClaveColumna, ErrCelda>> | undefined;
  editable:    boolean;
  nombres:     Map<string, string>;
  totalVis:    number;
  sinCompra:   string;
}

function quienEdito(it: PlanComprasItem, nombres: Map<string, string>): string {
  if (!it.editado_at) return "";
  const quien = it.editado_por ? nombres.get(it.editado_por) ?? "otro usuario" : "alguien";
  const cuando = new Date(it.editado_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return `Editado por ${quien} el ${cuando}`;
}

const FilaGrilla = memo(function FilaGrilla({
  fila, cols, inicioGrupo, template, anclaX, top, h, selK, editor, errs, editable, nombres, totalVis, sinCompra,
}: FilaProps) {
  const sel = selK != null;
  return (
    <div
      data-id={fila.it.id}
      className={`ido-table-row grid ${sel ? "ido-row-selected" : ""}`}
      style={{
        gridTemplateColumns: template, position: "absolute", top: 0, left: 0, width: "100%",
        height: h, transform: `translateY(${top}px)`, fontSize: 12.5,
        borderBottom: "1px solid var(--ido-row-line)",
      }}
    >
      {cols.map((c, i) => {
        const k = c.clave;
        // Total Ajustado escrito a mano es un dato (no va en verde itálica).
        const manual = k === "total_ajustado" && fila.it.total_ajustado_dato != null;
        const calc = esCalculada(k) && !manual;
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
        if (editable && !esEditable(k)) cls += " is-bloq";
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
              if (manual) {
                const cuenta = (fila.it.pu_ajustado ?? 0) * (fila.it.cant_aprobadas ?? 0);
                title += `\nEscrito a mano (PU ajustado × CANT. APROBADAS daría ${F_EXACT.format(cuenta)}). Supr vuelve al cálculo.`;
              }
              if (calc && c.formato === "pct" && v < 0) cls += " is-neg";
            }
          } else {
            contenido = <span>{v}</span>;
            title = v;
          }
        }
        // ── Estados de celda (§4.4) ────────────────────────────────────────
        const err = errs?.[k];
        if (err) {
          cls += " is-err";
          contenido = <span>{err.texto}</span>;
          title = `${err.error}. Escribí un valor válido o tocá Supr para vaciarla.`;
        }
        if (esEditable(k) && estaModificada(fila.it, k)) {
          cls += " is-mod";
          const quien = quienEdito(fila.it, nombres);
          title = `${title ?? ""}\nModificada · valor importado: ${textoImportado(fila.it, k)}${quien ? `\n${quien}` : ""}`.trim();
        } else if (k === "articulo" && fila.it.editado_at) {
          title = `${title ?? ""}\n${quienEdito(fila.it, nombres)}`.trim();
        }
        if (selK === k) {
          cls += " is-sel";
          if (editor) { cls += " is-editando"; contenido = editor; title = undefined; }
        }
        return (
          <div key={k} data-k={k} className={cls} style={style} title={title}>
            {contenido}
          </div>
        );
      })}
    </div>
  );
});

// ─── Menú de clic derecho (§4.5) ─────────────────────────────────────────────

function ItemMenu({ icon: Icon, label, atajo, disabled, title, onClick }: {
  icon: React.ElementType; label: string; atajo?: string; disabled?: boolean; title?: string; onClick: () => void;
}) {
  return (
    <div
      role="menuitem"
      aria-disabled={disabled}
      className="ido-menu-item ido-ctx-item"
      title={title}
      onClick={disabled ? undefined : onClick}
      style={{ cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1 }}
    >
      <Icon className="ido-ctx-icon w-3.5 h-3.5 shrink-0" />
      <span style={{ flex: 1 }}>{label}</span>
      {atajo && <span className="ido-menu-shortcut">{atajo}</span>}
    </div>
  );
}

// ─── Indicador de guardado (§4.10) ───────────────────────────────────────────

function IndicadorGuardado({ estado, error, editable, puedeEditar, onReintentar }: {
  estado: "idle" | "pendiente" | "guardando" | "guardado" | "error";
  error: string | null;
  editable: boolean;
  puedeEditar: boolean;
  onReintentar: () => void;
}) {
  if (!puedeEditar) {
    return (
      <span className="pc-guardado" title="Tu usuario es de nivel visualizador: puede ver el plan pero no editarlo.">
        <Lock className="w-3.5 h-3.5" />Solo lectura
      </span>
    );
  }
  if (!editable) return null;
  switch (estado) {
    case "pendiente":
      return <span className="pc-guardado" title="Se guardan solos a los 2 segundos del último cambio"><span className="pc-guardado-punto" />Cambios sin guardar</span>;
    case "guardando":
      return <span className="pc-guardado"><Loader2 className="w-3.5 h-3.5 animate-spin" />Guardando…</span>;
    case "guardado":
      return <span className="pc-guardado is-ok"><Check className="w-3.5 h-3.5" />Guardado</span>;
    case "error":
      return (
        <span className="pc-guardado is-error" title={error ?? undefined}>
          <AlertTriangle className="w-3.5 h-3.5" />No se guardó
          <button type="button" className="ido-btn ido-btn-text" style={{ height: 24, padding: "0 6px" }} onClick={onReintentar}>Reintentar</button>
        </span>
      );
    default:
      return null;
  }
}

/**
 * Ancho mínimo de la columna que queda de un grupo colapsado para que entre su
 * etiqueta: marca + nombre (9px, mayúsculas, espaciado .18em ≈ 7,6px por
 * letra) + «+N» (mono) + botón de expandir + huecos y padding.
 */
function anchoGrupoColapsado(titulo: string, ocultas: number): number {
  const nombre = Math.ceil(titulo.length * 7.6);
  const contador = (String(ocultas).length + 1) * 6;
  return 16 /* padding */ + 2 + nombre + contador + 20 /* botón */ + 3 * 6 /* gaps */;
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
  const [eliminando, setEliminando] = useState(false);

  const plan = useMemo(() => planes.find((p) => p.id === planId) ?? null, [planes, planId]);

  // ── Edición: permisos, columnas en la base y autoguardado (§4.10) ─────────
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [edicionOk, setEdicionOk] = useState(true);
  const editable = puedeEditar && edicionOk;
  const [nombres, setNombres] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    puedeEditarPlan().then((r) => setPuedeEditar(r.puede)).catch(() => setPuedeEditar(false));
    nombresUsuarios().then(setNombres).catch(() => {});
  }, []);

  // Las ediciones se aplican al estado al instante (las fórmulas recalculan)
  // y se guardan solas a los 2 s del último cambio. `pendientes` = filas con
  // cambios sin guardar; la versión evita borrar de la cola una fila que se
  // volvió a editar mientras se guardaba.
  type EstadoGuardado = "idle" | "pendiente" | "guardando" | "guardado" | "error";
  // Celda seleccionada (por id de fila: sobrevive a filtros y orden), edición
  // en curso y valores inválidos (§4.4 Error).
  const [celda, setCelda] = useState<{ id: string; k: ClaveColumna } | null>(null);
  const [edit, setEdit] = useState<{ texto: string; error: string | null } | null>(null);
  // La edición ya se cerró por teclado (Enter/Tab/Esc): el blur que sigue al
  // devolver el foco a la grilla no tiene que volver a confirmarla.
  const editCerrado = useRef(false);
  const [errores, setErrores] = useState<Record<string, Partial<Record<ClaveColumna, ErrCelda>>>>({});
  const [guardado, setGuardado] = useState<EstadoGuardado>("idle");
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const itemsRef = useRef<PlanComprasItem[]>([]);
  const pendientes = useRef(new Map<string, { claves: Set<string>; version: number }>());
  const guardandoRef = useRef(false);
  const otraVez = useRef(false);
  const timerGuardar = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerGuardado = useRef<ReturnType<typeof setTimeout> | null>(null);
  // true mientras los cambios de `items` sean ediciones (no una carga): la
  // grilla mantiene el orden y las filas visibles, como Excel, en vez de
  // reordenar / sacar la fila que se acaba de editar.
  const soloEdiciones = useRef(false);

  const guardar = useCallback(async () => {
    if (timerGuardar.current) { clearTimeout(timerGuardar.current); timerGuardar.current = null; }
    if (guardandoRef.current) { otraVez.current = true; return; }
    const snap = [...pendientes.current.entries()].map(([id, p]) => ({ id, version: p.version, claves: [...p.claves] }));
    if (!snap.length) return;
    guardandoRef.current = true;
    setGuardado("guardando");
    try {
      const porId = new Map(itemsRef.current.map((it) => [it.id, it]));
      const cambios = snap.flatMap((c) => { const it = porId.get(c.id); return it ? [{ it, claves: c.claves }] : []; });
      const uid = userIdRef.current;
      const ahora = await guardarEdiciones(cambios, uid);
      for (const c of snap) if (pendientes.current.get(c.id)?.version === c.version) pendientes.current.delete(c.id);
      const ids = new Set(snap.map((c) => c.id));
      soloEdiciones.current = true;
      itemsRef.current = itemsRef.current.map((it) => (ids.has(it.id) ? { ...it, editado_por: uid, editado_at: ahora } : it));
      setItems(itemsRef.current);
      const pid = itemsRef.current[0]?.plan_id;
      if (pid) { actualizarItemsCache(pid, itemsRef.current); void refrescarFirma(pid); }
      setErrorGuardado(null);
      if (pendientes.current.size) {
        setGuardado("pendiente");
      } else {
        setGuardado("guardado");
        if (timerGuardado.current) clearTimeout(timerGuardado.current);
        timerGuardado.current = setTimeout(() => setGuardado((g) => (g === "guardado" ? "idle" : g)), 1500);
      }
    } catch (e) {
      setGuardado("error");
      setErrorGuardado(e instanceof Error ? e.message : mensajeErrorPlan(e));
    } finally {
      guardandoRef.current = false;
      if (otraVez.current || (pendientes.current.size && !timerGuardar.current)) {
        otraVez.current = false;
        if (pendientes.current.size) timerGuardar.current = setTimeout(() => void guardar(), 2000);
      }
    }
  }, []);

  /** Aplica filas editadas: estado al instante + cola de guardado. */
  const aplicarEdiciones = useCallback((nuevas: Map<string, { it: PlanComprasItem; claves: Set<string> }>) => {
    if (!nuevas.size) return;
    soloEdiciones.current = true;
    itemsRef.current = itemsRef.current.map((it) => nuevas.get(it.id)?.it ?? it);
    setItems(itemsRef.current);
    // Resumen ve las ediciones sin recargar (caché compartida).
    const pid = itemsRef.current[0]?.plan_id;
    if (pid) actualizarItemsCache(pid, itemsRef.current);
    for (const [id, { claves }] of nuevas) {
      const p = pendientes.current.get(id) ?? { claves: new Set<string>(), version: 0 };
      for (const k of claves) p.claves.add(k);
      p.version++;
      pendientes.current.set(id, p);
    }
    setGuardado("pendiente");
    if (timerGuardar.current) clearTimeout(timerGuardar.current);
    timerGuardar.current = setTimeout(() => void guardar(), 2000);
  }, [guardar]);

  // Cerrar la pestaña con cambios sin guardar: el navegador pregunta.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (pendientes.current.size || guardandoRef.current) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", h);
    // Al salir de la sección se guarda lo que haya quedado en la cola.
    return () => { window.removeEventListener("beforeunload", h); if (pendientes.current.size) void guardar(); };
  }, [guardar]);

  // Pedido en curso: si se cambia de plan a mitad de la carga, la respuesta
  // vieja no tiene que pisar la nueva.
  const pedido = useRef(0);
  const ponerItems = (items: PlanComprasItem[], edicion: boolean) => {
    soloEdiciones.current = false;
    itemsRef.current = items;
    setItems(items);
    setEdicionOk(edicion);
    setCelda(null);
    setEdit(null);
    setErrores({});
  };

  /**
   * Carga el plan. Si está en la caché (se cargó antes en esta pestaña, acá o
   * en Resumen) aparece al instante y se revalida en segundo plano; `forzar`
   * (botón Actualizar, importación) va siempre a la base.
   */
  const cargar = useCallback(async (preferido?: string, forzar = false) => {
    // Primero se guarda lo pendiente: recargar lo pisaría.
    if (pendientes.current.size || guardandoRef.current) {
      await guardar();
      if (pendientes.current.size) {
        toast.error("Hay cambios sin guardar: reintentá el guardado antes de actualizar.");
        return;
      }
    }
    const yo = ++pedido.current;
    setError(null);
    setProgreso(null);

    // ── Camino rápido: caché ────────────────────────────────────────────────
    const psCache = planesEnCache();
    const pidCache = preferido ?? planElegido() ?? psCache?.[0]?.id ?? null;
    const enCache = !forzar && psCache && pidCache && psCache.some((p) => p.id === pidCache) ? itemsEnCache(pidCache) : null;
    if (enCache && psCache && pidCache) {
      setPlanes(psCache);
      setPlanId(pidCache);
      recordarPlan(pidCache);
      ponerItems(enCache.items, enCache.edicion);
      setCargando(false);
      // Revalidación: ¿cambió la lista de planes o alguien editó/reimportó?
      try {
        const [ps, cambio] = await Promise.all([listPlanes(), planCambio(pidCache)]);
        if (yo !== pedido.current) return;
        guardarPlanesCache(ps);
        setPlanes(ps);
        if (!ps.some((p) => p.id === pidCache)) { void cargar(undefined, true); return; }
        if (cambio && !pendientes.current.size) {
          const r = await cargarItemsPlan(pidCache);
          if (yo !== pedido.current || pendientes.current.size) return;
          ponerItems(r.items, r.edicion);
          toast.info("El plan tenía cambios hechos desde otra sesión: se actualizó.", { id: "pc-revalidado" });
        }
      } catch { /* se sigue con lo que hay en memoria */ }
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
      if (!elegido) { itemsRef.current = []; setItems([]); return; }
      const r = await cargarItemsPlan(elegido.id, (n, total) => {
        if (yo === pedido.current) setProgreso({ n, total });
      });
      if (yo !== pedido.current) return;
      ponerItems(r.items, r.edicion);
    } catch (e) {
      if (yo === pedido.current) setError(mensajeErrorPlan(e));
    } finally {
      if (yo === pedido.current) { setCargando(false); setProgreso(null); }
    }
  }, [guardar]);
  useEffect(() => { cargar(); }, [cargar]);

  const elegirPlan = (id: string) => { if (id !== planId) cargar(id); };

  /** Borra el plan que se está viendo y pasa al siguiente año disponible. */
  const confirmarEliminar = async () => {
    if (!plan) return;
    // Lo pendiente se guarda antes: si no, se intentaría guardar sobre un plan borrado.
    if (pendientes.current.size || guardandoRef.current) {
      await guardar();
      if (pendientes.current.size) throw new Error("Hay cambios sin guardar que no se pudieron guardar: reintentá antes de eliminar.");
    }
    await eliminarPlan(plan.id);
    olvidarPlan(plan.id);
    if (planElegido() === plan.id) recordarPlan(null);
    guardarPlanesCache((planesEnCache() ?? []).filter((p) => p.id !== plan.id));
    setEliminando(false);
    toast.success(`Plan ${plan.anio} eliminado`);
    void cargar(undefined, true);
  };

  const onImportado = (p: PlanCompras, imp: ImportacionPlan) => {
    setImportando(false);
    toast.success(`Plan ${p.anio} importado: ${imp.items.length.toLocaleString("es-AR")} filas`);
    cargar(p.id, true);
  };

  // ── Etiquetas: el encabezado real del Excel de este plan ──────────────────
  const etiqueta = useCallback(
    (k: ClaveColumna) => plan?.etiquetas?.[k] ?? ETIQUETAS_DEFAULT[k],
    [plan],
  );
  const tooltipsFormula = useMemo(() => formulas(etiqueta, plan), [etiqueta, plan]);

  // ── Filas con sus cálculos ─────────────────────────────────────────────────
  // Cache por objeto ítem: al editar una celda solo se recalcula esa fila (y
  // el resto de las filas conserva su objeto, así su memo no se re-renderiza).
  const cacheFilas = useRef<{ clave: string; m: WeakMap<PlanComprasItem, Fila> }>({ clave: "", m: new WeakMap() });
  const filas = useMemo<Fila[]>(() => {
    if (!plan) return [];
    const params = { tipo_cambio: plan.tipo_cambio, pct_mayoracion: plan.pct_mayoracion, formulas: plan.formulas };
    const clave = `${plan.id}|${plan.tipo_cambio}|${plan.pct_mayoracion}|${JSON.stringify(plan.formulas ?? {})}`;
    if (cacheFilas.current.clave !== clave) cacheFilas.current = { clave, m: new WeakMap() };
    const m = cacheFilas.current.m;
    return items.map((it) => {
      let f = m.get(it);
      if (!f) {
        f = { it, c: calcularFila(it, params), busq: normBusq(`${it.articulo ?? ""} ${it.descripcion ?? ""}`) };
        m.set(it, f);
      }
      return f;
    });
  }, [items, plan]);

  // ── Filtros (§4.8) ─────────────────────────────────────────────────────────
  const [busqueda, setBusqueda] = useState("");
  const busquedaDiferida = useDeferredValue(busqueda);
  const [aCargo, setACargo] = useState("__todos");
  const [familia, setFamilia] = useState("__todos");
  const [soloDemanda, setSoloDemanda] = useState(false);
  // Filtros de columna estilo Excel (por clave). Estado de sesión (§4.20).
  const [filtrosCol, setFiltrosCol] = useState<Partial<Record<ClaveColumna, FiltroColumna>>>({});
  const [menuCol, setMenuCol] = useState<ClaveColumna | null>(null);

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

  // Texto del SI.ERROR de Análisis: «No se compró en 2023» (vs MAX histórico,
  // 2026) o «… en 2026» (vs PPC del año anterior, 2027).
  const sinCompra = textoSinCompra(etiqueta(plan?.formulas?.analisis === "ppc_anterior" ? "ppc_anterior" : "max_hist"));

  // Filtros de la barra + de columna. `excluir` deja afuera el filtro de una
  // columna: el menú de esa columna lista los valores de las filas que pasan
  // los DEMÁS filtros, como el autofiltro de Excel.
  const pasaFiltros = useMemo(() => {
    const q = normBusq(busquedaDiferida.trim());
    const activos = (Object.entries(filtrosCol) as [ClaveColumna, FiltroColumna][])
      .filter(([, f]) => f)
      .map(([k, f]) => ({ k, f, col: COLUMNAS.find((c) => c.clave === k)!, set: f.valores ? new Set(f.valores) : undefined }));
    return (f: Fila, excluir?: ClaveColumna) => {
      if (aCargo !== "__todos" && f.it.a_cargo_de !== aCargo) return false;
      if (familia !== "__todos" && f.it.familia !== familia) return false;
      // «Con cantidades»: pedido, neto o aprobado. Solo TOTAL/GD dejaría
      // afuera las filas aprobadas que nadie pidió este año.
      if (soloDemanda && f.c.total === 0 && f.c.gd === 0 && !f.it.cant_aprobadas) return false;
      if (q && !f.busq.includes(q)) return false;
      for (const a of activos) {
        if (a.k === excluir) continue;
        if (!pasaFiltro(a.f, valorFiltro(f, a.col, sinCompra), a.set)) return false;
      }
      return true;
    };
  }, [aCargo, familia, soloDemanda, busquedaDiferida, filtrosCol, sinCompra]);

  // Orden y filas visibles congelados mientras solo haya ediciones (como
  // Excel: editar no reordena ni esconde la fila hasta volver a filtrar).
  const ordenPrevio = useRef<{ deps: unknown[]; ids: string[] } | null>(null);
  const filtradas = useMemo(() => {
    const deps: unknown[] = [pasaFiltros, sortKey, sortDir, plan?.id];
    const prev = ordenPrevio.current;
    if (soloEdiciones.current && prev && prev.deps.length === deps.length && prev.deps.every((d, i) => d === deps[i])) {
      const porId = new Map(filas.map((f) => [f.it.id, f]));
      return prev.ids.flatMap((id) => { const f = porId.get(id); return f ? [f] : []; });
    }
    const out = calcularFiltradas();
    ordenPrevio.current = { deps, ids: out.map((f) => f.it.id) };
    return out;

    function calcularFiltradas() {
    const out = filas.filter((f) => pasaFiltros(f));
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
    }
  }, [filas, pasaFiltros, sortKey, sortDir, plan?.id]);

  // Valores del menú de la columna abierta (solo se calcula con el menú abierto).
  const opcionesMenu = useMemo<OpcionValor[]>(() => {
    if (!menuCol) return [];
    const col = COLUMNAS.find((c) => c.clave === menuCol)!;
    const cnt = new Map<string, OpcionValor & { num: number | null }>();
    for (const f of filas) {
      if (!pasaFiltros(f, menuCol)) continue;
      const v = valorFiltro(f, col, sinCompra);
      const o = cnt.get(v.clave);
      if (o) o.n++; else cnt.set(v.clave, { clave: v.clave, label: v.label, n: 1, num: v.num });
    }
    const lista = [...cnt.values()];
    if (esNumerica(col)) {
      // Números de menor a mayor; los textos (Sin Datos…) al final.
      lista.sort((a, b) => (a.num == null ? 1 : b.num == null ? -1 : a.num - b.num));
    } else {
      lista.sort((a, b) => (a.clave === "∅" ? 1 : b.clave === "∅" ? -1 : COLLATOR.compare(a.label, b.label)));
    }
    return lista;
  }, [menuCol, filas, pasaFiltros, sinCompra]);

  const filtrosActivos = (Object.entries(filtrosCol) as [ClaveColumna, FiltroColumna][]).filter(([, f]) => f);
  const aplicarFiltroCol = (k: ClaveColumna, f: FiltroColumna | null) =>
    setFiltrosCol((prev) => {
      const next = { ...prev };
      if (f) next[k] = f; else delete next[k];
      return next;
    });

  const totales = useMemo(() => {
    let vis = 0, visAj = 0, todo = 0;
    for (const f of filtradas) { vis += f.c.total_plan; visAj += f.c.total_ajustado; }
    for (const f of filas) todo += f.c.total_plan;
    return { vis, visAj, todo };
  }, [filtradas, filas]);

  const hayFiltro = aCargo !== "__todos" || familia !== "__todos" || soloDemanda || busquedaDiferida.trim() !== "" || filtrosActivos.length > 0;
  const limpiarFiltros = () => { setBusqueda(""); setACargo("__todos"); setFamilia("__todos"); setSoloDemanda(false); setFiltrosCol({}); };

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
  // Cada plan muestra las columnas que trajo su Excel (el 2027 cambió el
  // histórico 2023P…MAX por SIC's / PPC del año anterior).
  const colsDelPlan = useMemo(() => COLUMNAS.filter((c) => columnaEnPlan(c, plan?.etiquetas)), [plan]);
  const colsDeGrupo = useCallback((g: GrupoId) => colsDelPlan.filter((c) => c.grupo === g), [colsDelPlan]);
  /** Se colapsa solo si su columna resumen es de este plan (MAX no está en el 2027). */
  const colapsable = useCallback((g: GrupoPlan) => !!g.resumen && colsDelPlan.some((c) => c.clave === g.resumen), [colsDelPlan]);

  const gruposVisibles = useMemo(() => {
    const out: { g: GrupoPlan; cols: ColumnaPlan[]; colapsado: boolean }[] = [];
    for (const g of GRUPOS) {
      if (ocultos.has(g.id)) continue;
      const todas = colsDeGrupo(g.id);
      if (!todas.length) continue;
      const colapsado = colapsable(g) && colapsados.has(g.id);
      out.push({ g, cols: colapsado ? todas.filter((c) => c.clave === g.resumen) : todas, colapsado });
    }
    return out;
  }, [ocultos, colapsados, colsDeGrupo, colapsable]);

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
    // Grupo colapsado: su única columna se ensancha lo justo para que entre
    // la etiqueta «ZONA A +6» (si no, quedaba solo el «+6» y no se sabía qué
    // estaba oculto).
    for (const g of GRUPOS) {
      if (!g.resumen || !colapsados.has(g.id) || !(g.resumen in w)) continue;
      const ocultas = colsDeGrupo(g.id).length - 1;
      w[g.resumen] = Math.max(w[g.resumen], anchoGrupoColapsado(g.titulo, ocultas));
    }
    if (colW[ABSORBE] == null) {
      const usado = cols.reduce((s, c) => s + w[c.clave], 0);
      w[ABSORBE] += Math.max(0, availW - usado);
    }
    // Tope de las ancladas: Descripción cede lo que se pase (nunca menos de
    // su ancho natural).
    if (availW > 0) {
      const tope = Math.max(availW * MAX_ANCLADAS, w.articulo + COLUMNAS[1].ancho);
      const exceso = ANCLADAS.reduce((s, k) => s + w[k], 0) - tope;
      if (exceso > 0) w[ABSORBE] = Math.max(COLUMNAS[1].ancho, w[ABSORBE] - exceso);
    }
    return w;
  }, [cols, colW, availW, colapsados]);
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
    let w = Math.max(fit, labelW);
    if (c.clave === ABSORBE) w = Math.min(w, MAX_DESCRIPCION_AUTOFIT);
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

  // ── Selección de celda y teclado (§4.4) ───────────────────────────────────
  const idxFila = useMemo(() => new Map(filtradas.map((f, i) => [f.it.id, i])), [filtradas]);
  const idxCol = useMemo(() => new Map(cols.map((c, i) => [c.clave, i])), [cols]);
  const colLeftX = (k: ClaveColumna) => colRightX(k) - anchos[k];

  const enfocarGrilla = () => scrollRef.current?.focus({ preventScroll: true });

  /** Lleva la celda a la vista (el encabezado sticky y las ancladas tapan). */
  const mostrarCelda = (r: number, k: ClaveColumna) => {
    const el = scrollRef.current;
    if (!el) return;
    const cab = GRUPO_H + HEADER_H + 1;
    const top = cab + r * ROW_H;
    if (top < el.scrollTop + cab) el.scrollTop = top - cab;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
    if (anclaX[k] != null) return;
    const left = colLeftX(k), right = left + anchos[k];
    if (left < el.scrollLeft + anchoAnclado) el.scrollLeft = left - anchoAnclado;
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
  };

  const irA = (r: number, c: number) => {
    if (!filtradas.length || !cols.length) return;
    const rr = Math.max(0, Math.min(filtradas.length - 1, r));
    const cc = Math.max(0, Math.min(cols.length - 1, c));
    const k = cols[cc].clave;
    setCelda({ id: filtradas[rr].it.id, k });
    mostrarCelda(rr, k);
  };

  const posActual = () => {
    if (!celda) return null;
    const r = idxFila.get(celda.id), c = idxCol.get(celda.k);
    return r == null || c == null ? null : { r, c };
  };

  // Si la celda seleccionada desaparece (filtro, columna oculta), se suelta.
  useEffect(() => {
    if (celda && (!idxFila.has(celda.id) || !idxCol.has(celda.k))) { setCelda(null); setEdit(null); }
  }, [celda, idxFila, idxCol]);

  const avisoNoEditable = (k: ClaveColumna) => {
    if (!puedeEditar) { toast.info("Tu usuario es de solo lectura: no puede editar el plan.", { id: "pc-solo-lectura" }); return; }
    if (!edicionOk) { toast.info("Para editar falta correr el bloque «Edición» de supabase/plan_compras.sql.", { id: "pc-sin-sql" }); return; }
    toast.info(
      k === "articulo" ? "El artículo identifica la fila: no se edita." : `«${etiqueta(k)}» es una fórmula: se calcula sola.`,
      { id: "pc-bloqueada" },
    );
  };

  const filaPorId = (id: string) => itemsRef.current.find((it) => it.id === id) ?? null;

  /** Empieza a editar la celda seleccionada (con un texto inicial o el valor actual). */
  const empezarEdicion = (inicial?: string) => {
    if (!celda) return;
    if (!editable || !esEditable(celda.k)) { avisoNoEditable(celda.k); return; }
    const it = filaPorId(celda.id);
    if (!it) return;
    const err = errores[celda.id]?.[celda.k];
    editCerrado.current = false;
    // Total Ajustado arranca con lo que se ve (el monto escrito o el calculado).
    const actual = celda.k === "total_ajustado"
      ? filas.find((f) => f.it.id === it.id)?.c.total_ajustado ?? null
      : valorCelda(it, claveDato(celda.k)!);
    setEdit({ texto: inicial ?? err?.texto ?? textoDeValor(actual), error: null });
  };

  const quitarError = (id: string, k: ClaveColumna) =>
    setErrores((prev) => {
      if (!prev[id]?.[k]) return prev;
      const fila = { ...prev[id] };
      delete fila[k];
      const next = { ...prev };
      if (Object.keys(fila).length) next[id] = fila; else delete next[id];
      return next;
    });

  /** Pone un valor (ya validado) en una celda. */
  const ponerValor = (id: string, k: ClaveColumna, valor: Valor) => {
    if (!esEditable(k)) return;
    const it = filaPorId(id);
    if (!it) return;
    quitarError(id, k);
    const nueva = conCambio(it, k, valor);
    if (nueva) aplicarEdiciones(new Map([[id, { it: nueva, claves: new Set([claveDato(k)!, ...Object.keys(it.importado ?? {})]) }]]));
  };

  /** Confirma la edición. Devuelve el error si el valor no es válido (y
   *  queda editando, en rojo); null si se aplicó. */
  const confirmarEdicion = (): string | null => {
    if (!celda || !edit || !esEditable(celda.k)) { setEdit(null); return null; }
    const r = parseValor(celda.k, edit.texto);
    if (!r.ok) { setEdit({ ...edit, error: r.error }); return r.error; }
    ponerValor(celda.id, celda.k, r.valor);
    setEdit(null);
    return null;
  };

  const vaciar = () => {
    if (!celda) return;
    if (!editable || !esEditable(celda.k)) { avisoNoEditable(celda.k); return; }
    ponerValor(celda.id, celda.k, null);
  };

  const restaurar = () => {
    if (!celda || !editable || !esEditable(celda.k)) return;
    const it = filaPorId(celda.id);
    const nueva = it ? restaurada(it, celda.k) : null;
    quitarError(celda.id, celda.k);
    if (it && nueva) aplicarEdiciones(new Map([[it.id, { it: nueva, claves: new Set([claveDato(celda.k)!]) }]]));
  };

  /** Texto de la celda para copiar (número sin miles y con coma decimal). */
  const textoCopia = (id: string, k: ClaveColumna): string => {
    const f = filas.find((x) => x.it.id === id);
    if (!f) return "";
    if (k === "incidencia") return textoDeValor(incidencia(f.c.total_plan, totales.vis));
    const v = valorDe(f, k);
    if (v == null && esCalculada(k)) return k === "analisis" ? sinCompra : k === "dif_pu" || k === "dif_global" ? "Sin Datos" : "";
    return textoDeValor(v as Valor);
  };

  /** Pega un bloque (texto con tabuladores y saltos de línea, como lo copia Excel). */
  const pegar = (texto: string) => {
    const pos = posActual();
    if (!pos) return;
    if (!editable) { avisoNoEditable(cols[pos.c].clave); return; }
    const bloque = parseTsv(texto);
    if (!bloque.length) return;
    const ancho = Math.max(...bloque.map((f) => f.length));
    const destino = cols.slice(pos.c, pos.c + ancho);
    // Con grupos colapsados u ocultos en el medio, el bloque caería corrido
    // respecto de las columnas del Excel.
    const iCol = destino.map((c) => COLUMNAS.indexOf(c));
    if (iCol.some((v, i) => i > 0 && v !== iCol[i - 1] + 1)) {
      toast.error("Hay columnas colapsadas u ocultas dentro del rango a pegar: expandilas antes, así el bloque no queda corrido.");
      return;
    }
    const nuevas = new Map<string, { it: PlanComprasItem; claves: Set<string> }>();
    const nuevosErr: Record<string, Partial<Record<ClaveColumna, ErrCelda>>> = {};
    const limpiarErr: { id: string; k: ClaveColumna }[] = [];
    let pegadas = 0, formulas = 0, invalidas = 0, fuera = 0;
    bloque.forEach((filaTxt, r) => {
      const f = filtradas[pos.r + r];
      if (!f) { fuera++; return; }
      filaTxt.forEach((txt, c) => {
        const col = destino[c];
        if (!col) return;
        const k = col.clave;
        if (!esEditable(k)) { formulas++; return; }
        const p = parseValor(k, txt);
        if (!p.ok) {
          (nuevosErr[f.it.id] ??= {})[k] = { texto: txt.trim(), error: p.error };
          invalidas++;
          return;
        }
        const base = nuevas.get(f.it.id)?.it ?? filaPorId(f.it.id);
        if (!base) return;
        limpiarErr.push({ id: f.it.id, k });
        const nueva = conCambio(base, k, p.valor);
        pegadas++;
        if (!nueva) return;
        const e = nuevas.get(f.it.id) ?? { it: base, claves: new Set<string>(Object.keys(base.importado ?? {})) };
        e.it = nueva;
        e.claves.add(claveDato(k)!);
        nuevas.set(f.it.id, e);
      });
    });
    setErrores((prev) => {
      const next = { ...prev };
      for (const { id, k } of limpiarErr) {
        if (!next[id]?.[k]) continue;
        const fila = { ...next[id] };
        delete fila[k];
        if (Object.keys(fila).length) next[id] = fila; else delete next[id];
      }
      for (const [id, e] of Object.entries(nuevosErr)) next[id] = { ...(next[id] ?? {}), ...e };
      return next;
    });
    aplicarEdiciones(nuevas);
    const partes = [`${pegadas.toLocaleString("es-AR")} celdas pegadas`];
    if (formulas) partes.push(`${formulas.toLocaleString("es-AR")} salteadas (fórmulas o Artículo)`);
    if (invalidas) partes.push(`${invalidas.toLocaleString("es-AR")} con valores inválidos (en rojo)`);
    if (fuera) partes.push(`${fuera.toLocaleString("es-AR")} filas del bloque no entraron (no hay más filas visibles)`);
    (invalidas || fuera ? toast.warning : toast.success)(partes.join(" · "));
  };

  // ── Menú de clic derecho (§4.5) ───────────────────────────────────────────
  const [menuCtx, setMenuCtx] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menuCtx) return;
    const cerrar = () => setMenuCtx(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    window.addEventListener("mousedown", cerrar);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", cerrar);
    window.addEventListener("wheel", cerrar, { passive: true });
    // Solo un scroll real cierra el menú: el foco que toma la grilla al hacer
    // clic derecho dispara un evento de scroll sin moverla.
    const sc = scrollRef.current;
    const x0 = sc?.scrollLeft ?? 0, y0 = sc?.scrollTop ?? 0;
    const onScroll = () => {
      if (sc && (Math.abs(sc.scrollLeft - x0) > 2 || Math.abs(sc.scrollTop - y0) > 2)) cerrar();
    };
    sc?.addEventListener("scroll", onScroll);
    return () => {
      window.removeEventListener("mousedown", cerrar);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", cerrar);
      window.removeEventListener("wheel", cerrar);
      sc?.removeEventListener("scroll", onScroll);
    };
  }, [menuCtx]);

  const copiarAlPortapapeles = async () => {
    if (!celda) return;
    try { await navigator.clipboard.writeText(textoCopia(celda.id, celda.k)); }
    catch { toast.error("El navegador no dejó copiar: usá Ctrl+C."); }
  };
  const pegarDelPortapapeles = async () => {
    try { pegar(await navigator.clipboard.readText()); }
    catch { toast.error("El navegador no dejó leer el portapapeles: usá Ctrl+V."); }
  };

  // ── Eventos de la grilla ───────────────────────────────────────────────────
  const celdaDeEvento = (e: React.MouseEvent): { id: string; k: ClaveColumna } | null => {
    const cel = (e.target as HTMLElement).closest<HTMLElement>("[data-k]");
    const fila = cel?.closest<HTMLElement>("[data-id]");
    if (!cel || !fila) return null;
    return { id: fila.dataset.id!, k: cel.dataset.k as ClaveColumna };
  };

  const onMouseDownGrilla = (e: React.MouseEvent) => {
    const c = celdaDeEvento(e);
    if (!c) return;
    if (edit && celda && (celda.id !== c.id || celda.k !== c.k)) {
      // Clic en otra celda: confirma la edición (si es inválida, cancela).
      editCerrado.current = true;
      const err = confirmarEdicion();
      if (err) { toast.error(`${err}: no se guardó.`, { id: "pc-edit-invalido" }); setEdit(null); }
    }
    if (!celda || celda.id !== c.id || celda.k !== c.k) setCelda(c);
  };

  const onKeyDownGrilla = (e: React.KeyboardEvent) => {
    if (edit || e.target !== e.currentTarget) return;
    const pos = posActual();
    if (!pos) {
      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", "Tab"].includes(e.key) && filtradas.length) {
        e.preventDefault();
        irA(0, 0);
      }
      return;
    }
    const pagina = Math.max(1, Math.floor(((scrollRef.current?.clientHeight ?? 400) - GRUPO_H - HEADER_H) / ROW_H) - 1);
    const mod = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case "ArrowDown":  e.preventDefault(); irA(mod ? filtradas.length - 1 : pos.r + 1, pos.c); return;
      case "ArrowUp":    e.preventDefault(); irA(mod ? 0 : pos.r - 1, pos.c); return;
      case "ArrowRight": e.preventDefault(); irA(pos.r, mod ? cols.length - 1 : pos.c + 1); return;
      case "ArrowLeft":  e.preventDefault(); irA(pos.r, mod ? 0 : pos.c - 1); return;
      case "Tab":        e.preventDefault(); irA(pos.r, pos.c + (e.shiftKey ? -1 : 1)); return;
      case "Enter":      e.preventDefault(); irA(pos.r + (e.shiftKey ? -1 : 1), pos.c); return;
      case "PageDown":   e.preventDefault(); irA(pos.r + pagina, pos.c); return;
      case "PageUp":     e.preventDefault(); irA(pos.r - pagina, pos.c); return;
      case "Home":       e.preventDefault(); irA(mod ? 0 : pos.r, 0); return;
      case "End":        e.preventDefault(); irA(mod ? filtradas.length - 1 : pos.r, cols.length - 1); return;
      case "F2":         e.preventDefault(); empezarEdicion(); return;
      case "Delete":     e.preventDefault(); vaciar(); return;
      case "Backspace":  e.preventDefault(); empezarEdicion(""); return;
      case "Escape":     setCelda(null); return;
    }
    if (e.key.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      empezarEdicion(e.key);
    }
  };

  /** Input de edición (§4.4 Edición). */
  const editor = edit && celda ? (
    <input
      autoFocus
      className={`pc-editor ${edit.error ? "is-error" : ""} ${esNumerica(COLUMNAS[COLUMNAS.findIndex((c) => c.clave === celda.k)]) ? "is-num" : ""}`}
      value={edit.texto}
      title={edit.error ?? undefined}
      aria-label={`Editar ${etiqueta(celda.k)}`}
      aria-invalid={!!edit.error}
      onChange={(e) => setEdit({ texto: e.target.value, error: null })}
      onFocus={(e) => { const t = e.currentTarget; t.setSelectionRange(t.value.length, t.value.length); }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        const pos = posActual();
        if (e.key === "Escape") { e.preventDefault(); editCerrado.current = true; setEdit(null); enfocarGrilla(); return; }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          if (confirmarEdicion()) return;
          editCerrado.current = true;
          enfocarGrilla();
          if (pos) {
            if (e.key === "Enter") irA(pos.r + (e.shiftKey ? -1 : 1), pos.c);
            else irA(pos.r, pos.c + (e.shiftKey ? -1 : 1));
          }
        }
      }}
      onBlur={() => {
        if (editCerrado.current) return;
        editCerrado.current = true;
        // Al salir con un valor inválido se descarta la edición (la celda
        // conserva su valor); el error queda a la vista en el toast.
        const err = confirmarEdicion();
        if (err) {
          toast.error(`${err}: no se guardó.`, { id: "pc-edit-invalido" });
          setEdit(null);
        }
      }}
    />
  ) : null;

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
          <SelectorPlan
            planes={planes}
            planId={planId}
            onChange={elegirPlan}
            onImportar={() => setImportando(true)}
            onEliminar={puedeEditar ? () => setEliminando(true) : undefined}
          />
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
                      const n = colsDeGrupo(g.id).length;
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
            {plan && <IndicadorGuardado estado={guardado} error={errorGuardado} editable={editable} puedeEditar={puedeEditar} onReintentar={() => void guardar()} />}
            <button type="button" className="ido-btn ido-btn-text" style={{ height: 32 }} onClick={() => cargar(planId ?? undefined, true)} disabled={cargando}>
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

        {plan && puedeEditar && !edicionOk && (
          <div className="ido-banner-warning" style={{ padding: "8px 16px", borderBottom: "1px solid var(--ido-border)" }}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Para editar en la grilla falta correr el bloque «Edición en celda» de <b>supabase/plan_compras.sql</b> en el SQL Editor de Supabase. Mientras tanto la grilla es de solo lectura.</span>
          </div>
        )}

        {/* ── Chips de filtros de columna activos (§4.3) ───────────────────── */}
        {plan && filtrosActivos.length > 0 && (
          <div className="pc-chips">
            <Filter className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--ido-accent)" }} />
            {filtrosActivos.map(([k, f]) => {
              const col = COLUMNAS.find((c) => c.clave === k)!;
              const etq = etiqueta(k);
              const resumen = resumenFiltro(f, (clave) => (clave === "∅" ? "(Vacías)" : clave.startsWith("t:") ? clave.slice(2) : esNumerica(col) ? formatear(col, Number(clave)) : clave));
              return (
                <span key={k} className="pc-chip" title={`${etq}: ${resumen}`}>
                  <button type="button" className="pc-chip-txt" onClick={() => setMenuCol(k)}>
                    <b>{etq}</b>: {resumen}
                  </button>
                  <button type="button" className="pc-chip-x" onClick={() => aplicarFiltroCol(k, null)} aria-label={`Quitar filtro de ${etq}`}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
            <button type="button" className="ido-btn ido-btn-text" style={{ height: 26 }} onClick={() => setFiltrosCol({})}>
              Quitar filtros de columna
            </button>
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
              tabIndex={0}
              onMouseDown={onMouseDownGrilla}
              onDoubleClick={(e) => { if (celdaDeEvento(e)) empezarEdicion(); }}
              onContextMenu={(e) => {
                const c = celdaDeEvento(e);
                if (!c) return;
                e.preventDefault();
                setCelda(c);
                setEdit(null);
                const MENU_W = 216, MENU_H = 150;
                setMenuCtx({
                  x: Math.min(e.clientX, window.innerWidth - MENU_W - 8),
                  y: e.clientY + MENU_H > window.innerHeight - 8 ? Math.max(8, e.clientY - MENU_H) : e.clientY,
                });
              }}
              onKeyDown={onKeyDownGrilla}
              onCopy={(e) => {
                if (edit || !celda) return;
                e.preventDefault();
                e.clipboardData.setData("text/plain", celdaTsv(textoCopia(celda.id, celda.k)));
              }}
              onPaste={(e) => {
                if (edit || !celda) return;
                e.preventDefault();
                pegar(e.clipboardData.getData("text/plain"));
              }}
              className={`pc-scroll flex-1 min-h-0 ${scrolledX ? "is-scrolled-x" : ""} ${editable ? "is-editable" : ""}`}
              style={{ overflow: "auto", outline: "none" }}
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
                      const total = colsDeGrupo(g.id).length;
                      return (
                        <div key={g.id} className="pc-grupo" style={{ gridColumn: `span ${gc.length}` }} title={g.titulo}>
                          <span className="pc-grupo-in" style={{ left: anchoAnclado + 8 }}>
                            <span className="pc-grupo-marca" />
                            <span className="truncate">{g.titulo}</span>
                            {colapsado && (
                              <span className="pc-grupo-n shrink-0" title={`${g.titulo}: ${total - 1} columnas ocultas`}>+{total - 1}</span>
                            )}
                            {colapsable(g) && (
                              <button
                                type="button"
                                className={`pc-colapsar ${colapsado ? "is-colapsado" : ""}`}
                                onClick={() => toggleColapso(g.id)}
                                title={colapsado ? `Expandir ${g.titulo}` : `Colapsar ${g.titulo} a ${etiqueta(g.resumen!)}`}
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
                          title={`${label}${c.letra && !plan?.formulas ? ` · columna ${c.letra}` : ""}${formula ? `\n= ${formula}` : ""}`}
                          style={anclado(anclada, anclaX[c.clave])}
                        >
                          <span className="truncate" style={esCalculada(c.clave) ? { fontStyle: "italic" } : undefined}>{label}</span>
                          {/* La flecha solo en la columna ordenada: con el embudo de filtro al
                              lado, una flecha apagada en cada columna se comía el encabezado. */}
                          {activa && <SortArrow active dir={sortDir} className="w-3 h-3 shrink-0" />}
                          {c.clave !== "incidencia" && (
                            <Popover open={menuCol === c.clave} onOpenChange={(o) => setMenuCol(o ? c.clave : null)}>
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  className={`pc-filtro-btn ${filtrosCol[c.clave] ? "is-on" : ""}`}
                                  onClick={(e) => e.stopPropagation()}
                                  title={filtrosCol[c.clave] ? `Filtrado: ${resumenFiltro(filtrosCol[c.clave]!, (k) => k.replace(/^t:/, ""))}` : `Filtrar ${label}`}
                                  aria-label={`Filtrar ${label}`}
                                >
                                  <Filter className="w-3 h-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent
                                align={esNumerica(c) ? "end" : "start"}
                                className="ido-terminal ido-pop border-0 p-1 w-[290px] z-[10000]"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {menuCol === c.clave && (
                                  <MenuFiltroColumna
                                    titulo={label}
                                    numerica={esNumerica(c)}
                                    opciones={opcionesMenu}
                                    filtro={filtrosCol[c.clave] ?? null}
                                    onAplicar={(f) => aplicarFiltroCol(c.clave, f)}
                                    onOrdenar={(dir) => { setSortKey(c.clave); setSortDir(dir); }}
                                    onCerrar={() => setMenuCol(null)}
                                  />
                                )}
                              </PopoverContent>
                            </Popover>
                          )}
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
                          selK={celda?.id === f.it.id ? celda.k : null}
                          editor={celda?.id === f.it.id ? editor : null}
                          errs={errores[f.it.id]}
                          editable={editable}
                          nombres={nombres}
                          totalVis={totales.vis}
                          sinCompra={sinCompra}
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

      {menuCtx && celda && createPortal(
        <div
          className="ido-terminal ido-menu"
          style={{ left: menuCtx.x, top: menuCtx.y, width: 216 }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          role="menu"
        >
          {(() => {
            const k = celda.k;
            const puede = editable && esEditable(k);
            const it = filaPorId(celda.id);
            const mod = !!it && esEditable(k) && estaModificada(it, k);
            const cerrar = () => { setMenuCtx(null); enfocarGrilla(); };
            return (
              <>
                <ItemMenu icon={Copy} label="Copiar" atajo="Ctrl+C" onClick={() => { cerrar(); void copiarAlPortapapeles(); }} />
                <ItemMenu icon={ClipboardPaste} label="Pegar" atajo="Ctrl+V" disabled={!editable} onClick={() => { cerrar(); void pegarDelPortapapeles(); }} />
                <div className="ido-menu-sep" />
                <ItemMenu icon={Eraser} label="Vaciar celda" atajo="Supr" disabled={!puede} onClick={() => { cerrar(); vaciar(); }} />
                <ItemMenu
                  icon={Undo2}
                  label="Restaurar valor importado"
                  disabled={!puede || !mod}
                  title={mod && it ? `Vuelve a ${textoImportado(it, k)}` : "La celda no fue modificada"}
                  onClick={() => { cerrar(); restaurar(); }}
                />
              </>
            );
          })()}
        </div>,
        document.body,
      )}

      {eliminando && plan && (
        <ConfirmarEliminarPlan plan={plan} onCancelar={() => setEliminando(false)} onConfirmar={confirmarEliminar} />
      )}

      {importando && (
        <PlanComprasImportarModal
          planes={planes}
          onClose={() => setImportando(false)}
          onImportado={onImportado}
        />
      )}
    </div>
  );
}

/** Estilo de una celda de encabezado anclada a la izquierda. */
function anclado(anclada: boolean, x: number | undefined): CSSProperties | undefined {
  // zIndex 21: por encima de los tiradores de redimensionado (z-20) de las
  // columnas que pasan por debajo al scrollear en X.
  return anclada ? { position: "sticky", left: x, zIndex: 21, background: "var(--ido-header)" } : undefined;
}
