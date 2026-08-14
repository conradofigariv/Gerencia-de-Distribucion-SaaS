import { supabase } from "@/lib/supabaseClient";

export interface CompraRow {
  articulo:     string;
  descArticulo: string;
  udmPrimaria:  string;
  enMano:       string;
  organizacion: string;
}

export interface ZonaUpload {
  zona:       string;
  rows:       CompraRow[];
  fileName:   string;
  uploadedAt: string;
}

export async function getUploads(): Promise<ZonaUpload[]> {
  const { data, error } = await supabase
    .from("stock_uploads")
    .select("zona, file_name, uploaded_at, rows")
    .order("uploaded_at", { ascending: false });
  if (error || !data) return [];
  return data.map(r => ({
    zona:       r.zona,
    fileName:   r.file_name,
    uploadedAt: r.uploaded_at,
    rows:       r.rows as CompraRow[],
  }));
}

export async function saveUpload(upload: ZonaUpload): Promise<string | null> {
  const { error } = await supabase
    .from("stock_uploads")
    .upsert(
      {
        zona:        upload.zona,
        file_name:   upload.fileName,
        uploaded_at: new Date().toISOString(),
        rows:        upload.rows,
      },
      { onConflict: "zona" }
    );
  return error?.message ?? null;
}

export async function removeUpload(zona: string): Promise<string | null> {
  const { error } = await supabase
    .from("stock_uploads")
    .delete()
    .eq("zona", zona);
  return error?.message ?? null;
}

export const COL_MAP: Record<keyof CompraRow, string> = {
  articulo:     "Artículo",
  descArticulo: "Desc Artículo",
  udmPrimaria:  "UDM Primaria",
  enMano:       "En Mano",
  organizacion: "Organización",
};

export function parseTSV(text: string): { rows: CompraRow[]; error?: string } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { rows: [], error: "El archivo no contiene datos suficientes." };

  const headers = lines[0].split("\t").map(h => h.trim());
  const indices = {} as Record<keyof CompraRow, number>;

  for (const [key, colName] of Object.entries(COL_MAP) as [keyof CompraRow, string][]) {
    const idx = headers.indexOf(colName);
    if (idx === -1) return { rows: [], error: `Columna no encontrada: "${colName}"` };
    indices[key] = idx;
  }

  // Normaliza para detectar encabezados repetidos (sin acentos, minúsculas).
  const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const articuloHdr = norm(COL_MAP.articulo);
  const orgHdr      = norm(COL_MAP.organizacion);

  const rows: CompraRow[] = lines.slice(1).map(line => {
    const cols = line.split("\t");
    return {
      articulo:     cols[indices.articulo]?.trim()     ?? "",
      descArticulo: cols[indices.descArticulo]?.trim() ?? "",
      udmPrimaria:  cols[indices.udmPrimaria]?.trim()  ?? "",
      enMano:       cols[indices.enMano]?.trim()       ?? "",
      organizacion: cols[indices.organizacion]?.trim() ?? "",
    };
  }).filter(r =>
    r.articulo &&
    // Descartar filas de encabezado repetidas al pegar varias zonas juntas
    // (la celda Artículo dice "Artículo" y la de Organización dice "Organización").
    norm(r.articulo) !== articuloHdr &&
    norm(r.organizacion) !== orgHdr
  );

  return { rows };
}

/**
 * Stock de una zona como mapa `matrícula normalizada → En Mano`.
 *
 * Lo usa el Buscador para mostrar el stock al lado de cada fila. Se cruza por
 * la matrícula NORMALIZADA (sin el sufijo `.0`) porque los dos lados vienen de
 * exports distintos: `stock_uploads` guarda el número crudo tal cual lo escupe
 * SIGA ("00000020.0") y el índice guarda las dos formas. Cruzar por el crudo
 * fallaría en cuanto un export traiga el sufijo y el otro no.
 *
 * `enMano` viene como texto y puede traer coma decimal y puntos de miles
 * (formato es-AR), así que no alcanza con Number().
 */
export async function getStockZonaMap(zona: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("stock_uploads")
    .select("rows")
    .eq("zona", zona)
    .maybeSingle();
  if (error || !data) return new Map();

  const map = new Map<string, number>();
  for (const r of ((data.rows ?? []) as CompraRow[])) {
    const key = String(r.articulo ?? "").trim().replace(/\.0+$/, "");
    if (!key) continue;
    let s = String(r.enMano ?? "").trim().replace(/\s/g, "");
    if (!s) continue;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    if (!Number.isFinite(n)) continue;
    // Una matrícula puede repetirse dentro de la misma zona (varios depósitos):
    // se acumula en vez de pisarse, que es lo que hace el Resumen de stock.
    map.set(key, (map.get(key) ?? 0) + n);
  }
  return map;
}
