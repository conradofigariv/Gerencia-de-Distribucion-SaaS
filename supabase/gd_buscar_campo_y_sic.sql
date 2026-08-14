-- ============================================================================
-- gd_buscar — selector de campo (p_campo) + vista «SICs de Soler» (p_solo_sic)
--
-- Migración chica y autocontenida: solo redefine la función de búsqueda. NO
-- toca `busqueda_index` ni obliga a reconstruir el índice — correr el
-- `busqueda_global.sql` entero para esto sería innecesario (recrea la tabla y
-- todo el resto).
--
-- Arregla: «Could not find the function public.gd_buscar(p_campo, p_limite,
-- p_q, p_solo_sic) in the schema cache».
--
-- Se borran TODAS las firmas anteriores antes de crear la nueva: Postgres
-- trata cada aridad como una sobrecarga distinta, así que sin los DROP
-- quedarían conviviendo la de 2, la de 3 y la de 4 argumentos, y PostgREST
-- podría elegir cualquiera.
-- ============================================================================

DROP FUNCTION IF EXISTS gd_buscar(text, integer);
DROP FUNCTION IF EXISTS gd_buscar(text, integer, text);
DROP FUNCTION IF EXISTS gd_buscar(text, integer, text, boolean);

CREATE OR REPLACE FUNCTION gd_buscar(p_q text, p_limite integer DEFAULT 500, p_campo text DEFAULT NULL, p_solo_sic boolean DEFAULT false)
RETURNS SETOF busqueda_index
LANGUAGE sql
STABLE
AS $$
  SELECT *
    FROM busqueda_index
   -- Vista «SICs de Soler»: solo las filas que tienen SIC asociada. Va como
   -- filtro aparte y no como p_campo porque no depende del texto buscado —
   -- acota el UNIVERSO, y se combina con cualquier búsqueda encima.
   WHERE (NOT p_solo_sic OR numero_sic IS NOT NULL)
     AND (gd_norm_texto(COALESCE(p_q, '')) = ''
      OR CASE p_campo
           WHEN 'numero_sic'     THEN gd_norm_texto(numero_sic)
           WHEN 'sic_preparador' THEN gd_norm_texto(sic_preparador)
           WHEN 'numero_op'      THEN gd_norm_texto(numero_op)
           WHEN 'articulo'       THEN gd_norm_texto(articulo)
           WHEN 'descripcion'    THEN gd_norm_texto(descripcion)
           ELSE busqueda
         END LIKE '%' || gd_norm_texto(p_q) || '%')
   ORDER BY
     -- Sin búsqueda (pantalla de entrada al Buscador): las OP más nuevas
     -- primero. Es un CASE que solo «pesa» en este modo — con texto buscado
     -- da NULL en todas las filas (NULLS LAST no mueve nada) y el orden por
     -- relevancia de abajo queda intacto, como antes.
     --
     -- Va por `fecha_creacion_d` (date), NUNCA por `fecha_creacion` (text): el
     -- texto crudo tiene dos formatos mezclados y ordenarlo alfabéticamente
     -- termina ordenando por el nombre del día. Ver gd_parse_fecha.
     CASE WHEN gd_norm_texto(COALESCE(p_q, '')) = '' THEN fecha_creacion_d END DESC NULLS LAST,
     (articulo_key = gd_norm_articulo(p_q)) DESC,   -- matrícula exacta primero
     (numero_op    = trim(COALESCE(p_q, ''))) DESC, -- después OP exacta
     -- Orden por fuente EXPLÍCITO, no alfabético: alfabéticamente 'catalogo'
     -- va antes que 'op' y las filas sin OP (sin línea, envío, proveedor ni
     -- cantidad) quedaban arriba de todo, que es justo lo menos útil.
     CASE fuente
       WHEN 'op'          THEN 0   -- compras: la fila completa
       WHEN 'transaccion' THEN 1   -- movimientos de OPs fuera de la planilla
       ELSE 2                      -- 'catalogo': la matrícula existe y nada más
     END,
     numero_op,
     linea,
     envio
   LIMIT COALESCE(p_limite, 500);
$$;

GRANT EXECUTE ON FUNCTION gd_buscar(text, integer, text, boolean) TO anon, authenticated;

-- PostgREST cachea la lista de funciones. Sin esto puede seguir respondiendo
-- «not found in the schema cache» aunque la función ya exista — que es
-- exactamente el error que dispara esta migración.
NOTIFY pgrst, 'reload schema';
