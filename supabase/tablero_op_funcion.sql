-- ============================================================================
-- Tablero OP — Paso 2: función RPC gd_tablero(p_desde, p_hasta, p_zona)
--
-- Para cada fila de tablero_op_seguimiento cruza el log de transacciones
-- (filtrado por rango de fechas) y el stock por zona, y calcula los estados
-- de Control y Control2. Se expone como RPC para el frontend:
--
--   const { data } = await supabase.rpc('gd_tablero', {
--     p_desde: '2026-01-01', p_hasta: '2026-03-26', p_zona: 'ZA'
--   });
-- ============================================================================

CREATE OR REPLACE FUNCTION gd_tablero(p_desde date, p_hasta date, p_zona text)
RETURNS TABLE (
  numero_sic     bigint,
  linea          text,
  articulo       text,
  descripcion    text,
  cantidad       numeric,
  udm            text,
  ctd_entregada  numeric,
  numero_op      bigint,
  proveedor      text,
  control        text,
  stock          numeric,
  recibido       numeric,
  devoluciones   numeric,
  aceptado       numeric,
  entregado      numeric,
  control2       text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.numero_sic,
    s.linea,
    s.articulo,
    s.descripcion,
    s.cantidad,
    s.udm,
    s.ctd_entregada,
    s.numero_op,

    -- Proveedor (sin filtro de fecha): primera transacción de la OP con
    -- proveedor cargado → fallback al maestro de OP → 'Sin Datos'.
    -- La OP tiene varias líneas por numero, así que se resuelve por subquery
    -- (no por JOIN, que multiplicaría filas). Se prioriza la línea del mismo
    -- artículo y se cae a cualquier línea de la OP con proveedor cargado.
    COALESCE(
      (SELECT t.proveedor
         FROM tablero_op_transaccion t
        WHERE t.numero_pedido = s.numero_op
          AND t.proveedor IS NOT NULL
          AND t.proveedor <> ''
        ORDER BY t.fecha ASC
        LIMIT 1),
      (SELECT o.proveedor
         FROM tablero_op_op o
        WHERE o.numero = s.numero_op
          AND o.proveedor IS NOT NULL
          AND o.proveedor <> ''
        ORDER BY (o.articulo = s.articulo) DESC
        LIMIT 1),
      'Sin Datos'
    ) AS proveedor,

    -- Control: cantidad vs ctd_entregada (histórico acumulado).
    CASE
      WHEN COALESCE(s.ctd_entregada, 0) = 0           THEN 'TOTAL ADEUDADO'
      WHEN s.ctd_entregada >= COALESCE(s.cantidad, 0) THEN 'TOTAL ENTREGADO'
      ELSE 'ENTREGA PARCIAL'
    END AS control,

    -- Stock: en_mano del artículo en la zona elegida (0 si no hay).
    COALESCE(st.en_mano, 0) AS stock,

    COALESCE(agg.recibido, 0)     AS recibido,
    COALESCE(agg.devoluciones, 0) AS devoluciones,
    COALESCE(agg.aceptado, 0)     AS aceptado,
    COALESCE(agg.entregado, 0)    AS entregado,

    -- Control2: integridad. OK si (recibido - devoluciones) == entregado.
    CASE
      WHEN abs(
        (COALESCE(agg.recibido, 0) - COALESCE(agg.devoluciones, 0))
        - COALESCE(agg.entregado, 0)
      ) < 0.001 THEN 'OK'
      ELSE 'VER'
    END AS control2

  FROM tablero_op_seguimiento s
  LEFT JOIN tablero_op_stock st
    ON st.articulo = s.articulo
   AND st.organizacion = p_zona
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN t.tipo = 'Recibir'  THEN t.importe ELSE 0 END) AS recibido,
      SUM(CASE WHEN t.tipo = 'Aceptar'  THEN t.importe ELSE 0 END) AS aceptado,
      SUM(CASE WHEN t.tipo = 'Entregar' THEN t.importe ELSE 0 END) AS entregado,
      SUM(CASE WHEN t.tipo IN (
            'Rechazar', 'Devolver a Proveedor', 'Devolver a Recepción', 'Corregir'
          ) THEN t.importe ELSE 0 END) AS devoluciones
    FROM tablero_op_transaccion t
    WHERE t.numero_pedido = s.numero_op
      AND t.articulo = s.articulo
      AND t.fecha >= p_desde::timestamptz
      AND t.fecha <  (p_hasta + 1)::timestamptz   -- incluye todo el día p_hasta
  ) agg ON true
  ORDER BY s.numero_sic;
$$;

-- Exponer la función como RPC para el cliente (anon key) y usuarios logueados.
GRANT EXECUTE ON FUNCTION gd_tablero(date, date, text) TO anon, authenticated;
