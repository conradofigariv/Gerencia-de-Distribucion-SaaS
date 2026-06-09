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
--
-- ── Performance ─────────────────────────────────────────────────────────────
-- La versión anterior usaba subqueries correlacionados por fila (uno de ellos
-- con regexp_replace en el ORDER BY sobre toda planillas_op), lo que provocaba
-- "statement timeout". Esta versión precalcula todo en CTEs con una sola pasada
-- por tabla y luego hace LEFT JOINs:
--   • prov_tx : proveedor por OP desde la transacción más antigua.
--   • prov_op : proveedor por OP desde planillas_op (una OP = un proveedor, así
--               que se toma cualquier línea con proveedor cargado — sin el
--               desempate por artículo, que era lo caro).
--   • agg     : movimientos agregados por (OP, artículo) en el rango de fechas.
-- Para que prov_op sea rápida conviene un índice en planillas_op(numero)
-- (ver tablero_op_indices_planillas.sql).
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
  WITH ops AS (
    -- OPs distintas presentes en el seguimiento (acota el trabajo de las CTEs).
    SELECT DISTINCT numero_op
      FROM tablero_op_seguimiento
     WHERE numero_op IS NOT NULL
  ),
  prov_tx AS (
    -- Proveedor por OP: el de la transacción más antigua con proveedor cargado.
    SELECT DISTINCT ON (t.numero_pedido)
           t.numero_pedido AS numero_op,
           t.proveedor
      FROM tablero_op_transaccion t
      JOIN ops ON ops.numero_op = t.numero_pedido
     WHERE t.proveedor IS NOT NULL AND t.proveedor <> ''
     ORDER BY t.numero_pedido, t.fecha ASC
  ),
  prov_op AS (
    -- Proveedor por OP desde planillas_op (una OP = un proveedor). numero es text.
    SELECT DISTINCT ON (o.numero)
           o.numero AS numero_op_txt,
           o.proveedor
      FROM planillas_op o
      JOIN ops ON ops.numero_op::text = o.numero
     WHERE o.proveedor IS NOT NULL AND o.proveedor <> ''
     ORDER BY o.numero
  ),
  agg AS (
    -- Movimientos por (OP, artículo) dentro del rango de fechas.
    SELECT
      t.numero_pedido AS numero_op,
      t.articulo,
      SUM(CASE WHEN t.tipo = 'Recibir'  THEN t.importe ELSE 0 END) AS recibido,
      SUM(CASE WHEN t.tipo = 'Aceptar'  THEN t.importe ELSE 0 END) AS aceptado,
      SUM(CASE WHEN t.tipo = 'Entregar' THEN t.importe ELSE 0 END) AS entregado,
      SUM(CASE WHEN t.tipo IN (
            'Rechazar', 'Devolver a Proveedor', 'Devolver a Recepción', 'Corregir'
          ) THEN t.importe ELSE 0 END) AS devoluciones
    FROM tablero_op_transaccion t
    JOIN ops ON ops.numero_op = t.numero_pedido
    WHERE t.fecha >= p_desde::timestamptz
      AND t.fecha <  (p_hasta + 1)::timestamptz   -- incluye todo el día p_hasta
    GROUP BY t.numero_pedido, t.articulo
  )
  SELECT
    s.numero_sic,
    s.linea,
    s.articulo,
    s.descripcion,
    s.cantidad,
    s.udm,
    s.ctd_entregada,
    s.numero_op,

    COALESCE(ptx.proveedor, pop.proveedor, 'Sin Datos') AS proveedor,

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
  LEFT JOIN prov_tx ptx ON ptx.numero_op = s.numero_op
  LEFT JOIN prov_op pop ON pop.numero_op_txt = s.numero_op::text
  LEFT JOIN agg
    ON agg.numero_op = s.numero_op
   AND agg.articulo  = s.articulo
  ORDER BY s.numero_sic;
$$;

-- Exponer la función como RPC para el cliente (anon key) y usuarios logueados.
GRANT EXECUTE ON FUNCTION gd_tablero(date, date, text) TO anon, authenticated;
