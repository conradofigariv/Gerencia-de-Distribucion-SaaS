"""Zonas oficiales de EPEC (KMZ «Zonas») → public/geo/cordoba.json.

Uso (requiere shapely: pip install shapely):
    python3 scripts/zonas-kmz.py Zonas.kmz public/geo/cordoba.json public/geo/cordoba.json

El KMZ trae un polígono por zona: «Zona A» … «Zona H» y «Zona I» (= B Sur).
«Zona B» es B Norte. Se recortan al contorno de la provincia (unión de los
departamentos IGN que ya trae cordoba.json) y se limpian:
  - solapes chicos entre zonas vecinas (trazado a mano): gana la primera en ORDEN;
  - huecos < 200 km² entre zonas o contra el borde: pasan a la vecina con más
    borde compartido; los grandes (laguna Mar Chiquita, salinas) quedan sin zona;
  - astillas < 5 km² y agujeros < 200 km² fuera.
Escribe `zonas` (polígonos por unidad), `bordesZona` (A, B, C…H), `divisorias.B`
(BN / BS) y `contorno` (borde exterior de la provincia).
"""
import sys, json, zipfile, xml.etree.ElementTree as ET
from shapely.geometry import Polygon
from shapely.ops import unary_union, linemerge

KML = "{http://www.opengis.net/kml/2.2}"
CODIGO = {"A": "A", "B": "BN", "I": "BS", "C": "C", "D": "D", "E": "E", "F": "F", "G": "G", "H": "H"}
ORDEN = ["A", "BS", "BN", "C", "D", "E", "F", "G", "H"]
KM2 = 111 * 94.5  # grados² → km² a la latitud de Córdoba


def partes(g):
    return list(g.geoms) if hasattr(g, "geoms") else ([g] if not g.is_empty else [])


def leer_kmz(path):
    kml = zipfile.ZipFile(path).read("doc.kml")
    zonas = {}
    for pm in ET.fromstring(kml).iter(KML + "Placemark"):
        letra = pm.find(KML + "name").text.split()[-1]
        polys = []
        for poly in pm.iter(KML + "Polygon"):
            anillos = [[tuple(map(float, c.split(",")[:2])) for c in lr.text.split()]
                       for lr in poly.iter(KML + "coordinates")]
            polys.append(Polygon(anillos[0], anillos[1:]).buffer(0))
        zonas[CODIGO[letra]] = unary_union(polys)
    return zonas


def main(kmz, geo_in, geo_out):
    Z = leer_kmz(kmz)
    g = json.load(open(geo_in))
    prov = unary_union([Polygon([(lo, la) for la, lo in d["ring"]]).buffer(0) for d in g["departamentos"]])
    # Los anillos de departamento no calzan perfecto: ranuras y agujeros de la unión fuera.
    prov = prov.buffer(0.003, join_style=2).buffer(-0.003, join_style=2)
    prov = unary_union([Polygon(p.exterior) for p in partes(prov)])

    R, usado = {}, None
    for k in ORDEN:
        p = Z[k].intersection(prov)
        if usado is not None:
            p = p.difference(usado)
        R[k] = p
        usado = p if usado is None else unary_union([usado, p])
    for p in partes(prov.difference(unary_union(list(R.values())))):
        if p.area * KM2 >= 200:
            print("hueco sin zona: %d km² en %s" % (p.area * KM2, [round(c, 2) for c in p.representative_point().coords[0]]))
            continue
        k = max(ORDEN, key=lambda k: p.buffer(0.001).intersection(R[k]).area)
        if p.buffer(0.001).intersection(R[k]).area > 0:
            R[k] = unary_union([R[k], p])
    for k in ORDEN:
        ps = []
        for p in partes(R[k].buffer(0)):
            if p.area * KM2 >= 5:
                ps.append(Polygon(p.exterior, [h for h in p.interiors if Polygon(h).area * KM2 >= 200]))
        R[k] = unary_union(ps)
        print("%-2s %6d km²" % (k, R[k].area * KM2))

    rnd = lambda cs: [[round(y, 4), round(x, 4)] for x, y in cs]
    bordes = lambda geom: [rnd(r.coords) for p in partes(geom) for r in [p.exterior, *p.interiors]]
    g["zonas"] = {k: [[rnd(p.exterior.coords)] + [rnd(h.coords) for h in p.interiors] for p in partes(R[k])] for k in ORDEN}
    g["bordesZona"] = {k: bordes(R[k]) for k in ORDEN if k not in ("BN", "BS")}
    g["bordesZona"]["B"] = bordes(unary_union([R["BN"], R["BS"]]).buffer(0))
    div = linemerge(partes(R["BN"].boundary.intersection(R["BS"].buffer(1e-6))))
    g["divisorias"] = {"B": [rnd(l.coords) for l in partes(div) if l.length > 0.01]}
    g["contorno"] = [rnd(p.exterior.coords) for p in partes(prov) if p.area * KM2 > 50]
    json.dump(g, open(geo_out, "w"), separators=(",", ":"))


if __name__ == "__main__":
    main(*sys.argv[1:4])
