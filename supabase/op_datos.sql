-- ============================================================================
-- Datos manuales de la OP (descripción y zona reales)
--
-- La planilla de OPs («Envíos») trae una fila por (OP, línea, envío) y su
-- columna de zona (`organizacion_envio`) NO es confiable. Además no trae
-- ninguna descripción de la OP en sí — la única descripción que llega es la de
-- la matrícula, que es otra cosa.
--
-- Esta tabla guarda lo que el usuario carga a mano, con UNA fila por OP:
--   • `descripcion` → de qué se trata la OP (sirve para saber de qué zona es)
--   • `zona`        → la zona REAL, que pisa a la de la planilla
--
-- ── Por qué una tabla aparte y no columnas en busqueda_index ────────────────
-- `busqueda_index` se BORRA Y RECREA entera en cada «Reconstruir»
-- (gd_reconstruir_busqueda). Cualquier dato cargado a mano ahí se perdería en
-- la primera reconstrucción. Por eso vive acá y el rebuild la hace LEFT JOIN,
-- exactamente el mismo patrón que ya usa `matricula_tipo` (el override manual
-- de Material/Servicio que se carga desde Stock por Zona).
--
-- ── Por qué no en las filas de las pestañas ─────────────────────────────────
-- Las filas de `buscador_tab_filas` son COPIAS congeladas y privadas de una
-- pestaña. Si la descripción viviera ahí habría que cargarla de nuevo en cada
-- pestaña donde aparezca esa OP, se perdería al borrar la pestaña y no la
-- vería nadie más. Acá se carga UNA vez por OP y la ven todos, en todas las
-- pestañas y en el índice maestro.
-- ============================================================================

CREATE TABLE IF NOT EXISTS op_datos (
  -- Número de OP tal cual se ve en la planilla. El cruce con el índice
  -- normaliza los dos lados con gd_norm_op(), así que da igual si acá quedó
  -- guardado con o sin el ".0" del export de Excel.
  numero_op   text PRIMARY KEY,
  descripcion text,
  zona        text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users
);

ALTER TABLE op_datos ENABLE ROW LEVEL SECURITY;

-- Dato de referencia compartido por todo el equipo (como matricula_tipo):
-- cualquier usuario autenticado lo lee y lo carga. No es información sensible
-- y el valor de tenerlo cargado supera al de restringir quién puede escribirlo.
DROP POLICY IF EXISTS "op_datos_authenticated" ON op_datos;
CREATE POLICY "op_datos_authenticated"
  ON op_datos
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON op_datos TO authenticated;
