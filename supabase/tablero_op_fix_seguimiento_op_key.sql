-- ============================================================================
-- Tablero OP — fix: la clave única del seguimiento es (numero_sic, linea,
-- numero_op), NO (numero_sic, linea).
--
-- Una misma línea de una SIC puede estar cubierta por VARIAS OPs (ampliación /
-- recompra / recontratación). En SIGA cada combinación (SIC, línea, OP) es una
-- fila distinta del seguimiento. La versión anterior usaba UNIQUE
-- (numero_sic, linea), que COLAPSABA la dimensión OP: al hacer upsert, dos
-- filas con la misma (SIC, línea) pero distinta OP se pisaban entre sí y solo
-- sobrevivía una. Eso rompía el cruce con las transacciones: una transacción
-- de la OP X sobre la línea "3,1" no encontraba su fila de seguimiento porque
-- esa (línea, OP) se había descartado.
--
-- Esta migración cambia la clave única a (numero_sic, linea, numero_op).
-- NULLS NOT DISTINCT: las filas manuales sin OP (numero_op NULL) se consideran
-- iguales entre sí para una misma (SIC, línea), evitando duplicados.
-- Idempotente: se puede correr aunque ya esté migrada.
--
-- ⚠ DESPUÉS de correr esto hay que RE-IMPORTAR el seguimiento (volver a pegar el
--   export de SIGA), porque las filas (línea, OP) que se habían perdido con la
--   clave vieja no están en la base — el re-import las vuelve a insertar.
-- ============================================================================

-- Quita la clave vieja (numero_sic, linea) si existe.
ALTER TABLE tablero_op_seguimiento DROP CONSTRAINT IF EXISTS tablero_op_seguimiento_sic_linea_key;

-- Clave real: (numero_sic, linea, numero_op), tratando NULL como un único valor.
ALTER TABLE tablero_op_seguimiento DROP CONSTRAINT IF EXISTS tablero_op_seguimiento_sic_linea_op_key;
ALTER TABLE tablero_op_seguimiento
  ADD CONSTRAINT tablero_op_seguimiento_sic_linea_op_key
  UNIQUE NULLS NOT DISTINCT (numero_sic, linea, numero_op);

-- Índice para el cruce/filtro por numero_sic (ya no es PK).
CREATE INDEX IF NOT EXISTS idx_tablero_op_seguimiento_numero_sic ON tablero_op_seguimiento (numero_sic);
