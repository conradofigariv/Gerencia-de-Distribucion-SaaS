"use client";

// Mapa de zonas de Stock por Zona. Portado de `MapaZonas.html` (import de
// Claude Design): Leaflet 100% vectorial, sin tiles, sobre los límites IGN de
// Córdoba. Suma la capa de stock: una matrícula pinta las zonas según su
// cantidad; varias, según cuántas de ellas tiene cada zona. La tarjeta de la
// localidad lista las zonas con stock de más cercana a más lejana (por ruta).

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CircleMarker, FeatureGroup, FitBoundsOptions, LatLngBounds, LayerGroup, Map as LMap, Marker, Polyline } from "leaflet";
import type { GeoPermissibleObjects } from "d3-geo";
import {
  Check, ChevronUp, ChevronDown, Clock, Copy, Crosshair, ExternalLink, Layers, MapPin, Maximize, Minus, Plus, RotateCw, Search,
  TriangleAlert, X,
} from "lucide-react";
import {
  armarModelo, cargarGeo, cargarLocalidadesGeoref, km, unidadDeStock, zonaColorVar,
  type LatLng, type Localidad, type MapaModelo, type Unidad, type UnidadCode, type ZonaCode,
} from "@/lib/mapaZonas";
import { distanciasPorRuta, fmtDuracion, trazadoRuta, type Ruta } from "@/lib/ruteo";

type LeafletNS = typeof import("leaflet");
type PorUnidad = Partial<Record<UnidadCode, number>>;

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
  articulos: string[];
  onArticulosChange: (articulos: string[]) => void;
}

/** Qué pinta el mapa: cantidad (1 matrícula) o cuántas matrículas tiene cada zona (2+). */
interface Metrica { kind: "qty" | "cover"; values: PorUnidad; max: number }

interface Capas { delegaciones: boolean; distritos: boolean; todas: boolean; rutas: boolean }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RECENT_KEY = "mapa.recientes.v1";
const CAPAS_KEY = "mapa.capas.v1";
const CBA: [number, number] = [-64.18, -31.42];
// Zoom a partir del cual los nombres quedan fijos (sin pasar el mouse).
const ZOOM_NOMBRE_DELEGACION = 8;
const ZOOM_NOMBRE_DISTRITO = 9.25;
const ZOOM_NOMBRE_LOCALIDAD = 10;

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

function readCapas(): Capas {
  const def: Capas = { delegaciones: true, distritos: true, todas: false, rutas: true };
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CAPAS_KEY) || "null");
    if (v && typeof v === "object") {
      const o = v as Partial<Capas>;
      return { delegaciones: o.delegaciones !== false, distritos: o.distritos !== false, todas: o.todas === true, rutas: o.rutas !== false };
    }
  } catch { /* sin storage */ }
  return def;
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

function buscarMatriculas(q: string, rows: MapaStockRow[], excluir: Set<string>): MapaStockRow[] {
  const qn = norm(q.trim());
  if (!qn) return [];
  const pref: MapaStockRow[] = [];
  const rest: MapaStockRow[] = [];
  for (const r of rows) {
    if (excluir.has(r.articulo)) continue;
    const a = norm(r.articulo);
    if (a.startsWith(qn)) pref.push(r);
    else if (a.includes(qn) || norm(r.descArticulo).includes(qn)) rest.push(r);
    if (pref.length >= 8) break;
  }
  return pref.concat(rest).slice(0, 8);
}

function stockDeRow(row: MapaStockRow | null): PorUnidad {
  const s: PorUnidad = {};
  if (!row) return s;
  for (const [z, q] of Object.entries(row.byZona)) {
    const u = unidadDeStock(z);
    if (!u || !(q > 0)) continue;
    s[u] = (s[u] ?? 0) + q;
  }
  return s;
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

function zoneTipHtml(u: Unidad, metrica: Metrica | null, udm: string): string {
  const head = u.subzona
    ? `<span style="display:inline-flex;align-items:center;gap:8px"><i style="width:6px;height:6px;border-radius:999px;display:inline-block;background:${zonaColorVar(u.code)}"></i><span><b style="font-weight:600">Zona ${u.zona}</b> · ${u.code} · ${esc(u.delegacion)}</span></span>`
    : `<span style="display:inline-flex;align-items:center;gap:8px">${badgeHtml(u.code)}<span>${esc(u.delegacion)}</span></span>`;
  if (!metrica) return head;
  const v = metrica.values[u.code] ?? 0;
  const txt = v <= 0 ? "Sin stock"
    : metrica.kind === "qty" ? `${fmtNum(v)}${udm ? " " + esc(udm) : ""}`
    : `${v} de ${metrica.max} matrículas`;
  return `${head}<div class="mz-mono" style="margin-top:4px;font-size:12px;color:${v > 0 ? "var(--ido-text)" : "var(--ido-text-2)"}">${txt}</div>`;
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

export default function MapaZonas({ rows, pinned, articulos, onArticulosChange }: MapaZonasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const qRef = useRef<HTMLInputElement>(null);
  const capasRefEl = useRef<HTMLDivElement>(null);

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
  const [capas, setCapas] = useState<Capas>(() => readCapas());
  const [capasOpen, setCapasOpen] = useState(false);
  const [expandida, setExpandida] = useState<UnidadCode | null>(null);

  const [matQuery, setMatQuery] = useState("");
  const [matFocused, setMatFocused] = useState(false);
  const [matAct, setMatAct] = useState(-1);

  const [rutas, setRutas] = useState<{ id: number; r: Partial<Record<UnidadCode, Ruta | null>> } | null>(null);
  const [rutaEstado, setRutaEstado] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [trazado, setTrazado] = useState<{ key: string; coords: LatLng[] } | null>(null);
  // Localidades: arranca con la lista embebida y se completa con Georef.
  const [localidades, setLocalidades] = useState<Localidad[]>([]);
  const [georefFallo, setGeorefFallo] = useState(false);
  const [picking, setPicking] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [lgMax, setLgMax] = useState<number | null>(null);
  const toolsRef = useRef<HTMLDivElement>(null);

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
  const delegLayerRef = useRef<LayerGroup | null>(null);
  const distLayerRef = useRef<LayerGroup | null>(null);
  const todasLayerRef = useRef<LayerGroup | null>(null);
  const rutasLayerRef = useRef<LayerGroup | null>(null);
  const rutasCargadasRef = useRef(false);
  const flechasLayerRef = useRef<LayerGroup | null>(null);
  const lineaRef = useRef<LatLng[] | null>(null);
  const ringsRef = useRef<{ m: CircleMarker; l: Localidad; fijo: boolean }[]>([]);
  const pinRef = useRef<Marker | null>(null);
  const routeRef = useRef<Polyline | null>(null);
  const ghostRef = useRef<Marker | null>(null);
  const hoverRef = useRef<{ zona: ZonaCode | null; sub: UnidadCode | null }>({ zona: null, sub: null });
  const selZoneRef = useRef<ZonaCode | null>(null);
  const metricaRef = useRef<Metrica | null>(null);
  const capasRef = useRef<Capas>(capas);
  const localidadesRef = useRef<Localidad[]>([]);
  const pickingRef = useRef(false);
  const userMovedRef = useRef(false);
  const introRunningRef = useRef(introOn);
  const handlersRef = useRef<{
    onZoneClick: (z: ZonaCode) => void;
    onLocClick: (l: Localidad) => void;
    onMapClick: (lat: number, lon: number) => void;
  }>({ onZoneClick: () => {}, onLocClick: () => {}, onMapClick: () => {} });

  // ── Matrículas elegidas y qué pinta el mapa ─────────────────────────────────
  const rowsByArt = useMemo(() => new Map(rows.map((r) => [r.articulo, r])), [rows]);
  const elegidas = useMemo(
    () => articulos.map((a) => {
      const row = rowsByArt.get(a) ?? null;
      return { a, row, s: stockDeRow(row) };
    }),
    [articulos, rowsByArt],
  );
  const n = elegidas.length;
  const metrica = useMemo<Metrica | null>(() => {
    if (n === 0) return null;
    if (n === 1) {
      const values = elegidas[0].s;
      return { kind: "qty", values, max: Math.max(0, ...Object.values(values).map((q) => q ?? 0)) };
    }
    const values: PorUnidad = {};
    for (const { s } of elegidas) {
      for (const [u, q] of Object.entries(s) as [UnidadCode, number][]) if (q > 0) values[u] = (values[u] ?? 0) + 1;
    }
    return { kind: "cover", values, max: n };
  }, [elegidas, n]);
  const udm = n === 1 ? (elegidas[0].row?.udmPrimaria ?? "") : "";
  const elegidasSet = useMemo(() => new Set(articulos), [articulos]);

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

  useEffect(() => {
    if (!modelo) return;
    setLocalidades(modelo.localidades);
    let cancelled = false;
    cargarLocalidadesGeoref()
      .then((rows) => { if (!cancelled) { setLocalidades(modelo.fusionar(rows)); setGeorefFallo(false); } })
      .catch(() => { if (!cancelled) setGeorefFallo(true); });
    return () => { cancelled = true; };
  }, [modelo]);
  useEffect(() => { localidadesRef.current = localidades; }, [localidades]);

  const locIdx = useMemo<LocIdx[]>(() => (localidades.length ? localidades.map((l) => {
    const nn = norm(l.nombre);
    const words: { w: string; p: number }[] = [];
    let p = 0;
    for (const w of nn.split(" ")) { words.push({ w, p }); p += w.length + 1; }
    return { l, n: nn, words };
  }) : []), [localidades]);

  // ── Estilo de zonas (hover / selección / stock) ─────────────────────────────
  const styleZones = useCallback(() => {
    const m = modeloRef.current;
    if (!m || !mapRef.current) return;
    const sel = selZoneRef.current;
    const { zona: hz, sub: hs } = hoverRef.current;
    const met = metricaRef.current;
    for (const u of m.unidades) {
      const lyr = zoneLayersRef.current[u.code];
      if (!lyr) continue;
      const on = sel === u.zona;
      const hov = hz === u.zona;
      let fo: number;
      let labelOp = 1;
      if (met) {
        // Con matrícula(s) el relleno sigue el dato: cantidad (raíz, para que las
        // zonas chicas no desaparezcan) o proporción de matrículas cubiertas.
        const v = met.values[u.code] ?? 0;
        fo = v > 0 && met.max > 0
          ? (met.kind === "qty" ? 0.14 + 0.32 * Math.sqrt(v / met.max) : 0.1 + 0.36 * (v / met.max))
          : 0.03;
        if (v <= 0) labelOp = 0.35;
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
      if (met) {
        const units: UnidadCode[] = z.subzonas ? z.subzonas.map((s) => s.code) : [z.code as UnidadCode];
        const best = Math.max(...units.map((c) => met.values[c] ?? 0));
        const full = met.kind === "cover" && best === met.max;
        op = best > 0 ? 1 : 0.35;
        w = on || full ? 1.75 : best > 0 ? 1.25 : 1;
      } else if (sel) {
        op = on ? 1 : 0.35;
        w = on ? 1.5 : 1;
      }
      if (hov) { op = 1; w = Math.max(w, 1.5); }
      zoneBordersRef.current[z.code]?.setStyle({ opacity: op * 0.75, weight: w });
      zoneDividersRef.current[z.code]?.setStyle({ opacity: op * 0.7 });
      const big = bigLabelsRef.current[z.code]?.getElement()?.querySelector<HTMLElement>(".mz-zcode-b");
      if (big) big.style.opacity = String(!met && sel && !on ? 0.35 : 1);
    }
  }, []);

  const unitIcon = useCallback((L: LeafletNS, code: UnidadCode, met: Metrica | null) => {
    const v = met?.values[code] ?? 0;
    // Sin stock no se muestra dato: la zona ya queda atenuada.
    const dato = !met || v <= 0 ? ""
      : met.kind === "qty" ? `<div class="mz-qty mz-mono">${fmtNum(v)}</div>`
      : `<div class="mz-qty mz-mono${v === met.max ? " is-full" : ""}">${v}/${met.max}</div>`;
    return L.divIcon({
      className: "",
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      html: `<div class="mz-zlabel"><div class="mz-zcode" style="background:${zonaColorVar(code)}">${code}</div>${dato}</div>`,
    });
  }, []);

  // ── Nombres fijos según zoom (delegaciones / distritos) ─────────────────────
  const actualizarNombres = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const z = map.getZoom();
    for (const r of ringsRef.current) {
      const fijo = z >= (r.l.rol === "delegacion" ? ZOOM_NOMBRE_DELEGACION : ZOOM_NOMBRE_DISTRITO);
      if (r.fijo === fijo) continue;
      r.fijo = fijo;
      r.m.unbindTooltip();
      r.m.bindTooltip(esc(r.l.nombre), {
        permanent: fijo,
        className: fijo ? `mz-ptip mz-plabel${r.l.rol === "delegacion" ? " is-del" : ""}` : "mz-ptip",
        direction: "right",
        offset: [8, 0],
      });
    }
  }, []);

  // ── Capa «todas las localidades» (puntos + agrupados por cercanía) ──────────
  const renderTodas = useCallback(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const m = modeloRef.current;
    const lyr = todasLayerRef.current;
    if (!L || !map || !m || !lyr) return;
    lyr.clearLayers();
    const c = capasRef.current;
    if (!c.todas) return;
    const z = map.getZoom();
    const cell = 56;
    const groups = new Map<string, Localidad[]>();
    for (const l of localidadesRef.current.length ? localidadesRef.current : m.localidades) {
      // Las que ya tienen anillo visible no se repiten como punto.
      if (l.rol === "delegacion" && c.delegaciones) continue;
      if (l.rol === "distrito" && c.distritos) continue;
      const p = map.project([l.lat, l.lon], z);
      const k = Math.floor(p.x / cell) + ":" + Math.floor(p.y / cell);
      const g = groups.get(k);
      if (g) g.push(l); else groups.set(k, [l]);
    }
    const fijo = z >= ZOOM_NOMBRE_LOCALIDAD;
    groups.forEach((g) => {
      if (g.length === 1 || z >= 11) {
        for (const l of g) {
          const mk = L.marker([l.lat, l.lon], {
            icon: L.divIcon({ className: "", iconSize: [6, 6], iconAnchor: [3, 3], html: '<div class="mz-dot"></div>' }),
          });
          mk.bindTooltip(esc(l.nombre), { permanent: fijo, className: fijo ? "mz-ptip mz-plabel is-loc" : "mz-ptip", direction: "right", offset: [6, 0] });
          mk.on("click", () => handlersRef.current.onLocClick(l));
          lyr.addLayer(mk);
        }
      } else {
        const lat = g.reduce((a, l) => a + l.lat, 0) / g.length;
        const lon = g.reduce((a, l) => a + l.lon, 0) / g.length;
        const s = Math.min(36, 20 + g.length * 1.5);
        const mk = L.marker([lat, lon], {
          icon: L.divIcon({ className: "", iconSize: [s, s], iconAnchor: [s / 2, s / 2], html: `<div class="mz-cl mz-mono" style="width:${s}px;height:${s}px">${g.length}</div>` }),
        });
        mk.bindTooltip(esc(g.map((l) => l.nombre).join(" · ")), { className: "mz-ptip", direction: "right", offset: [s / 2, 0] });
        mk.on("click", () => map.flyTo([lat, lon], Math.min(z + 2, 12), { duration: 0.6 }));
        lyr.addLayer(mk);
      }
    });
  }, []);

  // ── Nombres sin superponerse ─────────────────────────────────────────────────
  // Leaflet no evita choques entre tooltips. Se ubican por prioridad: lo fijo
  // (etiquetas de zona, cantidades, pin de la obra) siempre; después nombres de
  // delegaciones, de distritos y del resto de localidades. Un nombre que pisaría
  // algo de mayor prioridad se oculta (reaparece al acercar, cuando hay lugar).
  const resolverEtiquetas = useCallback(() => {
    const map = mapRef.current;
    const panel = panelRef.current;
    if (!map || !panel) return;
    const PAD = 3;
    const ocupados: DOMRect[] = [];
    const choca = (r: DOMRect) => ocupados.some((o) =>
      r.left < o.right + PAD && r.right > o.left - PAD && r.top < o.bottom + PAD && r.bottom > o.top - PAD);
    panel.querySelectorAll<HTMLElement>(".mz-zcode, .mz-zcode-b, .mz-qty, .mz-pulse-label").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width) ocupados.push(r);
    });
    const ubicar = (els: HTMLElement[]) => {
      for (const el of els) {
        el.style.visibility = "";
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        if (choca(r)) el.style.visibility = "hidden";
        else ocupados.push(r);
      }
    };
    const deleg: HTMLElement[] = [];
    const dist: HTMLElement[] = [];
    for (const r of ringsRef.current) {
      if (!r.fijo || !map.hasLayer(r.m)) continue;
      const el = r.m.getTooltip()?.getElement();
      if (el) (r.l.rol === "delegacion" ? deleg : dist).push(el);
    }
    ubicar(deleg);
    ubicar(dist);
    const locs: HTMLElement[] = [];
    todasLayerRef.current?.eachLayer((ly) => {
      const t = (ly as Marker).getTooltip?.();
      const el = t?.options.permanent ? t.getElement() : undefined;
      if (el) locs.push(el);
    });
    ubicar(locs);
  }, []);
  const etiquetasRaf = useRef(0);
  const programarEtiquetas = useCallback(() => {
    cancelAnimationFrame(etiquetasRaf.current);
    etiquetasRaf.current = requestAnimationFrame(() => resolverEtiquetas());
  }, [resolverEtiquetas]);

  // ── Flechas sobre la línea de distancia: van desde el stock HACIA la obra ───
  // Se ubican cada ~90 px de pantalla, por eso se recalculan al cambiar el zoom.
  const dibujarFlechas = useCallback(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const lyr = flechasLayerRef.current;
    if (!L || !map || !lyr) return;
    lyr.clearLayers();
    const linea = lineaRef.current;
    if (!linea || linea.length < 2) return;
    // La línea se guarda obra → sede; las flechas recorren sede → obra.
    const pts = linea.slice().reverse().map((p) => map.latLngToLayerPoint(p));
    const segs: { a: { x: number; y: number }; b: { x: number; y: number }; len: number }[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (len > 0) { segs.push({ a: pts[i - 1], b: pts[i], len }); total += len; }
    }
    if (total < 60) return;
    const paso = Math.max(90, total / 40);
    let d = Math.min(paso / 2, total / 2);
    let si = 0;
    let acum = 0;
    while (d < total - 24) {
      while (si < segs.length - 1 && acum + segs[si].len < d) { acum += segs[si].len; si++; }
      const sg = segs[si];
      const t = Math.min(1, Math.max(0, (d - acum) / sg.len));
      const x = sg.a.x + (sg.b.x - sg.a.x) * t;
      const y = sg.a.y + (sg.b.y - sg.a.y) * t;
      const ang = (Math.atan2(sg.b.y - sg.a.y, sg.b.x - sg.a.x) * 180) / Math.PI;
      L.marker(map.layerPointToLatLng([x, y]), {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: "",
          iconSize: [16, 16],
          iconAnchor: [8, 8],
          html: `<div class="mz-flecha" style="transform:rotate(${ang.toFixed(1)}deg)"><svg viewBox="0 0 14 14" width="16" height="16"><path d="M4 2.5 9.5 7 4 11.5"/></svg></div>`,
        }),
      }).addTo(lyr);
      d += paso;
    }
  }, []);

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
      map.attributionControl.setPrefix(false).addAttribution("Límites: IGN · Rutas: Natural Earth · Recorridos: OSRM / OpenStreetMap");
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
        unitLabelsRef.current[u.code] = L.marker(u.label, { interactive: false, icon: unitIcon(L, u.code, null) }).addTo(map);
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
      // Rutas principales: grupo vacío, se llena bajo demanda (capa «rutas»).
      rutasLayerRef.current = L.layerGroup();
      rutasCargadasRef.current = false;
      L.polyline(modelo.contorno, { color: v("--ido-map-contorno"), weight: 1.25, interactive: false, lineJoin: "round" }).addTo(map);
      for (const mk of [...Object.values(unitLabelsRef.current), ...Object.values(bigLabelsRef.current)]) mk?.setZIndexOffset(500);

      // Capas: todas las localidades (abajo), distritos (anillo azul) y delegaciones (anillo rojo).
      todasLayerRef.current = L.layerGroup().addTo(map);
      const distL = L.layerGroup();
      const delegL = L.layerGroup();
      distLayerRef.current = distL;
      delegLayerRef.current = delegL;
      const rojo = v("--ido-error");
      const azul = v("--ido-cat-1");
      const base = v("--ido-base");
      ringsRef.current = [];
      for (const l of modelo.localidades) {
        if (!l.rol) continue;
        const mk = L.circleMarker([l.lat, l.lon], {
          radius: l.rol === "delegacion" ? 6 : 4.5, color: l.rol === "delegacion" ? rojo : azul, weight: 2,
          fill: true, fillColor: base, fillOpacity: 0.6,
        });
        mk.bindTooltip(esc(l.nombre), { className: "mz-ptip", direction: "right", offset: [8, 0] });
        mk.on("click", () => handlersRef.current.onLocClick(l));
        (l.rol === "delegacion" ? delegL : distL).addLayer(mk);
        ringsRef.current.push({ m: mk, l, fijo: false });
      }
      if (capasRef.current.distritos) distL.addTo(map);
      if (capasRef.current.delegaciones) delegL.addTo(map);
      flechasLayerRef.current = L.layerGroup().addTo(map);
      map.on("zoomend", () => { actualizarNombres(); renderTodas(); dibujarFlechas(); programarEtiquetas(); });
      map.on("click", (e) => handlersRef.current.onMapClick(e.latlng.lat, e.latlng.lng));

      styleZones();
      actualizarNombres();
      renderTodas();
      programarEtiquetas();
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
      delegLayerRef.current = null;
      distLayerRef.current = null;
      todasLayerRef.current = null;
      rutasLayerRef.current = null;
      flechasLayerRef.current = null;
      lineaRef.current = null;
      ringsRef.current = [];
      for (const k of Object.keys(zoneLayers)) delete zoneLayers[k as UnidadCode];
      zoneBordersRef.current = {};
      zoneDividersRef.current = {};
      unitLabelsRef.current = {};
      bigLabelsRef.current = {};
      setMapReady(false);
    };
  }, [modelo, styleZones, unitIcon, actualizarNombres, renderTodas, dibujarFlechas, programarEtiquetas]);

  // ── Capas: mostrar/ocultar y recordar en este dispositivo ───────────────────
  useEffect(() => {
    capasRef.current = capas;
    try { localStorage.setItem(CAPAS_KEY, JSON.stringify(capas)); } catch { /* sin storage */ }
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const toggle = (lyr: LayerGroup | null, on: boolean) => {
      if (!lyr) return;
      if (on && !map.hasLayer(lyr)) lyr.addTo(map);
      if (!on && map.hasLayer(lyr)) map.removeLayer(lyr);
    };
    toggle(delegLayerRef.current, capas.delegaciones);
    toggle(distLayerRef.current, capas.distritos);
    toggle(rutasLayerRef.current, capas.rutas);
    renderTodas();
    programarEtiquetas();
    // Primera vez que se prende la capa de rutas: descargar y dibujar.
    const L = LRef.current;
    const lyr = rutasLayerRef.current;
    if (capas.rutas && L && lyr && !rutasCargadasRef.current) {
      rutasCargadasRef.current = true;
      fetch("/geo/rutas-cordoba.json")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("rutas " + r.status))))
        .then((d: { rutas?: { t: string; c: LatLng[] }[] }) => {
          if (rutasLayerRef.current !== lyr || !panelRef.current) return;
          const color = getComputedStyle(panelRef.current).getPropertyValue("--ido-map-ruta").trim();
          for (const r of d.rutas ?? []) {
            const principal = r.t === "principal";
            L.polyline(r.c, { color, weight: principal ? 1.8 : 1.2, opacity: principal ? 0.8 : 0.55, interactive: false, lineJoin: "round" }).addTo(lyr);
          }
        })
        .catch(() => { rutasCargadasRef.current = false; });
    }
  }, [capas, mapReady, renderTodas, programarEtiquetas]);

  useEffect(() => {
    if (!capasOpen) return;
    const onDown = (e: MouseEvent) => {
      if (capasRefEl.current && !capasRefEl.current.contains(e.target as Node)) setCapasOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [capasOpen]);

  // ── Capa de stock: etiquetas, tooltips y relleno ────────────────────────────
  useEffect(() => {
    metricaRef.current = metrica;
    const L = LRef.current;
    const m = modeloRef.current;
    if (!mapReady || !L || !m) return;
    for (const u of m.unidades) {
      unitLabelsRef.current[u.code]?.setIcon(unitIcon(L, u.code, metrica));
      zoneLayersRef.current[u.code]?.setTooltipContent(zoneTipHtml(u, metrica, udm));
    }
    styleZones();
    programarEtiquetas();
  }, [metrica, udm, mapReady, styleZones, unitIcon, programarEtiquetas]);

  // ── Distancias por ruta desde la localidad elegida a cada sede ──────────────
  useEffect(() => {
    if (!selected || !modelo) { setRutaEstado("idle"); return; }
    let cancelled = false;
    const units = modelo.unidades.filter((u) => modelo.sedes[u.code]);
    setRutaEstado("loading");
    distanciasPorRuta(selected, units.map((u) => modelo.sedes[u.code]!))
      .then((res) => {
        if (cancelled) return;
        const r: Partial<Record<UnidadCode, Ruta | null>> = {};
        units.forEach((u, i) => { r[u.code] = res[i]; });
        setRutas({ id: selected.id, r });
        setRutaEstado("ok");
      })
      .catch(() => { if (!cancelled) setRutaEstado("error"); });
    return () => { cancelled = true; };
  }, [selected, modelo]);

  // ── Zonas con stock para la localidad elegida, de más cercana a más lejana ──
  const cercanos = useMemo(() => {
    if (!selected || !metrica || !modelo) return null;
    const r = rutas && rutas.id === selected.id ? rutas.r : null;
    return modelo.unidades
      .filter((u) => (metrica.values[u.code] ?? 0) > 0)
      .map((u) => {
        const sede = modelo.sedes[u.code];
        const recta = sede ? km(selected, sede) : null;
        const ruta = r ? (r[u.code] ?? null) : undefined;
        const dist = ruta ? ruta.km : recta;
        const cover = metrica.kind === "cover" ? (metrica.values[u.code] ?? 0) : 1;
        const qtys = elegidas.map(({ a, s }) => ({ a, q: s[u.code] ?? 0 }));
        return { u, sede, recta, ruta, dist, cover, qtys };
      })
      .sort((a, b) => b.cover - a.cover || (a.dist ?? Infinity) - (b.dist ?? Infinity));
  }, [selected, metrica, modelo, rutas, elegidas]);
  const mejor = cercanos?.[0] && cercanos[0].sede && (cercanos[0].dist ?? 0) >= 1 ? cercanos[0] : null;
  const mejorKey = selected && mejor ? `${selected.id}:${mejor.u.code}` : null;
  const mejorCode = cercanos?.[0]?.u.code ?? null;

  useEffect(() => { setExpandida(mejorCode); }, [mejorCode, selected?.id, n]);

  // Trazado real del recorrido hasta la sede más conveniente.
  useEffect(() => {
    if (!mejorKey || !selected || !modelo) return;
    const code = mejorKey.split(":")[1] as UnidadCode;
    const sede = modelo.sedes[code];
    if (!sede) return;
    let cancelled = false;
    trazadoRuta(selected, sede)
      .then((coords) => { if (!cancelled && coords) setTrazado({ key: mejorKey, coords }); })
      .catch(() => { /* queda la línea recta */ });
    return () => { cancelled = true; };
  }, [mejorKey, selected, modelo]);

  // ── Selección de localidad: pin y encuadre ──────────────────────────────────
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!mapReady || !L || !map) return;
    if (ghostRef.current) { map.removeLayer(ghostRef.current); ghostRef.current = null; }
    if (pinRef.current) { map.removeLayer(pinRef.current); pinRef.current = null; }
    if (!selected) { selZoneRef.current = null; styleZones(); programarEtiquetas(); return; }
    pinRef.current = L.marker([selected.lat, selected.lon], {
      interactive: false, zIndexOffset: 1000,
      icon: L.divIcon({
        className: "", iconSize: [16, 16], iconAnchor: [8, 8],
        html: `<div class="mz-pulse"><span class="mz-ring"></span><span class="mz-ring"></span><span class="mz-ring"></span><span class="mz-core"></span><span class="mz-pulse-label">${esc(selected.marcado ? "Obra" : selected.nombre)}</span></div>`,
      }),
    }).addTo(map);
    const sede = mejor?.sede;
    if (sede) {
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
    programarEtiquetas();
    // Solo re-encuadra si cambia la localidad o la sede elegida, no cuando llegan las rutas.
  }, [selected, mejorKey, mapReady, styleZones]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Línea a la sede más conveniente (recorrido real o, si no hay, recta) ────
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!mapReady || !L || !map) return;
    if (routeRef.current) { map.removeLayer(routeRef.current); routeRef.current = null; }
    lineaRef.current = null;
    if (!selected || !mejor?.sede) { dibujarFlechas(); return; }
    const color = getComputedStyle(panelRef.current!).getPropertyValue("--ido-text").trim();
    const real = trazado && trazado.key === mejorKey ? trazado.coords : null;
    const puntos: LatLng[] = real ?? [[selected.lat, selected.lon], [mejor.sede.lat, mejor.sede.lon]];
    routeRef.current = real
      ? L.polyline(puntos, { color, weight: 2, opacity: 0.75, interactive: false, lineJoin: "round" }).addTo(map)
      : L.polyline(puntos, { color, weight: 1.25, opacity: 0.7, dashArray: "4 5", interactive: false }).addTo(map);
    lineaRef.current = puntos;
    dibujarFlechas();
  }, [selected, mejor, mejorKey, trazado, mapReady, dibujarFlechas]);

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
    handlersRef.current.onLocClick = (l) => { pickingRef.current = false; setPicking(false); selectLoc(l); };
    // Marcando la obra, el clic sobre una zona lo resuelve onMapClick (no filtra).
    handlersRef.current.onZoneClick = (z) => { if (pickingRef.current) return; setZoneFilter(z); flyToZone(z); };
    handlersRef.current.onMapClick = (lat, lon) => {
      if (!pickingRef.current) return;
      const m = modeloRef.current;
      const donde = m?.ubicar(lat, lon);
      if (!m || !donde) { setAviso("Ese punto está fuera de Córdoba. Marcá dentro de la provincia."); return; }
      const lista = localidadesRef.current.length ? localidadesRef.current : m.localidades;
      let cerca = lista[0];
      let dMin = Infinity;
      for (const l of lista) { const d = km({ lat, lon }, l); if (d < dMin) { dMin = d; cerca = l; } }
      const u = donde.unidad;
      pickingRef.current = false;
      setPicking(false);
      setAviso(null);
      setSelected({
        id: -Date.now(), nombre: "Punto marcado", departamento: donde.departamento, lat, lon,
        zona: u.zona, subzona: u.subzona, unidad: u.code, rol: null,
        marcado: { cerca: cerca?.nombre ?? "", km: dMin },
      });
      setQuery(cerca ? `Punto marcado · cerca de ${cerca.nombre}` : "Punto marcado");
    };
  }, [selectLoc, flyToZone]);

  useEffect(() => {
    pickingRef.current = picking;
    if (!picking) return;
    setAviso(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPicking(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picking]);

  // La leyenda usa el alto que deja libre la columna de tarjetas de la izquierda.
  useEffect(() => {
    const tools = toolsRef.current;
    const panel = panelRef.current;
    if (!tools || !panel) return;
    const medir = () => {
      const libre = panel.clientHeight - (tools.offsetTop + tools.offsetHeight) - 16 - 16 - 38 - 38;
      setLgMax(Math.max(0, Math.floor(libre)));
    };
    medir();
    const ro = new ResizeObserver(medir);
    window.addEventListener("resize", medir);
    ro.observe(tools);
    ro.observe(panel);
    return () => { ro.disconnect(); window.removeEventListener("resize", medir); };
  }, []);
  // Si las tarjetas de la izquierda dejan muy poco lugar, la leyenda arranca plegada.
  const lgPoco = lgMax !== null && lgMax < 96;
  useEffect(() => { if (lgPoco) setLegendClosed(true); }, [lgPoco]);

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
        .map((nm) => localidades.find((l) => l.nombre === nm))
        .filter((l): l is Localidad => !!l && inFiltro(l, zoneFilter))
        .map((l) => ({ l, h: [0, 0] as [number, number] }));
      return { head: items.length ? "Búsquedas recientes" : null, items, empty: false };
    }
    const items = buscarLocalidades(query, locIdx, zoneFilter);
    return { head: null, items, empty: items.length === 0 };
  }, [modelo, query, recents, zoneFilter, locIdx, localidades]);
  const ddOpen = focused && ready && (locList.items.length > 0 || locList.empty);

  const chooseLoc = (i: number) => {
    const it = locList.items[i];
    if (!it) return;
    selectLoc(it.l);
    setAct(-1);
    qRef.current?.blur();
  };

  const onQueryKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const k = locList.items.length;
    if (e.key === "ArrowDown") { e.preventDefault(); if (k) { const i = (act + 1) % k; setAct(i); showGhost(locList.items[i].l); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (k) { const i = (act - 1 + k) % k; setAct(i); showGhost(locList.items[i].l); } }
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

  // ── Buscador de matrículas (agrega a la lista) ──────────────────────────────
  const fijadasDisponibles = useMemo(
    () => pinned.filter((a) => !elegidasSet.has(a)).map((a) => rowsByArt.get(a)).filter((r): r is MapaStockRow => !!r),
    [pinned, elegidasSet, rowsByArt],
  );
  const matList = useMemo<{ head: string | null; items: MapaStockRow[]; empty: boolean }>(() => {
    if (!matQuery.trim()) {
      const items = fijadasDisponibles.slice(0, 8);
      return { head: items.length ? "Fijadas" : null, items, empty: false };
    }
    const items = buscarMatriculas(matQuery, rows, elegidasSet);
    return { head: null, items, empty: items.length === 0 };
  }, [matQuery, fijadasDisponibles, rows, elegidasSet]);
  const matDdOpen = matFocused && (matList.items.length > 0 || matList.empty);

  const agregar = (lista: string[]) => {
    const next = [...articulos];
    for (const a of lista) if (!next.includes(a)) next.push(a);
    onArticulosChange(next);
  };
  const quitar = (a: string) => onArticulosChange(articulos.filter((x) => x !== a));
  const chooseMat = (i: number) => {
    const r = matList.items[i];
    if (!r) return;
    agregar([r.articulo]);
    setMatQuery("");
    setMatAct(-1);
  };
  const onMatKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const k = matList.items.length;
    if (e.key === "ArrowDown") { e.preventDefault(); if (k) setMatAct((matAct + 1) % k); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (k) setMatAct((matAct - 1 + k) % k); }
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

  // Dato de la leyenda: cantidad (1 matrícula) o «k/n» (varias).
  const legendDato = (codes: UnidadCode[]): { txt: string; on: boolean } | null => {
    if (!metrica) return null;
    if (metrica.kind === "qty") {
      const q = codes.reduce((s, c) => s + (metrica.values[c] ?? 0), 0);
      return { txt: q > 0 ? fmtNum(q) : "—", on: q > 0 };
    }
    const k = elegidas.filter(({ s }) => codes.some((c) => (s[c] ?? 0) > 0)).length;
    return { txt: k > 0 ? `${k}/${n}` : "—", on: k > 0 };
  };

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

  // Resumen bajo la lista de matrículas.
  const zonasCompletas = metrica?.kind === "cover" && modelo
    ? modelo.unidades.filter((u) => (metrica.values[u.code] ?? 0) === n).map((u) => u.code)
    : [];
  const maxCover = metrica?.kind === "cover" ? Math.max(0, ...Object.values(metrica.values).map((v) => v ?? 0)) : 0;
  const zonasConStock = metrica ? Object.values(metrica.values).filter((v) => (v ?? 0) > 0).length : 0;

  // Distancia: el dato principal de cada fila, a la derecha.
  const distDerecha = (c: NonNullable<typeof cercanos>[number], destacar: boolean) => {
    if (c.recta === null) return <span className="mz-stock-dist is-na">—</span>;
    if (c.recta < 1) return <span className={`mz-stock-dist${destacar ? " is-best" : ""}`}>En la obra</span>;
    const v = c.ruta ? c.ruta.km : c.recta;
    return <span className={`mz-stock-dist mz-mono${destacar ? " is-best" : ""}`}>{fmtKm(v)}</span>;
  };
  // Cómo se midió: tiempo en auto, o aviso de línea recta.
  const comoSeMidio = (c: NonNullable<typeof cercanos>[number]) => {
    if (c.recta === null || c.recta < 1) return null;
    if (c.ruta) return `${fmtDuracion(c.ruta.min)} en auto`;
    return rutaEstado === "loading" ? "calculando ruta…" : "en línea recta";
  };

  const capasItems: { key: keyof Capas; label: string }[] = [
    { key: "delegaciones", label: "Mostrar delegaciones" },
    { key: "distritos", label: "Mostrar distritos" },
    { key: "todas", label: "Mostrar todas las localidades" },
    { key: "rutas", label: "Mostrar rutas principales" },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div ref={wrapRef} style={{ height }}>
      <div
        ref={panelRef}
        className={`mz-panel${introOn ? " is-intro" : ""}${fading ? " is-fading" : ""}${selected ? " has-card" : ""}${picking ? " is-picking" : ""}`}
        style={{ height: "100%" }}
      >
        <canvas ref={canvasRef} className="mz-globe" />
        <div ref={mapElRef} className="mz-map" />

        {/* Aviso del modo «Marcar en el mapa» */}
        {(picking || aviso) && (
          <div className="mz-ui mz-hint" role="status">
            <Crosshair className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>{aviso ?? "Hacé clic en el mapa donde es la obra"}</span>
            <button type="button" className="mz-hint-x" onClick={() => { setPicking(false); setAviso(null); }}>
              {picking ? "Cancelar · Esc" : "Cerrar"}
            </button>
          </div>
        )}

        {/* Columna izquierda: 1) qué matrícula · 2) dónde es la obra */}
        <div ref={toolsRef} className="mz-ui mz-tools">
          <div className="mz-step">
            <div className="mz-step-head">
              <span>{n <= 1 ? "Matrícula" : `${n} matrículas`}</span>
              {n > 0 && (
                <button type="button" className="mz-iconbtn is-sm" title={n === 1 ? "Quitar matrícula" : "Quitar todas"} onClick={() => onArticulosChange([])}>
                  <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
              )}
            </div>
            {n > 0 && (
              <>
                <div className="mz-mat-list">
                  {elegidas.map(({ a, row }) => (
                    <div key={a} className="mz-mat-item" title={row?.descArticulo || undefined}>
                      <div className="mz-mat-main">
                        <span className="mz-mat-code mz-mono">{a}</span>
                        <span className="mz-mat-desc">{row?.descArticulo || "Sin datos de stock"}</span>
                      </div>
                      <span className="mz-mono mz-mat-qty">{fmtNum(row?.total ?? 0)}</span>
                      {n > 1 && (
                        <button type="button" className="mz-iconbtn is-sm" title="Quitar" onClick={() => quitar(a)}>
                          <X className="w-3 h-3" strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mz-mat-sum">
                  {n === 1 ? (
                    zonasConStock > 0
                      ? <><b className="mz-mono">{fmtNum(elegidas[0].row?.total ?? 0)}</b> {udm} en {zonasConStock} zona{zonasConStock !== 1 ? "s" : ""}</>
                      : "Sin stock en ninguna zona"
                  ) : zonasCompletas.length > 0 ? (
                    <span className="mz-mat-zonas">Todas en {zonasCompletas.map((c) => <ZoneBadge key={c} code={c} />)}</span>
                  ) : maxCover > 0 ? (
                    <>Ninguna zona tiene las {n} · máx. <b className="mz-mono">{maxCover}/{n}</b></>
                  ) : "Sin stock en ninguna zona"}
                </div>
              </>
            )}
            <div className="mz-box">
              <Search className="mz-lupa" strokeWidth={1.5} />
              <input
                className="mz-input"
                value={matQuery}
                placeholder={n > 0 ? "Agregar otra" : "Número o nombre"}
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
                  {matList.head && (
                    <div className="mz-dd-head mz-dd-head-row">
                      <span>{matList.head}</span>
                      {fijadasDisponibles.length > 1 && (
                        <button
                          type="button"
                          className="mz-dd-action"
                          onMouseDown={(e) => { e.preventDefault(); agregar(fijadasDisponibles.map((r) => r.articulo)); }}
                        >
                          Agregar todas
                        </button>
                      )}
                    </div>
                  )}
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
          </div>

          <div className="mz-step">
            <div className="mz-step-head">
              <span>Dónde es la obra</span>
              {selected && (
                <button type="button" className="mz-iconbtn is-sm" title="Quitar" onClick={clearSelection}>
                  <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
              )}
            </div>
            <div className="mz-box">
              <Search className="mz-lupa" strokeWidth={1.5} />
              <input
                ref={qRef}
                className="mz-input is-obra"
                value={query}
                disabled={!ready}
                placeholder={zoneFilter ? `Buscar en ${fLabel(zoneFilter)}` : "Escribí la localidad"}
                autoComplete="off"
                spellCheck={false}
                aria-label="Dónde es la obra"
                onChange={(e) => { setQuery(e.target.value); setAct(e.target.value.trim() ? 0 : -1); showGhost(null); }}
                onFocus={(e) => { setFocused(true); setAct(-1); if (selected) e.currentTarget.select(); }}
                onBlur={() => { setFocused(false); setAct(-1); showGhost(null); }}
                onKeyDown={onQueryKey}
              />
              {!focused && !query && <span className="mz-kbd mz-mono">/</span>}
              {ddOpen && (
                <div className="mz-dd" role="listbox">
                  {locList.head && <div className="mz-dd-head">{locList.head}</div>}
                  {locList.empty ? (
                    <div className="mz-dd-empty">
                      <MapPin className="mz-ic w-4 h-4" strokeWidth={1.5} />
                      No la encontramos{zoneFilter ? ` en ${fLabel(zoneFilter).replace("Zona", "la zona")}` : ""}. Usá «Marcar en el mapa».
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
            {/* Filtro de zona (clic en una zona o en la leyenda): debajo del campo, no adentro,
                para no tapar el texto en una tarjeta angosta. */}
            {zoneFilter && (
              <div className="mz-obra-filtro">
                <span>Buscando en</span>
                <button
                  type="button"
                  className="mz-zchip"
                  title="Quitar filtro de zona"
                  style={{ background: `color-mix(in srgb, ${zfColor} 15%, transparent)`, color: zfColor }}
                  onClick={() => setZoneFilter(null)}
                >
                  {fLabel(zoneFilter)}<X className="w-3 h-3" strokeWidth={2} />
                </button>
              </div>
            )}
            {selected && (
              <div className="mz-obra-sel">
                <LocBadge l={selected} />
                <span>{selected.marcado ? `a ${fmtKm(selected.marcado.km)} de ${selected.marcado.cerca}` : `Depto. ${selected.departamento}`}</span>
              </div>
            )}
            <button type="button" className={`mz-pick${picking ? " is-on" : ""}`} disabled={!ready} onClick={() => setPicking((v) => !v)}>
              <Crosshair className="w-3.5 h-3.5" strokeWidth={1.75} />{picking ? "Cancelar" : "Marcar en el mapa"}
            </button>
            {georefFallo && <span className="mz-step-note">Lista reducida: no se pudo traer el listado completo de localidades.</span>}
          </div>
        </div>

        {/* Capas + zoom */}
        <div className={`mz-ui mz-zoom${capasOpen ? " is-raised" : ""}`}>
          <div ref={capasRefEl} className="mz-capas-wrap">
            {capasOpen && (
              <div className="mz-capas" role="menu">
                {capasItems.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={capas[key]}
                    className={`mz-toggle${capas[key] ? " is-on" : ""}`}
                    onClick={() => setCapas((c) => ({ ...c, [key]: !c[key] }))}
                  >
                    <span className="mz-sw" />{label}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className={`mz-btn2${capasOpen ? " is-on" : ""}`}
              aria-expanded={capasOpen}
              onClick={() => setCapasOpen((v) => !v)}
            >
              <Layers className="w-3.5 h-3.5" strokeWidth={1.75} />Capas
            </button>
          </div>
          <button type="button" className="mz-btn2 mz-fullview" onClick={fullView}>
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
              <span>{!metrica ? "Zonas · delegaciones" : metrica.kind === "qty" ? "Stock por zona" : "Matrículas por zona"}</span>
              <ChevronUp strokeWidth={1.75} />
            </button>
            <div className="mz-lg-body">
              <div className="mz-lg-inner">
                <div className="mz-lg-list" style={lgMax !== null ? { maxHeight: Math.max(lgMax, 96), overflowY: "auto" } : undefined}>
                  {modelo.zonas.map((z) => {
                    const units: UnidadCode[] = z.subzonas ? z.subzonas.map((s) => s.code) : [z.code as UnidadCode];
                    const dato = legendDato(units);
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
                          {dato && <span className={`mz-cnt mz-mono${dato.on ? " has-stock" : ""}`}>{dato.txt}</span>}
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
                          const sd = legendDato([s.code]);
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
                              {sd && <span className={`mz-cnt mz-mono${sd.on ? " has-stock" : ""}`}>{sd.txt}</span>}
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
                  {capas.todas && <span><i className="mz-dot is-key" />Localidad</span>}
                  {capas.rutas && <span><i className="mz-rutak" />Ruta</span>}
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
                  <h2>{selected.marcado ? "Obra (punto marcado)" : selected.nombre}</h2>
                  <p>
                    Departamento {selected.departamento}
                    {selected.marcado && selected.marcado.cerca ? ` · a ${fmtKm(selected.marcado.km)} de ${selected.marcado.cerca}` : ""}
                  </p>
                </div>
                <button type="button" className="mz-iconbtn" title="Cerrar" onClick={clearSelection}>
                  <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
              </div>
              <div className="mz-card-body">
                {n === 0 ? (
                  <div className="mz-future">
                    <span className="mz-t">Stock más cercano</span>
                    <span className="mz-s">Elegí una o varias matrículas en la tarjeta «Matrícula» para ver en qué zonas hay stock y a qué distancia.</span>
                  </div>
                ) : !cercanos || cercanos.length === 0 ? (
                  <div className="mz-future">
                    <span className="mz-t">Stock más cercano</span>
                    <span className="mz-s">{n === 1 ? <>No hay stock de <span className="mz-mono">{articulos[0]}</span> en ninguna zona.</> : "Ninguna de las matrículas tiene stock en ninguna zona."}</span>
                  </div>
                ) : n === 1 ? (
                  <div className="mz-stock">
                    <span className="mz-stock-t">Stock más cercano</span>
                    {cercanos.map((c, i) => {
                      const como = comoSeMidio(c);
                      return (
                        <div key={c.u.code} className={`mz-stock-row${i === 0 ? " is-best" : ""}`}>
                          <ZoneBadge code={c.u.code} />
                          <span className="mz-stock-del">{c.u.delegacion}</span>
                          {distDerecha(c, i === 0)}
                          <span className="mz-stock-km">
                            <span className="mz-mono" style={{ color: "var(--ido-text)" }}>{fmtNum(c.qtys[0].q)}</span>{udm ? ` ${udm}` : ""} en stock
                            {como ? ` · ${como}` : ""}{i === 0 ? " · la más cercana" : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mz-stock">
                    {(["todas", "parte"] as const).map((grupo) => {
                      const lista = cercanos.filter((c) => (grupo === "todas" ? c.cover === n : c.cover < n));
                      if (!lista.length) return null;
                      return (
                        <div key={grupo} className="mz-stock-grupo">
                          <span className="mz-stock-t">{grupo === "todas" ? `Tienen las ${n}` : "Tienen parte"}</span>
                          {lista.map((c) => {
                            const best = c === cercanos[0];
                            const open = expandida === c.u.code;
                            return (
                              <div key={c.u.code} className={`mz-stock-row is-click${best ? " is-best" : ""}`} onClick={() => setExpandida(open ? null : c.u.code)}>
                                <ZoneBadge code={c.u.code} />
                                <span className="mz-stock-del">{c.u.delegacion}</span>
                                {distDerecha(c, best)}
                                <span className="mz-stock-km">
                                  <span className={`mz-cover mz-mono${c.cover === n ? " is-full" : ""}`}>{c.cover}/{n}</span> matrículas
                                  {comoSeMidio(c) ? ` · ${comoSeMidio(c)}` : ""}
                                </span>
                                {open && (
                                  <div className="mz-stock-det">
                                    {c.qtys.map(({ a, q }) => (
                                      <div key={a} className={q > 0 ? "" : "is-off"}>
                                        <span className="mz-mono">{a}</span>
                                        <span className="mz-mono">{q > 0 ? fmtNum(q) : "sin stock"}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="mz-detalles">
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
                </div>
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
              <button type="button" className="mz-btn1" onClick={() => setLoadNonce((k) => k + 1)}>
                <RotateCw className="w-3.5 h-3.5" strokeWidth={2} />Reintentar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
