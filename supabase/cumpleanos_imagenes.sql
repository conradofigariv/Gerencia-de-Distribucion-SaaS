-- ============================================================================
-- Cumpleaños — imagen del cartel de feliz cumpleaños (una por persona)
-- ============================================================================
-- El cartel que aparece al entrar el día del cumpleaños de alguien muestra la
-- imagen que subió un administrador para esa persona (Configuración →
-- Usuarios → editar). Sin imagen, se usa la foto de perfil.
--
-- Solo el administrador sube/cambia/quita la imagen: la escritura pasa por
-- /api/admin/users con la service role key, que bypasea RLS y las policies de
-- storage. Por eso ni la tabla ni el bucket tienen policies de escritura: un
-- usuario no puede cambiarse su propia imagen desde el cliente.
--
-- Requiere supabase/profile_cumpleanos.sql (columna profiles.cumpleanos).
-- Se puede correr más de una vez.
-- ============================================================================

-- 1) Bucket público (lectura con getPublicUrl, sin sesión).
INSERT INTO storage.buckets (id, name, public)
VALUES ('cumpleanos', 'cumpleanos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2) Lectura pública de las imágenes del bucket.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'cumpleanos_public_read'
  ) THEN
    CREATE POLICY cumpleanos_public_read
      ON storage.objects FOR SELECT
      TO public
      USING (bucket_id = 'cumpleanos');
  END IF;
END $$;

-- 3) Qué imagen tiene cada persona.
CREATE TABLE IF NOT EXISTS cumple_imagenes (
  user_id     uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  imagen_url  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

ALTER TABLE cumple_imagenes ENABLE ROW LEVEL SECURITY;

-- Todo usuario logueado la lee (el cartel lo ve toda la oficina). Sin
-- policies de INSERT/UPDATE/DELETE: solo escribe la service role.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cumple_imagenes'
      AND policyname = 'cumple_imagenes_select_authenticated'
  ) THEN
    CREATE POLICY cumple_imagenes_select_authenticated
      ON cumple_imagenes FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
