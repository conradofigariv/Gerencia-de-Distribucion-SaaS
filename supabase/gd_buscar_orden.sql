-- ============================================================================
-- gd_buscar — ordenamiento del lado del SERVIDOR (p_orden / p_dir)
--
-- Migración chica y autocontenida: solo redefine la función de búsqueda. NO
-- toca `busqueda_index` ni obliga a reconstruir el índice.
--
-- ── El problema que arregla ─────────────────────────────────────────────────
-- El índice maestro del Buscador traía como máximo `p_limite` filas (500 por
-- defecto) de las 112k+ del índice, y el orden al tocar un header se hacía
-- ENTERO del lado del cliente sobre esas 500.
--
-- O sea: ordenar por «F. pactada» no daba la fecha más vieja del índice, daba
-- la más vieja de las 500 filas que hubiera devuelto la consulta. El LIMIT se
-- aplicaba ANTES del orden elegido, así que el orden operaba sobre un recorte
-- arbitrario. En una pestaña no pasa (ahí todas las filas ya están en el
-- cliente), por eso el síntoma era solo del maestro.
--
-- Ahora el ORDER BY viaja a la consulta y el LIMIT queda DESPUÉS: Postgres
-- ordena las 112k y recorta el top-N real.
--
-- ── Inyección ───────────────────────────────────────────────────────────────
-- ⚠ `orden_col` y `dir` NO se concatenan desde la entrada del usuario. Salen
--   de un CASE sobre literales fijos (whitelist estricta); cualquier valor
--   desconocido de p_orden cae al ELSE y deja el orden por defecto de siempre.
--   `p_dir` se colapsa a exactamente 'ASC' o 'DESC'. El texto buscado y el
--   límite siguen viajando como parámetros ($1, $2…), nunca interpolados.
--
-- ── Fechas ──────────────────────────────────────────────────────────────────
-- Las columnas de fecha que en el índice son TEXTO no se ordenan por el texto
-- crudo: conviven el formato ISO y el `Date.toString()` de los imports viejos,
-- y alfabéticamente termina ordenando por el nombre del día (mismo motivo por
-- el que existe gd_parse_fecha). Se mapean a su versión `date`:
--   fecha_creacion     → fecha_creacion_d
--   fecha_pactada      → fecha_pactada_d
--   sic_fecha_creacion → gd_parse_fecha(sic_fecha_creacion)   (no tiene _d)
-- `tx_primera_fecha` y `tx_ultima_fecha` ya son `date` en el índice.
--
-- NULLS LAST siempre, en las dos direcciones: es lo que ya hacía el
-- comparador del cliente (las filas sin dato van al final, se ordene como se
-- ordene), y así el resultado no cambia de criterio según la dirección.
--
-- ⚠ `stock_za` NO se puede ordenar acá: no es una columna del índice, se cruza
--   en el cliente contra stock_uploads después de traer las filas. El frontend
--   no manda p_orden para esa columna y la sigue ordenando del lado del
--   cliente (sobre lo cargado, que es la limitación que esa columna ya tenía).
--
-- Se borran TODAS las firmas anteriores antes de crear la nueva: Postgres
-- trata cada aridad como una sobrecarga distinta, así que sin los DROP
-- quedarían conviviendo la de 4 y la de 6 argumentos, y PostgREST podría
-- elegir cualquiera.
-- ============================================================================

DROP FUNCTION IF EXISTS gd_buscar(text, integer);
DROP FUNCTION IF EXISTS gd_buscar(text, integer, text);
DROP FUNCTION IF EXISTS gd_buscar(text, integer, text, boolean);
DROP FUNCTION IF EXISTS gd_buscar(text, integer, text, boolean, text, text);

CREATE FUNCTION gd_buscar(
  p_q        text,
  p_limite   integer DEFAULT 500,
  p_campo    text    DEFAULT NULL,
  p_solo_sic boolean DEFAULT false,
  p_orden    text    DEFAULT NULL,
  p_dir      text    DEFAULT 'asc'
)
RETURNS SETOF busqueda_index
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  q         text := gd_norm_texto(COALESCE(p_q, ''));
  col       text;
  filtro    text;
  orden_col text;
  dir       text;
  order_by  text;
BEGIN
  -- Columna contra la que se busca. Whitelist estricta: todo lo que no esté
  -- acá cae en `busqueda`, la columna agregada con índice GIN.
  col := CASE p_campo
           WHEN 'numero_sic'     THEN 'gd_norm_texto(numero_sic)'
           WHEN 'sic_preparador' THEN 'gd_norm_texto(sic_preparador)'
           WHEN 'numero_op'      THEN 'gd_norm_texto(numero_op)'
           WHEN 'articulo'       THEN 'gd_norm_texto(articulo)'
           WHEN 'descripcion'    THEN 'gd_norm_texto(descripcion)'
           ELSE 'busqueda'
         END;

  -- Universo: «SICs de Soler» acota a las filas con SIC. Es independiente del
  -- texto buscado, así que se combina con cualquier búsqueda encima.
  filtro := '(NOT $3 OR numero_sic IS NOT NULL)';

  -- Con la caja vacía no se filtra por texto: se devuelve el índice ordenado
  -- por OP más nueva (pantalla de entrada del Buscador).
  IF q <> '' THEN
    filtro := filtro || ' AND ' || col || ' LIKE ''%'' || $1 || ''%''';
  END IF;

  -- Columna por la que ordenar. Whitelist estricta, misma idea que `col`.
  orden_col := CASE p_orden
                 -- Matrícula (catálogo)
                 WHEN 'articulo'            THEN 'articulo'
                 WHEN 'descripcion'         THEN 'descripcion'
                 WHEN 'tipo'                THEN 'tipo'
                 WHEN 'mat_serv'            THEN 'mat_serv'
                 WHEN 'estado_matricula'    THEN 'estado_matricula'
                 WHEN 'unidad_medida'       THEN 'unidad_medida'
                 -- SIC
                 WHEN 'numero_sic'          THEN 'numero_sic'
                 WHEN 'sic_linea'           THEN 'sic_linea'
                 WHEN 'sic_cantidad'        THEN 'sic_cantidad'
                 WHEN 'sic_udm'             THEN 'sic_udm'
                 WHEN 'sic_preparador'      THEN 'sic_preparador'
                 WHEN 'sic_fecha_creacion'  THEN 'gd_parse_fecha(sic_fecha_creacion)'
                 -- Compra (OP)
                 WHEN 'relacion'            THEN 'relacion'
                 WHEN 'numero_op'           THEN 'numero_op'
                 WHEN 'linea'               THEN 'linea'
                 WHEN 'envio'               THEN 'envio'
                 WHEN 'proveedor'           THEN 'proveedor'
                 WHEN 'op_descripcion'      THEN 'op_descripcion'
                 WHEN 'zona'                THEN 'zona'
                 -- Cantidades
                 WHEN 'cantidad'            THEN 'cantidad'
                 WHEN 'cantidad_recibida'   THEN 'cantidad_recibida'
                 WHEN 'ctd_aceptada'        THEN 'ctd_aceptada'
                 WHEN 'pendiente'           THEN 'pendiente'
                 WHEN 'cantidad_vencida'    THEN 'cantidad_vencida'
                 WHEN 'cantidad_rechazada'  THEN 'cantidad_rechazada'
                 WHEN 'cantidad_facturada'  THEN 'cantidad_facturada'
                 WHEN 'cantidad_cancelada'  THEN 'cantidad_cancelada'
                 -- Fechas y estados de la OP
                 WHEN 'fecha_creacion'      THEN 'fecha_creacion_d'
                 WHEN 'fecha_pactada'       THEN 'fecha_pactada_d'
                 WHEN 'estado_autorizacion' THEN 'estado_autorizacion'
                 WHEN 'estado_cierre'       THEN 'estado_cierre'
                 -- Movimientos
                 WHEN 'tx_recibido'         THEN 'tx_recibido'
                 WHEN 'tx_aceptado'         THEN 'tx_aceptado'
                 WHEN 'tx_entregado'        THEN 'tx_entregado'
                 WHEN 'tx_devoluciones'     THEN 'tx_devoluciones'
                 WHEN 'tx_movimientos'      THEN 'tx_movimientos'
                 WHEN 'tx_primera_fecha'    THEN 'tx_primera_fecha'
                 WHEN 'tx_ultima_fecha'     THEN 'tx_ultima_fecha'
                 ELSE NULL
               END;

  dir := CASE WHEN lower(COALESCE(p_dir, 'asc')) = 'desc' THEN 'DESC' ELSE 'ASC' END;

  IF orden_col IS NULL THEN
    -- Sin columna elegida (o una desconocida): el orden de siempre.
    order_by :=
      -- Sin búsqueda: las OP más nuevas primero. Con texto buscado este CASE
      -- da NULL en todas las filas y NULLS LAST no mueve nada, así que el
      -- orden por relevancia de abajo queda intacto.
      'CASE WHEN $1 = '''' THEN fecha_creacion_d END DESC NULLS LAST,
       (articulo_key = gd_norm_articulo($4)) DESC,
       (numero_op    = trim(COALESCE($4, ''''))) DESC,
       CASE fuente
         WHEN ''op''          THEN 0
         WHEN ''transaccion'' THEN 1
         ELSE 2
       END,
       numero_op,
       linea,
       envio';
  ELSE
    -- Con columna elegida manda ella. Se desempata por (OP, línea, envío) para
    -- que el orden sea estable: sin eso, dos filas con el mismo valor pueden
    -- salir en cualquier orden entre una consulta y la siguiente, y la tabla
    -- "baila" al repaginar.
    order_by := orden_col || ' ' || dir || ' NULLS LAST, numero_op, linea, envio';
  END IF;

  RETURN QUERY EXECUTE
    'SELECT * FROM busqueda_index WHERE ' || filtro || ' ORDER BY ' || order_by || ' LIMIT $2'
    USING q, COALESCE(p_limite, 500), p_solo_sic, p_q;
END;
$$;

GRANT EXECUTE ON FUNCTION gd_buscar(text, integer, text, boolean, text, text) TO anon, authenticated;

-- PostgREST cachea la lista de funciones. Sin esto puede seguir respondiendo
-- «not found in the schema cache» aunque la función ya exista.
NOTIFY pgrst, 'reload schema';
