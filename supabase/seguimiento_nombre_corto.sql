-- ============================================================================
-- Nombre Corto: alias editable por línea de seguimiento, para identificar
-- filas rápido en la Lista de seguimiento y el Resumen (Control de servicios).
-- No participa del cruce del cubo — es solo un campo manual.
-- ============================================================================

ALTER TABLE seguimiento ADD COLUMN IF NOT EXISTS nombre_corto text;
