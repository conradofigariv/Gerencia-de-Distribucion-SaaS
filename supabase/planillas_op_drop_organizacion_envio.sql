-- ============================================================================
-- Sacar `organizacion_envio` del sistema
--
-- La columna «Organización Envío» de la planilla de OPs («Envíos») no era
-- confiable y dejó de usarse: la Zona pasó a ser 100% manual, cargada por OP
-- en `op_datos` (ver op_datos.sql y docs/buscador.md).
--
-- `gd_reconstruir_busqueda()` (busqueda_global.sql) ya no la lee — este script
-- solo termina de sacarla de la tabla origen para que no quede un dato muerto
-- que nadie mira. La carga de la planilla (servicios-planillas.tsx) ya dejó de
-- escribirla.
-- ============================================================================

ALTER TABLE planillas_op DROP COLUMN IF EXISTS organizacion_envio;
