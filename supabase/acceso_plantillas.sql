-- ============================================================================
-- Plantillas de acceso
--
-- Antes, dar de alta a alguien era tildar 18 checkboxes (una por sección del
-- sidebar) en un desplegable, por usuario, y repetirlo para cada persona con
-- el mismo rol. Una plantilla junta ese conjunto una vez, se le pone nombre
-- («Servicios», «Transformadores», «Solo lectura») y después se asigna de un
-- click.
--
-- ── Referencia viva, no copia ───────────────────────────────────────────────
-- `profiles.plantilla_acceso_id` APUNTA a la plantilla; no se copian sus
-- secciones a la fila del usuario. Es a propósito: editar la plantilla tiene
-- que actualizar a todos los que la tienen, que es el motivo por el que
-- existe. Con una copia habría que salir a reescribir cada perfil en cada
-- edición, y cualquier fallo a mitad de camino dejaría gente con permisos
-- viejos sin que nada lo indique.
--
-- ── Cómo se resuelve el acceso (precedencia) ────────────────────────────────
--   1. nivel_acceso = 'administrador'  → ve todo, siempre (no se toca acá).
--   2. plantilla_acceso_id != NULL     → manda la plantilla.
--   3. secciones_permitidas != NULL    → allowlist propia (lo de antes; sigue
--                                        funcionando para quien ya la tenga o
--                                        para un caso puntual sin plantilla).
--   4. las dos NULL                    → sin restricción, ve todo.
-- Ver `resolverSecciones()` en lib/sectionAccess.ts — la misma precedencia
-- vive ahí y es la que aplica el cliente.
--
-- ⚠ ON DELETE SET NULL: borrar una plantilla NO deja a nadie sin acceso ni lo
--   bloquea; los usuarios que la tenían caen al caso 3/4 (sin restricción).
--   Es el lado seguro para una restricción de NAVEGACIÓN: peor sería que
--   borrar una plantilla dejara a media oficina sin poder entrar a nada.
-- ============================================================================

CREATE TABLE IF NOT EXISTS acceso_plantillas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL UNIQUE,
  -- IDs de sección del sidebar (SIDEBAR_SECTIONS en sidebar.tsx). Array vacío
  -- es válido: «no ve nada del negocio» (igual entra a Configuración).
  secciones  text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plantilla_acceso_id uuid
  REFERENCES acceso_plantillas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_plantilla ON profiles (plantilla_acceso_id);

-- ─── Traba: nadie se autoasigna una plantilla ───────────────────────────────
-- Mismo razonamiento que `gd_bloquear_autoescalada_secciones` (ver
-- supabase/profile_secciones.sql): la UPDATE policy de `profiles` deja que
-- cada uno edite SU propia fila para poder cambiar nombre/avatar, y sin esta
-- traba ese mismo permiso alcanzaría para hacer
-- `update({plantilla_acceso_id: <la que ve todo>})` desde la consola del
-- navegador.
--
-- La API de admin escribe con la service role key, que no lleva sesión: ahí
-- `auth.uid()` da NULL y la condición nunca se cumple, así que el admin sigue
-- pudiendo asignar plantillas a cualquiera.
CREATE OR REPLACE FUNCTION gd_bloquear_autoasignacion_plantilla()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() = OLD.id
     AND NEW.plantilla_acceso_id IS DISTINCT FROM OLD.plantilla_acceso_id THEN
    RAISE EXCEPTION 'La plantilla de acceso la asigna un administrador — no se puede autoasignar.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloquear_autoasignacion_plantilla ON profiles;
CREATE TRIGGER trg_bloquear_autoasignacion_plantilla
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION gd_bloquear_autoasignacion_plantilla();

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- LECTURA para cualquier autenticado: el cliente necesita resolver las
-- secciones de SU plantilla para armar el sidebar. No hay nada sensible en la
-- tabla (nombres de sección), y sin esto habría que pasar por una ruta de
-- servidor en cada carga de la app.
--
-- ESCRITURA solo por la service role (o sea, por /api/admin/*): no hay policy
-- de INSERT/UPDATE/DELETE para `authenticated`, así que crear o editar
-- plantillas desde el cliente queda bloqueado aunque alguien lo intente.

ALTER TABLE acceso_plantillas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acceso_plantillas_select" ON acceso_plantillas;
CREATE POLICY "acceso_plantillas_select"
  ON acceso_plantillas FOR SELECT TO authenticated USING (true);

GRANT SELECT ON acceso_plantillas TO authenticated;

-- ─── Plantillas de arranque ─────────────────────────────────────────────────
-- Se crean solo si la tabla está vacía, para no pisar nada si esta migración
-- se corre dos veces. Los IDs salen de SIDEBAR_SECTIONS.
INSERT INTO acceso_plantillas (nombre, secciones)
SELECT * FROM (VALUES
  ('Acceso total', ARRAY[
    'buscador','servicios-planillas','matriculas','matriculas-familias',
    'servicios-resumen','stock-zona','transformadores-resumen','transformadores-carga',
    'transformadores-tabla','transformadores-consumo','transformadores-consumo-carga',
    'sic-diagrama','informe-tecnico','indice-ido-resumen','indice-ido-carga',
    'tablero-op-resumen','tablero-op-carga','yerba'
  ]),
  ('Servicios', ARRAY[
    'buscador','servicios-planillas','servicios-resumen','matriculas','yerba'
  ]),
  ('Transformadores', ARRAY[
    'buscador','transformadores-resumen','transformadores-carga','transformadores-tabla',
    'transformadores-consumo','transformadores-consumo-carga','yerba'
  ]),
  ('Solo consulta', ARRAY['buscador','yerba'])
) AS v(nombre, secciones)
WHERE NOT EXISTS (SELECT 1 FROM acceso_plantillas);
