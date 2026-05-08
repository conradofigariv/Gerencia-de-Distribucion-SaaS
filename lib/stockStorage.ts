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

  const rows: CompraRow[] = lines.slice(1).map(line => {
    const cols = line.split("\t");
    return {
      articulo:     cols[indices.articulo]?.trim()     ?? "",
      descArticulo: cols[indices.descArticulo]?.trim() ?? "",
      udmPrimaria:  cols[indices.udmPrimaria]?.trim()  ?? "",
      enMano:       cols[indices.enMano]?.trim()       ?? "",
      organizacion: cols[indices.organizacion]?.trim() ?? "",
    };
  }).filter(r => r.articulo);

  return { rows };
}
