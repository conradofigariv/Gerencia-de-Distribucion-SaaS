-- ============================================================================
-- Cumpleaños — video del cartel de feliz cumpleaños (uno por persona)
-- ============================================================================
-- El cartel que aparece al entrar el día del cumpleaños de alguien reproduce
-- (mudo y en loop) el video que subió un administrador para esa persona
-- (Configuración → Usuarios → editar). Sin video, se usa la foto de perfil.
--
-- Solo el administrador sube/cambia/quita el video. El archivo NO pasa por
-- Vercel (corta los pedidos en 4,5 MB): /api/admin/users, con la service role,
-- verifica que sea admin y firma una URL de subida de un solo uso; el
-- navegador sube directo a Storage con esa URL y después la ruta guarda la
-- fila. Ni la tabla ni el bucket tienen policies de escritura: un usuario no
-- puede cambiarse su propio video desde el cliente.
--
-- Historia: empezó como imagen (por eso la tabla se llama cumple_imagenes y
-- la columna imagen_url). `tipo` dice qué hay en esa URL; las filas viejas
-- quedan como 'imagen' y el cartel las sigue mostrando.
--
-- Requiere supabase/profile_cumpleanos.sql (columna profiles.cumpleanos).
-- Se puede correr más de una vez (también si ya se había corrido la versión
-- de imágenes).
-- ============================================================================

-- 1) Bucket público (lectura con getPublicUrl, sin sesión). Solo video, hasta
--    50 MB por archivo — el máximo del plan gratuito. Si en Supabase →
--    Settings → Storage el límite global es menor, manda ese.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cumpleanos', 'cumpleanos', true, 52428800, ARRAY['video/*'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2) Lectura pública de los archivos del bucket.
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

-- 3) Qué video (o imagen vieja) tiene cada persona.
CREATE TABLE IF NOT EXISTS cumple_imagenes (
  user_id     uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  imagen_url  text NOT NULL,            -- URL pública del archivo (video o imagen)
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

ALTER TABLE cumple_imagenes
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'imagen';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cumple_imagenes_tipo_chk'
  ) THEN
    ALTER TABLE cumple_imagenes
      ADD CONSTRAINT cumple_imagenes_tipo_chk CHECK (tipo IN ('imagen', 'video'));
  END IF;
END $$;

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
