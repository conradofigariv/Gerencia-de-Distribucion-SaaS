"use client";

// Mapa de zonas de Stock por Zona. Portado de `MapaZonas.html` (import de
// Claude Design): Leaflet 100% vectorial, sin tiles, sobre los límites IGN de
// Córdoba. Suma la capa de stock: la matrícula elegida pinta las zonas según su
// cantidad y la tarjeta de la localidad lista el stock de más cercano a más lejano.

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureGroup, FitBoundsOptions, LatLngBounds, Map as LMap, Marker, Polyline } from "leaflet";
import type { GeoPermissibleObjects } from "d3-geo";
import {
  Check, ChevronUp, ChevronDown, Clock, Copy, ExternalLink, MapPin, Maximize, Minus, Plus, RotateCw, Search,
  TriangleAlert, X,
} from "lucide-react";
import {
  armarModelo, cargarGeo, km, unidadDeStock, zonaColorVar,
  type Localidad, type MapaModelo, type Unidad, type UnidadCode, type ZonaCode,
} from "@/lib/mapaZonas";

type LeafletNS = typeof import("leaflet");
type StockPorUnidad = Partial<Record<UnidadCode, number>>;

export interface MapaStockRow {
  articulo: string;
  descArticulo: string;
  udmPrimaria: string;
  total: number;
  byZona: Record<string, number>;
}

interface MapaZonasProps {
  rows: MapaStockRow[];
  pinned: string[];
  articulo: string | null;
  onArticuloChange: (articulo: string | null) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RECENT_KEY = "mapa.recientes.v1";
const CBA: [number, number] = [-64.18, -31.42];

const fmtNum = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
const fmtKm = (n: number) => n.toFixed(1).replace(".", ",") + " km";
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
// Normaliza carácter por carácter para que los índices coincidan con el nombre original (resaltado).
const norm = (s: string) =>
  Array.from(s).map((c) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()).join("");

function readRecents(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function pushRecent(name: string): string[] {
  const r = [name, ...readRecents().filter((x) => x !== name)].slice(0, 5);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch { /* sin storage */ }
  return r;
}

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

interface LocIdx { l: Localidad; n: string; words: { w: string; p: number }[] }
interface LocHit { l: Localidad; h: [number, number] }

const inFiltro = (l: Localidad, f: string | null) => !f || l.zona === f || l.subzona === f;

// Búsqueda tolerante a errores (prefijo > palabra > interior > Levenshtein), como el diseño.
function buscarLocalidades(q: string, idx: LocIdx[], filtro: string | null): LocHit[] {
  const qn = norm(q.trim());
  if (!qn) return [];
  const allowed = qn.length >= 7 ? 2 : qn.length >= 4 ? 1 : 0;
  const out: (LocHit & { s: number })[] = [];
  for (const it of idx) {
    if (!inFiltro(it.l, filtro)) continue;
    const i = it.n.indexOf(qn);
    if (i >= 0) { out.push({ l: it.l, s: i === 0 ? 0 : it.n[i - 1] === " " ? 1 : 2, h: [i, i + qn.length] }); continue; }
    if (!allowed) continue;
    let best: { d: number; h: [number, number] } | null = null;
    for (const { w, p } of it.words) {
      for (const len of [qn.length - 1, qn.length, qn.length + 1]) {
        if (len < 2 || len > w.length) continue;
        const d = lev(qn, w.slice(0, len));
        if (d <= allowed && (!best || d < best.d)) best = { d, h: [p, p + len] };
      }
    }
    if (!best && qn.includes(" ")) {
      const d = lev(qn, it.n.slice(0, qn.length));
      if (d <= allowed) best = { d, h: [0, qn.length] };
    }
    if (best) out.push({ l: it.l, s: 3 + best.d, h: best.h });
  }
  out.sort((a, b) => a.s - b.s || a.l.nombre.length - b.l.nombre.length || a.l.nombre.localeCompare(b.l.nombre));
  return out.slice(0, 8);
}

function buscarMatriculas(q: string, rows: MapaStockRow[]): MapaStockRow[] {
  const qn = norm(q.trim());
  if (!qn) return [];
  const pref: MapaStockRow[] = [];
  const rest: MapaStockRow[] = [];
  for (const r of rows) {
    const a = norm(r.articulo);
    if (a.startsWith(qn)) pref.push(r);
    else if (a.includes(qn) || norm(r.descArticulo).includes(qn)) rest.push(r);
    if (pref.length >= 8) break;
  }
  return pref.concat(rest).slice(0, 8);
}

function Highlight({ text, h }: { text: string; h: [number, number] }) {
  if (h[0] === h[1]) return <>{text}</>;
  return <>{text.slice(0, h[0])}<mark>{text.slice(h[0], h[1])}</mark>{text.slice(h[1])}</>;
}

function ZoneBadge({ code, text }: { code: string; text?: string }) {
  const c = zonaColorVar(code);
  return (
    <span className="mz-badge" style={{ background: `color-mix(in srgb, ${c} 15%, transparent)`, color: c }}>
      <i style={{ background: c }} />{text ?? code}
    </span>
  );
}
const LocBadge = ({ l }: { l: Localidad }) =>
  l.subzona ? <ZoneBadge code={l.subzona} text={`${l.zona} · ${l.subzona}`} /> : <ZoneBadge code={l.zona} />;

function badgeHtml(code: string, text?: string): string {
  const c = zonaColorVar(code);
  return `<span class="mz-badge" style="background:color-mix(in srgb, ${c} 15%, transparent);color:${c}"><i style="background:${c}"></i>${esc(text ?? code)}</span>`;
}

function zoneTipHtml(u: Unidad, qty: number | null, udm: string): string {
  const head = u.subzona
    ? `<span style="display:inline-flex;align-items:center;gap:8px"><i style="width:6px;height:6px;border-radius:999px;display:inline-block;background:${zonaColorVar(u.code)}"></i><span><b style="font-weight:600">Zona ${u.zona}</b> · ${u.code} · ${esc(u.delegacion)}</span></span>`
    : `<span style="display:inline-flex;align-items:center;gap:8px">${badgeHtml(u.code)}<span>${esc(u.delegacion)}</span></span>`;
  if (qty === null) return head;
  const txt = qty > 0 ? `${fmtNum(qty)}${udm ? " " + esc(udm) : ""}` : "Sin stock";
  return `${head}<div class="mz-mono" style="margin-top:4px;font-size:12px;color:${qty > 0 ? "var(--ido-text)" : "var(--ido-text-2)"}">${txt}</div>`;
}

const fLabel = (code: string) => (code === "BN" || code === "BS" ? `Zona B · ${code}` : `Zona ${code}`);

function fitOpts(panel: HTMLElement | null): FitBoundsOptions {
  const narrow = !panel || panel.clientWidth < 900;
  return narrow
    ? { paddingTopLeft: [16, 112], paddingBottomRight: [16, 24] }
    : { paddingTopLeft: [280, 78], paddingBottomRight: [280, 78] };
}

const prefersReduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ─── Componente ───────────────────────────────────────────────────────────────

export default function MapaZonas({ rows, pinned, articulo, onArticuloChange }: MapaZonasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const qRef = useRef<HTMLInputElement>(null);

  const [height, setHeight] = useState(640);
  const [modelo, setModelo] = useState<MapaModelo | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [showSkel, setShowSkel] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const [introOn, setIntroOn] = useState(() => !prefersReduced());
  const [fading, setFading] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [act, setAct] = useState(-1);
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Localidad | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const [legendClosed, setLegendClosed] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  const [lgOpenB, setLgOpenB] = useState(true);
  const [copied, setCopied] = useState(false);

  const [matQuery, setMatQuery] = useState("");
  const [matFocused, setMatFocused] = useState(false);
  const [matAct, setMatAct] = useState(-1);

  // Leaflet (imperativo) — vive en refs, fuera del ciclo de render.
  const LRef = useRef<LeafletNS | null>(null);
  const mapRef = useRef<LMap | null>(null);
  const modeloRef = useRef<MapaModelo | null>(null);
  const provBoundsRef = useRef<LatLngBounds | null>(null);
  const zoneLayersRef = useRef<Partial<Record<UnidadCode, FeatureGroup>>>({});
  const zoneBordersRef = useRef<Partial<Record<ZonaCode, Polyline>>>({});
  const zoneDividersRef = useRef<Partial<Record<ZonaCode, Polyline>>>({});
  const unitLabelsRef = useRef<Partial<Record<UnidadCode, Marker>>>({});
  const bigLabelsRef = useRef<Partial<Record<ZonaCode, Marker>>>({});
  const pinRef = useRef<Marker | null>(null);
  const routeRef = useRef<Polyline | null>(null);
  const ghostRef = useRef<Marker | null>(null);
  const hoverRef = useRef<{ zona: ZonaCode | null; sub: UnidadCode | null }>({ zona: null, sub: null });
  const selZoneRef = useRef<ZonaCode | null>(null);
  const stockRef = useRef<StockPorUnidad | null>(null);
  const userMovedRef = useRef(false);
  const introRunningRef = useRef(introOn);
  const handlersRef = useRef<{ onZoneClick: (z: ZonaCode) => void; onLocClick: (l: Localidad) => void }>({
    onZoneClick: () => {},
    onLocClick: () => {},
  });

  // ── Stock de la matrícula elegida, por unidad geográfica ────────────────────
  const row = useMemo(() => (articulo ? rows.find((r) => r.articulo === articulo) ?? null : null), [rows, articulo]);
  const stockPorUnidad = useMemo<StockPorUnidad | null>(() => {
    if (!articulo) return null;
    const s: StockPorUnidad = {};
    if (!row) return s;
    for (const [z, q] of Object.entries(row.byZona)) {
      const u = unidadDeStock(z);
      if (!u || !(q > 0)) continue;
      s[u] = (s[u] ?? 0) + q;
    }
    return s;
  }, [articulo, row]);
  const udm = row?.udmPrimaria ?? "";
  const zonasConStock = stockPorUnidad ? Object.values(stockPorUnidad).filter((q) => (q ?? 0) > 0).length : 0;

  // ── Alto: ocupa la ventana hasta abajo ──────────────────────────────────────
  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      setHeight(Math.max(480, Math.round(window.innerHeight - el.getBoundingClientRect().top - 28)));
    };
    measure();
    const t = setTimeout(measure, 250);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(t); window.removeEventListener("resize", measure); };
  }, []);

  useEffect(() => { setRecents(readRecents()); }, []);

  // ── Carga de la geometría ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const skT = setTimeout(() => { if (!cancelled) setShowSkel(true); }, 400);
    cargarGeo()
      .then((geo) => {
        if (cancelled) return;
        const m = armarModelo(geo);
        modeloRef.current = m;
        setModelo(m);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
        introRunningRef.current = false;
        setIntroOn(false);
      })
      .finally(() => {
        clearTimeout(skT);
        if (!cancelled) setShowSkel(false);
      });
    return () => { cancelled = true; clearTimeout(skT); };
  }, [loadNonce]);

  const locIdx = useMemo<LocIdx[]>(() => (modelo ? modelo.localidades.map((l) => {
    const n = norm(l.nombre);
    const words: { w: string; p: number }[] = [];
    let p = 0;
    for (const w of n.split(" ")) { words.push({ w, p }); p += w.length + 1; }
    return { l, n, words };
  }) : []), [modelo]);

  // ── Estilo de zonas (hover / selección / stock) ─────────────────────────────
  const styleZones = useCallback(() => {
    const m = modeloRef.current;
    if (!m || !mapRef.current) return;
    const sel = selZoneRef.current;
    const { zona: hz, sub: hs } = hoverRef.current;
    const stock = stockRef.current;
    const max = stock ? Math.max(0, ...Object.values(stock).map((q) => q ?? 0)) : 0;
    for (const u of m.unidades) {
      const lyr = zoneLayersRef.current[u.code];
      if (!lyr) continue;
      const on = sel === u.zona;
      const hov = hz === u.zona;
      let fo: number;
      let labelOp = 1;
      if (stock) {
        // Modo stock: el relleno sigue la cantidad (raíz, para que las zonas chicas no desaparezcan).
        const q = stock[u.code] ?? 0;
        fo = q > 0 && max > 0 ? 0.14 + 0.32 * Math.sqrt(q / max) : 0.03;
        if (q <= 0) labelOp = 0.35;
        if (hov) fo = Math.min(0.6, fo + 0.1);
        if (hov && u.subzona && hs === u.code) fo = Math.min(0.66, fo + 0.06);
      } else {
        fo = 0.16;
        if (sel) fo = on ? 0.3 : 0.05;
        if (hov) fo = Math.max(fo, 0.3);
        if (hov && u.subzona && hs === u.code) fo = 0.44;
        if (sel && !on) labelOp = 0.35;
      }
      lyr.setStyle({ fillOpacity: fo });
      const el = unitLabelsRef.current[u.code]?.getElement()?.querySelector<HTMLElement>(".mz-zcode");
      if (el) el.style.opacity = String(labelOp);
    }
    for (const z of m.zonas) {
      const on = sel === z.code;
      const hov = hz === z.code;
      let op = 0.75;
      let w = 1;
      if (stock) {
        const units: UnidadCode[] = z.subzonas ? z.subzonas.map((s) => s.code) : [z.code as UnidadCode];
        const has = units.some((c) => (stock[c] ?? 0) > 0);
        op = has ? 1 : 0.35;
        w = on ? 1.75 : has ? 1.25 : 1;
      } else if (sel) {
        op = on ? 1 : 0.35;
        w = on ? 1.5 : 1;
      }
      if (hov) { op = 1; w = 1.5; }
      zoneBordersRef.current[z.code]?.setStyle({ opacity: op * 0.75, weight: w });
      zoneDividersRef.current[z.code]?.setStyle({ opacity: op * 0.7 });
      const big = bigLabelsRef.current[z.code]?.getElement()?.querySelector<HTMLElement>(".mz-zcode-b");
      if (big) big.style.opacity = String(!stock && sel && !on ? 0.35 : 1);
    }
  }, []);

  const unitIcon = useCallback((L: LeafletNS, code: UnidadCode, qty: number | undefined) => L.divIcon({
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    // Sin stock no se muestra cantidad: la zona ya queda atenuada.
    html: `<div class="mz-zlabel"><div class="mz-zcode" style="background:${zonaColorVar(code)}">${code}</div>${
      qty !== undefined && qty > 0 ? `<div class="mz-qty mz-mono">${fmtNum(qty)}</div>` : ""
    }</div>`,
  }), []);

  // ── Construcción del mapa ───────────────────────────────────────────────────
  useEffect(() => {
    if (!modelo) return;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    const zoneLayers = zoneLayersRef.current;
    (async () => {
      const L = (await import("leaflet")).default;
      const mapEl = mapElRef.current;
      const panel = panelRef.current;
      if (cancelled || !mapEl || !panel) return;
      LRef.current = L;
      const css = getComputedStyle(panel);
      const v = (name: string) => css.getPropertyValue(name).trim();
      const colorOf = (code: string) => v(`--ido-zona-${code.toLowerCase()}`);

      const map = L.map(mapEl, { zoomControl: false, attributionControl: true, zoomSnap: 0, zoomDelta: 1, minZoom: 6, maxZoom: 13 });
      mapRef.current = map;
      map.attributionControl.setPrefix(false).addAttribution("Límites departamentales: IGN");
      const provBounds = L.latLngBounds(modelo.contorno.flat());
      provBoundsRef.current = provBounds;
      map.setView(provBounds.getCenter(), 7, { animate: false });

      const container = map.getContainer();
      const markMoved = () => { userMovedRef.current = true; };
      container.addEventListener("pointerdown", markMoved);
      container.addEventListener("wheel", markMoved, { passive: true });
      let boundsSet = false;
      const fitIfSized = () => {
        if (!container.clientWidth || !container.clientHeight) return;
        map.invalidateSize({ animate: false });
        if (!userMovedRef.current && !introRunningRef.current) map.fitBounds(provBounds, { animate: false, ...fitOpts(panelRef.current) });
        if (!boundsSet) { map.setMaxBounds(provBounds.pad(0.6)); boundsSet = true; }
      };
      ro = new ResizeObserver(fitIfSized);
      ro.observe(container);
      requestAnimationFrame(fitIfSized);

      // Zonas (A al final para que quede arriba, como en el diseño).
      const order = modelo.unidades.filter((u) => u.code !== "A").concat(modelo.unidades.filter((u) => u.code === "A"));
      for (const u of order) {
        const lyr = L.featureGroup(u.departamentos.map((d) =>
          L.polygon(d.ring, { stroke: false, fillColor: colorOf(u.code), fillOpacity: 0.16 }),
        )).addTo(map);
        lyr.bindTooltip(zoneTipHtml(u, null, ""), { sticky: true, className: "mz-ztip", direction: "top", offset: [0, -8] });
        lyr.on("mouseover", () => { hoverRef.current = { zona: u.zona, sub: u.subzona ? u.code : null }; styleZones(); });
        lyr.on("mouseout", () => { hoverRef.current = { zona: null, sub: null }; styleZones(); });
        lyr.on("click", () => handlersRef.current.onZoneClick(u.zona));
        zoneLayersRef.current[u.code] = lyr;
        unitLabelsRef.current[u.code] = L.marker(u.label, { interactive: false, icon: unitIcon(L, u.code, undefined) }).addTo(map);
      }
      for (const z of modelo.zonas) {
        const c = colorOf(z.code);
        zoneBordersRef.current[z.code] = L.polyline(z.bordes, { color: c, weight: 1, opacity: 0.75, interactive: false, lineJoin: "round" }).addTo(map);
        if (z.divisoria) {
          zoneDividersRef.current[z.code] = L.polyline(z.divisoria, {
            color: c, weight: 0.75, opacity: 0.7, dashArray: "3 4", interactive: false, lineJoin: "round",
          }).addTo(map);
          bigLabelsRef.current[z.code] = L.marker(z.label, {
            interactive: false,
            icon: L.divIcon({
              className: "", iconSize: [34, 34], iconAnchor: [17, 17],
              html: `<div class="mz-zcode-b" style="color:${zonaColorVar(z.code)};border-color:${zonaColorVar(z.code)}">${z.code}</div>`,
            }),
          }).addTo(map);
        }
      }

      // Límites internos de departamento (muy tenues), laguna y contorno provincial.
      const depto = v("--ido-map-depto");
      for (const u of modelo.unidades) {
        for (const d of u.departamentos) L.polygon(d.ring, { color: depto, weight: 0.6, fill: false, interactive: false }).addTo(map);
      }
      L.polygon(modelo.marChiquita, {
        color: v("--ido-map-laguna-line"), weight: 1, fillColor: v("--ido-map-laguna-fill"), fillOpacity: 0.9, interactive: false,
      }).bindTooltip("Laguna Mar Chiquita", { className: "mz-ptip" }).addTo(map);
      L.polyline(modelo.contorno, { color: v("--ido-map-contorno"), weight: 1.25, interactive: false, lineJoin: "round" }).addTo(map);
      for (const mk of [...Object.values(unitLabelsRef.current), ...Object.values(bigLabelsRef.current)]) mk?.setZIndexOffset(500);

      // Delegaciones (anillo rojo) y distritos (anillo azul).
      const rojo = v("--ido-error");
      const azul = v("--ido-cat-1");
      const base = v("--ido-base");
      for (const l of modelo.localidades) {
        if (!l.rol) continue;
        const mk = L.circleMarker([l.lat, l.lon], {
          radius: l.rol === "delegacion" ? 6 : 4.5, color: l.rol === "delegacion" ? rojo : azul, weight: 2,
          fill: true, fillColor: base, fillOpacity: 0.6,
        });
        mk.bindTooltip(esc(l.nombre), { className: "mz-ptip", direction: "right", offset: [8, 0] });
        mk.on("click", () => handlersRef.current.onLocClick(l));
        mk.addTo(map);
      }

      styleZones();
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      LRef.current = null;
      pinRef.current = null;
      routeRef.current = null;
      ghostRef.current = null;
      for (const k of Object.keys(zoneLayers)) delete zoneLayers[k as UnidadCode];
      zoneBordersRef.current = {};
      zoneDividersRef.current = {};
      unitLabelsRef.current = {};
      bigLabelsRef.current = {};
      setMapReady(false);
    };
  }, [modelo, styleZones, unitIcon]);

  // ── Capa de stock: etiquetas, tooltips y relleno ────────────────────────────
  useEffect(() => {
    stockRef.current = stockPorUnidad;
    const L = LRef.current;
    const m = modeloRef.current;
    if (!mapReady || !L || !m) return;
    for (const u of m.unidades) {
      const qty = stockPorUnidad ? (stockPorUnidad[u.code] ?? 0) : null;
      unitLabelsRef.current[u.code]?.setIcon(unitIcon(L, u.code, qty === null ? undefined : qty));
      zoneLayersRef.current[u.code]?.setTooltipContent(zoneTipHtml(u, qty, udm));
    }
    styleZones();
  }, [stockPorUnidad, udm, mapReady, styleZones, unitIcon]);

  // ── Stock más cercano a la localidad elegida ────────────────────────────────
  const cercanos = useMemo(() => {
    if (!selected || !stockPorUnidad || !modelo) return null;
    return (Object.entries(stockPorUnidad) as [UnidadCode, number][])
      .filter(([, q]) => q > 0)
      .map(([code, q]) => {
        const u = modelo.unidades.find((x) => x.code === code)!;
        const sede = modelo.sedes[code];
        return { u, q, sede, d: sede ? km(selected, sede) : null };
      })
      .sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
  }, [selected, stockPorUnidad, modelo]);
  const masCercano = cercanos?.[0]?.sede ? cercanos[0] : null;

  // ── Selección de localidad: pin, vuelo y línea al stock más cercano ─────────
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!mapReady || !L || !map) return;
    if (ghostRef.current) { map.removeLayer(ghostRef.current); ghostRef.current = null; }
    if (pinRef.current) { map.removeLayer(pinRef.current); pinRef.current = null; }
    if (routeRef.current) { map.removeLayer(routeRef.current); routeRef.current = null; }
    if (!selected) { selZoneRef.current = null; styleZones(); return; }
    pinRef.current = L.marker([selected.lat, selected.lon], {
      interactive: false, zIndexOffset: 1000,
      icon: L.divIcon({
        className: "", iconSize: [16, 16], iconAnchor: [8, 8],
        html: `<div class="mz-pulse"><span class="mz-ring"></span><span class="mz-ring"></span><span class="mz-ring"></span><span class="mz-core"></span><span class="mz-pulse-label">${esc(selected.nombre)}</span></div>`,
      }),
    }).addTo(map);
    const sede = masCercano?.sede;
    if (sede && (sede.lat !== selected.lat || sede.lon !== selected.lon)) {
      const css = getComputedStyle(panelRef.current!);
      routeRef.current = L.polyline([[selected.lat, selected.lon], [sede.lat, sede.lon]], {
        color: css.getPropertyValue("--ido-text").trim(), weight: 1.25, opacity: 0.7, dashArray: "4 5", interactive: false,
      }).addTo(map);
      map.flyToBounds(L.latLngBounds([[selected.lat, selected.lon], [sede.lat, sede.lon]]).pad(0.35), {
        ...fitOpts(panelRef.current),
        paddingBottomRight: panelRef.current && panelRef.current.clientWidth >= 900 ? [360, 78] : [16, 24],
        maxZoom: 10, duration: 0.8, easeLinearity: 0.2,
      });
    } else {
      map.flyTo([selected.lat, selected.lon], 10, { duration: 0.8, easeLinearity: 0.2 });
    }
    selZoneRef.current = selected.zona;
    styleZones();
  }, [selected, masCercano, mapReady, styleZones]);

  // ── Acciones ────────────────────────────────────────────────────────────────
  const zoneBounds = useCallback((code: string) => {
    const L = LRef.current;
    const m = modeloRef.current;
    if (!L || !m) return null;
    const b = L.latLngBounds([]);
    for (const u of m.unidades) {
      if (u.code === code || u.zona === code) {
        const lyr = zoneLayersRef.current[u.code];
        if (lyr) b.extend(lyr.getBounds());
      }
    }
    return b.isValid() ? b : null;
  }, []);

  const flyToZone = useCallback((code: string) => {
    const b = zoneBounds(code);
    if (b) mapRef.current?.flyToBounds(b, { padding: [60, 60], duration: 0.8, easeLinearity: 0.2 });
  }, [zoneBounds]);

  const selectLoc = useCallback((l: Localidad) => {
    setSelected(l);
    setQuery(l.nombre);
    setRecents(pushRecent(l.nombre));
  }, []);

  const clearSelection = useCallback(() => { setSelected(null); setQuery(""); }, []);

  useEffect(() => {
    handlersRef.current.onLocClick = selectLoc;
    handlersRef.current.onZoneClick = (z) => { setZoneFilter(z); flyToZone(z); };
  }, [selectLoc, flyToZone]);

  const showGhost = useCallback((l: Localidad | null) => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (ghostRef.current) { map.removeLayer(ghostRef.current); ghostRef.current = null; }
    if (!l) return;
    ghostRef.current = L.marker([l.lat, l.lon], {
      interactive: false,
      icon: L.divIcon({ className: "", iconSize: [12, 12], iconAnchor: [6, 6], html: '<div class="mz-ghost"></div>' }),
    }).addTo(map);
  }, []);

  const fullView = useCallback(() => {
    const map = mapRef.current;
    const b = provBoundsRef.current;
    if (!map || !b) return;
    map.invalidateSize({ animate: false });
    map.flyToBounds(b, { duration: 0.8, easeLinearity: 0.2, ...fitOpts(panelRef.current) });
  }, []);

  // ── Buscador de localidades ─────────────────────────────────────────────────
  const ready = status === "ready" && mapReady;
  const locList = useMemo<{ head: string | null; items: LocHit[]; empty: boolean }>(() => {
    if (!modelo) return { head: null, items: [], empty: false };
    if (!query.trim()) {
      const items = recents
        .map((n) => modelo.localidades.find((l) => l.nombre === n))
        .filter((l): l is Localidad => !!l && inFiltro(l, zoneFilter))
        .map((l) => ({ l, h: [0, 0] as [number, number] }));
      return { head: items.length ? "Búsquedas recientes" : null, items, empty: false };
    }
    const items = buscarLocalidades(query, locIdx, zoneFilter);
    return { head: null, items, empty: items.length === 0 };
  }, [modelo, query, recents, zoneFilter, locIdx]);
  const ddOpen = focused && ready && (locList.items.length > 0 || locList.empty);

  const chooseLoc = (i: number) => {
    const it = locList.items[i];
    if (!it) return;
    selectLoc(it.l);
    setAct(-1);
    qRef.current?.blur();
  };

  const onQueryKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = locList.items.length;
    if (e.key === "ArrowDown") { e.preventDefault(); if (n) { const i = (act + 1) % n; setAct(i); showGhost(locList.items[i].l); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (n) { const i = (act - 1 + n) % n; setAct(i); showGhost(locList.items[i].l); } }
    else if (e.key === "Enter") { e.preventDefault(); chooseLoc(act < 0 ? 0 : act); }
    else if (e.key === "Escape") { qRef.current?.blur(); }
  };

  // Atajo «/» para enfocar el buscador (si no se está escribiendo en otro campo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || !ready) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
      e.preventDefault();
      qRef.current?.focus();
      qRef.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ready]);

  // ── Buscador de matrículas ──────────────────────────────────────────────────
  const matList = useMemo<{ head: string | null; items: MapaStockRow[]; empty: boolean }>(() => {
    if (!matQuery.trim()) {
      const items = pinned.map((a) => rows.find((r) => r.articulo === a)).filter((r): r is MapaStockRow => !!r).slice(0, 8);
      return { head: items.length ? "Fijadas" : null, items, empty: false };
    }
    const items = buscarMatriculas(matQuery, rows);
    return { head: null, items, empty: items.length === 0 };
  }, [matQuery, pinned, rows]);
  const matDdOpen = matFocused && (matList.items.length > 0 || matList.empty);

  const chooseMat = (i: number) => {
    const r = matList.items[i];
    if (!r) return;
    onArticuloChange(r.articulo);
    setMatQuery("");
    setMatAct(-1);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const onMatKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = matList.items.length;
    if (e.key === "ArrowDown") { e.preventDefault(); if (n) setMatAct((matAct + 1) % n); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (n) setMatAct((matAct - 1 + n) % n); }
    else if (e.key === "Enter") { e.preventDefault(); chooseMat(matAct < 0 ? 0 : matAct); }
    else if (e.key === "Escape") { (e.target as HTMLInputElement).blur(); }
  };

  // ── Intro: globo → provincia (una vez por apertura) ─────────────────────────
  useEffect(() => {
    if (!mapReady || !introRunningRef.current) return;
    let cancelled = false;
    let raf = 0;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    const map = mapRef.current;
    const cv = canvasRef.current;
    const panel = panelRef.current;
    const m = modeloRef.current;
    const provBounds = provBoundsRef.current;
    if (!map || !cv || !panel || !m || !provBounds) return;

    const endIntro = () => {
      introRunningRef.current = false;
      map.fitBounds(provBounds, { animate: false, ...fitOpts(panel) });
      setIntroOn(false);
      fadeTimer = setTimeout(() => setFading(false), 320);
      cv.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
    };

    (async () => {
      let d3: typeof import("d3-geo") | null = null;
      let land: GeoPermissibleObjects | null = null;
      try {
        const [geoMod, topoMod, landMod] = await Promise.race([
          Promise.all([import("d3-geo"), import("topojson-client"), import("world-atlas/land-110m.json")]),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 2500)),
        ]);
        d3 = geoMod;
        const topo = (landMod.default ?? landMod) as unknown as Parameters<typeof topoMod.feature>[0];
        land = topoMod.feature(topo, "land") as GeoPermissibleObjects;
      } catch {
        land = null;
      }
      if (cancelled) return;
      if (!d3 || !land) { endIntro(); return; }

      const css = getComputedStyle(panel);
      const v = (name: string) => css.getPropertyValue(name).trim();
      const C = {
        sphere: v("--ido-header"), sphereLine: v("--ido-border-strong"), land: v("--ido-elevated"),
        landLine: v("--ido-line-strong"), prov: v("--ido-map-contorno"), dot: v("--ido-accent"),
      };
      const provGeo: GeoPermissibleObjects = {
        type: "MultiLineString",
        coordinates: m.contorno.map((line) => line.map(([la, lo]) => [lo, la])),
      };
      const geo = d3;
      const landObj = land;
      const draw = (scale: number, center: [number, number], pt: { x: number; y: number }, alpha: number) => {
        const w = cv.clientWidth;
        const h = cv.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.globalAlpha = alpha;
        const proj = geo.geoOrthographic().rotate([-center[0], -center[1]]).scale(scale).translate([pt.x, pt.y]).clipAngle(90);
        const path = geo.geoPath(proj, ctx);
        ctx.beginPath(); path({ type: "Sphere" }); ctx.fillStyle = C.sphere; ctx.fill();
        ctx.strokeStyle = C.sphereLine; ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); path(landObj); ctx.fillStyle = C.land; ctx.fill();
        ctx.strokeStyle = C.landLine; ctx.lineWidth = 0.75; ctx.stroke();
        ctx.beginPath(); path(provGeo); ctx.strokeStyle = C.prov; ctx.lineWidth = 1.25; ctx.stroke();
        const p = proj(CBA);
        if (p) {
          ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2); ctx.fillStyle = C.dot;
          ctx.shadowColor = C.dot; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0;
        }
      };

      // Vista final: escala ortográfica equivalente a Mercator en el centro (ambas conformes).
      map.invalidateSize({ animate: false });
      map.fitBounds(provBounds, { animate: false, ...fitOpts(panel) });
      const c = map.getCenter();
      const z = map.getZoom();
      const fpt = map.latLngToContainerPoint(c);
      const s1 = (256 * Math.pow(2, z) * 180) / (360 * Math.cos((c.lat * Math.PI) / 180) * Math.PI);
      const mid = { x: cv.clientWidth / 2, y: cv.clientHeight / 2 };
      const s0 = Math.min(cv.clientWidth, cv.clientHeight) * 0.34;
      const ctr: [number, number] = [c.lng, c.lat];
      const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const T = 1000;
      const FADE = 300;
      let t0: number | null = null;
      let fadeStarted = false;
      const frame = (now: number) => {
        if (cancelled) return;
        if (t0 === null) t0 = now;
        const t = Math.min(1, (now - t0) / T);
        const e = ease(t);
        const s = Math.exp(Math.log(s0) + (Math.log(s1) - Math.log(s0)) * e);
        const pt = { x: mid.x + (fpt.x - mid.x) * e, y: mid.y + (fpt.y - mid.y) * e };
        const fadeT = Math.max(0, (now - t0 - (T - FADE)) / FADE);
        if (fadeT > 0 && !fadeStarted) { fadeStarted = true; setFading(true); }
        draw(s, ctr, pt, 1 - ease(Math.min(1, fadeT)));
        if (t < 1) raf = requestAnimationFrame(frame);
        else endIntro();
      };
      raf = requestAnimationFrame(frame);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (fadeTimer) clearTimeout(fadeTimer);
    };
  }, [mapReady]);

  // ── Datos derivados para la tarjeta ─────────────────────────────────────────
  const unidadSel = selected && modelo ? modelo.unidades.find((u) => u.code === selected.unidad) ?? null : null;
  const distritoCercano = useMemo(() => {
    if (!selected || !modelo) return null;
    const cands = modelo.localidades
      .filter((d) => d.rol === "distrito" && d.id !== selected.id)
      .map((d) => ({ d, k: km(selected, d) }))
      .sort((a, b) => a.k - b.k);
    return cands[0] ?? null;
  }, [selected, modelo]);
  const coord = selected ? `${selected.lat.toFixed(4)}, ${selected.lon.toFixed(4)}` : "";

  const copyCoord = () => {
    try { void navigator.clipboard?.writeText(coord); } catch { /* sin portapapeles */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const legendQty = (codes: UnidadCode[]) =>
    stockPorUnidad ? codes.reduce((s, c) => s + (stockPorUnidad[c] ?? 0), 0) : null;

  const hoverLegend = (code: string | null) => {
    if (!code) { hoverRef.current = { zona: null, sub: null }; styleZones(); return; }
    const sub = code === "BN" || code === "BS" ? (code as UnidadCode) : null;
    hoverRef.current = { zona: (sub ? "B" : code) as ZonaCode, sub };
    styleZones();
  };
  const clickLegend = (code: string) => {
    if (zoneFilter === code) { setZoneFilter(null); return; }
    setZoneFilter(code);
    flyToZone(code);
  };

  const zfColor = zoneFilter ? zonaColorVar(zoneFilter) : "";
  const zfDelegacion = zoneFilter && modelo
    ? (modelo.zonas.find((z) => z.code === zoneFilter)?.delegacion ?? modelo.unidades.find((u) => u.code === zoneFilter)?.delegacion ?? "")
    : "";

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div ref={wrapRef} style={{ height }}>
      <div
        ref={panelRef}
        className={`mz-panel${introOn ? " is-intro" : ""}${fading ? " is-fading" : ""}${selected ? " has-card" : ""}`}
        style={{ height: "100%" }}
      >
        <canvas ref={canvasRef} className="mz-globe" />
        <div ref={mapElRef} className="mz-map" />

        {/* Buscador de localidades */}
        <div className="mz-ui mz-search">
          <div className="mz-box">
            <Search className="mz-lupa" strokeWidth={1.5} />
            <input
              ref={qRef}
              className="mz-input"
              value={query}
              disabled={!ready}
              placeholder={zoneFilter ? `Buscar en ${fLabel(zoneFilter).toLowerCase()} · ${zfDelegacion}` : "Buscar pueblo o ciudad"}
              autoComplete="off"
              spellCheck={false}
              aria-label="Buscar pueblo o ciudad"
              onChange={(e) => { setQuery(e.target.value); setAct(e.target.value.trim() ? 0 : -1); showGhost(null); }}
              onFocus={() => { setFocused(true); setAct(-1); }}
              onBlur={() => { setFocused(false); setAct(-1); showGhost(null); }}
              onKeyDown={onQueryKey}
            />
            {zoneFilter ? (
              <button
                type="button"
                className="mz-zfilter"
                title="Quitar filtro de zona"
                style={{ background: `color-mix(in srgb, ${zfColor} 15%, transparent)`, color: zfColor }}
                onMouseDown={(e) => { e.preventDefault(); setZoneFilter(null); }}
              >
                {fLabel(zoneFilter)}<X className="w-3 h-3" strokeWidth={2} />
              </button>
            ) : !focused && <span className="mz-kbd mz-mono">/</span>}
          </div>
          {ddOpen && (
            <div className="mz-dd" role="listbox">
              {locList.head && <div className="mz-dd-head">{locList.head}</div>}
              {locList.empty ? (
                <div className="mz-dd-empty">
                  <MapPin className="mz-ic w-4 h-4" strokeWidth={1.5} />
                  No encontramos esa localidad{zoneFilter ? ` en ${fLabel(zoneFilter).replace("Zona", "la zona")}` : ""}
                </div>
              ) : locList.items.map((it, i) => (
                <div
                  key={it.l.id}
                  role="option"
                  aria-selected={i === act}
                  className={`mz-dd-item${i === act ? " is-act" : ""}`}
                  onMouseEnter={() => { setAct(i); showGhost(it.l); }}
                  onMouseLeave={() => showGhost(null)}
                  onMouseDown={(e) => { e.preventDefault(); chooseLoc(i); }}
                >
                  {locList.head ? <Clock className="mz-ic" strokeWidth={1.5} /> : <MapPin className="mz-ic" strokeWidth={1.5} />}
                  <div className="mz-dd-main">
                    <span className="mz-dd-name"><Highlight text={it.l.nombre} h={it.h} /></span>
                    <span className="mz-dd-dep">{it.l.departamento}</span>
                  </div>
                  <LocBadge l={it.l} />
                </div>
              ))}
              {locList.items.length > 0 && (
                <div className="mz-dd-foot">
                  <span><span className="mz-mono">↑ ↓</span> navegar</span>
                  <span><span className="mz-mono">↵</span> elegir</span>
                  <span><span className="mz-mono">esc</span> cerrar</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Matrícula (arriba a la izquierda) */}
        <div className="mz-ui mz-tools">
          {articulo ? (
            <div className="mz-mat">
              <div className="mz-mat-top">
                <span className="mz-mat-code mz-mono">{articulo}</span>
                <button type="button" className="mz-iconbtn" title="Quitar matrícula" onClick={() => onArticuloChange(null)}>
                  <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
              </div>
              {row?.descArticulo && <span className="mz-mat-desc" title={row.descArticulo}>{row.descArticulo}</span>}
              <span className="mz-mat-sum">
                {zonasConStock > 0 ? (
                  <><b className="mz-mono">{fmtNum(row?.total ?? 0)}</b> {udm} en {zonasConStock} zona{zonasConStock !== 1 ? "s" : ""}</>
                ) : "Sin stock en ninguna zona"}
              </span>
            </div>
          ) : (
            <div className="mz-box">
              <Search className="mz-lupa" strokeWidth={1.5} />
              <input
                className="mz-input"
                value={matQuery}
                placeholder="Ver stock de una matrícula"
                autoComplete="off"
                spellCheck={false}
                aria-label="Buscar matrícula"
                onChange={(e) => { setMatQuery(e.target.value); setMatAct(e.target.value.trim() ? 0 : -1); }}
                onFocus={() => { setMatFocused(true); setMatAct(-1); }}
                onBlur={() => { setMatFocused(false); setMatAct(-1); }}
                onKeyDown={onMatKey}
              />
              {matDdOpen && (
                <div className="mz-dd" role="listbox">
                  {matList.head && <div className="mz-dd-head">{matList.head}</div>}
                  {matList.empty ? (
                    <div className="mz-dd-empty">No encontramos esa matrícula</div>
                  ) : matList.items.map((r, i) => (
                    <div
                      key={r.articulo}
                      role="option"
                      aria-selected={i === matAct}
                      className={`mz-dd-item${i === matAct ? " is-act" : ""}`}
                      onMouseEnter={() => setMatAct(i)}
                      onMouseDown={(e) => { e.preventDefault(); chooseMat(i); }}
                    >
                      <div className="mz-dd-main">
                        <span className="mz-dd-name mz-mono">{r.articulo}</span>
                        <span className="mz-dd-dep">{r.descArticulo || "—"}</span>
                      </div>
                      <span className="mz-mono" style={{ fontSize: 12, color: r.total > 0 ? "var(--ido-text)" : "var(--ido-text-2)" }}>
                        {fmtNum(r.total)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Zoom */}
        <div className="mz-ui mz-zoom">
          <button type="button" className="mz-btn2" onClick={fullView}>
            <Maximize className="w-3.5 h-3.5" strokeWidth={1.75} />Vista completa
          </button>
          <div className="mz-zgroup">
            <button type="button" title="Acercar" onClick={() => mapRef.current?.zoomIn()}><Plus className="w-3.5 h-3.5" strokeWidth={1.75} /></button>
            <button type="button" title="Alejar" onClick={() => mapRef.current?.zoomOut()}><Minus className="w-3.5 h-3.5" strokeWidth={1.75} /></button>
          </div>
        </div>

        {/* Leyenda */}
        {modelo && (
          <div className={`mz-ui mz-legend${legendClosed ? " is-closed" : ""}`}>
            <button type="button" className="mz-lg-head" onClick={() => setLegendClosed((v) => !v)}>
              <span>{stockPorUnidad ? "Stock por zona" : "Zonas · delegaciones"}</span>
              <ChevronUp strokeWidth={1.75} />
            </button>
            <div className="mz-lg-body">
              <div className="mz-lg-inner">
                <div className="mz-lg-list">
                  {modelo.zonas.map((z) => {
                    const units: UnidadCode[] = z.subzonas ? z.subzonas.map((s) => s.code) : [z.code as UnidadCode];
                    const q = legendQty(units);
                    return (
                      <div key={z.code}>
                        <div
                          className={`mz-lg-row${zoneFilter === z.code ? " is-on" : ""}`}
                          onClick={() => clickLegend(z.code)}
                          onMouseEnter={() => hoverLegend(z.code)}
                          onMouseLeave={() => hoverLegend(null)}
                        >
                          <ZoneBadge code={z.code} />
                          <span className="mz-del">{z.subzonas ? z.subzonas.map((s) => s.delegacion).join(" · ") : z.delegacion}</span>
                          {q !== null && <span className={`mz-cnt mz-mono${q > 0 ? " has-stock" : ""}`}>{q > 0 ? fmtNum(q) : "—"}</span>}
                          {z.subzonas && (
                            <button
                              type="button"
                              className={`mz-chev${lgOpenB ? "" : " is-closed"}`}
                              title={lgOpenB ? "Contraer" : "Expandir"}
                              onClick={(e) => { e.stopPropagation(); setLgOpenB((v) => !v); }}
                            >
                              <ChevronDown strokeWidth={2} />
                            </button>
                          )}
                        </div>
                        {z.subzonas && lgOpenB && z.subzonas.map((s) => {
                          const sq = legendQty([s.code]);
                          return (
                            <div
                              key={s.code}
                              className={`mz-lg-row is-sub${zoneFilter === s.code ? " is-on" : ""}`}
                              onClick={() => clickLegend(s.code)}
                              onMouseEnter={() => hoverLegend(s.code)}
                              onMouseLeave={() => hoverLegend(null)}
                            >
                              <ZoneBadge code={s.code} />
                              <span className="mz-del">{s.delegacion}</span>
                              {sq !== null && <span className={`mz-cnt mz-mono${sq > 0 ? " has-stock" : ""}`}>{sq > 0 ? fmtNum(sq) : "—"}</span>}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                <div className="mz-lg-keys">
                  <span><i className="mz-ringk" style={{ borderColor: "var(--ido-error)" }} />Delegación</span>
                  <span><i className="mz-ringk" style={{ borderColor: "var(--ido-cat-1)" }} />Distrito</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tarjeta de detalle */}
        <aside className={`mz-card${selected ? " is-open" : ""}`} aria-live="polite">
          {selected && unidadSel && (
            <>
              <div className="mz-card-head">
                <div className="mz-card-title">
                  <h2>{selected.nombre}</h2>
                  <p>Departamento {selected.departamento}</p>
                </div>
                <button type="button" className="mz-iconbtn" title="Cerrar" onClick={clearSelection}>
                  <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
              </div>
              <div className="mz-card-body">
                <div className="mz-kv"><span className="mz-k">Zona</span><span className="mz-v"><ZoneBadge code={selected.zona} /></span></div>
                {selected.subzona && (
                  <div className="mz-kv"><span className="mz-k">Subzona</span><span className="mz-v"><ZoneBadge code={selected.subzona} /></span></div>
                )}
                <div className="mz-kv"><span className="mz-k">Delegación sede</span><span className="mz-v">{unidadSel.delegacion}</span></div>
                <div className="mz-kv">
                  <span className="mz-k">Distrito más cercano</span>
                  <span className="mz-v">
                    {selected.rol === "distrito" ? "Es distrito" : distritoCercano
                      ? <>{distritoCercano.d.nombre} <small className="mz-mono">{fmtKm(distritoCercano.k)}</small></>
                      : "—"}
                  </span>
                </div>
                <div className="mz-kv">
                  <span className="mz-k">Coordenadas</span>
                  <span className="mz-v">
                    <span className="mz-mono" style={{ fontSize: 12 }}>{coord}</span>
                    <button type="button" className="mz-iconbtn" title="Copiar coordenadas" onClick={copyCoord}>
                      {copied ? <Check className="w-3.5 h-3.5" strokeWidth={2.5} style={{ color: "var(--ido-accent)" }} /> : <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />}
                    </button>
                  </span>
                </div>

                {!articulo ? (
                  <div className="mz-future">
                    <span className="mz-t">Stock más cercano</span>
                    <span className="mz-s">Elegí una matrícula en «Ver stock de una matrícula» para ver en qué zonas hay stock y a qué distancia.</span>
                  </div>
                ) : !cercanos || cercanos.length === 0 ? (
                  <div className="mz-future">
                    <span className="mz-t">Stock más cercano</span>
                    <span className="mz-s">No hay stock de <span className="mz-mono">{articulo}</span> en ninguna zona.</span>
                  </div>
                ) : (
                  <div className="mz-stock">
                    <span className="mz-stock-t">Stock más cercano</span>
                    {cercanos.map((c, i) => (
                      <div key={c.u.code} className={`mz-stock-row${i === 0 ? " is-best" : ""}`}>
                        <ZoneBadge code={c.u.code} />
                        <span className="mz-stock-del">{c.u.delegacion}</span>
                        <span className="mz-stock-qty mz-mono">{fmtNum(c.q)}{udm ? <small style={{ color: "var(--ido-text-2)", fontSize: 11 }}> {udm}</small> : null}</span>
                        <span className="mz-stock-km">
                          {c.d === null ? "Sin ubicación de sede"
                            : c.d < 1 ? (i === 0 ? <><b>En esta localidad</b> · el más cercano</> : "En esta localidad")
                            : i === 0
                              ? <><b className="mz-mono">{fmtKm(c.d)}</b> de {c.sede?.nombre} · el más cercano</>
                              : <><span className="mz-mono">{fmtKm(c.d)}</span> de {c.sede?.nombre}</>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="mz-card-foot">
                <a className="mz-btn2 is-wide" href={`https://www.google.com/maps?q=${selected.lat},${selected.lon}`} target="_blank" rel="noopener noreferrer">
                  Abrir en Google Maps<ExternalLink className="w-3.5 h-3.5" strokeWidth={1.75} />
                </a>
              </div>
            </>
          )}
        </aside>

        {/* Carga */}
        {status === "loading" && showSkel && (
          <div className="mz-ov mz-skel">
            <div className="mz-sk-block mz-shimmer" style={{ inset: 0, borderRadius: 0, opacity: 0.6 }} />
            <div className="mz-sk-block mz-shimmer" style={{ top: 16, left: "50%", transform: "translateX(-50%)", width: "min(520px, 60%)", height: 38 }} />
            <div className="mz-sk-block mz-shimmer" style={{ top: 16, left: 16, width: 220, height: 38 }} />
            <div className="mz-sk-block mz-shimmer" style={{ left: 16, bottom: 16, width: 240, height: 340, borderRadius: 10 }} />
            <div className="mz-sk-block mz-shimmer" style={{ right: 16, bottom: 32, width: 32, height: 64 }} />
            <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", fontSize: 12, color: "var(--ido-text-2)" }}>
              <span className="mz-mono">Cargando mapa</span>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="mz-ov mz-err">
            <div className="mz-err-box">
              <span className="mz-err-ic"><TriangleAlert className="w-4 h-4" strokeWidth={2} /></span>
              <h3>No pudimos cargar el mapa</h3>
              <p>Falló la descarga de los límites de las zonas. Revisá la conexión y probá de nuevo; la tabla de stock sigue disponible.</p>
              <button type="button" className="mz-btn1" onClick={() => setLoadNonce((n) => n + 1)}>
                <RotateCw className="w-3.5 h-3.5" strokeWidth={2} />Reintentar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
