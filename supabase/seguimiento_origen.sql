-- ============================================================================
-- Origen de cada fila de `seguimiento`: distingue la carga masiva (SICs de
-- Soler) de la carga manual (casos especiales de OP sin SIC de Soler).
--
-- Permite que al recargar la masiva se pueda "reemplazar solo las SICs de
-- Soler" conservando los casos manuales. Las filas legadas quedan con origen
-- NULL y se tratan como masivas (se reemplazan al recargar).
-- ============================================================================

ALTER TABLE seguimiento
  ADD COLUMN IF NOT EXISTS origen text;   -- 'sic' | 'manual' | null (legado)
