// Población de las localidades de Córdoba para el mapa de Stock por Zona
// (tamaño de los puntos y desde qué zoom se ve el nombre).
//
// Fuente: GeoNames (CC BY 4.0) vía el paquete npm `all-the-cities` (localidades
// de ≥ 1000 habitantes). Las cifras son en su mayoría del censo 2010 — si se
// consigue el censo 2022 por localidad (INDEC), reemplazar el JSON con el mismo
// formato: [nombre, lat, lon, poblacion].
//
// Uso:  npm pack all-the-cities && tar -xzf all-the-cities-*.tgz
//       (en otra carpeta) npm install pbf@3
//       node scripts/poblacion-geonames.js package/cities.pbf public/geo/poblacion-cordoba.json
const Pbf = require("pbf");
const fs = require("fs");

const pbf = new Pbf(fs.readFileSync(process.argv[2]));
let lat = 0;
let lon = 0;
const out = [];
while (pbf.pos < pbf.length) {
  const c = pbf.readMessage((tag, c, p) => {
    if (tag === 2) c.name = p.readString();
    else if (tag === 3) c.country = p.readString();
    else if (tag === 8) c.admin = p.readString();
    else if (tag === 9) c.pob = p.readVarint();
    else if (tag === 10) { lon += p.readSVarint(); c.lon = lon / 1e5; }
    else if (tag === 11) { lat += p.readSVarint(); c.lat = lat / 1e5; }
    else if (tag === 1) p.readSVarint();
    else p.readString();
  }, {});
  // admin1 «05» = provincia de Córdoba en GeoNames.
  if (c.country === "AR" && c.admin === "05" && c.pob > 0) out.push([c.name, c.lat, c.lon, c.pob]);
}
out.sort((a, b) => b[3] - a[3]);
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.log(out.length, "localidades");
