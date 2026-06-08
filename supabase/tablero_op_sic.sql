-- ============================================================================
-- Tablero OP — revertir tabla tablero_op_sic (paso descartado).
--
-- Esta tabla se creó sobre un malentendido: se interpretó que "SIC a seguir"
-- iba a pegar solo NÚMEROS de SIC y cruzarlos contra una planilla maestra
-- aparte. NO es así — "SIC a seguir" pega directamente las filas de
-- seguimiento (Número · Línea · Artículo · Descripción · Cantidad · UDM ·
-- Ctd Entregada · Número Pedido), tal cual las exporta el sistema (que trae
-- columnas extra calculadas que se descartan por nombre al importar).
--
-- Si llegaste a correr la versión anterior de este archivo (que CREABA
-- tablero_op_sic), corré este script para eliminarla. Es seguro ejecutarlo
-- aunque la tabla nunca se haya creado (idempotente).
-- ============================================================================

DROP TRIGGER IF EXISTS trg_tablero_op_sic_updated_at ON tablero_op_sic;
DROP TABLE IF EXISTS tablero_op_sic;
