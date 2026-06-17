-- ============================================================================
-- Perfiles — Cumpleaños
-- Agrega el cumpleaños al perfil y permite que el equipo se vea entre sí
-- (necesario para la alerta de cumpleaños en la campana de recordatorios).
-- ============================================================================

-- 1) Columna de cumpleaños (el año se ignora; solo importa día/mes).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS cumpleanos date;

-- 2) Lectura del equipo: cualquier usuario autenticado puede leer los perfiles.
--    Requerido para que la campana muestre los cumpleaños de los demás.
--    (Si ya tenés una policy de SELECT equivalente, podés omitir este bloque.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'profiles'
      AND policyname = 'profiles_select_authenticated'
  ) THEN
    CREATE POLICY profiles_select_authenticated
      ON profiles
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
