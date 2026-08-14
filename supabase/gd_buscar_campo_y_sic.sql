-- ============================================================================
-- gd_buscar — selector de campo (p_campo) + vista «SICs de Soler» (p_solo_sic)
--
-- Migración chica y autocontenida: solo redefine la función de búsqueda. NO
-- toca `busqueda_index` ni obliga a reconstruir el índice.
--
-- Arregla dos cosas:
--   1. «Could not find the function public.gd_buscar(p_campo, p_limite, p_q,
--      p_solo_sic) in the schema cache» — la firma de 4 argumentos no existía.
--   2. «canceling statement due to statement timeout» — ver abajo.
--
-- ── Por qué SQL dinámico y no un CASE ───────────────────────────────────────
-- `busqueda_index` tiene un índice GIN de trigramas sobre la columna `busqueda`
-- (idx_busqueda_index_busqueda). La primera versión de este selector escribía
-- el filtro como:
--
--     CASE p_campo WHEN 'numero_sic' THEN gd_norm_texto(numero_sic) ...
--                  ELSE busqueda END  LIKE '%' || ... || '%'
--
-- y eso MATA el índice: el planner no puede usar un índice sobre `busqueda`
-- cuando la columna está adentro de una expresión CASE. Resultado: seq scan
-- de las 112k+ filas evaluando gd_norm_texto() sobre cinco columnas por fila,
-- y timeout.
--
-- Con EXECUTE, cada llamada arma la consulta de su rama: sin campo elegido
-- (el caso normal) el filtro vuelve a ser un `busqueda LIKE '%...%'` pelado,
-- que es exactamente lo que el índice GIN sabe resolver.
--
-- ⚠ Inyección: `col` NO se concatena desde la entrada del usuario. Sale de un
--   CASE sobre literales fijos — cualquier valor desconocido de p_campo cae al
--   ELSE. El texto buscado y el límite viajan como parámetros ($1, $2…), nunca
--   interpolados.
--
-- Se borran TODAS las firmas anteriores antes de crear la nueva: Postgres
-- trata cada aridad como una sobrecarga distinta, así que sin los DROP
-- quedarían conviviendo la de 2, la de 3 y la de 4 argumentos, y PostgREST
-- podría elegir cualquiera.
-- ============================================================================

DROP FUNCTION IF EXISTS gd_buscar(text, integer);
DROP FUNCTION IF EXISTS gd_buscar(text, integer, text);
DROP FUNCTION IF EXISTS gd_buscar(text, integer, text, boolean);

CREATE FUNCTION gd_buscar(
  p_q        text,
  p_limite   integer DEFAULT 500,
  p_campo    text    DEFAULT NULL,
  p_solo_sic boolean DEFAULT false
)
RETURNS SETOF busqueda_index
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  q     text := gd_norm_texto(COALESCE(p_q, ''));
  col   text;
  filtro text;
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

  RETURN QUERY EXECUTE
    'SELECT * FROM busqueda_index WHERE ' || filtro || '
      ORDER BY
        -- Sin búsqueda: las OP más nuevas primero. Con texto buscado este CASE
        -- da NULL en todas las filas y NULLS LAST no mueve nada, así que el
        -- orden por relevancia de abajo queda intacto.
        --
        -- Va por `fecha_creacion_d` (date), NUNCA por `fecha_creacion` (text):
        -- el texto crudo tiene dos formatos mezclados y ordenarlo
        -- alfabéticamente termina ordenando por el nombre del día.
        CASE WHEN $1 = '''' THEN fecha_creacion_d END DESC NULLS LAST,
        (articulo_key = gd_norm_articulo($4)) DESC,   -- matrícula exacta primero
        (numero_op    = trim(COALESCE($4, ''''))) DESC, -- después OP exacta
        -- Orden por fuente EXPLÍCITO, no alfabético: alfabéticamente
        -- ''catalogo'' va antes que ''op'' y las filas sin OP (sin línea,
        -- envío, proveedor ni cantidad) quedaban arriba de todo.
        CASE fuente
          WHEN ''op''          THEN 0
          WHEN ''transaccion'' THEN 1
          ELSE 2
        END,
        numero_op,
        linea,
        envio
      LIMIT $2'
    USING q, COALESCE(p_limite, 500), p_solo_sic, p_q;
END;
$$;

GRANT EXECUTE ON FUNCTION gd_buscar(text, integer, text, boolean) TO anon, authenticated;

-- PostgREST cachea la lista de funciones. Sin esto puede seguir respondiendo
-- «not found in the schema cache» aunque la función ya exista.
NOTIFY pgrst, 'reload schema';
