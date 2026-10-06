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

const rutaCache = new Map<string, Promise<LatLng[] | null>>();

/** Trazado simplificado del recorrido entre dos puntos, como [lat, lon]. */
export function trazadoRuta(origen: Punto, destino: Punto): Promise<LatLng[] | null> {
  const key = `${coord(origen)};${coord(destino)}`;
  const hit = rutaCache.get(key);
  if (hit) return hit;
  const p = getJson(`${OSRM}/route/v1/driving/${key}?overview=simplified&geometries=geojson`)
    .then((data) => {
      const d = data as { code?: string; routes?: { geometry?: { coordinates?: [number, number][] } }[] };
      const c = d.code === "Ok" ? d.routes?.[0]?.geometry?.coordinates : undefined;
      return c && c.length > 1 ? c.map(([lon, lat]) => [lat, lon] as LatLng) : null;
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
