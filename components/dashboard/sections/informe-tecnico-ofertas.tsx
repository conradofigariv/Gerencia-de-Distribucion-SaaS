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
// Confirmado con el usuario: SIN «No cotiza» (la base no lo soporta; celda
// vacía = no ofertó), SIN las ayudas automáticas del diseño (punto verde por
// ítem, triángulo de fuera de rango, tooltip cantidad × precio), y el tipo de
// cambio del pie es el Dólar SIC de Datos generales, solo lectura.
//
// Tokens --ido-*: el contenedor de la pestaña lleva `.ido-terminal`.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, ArrowRight, Check, ChevronDown, Clipboard, Clock, Copy, Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";
import {
  listRenglonesConItems, listOferentes, listOfertas, upsertOferta, deleteOferta, updateOferentesDivisa,
  type Licitacion, type RenglonConItems, type Oferente, type Divisa, type Item,
} from "@/lib/informeTecnico";
import { Avatar } from "@/components/dashboard/sections/informe-tecnico-adjudicacion";

// ─── Números ──────────────────────────────────────────────────────────────

const NF: Record<number, Intl.NumberFormat> = {};
const nf = (d: number) => (NF[d] ??= new Intl.NumberFormat("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmt = (v: number) => nf(2).format(v);

/**
 * Texto tipeado o pegado → número. Acepta el formato argentino (1.234,56), el
 * de Excel en inglés (1234.56), separadores de miles sueltos (1.441.700), «$»
 * y un «USD»/«ARS» pegado adelante o atrás. `err` = no se entiende.
 */
function parsePrecio(t: string): { v: number | null; err?: boolean } {
  t = String(t ?? "").trim();
  if (!t) return { v: null };
  let s = t.replace(/[\s$]/g, "").replace(/^(usd|ars)/i, "").replace(/(usd|ars)$/i, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return { v: null, err: true };
  return { v: Math.round(parseFloat(s) * 100) / 100 };
}
/** Valor → texto para editar (coma decimal, sin miles). */
const textoEditable = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));

// ─── Tipos ────────────────────────────────────────────────────────────────

/** Celda: precio guardado (`v`) o texto que no se entendió (`raw`, sin guardar). */
interface Celda { v: number | null; cur: Divisa | null; raw: string | null }
const VACIA: Celda = { v: null, cur: null, raw: null };
const K = (itemId: string, ofId: string) => `${itemId}|${ofId}`;
interface Pos { item: string; c: number }

const ITEM_W = 280;
const COL_MIN = 168;
const HEAD_H = 52;
const GROUP_H = 36;
const ROW_H = 52;
const FOOT_H = 64;

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
        for (const o of oftas) m.set(K(o.item_id, o.oferente_id), { v: Number(o.precio_unitario), cur: o.divisa, raw: null });
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
  const visibles = useMemo(() => items.filter((it) => !collapsed.has(it.renglonId)).map((it) => it.id), [items, collapsed]);
  const defaultOf = useCallback((ofId: string): Divisa => oferentes.find((o) => o.id === ofId)?.divisa_default ?? "ARS", [oferentes]);
  const celda = useCallback((key: string) => vals.get(key) ?? VACIA, [vals]);
  const curDe = useCallback((key: string) => celda(key).cur ?? defaultOf(key.split("|")[1]), [celda, defaultOf]);

  const activeKey = active && oferentes[active.c] ? K(active.item, oferentes[active.c].id) : null;

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
  /** Aplica un texto a una celda: vacío borra, inválido queda en rojo sin guardar. */
  const aplicarTexto = useCallback(async (key: string, text: string, opts?: { delay?: number }) => {
    const p = parsePrecio(text);
    const [itemId, ofId] = key.split("|");
    const prev = vals.get(key) ?? VACIA;
    if (p.err) {
      setVals((m) => new Map(m).set(key, { ...prev, raw: String(text).trim() }));
      return;
    }
    if (p.v == null) {
      if (prev.v == null && prev.raw == null) return;
      setVals((m) => { const n = new Map(m); n.delete(key); return n; });
      if (prev.v == null) return;   // solo había texto inválido: no hay nada guardado
      try { await deleteOferta(ofId, itemId); flashSaved([key], opts?.delay); }
      catch (e) { console.error(e); toast.error("No se pudo borrar el precio"); setVals((m) => new Map(m).set(key, prev)); }
      return;
    }
    if (prev.v === p.v && prev.raw == null) return;   // sin cambios
    const cur = prev.cur ?? defaultOf(ofId);
    setVals((m) => new Map(m).set(key, { v: p.v, cur, raw: null }));
    try {
      await upsertOferta({ oferente_id: ofId, item_id: itemId, precio_unitario: p.v, divisa: cur });
      flashSaved([key], opts?.delay);
    } catch (e) {
      console.error(e);
      toast.error("No se pudo guardar el precio");
      setVals((m) => new Map(m).set(key, prev));
    }
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
    const top = b.top + HEAD_H + GROUP_H, bottom = b.bottom - FOOT_H, left = b.left + ITEM_W;
    if (r.top < top) sc.scrollTop -= top - r.top + 4;
    else if (r.bottom > bottom) sc.scrollTop += r.bottom - bottom + 4;
    if (r.left < left) sc.scrollLeft -= left - r.left;
    else if (r.right > b.right) sc.scrollLeft += r.right - b.right;
  }, [activeKey]);

  const copiar = useCallback(() => {
    if (!activeKey) return;
    const c = celda(activeKey);
    const t = c.v != null ? fmt(c.v) : c.raw ?? "";
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
        if (v.v == null && v.raw == null) {
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
    const it = r.items.find((i) => { const v = celda(K(i.id, oferentes[c].id)); return v.v == null && v.raw == null; });
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
  const totalCells = items.length * oferentes.length;
  let doneCells = 0;
  const hechasPorOf = oferentes.map((o) => items.filter((it) => vals.get(K(it.id, o.id))?.v != null).length);
  hechasPorOf.forEach((n) => { doneCells += n; });
  const cols = `${ITEM_W}px repeat(${oferentes.length}, minmax(${COL_MIN}px, 1fr))`;
  const minW = ITEM_W + COL_MIN * oferentes.length;
  const stickyShadow = scrolledX ? "8px 0 12px -6px rgba(0,0,0,.6)" : "none";

  const conv = (v: number, from: Divisa, to: Divisa) => (from === to ? v : tc == null ? null : from === "ARS" ? v / tc : v * tc);
  const totales = oferentes.map((o) => {
    const cur = defaultOf(o.id);
    let sum: number | null = 0, pendientes = 0, mezcla = false;
    for (const it of items) {
      const key = K(it.id, o.id), c = vals.get(key);
      if (c?.v == null) { pendientes++; continue; }
      const from = curDe(key);
      if (from !== cur) mezcla = true;
      const x = conv(c.v, from, cur);
      sum = sum == null || x == null ? null : sum + x * Number(it.cantidad || 0);
    }
    const usd = sum == null ? null : conv(sum, cur, "USD");
    return { cur, sum, usd, pendientes, mezcla };
  });
  const completas = totales.filter((t) => t.pendientes === 0 && t.usd != null && t.sum! > 0);
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
                <span style={{ fontSize: 11, color: "var(--ido-placeholder)", whiteSpace: "nowrap" }}>
                  {items.length} ítems · {renglones.length} renglones · Precios unitarios
                </span>
              </div>
              {oferentes.map((o, c) => {
                const n = hechasPorOf[c], completo = n === items.length, def = defaultOf(o.id);
                return (
                  <div key={o.id} style={{ height: HEAD_H, padding: "0 14px", display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <Avatar nombre={o.nombre} size={24} />
                    {/* Nombre arriba a todo el ancho; abajo el contador de ítems
                        cotizados y la moneda por defecto (no entran los tres en
                        una línea sin cortar el nombre). */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
                      <span title={o.nombre} style={{ fontSize: 13, fontWeight: 600, lineHeight: "16px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{o.nombre}</span>
                      <div className="flex items-center" style={{ gap: 8, minWidth: 0 }}>
                        <span className="ido-mono" title={`${n} de ${items.length} ítems cotizados`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: completo ? "var(--ido-accent)" : "var(--ido-text-2)", transition: "color 200ms var(--ido-ease)" }}>
                          {completo && <Check className="w-3 h-3" strokeWidth={2.5} />}{n}/{items.length}
                        </span>
                        <button
                          type="button"
                          data-of-menu="1"
                          className={`ido-of-cur is-head${defMenu?.ofId === o.id ? " is-open" : ""}`}
                          title="Moneda por defecto — solo para celdas nuevas de este oferente"
                          style={{ marginLeft: "auto" }}
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
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Renglones */}
            {renglones.filter((r) => r.items.length).map((r) => {
              const cerrado = collapsed.has(r.id);
              return (
                <div key={r.id}>
                  <div
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
                      const t = r.items.length;
                      const n = r.items.filter((it) => vals.get(K(it.id, o.id))?.v != null).length;
                      const kind = n === t ? "ok" : n === 0 ? "none" : "part";
                      const pend = kind !== "ok";
                      return (
                        <div key={o.id} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 14px" }}>
                          <span
                            className={`ido-of-cov is-${kind}`}
                            title={pend ? "Ir a la primera celda pendiente" : undefined}
                            style={{ cursor: pend ? "pointer" : "default" }}
                            onClick={(e) => { e.stopPropagation(); if (pend) focusPending(r, c); }}
                          >
                            {kind === "ok" ? <Check className="w-3 h-3" strokeWidth={2.5} /> : kind === "part" ? <Clock className="w-3 h-3" strokeWidth={2.2} /> : <span style={{ width: 8, height: 1.5, background: "currentColor", borderRadius: 1 }} />}
                            {kind === "ok" ? `Completo ${n}/${t}` : kind === "part" ? `Parcial ${n}/${t}` : "Sin ofertar"}
                          </span>
                        </div>
                      );
                    })}
                  </div>

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
                                style={{ justifyContent: v.v == null && !err && !ed ? "center" : "flex-end" }}
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
                                    <span className="ido-mono" style={{ fontSize: 13, color: "var(--ido-text)" }}>{v.raw}</span>
                                    <span className="ido-of-tri is-err" />
                                  </>
                                ) : v.v != null ? (
                                  <>
                                    <span className="ido-mono" style={{ fontSize: 13, color: "var(--ido-text)", whiteSpace: "nowrap" }}>{fmt(v.v)}</span>
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
                const parcial = t.pendientes > 0;
                const mejor = !parcial && t.usd != null && t.usd === mejorUsd;
                const pctVsMejor = !mejor && mejorUsd && t.usd != null ? (t.usd / mejorUsd - 1) * 100 : null;
                const equivUsd = t.cur === "ARS" && t.usd != null ? `${fmt(t.usd)} USD` : "";
                let line = "", lineColor = "var(--ido-text-2)", lineMono = true, lineTip = "";
                if (t.sum == null) { line = "Falta el Dólar SIC para convertir"; lineColor = "var(--ido-warning)"; lineMono = false; }
                else if (parcial) { line = t.pendientes === 1 ? "Parcial, falta 1 ítem" : `Parcial, faltan ${t.pendientes} ítems`; lineColor = "var(--ido-warning)"; lineMono = false; }
                else if (t.mezcla) {
                  line = `Incluye montos en ${t.cur === "USD" ? "ARS" : "USD"} convertidos`; lineMono = false;
                  lineTip = [pctVsMejor != null && !parcial ? `+${nf(1).format(pctVsMejor)} % vs mejor` : "", equivUsd].filter(Boolean).join(" · ");
                }
                else if (pctVsMejor != null && !parcial) { line = `+${nf(1).format(pctVsMejor)} % vs mejor`; lineTip = equivUsd; }
                else if (equivUsd) line = equivUsd;
                return (
                  <div key={oferentes[c].id} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", gap: 2, padding: "0 14px", minWidth: 0 }}>
                    {mejor && <span title="Menor total entre ofertas completas" style={{ position: "absolute", left: 12, top: 22, width: 6, height: 6, borderRadius: 999, background: "var(--ido-accent)" }} />}
                    <div className="flex items-baseline gap-1" style={{ minWidth: 0 }}>
                      <span className="ido-mono" style={{ fontSize: 14, fontWeight: 600, color: parcial ? "var(--ido-text-2)" : "var(--ido-text)", whiteSpace: "nowrap" }}>{t.sum == null ? "—" : fmt(t.sum)}</span>
                      <span className="ido-mono" style={{ fontSize: 10, fontWeight: 500, color: "var(--ido-placeholder)" }}>{t.cur}</span>
                    </div>
                    <span title={lineTip || undefined} className={lineMono ? "ido-mono" : undefined} style={{ fontSize: 11, color: lineColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", minHeight: 15 }}>{line}</span>
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
  item, renglonNumero, cols, stickyShadow, children,
}: {
  item: Item; renglonNumero: number; cols: string; stickyShadow: string; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: cols, height: ROW_H, borderBottom: "1px solid var(--ido-row-line)" }}>
      <div
        title={item.descripcion ?? undefined}
        style={{ position: "sticky", left: 0, zIndex: 2, background: "var(--ido-panel)", display: "flex", alignItems: "center", gap: 10, padding: "0 16px", minWidth: 0, borderRight: "1px solid var(--ido-border-strong)", boxShadow: stickyShadow, transition: "box-shadow 140ms var(--ido-ease)" }}
      >
        <span className="ido-mono" style={{ fontSize: 11, color: "var(--ido-placeholder)", width: 26, flex: "none", alignSelf: "flex-start", paddingTop: 8 }}>
          {renglonNumero}.{item.numero_item}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
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
  x, y, nSel, onClose, onCopiar, onPegar, onMoneda, onBorrar,
}: {
  x: number; y: number; nSel: number; onClose: () => void;
  onCopiar: () => void; onPegar: () => void; onMoneda: (d: Divisa) => void; onBorrar: () => void;
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
      {it("Cambiar moneda a USD", ArrowLeftRight, veces, () => onMoneda("USD"))}
      {it("Cambiar moneda a ARS", ArrowLeftRight, veces, () => onMoneda("ARS"))}
      <div className="ido-pop-sep" />
      {it("Borrar valor", X, "⌫", onBorrar)}
    </div>
  );
}
