#!/usr/bin/env python3
"""Genera public/geo/rutas-cordoba.json a partir de un export de overpass-turbo.

Uso:  python3 scripts/rutas-osm.py export.geojson public/geo/cordoba.json public/geo/rutas-cordoba.json

Consulta usada en overpass-turbo.eu (Exportar → GeoJSON):
  [out:json][timeout:300][bbox:-35.1,-65.8,-29.4,-61.7];
  way["highway"~"^(motorway|trunk|primary)$"];
  out geom;

Recorta al contorno de Córdoba, descarta avenidas sin número de ruta, une tramos
de la misma ruta, simplifica (~40 m) y precalcula dónde va el número de cada ruta.
Datos © OpenStreetMap (ODbL): la atribución va en el mapa.
"""
import json, sys, math, re
from collections import defaultdict
src, geo_path, out = sys.argv[1:]
g = json.load(open(src)); geo = json.load(open(geo_path))

# ── Provincia: unión de los anillos de departamentos ([lat, lon]) ──
rings = []
for d in geo["departamentos"]:
    r = d["ring"]; lats = [p[0] for p in r]; lons = [p[1] for p in r]
    rings.append((min(lats), max(lats), min(lons), max(lons), r))
def in_ring(lat, lon, ring):
    c = False; j = len(ring) - 1
    for i in range(len(ring)):
        yi, xi = ring[i]; yj, xj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi: c = not c
        j = i
    return c
def dentro(lon, lat):
    for a, b, c, d, r in rings:
        if a <= lat <= b and c <= lon <= d and in_ring(lat, lon, r): return True
    return False
def borde(p_in, p_out):
    a, b = p_in, p_out
    for _ in range(18):
        m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if dentro(*m): a = m
        else: b = m
    return [a[0], a[1]]

# ── Número de ruta legible ──
def norm_ref(ref):
    if not ref: return None
    r = ref.split(";")[0].strip().upper().replace(" ", "")
    m = re.match(r"^RN(\d+)$", r)
    if m: return f"RN {int(m.group(1))}"
    m = re.match(r"^RP(\d+[A-Z]?)$", r)
    if m: return f"RP {m.group(1)}"
    m = re.match(r"^RP([A-Z])-?0*(\d+)$", r)
    if m: return f"RP {m.group(1)}-{m.group(2)}"
    m = re.match(r"^RN(\d+)V0*(\d+)$", r)
    if m: return f"RN {int(m.group(1))}V{int(m.group(2)):02d}"
    m = re.match(r"^RNA-?0*(\d+)$", r)
    if m: return f"RN A{int(m.group(1)):03d}"
    m = re.match(r"^AU(V)?(\d+)$", r)
    if m: return f"AU {m.group(2)}"
    return ref.split(";")[0].strip()

def ref_de_nombre(nombre):
    m = re.search(r"\bRuta\s+(Nacional|Provincial)?\s*([A-Z]?-?\d+[A-Z]?)\b", nombre or "", re.I)
    if not m: return None
    tipo = "RP" if (m.group(1) or "").lower().startswith("prov") else "RN"
    return norm_ref(tipo + m.group(2).replace("-", ""))

def km_ll(a, b):
    R = 6371; t = math.radians
    dlat = t(b[1] - a[1]); dlon = t(b[0] - a[0])
    return 2 * R * math.asin(math.sqrt(math.sin(dlat / 2) ** 2 + math.cos(t(a[1])) * math.cos(t(b[1])) * math.sin(dlon / 2) ** 2))
CORDOBA = (-64.19, -31.42)   # centro de la capital: ahí las «primary» sin número son avenidas urbanas

CLASE = {"motorway": "principal", "trunk": "principal", "primary": "ruta"}
grupos = defaultdict(list)   # (ref, clase) -> lista de tramos [[lon,lat],...]
for f in g["features"]:
    p = f["properties"]; geom = f["geometry"]
    if not geom or geom["type"] != "LineString": continue
    clase = CLASE.get(p.get("highway"))
    ref = norm_ref(p.get("ref")) or ref_de_nombre(p.get("name"))
    pts = geom["coordinates"]
    if not clase: continue
    # Sin número: se conserva salvo que sea una avenida dentro de la ciudad de Córdoba.
    if not ref and clase != "principal" and km_ll(pts[len(pts) // 2], CORDOBA) < 15: continue
    flags = [dentro(x, y) for x, y in pts]
    tramo = []
    for i, (pt, ok) in enumerate(zip(pts, flags)):
        if ok:
            if not tramo and i > 0: tramo.append(borde(pt, pts[i - 1]))
            tramo.append(pt)
        elif tramo:
            tramo.append(borde(pts[i - 1], pt))
            if len(tramo) > 1: grupos[(ref, clase)].append(tramo)
            tramo = []
    if len(tramo) > 1: grupos[(ref, clase)].append(tramo)

# ── Unir tramos contiguos de la misma ruta ──
def key(p): return (round(p[0], 6), round(p[1], 6))
def unir(tramos):
    tramos = [t[:] for t in tramos]
    cambio = True
    while cambio:
        cambio = False
        ends = {}
        for i, t in enumerate(tramos):
            ends.setdefault(key(t[0]), []).append((i, 0)); ends.setdefault(key(t[-1]), []).append((i, 1))
        usados = set(); nuevos = []
        for i, t in enumerate(tramos):
            if i in usados: continue
            usados.add(i); linea = t[:]
            extendio = True
            while extendio:
                extendio = False
                for lado in (1, 0):
                    k = key(linea[-1] if lado == 1 else linea[0])
                    for j, e in ends.get(k, []):
                        if j in usados: continue
                        o = tramos[j]
                        seg = o if (e == 0) == (lado == 1) else o[::-1]
                        linea = linea + seg[1:] if lado == 1 else seg[:-1] + linea
                        usados.add(j); extendio = True; cambio = True
                        break
                    if extendio: break
            nuevos.append(linea)
        tramos = nuevos
    return tramos

def dp(pts, tol):
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    pila = [(0, len(pts) - 1)]
    while pila:
        s, e = pila.pop()
        ax, ay = pts[s]; bx, by = pts[e]; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
        imax, dmax = -1, -1
        for i in range(s + 1, e):
            px, py = pts[i]
            # Distancia al SEGMENTO (no a la recta infinita): con extremos iguales
            # —anillos como la Circunvalación— la recta no existe y se perdía todo.
            t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
            d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > dmax: imax, dmax = i, d
        if dmax > tol: keep[imax] = True; pila += [(s, imax), (imax, e)]
    return [p for p, k in zip(pts, keep) if k]

def km(a, b):
    R = 6371; t = math.radians
    dlat = t(b[1] - a[1]); dlon = t(b[0] - a[0])
    h = math.sin(dlat / 2) ** 2 + math.cos(t(a[1])) * math.cos(t(b[1])) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

rutas = []; etiquetas = []; total = 0
for (ref, clase), tramos in grupos.items():
    for linea in unir(tramos):
        s = dp(linea, 0.0001)   # ~10 m: conserva curvas y accesos
        if len(s) < 2: continue
        largo = sum(km(s[i - 1], s[i]) for i in range(1, len(s)))
        if largo < 0.05: continue
        total += len(s)
        rutas.append({"t": clase, "r": ref, "c": [[round(y, 5), round(x, 5)] for x, y in s]})
        # Número de ruta: uno cada ~45 km de trazado (mín. uno por tramo de 8 km+).
        if ref and largo >= 8:
            n = max(1, int(largo // 45))
            objetivo = [largo * (k + 0.5) / n for k in range(n)]
            acum = 0; oi = 0
            for i in range(1, len(s)):
                d = km(s[i - 1], s[i])
                while oi < len(objetivo) and acum + d >= objetivo[oi]:
                    t = (objetivo[oi] - acum) / d if d else 0
                    x = s[i - 1][0] + (s[i][0] - s[i - 1][0]) * t; y = s[i - 1][1] + (s[i][1] - s[i - 1][1]) * t
                    etiquetas.append({"r": ref, "p": [round(y, 5), round(x, 5)], "t": clase})
                    oi += 1
                acum += d
# Un solo número por ruta cada ~20 km (las autopistas traen una línea por sentido).
filtradas = []
for e in sorted(etiquetas, key=lambda e: 0 if e["t"] == "principal" else 1):
    if any(o["r"] == e["r"] and km(o["p"][::-1], e["p"][::-1]) < 20 for o in filtradas): continue
    filtradas.append(e)
etiquetas = filtradas
json.dump({"fuente": "OpenStreetMap (ODbL) — motorway/trunk/primary, recortado a Córdoba", "rutas": rutas, "etiquetas": etiquetas},
          open(out, "w"), separators=(",", ":"), ensure_ascii=False)
print("líneas:", len(rutas), "puntos:", total, "etiquetas:", len(etiquetas), "refs:", len({r["r"] for r in rutas}))
