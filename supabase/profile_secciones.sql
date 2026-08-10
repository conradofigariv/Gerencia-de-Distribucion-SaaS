-- ============================================================================
-- Permisos de sección por usuario
--
-- Cada perfil puede tener una lista de secciones del sidebar que puede ver.
-- `null` (el default) = sin restricción, ve todo — así ningún usuario
-- existente pierde acceso al correr esta migración. Un array (incluso vacío)
-- es una allowlist explícita: solo esas secciones + Configuración (que nunca
-- se restringe, ver lib/sectionAccess.ts).
--
-- Es una restricción de NAVEGACIÓN, la resuelve el cliente (sidebar.tsx +
-- app/page.tsx) — no reemplaza RLS ni oculta filas de ninguna tabla.
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS secciones_permitidas text[];

-- ─── Traba: nadie se autoasigna más secciones ───────────────────────────────
-- La UPDATE policy de `profiles` (la que ya existe, fuera de este repo) deja
-- que cada usuario edite SU PROPIA fila — necesario para que pueda cambiar su
-- nombre/avatar desde Configuración. Sin esta traba, ese mismo permiso le
-- alcanzaría para llamar `supabase.from("profiles").update({secciones_permitidas:[...]})`
-- directo desde la consola del navegador y darse acceso a todo.
--
-- La API de admin (`app/api/admin/users`) escribe con la service role key, que
-- no lleva sesión de usuario — ahí `auth.uid()` da NULL y la condición de
-- abajo nunca se cumple, así que el admin sigue pudiendo editar a cualquiera.
CREATE OR REPLACE FUNCTION gd_bloquear_autoescalada_secciones()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() = OLD.id
     AND NEW.secciones_permitidas IS DISTINCT FROM OLD.secciones_permitidas THEN
    RAISE EXCEPTION 'Los permisos de sección los asigna un administrador — no se pueden autoasignar.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloquear_autoescalada_secciones ON profiles;
CREATE TRIGGER trg_bloquear_autoescalada_secciones
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION gd_bloquear_autoescalada_secciones();

-- Nota: la misma preocupación aplica a `nivel_acceso` (un usuario podría
-- intentar auto-ascenderse a administrador por la misma vía), pero esa
-- columna es anterior a esta migración y su tabla/policies no viven en este
-- repo — no se toca acá para no interferir con lo que ya esté funcionando.
-- Si no existe ya una traba equivalente para `nivel_acceso`, vale la pena
-- agregarla con el mismo patrón.
