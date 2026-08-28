-- ============================================================================
-- Storage — Bucket de sonidos de notificación personalizados
-- ============================================================================
-- Antes de correr esto, creá el bucket en Supabase Dashboard:
--   Storage → New bucket → nombre: "notif-sounds" → marcalo como Public.
--
-- Mismo patrón que supabase/storage_avatars.sql: cada usuario sube SIEMPRE a
-- su propia carpeta ({user.id}/sonido.<ext>), y estas policies aprovechan esa
-- estructura — solo puede escribir en la propia, pero la lectura es pública
-- (así el navegador puede reproducir el audio con la URL pública, sin sesión).
--
-- La URL elegida se guarda en `user_preferences` (key "notif-sonido-url"),
-- NO acá: eso es lo que hace que sobreviva entre dispositivos — ver
-- lib/notificacionSonido.ts.
-- ============================================================================

-- 1) Lectura pública de cualquier sonido.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'notif_sounds_public_read'
  ) THEN
    CREATE POLICY notif_sounds_public_read
      ON storage.objects FOR SELECT
      TO public
      USING (bucket_id = 'notif-sounds');
  END IF;
END $$;

-- 2) Subir: solo en la carpeta propia ({user.id}/...).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'notif_sounds_insert_own'
  ) THEN
    CREATE POLICY notif_sounds_insert_own
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'notif-sounds'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;

-- 3) Reemplazar (upsert) el propio sonido.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'notif_sounds_update_own'
  ) THEN
    CREATE POLICY notif_sounds_update_own
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'notif-sounds'
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'notif-sounds'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;

-- 4) Borrar el propio sonido (volver al tono por defecto).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'notif_sounds_delete_own'
  ) THEN
    CREATE POLICY notif_sounds_delete_own
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'notif-sounds'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;
