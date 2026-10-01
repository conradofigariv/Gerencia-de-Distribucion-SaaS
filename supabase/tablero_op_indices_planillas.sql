-- ============================================================================
-- Índice en planillas_op(numero).
--
-- planillas_op se carga desde «Carga de datos» (sección OP). Los cruces por
-- número de OP (join por `numero`, text) evitan así un seq scan de toda la
-- planilla. Nació para gd_tablero (sección Tablero OP, ya eliminada); se deja
-- porque el índice sirve a cualquier búsqueda por OP y no molesta.
-- Idempotente.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_planillas_op_numero ON planillas_op (numero);
