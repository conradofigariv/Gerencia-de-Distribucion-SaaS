-- ============================================================================
-- FIX: no se podían crear pestañas — "new row violates row-level security
-- policy for table buscador_tabs" (42501) al crear una pestaña nueva.
--
-- CAUSA
-- -----
-- `createTab()` hace `.insert(...).select().single()`, que PostgREST traduce a
-- INSERT ... RETURNING. En Postgres, un INSERT con RETURNING aplica TAMBIÉN la
-- policy de SELECT sobre la fila recién insertada, no solo el WITH CHECK del
-- INSERT — y si esa lectura no pasa, el error que se levanta es exactamente el
-- mismo texto que el de un WITH CHECK fallido. Por eso el síntoma apuntaba al
-- INSERT cuando el INSERT en realidad estaba pasando perfecto: `auth.uid()` y
-- `user_id` coincidían, el rol era `authenticated`, no había triggers de INSERT
-- ni policies duplicadas ni FORCE RLS. Lo que fallaba era el RETURNING.
--
-- ¿Y por qué fallaba el SELECT? Porque `buscador_tab_shares.sql` reemplazó la
-- policy vieja (`buscador_tabs_own`, que comparaba `auth.uid() = user_id`
-- DIRECTO contra la fila) por `gd_puede_leer_pestana(id)`, que por dentro hace
--   SELECT 1 FROM buscador_tabs t WHERE t.id = p_tab_id ...
-- o sea, una consulta A LA MISMA TABLA desde una función STABLE. Una función
-- STABLE ve el snapshot del arranque de la sentencia, así que NO ve la fila que
-- esa misma sentencia está insertando: devuelve false y el RETURNING explota.
--
-- Nada de esto afecta a `buscador_tab_filas` ni a `buscador_tab_shares`: sus
-- policies llaman a la función sobre `tab_id`, que apunta a una fila de OTRA
-- tabla y que ya existe y está commiteada. El problema es exclusivo de la
-- policy de una tabla que se consulta a sí misma.
--
-- FIX
-- ---
-- Chequear la propiedad de forma directa contra la fila (sin re-consultar la
-- tabla) y dejar la función solo para el caso que de verdad la necesita: las
-- pestañas compartidas por otro. En un INSERT el WITH CHECK ya garantiza
-- `user_id = auth.uid()`, así que la primera rama corta en true y el RETURNING
-- funciona sin tocar nunca el snapshot.
-- ============================================================================

DROP POLICY IF EXISTS "buscador_tabs_select" ON buscador_tabs;
CREATE POLICY "buscador_tabs_select"
  ON buscador_tabs FOR SELECT TO authenticated
  USING (
    -- Dueño: comparación directa contra la fila — evaluable sobre la tupla
    -- nueva, así que sirve durante el RETURNING de un INSERT.
    user_id = auth.uid()
    -- Compartida con este usuario: acá sí hace falta ir a buscar a
    -- buscador_tab_shares, pero para ese caso la fila ya existe de antes.
    OR gd_puede_leer_pestana(id)
  );

-- Mismo criterio en UPDATE. Acá no había bug (en un UPDATE la fila ya existe y
-- es visible en el snapshot), pero la rama directa evita la llamada a la
-- función SECURITY DEFINER en el caso más común, que es el dueño editando lo
-- suyo.
DROP POLICY IF EXISTS "buscador_tabs_update" ON buscador_tabs;
CREATE POLICY "buscador_tabs_update"
  ON buscador_tabs FOR UPDATE TO authenticated
  USING      (user_id = auth.uid() OR gd_puede_editar_pestana(id))
  WITH CHECK (user_id = auth.uid() OR gd_puede_editar_pestana(id));
