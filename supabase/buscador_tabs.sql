-- ============================================================================
-- Pestañas del Buscador — listas de seguimiento por usuario
--
-- El Buscador es la base maestra (busqueda_index, de solo lectura y que se
-- regenera entera en cada «Reconstruir»). Estas pestañas son el espacio de
-- trabajo del usuario: se seleccionan filas del índice y se COPIAN acá.
--
-- ⚠ Es una copia, no una referencia. La fila queda congelada al momento de
--   agregarla y a partir de ahí es editable campo por campo. Es la única forma
--   coherente de que sea editable: si se refrescara sola desde el índice,
--   pisaría lo que el usuario escribió. El refresco existe pero es MANUAL
--   (botón «Actualizar desde el índice» por fila) — ver `row_key`.
--
-- Por eso NO hay FK contra busqueda_index: esa tabla se borra y recrea entera
-- en cada reconstrucción, una FK haría fallar el DELETE.
-- ============================================================================

-- ─── Pestañas ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS buscador_tabs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users NOT NULL,
  nombre     text NOT NULL,
  orden      integer NOT NULL DEFAULT 0,
  color      text,
  -- Configuración de columnas de ESTA pestaña: { order: string[], hidden: string[],
  -- widths: Record<string, number> }. Mismo shape que usa user_preferences para
  -- el índice maestro, así el componente reutiliza la misma lógica.
  config     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buscador_tabs_user ON buscador_tabs (user_id, orden);

ALTER TABLE buscador_tabs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "buscador_tabs_own" ON buscador_tabs;
CREATE POLICY "buscador_tabs_own"
  ON buscador_tabs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── Filas copiadas dentro de cada pestaña ──────────────────────────────────

CREATE TABLE IF NOT EXISTS buscador_tab_filas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_id     uuid REFERENCES buscador_tabs (id) ON DELETE CASCADE NOT NULL,

  -- La fila COMPLETA copiada del índice, más las columnas de seguimiento.
  -- Guardarla como jsonb es lo que permite editar cualquier campo con un solo
  -- camino de escritura, y sumar columnas nuevas sin migrar el esquema.
  -- Las claves de seguimiento van con guion bajo (_nota, _estado, _responsable,
  -- _fecha_revision) para no colisionar nunca con una columna del índice.
  datos      jsonb NOT NULL DEFAULT '{}',

  -- De qué fila del índice salió (fuente|matrícula|OP|línea|envío). Sirve para
  -- avisar de duplicados al agregar y para el refresco manual. Puede quedar
  -- huérfana si esa fila ya no existe en el índice — es esperado.
  row_key    text,

  orden      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buscador_tab_filas_tab ON buscador_tab_filas (tab_id, orden);

ALTER TABLE buscador_tab_filas ENABLE ROW LEVEL SECURITY;

-- Las filas no tienen user_id propio: heredan el dueño de su pestaña.
DROP POLICY IF EXISTS "buscador_tab_filas_own" ON buscador_tab_filas;
CREATE POLICY "buscador_tab_filas_own"
  ON buscador_tab_filas
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM buscador_tabs t
       WHERE t.id = buscador_tab_filas.tab_id
         AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM buscador_tabs t
       WHERE t.id = buscador_tab_filas.tab_id
         AND t.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON buscador_tabs      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON buscador_tab_filas TO authenticated;
