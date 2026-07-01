/**
 * Migra el modelo viejo de familias (etiquetas en `stock_article_families`)
 * al modelo nuevo de entidad:
 *   stock_article_families.familia (array JSON) → familias + familia_matriculas
 *   stock_article_families.tipo                 → matricula_tipo
 *
 * Es IDEMPOTENTE: se puede correr varias veces sin duplicar (usa upsert /
 * onConflict). NO borra la tabla vieja.
 *
 * Requisitos:
 *   1. Correr antes el SQL de supabase/familias.sql (crea las tablas).
 *   2. Tener en .env.local:
 *        NEXT_PUBLIC_SUPABASE_URL=...
 *        NEXT_PUBLIC_SUPABASE_ANON_KEY=...   (o SUPABASE_SERVICE_ROLE_KEY)
 *
 * Uso:  node scripts/migrate-familias.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// ── Carga simple de .env.local (sin dependencia de dotenv) ───────────────────
function loadEnv(path = ".env.local") {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch { /* sin .env.local: se usan las env del proceso */ }
}
loadEnv();

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local");
  process.exit(1);
}

const supabase = createClient(url, key);

/** Parsea la columna `familia` vieja (array JSON nuevo o texto plano legado). */
function parseFamilias(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return [...new Set(arr.map(x => String(x).trim()).filter(Boolean))];
    } catch { /* cae a texto plano */ }
  }
  return [s];
}

function normalizeTipo(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.startsWith("s")) return "servicio";
  if (s.startsWith("m")) return "material";
  return null;
}

async function main() {
  console.log("Leyendo stock_article_families…");
  const { data: viejas, error } = await supabase
    .from("stock_article_families")
    .select("articulo, familia, tipo");
  if (error) { console.error("Error al leer:", error.message); process.exit(1); }
  console.log(`  ${viejas.length} filas.`);

  // 1) Familias únicas
  const nombresFamilia = new Set();
  const tipoOverrides = [];
  const asignacionesPorNombre = new Map(); // nombre → Set<articulo>

  for (const row of viejas) {
    const fams = parseFamilias(row.familia);
    for (const f of fams) {
      nombresFamilia.add(f);
      if (!asignacionesPorNombre.has(f)) asignacionesPorNombre.set(f, new Set());
      asignacionesPorNombre.get(f).add(row.articulo);
    }
    const tipo = normalizeTipo(row.tipo);
    if (tipo) tipoOverrides.push({ articulo: row.articulo, tipo });
  }

  console.log(`Familias únicas: ${nombresFamilia.size} · overrides de tipo: ${tipoOverrides.length}`);

  // 2) Upsert de familias
  if (nombresFamilia.size > 0) {
    const { error: e1 } = await supabase
      .from("familias")
      .upsert([...nombresFamilia].map(nombre => ({ nombre })), { onConflict: "nombre", ignoreDuplicates: true });
    if (e1) { console.error("Error al crear familias:", e1.message); process.exit(1); }
  }

  // 3) Releer familias para obtener sus ids
  const { data: familias, error: e2 } = await supabase.from("familias").select("id, nombre");
  if (e2) { console.error("Error al releer familias:", e2.message); process.exit(1); }
  const idPorNombre = new Map(familias.map(f => [f.nombre, f.id]));

  // 4) Asignaciones
  const asignaciones = [];
  for (const [nombre, articulos] of asignacionesPorNombre) {
    const familia_id = idPorNombre.get(nombre);
    if (!familia_id) continue;
    for (const articulo of articulos) asignaciones.push({ familia_id, articulo });
  }
  console.log(`Asignaciones a insertar: ${asignaciones.length}`);
  for (let i = 0; i < asignaciones.length; i += 500) {
    const chunk = asignaciones.slice(i, i + 500);
    const { error: e3 } = await supabase
      .from("familia_matriculas")
      .upsert(chunk, { onConflict: "familia_id,articulo", ignoreDuplicates: true });
    if (e3) { console.error("Error al asignar:", e3.message); process.exit(1); }
  }

  // 5) Overrides de tipo
  if (tipoOverrides.length > 0) {
    for (let i = 0; i < tipoOverrides.length; i += 500) {
      const chunk = tipoOverrides.slice(i, i + 500);
      const { error: e4 } = await supabase
        .from("matricula_tipo")
        .upsert(chunk, { onConflict: "articulo", ignoreDuplicates: false });
      if (e4) { console.error("Error al migrar tipos:", e4.message); process.exit(1); }
    }
  }

  console.log("✓ Migración completa.");
}

main();
