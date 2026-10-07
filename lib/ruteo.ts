// Distancias y recorridos por ruta (auto) para el mapa de Stock por Zona.
// Usa el servidor público de OSRM (sin clave). Es best-effort: si no responde
// o tarda, quien llama vuelve a la distancia en línea recta.

import type { LatLng } from "@/lib/mapaZonas";

const OSRM = "https://router.project-osrm.org";
const TIMEOUT_MS = 6000;

export interface Ruta { km: number; min: number }
interface Punto { lat: number; lon: number }

const coord = (p: Punto) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`;

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error("osrm " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const tablaCache = new Map<string, Promise<(Ruta | null)[]>>();

/** Distancia y duración por ruta desde `origen` a cada destino (una sola consulta). */
export function distanciasPorRuta(origen: Punto, destinos: Punto[]): Promise<(Ruta | null)[]> {
  const key = [origen, ...destinos].map(coord).join(";");
  const hit = tablaCache.get(key);
  if (hit) return hit;
  const p = getJson(`${OSRM}/table/v1/driving/${key}?sources=0&annotations=distance,duration`)
    .then((data) => {
      const d = data as { code?: string; distances?: (number | null)[][]; durations?: (number | null)[][] };
      if (d.code !== "Ok" || !d.distances?.[0] || !d.durations?.[0]) throw new Error("osrm sin datos");
      return destinos.map((_, i) => {
        const m = d.distances![0][i + 1];
        const s = d.durations![0][i + 1];
        return m == null || s == null ? null : { km: m / 1000, min: s / 60 };
      });
    })
    .catch((e) => { tablaCache.delete(key); throw e; });
  tablaCache.set(key, p);
  return p;
}

// ── Tramos del recorrido: por qué rutas / calles pasa y dónde cambia ─────────

/** Un tramo del recorrido sobre una misma ruta (o calle). */
export interface Tramo {
  /** Número normalizado («RN 9», «RP E-53») o null si no es una ruta numerada. */
  ruta: string | null;
  /** Nombre de la vía («Autopista Córdoba-Rosario», «Av. Colón») o null. */
  nombre: string | null;
  km: number;
  min: number;
  coords: LatLng[];
  /** Punto a mitad del tramo (para el cartel sobre el mapa). */
  mitad: LatLng;
}
export interface Recorrido { coords: LatLng[]; tramos: Tramo[] }

/** «RN9», «RN 9», «RP-E53», «RPE53» → «RN 9», «RP E-53»… (mismo criterio que la capa de rutas). */
export function normRuta(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const crudo = ref.split(";")[0].trim();
  const r = crudo.toUpperCase().replace(/\s+/g, "");
  let m: RegExpMatchArray | null;
  if ((m = r.match(/^RN-?(\d+)$/))) return `RN ${+m[1]}`;
  if ((m = r.match(/^RP-?(\d+[A-Z]?)$/))) return `RP ${m[1]}`;
  if ((m = r.match(/^RP-?([A-Z])-?0*(\d+)$/))) return `RP ${m[1]}-${m[2]}`;
  if ((m = r.match(/^RN(\d+)V0*(\d+)$/))) return `RN ${+m[1]}V${m[2].padStart(2, "0")}`;
  if ((m = r.match(/^RNA-?0*(\d+)$/))) return `RN A${m[1].padStart(3, "0")}`;
  if ((m = r.match(/^AUV?(\d+)$/))) return `AU ${m[1]}`;
  return crudo || null;
}
function rutaDeNombre(nombre: string): string | null {
  const m = nombre.match(/\bRuta\s+(Nacional|Provincial)?\s*([A-Z]?-?\d+[A-Z]?)\b/i);
  if (!m) return null;
  const tipo = (m[1] ?? "").toLowerCase().startsWith("prov") ? "RP" : "RN";
  return normRuta(tipo + m[2].replace("-", ""));
}

const largo = (c: LatLng[]) => {
  let d = 0;
  for (let i = 1; i < c.length; i++) d += Math.hypot(c[i][0] - c[i - 1][0], (c[i][1] - c[i - 1][1]) * 0.85);
  return d;
};
function puntoMedio(c: LatLng[]): LatLng {
  const total = largo(c);
  let d = 0;
  for (let i = 1; i < c.length; i++) {
    const s = Math.hypot(c[i][0] - c[i - 1][0], (c[i][1] - c[i - 1][1]) * 0.85);
    if (d + s >= total / 2 && s > 0) {
      const t = (total / 2 - d) / s;
      return [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t];
    }
    d += s;
  }
  return c[Math.floor(c.length / 2)];
}

interface PasoOsrm { name?: string; ref?: string; distance?: number; duration?: number; geometry?: { coordinates?: [number, number][] } }

// Por debajo de esto un tramo es un cruce o una bajada: se suma al anterior.
const KM_MIN_TRAMO = 1.5;
// Calles sin número de ruta más cortas que esto se juntan en «calles locales».
const KM_MIN_CALLE = 3;

/** Agrupa los pasos de OSRM en tramos por ruta y limpia los cortos. */
export function armarTramos(pasos: PasoOsrm[]): Tramo[] {
  type T = Omit<Tramo, "mitad">;
  const clave = (t: Pick<T, "ruta" | "nombre">) => t.ruta ?? t.nombre ?? "";
  const unir = (lista: T[]) => {
    const out: T[] = [];
    for (const t of lista) {
      const prev = out[out.length - 1];
      if (prev && clave(prev) === clave(t)) {
        prev.km += t.km; prev.min += t.min; prev.coords = prev.coords.concat(t.coords.slice(1));
        if (!prev.nombre && t.nombre) prev.nombre = t.nombre;
      } else out.push({ ...t, coords: t.coords.slice() });
    }
    return out;
  };
  let ts: T[] = unir(pasos
    .filter((p) => (p.distance ?? 0) > 0 && (p.geometry?.coordinates?.length ?? 0) > 1)
    .map((p) => {
      const nombre = (p.name ?? "").trim() || null;
      const ruta = normRuta(p.ref) ?? (nombre ? rutaDeNombre(nombre) : null);
      // «Ruta Nacional 9» no agrega nada al lado de «RN 9».
      const redundante = !!(ruta && nombre && rutaDeNombre(nombre) === ruta);
      return {
        ruta, nombre: redundante ? null : nombre, km: (p.distance ?? 0) / 1000, min: (p.duration ?? 0) / 60,
        coords: p.geometry!.coordinates!.map(([lon, lat]) => [lat, lon] as LatLng),
      };
    }));
  // Calles cortas sin número de ruta → un solo tramo «calles locales».
  ts = unir(ts.map((t) => (!t.ruta && t.km < KM_MIN_CALLE ? { ...t, nombre: null } : t)));
  // Tramos muy cortos (un cruce, una colectora, la salida de un pueblo): se suman
  // al anterior — o al siguiente si es el primero — y se vuelve a unir.
  for (;;) {
    const i = ts.length > 1 ? ts.findIndex((t) => t.km < KM_MIN_TRAMO) : -1;
    if (i < 0) break;
    const j = i > 0 ? i - 1 : 1;
    const [a, b] = j < i ? [ts[j], ts[i]] : [ts[i], ts[j]];
    ts.splice(Math.min(i, j), 2, { ...ts[j], km: a.km + b.km, min: a.min + b.min, coords: a.coords.concat(b.coords.slice(1)) });
    ts = unir(ts);
  }
  return ts.map((t) => ({ ...t, mitad: puntoMedio(t.coords) }));
}

const rutaCache = new Map<string, Promise<Recorrido | null>>();

/** Recorrido entre dos puntos: trazado simplificado [lat, lon] + tramos por ruta. */
export function trazadoRuta(origen: Punto, destino: Punto): Promise<Recorrido | null> {
  const key = `${coord(origen)};${coord(destino)}`;
  const hit = rutaCache.get(key);
  if (hit) return hit;
  const p = getJson(`${OSRM}/route/v1/driving/${key}?overview=simplified&geometries=geojson&steps=true`)
    .then((data) => {
      const d = data as { code?: string; routes?: { geometry?: { coordinates?: [number, number][] }; legs?: { steps?: PasoOsrm[] }[] }[] };
      const r = d.code === "Ok" ? d.routes?.[0] : undefined;
      const c = r?.geometry?.coordinates;
      if (!c || c.length < 2) return null;
      const pasos = (r!.legs ?? []).flatMap((l) => l.steps ?? []);
      return { coords: c.map(([lon, lat]) => [lat, lon] as LatLng), tramos: armarTramos(pasos) };
    })
    .catch((e) => { rutaCache.delete(key); throw e; });
  rutaCache.set(key, p);
  return p;
}

export function fmtDuracion(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
