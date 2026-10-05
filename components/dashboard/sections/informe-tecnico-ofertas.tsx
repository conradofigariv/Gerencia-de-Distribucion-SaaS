"use client";

// Informe Técnico → pestaña «Ofertas» — sistema de diseño IDO, pantalla
// «Carga de ofertas» del archivo de Design (matriz ítems × oferentes).
//
// Se maneja como una planilla: clic o empezar a escribir edita, Enter baja, Tab
// avanza, flechas navegan, Esc cancela; pegar desde Excel completa hacia abajo
// y a la derecha; ⇧ arma un rango. La moneda es POR CELDA (sufijo que se
// vuelve chip con menú, tecla M alterna, clic derecho cambia en bloque); cada
// oferente tiene una moneda por defecto para las celdas nuevas.
//
// Estado ÚNICO por celda (ver `estadoDe`): pendiente · no cotiza · cargado.
// Todo lo demás (contadores, chip de cobertura del renglón, progreso, totales)
// se calcula SIEMPRE a partir de esos estados — nunca se guarda aparte, así no
// pueden contradecirse (antes una celda mostraba el punto de pendiente
// mientras el chip del renglón decía «Sin ofertar»).
//
// Confirmado con el usuario: SIN las ayudas automáticas del diseño (punto
// verde por ítem, triángulo de fuera de rango, tooltip cantidad × precio), y
// el tipo de cambio del pie es el Dólar SIC de Datos generales, solo lectura.
//
// Tokens --ido-*: el contenedor de la pestaña lleva `.ido-terminal`.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, ArrowRight, Ban, Check, ChevronDown, Clipboard, Clock, Copy, Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";
import {
  listRenglonesConItems, listOferentes, listOfertas, upsertOferta, deleteOferta, updateOferentesDivisa,
  type Licitacion, type RenglonConItems, type Oferente, type Divisa, type Item,
} from "@/lib/informeTecnico";
import { Avatar } from "@/components/dashboard/sections/informe-tecnico-adjudicacion";
import { sansFont } from "@/components/dashboard/ido-kit";

// ─── Números ──────────────────────────────────────────────────────────────

const NF: Record<number, Intl.NumberFormat> = {};
const nf = (d: number) => (NF[d] ??= new Intl.NumberFormat("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmt = (v: number) => nf(2).format(v);

/**
 * Texto tipeado o pegado → número. Acepta el formato argentino (1.234,56), el
 * de Excel en inglés (1234.56), separadores de miles sueltos (1.441.700), «$»
 * y un «USD»/«ARS» pegado adelante o atrás. `err` = no se entiende.
 */
function parsePrecio(t: string): { v: number | null; err?: boolean; nc?: boolean } {
  t = String(t ?? "").trim();
  if (!t) return { v: null };
  if (/^[-–—]$/.test(t)) return { v: null, nc: true };   // un guion = No cotiza
  let s = t.replace(/[\s$]/g, "").replace(/^(usd|ars)/i, "").replace(/(usd|ars)$/i, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return { v: null, err: true };
  return { v: Math.round(parseFloat(s) * 100) / 100 };
}
/** Valor → texto para editar (coma decimal, sin miles). */
const textoEditable = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));

// ─── Tipos ────────────────────────────────────────────────────────────────

/**
 * Celda: precio guardado (`v`), «No cotiza» (`nc`) o nada (pendiente). `raw` =
 * texto que no se entendió: se muestra en rojo y NO se guarda (la celda sigue
 * pendiente para la base).
 */
interface Celda { v: number | null; nc: boolean; cur: Divisa | null; raw: string | null }
const VACIA: Celda = { v: null, nc: false, cur: null, raw: null };
type Estado = "pendiente" | "nc" | "cargado";
const estadoDe = (c: Celda | undefined): Estado => (c?.v != null ? "cargado" : c?.nc ? "nc" : "pendiente");
const K = (itemId: string, ofId: string) => `${itemId}|${ofId}`;
interface Pos { item: string; c: number }

// Columna Ítem: 280px del diseño, pero se achica hasta ITEM_MIN si así la
// tabla entra entera sin scroll horizontal (§4.17). Con 7 oferentes a 170px
// sobraban ~15px y la grilla scrolleaba: la primera columna de oferente
// quedaba tapada por la columna fija. El piso sube lo necesario para que la
// etiqueta de renglón más larga («Renglón N · condición») no se corte.
const ITEM_W = 280;
const ITEM_MIN = 200;
// Lo que ocupa la celda del ítem además del texto: padding 16+16, número 26,
// gap 10 y el borde derecho.
const ITEM_EXTRA = 16 + 16 + 26 + 10 + 1;
const etiquetaRenglon = (r: RenglonConItems) =>
  `Renglón ${r.numero}${r.condicion_adjudicacion ? ` · ${r.condicion_adjudicacion}` : ""}`;
const COL_MIN = 170;
// Encabezado de oferente en una fila: avatar + nombre (hasta 2 renglones) +
// chip de moneda por defecto al lado.
const HEAD_H = 56;
const GROUP_H = 36;
const ROW_H = 52;
// Ítem de un renglón de UN solo ítem: lleva el nombre del renglón arriba de la
// matrícula (no hay fila de grupo): 60px de texto + 8px de aire arriba y abajo
// (con 64 quedaba pegado a los bordes).
const ROW_H_SOLO = 76;
const FOOT_H = 64;
// Lo que ocupa la columna además del nombre: padding 12+12, avatar 24, chip de
// moneda ~40 y los dos gaps de 8.
const HEAD_EXTRA = 12 + 12 + 24 + 40 + 8 + 8;
const COL_MAX = 320;

/**
 * Ancho mínimo de la columna de un oferente para que su nombre entre COMPLETO
 * en dos líneas (13px/600), con 170px de piso. Simula el corte por palabras
 * (greedy) con canvas y busca el ancho más chico que lo deja en ≤ 2 líneas.
 * Arriba de COL_MAX se trunca con tooltip (nombres absurdamente largos).
 */
function anchoParaNombre(ctx: CanvasRenderingContext2D, nombre: string): number {
  const palabras = nombre.split(/\s+/).filter(Boolean);
  const w = (t: string) => ctx.measureText(t).width;
  const entra = (ancho: number) => {
    let lineas = 1, actual = "";
    for (const p of palabras) {
      if (w(p) > ancho) return false;
      const prueba = actual ? `${actual} ${p}` : p;
      if (w(prueba) <= ancho) actual = prueba;
      else { lineas++; actual = p; if (lineas > 2) return false; }
    }
    return true;
  };
  const piso = COL_MIN - HEAD_EXTRA;
  if (entra(piso)) return COL_MIN;
  for (let a = piso + 4; a <= COL_MAX - HEAD_EXTRA; a += 4) if (entra(a)) return Math.ceil(a + HEAD_EXTRA + 2);
  return COL_MAX;
}

// ─── Componente ───────────────────────────────────────────────────────────

export function OfertasTab({ licitacion }: { licitacion: Licitacion }) {
  const licitacionId = licitacion.id;
  const tc = licitacion.fd_sic_valor && licitacion.fd_sic_valor > 0 ? licitacion.fd_sic_valor : null;

  const [loading, setLoading] = useState(true);
  const [renglones, setRenglones] = useState<RenglonConItems[]>([]);
  const [oferentes, setOferentes] = useState<Oferente[]>([]);
  const [vals, setVals] = useState<Map<string, Celda>>(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [active, setActive] = useState<Pos | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [range, setRange] = useState<{ a: Pos; b: Pos } | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [pulse, setPulse] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  const [curMenu, setCurMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [defMenu, setDefMenu] = useState<{ ofId: string; x: number; y: number } | null>(null);
  const [scrolledX, setScrolledX] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Edición en curso (ref, no estado: el blur del input y las teclas de la
  // grilla lo leen en el mismo tick en que se cierra).
  const liveEdit = useRef<{ key: string; text: string } | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => { timers.current.delete(t); fn(); }, ms);
    timers.current.add(t);
  }, []);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  // ── Carga ──
  useEffect(() => {
    let vigente = true;
    setLoading(true);
    Promise.all([listRenglonesConItems(licitacionId), listOferentes(licitacionId), listOfertas(licitacionId)])
      .then(([rens, offs, oftas]) => {
        if (!vigente) return;
        setRenglones(rens);
        setOferentes(offs);
        const m = new Map<string, Celda>();
        for (const o of oftas) {
          m.set(K(o.item_id, o.oferente_id), o.no_cotiza
            ? { v: null, nc: true, cur: o.divisa, raw: null }
            : { v: o.precio_unitario == null ? null : Number(o.precio_unitario), nc: false, cur: o.divisa, raw: null });
        }
        setVals(m);
        const primero = rens.find((r) => r.items.length)?.items[0];
        setActive(primero && offs.length ? { item: primero.id, c: 0 } : null);
      })
      .catch((e) => { console.error(e); if (vigente) toast.error("No se pudieron cargar las ofertas"); })
      .finally(() => { if (vigente) setLoading(false); });
    return () => { vigente = false; };
  }, [licitacionId]);

  // ── Derivados ──
  const items = useMemo(
    () => renglones.flatMap((r) => r.items.map((it) => ({ ...it, renglonId: r.id, renglonNumero: r.numero }))),
    [renglones],
  );
  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  // Los renglones de un solo ítem no tienen fila de grupo, así que no se pliegan.
  const visibles = useMemo(() => {
    const solo = new Set(renglones.filter((r) => r.items.length < 2).map((r) => r.id));
    return items.filter((it) => solo.has(it.renglonId) || !collapsed.has(it.renglonId)).map((it) => it.id);
  }, [items, renglones, collapsed]);
  const defaultOf = useCallback((ofId: string): Divisa => oferentes.find((o) => o.id === ofId)?.divisa_default ?? "ARS", [oferentes]);
  const celda = useCallback((key: string) => vals.get(key) ?? VACIA, [vals]);
  const curDe = useCallback((key: string) => celda(key).cur ?? defaultOf(key.split("|")[1]), [celda, defaultOf]);

  const activeKey = active && oferentes[active.c] ? K(active.item, oferentes[active.c].id) : null;

  // Ancho mínimo por oferente (nombre completo en 2 líneas). Se vuelve a
  // medir cuando terminan de cargar las fuentes: medido con la de respaldo
  // daba otro ancho.
  const [fuentesListas, setFuentesListas] = useState(0);
  useEffect(() => { document.fonts?.ready.then(() => setFuentesListas((n) => n + 1)).catch(() => {}); }, []);
  const anchosCol = useMemo(() => {
    if (typeof document === "undefined") return oferentes.map(() => COL_MIN);
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return oferentes.map(() => COL_MIN);
    ctx.font = sansFont(13, 600);
    return oferentes.map((o) => anchoParaNombre(ctx, o.nombre));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oferentes, fuentesListas]);
  // Piso de la columna Ítem: la etiqueta de renglón más larga (solo la llevan
  // los renglones de un ítem) tiene que entrar entera.
  const itemMin = useMemo(() => {
    const solos = renglones.filter((r) => r.items.length === 1);
    if (!solos.length || typeof document === "undefined") return ITEM_MIN;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return ITEM_W;
    ctx.font = sansFont(10, 500);
    const max = Math.max(...solos.map((r) => ctx.measureText(etiquetaRenglon(r)).width));
    return Math.min(ITEM_W, Math.max(ITEM_MIN, Math.ceil(max + ITEM_EXTRA + 2)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renglones, fuentesListas]);

  // Ancho útil de la grilla (sin la barra de scroll vertical) → ancho de la
  // columna Ítem.
  const [anchoGrid, setAnchoGrid] = useState<number | null>(null);
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const medir = () => setAnchoGrid((p) => { const w = Math.floor(sc.clientWidth); return p === w ? p : w; });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(sc);
    return () => ro.disconnect();
  }, [loading]);
  const sumaOferentes = anchosCol.reduce((a, w) => a + w, 0);
  // Solo se achica si ASÍ entra todo; si igual va a haber scroll horizontal,
  // achicarla no gana nada y corta texto: queda en 280.
  const libre = anchoGrid == null ? null : anchoGrid - sumaOferentes;
  const itemW = libre != null && libre >= itemMin && libre < ITEM_W ? libre : ITEM_W;

  const rangeKeys = useCallback((): string[] => {
    if (!range) return activeKey ? [activeKey] : [];
    const i0 = visibles.indexOf(range.a.item), i1 = visibles.indexOf(range.b.item);
    if (i0 < 0 || i1 < 0) return activeKey ? [activeKey] : [];
    const out: string[] = [];
    for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++)
      for (let c = Math.min(range.a.c, range.b.c); c <= Math.max(range.a.c, range.b.c); c++)
        out.push(K(visibles[i], oferentes[c].id));
    return out;
  }, [range, visibles, oferentes, activeKey]);
  const rangeSet = useMemo(() => new Set(range ? rangeKeys() : []), [range, rangeKeys]);

  // ── Feedback visual ──
  const flashSaved = useCallback((keys: string[], delay = 0) => {
    later(() => {
      setSaved((s) => new Set([...s, ...keys]));
      later(() => setSaved((s) => { const n = new Set(s); keys.forEach((k) => n.delete(k)); return n; }), 1500);
    }, delay);
  }, [later]);
  const flashPulse = useCallback((keys: string[], delay = 0) => {
    later(() => {
      setPulse((s) => new Set([...s, ...keys]));
      later(() => setPulse((s) => { const n = new Set(s); keys.forEach((k) => n.delete(k)); return n; }), 360);
    }, delay);
  }, [later]);

  // ── Guardado ──
  /**
   * Aplica un texto a una celda: número → cargado, «-» → No cotiza, vacío →
   * pendiente (borra la fila), inválido → queda en rojo sin guardar.
   */
  const aplicarTexto = useCallback(async (key: string, text: string, opts?: { delay?: number }) => {
    const p = parsePrecio(text);
    const [itemId, ofId] = key.split("|");
    const prev = vals.get(key) ?? VACIA;
    const revertir = (e: unknown, msg: string) => {
      console.error(e);
      toast.error(e instanceof Error && /Falta correr/.test(e.message) ? e.message : msg);
      setVals((m) => new Map(m).set(key, prev));
    };
    if (p.err) {
      setVals((m) => new Map(m).set(key, { ...prev, raw: String(text).trim() }));
      return;
    }
    if (p.nc) {
      if (prev.nc && prev.raw == null) return;
      const cur = prev.cur ?? defaultOf(ofId);
      setVals((m) => new Map(m).set(key, { v: null, nc: true, cur, raw: null }));
      try {
        await upsertOferta({ oferente_id: ofId, item_id: itemId, precio_unitario: null, divisa: cur, no_cotiza: true });
        flashSaved([key], opts?.delay);
      } catch (e) { revertir(e, "No se pudo marcar No cotiza"); }
      return;
    }
    if (p.v == null) {
      if (estadoDe(prev) === "pendiente" && prev.raw == null) return;
      setVals((m) => { const n = new Map(m); n.delete(key); return n; });
      if (estadoDe(prev) === "pendiente") return;   // solo había texto inválido: no hay nada guardado
      try { await deleteOferta(ofId, itemId); flashSaved([key], opts?.delay); }
      catch (e) { revertir(e, "No se pudo borrar el precio"); }
      return;
    }
    if (prev.v === p.v && !prev.nc && prev.raw == null) return;   // sin cambios
    const cur = prev.cur ?? defaultOf(ofId);
    setVals((m) => new Map(m).set(key, { v: p.v, nc: false, cur, raw: null }));
    try {
      // `no_cotiza: false` solo si venía de No cotiza (si no, ni se manda: así
      // guardar precios funciona aunque el SQL de No cotiza no se haya corrido).
      await upsertOferta({ oferente_id: ofId, item_id: itemId, precio_unitario: p.v, divisa: cur, no_cotiza: prev.nc ? false : undefined });
      flashSaved([key], opts?.delay);
    } catch (e) { revertir(e, "No se pudo guardar el precio"); }
  }, [vals, defaultOf, flashSaved]);

  /** Cambia la moneda de varias celdas con precio (las vacías no tienen moneda propia). */
  const setCurKeys = useCallback(async (keys: string[], cur: Divisa) => {
    const ks = keys.filter((k) => { const c = vals.get(k); return c?.v != null && c.cur !== cur; });
    if (!ks.length) return;
    const backup = vals;
    setVals((m) => { const n = new Map(m); ks.forEach((k) => n.set(k, { ...(n.get(k) ?? VACIA), cur })); return n; });
    flashPulse(ks);
    try {
      for (let i = 0; i < ks.length; i += 20) {
        await Promise.all(ks.slice(i, i + 20).map((k) => {
          const [itemId, ofId] = k.split("|");
          return upsertOferta({ oferente_id: ofId, item_id: itemId, precio_unitario: vals.get(k)!.v!, divisa: cur });
        }));
      }
      flashSaved(ks);
    } catch (e) {
      console.error(e);
      toast.error("No se pudo cambiar la moneda");
      setVals(backup);
    }
  }, [vals, flashPulse, flashSaved]);

  const setDefaults = useCallback(async (ids: string[], cur: Divisa) => {
    const prev = oferentes;
    setOferentes((os) => os.map((o) => (ids.includes(o.id) ? { ...o, divisa_default: cur } : o)));
    try { await updateOferentesDivisa(ids, cur); }
    catch (e) {
      setOferentes(prev);
      toast.error(e instanceof Error ? e.message : "No se pudo guardar la moneda por defecto");
    }
  }, [oferentes]);

  // ── Edición ──
  const focusGrid = useCallback(() => {
    const sc = scrollRef.current;
    if (sc && document.activeElement !== sc) sc.focus({ preventScroll: true });
  }, []);
  const startEdit = useCallback((pos: Pos, text: string) => {
    liveEdit.current = { key: K(pos.item, oferentes[pos.c].id), text };
    setActive(pos);
    setEditText(text);
    setEditing(true);
  }, [oferentes]);
  const commitEdit = useCallback(() => {
    const le = liveEdit.current;
    if (!le) return;
    liveEdit.current = null;
    setEditing(false);
    aplicarTexto(le.key, le.text);
  }, [aplicarTexto]);
  const cancelEdit = useCallback(() => { liveEdit.current = null; setEditing(false); }, []);

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      if (el) { el.focus({ preventScroll: true }); const n = el.value.length; el.setSelectionRange(n, n); }
    } else if (!menu && !curMenu && !defMenu) {
      focusGrid();
    }
  }, [editing, active, menu, curMenu, defMenu, focusGrid]);

  // ── Navegación ──
  const target = useCallback((from: Pos, dr: number, dc: number, wrap?: boolean): Pos => {
    let i = Math.max(0, visibles.indexOf(from.item)), c = from.c + dc;
    if (wrap) { if (c >= oferentes.length) { c = 0; i++; } else if (c < 0) { c = oferentes.length - 1; i--; } }
    c = Math.min(oferentes.length - 1, Math.max(0, c));
    i = Math.min(visibles.length - 1, Math.max(0, i + dr));
    return { item: visibles[i], c };
  }, [visibles, oferentes.length]);
  const move = useCallback((dr: number, dc: number, wrap?: boolean) => {
    if (!active) return;
    const t = target(active, dr, dc, wrap);
    if (t.item !== active.item || t.c !== active.c) setActive(t);
  }, [active, target]);

  // La celda activa siempre a la vista, sin quedar tapada por lo fijo
  // (encabezado + renglón arriba, columna Ítem a la izquierda, totales abajo).
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !activeKey) return;
    const el = sc.querySelector<HTMLElement>(`[data-k="${activeKey}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
    const top = b.top + HEAD_H + GROUP_H, bottom = b.bottom - FOOT_H, left = b.left + itemW;
    if (r.top < top) sc.scrollTop -= top - r.top + 4;
    else if (r.bottom > bottom) sc.scrollTop += r.bottom - bottom + 4;
    if (r.left < left) sc.scrollLeft -= left - r.left;
    else if (r.right > b.right) sc.scrollLeft += r.right - b.right;
  }, [activeKey]);

  const copiar = useCallback(() => {
    if (!activeKey) return;
    const c = celda(activeKey);
    const t = c.v != null ? fmt(c.v) : c.nc ? "-" : c.raw ?? "";
    navigator.clipboard?.writeText(t).catch(() => {});
  }, [activeKey, celda]);

  const pegarGrilla = useCallback((text: string) => {
    if (!active) return;
    const rows = text.replace(/\r/g, "").split("\n");
    while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
    const i0 = visibles.indexOf(active.item);
    rows.forEach((line, r) => {
      const itemId = visibles[i0 + r];
      if (!itemId) return;
      const keys: string[] = [];
      line.split("\t").forEach((t, k) => {
        const of = oferentes[active.c + k];
        if (!of) return;
        const key = K(itemId, of.id);
        keys.push(key);
        aplicarTexto(key, t, { delay: r * 40 });
      });
      flashPulse(keys, r * 40);
    });
  }, [active, visibles, oferentes, aplicarTexto, flashPulse]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (menu || curMenu || defMenu) {
      if (e.key === "Escape") { e.preventDefault(); setMenu(null); setCurMenu(null); setDefMenu(null); }
      return;
    }
    if (!active) return;
    if (editing) {
      if (e.key === "Enter") { e.preventDefault(); commitEdit(); move(e.shiftKey ? -1 : 1, 0); }
      else if (e.key === "Tab") { e.preventDefault(); commitEdit(); move(0, e.shiftKey ? -1 : 1, true); }
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); commitEdit(); move(e.key === "ArrowUp" ? -1 : 1, 0); }
      else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
      return;
    }
    const flechas: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const f = flechas[e.key];
    if (f) {
      e.preventDefault();
      if (e.shiftKey) {
        const a = range ? range.a : active;
        const b = target(range ? range.b : active, f[0], f[1]);
        setRange({ a, b });
        setActive(b);
      } else {
        setRange(null);
        move(f[0], f[1]);
      }
      return;
    }
    const key = activeKey!;
    if (e.key === "Tab") { e.preventDefault(); move(0, e.shiftKey ? -1 : 1, true); return; }
    if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); startEdit(active, celda(key).raw ?? textoEditable(celda(key).v)); return; }
    if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); aplicarTexto(key, ""); return; }
    if (e.key === "-" && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); aplicarTexto(key, "-"); return; }
    if (e.key === "Escape") { if (range) { e.preventDefault(); setRange(null); } return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") { e.preventDefault(); copiar(); return; }
    if ((e.key === "m" || e.key === "M") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const c = celda(key);
      if (c.v != null) setCurKeys([key], curDe(key) === "USD" ? "ARS" : "USD");
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); startEdit(active, e.key); }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text") || "";
    if (editing && !/[\t\n]/.test(text.trim())) return;   // un valor suelto: lo pega el input
    e.preventDefault();
    if (editing) cancelEdit();
    pegarGrilla(text);
  };

  const cellDown = (pos: Pos, key: string) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setMenu(null); setCurMenu(null); setDefMenu(null);
    if (e.shiftKey) {
      e.preventDefault();
      if (liveEdit.current) commitEdit();
      setRange({ a: range ? range.a : active ?? pos, b: pos });
      setActive(pos);
      setEditing(false);
      focusGrid();
      return;
    }
    if (range) setRange(null);
    if (liveEdit.current?.key === key) return;   // clic dentro del input que ya edita
    e.preventDefault();
    if (liveEdit.current) commitEdit();
    startEdit(pos, celda(key).raw ?? textoEditable(celda(key).v));
  };

  const cellCtx = (pos: Pos, key: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (liveEdit.current) commitEdit();
    const enRango = range && rangeSet.has(key);
    if (!enRango) { setRange(null); setActive(pos); }
    setEditing(false);
    setCurMenu(null); setDefMenu(null);
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 248), y: Math.min(e.clientY, window.innerHeight - 220), key });
  };

  const goNextPending = () => {
    for (const it of items) {
      for (let c = 0; c < oferentes.length; c++) {
        const v = celda(K(it.id, oferentes[c].id));
        if (estadoDe(v) === "pendiente" && v.raw == null) {
          if (liveEdit.current) commitEdit();
          const abrir = collapsed.has(it.renglonId);
          if (abrir) setCollapsed((s) => { const n = new Set(s); n.delete(it.renglonId); return n; });
          setRange(null);
          later(() => startEdit({ item: it.id, c }, ""), abrir ? 210 : 0);
          return;
        }
      }
    }
    toast.success("No quedan celdas pendientes.");
  };

  const focusPending = (r: RenglonConItems, c: number) => {
    const it = r.items.find((i) => estadoDe(celda(K(i.id, oferentes[c].id))) === "pendiente");
    if (!it) return;
    if (liveEdit.current) commitEdit();
    setRange(null);
    setActive({ item: it.id, c });
    setEditing(false);
    focusGrid();
  };

  // Cerrar menús con clic afuera.
  useEffect(() => {
    if (!menu && !curMenu && !defMenu) return;
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.("[data-of-menu]")) return;
      setMenu(null); setCurMenu(null); setDefMenu(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menu, curMenu, defMenu]);

  // ── Alto ajustado a la ventana (igual que el Buscador) ──
  const [alto, setAlto] = useState<number | null>(null);
  useLayoutEffect(() => {
    const sc = scrollRef.current, root = rootRef.current;
    if (!sc || !root) return;
    const medir = () => {
      const s = sc.getBoundingClientRect();
      const cont = root.parentElement?.getBoundingClientRect();
      const debajo = cont ? cont.bottom - s.bottom : 0;
      const main = root.closest("main");
      const padMain = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const a = Math.max(320, Math.floor(window.innerHeight - (s.top + window.scrollY) - debajo - padMain));
      setAlto((p) => (p === a ? p : a));
    };
    medir();
    const t = setTimeout(medir, 550);
    const ro = new ResizeObserver(medir);
    if (root.parentElement) ro.observe(root.parentElement);
    window.addEventListener("resize", medir);
    return () => { clearTimeout(t); ro.disconnect(); window.removeEventListener("resize", medir); };
  }, [loading]);

  if (loading) {
    return <div className="ido-loading" style={{ height: 240 }}><Loader2 className="w-4 h-4 animate-spin" />Cargando ofertas…</div>;
  }
  if (!items.length) {
    return <Vacio>No hay ítems cargados. Cargalos en la pestaña <strong>Renglones e ítems</strong> primero.</Vacio>;
  }
  if (!oferentes.length) {
    return <Vacio>No hay oferentes cargados. Cargalos en la pestaña <strong>Oferentes</strong> primero.</Vacio>;
  }

  // ── Datos para pintar ──
  // Todo sale de los estados de celda.
  const totalCells = items.length * oferentes.length;
  const resueltasPorOf = oferentes.map((o) => items.filter((it) => estadoDe(vals.get(K(it.id, o.id))) !== "pendiente").length);
  const doneCells = resueltasPorOf.reduce((a, n) => a + n, 0);
  const cols = `${itemW}px ${anchosCol.map((w) => `minmax(${w}px, 1fr)`).join(" ")}`;
  const minW = itemW + sumaOferentes;
  const stickyShadow = scrolledX ? "8px 0 12px -6px rgba(0,0,0,.6)" : "none";

  const conv = (v: number, from: Divisa, to: Divisa) => (from === to ? v : tc == null ? null : from === "ARS" ? v / tc : v * tc);
  const totales = oferentes.map((o) => {
    const cur = defaultOf(o.id);
    let sum: number | null = 0, pendientes = 0, noCotiza = 0, mezcla = false;
    for (const it of items) {
      const key = K(it.id, o.id), c = vals.get(key);
      const est = estadoDe(c);
      if (est === "pendiente") { pendientes++; continue; }
      if (est === "nc" || c?.v == null) { noCotiza++; continue; }
      const from = curDe(key);
      if (from !== cur) mezcla = true;
      const x = conv(c.v, from, cur);
      sum = sum == null || x == null ? null : sum + x * Number(it.cantidad || 0);
    }
    const usd = sum == null ? null : conv(sum, cur, "USD");
    const cargados = items.length - pendientes - noCotiza;
    return { cur, sum, usd, pendientes, noCotiza, mezcla, cargados };
  });
  // «Completa» = todos sus ítems cargados (ni pendientes ni No cotiza).
  const completas = totales.filter((t) => t.pendientes === 0 && t.noCotiza === 0 && t.usd != null && t.sum! > 0);
  const mejorUsd = completas.length ? Math.min(...completas.map((t) => t.usd!)) : null;

  const allIs = (cur: Divisa) =>
    oferentes.every((o) => defaultOf(o.id) === cur) && [...vals.entries()].every(([k, c]) => c.v == null || curDe(k) === cur);
  const allCur: Divisa | null = allIs("USD") ? "USD" : allIs("ARS") ? "ARS" : null;
  const setAll = (cur: Divisa) => {
    setDefaults(oferentes.map((o) => o.id), cur);
    setCurKeys([...vals.keys()], cur);
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-3" style={{ minWidth: 0 }}>
      <section style={{ background: "var(--ido-panel)", border: "1px solid var(--ido-border)", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Barra superior de la tarjeta */}
        <div className="flex items-center flex-wrap" style={{ minHeight: 52, gap: "12px 20px", padding: "8px 16px", borderBottom: "1px solid var(--ido-border)" }}>
          <span className="inline-flex items-center gap-2" style={{ fontSize: 12, color: "var(--ido-text-2)" }}>
            <Save className="w-3.5 h-3.5" />
            Los precios se guardan automáticamente al salir de cada celda.
          </span>
          <div style={{ flex: 1 }} />
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 12, color: "var(--ido-text-2)", whiteSpace: "nowrap" }}>Cambiar todas las divisas</span>
            <div className="ido-viewsw is-lg" style={{ background: "var(--ido-header)" }}>
              {(["USD", "ARS"] as Divisa[]).map((d) => (
                <button key={d} type="button" className={allCur === d ? "is-on" : ""} onClick={() => setAll(d)} style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div style={{ width: 120, height: 4, borderRadius: 999, background: "var(--ido-border)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(doneCells / totalCells) * 100}%`, background: "var(--ido-accent)", borderRadius: 999, transition: "width 300ms var(--ido-ease)" }} />
            </div>
            <span style={{ fontSize: 12, color: "var(--ido-text-2)", whiteSpace: "nowrap" }}>
              <span className="ido-mono" style={{ color: "var(--ido-text)" }}>{doneCells}</span> de <span className="ido-mono">{totalCells}</span> celdas
            </span>
          </div>
          <button type="button" className="ido-btn ido-btn-text" style={{ height: 32, color: "var(--ido-text)" }} onClick={goNextPending} disabled={doneCells === totalCells}>
            Ir a la próxima pendiente <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Grilla */}
        <div
          ref={scrollRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onScroll={(e) => {
            if (curMenu) setCurMenu(null);
            const x = e.currentTarget.scrollLeft > 0;
            if (x !== scrolledX) setScrolledX(x);
          }}
          className="ido-of-grid"
          style={{ height: alto ?? 560, overflow: "auto", outline: "none", position: "relative", overscrollBehavior: "contain" }}
        >
          <div style={{ minWidth: minW }}>
            {/* Encabezado */}
            <div style={{ position: "sticky", top: 0, zIndex: 4, display: "grid", gridTemplateColumns: cols, background: "var(--ido-header)", borderBottom: "1px solid var(--ido-border-strong)" }}>
              <div style={{ position: "sticky", left: 0, zIndex: 5, background: "var(--ido-header)", padding: "0 16px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, height: HEAD_H, borderRight: "1px solid var(--ido-border-strong)", boxShadow: stickyShadow, transition: "box-shadow 140ms var(--ido-ease)" }}>
                <span className="ido-of-th">Ítem</span>
                <span title={`${items.length} ítems · ${renglones.length} renglones · Precios unitarios`} style={{ fontSize: 11, color: "var(--ido-placeholder)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {items.length} ítems · {renglones.length} renglones · Precios unitarios
                </span>
              </div>
              {oferentes.map((o, c) => {
                const def = defaultOf(o.id);
                return (
                  // Una fila: avatar + nombre completo (hasta 2 renglones antes
                  // de truncar) + chip de moneda por defecto al lado.
                  <div key={o.id} className="ido-of-head" style={{ height: HEAD_H }}>
                    <Avatar nombre={o.nombre} size={24} />
                    <span title={o.nombre} className="ido-of-head-name">{o.nombre}</span>
                    <button
                      type="button"
                      data-of-menu="1"
                      className={`ido-of-cur is-head${defMenu?.ofId === o.id ? " is-open" : ""}`}
                      title="Moneda por defecto — solo para celdas nuevas de este oferente"
                      onMouseDown={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        if (defMenu?.ofId === o.id) { setDefMenu(null); return; }
                        const r = e.currentTarget.getBoundingClientRect();
                        setMenu(null); setCurMenu(null);
                        setDefMenu({ ofId: o.id, x: r.right - 132, y: r.bottom + 4 });
                      }}
                    >
                      {def}<ChevronDown className="w-2 h-2" strokeWidth={3} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Renglones */}
            {renglones.filter((r) => r.items.length).map((r) => {
              // Renglón de UN solo ítem: sin fila de grupo (el nombre del
              // renglón va dentro de la celda del ítem) ni chips de cobertura
              // (la celda ya muestra su estado).
              const solo = r.items.length < 2;
              const cerrado = !solo && collapsed.has(r.id);
              return (
                <div key={r.id} data-ren={r.id}>
                  {!solo && <div
                    onClick={() => {
                      if (liveEdit.current) commitEdit();
                      setCollapsed((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; });
                    }}
                    style={{ position: "sticky", top: HEAD_H, zIndex: 3, display: "grid", gridTemplateColumns: cols, height: GROUP_H, background: "var(--ido-elevated)", borderBottom: "1px solid var(--ido-row-line)", cursor: "pointer" }}
                  >
                    <div style={{ position: "sticky", left: 0, zIndex: 2, background: "var(--ido-elevated)", display: "flex", alignItems: "center", gap: 8, padding: "0 16px 0 12px", minWidth: 0, borderRight: "1px solid var(--ido-border-strong)", boxShadow: stickyShadow }}>
                      <span style={{ width: 20, height: 20, display: "grid", placeItems: "center", color: "var(--ido-text-2)", flex: "none" }}>
                        <ChevronDown className="w-3.5 h-3.5" style={{ transform: cerrado ? "rotate(-90deg)" : "none", transition: "transform 200ms var(--ido-ease)" }} />
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ido-accent)", whiteSpace: "nowrap" }}>Renglón {r.numero}</span>
                      {r.condicion_adjudicacion && (
                        <span title={r.condicion_adjudicacion} style={{ fontSize: 12, color: "var(--ido-text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{r.condicion_adjudicacion}</span>
                      )}
                    </div>
                    {oferentes.map((o, c) => {
                      // Cobertura: SIEMPRE derivada de los estados de las celdas.
                      const t = r.items.length;
                      const est = r.items.map((it) => estadoDe(vals.get(K(it.id, o.id))));
                      const n = est.filter((x) => x === "cargado").length;
                      const nNc = est.filter((x) => x === "nc").length;
                      const nPend = est.filter((x) => x === "pendiente").length;
                      const kind = n === t ? "ok" : nNc === t ? "none" : nPend === t ? "pend" : "part";
                      const pend = nPend > 0;
                      return (
                        <div key={o.id} data-cov={r.id} data-of={o.id} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 14px", minWidth: 0 }}>
                          <span
                            className={`ido-of-cov is-${kind}`}
                            title={pend ? "Ir a la primera celda pendiente" : undefined}
                            style={{ cursor: pend ? "pointer" : "default" }}
                            onClick={(e) => { e.stopPropagation(); if (pend) focusPending(r, c); }}
                          >
                            {kind === "ok" ? <Check className="w-3 h-3" strokeWidth={2.5} /> : kind === "none" ? <span style={{ width: 8, height: 1.5, background: "currentColor", borderRadius: 1 }} /> : <Clock className="w-3 h-3" strokeWidth={2.2} />}
                            {kind === "ok" ? `Completo ${n}/${t}` : kind === "none" ? "Sin ofertar" : kind === "pend" ? `Pendiente 0/${t}` : `Parcial ${n}/${t}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>}

                  <div style={{ display: "grid", gridTemplateRows: cerrado ? "0fr" : "1fr", transition: "grid-template-rows 200ms var(--ido-ease)" }}>
                    {/* `clip` y no `hidden`: `hidden` vuelve a este div un contenedor
                        de scroll y la columna Ítem (sticky left) dejaba de quedar
                        fija al scrollear en horizontal. */}
                    <div style={{ overflow: "clip", minHeight: 0 }}>
                      {r.items.map((it) => (
                        <FilaItem
                          key={it.id}
                          item={it}
                          renglonNumero={r.numero}
                          renglonLabel={solo ? etiquetaRenglon(r) : undefined}
                          cols={cols}
                          stickyShadow={stickyShadow}
                        >
                          {oferentes.map((o, c) => {
                            const key = K(it.id, o.id);
                            const v = vals.get(key) ?? VACIA;
                            const pos = { item: it.id, c };
                            const sel = key === activeKey;
                            const ed = sel && editing;
                            const err = v.raw != null;
                            const estado = estadoDe(v);
                            const cur = curDe(key);
                            const cls = [
                              "ido-of-cell",
                              sel && "is-active",
                              ed && "is-editing",
                              err && !sel && "is-err",
                              rangeSet.has(key) && !ed && "is-range",
                              pulse.has(key) && "is-pulse",
                            ].filter(Boolean).join(" ");
                            return (
                              <div
                                key={o.id}
                                data-k={key}
                                className={cls}
                                title={err ? "Formato inválido · usá 1.234,56" : undefined}
                                style={{ justifyContent: estado !== "cargado" && !err && !ed ? "center" : "flex-end" }}
                                onMouseDown={cellDown(pos, key)}
                                onContextMenu={cellCtx(pos, key)}
                              >
                                {ed ? (
                                  <>
                                    <input
                                      ref={inputRef}
                                      value={editText}
                                      onChange={(e) => { setEditText(e.target.value); if (liveEdit.current) liveEdit.current.text = e.target.value; }}
                                      onBlur={() => { if (liveEdit.current && !menu) commitEdit(); }}
                                      spellCheck={false}
                                      className="ido-of-input"
                                    />
                                    {editText.trim() !== "" && <span className="ido-of-cur is-edit">{cur}<ChevronDown className="w-2 h-2" strokeWidth={3} /></span>}
                                  </>
                                ) : err ? (
                                  <>
                                    <span className="ido-mono" style={{ fontSize: 13, fontWeight: 400, color: "var(--ido-text)" }}>{v.raw}</span>
                                    <span className="ido-of-tri is-err" />
                                  </>
                                ) : v.v != null ? (
                                  <>
                                    <span className="ido-mono" style={{ fontSize: 13, fontWeight: 400, color: "var(--ido-text)", whiteSpace: "nowrap" }}>{fmt(v.v)}</span>
                                    <span
                                      data-of-menu="1"
                                      className={`ido-of-cur${curMenu?.key === key ? " is-open" : ""}`}
                                      title="Moneda de la celda · M alterna"
                                      onMouseDown={(e) => {
                                        e.preventDefault(); e.stopPropagation();
                                        if (liveEdit.current) commitEdit();
                                        if (curMenu?.key === key) { setCurMenu(null); return; }
                                        const rr = e.currentTarget.getBoundingClientRect();
                                        setRange(null); setActive(pos); setMenu(null); setDefMenu(null);
                                        setCurMenu({ key, x: rr.right - 80, y: rr.bottom + 4 });
                                      }}
                                    >
                                      {cur}<ChevronDown className="w-2 h-2" strokeWidth={3} />
                                    </span>
                                  </>
                                ) : estado === "nc" ? (
                                  <span className="ido-of-nc">No cotiza</span>
                                ) : (
                                  <span className="ido-of-pend" />
                                )}
                                {saved.has(key) && !ed && <Check className="ido-of-saved w-3 h-3" strokeWidth={2.5} />}
                              </div>
                            );
                          })}
                        </FilaItem>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Totales */}
            <div style={{ position: "sticky", bottom: 0, zIndex: 4, display: "grid", gridTemplateColumns: cols, height: FOOT_H, background: "var(--ido-elevated)", borderTop: "1px solid var(--ido-border-strong)" }}>
              <div style={{ position: "sticky", left: 0, zIndex: 5, background: "var(--ido-elevated)", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, padding: "0 16px", borderRight: "1px solid var(--ido-border-strong)", boxShadow: stickyShadow, transition: "box-shadow 140ms var(--ido-ease)" }}>
                <span className="ido-of-th">Total de la oferta</span>
                <span style={{ fontSize: 11, color: "var(--ido-placeholder)", whiteSpace: "nowrap" }}>Precio unitario × cantidad</span>
              </div>
              {totales.map((t, c) => {
                const parcial = t.pendientes > 0 || t.noCotiza > 0;
                const mejor = !parcial && t.usd != null && t.usd === mejorUsd;
                const pctVsMejor = !mejor && mejorUsd && t.usd != null ? (t.usd / mejorUsd - 1) * 100 : null;
                const equivUsd = t.cur === "ARS" && t.usd != null ? `${fmt(t.usd)} USD` : "";
                let line = "", lineColor = "var(--ido-text-2)", lineMono = true, lineTip = "";
                // Textos cortos: tienen que entrar sin truncar en 170px.
                if (t.sum == null) { line = "Sin Dólar SIC"; lineColor = "var(--ido-warning)"; lineMono = false; lineTip = "Cargalo en Datos generales para convertir montos en otra moneda"; }
                else if (t.pendientes > 0) { line = t.pendientes === 1 ? "Falta 1 ítem" : `Faltan ${t.pendientes} ítems`; lineColor = "var(--ido-warning)"; lineMono = false; }
                else if (t.noCotiza > 0) { line = t.noCotiza === 1 ? "1 ítem no cotiza" : `${t.noCotiza} ítems no cotiza`; lineColor = "var(--ido-warning)"; lineMono = false; }
                else if (t.mezcla) {
                  line = `Incluye ${t.cur === "USD" ? "ARS" : "USD"} convertido`; lineMono = false;
                  lineTip = [pctVsMejor != null && !parcial ? `+${nf(1).format(pctVsMejor)} % vs mejor` : "", equivUsd].filter(Boolean).join(" · ");
                }
                else if (pctVsMejor != null && !parcial) { line = `+${nf(1).format(pctVsMejor)} % vs mejor`; lineTip = equivUsd; }
                else if (equivUsd) line = equivUsd;
                return (
                  <div key={oferentes[c].id} data-tot={oferentes[c].id} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", gap: 2, padding: "0 14px", minWidth: 0 }}>
                    <div className="flex items-baseline gap-1" style={{ minWidth: 0 }}>
                      {/* Punto de «mejor total» en línea, con su propio espacio: absoluto
                          se montaba sobre el primer dígito de los montos largos. */}
                      {mejor && <span title="Menor total entre ofertas completas" style={{ alignSelf: "center", width: 6, height: 6, marginRight: 4, borderRadius: 999, background: "var(--ido-accent)", flex: "none" }} />}
                      <span className="ido-mono" style={{ fontSize: 14, fontWeight: 600, color: parcial ? "var(--ido-text-2)" : "var(--ido-text)", whiteSpace: "nowrap" }}>{t.sum == null || t.cargados === 0 ? "—" : fmt(t.sum)}</span>
                      <span className="ido-mono" style={{ fontSize: 10, fontWeight: 500, color: "var(--ido-placeholder)" }}>{t.cur}</span>
                    </div>
                    <span data-line title={lineTip || undefined} className={lineMono ? "ido-mono" : undefined} style={{ fontSize: 11, color: lineColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", minHeight: 15 }}>{line}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Pie: tipo de cambio de la comparación (Dólar SIC, solo lectura) */}
      <div className="flex items-center gap-1.5 flex-wrap" style={{ fontSize: 11, color: "var(--ido-placeholder)", minHeight: 20 }}>
        {tc ? (
          <>
            <span>Comparación en USD a 1 USD =</span>
            <span className="ido-mono" style={{ color: "var(--ido-text)" }}>{nf(0).format(tc)}</span>
            <span>ARS</span>
            <span>· Dólar SIC{licitacion.fd_sic_fecha ? ` al ${fmtFecha(licitacion.fd_sic_fecha)}` : ""} — se cambia en Datos generales</span>
          </>
        ) : (
          <span style={{ color: "var(--ido-warning)" }}>Sin Dólar SIC: cargalo en Datos generales para comparar montos en distintas monedas.</span>
        )}
      </div>

      {menu && createPortal(
        <MenuCelda
          x={menu.x} y={menu.y}
          nSel={rangeKeys().length}
          onClose={() => setMenu(null)}
          onCopiar={copiar}
          onPegar={() => { navigator.clipboard?.readText().then(pegarGrilla).catch(() => toast.error("El navegador no dejó leer el portapapeles — usá Ctrl+V")); }}
          onNoCotiza={() => rangeKeys().forEach((k) => aplicarTexto(k, "-"))}
          onMoneda={(d) => setCurKeys(rangeKeys(), d)}
          onBorrar={() => aplicarTexto(menu.key, "")}
        />,
        document.body,
      )}
      {curMenu && createPortal(
        <div data-of-menu="1" className="ido-terminal ido-pop ido-of-menu" style={{ left: curMenu.x, top: curMenu.y, width: 80, transformOrigin: "top right" }}>
          {(["USD", "ARS"] as Divisa[]).map((d) => (
            <button key={d} type="button" className="ido-pop-item" style={{ justifyContent: "space-between" }}
              onMouseDown={(e) => { e.preventDefault(); const k = curMenu.key; setCurMenu(null); setCurKeys([k], d); }}>
              <span className="ido-mono" style={{ fontSize: 11, fontWeight: 600 }}>{d}</span>
              {curDe(curMenu.key) === d && <Check className="w-3 h-3" style={{ color: "var(--ido-accent)" }} />}
            </button>
          ))}
        </div>,
        document.body,
      )}
      {defMenu && createPortal(
        <div data-of-menu="1" className="ido-terminal ido-pop ido-of-menu" style={{ left: defMenu.x, top: defMenu.y, width: 132, transformOrigin: "top right" }}>
          <div className="ido-pop-label" style={{ padding: "4px 8px 6px" }}>Por defecto</div>
          {(["USD", "ARS"] as Divisa[]).map((d) => (
            <button key={d} type="button" className="ido-pop-item" style={{ justifyContent: "space-between" }}
              onMouseDown={(e) => { e.preventDefault(); const id = defMenu.ofId; setDefMenu(null); if (defaultOf(id) !== d) setDefaults([id], d); }}>
              <span className="ido-mono" style={{ fontSize: 11, fontWeight: 600 }}>{d}</span>
              {defaultOf(defMenu.ofId) === d && <Check className="w-3 h-3" style={{ color: "var(--ido-accent)" }} />}
            </button>
          ))}
          <div style={{ padding: "4px 8px 2px", fontSize: 10.5, color: "var(--ido-text-2)", lineHeight: 1.35 }}>Solo celdas nuevas</div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── Piezas ───────────────────────────────────────────────────────────────

function fmtFecha(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : iso;
}

function Vacio({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ border: "1px dashed var(--ido-border)", borderRadius: 12, padding: "40px 16px", textAlign: "center", fontSize: 13, color: "var(--ido-text-2)" }}>
      {children}
    </div>
  );
}

function FilaItem({
  item, renglonNumero, renglonLabel, cols, stickyShadow, children,
}: {
  item: Item; renglonNumero: number; renglonLabel?: string; cols: string; stickyShadow: string; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: cols, height: renglonLabel ? ROW_H_SOLO : ROW_H, borderBottom: "1px solid var(--ido-row-line)" }}>
      <div
        title={item.descripcion ?? undefined}
        style={{ position: "sticky", left: 0, zIndex: 2, background: "var(--ido-panel)", display: "flex", alignItems: "center", gap: 10, padding: "0 16px", minWidth: 0, borderRight: "1px solid var(--ido-border-strong)", boxShadow: stickyShadow, transition: "box-shadow 140ms var(--ido-ease)" }}
      >
        <span className="ido-mono" style={{ fontSize: 11, color: "var(--ido-placeholder)", width: 26, flex: "none", alignSelf: "flex-start", paddingTop: renglonLabel ? 21 : 8 }}>
          {renglonNumero}.{item.numero_item}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          {/* Renglón de un solo ítem: su nombre va acá, arriba de la matrícula. */}
          {renglonLabel && <span className="ido-of-ren-label" title={renglonLabel}>{renglonLabel}</span>}
          <div className="flex items-center gap-2" style={{ lineHeight: "14px" }}>
            {item.matricula && <span className="ido-mono" style={{ fontSize: 11, color: "var(--ido-accent)", whiteSpace: "nowrap", flex: "none" }}>{item.matricula}</span>}
            <span style={{ fontSize: 11, color: "var(--ido-text-2)", whiteSpace: "nowrap", flex: "none" }}>Cant. {nf(0).format(Number(item.cantidad || 0))}</span>
          </div>
          <span className="ido-of-desc">{item.descripcion || "Sin descripción"}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

function MenuCelda({
  x, y, nSel, onClose, onCopiar, onPegar, onNoCotiza, onMoneda, onBorrar,
}: {
  x: number; y: number; nSel: number; onClose: () => void;
  onCopiar: () => void; onPegar: () => void; onNoCotiza: () => void; onMoneda: (d: Divisa) => void; onBorrar: () => void;
}) {
  const it = (label: string, Icon: typeof Copy, kbd: string, run: () => void) => (
    <button type="button" className="ido-pop-item" onMouseDown={(e) => { e.preventDefault(); onClose(); run(); }}>
      <Icon className="w-3.5 h-3.5" />
      <span className="flex-1 truncate">{label}</span>
      {kbd && <span className="ido-mono" style={{ fontSize: 11, color: "var(--ido-placeholder)" }}>{kbd}</span>}
    </button>
  );
  const veces = nSel > 1 ? `×${nSel}` : "";
  return (
    // 236px y no los 216 del diseño: con la tipografía de la app «Cambiar
    // moneda a USD» + «×N» no entraba y se cortaba.
    <div data-of-menu="1" className="ido-terminal ido-pop ido-of-menu" style={{ left: x, top: y, width: 236, transformOrigin: "top left" }} onContextMenu={(e) => e.preventDefault()}>
      {it("Copiar", Copy, "Ctrl C", onCopiar)}
      {it("Pegar", Clipboard, "Ctrl V", onPegar)}
      <div className="ido-pop-sep" />
      {it("Marcar No cotiza", Ban, nSel > 1 ? veces : "-", onNoCotiza)}
      {it("Cambiar moneda a USD", ArrowLeftRight, veces, () => onMoneda("USD"))}
      {it("Cambiar moneda a ARS", ArrowLeftRight, veces, () => onMoneda("ARS"))}
      <div className="ido-pop-sep" />
      {it("Borrar valor", X, "⌫", onBorrar)}
    </div>
  );
}
