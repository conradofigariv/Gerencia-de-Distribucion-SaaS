"use client";

// Pestaña «Adjudicación» de Informe Técnico, en el sistema de diseño IDO
// (design-system.md §10 «Tarjeta de oferente en licitación»). Vive aparte de
// informe-tecnico.tsx para no seguir engordando ese archivo.
//
// Confirmado con el usuario (además de lo que define §10):
// - Banner de KPIs, aviso de dólar y resumen del pie: solo tokens IDO.
// - Tarjeta adjudicada: el botón queda en «✓ Adjudicada»; clic de nuevo desadjudica.
// - Vista de tabla: se adjudica con clic derecho en la fila (§4.5).
// - Conmutadores de vista (tarjetas/tabla) y divisa (ARS/USD) en la barra de
//   arriba, al lado de «Ayuda» (AdjudicacionControls, estado en el padre).
// - Se conservan: cambio ARS/USD, arrastrar tarjetas
//   para reordenar y la alerta de umbral económico en el % vs SIC.
// - Se eliminó la barra de ahorro.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { loadTableLayout, saveTableLayout } from "@/lib/tableLayout";
import {
  listRenglonesConItems, listOferentes, listOfertas, listEvaluaciones, listAdjudicaciones,
  upsertAdjudicacion, deleteAdjudicacion, ofertaConPrecio,
  type Licitacion, type RenglonConItems, type Oferente, type Divisa, type Oferta,
  type EvaluacionTecnica, type Adjudicacion,
} from "@/lib/informeTecnico";

// ─── Constantes ─────────────────────────────────────────────────────────────

const LAYOUT_ID = "informeAdjudicacion"; // vista tarjetas/tabla, por usuario (§10, §4.20)
type View = "cards" | "table";

const CARD_MIN = 210;   // ninguna tarjeta por debajo de esto (§10)
const CARD_GAP = 12;
const MORE_W = 120;     // tarjeta resumen «N oferentes más»
const CARD_EXPANDED_W = 240;

// Columnas de la vista de tabla (tal cual el diseño).
const TABLE_COLS = "84px minmax(200px,1.6fr) 140px 132px 140px 130px 150px 160px";
const TABLE_HEADERS: { label: string; right?: boolean }[] = [
  { label: "Ranking" }, { label: "Oferente" }, { label: "Precio total", right: true },
  { label: "Precio unitario", right: true }, { label: "Porcentaje vs SIC", right: true },
  { label: "Ahorro", right: true }, { label: "Informe técnico" }, { label: "Cobertura" },
];

const NF0 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const NF1 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF2 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** N tarjetas que entran: ⌊(ancho − 120) / 222⌋ acotado entre 3 y 5 (§10). */
const cardsThatFit = (w: number) => Math.max(3, Math.min(5, Math.floor((w - MORE_W) / (CARD_MIN + CARD_GAP))));

// ─── Chips ──────────────────────────────────────────────────────────────────

type StatusKind = "ok" | "no" | "pend";
interface StatusInfo { kind: StatusKind; text: string }
const STATUS_ICON: Record<StatusKind, string> = {
  ok: "M5 12.5l4.5 4.5L19 7.5",
  no: "M18 6 6 18M6 6l12 12",
  pend: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
};

/** Chip de estado de cumplimiento (reutilizable, 22px, radio 6). */
function StatusChip({ s }: { s: StatusInfo }) {
  return (
    <span className={`ido-status is-${s.kind}`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
        <path d={STATUS_ICON[s.kind]} />
      </svg>
      {s.text}
    </span>
  );
}

/** Chip % vs SIC con triángulo (abajo = más barato que la SIC). Conserva la
 *  alerta de umbral económico de la licitación (⚠ + tooltip). */
function PctChip({ pct, umbral }: { pct: number; umbral: number }) {
  const down = pct <= 0;
  const over = pct > umbral;
  return (
    <span
      className={`ido-pct ido-mono ${down ? "is-down" : "is-up"}`}
      title={over ? `Supera el umbral económico de la licitación (${NF1.format(umbral)} %)` : undefined}
    >
      {over && <AlertTriangle className="w-3 h-3" style={{ flex: "none" }} />}
      <svg width="8" height="8" viewBox="0 0 8 8" style={{ flex: "none", transform: down ? "rotate(180deg)" : "none" }}>
        <path d="M4 1 7.5 7H.5z" fill="currentColor" />
      </svg>
      {pct > 0 ? "+" : "−"}{NF1.format(Math.abs(pct))} %
    </span>
  );
}

// Avatar con color fijo por oferente (paleta categórica, fondo 15% + iniciales plenas).
function avatarColor(nombre: string): string {
  let h = 0;
  for (const ch of nombre) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(--ido-cat-${(h % 5) + 1})`;
}
function initialsOf(nombre: string): string {
  const w = nombre.replace(/[.]/g, "").split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? "")).toUpperCase();
}
export function Avatar({ nombre, size }: { nombre: string; size: number }) {
  const c = avatarColor(nombre);
  return (
    <span
      style={{
        width: size, height: size, flex: "none", borderRadius: 6, display: "grid", placeItems: "center",
        fontSize: size >= 28 ? 11 : 10, fontWeight: 600, color: c,
        background: `color-mix(in srgb, ${c} 15%, transparent)`,
      }}
    >
      {initialsOf(nombre)}
    </span>
  );
}

// ─── Tipos de cálculo ───────────────────────────────────────────────────────

interface Totals { arsUnit: number | null; arsQty: number | null; usdUnit: number | null; usdQty: number | null }
interface OfTotals extends Totals { cobertura: number }

interface BidRow {
  of: Oferente;
  tot: OfTotals;
  complete: boolean;
  rank: number | null;      // ranking por precio total (solo cobertura completa)
  best: boolean;
  pct: number | null;       // % del total vs SIC total
  savingArs: number | null; // SIC total − total ofertado
  savingUsd: number | null;
  tech: StatusInfo;
  cov: StatusInfo;
  risk: boolean;            // mejor oferta con informe o cobertura ≠ Cumple
  warnText: string;
}

// ─── Preferencias de vista (vista tarjetas/tabla + divisa) ──────────────────
// Viven en el padre (InformeTecnicoSection) porque sus controles van en la
// barra de arriba, al lado de «Ayuda», no dentro de la pestaña.

export interface AdjudicacionPrefs {
  view: View;
  viewFade: boolean;
  changeView: (v: View) => void;
  showUSD: boolean;
  setShowUSD: (v: boolean) => void;
}

export function useAdjudicacionPrefs(): AdjudicacionPrefs {
  const [view, setView] = useState<View>("cards");
  const [viewFade, setViewFade] = useState(false);
  const [showUSD, setShowUSD] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const viewT = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    return () => { if (viewT.current) clearTimeout(viewT.current); };
  }, []);
  // La vista se persiste por usuario (§10); la divisa no (es estado de sesión).
  useEffect(() => {
    if (!userId) return;
    const v = loadTableLayout(userId, LAYOUT_ID).view;
    if (v === "cards" || v === "table") setView(v);
  }, [userId]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const changeView = useCallback((v: View) => {
    if (viewRef.current === v) return;
    if (userId) saveTableLayout(userId, LAYOUT_ID, { view: v });
    // Fade cruzado de 120ms (§10): se apaga, cambia, se prende.
    setViewFade(true);
    if (viewT.current) clearTimeout(viewT.current);
    viewT.current = setTimeout(() => { setView(v); setViewFade(false); }, 120);
  }, [userId]);
  return { view, viewFade, changeView, showUSD, setShowUSD };
}

/** Conmutador de vista + divisa, para la barra superior de Informe Técnico.
 *  Lleva `.ido-terminal` propio: esa barra todavía está en el estilo viejo. */
export function AdjudicacionControls({ prefs, canShowUSD }: { prefs: AdjudicacionPrefs; canShowUSD: boolean }) {
  const { view, changeView, showUSD, setShowUSD } = prefs;
  const usd = showUSD && canShowUSD;
  return (
    <div className="ido-terminal" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div className="ido-viewsw is-lg" role="group" aria-label="Divisa">
        <button type="button" className={!usd ? "is-on" : ""} onClick={() => setShowUSD(false)} title="Ver montos en pesos">ARS</button>
        <button
          type="button"
          className={usd ? "is-on" : ""}
          onClick={() => canShowUSD && setShowUSD(true)}
          disabled={!canShowUSD}
          title={canShowUSD ? "Ver montos en dólares (dólar OP)" : "Cargá el Dólar OP en Datos generales para ver en USD"}
        >
          USD
        </button>
      </div>
      <div className="ido-viewsw is-lg" role="group" aria-label="Vista">
        <button type="button" title="Vista de tarjetas" className={view === "cards" ? "is-on" : ""} onClick={() => changeView("cards")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>
        </button>
        <button type="button" title="Vista de tabla" className={view === "table" ? "is-on" : ""} onClick={() => changeView("table")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"><path d="M4 4h16v16H4zM4 9.5h16M4 15h16M9 4v16" /></svg>
        </button>
      </div>
    </div>
  );
}

// ─── Componente ─────────────────────────────────────────────────────────────

export function AdjudicacionTab({ licitacion, prefs }: { licitacion: Licitacion; prefs: AdjudicacionPrefs }) {
  const licitacionId = licitacion.id;
  const [loading, setLoading] = useState(true);
  const [renglones, setRenglones] = useState<RenglonConItems[]>([]);
  const [oferentes, setOferentes] = useState<Oferente[]>([]);
  const [ofertasMap, setOfertasMap] = useState<Map<string, { precio: number; divisa: Divisa }>>(new Map());
  const [evalsMap, setEvalsMap] = useState<Map<string, { cumple: boolean | null }>>(new Map());
  const [adjMap, setAdjMap] = useState<Map<string, string>>(new Map()); // renglonId → oferenteId
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [ordersOverride, setOrdersOverride] = useState<Map<string, string[]>>(new Map());
  const [dragInfo, setDragInfo] = useState<{ renglonId: string; oferenteId: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [scrolled, setScrolled] = useState<Set<string>>(new Set()); // filas desplegadas con scroll > 0

  const { view, viewFade } = prefs;

  // ── Ancho disponible → cuántas tarjetas entran ─────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const [rootW, setRootW] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setRootW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  // ── Menú de clic derecho de la vista de tabla (§4.5) ───────────────────────
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; renglonId: string; ofId: string } | null>(null);
  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [rowMenu]);

  // ── Datos ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    Promise.all([
      listRenglonesConItems(licitacionId),
      listOferentes(licitacionId),
      listOfertas(licitacionId),
      listEvaluaciones(licitacionId),
      listAdjudicaciones(licitacionId),
    ])
      .then(([rens, offs, oftas, evs, adjs]: [RenglonConItems[], Oferente[], Oferta[], EvaluacionTecnica[], Adjudicacion[]]) => {
        setRenglones(rens);
        setOferentes(offs);
        // Solo las celdas con precio: una «No cotiza» cuenta como ítem sin
        // oferta (el renglón queda con cobertura parcial y no compite).
        const om = new Map<string, { precio: number; divisa: Divisa }>();
        for (const o of oftas) if (ofertaConPrecio(o)) om.set(`${o.item_id}|${o.oferente_id}`, { precio: o.precio_unitario, divisa: o.divisa });
        setOfertasMap(om);
        const em = new Map<string, { cumple: boolean | null }>();
        for (const ev of evs) em.set(`${ev.renglon_id}|${ev.oferente_id}`, { cumple: ev.cumple });
        setEvalsMap(em);
        const am = new Map<string, string>();
        for (const adj of adjs) am.set(adj.renglon_id, adj.oferente_id);
        setAdjMap(am);
      })
      .catch((e) => { console.error(e); toast.error("No se pudo cargar la adjudicación"); })
      .finally(() => setLoading(false));
  }, [licitacionId]);

  const fdOp  = licitacion.fd_op_valor;
  const fdSic = licitacion.fd_sic_valor;
  const umbral = licitacion.umbral_economico_pct;
  const canShowUSD = !!fdOp;
  // Si esta licitación no tiene dólar OP, se muestra en ARS aunque se haya
  // elegido USD en otra.
  const showUSD = prefs.showUSD && canShowUSD;

  // SIC del renglón: unitario y ×cantidad, en ARS (dólar SIC) y USD (dólar OP).
  const calcSicTotals = useCallback((r: RenglonConItems): Totals | null => {
    let arsUnit = 0, arsQty = 0, usdUnit = 0, usdQty = 0;
    let arsOk = true, usdOk = true;
    for (const it of r.items) {
      if (it.precio_sic_pesos === null) return null;
      const qty = it.cantidad ?? 1;
      if ((it.precio_sic_divisa ?? "ARS") === "USD") {
        if (fdSic) { arsUnit += it.precio_sic_pesos * fdSic; arsQty += it.precio_sic_pesos * qty * fdSic; }
        else arsOk = false;
        usdUnit += it.precio_sic_pesos; usdQty += it.precio_sic_pesos * qty;
      } else {
        arsUnit += it.precio_sic_pesos; arsQty += it.precio_sic_pesos * qty;
        if (fdOp) { usdUnit += it.precio_sic_pesos / fdOp; usdQty += (it.precio_sic_pesos * qty) / fdOp; }
        else usdOk = false;
      }
    }
    return {
      arsUnit: arsOk ? arsUnit : null, arsQty: arsOk ? arsQty : null,
      usdUnit: usdOk ? usdUnit : null, usdQty: usdOk ? usdQty : null,
    };
  }, [fdSic, fdOp]);

  // Total ofertado por un oferente en el renglón + cobertura (ítems ofertados).
  const calcOfertaTotals = useCallback((r: RenglonConItems, ofId: string): OfTotals => {
    let arsUnit = 0, arsQty = 0, usdUnit = 0, usdQty = 0, cnt = 0;
    let arsOk = true, usdOk = true;
    for (const it of r.items) {
      const o = ofertasMap.get(`${it.id}|${ofId}`);
      if (!o) continue;
      const qty = it.cantidad ?? 1;
      if (o.divisa === "ARS") {
        arsUnit += o.precio; arsQty += o.precio * qty;
        if (fdOp) { usdUnit += o.precio / fdOp; usdQty += (o.precio * qty) / fdOp; }
        else usdOk = false;
      } else {
        if (fdSic) { arsUnit += o.precio * fdSic; arsQty += o.precio * qty * fdSic; }
        else arsOk = false;
        usdUnit += o.precio; usdQty += o.precio * qty;
      }
      cnt++;
    }
    return {
      arsUnit: cnt > 0 && arsOk ? arsUnit : null, arsQty: cnt > 0 && arsOk ? arsQty : null,
      usdUnit: cnt > 0 && usdOk ? usdUnit : null, usdQty: cnt > 0 && usdOk ? usdQty : null,
      cobertura: cnt,
    };
  }, [ofertasMap, fdSic, fdOp]);

  // Filas de oferentes por renglón, ordenadas por precio total ascendente (§10).
  // Las de cobertura incompleta no son comparables: van al final sin ranking.
  const bidsByRenglon = useMemo(() => {
    const out = new Map<string, BidRow[]>();
    for (const r of renglones) {
      const sic = calcSicTotals(r);
      const n = r.items.length;
      const base = oferentes.map((of) => {
        const tot = calcOfertaTotals(r, of.id);
        return { of, tot, complete: n > 0 && tot.cobertura === n && tot.arsQty !== null };
      });
      const ranked = base.filter((b) => b.complete).sort((a, b) => a.tot.arsQty! - b.tot.arsQty!);
      const partial = base.filter((b) => !b.complete && b.tot.cobertura > 0);
      const none = base.filter((b) => !b.complete && b.tot.cobertura === 0);
      const rows: BidRow[] = [...ranked, ...partial, ...none].map((b) => {
        const rankIdx = ranked.indexOf(b);
        const best = rankIdx === 0;
        const ev = evalsMap.get(`${r.id}|${b.of.id}`);
        const tech: StatusInfo = !ev ? { kind: "pend", text: "Sin evaluar" }
          : ev.cumple === true ? { kind: "ok", text: "Cumple" }
          : ev.cumple === false ? { kind: "no", text: "No cumple" }
          : { kind: "pend", text: "Pendiente" };
        const cov: StatusInfo = b.complete || (n > 0 && b.tot.cobertura === n)
          ? { kind: "ok", text: `Cumple · ${b.tot.cobertura}/${n}` }
          : { kind: "no", text: `No cumple · ${b.tot.cobertura}/${n}` };
        const pct = b.complete && sic?.arsQty ? (b.tot.arsQty! / sic.arsQty - 1) * 100 : null;
        const savingArs = b.complete && sic?.arsQty != null ? sic.arsQty - b.tot.arsQty! : null;
        const savingUsd = b.complete && sic?.usdQty != null && b.tot.usdQty != null ? sic.usdQty - b.tot.usdQty : null;
        const risk = best && (tech.kind !== "ok" || cov.kind !== "ok");
        const warnText = [
          tech.kind !== "ok" ? `Informe técnico ${tech.text.toLowerCase()}` : null,
          cov.kind !== "ok" ? `Cobertura ${cov.text.split(" · ")[0].toLowerCase()}` : null,
        ].filter(Boolean).join(" · ");
        return { of: b.of, tot: b.tot, complete: b.complete, rank: rankIdx >= 0 ? rankIdx + 1 : null, best, pct, savingArs, savingUsd, tech, cov, risk, warnText };
      });
      out.set(r.id, rows);
    }
    return out;
  }, [renglones, oferentes, evalsMap, calcSicTotals, calcOfertaTotals]);

  const handleAdjudicar = async (renglonId: string, ofId: string) => {
    setSaving((p) => new Set(p).add(renglonId));
    try {
      if (adjMap.get(renglonId) === ofId) {
        await deleteAdjudicacion(renglonId);
        setAdjMap((p) => { const n = new Map(p); n.delete(renglonId); return n; });
      } else {
        await upsertAdjudicacion({ renglon_id: renglonId, oferente_id: ofId });
        setAdjMap((p) => new Map(p).set(renglonId, ofId));
      }
    } catch (e) { console.error(e); toast.error("No se pudo guardar"); }
    finally { setSaving((p) => { const n = new Set(p); n.delete(renglonId); return n; }); }
  };

  const reorderOferentes = (renglonId: string, baseOrder: string[], fromId: string, toId: string) => {
    setOrdersOverride((prev) => {
      const cur = prev.get(renglonId) ?? baseOrder;
      const arr = [...cur];
      const from = arr.indexOf(fromId), to = arr.indexOf(toId);
      if (from < 0 || to < 0 || from === to) return prev;
      arr.splice(from, 1);
      arr.splice(to, 0, fromId);
      const next = new Map(prev);
      next.set(renglonId, arr);
      return next;
    });
  };

  // ── Formato (en la divisa elegida) ─────────────────────────────────────────
  const cur = showUSD ? "USD" : "ARS";
  const sym = showUSD ? "US$" : "$";
  const pick = (ars: number | null, usd: number | null) => (showUSD ? usd : ars);
  const fmt2 = (ars: number | null, usd: number | null) => { const v = pick(ars, usd); return v == null ? null : NF2.format(v); };
  const fmt0 = (ars: number | null, usd: number | null) => { const v = pick(ars, usd); return v == null ? null : NF0.format(v); };

  // ── Estados vacíos ─────────────────────────────────────────────────────────
  if (loading) return (
    <div className="ido-terminal"><div className="ido-loading"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</div></div>
  );
  if (renglones.length === 0 || oferentes.length === 0) return (
    <div className="ido-terminal">
      <div className="ido-loading" style={{ border: "1px dashed var(--ido-border)", borderRadius: 12 }}>
        {renglones.length === 0
          ? <>No hay renglones. Cargalos en <strong style={{ color: "var(--ido-text)" }}>Renglones e Ítems</strong> primero.</>
          : <>No hay oferentes. Cargalos en <strong style={{ color: "var(--ido-text)" }}>Oferentes</strong> primero.</>}
      </div>
    </div>
  );

  const missingRates = !fdSic || !fdOp;

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const sum = (vals: (number | null)[]) => vals.some((v) => v === null) ? null : vals.reduce<number>((a, v) => a + (v ?? 0), 0);
  const sicTotals = renglones.map((r) => calcSicTotals(r));
  const sicArs = sum(sicTotals.map((s) => s?.arsQty ?? null));
  const sicUsd = sum(sicTotals.map((s) => s?.usdQty ?? null));
  // Mejor combinación: el más barato de cada renglón (o la SIC si nadie cubre el renglón completo).
  const bestPerRen = renglones.map((r, i) => {
    const best = bidsByRenglon.get(r.id)?.find((b) => b.best);
    return best ? { ars: best.tot.arsQty, usd: best.tot.usdQty } : { ars: sicTotals[i]?.arsQty ?? null, usd: sicTotals[i]?.usdQty ?? null };
  });
  const bestArs = sum(bestPerRen.map((b) => b.ars));
  const bestUsd = sum(bestPerRen.map((b) => b.usd));
  const ahorroArs = sicArs !== null && bestArs !== null ? sicArs - bestArs : null;
  const ahorroUsd = sicUsd !== null && bestUsd !== null ? sicUsd - bestUsd : null;
  const ahorroVal = pick(ahorroArs, ahorroUsd);
  const adjRens = renglones.filter((r) => adjMap.has(r.id));
  const adjArs = adjRens.length ? sum(adjRens.map((r) => calcOfertaTotals(r, adjMap.get(r.id)!).arsQty)) : null;
  const adjUsd = adjRens.length ? sum(adjRens.map((r) => calcOfertaTotals(r, adjMap.get(r.id)!).usdQty)) : null;

  const kpis: { label: string; value: string; cur: boolean; tone?: "pos" | "neg"; narrow?: boolean }[] = [
    { label: "Presupuesto de SIC oficial", value: fmt0(sicArs, sicUsd) ?? "—", cur: true },
    { label: "Mejor combinación de los oferentes", value: fmt0(bestArs, bestUsd) ?? "—", cur: true },
    {
      label: ahorroVal !== null && ahorroVal < 0 ? "Sobrecosto potencial total" : "Ahorro potencial total",
      value: ahorroVal === null ? "—" : `${ahorroVal < 0 ? "−" : "+"}${NF0.format(Math.abs(ahorroVal))}`,
      cur: ahorroVal !== null, tone: ahorroVal === null ? undefined : ahorroVal < 0 ? "neg" : "pos",
    },
    { label: "Presupuesto de las adjudicaciones", value: adjRens.length ? fmt0(adjArs, adjUsd) ?? "—" : "—", cur: adjRens.length > 0 },
    { label: "Oferentes", value: String(oferentes.length), cur: false, narrow: true },
  ];

  const fitN = cardsThatFit(rootW || 1200);
  const slotW = rootW ? (rootW - CARD_GAP * (fitN - 1)) / fitN : undefined;

  return (
    <div ref={rootRef} className="ido-terminal" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {missingRates && (
        <div className="ido-bid-warn" style={{ marginBottom: 0 }}>
          <AlertTriangle className="w-3.5 h-3.5" style={{ flex: "none" }} />
          <span style={{ color: "var(--ido-text)" }}>Cargá los valores del dólar SIC y OP en <strong>Datos generales</strong> para calcular el % vs. SIC.</span>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, animation: "ido-block-in 200ms var(--ido-ease) both" }}>
        <div className="ido-mono" style={{ alignSelf: "flex-end", fontSize: 11, color: "var(--ido-text-2)" }}>
          {!canShowUSD
            ? "Cargá el Dólar OP para ver en USD"
            : `1 USD = ${fdOp!.toLocaleString("es-AR")} ARS ref.`}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {kpis.map((k) => (
            <div key={k.label} className="ido-kpi" style={{ flex: k.narrow ? "1 1 120px" : "1 1 200px" }}>
              <div className="ido-bid-label" style={{ whiteSpace: "normal" }}>{k.label}</div>
              <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", gap: 6 }}>
                <span className={`ido-mono ${k.tone === "pos" ? "ido-pos" : k.tone === "neg" ? "ido-neg" : ""}`} style={{ fontSize: 18, fontWeight: 600 }}>{k.value}</span>
                {k.cur && <span style={{ fontSize: 11, color: "var(--ido-placeholder)" }}>{cur}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Renglones */}
      {renglones.map((r, ri) => {
        const sic = sicTotals[ri];
        const rows = bidsByRenglon.get(r.id) ?? [];
        const adjOfId = adjMap.get(r.id);
        const adjOf = adjOfId ? oferentes.find((o) => o.id === adjOfId) : undefined;
        const isSaving = saving.has(r.id);
        const nombreRenglon = r.items[0]?.descripcion?.trim() || r.items[0]?.matricula || `Renglón ${r.numero}`;
        const cantidad = r.items.length === 1 ? `${NF0.format(r.items[0].cantidad ?? 1)} u.` : `${r.items.length} ítems`;
        const condicion = r.condicion_adjudicacion?.trim() || "";
        const best = rows.find((b) => b.best);

        // Orden de las tarjetas: precio, o el que se armó arrastrando.
        const baseOrder = rows.map((b) => b.of.id);
        const override = ordersOverride.get(r.id);
        const order = override
          ? [...override.filter((id) => baseOrder.includes(id)), ...baseOrder.filter((id) => !override.includes(id))]
          : baseOrder;
        const cardRows = order.map((id) => rows.find((b) => b.of.id === id)!).filter(Boolean);

        const isExp = expanded.has(r.id);
        // Plegada: los lugares visibles son para quien cotizó este renglón. Los
        // que no ofertaron nada van directo a «N oferentes más» (si no, en un
        // renglón con 2 ofertas, 3 de las 5 tarjetas serían «Sin ofertar»).
        const offered = cardRows.filter((b) => b.tot.cobertura > 0);
        const fit = Math.min(offered.length, fitN);
        const shown = isExp ? cardRows : offered.slice(0, fit);
        const rest = cardRows.filter((b) => !shown.includes(b));
        const restPriced = rest.filter((b) => b.complete).map((b) => pick(b.tot.arsQty, b.tot.usdQty)!).filter((v) => v != null);
        return (
          <section key={r.id} style={{ display: "flex", flexDirection: "column", gap: 12, animation: "ido-block-in 200ms var(--ido-ease) both", animationDelay: `${(ri + 1) * 40}ms` }}>
            {/* Cabecera de renglón. El bloque SIC ocupa el espacio que queda y
                reparte SIC unitario / SIC total centrados en él. */}
            <div className="ido-ren-head">
              <span className="ido-ren-chip ido-mono" style={{ flex: "none" }}>Renglón {String(r.numero).padStart(2, "0")}</span>
              <div style={{ flex: "0 1 auto", minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ido-text)" }}>
                  {nombreRenglon} · {cantidad} · {rows.length} oferente{rows.length === 1 ? "" : "s"}
                </div>
                {condicion && <div style={{ fontSize: 12, color: "var(--ido-text-2)", marginTop: 2 }}>{condicion}</div>}
              </div>
              {sic && (
                <div className="ido-ren-sic" style={{ flex: "1 1 260px", justifyContent: "space-evenly" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span className="ido-ren-sic-label">SIC unitario</span>
                    <span className="ido-mono" style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" }}>{sym} {fmt2(sic.arsUnit, sic.usdUnit) ?? "—"}</span>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span className="ido-ren-sic-label">SIC total</span>
                    <span className="ido-mono" style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" }}>{sym} {fmt2(sic.arsQty, sic.usdQty) ?? "—"}</span>
                  </span>
                </div>
              )}
              {adjOf && (
                <span className="ido-pill-tag" title="Oferente adjudicado en este renglón">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}><path d="M4 12.5l5 5L20 6.5" /></svg>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>Adjudicado · {adjOf.nombre}</span>
                </span>
              )}
              {view === "cards" && isExp && (
                <button
                  type="button"
                  className="ido-btn ido-btn-text"
                  style={{ height: 32 }}
                  onClick={() => { setExpanded((p) => { const n = new Set(p); n.delete(r.id); return n; }); setScrolled((p) => { const n = new Set(p); n.delete(r.id); return n; }); }}
                >
                  Ver solo {fitN === 5 ? "cinco" : fitN === 4 ? "cuatro" : "tres"}
                </button>
              )}
            </div>

            <div style={{ opacity: viewFade ? 0 : 1, minWidth: 0, transition: "opacity 120ms var(--ido-ease)" }}>
              {view === "cards" ? (
                <div
                  onScroll={isExp ? (e) => {
                    const on = e.currentTarget.scrollLeft > 2;
                    if (on !== scrolled.has(r.id)) setScrolled((p) => { const n = new Set(p); if (on) n.add(r.id); else n.delete(r.id); return n; });
                  } : undefined}
                  style={{
                    overflowX: isExp ? "auto" : "hidden", overflowY: "hidden",
                    scrollSnapType: isExp ? "x mandatory" : "none", scrollPaddingLeft: CARD_EXPANDED_W + CARD_GAP,
                    paddingBottom: 4,
                  }}
                >
                  <div style={{ display: "flex", gap: CARD_GAP, alignItems: "stretch", width: isExp ? "max-content" : "auto", minWidth: "100%" }}>
                    {shown.map((b, i) => {
                      const isAdj = adjOfId === b.of.id;
                      const dim = !!adjOfId && !isAdj;
                      const stickyFirst = isExp && i === 0;
                      const isDragging = dragInfo?.renglonId === r.id && dragInfo?.oferenteId === b.of.id;
                      const totalV = fmt2(b.tot.arsQty, b.tot.usdQty);
                      const savingV = pick(b.savingArs, b.savingUsd);
                      const diffBest = best && b.complete && !b.best
                        ? pick(b.tot.arsQty! - best.tot.arsQty!, b.tot.usdQty != null && best.tot.usdQty != null ? b.tot.usdQty - best.tot.usdQty : null)
                        : null;
                      return (
                        <div
                          key={b.of.id}
                          draggable
                          onDragStart={(e) => { setDragInfo({ renglonId: r.id, oferenteId: b.of.id }); e.dataTransfer.effectAllowed = "move"; }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (dragInfo && dragInfo.renglonId === r.id && dragInfo.oferenteId !== b.of.id) reorderOferentes(r.id, baseOrder, dragInfo.oferenteId, b.of.id);
                            setDragInfo(null);
                          }}
                          onDragEnd={() => setDragInfo(null)}
                          title="Arrastrá para reordenar"
                          style={{
                            flex: isExp ? `0 0 ${CARD_EXPANDED_W}px` : "1 1 0",
                            minWidth: CARD_MIN,
                            // Con menos tarjetas que lugares, cada una ocupa su lugar (no se estira).
                            maxWidth: !isExp && shown.length < fitN && slotW ? slotW : undefined,
                            display: "flex", position: stickyFirst ? "sticky" : "relative", left: 0, zIndex: stickyFirst ? 3 : 1,
                            background: "var(--ido-base)", borderRadius: 12,
                            scrollSnapAlign: isExp && i > 0 ? "start" : "none",
                            animation: `${isExp && i >= fit ? "ido-card-in" : "ido-block-in"} 200ms var(--ido-ease) both`,
                            animationDelay: `${(isExp && i >= fit ? i - fit : i) * 40}ms`,
                            cursor: "grab",
                            opacity: isDragging ? 0.45 : 1,
                          }}
                        >
                          <div className={`ido-bid${b.risk ? " is-risk" : b.best ? " is-best" : ""}`} style={{ opacity: dim ? 0.5 : 1 }}>
                            {/* Ranking + Mejor oferta */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                              <span className="ido-bid-rank ido-mono">{b.rank ? `#${b.rank}` : "—"}</span>
                              {b.best && <span className="ido-bid-best">Mejor oferta</span>}
                            </div>
                            {/* Avatar + nombre */}
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, minWidth: 0 }}>
                              <Avatar nombre={b.of.nombre} size={28} />
                              <span title={b.of.nombre} style={{ fontSize: 14, fontWeight: 600, color: "var(--ido-text)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{b.of.nombre}</span>
                            </div>
                            {/* Precio total */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                                <span className="ido-bid-label" title="Precio total del renglón" style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>Precio total</span>
                                <span style={{ fontSize: 11, color: "var(--ido-placeholder)", flex: "none" }}>{cur}</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "baseline", whiteSpace: "nowrap", minWidth: 0, overflow: "hidden" }}>
                                <span className="ido-mono" title={totalV ?? undefined} style={{ fontSize: 24, fontWeight: b.best ? 600 : 500, lineHeight: 1.2, letterSpacing: "-.01em", color: "var(--ido-text)", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {b.complete ? totalV ?? "—" : "—"}
                                </span>
                              </div>
                              {/* Línea reservada en todas para que las filas alineen entre tarjetas */}
                              <span
                                className={b.best ? "" : "ido-mono"}
                                style={{ height: 18, lineHeight: "18px", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: b.best ? "rgba(63,207,142,.7)" : "var(--ido-text-2)", fontFamily: b.complete && !b.best ? undefined : "var(--font-sans, system-ui, sans-serif)" }}
                              >
                                {b.best ? "Mejor precio del renglón"
                                  : diffBest != null ? `+${sym} ${NF0.format(diffBest)} vs #1`
                                  : b.tot.cobertura === 0 ? "Sin ofertar"
                                  : !b.complete ? "Cobertura incompleta" : ""}
                              </span>
                            </div>
                            {/* Unitario */}
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
                              <span className="ido-bid-key">Unitario</span>
                              <span className="ido-mono" style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", color: "var(--ido-text)" }}>
                                {b.tot.cobertura > 0 && fmt2(b.tot.arsUnit, b.tot.usdUnit) != null ? `${sym} ${fmt2(b.tot.arsUnit, b.tot.usdUnit)}` : "—"}
                              </span>
                            </div>
                            {/* Ahorro / Sobrecosto vs SIC */}
                            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
                              <span className="ido-bid-key" title={savingV != null && savingV < 0 ? "Sobrecosto vs SIC" : "Ahorro vs SIC"} style={{ lineHeight: "20px" }}>{savingV != null && savingV < 0 ? "Sobrecosto vs SIC" : "Ahorro vs SIC"}</span>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flex: "none" }}>
                                {savingV == null ? (
                                  <span className="ido-mono" style={{ fontSize: 14, lineHeight: "20px", color: "var(--ido-text-2)" }}>—</span>
                                ) : (
                                  <span className={`ido-mono ${savingV < 0 ? "ido-neg" : "ido-pos"}`} style={{ fontSize: 14, lineHeight: "20px", fontWeight: 500, whiteSpace: "nowrap" }}>
                                    {savingV < 0 ? "−" : ""}{sym} {NF0.format(Math.abs(savingV))}
                                  </span>
                                )}
                                {b.pct != null && <PctChip pct={b.pct} umbral={umbral} />}
                              </div>
                            </div>
                            <div style={{ height: 1, background: "rgba(255,255,255,.08)", margin: "12px 0" }} />
                            {/* Cumplimiento */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                              {[{ label: "Informe técnico", s: b.tech }, { label: "Cobertura", s: b.cov }].map((c) => (
                                <div key={c.label} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, minWidth: 0 }}>
                                  <span className="ido-bid-key">{c.label}</span>
                                  <StatusChip s={c.s} />
                                </div>
                              ))}
                            </div>
                            <div style={{ flex: 1, minHeight: 16 }} />
                            {b.risk && (
                              <div className="ido-bid-warn">
                                <AlertTriangle className="w-3.5 h-3.5" style={{ flex: "none" }} />
                                <span style={{ color: "var(--ido-text)", minWidth: 0 }}>{b.warnText}</span>
                              </div>
                            )}
                            <button
                              type="button"
                              className={`ido-bid-btn${b.best ? " is-primary" : ""}`}
                              onClick={() => handleAdjudicar(r.id, b.of.id)}
                              disabled={isSaving}
                              title={isAdj ? "Clic para desadjudicar" : undefined}
                              draggable={false}
                              onDragStart={(e) => e.preventDefault()}
                            >
                              {isSaving && isAdj ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (
                                <span style={{ position: "relative", width: isAdj ? 14 : 0, height: 14, display: "inline-block", overflow: "hidden", transition: "width 200ms var(--ido-ease)" }}>
                                  <svg style={{ position: "absolute", inset: 0, opacity: isAdj ? 1 : 0, transition: "opacity 200ms var(--ido-ease)" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg>
                                </span>
                              )}
                              {isAdj ? "Adjudicada" : "Adjudicar"}
                            </button>
                          </div>
                          {/* Sombra de scroll a la derecha de la tarjeta anclada */}
                          {stickyFirst && (
                            <span style={{ position: "absolute", top: 0, bottom: 0, right: -16, width: 16, pointerEvents: "none", background: "linear-gradient(to right, rgba(0,0,0,.55), rgba(0,0,0,0))", opacity: scrolled.has(r.id) ? 1 : 0, transition: "opacity 140ms var(--ido-ease)" }} />
                          )}
                        </div>
                      );
                    })}
                    {!isExp && rest.length > 0 && (
                      <button
                        type="button"
                        className="ido-bid-more"
                        title="Mostrar todos los oferentes"
                        onClick={() => setExpanded((p) => new Set(p).add(r.id))}
                        style={{ animation: "ido-block-in 200ms var(--ido-ease) both", animationDelay: `${fit * 40}ms` }}
                      >
                        <span style={{ width: 28, height: 28, borderRadius: 999, background: "var(--ido-elevated)", display: "grid", placeItems: "center", color: "var(--ido-text-2)" }}>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
                          <span className="ido-mono">{rest.length}</span> oferente{rest.length === 1 ? "" : "s"} más
                        </span>
                        <span className="ido-mono" style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "var(--ido-text-2)", whiteSpace: "nowrap" }}>
                          {restPriced.length > 0 ? (
                            <>
                              <span>{cur} {NF0.format(Math.min(...restPriced))}</span>
                              {restPriced.length > 1 && <span>a {NF0.format(Math.max(...restPriced))}</span>}
                            </>
                          ) : <span>sin cotizar</span>}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* Vista de tabla */
                <div className="ido-bidtable">
                  <div style={{ minWidth: 1136 }}>
                    <div style={{ display: "grid", gridTemplateColumns: TABLE_COLS, background: "var(--ido-surface)", borderBottom: "1px solid var(--ido-border-strong)" }}>
                      {TABLE_HEADERS.map((h) => (
                        <div key={h.label} title={h.label} className="ido-bid-label" style={{ height: 38, display: "flex", alignItems: "center", justifyContent: h.right ? "flex-end" : "flex-start", padding: "0 12px", overflow: "hidden" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{h.label}</span>
                        </div>
                      ))}
                    </div>
                    {rows.map((b, i) => {
                      const isAdj = adjOfId === b.of.id;
                      const savingV = pick(b.savingArs, b.savingUsd);
                      return (
                        <div
                          key={b.of.id}
                          className={`ido-bidtable-row${b.best ? " is-best" : ""}`}
                          style={{ gridTemplateColumns: TABLE_COLS, animationDelay: `${Math.min(i, 15) * 12}ms`, opacity: adjOfId && !isAdj ? 0.5 : 1 }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setRowMenu({ x: Math.min(e.clientX, window.innerWidth - 224), y: Math.min(e.clientY, window.innerHeight - 60), renglonId: r.id, ofId: b.of.id });
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", padding: "0 12px 0 16px" }}>
                            <span className="ido-bid-rank ido-mono" style={{ minWidth: 28 }}>{b.rank ? `#${b.rank}` : "—"}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", minWidth: 0, overflow: "hidden" }}>
                            <Avatar nombre={b.of.nombre} size={24} />
                            <span title={b.of.nombre} style={{ fontSize: 13, fontWeight: 500, color: "var(--ido-text)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{b.of.nombre}</span>
                            {isAdj && <span className="ido-pill-tag" style={{ flex: "none", height: 20 }}>Adjudicada</span>}
                          </div>
                          <div className="ido-mono" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 12px", fontSize: 13, fontWeight: 500, color: "var(--ido-text)", whiteSpace: "nowrap", overflow: "hidden" }}>
                            {b.complete ? fmt2(b.tot.arsQty, b.tot.usdQty) ?? "—" : "—"}
                          </div>
                          <div className="ido-mono" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 12px", fontSize: 13, color: "var(--ido-text)", whiteSpace: "nowrap", overflow: "hidden" }}>
                            {b.tot.cobertura > 0 && fmt2(b.tot.arsUnit, b.tot.usdUnit) != null ? `${sym} ${fmt2(b.tot.arsUnit, b.tot.usdUnit)}` : "—"}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 12px", overflow: "hidden" }}>
                            {b.pct != null ? <PctChip pct={b.pct} umbral={umbral} /> : <span style={{ color: "var(--ido-text-2)" }}>—</span>}
                          </div>
                          <div className={`ido-mono ${savingV == null ? "" : savingV < 0 ? "ido-neg" : "ido-pos"}`} title={savingV != null && savingV < 0 ? "Sobrecosto vs SIC" : "Ahorro vs SIC"} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 12px", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", color: savingV == null ? "var(--ido-text-2)" : undefined }}>
                            {savingV == null ? "—" : `${savingV < 0 ? "−" : ""}${sym} ${NF0.format(Math.abs(savingV))}`}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", padding: "0 12px", overflow: "hidden" }}><StatusChip s={b.tech} /></div>
                          <div style={{ display: "flex", alignItems: "center", padding: "0 12px", overflow: "hidden" }}><StatusChip s={b.cov} /></div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        );
      })}

      {/* Resumen de adjudicación */}
      {adjMap.size > 0 && (
        <div className="ido-kpi" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ido-text-2)", marginBottom: 10 }}>
            Resumen de adjudicación
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {renglones.map((r) => {
              const adjOfId = adjMap.get(r.id);
              const adjOf = adjOfId ? oferentes.find((o) => o.id === adjOfId) : null;
              const tot = adjOfId ? calcOfertaTotals(r, adjOfId) : null;
              const complete = !!tot && tot.cobertura === r.items.length;
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <span className="ido-ren-chip ido-mono" style={{ flex: "none" }}>Renglón {String(r.numero).padStart(2, "0")}</span>
                  {adjOf ? (
                    <>
                      <span style={{ color: "var(--ido-text)", fontWeight: 500 }}>{adjOf.nombre}</span>
                      {complete && tot && (
                        <span className="ido-mono" style={{ marginLeft: "auto", color: "var(--ido-text)" }}>
                          {sym} {fmt2(tot.arsQty, tot.usdQty) ?? "—"}
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{ color: "var(--ido-text-2)", fontStyle: "italic" }}>Sin adjudicar</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Menú de clic derecho de la vista de tabla */}
      {rowMenu && createPortal(
        <div
          className="ido-terminal ido-menu"
          style={{ left: rowMenu.x, top: rowMenu.y, width: 216 }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            role="menuitem"
            className="ido-menu-item"
            style={{ cursor: "pointer" }}
            onClick={() => { const m = rowMenu; setRowMenu(null); handleAdjudicar(m.renglonId, m.ofId); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--ido-text-dim)" }}>
              <path d={adjMap.get(rowMenu.renglonId) === rowMenu.ofId ? "M18 6 6 18M6 6l12 12" : "M4 12.5l5 5L20 6.5"} />
            </svg>
            <span style={{ flex: 1 }}>{adjMap.get(rowMenu.renglonId) === rowMenu.ofId ? "Desadjudicar" : "Adjudicar"}</span>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
