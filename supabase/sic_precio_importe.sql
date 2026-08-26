-- ============================================================================
-- SIC: agregar Precio e Importe
--
-- La planilla de SIC (cargada desde "Carga de datos") trae Precio e Importe
-- además de Cantidad. Se agregan como columnas nuevas de punta a punta:
--   seguimiento_sic_soler (fuente) → busqueda_index (índice) → gd_buscar
-- (orden del lado del servidor).
--
-- Migración chica: solo agrega columnas y redefine gd_reconstruir_busqueda()
-- y gd_buscar() para que las lean/expongan. No borra nada. Después de
-- correrla hay que reconstruir el índice desde el Buscador ("Reconstruir")
-- para que las filas ya cargadas también muestren precio/importe.
-- ============================================================================

ALTER TABLE seguimiento_sic_soler ADD COLUMN IF NOT EXISTS precio  numeric;
ALTER TABLE seguimiento_sic_soler ADD COLUMN IF NOT EXISTS importe numeric;

ALTER TABLE busqueda_index ADD COLUMN IF NOT EXISTS sic_precio  numeric;
ALTER TABLE busqueda_index ADD COLUMN IF NOT EXISTS sic_importe numeric;

-- ─── gd_reconstruir_busqueda — redefinición completa con precio/importe ────
CREATE OR REPLACE FUNCTION gd_reconstruir_busqueda()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  total integer;
BEGIN
  DELETE FROM busqueda_index WHERE true;

  CREATE TEMP TABLE _cat ON COMMIT DROP AS
    SELECT DISTINCT ON (k) k, articulo, descripcion, unidad_medida, estado, mat_serv
      FROM (
        SELECT gd_norm_articulo(articulo) AS k, articulo, descripcion,
               unidad_medida, estado, mat_serv
          FROM matriculas
      ) x
     ORDER BY k;
  CREATE INDEX ON _cat (k);

  CREATE TEMP TABLE _tipo ON COMMIT DROP AS
    SELECT DISTINCT ON (k) k, tipo
      FROM (SELECT gd_norm_articulo(articulo) AS k, tipo FROM matricula_tipo) x
     ORDER BY k;
  CREATE INDEX ON _tipo (k);

  CREATE TEMP TABLE _opd ON COMMIT DROP AS
    SELECT DISTINCT ON (k) k, descripcion, zona
      FROM (SELECT gd_norm_op(numero_op) AS k, descripcion, zona FROM op_datos) x
     WHERE k IS NOT NULL
     ORDER BY k;
  CREATE INDEX ON _opd (k);

  CREATE TEMP TABLE _tx ON COMMIT DROP AS
    SELECT
      gd_norm_op(numero_pedido::text)         AS numero_op,
      gd_norm_articulo(articulo)              AS k,
      COALESCE(gd_norm_linea(linea), '')      AS linea_k,
      SUM(CASE WHEN tipo = 'Recibir'  THEN importe ELSE 0 END) AS recibido,
      SUM(CASE WHEN tipo = 'Aceptar'  THEN importe ELSE 0 END) AS aceptado,
      SUM(CASE WHEN tipo = 'Entregar' THEN importe ELSE 0 END) AS entregado,
      SUM(CASE WHEN tipo IN (
            'Rechazar', 'Devolver a Proveedor', 'Devolver a Recepción', 'Corregir'
          ) THEN importe ELSE 0 END) AS devoluciones,
      COUNT(*)::integer  AS movimientos,
      MIN(fecha)::date   AS primera_fecha,
      MAX(fecha)::date   AS ultima_fecha,
      (array_agg(proveedor ORDER BY fecha)
         FILTER (WHERE proveedor IS NOT NULL AND proveedor <> ''))[1] AS proveedor
    FROM tablero_op_transaccion
    GROUP BY 1, 2, 3;
  CREATE INDEX ON _tx (numero_op, k, linea_k);

  CREATE TEMP TABLE _op_rows ON COMMIT DROP AS
    SELECT DISTINCT
           gd_norm_op(numero)                AS numero_op,
           gd_norm_articulo(articulo)        AS k,
           COALESCE(gd_norm_linea(linea), '') AS linea_k
      FROM planillas_op;
  CREATE INDEX ON _op_rows (numero_op, k, linea_k);

  -- SIC normalizada — ahora también trae precio e importe.
  CREATE TEMP TABLE _sic ON COMMIT DROP AS
    SELECT DISTINCT ON (dedup_k, art_k)
           op_k, art_k, numero_sic, linea, cantidad, precio, importe, udm,
           preparador, fecha_creacion, descripcion
      FROM (
        SELECT gd_norm_op(numero_op)        AS op_k,
               gd_norm_articulo(articulo)   AS art_k,
               COALESCE(gd_norm_op(numero_op),
                        numero_sic || '|' || COALESCE(linea, '')) AS dedup_k,
               numero_sic,
               linea,
               cantidad,
               precio,
               importe,
               udm,
               preparador,
               fecha_creacion,
               descripcion
          FROM seguimiento_sic_soler
      ) s
     ORDER BY dedup_k, art_k, numero_sic;
  CREATE INDEX ON _sic (op_k, art_k);

  CREATE TEMP TABLE _op_art ON COMMIT DROP AS
    SELECT DISTINCT gd_norm_op(numero) AS op_k, gd_norm_articulo(articulo) AS art_k
      FROM planillas_op;
  CREATE INDEX ON _op_art (op_k, art_k);

  CREATE TEMP TABLE _env_count ON COMMIT DROP AS
    SELECT gd_norm_op(numero)                 AS numero_op,
           COALESCE(gd_norm_linea(linea), '') AS linea_k,
           COUNT(*)::integer                  AS n
      FROM planillas_op
     GROUP BY 1, 2;
  CREATE INDEX ON _env_count (numero_op, linea_k);

  CREATE TEMP TABLE _op_keys ON COMMIT DROP AS
    SELECT DISTINCT gd_norm_articulo(articulo) AS k FROM planillas_op
    UNION
    SELECT DISTINCT k FROM _tx;
  CREATE INDEX ON _op_keys (k);

  -- 1) Una fila por (OP, línea, envío), enriquecida con el catálogo.
  INSERT INTO busqueda_index (
    fuente, articulo, articulo_key, descripcion, unidad_medida, estado_matricula,
    tipo, mat_serv, en_catalogo,
    numero_sic, sic_linea, sic_cantidad, sic_precio, sic_importe, sic_udm, sic_preparador, sic_fecha_creacion,
    relacion, numero_op, linea, envio, envios_linea,
    proveedor, op_descripcion,
    zona, cantidad, cantidad_recibida, ctd_aceptada, pendiente, cantidad_vencida,
    cantidad_rechazada, cantidad_facturada, cantidad_cancelada,
    fecha_creacion, fecha_pactada, fecha_creacion_d, fecha_pactada_d,
    estado_autorizacion, estado_cierre,
    tx_recibido, tx_aceptado, tx_entregado, tx_devoluciones, tx_movimientos,
    tx_primera_fecha, tx_ultima_fecha,
    busqueda
  )
  SELECT
    'op',
    o.articulo,
    o.k,
    COALESCE(NULLIF(c.descripcion, ''), o.descripcion_articulo),
    COALESCE(NULLIF(c.unidad_medida, ''), o.udm),
    c.estado,
    t.tipo,
    c.mat_serv,
    (c.k IS NOT NULL),
    s.numero_sic,
    s.linea,
    s.cantidad,
    s.precio,
    s.importe,
    s.udm,
    s.preparador,
    s.fecha_creacion,
    o.relacion,
    o.numero,
    o.linea,
    o.envio,
    ec.n,
    o.proveedor,
    od.descripcion,
    NULLIF(od.zona, ''),
    o.cantidad,
    o.cantidad_recibida,
    o.ctd_aceptada,
    COALESCE(o.cantidad, 0) - COALESCE(o.cantidad_recibida, 0),
    o.cantidad_vencida,
    o.cantidad_rechazada,
    o.cantidad_facturada,
    o.cantidad_cancelada,
    o.fecha_creacion,
    o.fecha_pactada,
    gd_parse_fecha(o.fecha_creacion),
    gd_parse_fecha(o.fecha_pactada),
    o.estado_autorizacion,
    o.estado_cierre,
    x.recibido,
    x.aceptado,
    x.entregado,
    x.devoluciones,
    x.movimientos,
    x.primera_fecha,
    x.ultima_fecha,
    gd_norm_texto(concat_ws(' ',
      o.articulo, o.k,
      COALESCE(NULLIF(c.descripcion, ''), o.descripcion_articulo),
      o.relacion, o.numero, o.linea, o.envio, o.proveedor,
      od.descripcion, od.zona,
      t.tipo, c.mat_serv, c.estado, o.estado_autorizacion, o.estado_cierre,
      o.fecha_creacion, o.fecha_pactada,
      x.primera_fecha, x.ultima_fecha,
      s.numero_sic, s.preparador
    ))
  FROM (
    SELECT *,
           gd_norm_articulo(articulo)        AS k,
           gd_norm_op(numero)                AS op_k,
           COALESCE(gd_norm_linea(linea), '') AS linea_k
      FROM planillas_op
  ) o
  LEFT JOIN _cat  c ON c.k = o.k
  LEFT JOIN _tipo t ON t.k = o.k
  LEFT JOIN _opd  od ON od.k = o.op_k
  LEFT JOIN _tx   x ON x.numero_op = o.op_k AND x.k = o.k AND x.linea_k = o.linea_k
  LEFT JOIN _env_count ec ON ec.numero_op = o.op_k AND ec.linea_k = o.linea_k
  LEFT JOIN _sic  s ON s.op_k = o.op_k AND s.art_k = o.k;

  -- 2) Movimientos huérfanos (OPs viejas fuera del export actual).
  INSERT INTO busqueda_index (
    fuente, articulo, articulo_key, descripcion, unidad_medida, estado_matricula,
    tipo, mat_serv, en_catalogo,
    numero_sic, sic_linea, sic_cantidad, sic_precio, sic_importe, sic_udm, sic_preparador, sic_fecha_creacion,
    numero_op, linea, proveedor, op_descripcion, zona,
    tx_recibido, tx_aceptado, tx_entregado, tx_devoluciones, tx_movimientos,
    tx_primera_fecha, tx_ultima_fecha, busqueda
  )
  SELECT
    'transaccion',
    COALESCE(c.articulo, x.k),
    x.k,
    c.descripcion,
    c.unidad_medida,
    c.estado,
    t.tipo,
    c.mat_serv,
    (c.k IS NOT NULL),
    s.numero_sic,
    s.linea,
    s.cantidad,
    s.precio,
    s.importe,
    s.udm,
    s.preparador,
    s.fecha_creacion,
    x.numero_op,
    NULLIF(x.linea_k, ''),
    x.proveedor,
    od.descripcion,
    NULLIF(od.zona, ''),
    x.recibido,
    x.aceptado,
    x.entregado,
    x.devoluciones,
    x.movimientos,
    x.primera_fecha,
    x.ultima_fecha,
    gd_norm_texto(concat_ws(' ',
      COALESCE(c.articulo, x.k), x.k, c.descripcion, x.numero_op, x.linea_k,
      x.proveedor, od.descripcion, od.zona, t.tipo, c.mat_serv, c.estado,
      x.primera_fecha, x.ultima_fecha,
      s.numero_sic, s.preparador
    ))
  FROM _tx x
  LEFT JOIN _cat     c  ON c.k = x.k
  LEFT JOIN _tipo    t  ON t.k = x.k
  LEFT JOIN _opd     od ON od.k = x.numero_op
  LEFT JOIN _sic     s  ON s.op_k = x.numero_op AND s.art_k = x.k
  LEFT JOIN _op_rows orw ON orw.numero_op = x.numero_op
                        AND orw.k         = x.k
                        AND orw.linea_k   = x.linea_k
  WHERE orw.numero_op IS NULL;

  -- 3) Líneas de SIC sin OP todavía.
  INSERT INTO busqueda_index (
    fuente, articulo, articulo_key, descripcion, unidad_medida, estado_matricula,
    tipo, mat_serv, en_catalogo,
    numero_sic, sic_linea, sic_cantidad, sic_precio, sic_importe, sic_udm, sic_preparador, sic_fecha_creacion,
    numero_op, op_descripcion, zona, busqueda
  )
  SELECT
    'sic',
    COALESCE(c.articulo, s.art_k),
    s.art_k,
    COALESCE(NULLIF(c.descripcion, ''), s.descripcion),
    COALESCE(NULLIF(c.unidad_medida, ''), s.udm),
    c.estado,
    t.tipo,
    c.mat_serv,
    (c.k IS NOT NULL),
    s.numero_sic,
    s.linea,
    s.cantidad,
    s.precio,
    s.importe,
    s.udm,
    s.preparador,
    s.fecha_creacion,
    s.op_k,
    od.descripcion,
    NULLIF(od.zona, ''),
    gd_norm_texto(concat_ws(' ',
      COALESCE(c.articulo, s.art_k), s.art_k,
      COALESCE(NULLIF(c.descripcion, ''), s.descripcion),
      s.numero_sic, s.linea, s.op_k, s.preparador, s.fecha_creacion,
      od.descripcion, od.zona,
      t.tipo, c.mat_serv, c.estado
    ))
  FROM _sic s
  LEFT JOIN _cat  c ON c.k = s.art_k
  LEFT JOIN _tipo t ON t.k = s.art_k
  LEFT JOIN _opd  od ON od.k = s.op_k
  LEFT JOIN _op_art oa ON oa.op_k = s.op_k AND oa.art_k = s.art_k
  WHERE oa.op_k IS NULL;

  -- 4) Matrículas del catálogo sin OP, movimiento ni SIC.
  INSERT INTO busqueda_index (
    fuente, articulo, articulo_key, descripcion, unidad_medida, estado_matricula,
    tipo, mat_serv, en_catalogo, busqueda
  )
  SELECT
    'catalogo',
    c.articulo,
    c.k,
    c.descripcion,
    c.unidad_medida,
    c.estado,
    t.tipo,
    c.mat_serv,
    true,
    gd_norm_texto(concat_ws(' ',
      c.articulo, c.k, c.descripcion, t.tipo, c.mat_serv, c.estado
    ))
  FROM _cat c
  LEFT JOIN _tipo   t  ON t.k  = c.k
  LEFT JOIN _op_keys ok ON ok.k = c.k
  WHERE ok.k IS NULL;

  SELECT count(*) INTO total FROM busqueda_index;
  RETURN total;
END;
$$;

ALTER FUNCTION gd_reconstruir_busqueda() SET statement_timeout = '600s';

-- ─── gd_buscar — agregar sic_precio / sic_importe a la whitelist de orden ───
DROP FUNCTION IF EXISTS gd_buscar(text, integer, text, boolean, text, text, text, date, date);

CREATE FUNCTION gd_buscar(
  p_q           text,
  p_limite      integer DEFAULT 500,
  p_campo       text    DEFAULT NULL,
  p_solo_sic    boolean DEFAULT false,
  p_orden       text    DEFAULT NULL,
  p_dir         text    DEFAULT 'asc',
  p_fecha_campo text    DEFAULT NULL,
  p_fecha_desde date    DEFAULT NULL,
  p_fecha_hasta date    DEFAULT NULL
)
RETURNS SETOF busqueda_index
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  q         text := gd_norm_texto(COALESCE(p_q, ''));
  col       text;
  filtro    text;
  fecha_col text;
  orden_col text;
  dir       text;
  order_by  text;
BEGIN
  col := CASE p_campo
           WHEN 'numero_sic'     THEN 'gd_norm_texto(numero_sic)'
           WHEN 'sic_preparador' THEN 'gd_norm_texto(sic_preparador)'
           WHEN 'numero_op'      THEN 'gd_norm_texto(numero_op)'
           WHEN 'articulo'       THEN 'gd_norm_texto(articulo)'
           WHEN 'descripcion'    THEN 'gd_norm_texto(descripcion)'
           ELSE 'busqueda'
         END;

  filtro := '(NOT $3 OR numero_sic IS NOT NULL)';

  IF q <> '' THEN
    filtro := filtro || ' AND ' || col || ' LIKE ''%'' || $1 || ''%''';
  END IF;

  fecha_col := CASE p_fecha_campo
                 WHEN 'sic_fecha_creacion' THEN 'gd_parse_fecha(sic_fecha_creacion)'
                 WHEN 'fecha_creacion'     THEN 'fecha_creacion_d'
                 WHEN 'fecha_pactada'      THEN 'fecha_pactada_d'
                 WHEN 'tx_primera_fecha'   THEN 'tx_primera_fecha'
                 WHEN 'tx_ultima_fecha'    THEN 'tx_ultima_fecha'
                 ELSE NULL
               END;

  IF fecha_col IS NOT NULL THEN
    IF p_fecha_desde IS NOT NULL THEN
      filtro := filtro || ' AND ' || fecha_col || ' >= $5';
    END IF;
    IF p_fecha_hasta IS NOT NULL THEN
      filtro := filtro || ' AND ' || fecha_col || ' <= $6';
    END IF;
  END IF;

  orden_col := CASE p_orden
                 WHEN 'articulo'            THEN 'articulo'
                 WHEN 'descripcion'         THEN 'descripcion'
                 WHEN 'tipo'                THEN 'tipo'
                 WHEN 'mat_serv'            THEN 'mat_serv'
                 WHEN 'estado_matricula'    THEN 'estado_matricula'
                 WHEN 'unidad_medida'       THEN 'unidad_medida'
                 WHEN 'numero_sic'          THEN 'numero_sic'
                 WHEN 'sic_linea'           THEN 'sic_linea'
                 WHEN 'sic_cantidad'        THEN 'sic_cantidad'
                 WHEN 'sic_precio'          THEN 'sic_precio'
                 WHEN 'sic_importe'         THEN 'sic_importe'
                 WHEN 'sic_udm'             THEN 'sic_udm'
                 WHEN 'sic_preparador'      THEN 'sic_preparador'
                 WHEN 'sic_fecha_creacion'  THEN 'gd_parse_fecha(sic_fecha_creacion)'
                 WHEN 'relacion'            THEN 'relacion'
                 WHEN 'numero_op'           THEN 'numero_op'
                 WHEN 'linea'               THEN 'linea'
                 WHEN 'envio'               THEN 'envio'
                 WHEN 'proveedor'           THEN 'proveedor'
                 WHEN 'op_descripcion'      THEN 'op_descripcion'
                 WHEN 'zona'                THEN 'zona'
                 WHEN 'cantidad'            THEN 'cantidad'
                 WHEN 'cantidad_recibida'   THEN 'cantidad_recibida'
                 WHEN 'ctd_aceptada'        THEN 'ctd_aceptada'
                 WHEN 'pendiente'           THEN 'pendiente'
                 WHEN 'cantidad_vencida'    THEN 'cantidad_vencida'
                 WHEN 'cantidad_rechazada'  THEN 'cantidad_rechazada'
                 WHEN 'cantidad_facturada'  THEN 'cantidad_facturada'
                 WHEN 'cantidad_cancelada'  THEN 'cantidad_cancelada'
                 WHEN 'fecha_creacion'      THEN 'fecha_creacion_d'
                 WHEN 'fecha_pactada'       THEN 'fecha_pactada_d'
                 WHEN 'estado_autorizacion' THEN 'estado_autorizacion'
                 WHEN 'estado_cierre'       THEN 'estado_cierre'
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

  IF p_orden IN ('articulo','numero_sic','sic_linea','relacion','numero_op','linea','envio') THEN
    orden_col := 'CASE WHEN ' || orden_col || ' ~ ''^[0-9]+(\.[0-9]+)?$'' THEN ('
                 || orden_col || ')::numeric END ' || dir || ' NULLS LAST, ' || orden_col;
  END IF;

  IF orden_col IS NULL THEN
    order_by :=
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
    order_by := orden_col || ' ' || dir || ' NULLS LAST, numero_op, linea, envio';
  END IF;

  RETURN QUERY EXECUTE
    'SELECT * FROM busqueda_index WHERE ' || filtro || ' ORDER BY ' || order_by || ' LIMIT $2'
    USING q, COALESCE(p_limite, 500), p_solo_sic, p_q, p_fecha_desde, p_fecha_hasta;
END;
$$;

GRANT EXECUTE ON FUNCTION gd_buscar(text, integer, text, boolean, text, text, text, date, date) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
