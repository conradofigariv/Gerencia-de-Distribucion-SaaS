-- ============================================================================
-- Fix: la columna `linea` de `seguimiento` (y `filas_manuales`) debe aceptar
-- decimales. Las líneas de SIC/OP pueden ser sub-ítems de renglón (ej. 10.1,
-- 3.1, 1.0303), no solo enteros. Con la columna en integer, guardar "10.1"
-- falla con: invalid input syntax for type integer: "10.1".
--
-- Cambia el tipo a numeric (preserva el decimal y sigue funcionando para los
-- valores enteros existentes).
-- ============================================================================

ALTER TABLE seguimiento
  ALTER COLUMN linea TYPE numeric USING NULLIF(linea::text, '')::numeric;

-- La carga manual también puede recibir líneas decimales.
ALTER TABLE filas_manuales
  ALTER COLUMN linea TYPE numeric USING NULLIF(linea::text, '')::numeric;
