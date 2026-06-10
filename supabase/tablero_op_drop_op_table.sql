-- ============================================================================
-- Tablero OP — eliminar tabla tablero_op_op (pestaña "OP's").
--
-- Esa pestaña era un import manual opcional de líneas de OP, pero nunca se
-- usó en el cruce de gd_tablero(): el proveedor sale de planillas_op
-- (planilla OP de «Carga de datos») y de tablero_op_transaccion. Las filas
-- del Resumen salen únicamente de tablero_op_seguimiento. Casos especiales
-- de SIC/OP se cargan ahí mismo (es upsert incremental, no se pisan).
--
-- Se elimina la tabla y sus dependencias (trigger, índices, policy).
-- Idempotente.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_tablero_op_op_updated_at ON tablero_op_op;
DROP POLICY  IF EXISTS "tablero_op_op_all" ON tablero_op_op;
DROP TABLE   IF EXISTS tablero_op_op;
