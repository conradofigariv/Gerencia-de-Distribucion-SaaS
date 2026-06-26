import { supabase } from "@/lib/supabaseClient";

// ─── Etiquetas de columna editables ──────────────────────────────────────────
//
// Permite renombrar visualmente los headers de una tabla SIN tocar la columna
// real (la clave del cubo). Solo cambia el texto que ve el usuario; el cruce de
// datos sigue usando `col` (ej. "fecha_pactada"). Persiste en Supabase para que
// el nombre sea compartido por todos los usuarios del sistema.
//
// Tabla: ui_column_labels(scope text, col text, label text, PRIMARY KEY(scope,col))
// Ver supabase/ui_column_labels.sql

// Mapa col → label (solo las columnas que el usuario renombró).
export type ColumnLabelMap = Record<string, string>;

// Detecta el caso "tabla todavía no creada" para degradar sin romper la UI.
function isTableMissing(message: string): boolean {
  return (
    message.includes("does not exist") ||
    message.includes("Invalid path") ||
    message.includes("schema cache") ||
    message.includes("Could not find the table")
  );
}

// Lee las etiquetas personalizadas de un scope (ej. "servicios-resumen").
// Devuelve {} si la tabla aún no existe o no hay overrides.
export async function getColumnLabels(scope: string): Promise<ColumnLabelMap> {
  const { data, error } = await supabase
    .from("ui_column_labels")
    .select("col, label")
    .eq("scope", scope);
  if (error) {
    if (!isTableMissing(error.message)) {
      console.error("getColumnLabels:", error.message);
    }
    return {};
  }
  const map: ColumnLabelMap = {};
  for (const r of (data ?? []) as { col: string; label: string }[]) {
    if (r.col && r.label) map[r.col] = r.label;
  }
  return map;
}

// Guarda (upsert) el nombre visible de una columna. Lanza si falla.
export async function saveColumnLabel(scope: string, col: string, label: string): Promise<void> {
  const { error } = await supabase
    .from("ui_column_labels")
    .upsert({ scope, col, label }, { onConflict: "scope,col" });
  if (error) throw new Error(error.message);
}

// Revierte una columna a su nombre por defecto (borra el override).
export async function resetColumnLabel(scope: string, col: string): Promise<void> {
  const { error } = await supabase
    .from("ui_column_labels")
    .delete()
    .eq("scope", scope)
    .eq("col", col);
  if (error) throw new Error(error.message);
}

// Borra todos los overrides de un scope (restaurar todos los nombres).
export async function resetAllColumnLabels(scope: string): Promise<void> {
  const { error } = await supabase
    .from("ui_column_labels")
    .delete()
    .eq("scope", scope);
  if (error) throw new Error(error.message);
}
