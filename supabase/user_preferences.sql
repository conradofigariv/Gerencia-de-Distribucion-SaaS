-- ============================================================================
-- user_preferences — preferencias por usuario (ancho/orden de columnas, etc.)
--
-- Tabla genérica (user_id, key, value jsonb). Cada sección usa su propia clave.
-- Buscador: "buscador-colwidths" y "buscador-columns".
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id    uuid REFERENCES auth.users NOT NULL,
  key        text NOT NULL,
  value      jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Cada usuario solo ve y modifica sus propias preferencias.
CREATE POLICY "users_own_preferences"
  ON user_preferences
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
