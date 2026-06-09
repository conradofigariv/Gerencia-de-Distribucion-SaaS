-- ============================================================================
-- Índice en planillas_op(numero) para el cruce de proveedor de gd_tablero.
--
-- planillas_op se carga desde «Carga de datos» (sección OP). gd_tablero la usa
-- para resolver el proveedor por OP. El join es por `numero` (text), así que
-- este índice evita un seq scan de toda la planilla por cada OP del seguimiento.
-- Idempotente.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_planillas_op_numero ON planillas_op (numero);
