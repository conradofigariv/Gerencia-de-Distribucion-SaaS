-- ============================================================================
-- Carga manual de "Crear seguimiento": ahora solo la OP es obligatoria.
-- Línea y matrícula son opcionales (si no se indican, se traen todas las líneas
-- de la OP desde planillas_op). Permitir NULL en esas columnas.
-- ============================================================================

ALTER TABLE filas_manuales ALTER COLUMN linea     DROP NOT NULL;
ALTER TABLE filas_manuales ALTER COLUMN matricula DROP NOT NULL;
