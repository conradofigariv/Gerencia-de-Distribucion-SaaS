-- ============================================================================
-- Buscador — detalle de entregas de una línea (fila desplegable)
--
-- Replica en el Buscador lo que Tablero OP muestra con gd_tablero: contra qué
-- se comprometió la OP (los ENVÍOS de planillas_op, cada uno con su cantidad y
-- fecha pactada) y qué se entregó realmente (los movimientos 'Entregar' de
-- tablero_op_transaccion), para poder compararlos.
--
-- ── Por qué es una consulta aparte y no columnas del índice ─────────────────
-- `busqueda_index` ya trae los TOTALES de movimientos (tx_entregado y compañía)
-- precalculados sobre todo el histórico. Eso no alcanza acá por dos motivos:
--   • Se quiere el detalle fila por fila (cada entrega con su fecha e importe),
--     no un total.
--   • Se quiere filtrar por rango de fechas, y el índice está precalculado SIN
--     rango — meterle el filtro obligaría a reconstruirlo en cada cambio.
-- Al ser bajo demanda (solo cuando el usuario despliega una fila) el costo es
-- de una línea por vez, no de las 112k del índice.
--
-- ── Grano ───────────────────────────────────────────────────────────────────
-- ⚠ Las transacciones NO tienen dimensión de envío: el total entregado es
--   siempre de la LÍNEA completa. Por eso `entregas` corresponde a (OP,
--   artículo, línea) mientras que `envios` sí se abre por envío. Comparar uno
--   contra otro es exactamente lo que hace Tablero OP, y es la razón de que
--   ambos vengan juntos en la misma respuesta.
--
-- La línea se normaliza con gd_norm_linea en los dos lados: el índice y las
-- transacciones usan notación con coma (1,1) y planillas_op puede traer 1.1 o
-- 1.0 según cómo exporte Excel.
-- ============================================================================

DROP FUNCTION IF EXISTS gd_entregas_linea(text, text, text, date, date);

CREATE FUNCTION gd_entregas_linea(
  p_numero_op text,
  p_articulo  text,
  p_linea     text,
  p_desde     date DEFAULT NULL,
  p_hasta     date DEFAULT NULL
)
RETURNS TABLE (
  envios   jsonb,
  entregas jsonb,
  totales  jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH k AS (
    SELECT
      gd_norm_op(p_numero_op)                   AS op_k,
      gd_norm_articulo(p_articulo)              AS art_k,
      COALESCE(gd_norm_linea(p_linea), '')      AS linea_k
  ),
  -- Lo comprometido: un renglón por envío de esa (OP, línea).
  env AS (
    SELECT jsonb_agg(
             jsonb_build_object(
               'envio',         o.envio,
               'cantidad',      o.cantidad,
               'fecha_pactada', o.fecha_pactada
             )
             ORDER BY o.envio
           ) AS j
      FROM planillas_op o, k
     WHERE gd_norm_op(o.numero)                  = k.op_k
       AND COALESCE(gd_norm_linea(o.linea), '')  = k.linea_k
  ),
  -- Lo entregado realmente. El rango es opcional: NULL = sin límite por ese
  -- lado, así la fila desplegable puede abrir con todo el histórico.
  ent AS (
    SELECT jsonb_agg(
             jsonb_build_object(
               'fecha',   t.fecha::date,
               'importe', t.importe
             )
             ORDER BY t.fecha
           ) AS j,
           COALESCE(SUM(t.importe), 0) AS total,
           COUNT(*)::integer           AS n
      FROM tablero_op_transaccion t, k
     WHERE gd_norm_op(t.numero_pedido::text)     = k.op_k
       AND gd_norm_articulo(t.articulo)          = k.art_k
       AND COALESCE(gd_norm_linea(t.linea), '')  = k.linea_k
       AND t.tipo = 'Entregar'
       AND (p_desde IS NULL OR t.fecha::date >= p_desde)
       AND (p_hasta IS NULL OR t.fecha::date <= p_hasta)
  )
  SELECT
    COALESCE(env.j, '[]'::jsonb),
    COALESCE(ent.j, '[]'::jsonb),
    jsonb_build_object(
      'entregado',  COALESCE(ent.total, 0),
      'n_entregas', COALESCE(ent.n, 0),
      -- Suma de lo comprometido en TODOS los envíos de la línea, para poder
      -- decir "entregado X de Y" sin que el cliente tenga que sumar el array.
      'comprometido', COALESCE((
        SELECT SUM((e->>'cantidad')::numeric)
          FROM jsonb_array_elements(COALESCE(env.j, '[]'::jsonb)) e
      ), 0)
    )
  FROM env, ent;
$$;

GRANT EXECUTE ON FUNCTION gd_entregas_linea(text, text, text, date, date) TO anon, authenticated;

-- Índice para que el filtro de entregas por (OP, artículo) no barra las 60k+
-- filas de transacciones en cada despliegue de fila.
CREATE INDEX IF NOT EXISTS idx_tx_pedido_articulo
  ON tablero_op_transaccion (numero_pedido, articulo);
