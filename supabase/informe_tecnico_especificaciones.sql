-- ============================================================================
-- Informe Técnico — Especificaciones técnicas comunes por renglón
-- ============================================================================
-- La lista de especificaciones se carga UNA vez por renglón y la comparten
-- todos los oferentes de ese renglón. Formato: array ordenado
--   [{ "id": "a1b2c3d", "label": "Tensión nominal 13,2 kV" }, ...]
--
-- El resultado de cada oferente (cumple / no cumple + comentario por
-- especificación, y sus notas propias) sigue viviendo en
-- licitacion_evaluaciones_tecnicas.observaciones, como JSON v2
-- (ver docs/informe-tecnico.md).
--
-- Idempotente: se puede correr más de una vez sin efectos secundarios.
-- No toca ni migra datos existentes.
ALTER TABLE licitacion_renglones
  ADD COLUMN IF NOT EXISTS especificaciones jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Refresca el cache de esquema de PostgREST para que la API vea la columna
-- sin esperar al reload automático.
NOTIFY pgrst, 'reload schema';
