// Capa de datos del mapa de zonas EPEC (Córdoba). Portado de `datos-mapa.js`
// del import de Claude Design «MapaZonas». La geometría (límites IGN de los 26
// departamentos) vive en `public/geo/cordoba.json` y se carga bajo demanda.

export type LatLng = [number, number];

export interface GeoDepartamento { name: string; zone: string; ring: LatLng[] }
export interface GeoCordoba {
  departamentos: GeoDepartamento[];
  bordesZona: Record<string, LatLng[][]>;
  contorno: LatLng[][];
}

/** Zona territorial A–H. */
export type ZonaCode = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
/** Unidad geográfica: una por zona simple y una por subzona de B. */
export type UnidadCode = "A" | "BN" | "BS" | "C" | "D" | "E" | "F" | "G" | "H";

interface UnidadDef { code: UnidadCode; delegacion: string; label: LatLng; sede: string }
interface ZonaDef { code: ZonaCode; delegacion: string; label: LatLng; subzonas?: UnidadDef[]; sede?: string }

// `sede` = nombre de la localidad donde está la delegación (para medir distancias).
const ZONAS_DEF: ZonaDef[] = [
  { code: "A", delegacion: "Córdoba Capital", label: [-31.40, -64.19], sede: "Córdoba" },
  {
    code: "B", delegacion: "La Falda · Villa Carlos Paz", label: [-31.2, -65.1], subzonas: [
      { code: "BN", delegacion: "La Falda", label: [-30.75, -65.05], sede: "La Falda" },
      { code: "BS", delegacion: "Villa Carlos Paz", label: [-31.70, -65.20], sede: "Villa Carlos Paz" },
    ],
  },
  { code: "C", delegacion: "Villa María", label: [-32.25, -63.45], sede: "Villa María" },
  { code: "D", delegacion: "San Francisco", label: [-31.15, -62.75], sede: "San Francisco" },
  { code: "E", delegacion: "Río Ceballos", label: [-30.20, -63.95], sede: "Río Ceballos" },
  { code: "F", delegacion: "Río Cuarto", label: [-34.10, -64.20], sede: "Río Cuarto" },
  { code: "G", delegacion: "Bell Ville", label: [-32.85, -62.40], sede: "Bell Ville" },
  { code: "H", delegacion: "Alta Gracia", label: [-31.95, -64.55], sede: "Alta Gracia" },
];

export const ZONA_CODES: ZonaCode[] = ZONAS_DEF.map((z) => z.code);

/** Token CSS del color de identidad territorial (definido en `.ido-terminal`). */
export const zonaColorVar = (code: string) => `var(--ido-zona-${code.toLowerCase()})`;

// ─── Mapeo con los códigos de stock (columna Organización) ─────────────────────
// Los uploads de stock llegan como ZA…ZI. ZB es B Norte (La Falda) y ZI es
// B Sur (Villa Carlos Paz); el resto mapea directo a su letra.
const STOCK_A_UNIDAD: Record<string, UnidadCode> = {
  ZA: "A", ZB: "BN", ZC: "C", ZD: "D", ZE: "E", ZF: "F", ZG: "G", ZH: "H", ZI: "BS",
};

export function unidadDeStock(zonaStock: string): UnidadCode | null {
  const z = zonaStock.trim().toUpperCase();
  if (STOCK_A_UNIDAD[z]) return STOCK_A_UNIDAD[z];
  if (["A", "BN", "BS", "C", "D", "E", "F", "G", "H"].includes(z)) return z as UnidadCode;
  return null;
}

export function zonaDeUnidad(u: UnidadCode): ZonaCode {
  return (u === "BN" || u === "BS" ? "B" : u) as ZonaCode;
}

/** Color de identidad para un código de stock (ZA…ZI), o null si no es territorial. */
export function colorVarDeStock(zonaStock: string): string | null {
  const u = unidadDeStock(zonaStock);
  return u ? zonaColorVar(u) : null;
}

// ─── Modelo armado sobre la geometría ──────────────────────────────────────────

export interface Unidad {
  code: UnidadCode;
  zona: ZonaCode;
  subzona: "BN" | "BS" | null;
  delegacion: string;
  sede: string;
  label: LatLng;
  departamentos: GeoDepartamento[];
}

export interface Zona {
  code: ZonaCode;
  delegacion: string;
  label: LatLng;
  subzonas: Unidad[] | null;
  bordes: LatLng[][];
  divisoria: LatLng[][] | null;
}

export interface MapaModelo {
  zonas: Zona[];
  unidades: Unidad[];
  contorno: LatLng[][];
  marChiquita: LatLng[];
  localidades: Localidad[];
  /** Coordenadas de la sede de cada unidad (para distancias). */
  sedes: Record<UnidadCode, Localidad | undefined>;
  /** Zona y departamento de un punto cualquiera (null si cae fuera de Córdoba). */
  ubicar: (lat: number, lon: number) => { unidad: Unidad; departamento: string } | null;
  /** Suma las localidades de Georef a la lista embebida (sin duplicar). */
  fusionar: (externas: LocalidadExterna[]) => Localidad[];
}

/** Localidad tal como llega de Georef (nombre puede venir en mayúsculas). */
export interface LocalidadExterna { nombre: string; departamento: string; lat: number; lon: number }

/** Minúsculas y sin acentos — para comparar nombres de distintas fuentes. */
export const normNombre = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const MINUSCULAS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en"]);
// «VILLA DEL ROSARIO» → «Villa del Rosario». Si ya viene con minúsculas, se respeta.
function titulo(s: string): string {
  if (/[a-zà-ÿ]/.test(s)) return s;
  return s.toLowerCase().split(/(\s+|-)/).map((w, i) =>
    i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1),
  ).join("");
}

const pk = (p: LatLng) => p[0].toFixed(4) + "," + p[1].toFixed(4);

// Encadena aristas sueltas en polilíneas continuas.
function chain(edges: [LatLng, LatLng][]): LatLng[][] {
  const adj = new Map<string, number[]>();
  const pts = new Map<string, LatLng>();
  const used = new Set<number>();
  edges.forEach(([a, b], i) => {
    for (const x of [a, b]) {
      const k = pk(x);
      pts.set(k, x);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k)!.push(i);
    }
  });
  const out: LatLng[][] = [];
  const walk = (start: number | undefined, from: LatLng) => {
    const line: LatLng[] = [from];
    let cur = from;
    let i = start;
    while (i != null && !used.has(i)) {
      used.add(i);
      const [a, b] = edges[i];
      const nxt = pk(a) === pk(cur) ? b : a;
      line.push(nxt);
      cur = nxt;
      i = (adj.get(pk(cur)) || []).find((j) => !used.has(j));
    }
    return line;
  };
  adj.forEach((list, k) => { if (list.length === 1 && !used.has(list[0])) out.push(walk(list[0], pts.get(k)!)); });
  edges.forEach((e, i) => { if (!used.has(i)) out.push(walk(i, e[0])); });
  return out;
}

// Laguna de Mar Chiquita, contorno aproximado.
const MAR_CHIQUITA: LatLng[] = [[-30.40,-62.70],[-30.41,-62.58],[-30.46,-62.45],[-30.55,-62.37],[-30.66,-62.35],[-30.76,-62.40],[-30.85,-62.50],[-30.92,-62.63],[-30.95,-62.78],[-30.92,-62.92],[-30.85,-63.02],[-30.75,-63.08],[-30.64,-63.09],[-30.55,-63.03],[-30.48,-62.93],[-30.43,-62.82]];

// Distritos de cada zona (los que figuran en el diseño).
const DISTRITOS: Partial<Record<UnidadCode, string[]>> = {
  BN: ["Serrezuela", "Cruz del Eje", "Capilla del Monte", "La Cumbre", "Parque Siquimán"],
  C: ["James Craik", "Tancacha", "General Cabrera", "Ucacha", "Pascanas", "Laborde", "Wenceslao Escalante", "Ballesteros", "Alto Alegre"],
  D: ["Devoto", "Balnearia", "Santiago Temple"],
  E: ["San Francisco del Chañar", "Villa de María", "Villa del Totoral", "Villa Allende", "La Calera"],
  F: ["General Levalle", "Hipólito Bouchard", "Alejandro Roca", "Alejo Ledesma", "Arias"],
  G: ["Morrison", "Noetinger", "Leones", "Marcos Juárez", "Los Surgentes", "Cruz Alta", "Monte Maíz", "Isla Verde", "Corral de Bustos"],
  H: ["Río Segundo"],
};

// Distritos y delegaciones que EPEC asigna a una zona distinta de la de su departamento.
// Claves normalizadas (sin acentos, minúsculas) para que también matcheen los
// nombres de Georef, que vienen en mayúsculas y sin tildes.
const ZONA_FORZADA: Record<string, UnidadCode> = { "villa carlos paz": "BS", "rio segundo": "H" };
for (const [z, list] of Object.entries(DISTRITOS) as [UnidadCode, string[]][]) {
  for (const n of list) ZONA_FORZADA[normNombre(n)] = ZONA_FORZADA[normNombre(n)] || z;
}
const DISTRITOS_NORM: Partial<Record<UnidadCode, Set<string>>> = Object.fromEntries(
  (Object.entries(DISTRITOS) as [UnidadCode, string[]][]).map(([z, list]) => [z, new Set(list.map(normNombre))]),
);

// Subconjunto real de Georef (nombre, departamento, lat, lon).
const EMBEBIDO = `Córdoba|Capital|-31.4201|-64.1888
La Falda|Punilla|-31.0884|-64.4895
Villa Carlos Paz|Punilla|-31.4241|-64.4978
Villa María|General San Martín|-32.4075|-63.2402
San Francisco|San Justo|-31.4280|-62.0827
Río Ceballos|Colón|-31.1650|-64.3220
Río Cuarto|Río Cuarto|-33.1232|-64.3493
Bell Ville|Unión|-32.6259|-62.6887
Alta Gracia|Santa María|-31.6593|-64.4300
Serrezuela|Cruz del Eje|-30.6378|-65.3833
Cruz del Eje|Cruz del Eje|-30.7264|-64.8034
Capilla del Monte|Punilla|-30.8606|-64.5253
La Cumbre|Punilla|-30.9817|-64.4917
Parque Siquimán|Punilla|-31.3478|-64.4769
James Craik|Tercero Arriba|-32.1611|-63.4664
Tancacha|Tercero Arriba|-32.2436|-63.9806
General Cabrera|Juárez Celman|-32.8131|-63.8731
Ucacha|Juárez Celman|-33.0328|-63.5069
Pascanas|Unión|-33.1261|-63.0408
Laborde|Unión|-33.1531|-62.8564
Wenceslao Escalante|Unión|-33.1731|-62.7686
Ballesteros|Unión|-32.5444|-62.9833
Alto Alegre|Unión|-32.3456|-62.8833
Devoto|San Justo|-31.4039|-62.3061
Balnearia|San Justo|-30.9897|-62.6681
Santiago Temple|Río Segundo|-31.3869|-63.4189
San Francisco del Chañar|Sobremonte|-29.7889|-63.9439
Villa de María|Río Seco|-29.9058|-63.7236
Villa del Totoral|Totoral|-30.7031|-64.0672
Villa Allende|Colón|-31.2950|-64.2950
La Calera|Colón|-31.3436|-64.3353
General Levalle|Presidente Roque Sáenz Peña|-34.0103|-63.9244
Hipólito Bouchard|General Roca|-34.7231|-63.5100
Alejandro Roca|Juárez Celman|-33.3542|-63.7186
Alejo Ledesma|Marcos Juárez|-33.6061|-62.6236
Arias|Marcos Juárez|-33.6417|-62.4028
Morrison|Unión|-32.5928|-62.8347
Noetinger|Unión|-32.3667|-62.3106
Leones|Marcos Juárez|-32.6603|-62.2967
Marcos Juárez|Marcos Juárez|-32.6978|-62.1050
Los Surgentes|Marcos Juárez|-32.9833|-62.0222
Cruz Alta|Marcos Juárez|-33.0083|-61.8075
Monte Maíz|Unión|-33.2044|-62.6006
Isla Verde|Marcos Juárez|-33.2400|-62.4031
Corral de Bustos|Marcos Juárez|-33.2817|-62.1847
Río Segundo|Río Segundo|-31.6522|-63.9097
Jesús María|Colón|-30.9817|-64.0944
Deán Funes|Ischilín|-30.4203|-64.3497
Cosquín|Punilla|-31.2450|-64.4656
Mina Clavero|San Alberto|-31.7208|-65.0058
Villa Cura Brochero|San Alberto|-31.7058|-65.0181
Villa Dolores|San Javier|-31.9458|-65.1897
La Paz|San Javier|-32.2194|-65.0475
Salsacate|Pocho|-31.3183|-65.0889
Villa General Belgrano|Calamuchita|-31.9786|-64.5561
Santa Rosa de Calamuchita|Calamuchita|-32.0694|-64.5361
Embalse|Calamuchita|-32.1814|-64.4031
Río Tercero|Tercero Arriba|-32.1731|-64.1144
Oncativo|Río Segundo|-31.9133|-63.6819
Oliva|Tercero Arriba|-32.0414|-63.5686
Hernando|Tercero Arriba|-32.4261|-63.7331
Pilar|Río Segundo|-31.6792|-63.8792
Laguna Larga|Río Segundo|-31.7769|-63.8008
Las Varillas|San Justo|-31.8714|-62.7192
Morteros|San Justo|-30.7119|-62.0047
Miramar|San Justo|-30.9139|-62.6750
Arroyito|San Justo|-31.4200|-63.0500
La Carlota|Juárez Celman|-33.4192|-63.2978
Laboulaye|Presidente Roque Sáenz Peña|-34.1267|-63.3911
Huinca Renancó|General Roca|-34.8403|-64.3733
Villa Huidobro|General Roca|-34.8381|-64.5864
Vicuña Mackenna|Río Cuarto|-33.9192|-64.3919
Adelia María|Río Cuarto|-33.6317|-64.0214
Sampacho|Río Cuarto|-33.3836|-64.7228
Achiras|Río Cuarto|-33.1750|-64.9925
Canals|Unión|-33.5653|-62.8889
Justiniano Posse|Unión|-32.8842|-62.6797
Despeñaderos|Santa María|-31.8167|-64.2894
Malagueño|Santa María|-31.4647|-64.3583
Anisacate|Santa María|-31.7292|-64.4142
Quilino|Ischilín|-30.2131|-64.5003
Villa Tulumba|Tulumba|-30.3956|-64.1219`;

export interface Localidad {
  id: number;
  nombre: string;
  departamento: string;
  lat: number;
  lon: number;
  zona: ZonaCode;
  subzona: "BN" | "BS" | null;
  unidad: UnidadCode;
  rol: "delegacion" | "distrito" | null;
  /** Punto marcado a mano en el mapa (no es una localidad con nombre). */
  marcado?: { cerca: string; km: number };
}

function inside(pt: LatLng, ring: LatLng[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Distancia en km (haversine). */
export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const t = (x: number) => (x * Math.PI) / 180;
  const dLat = t(b.lat - a.lat);
  const dLon = t(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Arma zonas, unidades, bordes y localidades a partir de la geometría. */
export function armarModelo(geo: GeoCordoba): MapaModelo {
  const deps = geo.departamentos;
  const unidades: Unidad[] = [];
  const zonas: Zona[] = ZONAS_DEF.map((z) => {
    if (!z.subzonas) {
      const u: Unidad = {
        code: z.code as UnidadCode, zona: z.code, subzona: null, delegacion: z.delegacion, sede: z.sede!,
        label: z.label, departamentos: deps.filter((d) => d.zone === z.code),
      };
      unidades.push(u);
      return { code: z.code, delegacion: z.delegacion, label: z.label, subzonas: null, bordes: geo.bordesZona[z.code] || [], divisoria: null };
    }
    const subs = z.subzonas.map((s) => {
      const u: Unidad = {
        code: s.code, zona: z.code, subzona: s.code as "BN" | "BS", delegacion: s.delegacion, sede: s.sede,
        label: s.label, departamentos: deps.filter((d) => d.zone === s.code),
      };
      unidades.push(u);
      return u;
    });
    // Borde exterior (aristas de una sola subzona) y divisoria interna (compartidas).
    const codes = subs.map((s) => s.code as string);
    const own = new Map<string, { e: [LatLng, LatLng]; z: string[] }>();
    deps.filter((d) => codes.includes(d.zone)).forEach((dep) => dep.ring.forEach((a, i) => {
      const b = dep.ring[(i + 1) % dep.ring.length];
      if (pk(a) === pk(b)) return;
      const k = [pk(a), pk(b)].sort().join("|");
      if (!own.has(k)) own.set(k, { e: [a, b], z: [] });
      own.get(k)!.z.push(dep.zone);
    }));
    const outer: [LatLng, LatLng][] = [];
    const div: [LatLng, LatLng][] = [];
    own.forEach(({ e, z: zs }) => {
      if (zs.length === 1) outer.push(e);
      else if (new Set(zs).size > 1) div.push(e);
    });
    const divisoria = chain(div);
    const longest = divisoria.slice().sort((a, b) => b.length - a.length)[0] || [];
    const label = longest[Math.floor(longest.length / 2)] || z.label;
    return { code: z.code, delegacion: z.delegacion, label, subzonas: subs, bordes: chain(outer), divisoria };
  });

  const unidadPorCode = new Map(unidades.map((u) => [u.code, u]));
  const deptoEn = (lat: number, lon: number) => deps.find((dep) => inside([lat, lon], dep.ring)) ?? null;
  const zonaDe = (lat: number, lon: number, nombre: string): UnidadCode | null => {
    const forzada = ZONA_FORZADA[normNombre(nombre)];
    if (forzada) return forzada;
    const d = deptoEn(lat, lon);
    return d ? (d.zone as UnidadCode) : null;
  };
  const rol = (nombre: string, unidad: UnidadCode): Localidad["rol"] => {
    const u = unidadPorCode.get(unidad);
    const n = normNombre(nombre);
    if (u && normNombre(u.sede) === n) return "delegacion";
    if (DISTRITOS_NORM[unidad]?.has(n)) return "distrito";
    return null;
  };

  const localidades: Localidad[] = [];
  EMBEBIDO.split("\n").forEach((line, i) => {
    const [nombre, departamento, la, lo] = line.split("|");
    const lat = +la;
    const lon = +lo;
    const code = zonaDe(lat, lon, nombre);
    const u = code ? unidadPorCode.get(code) : undefined;
    if (!u) return;
    localidades.push({ id: i, nombre, departamento, lat, lon, zona: u.zona, subzona: u.subzona, unidad: u.code, rol: rol(nombre, u.code) });
  });

  const sedes = Object.fromEntries(
    unidades.map((u) => [u.code, localidades.find((l) => l.nombre === u.sede)]),
  ) as Record<UnidadCode, Localidad | undefined>;

  const ubicar = (lat: number, lon: number) => {
    const d = deptoEn(lat, lon);
    const u = d ? unidadPorCode.get(d.zone as UnidadCode) : undefined;
    return d && u ? { unidad: u, departamento: d.name } : null;
  };

  // Georef trae cientos de localidades; las que ya están en la lista embebida
  // (mismo nombre y departamento) conservan el objeto propio — nombre con
  // tildes y rol de delegación/distrito —, así un anillo y el buscador apuntan
  // a la misma localidad.
  const fusionar = (externas: LocalidadExterna[]): Localidad[] => {
    const clave = (n: string, d: string) => normNombre(n) + "|" + normNombre(d);
    const propias = new Map(localidades.map((l) => [clave(l.nombre, l.departamento), l]));
    const vistas = new Set<string>();
    const out: Localidad[] = [];
    let id = 100000;
    for (const e of externas) {
      const k = clave(e.nombre, e.departamento);
      if (vistas.has(k)) continue;
      vistas.add(k);
      const propia = propias.get(k);
      if (propia) { out.push(propia); continue; }
      const code = zonaDe(e.lat, e.lon, e.nombre);
      const u = code ? unidadPorCode.get(code) : undefined;
      if (!u) continue;
      out.push({
        id: id++, nombre: titulo(e.nombre), departamento: e.departamento, lat: e.lat, lon: e.lon,
        zona: u.zona, subzona: u.subzona, unidad: u.code, rol: rol(e.nombre, u.code),
      });
    }
    for (const l of localidades) if (!vistas.has(clave(l.nombre, l.departamento))) out.push(l);
    return out;
  };

  return { zonas, unidades, contorno: geo.contorno, marChiquita: MAR_CHIQUITA, localidades, sedes, ubicar, fusionar };
}

// ─── Localidades completas desde Georef (API pública de datos.gob.ar) ─────────
const GEOREF = "https://apis.datos.gob.ar/georef/api/localidades?provincia=cordoba&max=5000&campos=nombre,departamento.nombre,centroide";
const GEOREF_CACHE = "mapa.localidades.georef.v1";
const GEOREF_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let georefPromise: Promise<LocalidadExterna[]> | null = null;
/** Todas las localidades de Córdoba. Cacheadas 30 días en este navegador. */
export function cargarLocalidadesGeoref(): Promise<LocalidadExterna[]> {
  if (georefPromise) return georefPromise;
  try {
    const raw = localStorage.getItem(GEOREF_CACHE);
    if (raw) {
      const c = JSON.parse(raw) as { t?: number; rows?: LocalidadExterna[] };
      if (c.t && Date.now() - c.t < GEOREF_TTL_MS && Array.isArray(c.rows) && c.rows.length) {
        georefPromise = Promise.resolve(c.rows);
        return georefPromise;
      }
    }
  } catch { /* sin storage o caché corrupta: se vuelve a pedir */ }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  georefPromise = fetch(GEOREF, { signal: ctrl.signal })
    .then((r) => {
      if (!r.ok) throw new Error("georef " + r.status);
      return r.json() as Promise<{ localidades?: { nombre?: string; departamento?: { nombre?: string }; centroide?: { lat?: number; lon?: number } }[] }>;
    })
    .then((d) => {
      const rows: LocalidadExterna[] = (d.localidades ?? [])
        .filter((l) => l.nombre && l.centroide?.lat != null && l.centroide?.lon != null)
        .map((l) => ({ nombre: l.nombre!, departamento: l.departamento?.nombre ?? "", lat: l.centroide!.lat!, lon: l.centroide!.lon! }));
      if (!rows.length) throw new Error("georef vacío");
      try { localStorage.setItem(GEOREF_CACHE, JSON.stringify({ t: Date.now(), rows })); } catch { /* sin storage */ }
      return rows;
    })
    .catch((e) => { georefPromise = null; throw e; })
    .finally(() => clearTimeout(t));
  return georefPromise;
}

let geoPromise: Promise<GeoCordoba> | null = null;
/** Descarga (una vez por sesión) la geometría de Córdoba. */
export function cargarGeo(): Promise<GeoCordoba> {
  if (!geoPromise) {
    geoPromise = fetch("/geo/cordoba.json")
      .then((r) => {
        if (!r.ok) throw new Error("geo " + r.status);
        return r.json() as Promise<GeoCordoba>;
      })
      .catch((e) => { geoPromise = null; throw e; });
  }
  return geoPromise;
}
