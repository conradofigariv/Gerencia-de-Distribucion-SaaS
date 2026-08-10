-- ============================================================================
-- Compartir pestañas del Buscador con otros usuarios
--
-- Modelo elegido: se comparte con usuarios ESPECÍFICOS (elegidos de a uno,
-- buscándolos por nombre en `profiles`), con un permiso por persona —
-- «lectura» (solo ver) o «edición» (editar datos y la vista) — y una vista
-- ÚNICA compartida: columnas, orden y agrupado son los mismos para todo el
-- que abre la pestaña (el mismo `buscador_tabs.config` de siempre, sin vistas
-- personales por usuario).
--
-- Por eso «editar» en este modelo es amplio: además de las filas, un editor
-- puede tocar `config` (reordenar columnas, cambiar el agrupado — afecta lo
-- que ven los demás) y renombrar la pestaña. Lo único reservado al DUEÑO es
-- borrar la pestaña y gestionar quién tiene acceso (agregar/sacar
-- colaboradores, cambiarles el permiso): un editor no puede transferir la
-- pestaña ni tocar la lista de compartidos. Ver el trigger
-- `gd_bloquear_cambio_dueno_pestana` más abajo para la traba de ownership.
-- ============================================================================

-- ─── Tabla de shares ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS buscador_tab_shares (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_id     uuid REFERENCES buscador_tabs (id) ON DELETE CASCADE NOT NULL,
  user_id    uuid REFERENCES auth.users NOT NULL,
  permiso    text NOT NULL DEFAULT 'edicion' CHECK (permiso IN ('lectura', 'edicion')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tab_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_buscador_tab_shares_tab  ON buscador_tab_shares (tab_id);
CREATE INDEX IF NOT EXISTS idx_buscador_tab_shares_user ON buscador_tab_shares (user_id);

ALTER TABLE buscador_tab_shares ENABLE ROW LEVEL SECURITY;

-- ─── Funciones de permiso (SECURITY DEFINER) ────────────────────────────────
-- Evitan la recursión de RLS: una policy de `buscador_tabs` que consultara
-- `buscador_tab_shares` directamente dispararía la RLS de esa segunda tabla,
-- que a su vez podría necesitar mirar `buscador_tabs`, etc. Al ser
-- SECURITY DEFINER (dueñas por el rol que corre el SQL Editor, con permiso de
-- saltar RLS) resuelven la pregunta «puede fulano ver/editar esta pestaña»
-- sin volver a pasar por las policies de nadie.

CREATE OR REPLACE FUNCTION gd_puede_leer_pestana(p_tab_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM buscador_tabs t
     WHERE t.id = p_tab_id AND t.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM buscador_tab_shares s
     WHERE s.tab_id = p_tab_id AND s.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION gd_puede_editar_pestana(p_tab_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM buscador_tabs t
     WHERE t.id = p_tab_id AND t.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM buscador_tab_shares s
     WHERE s.tab_id = p_tab_id AND s.user_id = auth.uid() AND s.permiso = 'edicion'
  );
$$;

GRANT EXECUTE ON FUNCTION gd_puede_leer_pestana(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION gd_puede_editar_pestana(uuid) TO authenticated;

-- ─── Traba: nadie (ni un editor) puede transferir la pestaña ────────────────
-- La policy de UPDATE de `buscador_tabs` de abajo permite editar a dueño Y
-- editores compartidos, pero eso NO debe incluir poder cambiar `user_id` —
-- si no, un editor podría auto-asignarse la pestaña con un UPDATE directo a
-- la API. RLS por sí sola no distingue columnas dentro de un UPDATE, así que
-- la traba real es este trigger.
CREATE OR REPLACE FUNCTION gd_bloquear_cambio_dueno_pestana()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'No se puede cambiar el dueño de una pestaña.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloquear_cambio_dueno_pestana ON buscador_tabs;
CREATE TRIGGER trg_bloquear_cambio_dueno_pestana
  BEFORE UPDATE ON buscador_tabs
  FOR EACH ROW EXECUTE FUNCTION gd_bloquear_cambio_dueno_pestana();

-- ─── RLS: buscador_tabs ──────────────────────────────────────────────────────
-- Reemplaza la policy única "todo para el dueño" de buscador_tabs.sql por una
-- por operación, para poder abrir SELECT/UPDATE a los colaboradores sin
-- tocar INSERT/DELETE (crear y borrar siguen siendo solo del dueño).

DROP POLICY IF EXISTS "buscador_tabs_own" ON buscador_tabs;

DROP POLICY IF EXISTS "buscador_tabs_select" ON buscador_tabs;
CREATE POLICY "buscador_tabs_select"
  ON buscador_tabs FOR SELECT TO authenticated
  USING (gd_puede_leer_pestana(id));

DROP POLICY IF EXISTS "buscador_tabs_insert" ON buscador_tabs;
CREATE POLICY "buscador_tabs_insert"
  ON buscador_tabs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "buscador_tabs_update" ON buscador_tabs;
CREATE POLICY "buscador_tabs_update"
  ON buscador_tabs FOR UPDATE TO authenticated
  USING (gd_puede_editar_pestana(id))
  WITH CHECK (gd_puede_editar_pestana(id));

DROP POLICY IF EXISTS "buscador_tabs_delete" ON buscador_tabs;
CREATE POLICY "buscador_tabs_delete"
  ON buscador_tabs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ─── RLS: buscador_tab_filas ─────────────────────────────────────────────────
-- Mismo reemplazo: antes "todo si sos dueño de la pestaña", ahora lectura
-- para cualquier colaborador y escritura solo para dueño + editores.

DROP POLICY IF EXISTS "buscador_tab_filas_own" ON buscador_tab_filas;

DROP POLICY IF EXISTS "buscador_tab_filas_select" ON buscador_tab_filas;
CREATE POLICY "buscador_tab_filas_select"
  ON buscador_tab_filas FOR SELECT TO authenticated
  USING (gd_puede_leer_pestana(tab_id));

DROP POLICY IF EXISTS "buscador_tab_filas_insert" ON buscador_tab_filas;
CREATE POLICY "buscador_tab_filas_insert"
  ON buscador_tab_filas FOR INSERT TO authenticated
  WITH CHECK (gd_puede_editar_pestana(tab_id));

DROP POLICY IF EXISTS "buscador_tab_filas_update" ON buscador_tab_filas;
CREATE POLICY "buscador_tab_filas_update"
  ON buscador_tab_filas FOR UPDATE TO authenticated
  USING (gd_puede_editar_pestana(tab_id))
  WITH CHECK (gd_puede_editar_pestana(tab_id));

DROP POLICY IF EXISTS "buscador_tab_filas_delete" ON buscador_tab_filas;
CREATE POLICY "buscador_tab_filas_delete"
  ON buscador_tab_filas FOR DELETE TO authenticated
  USING (gd_puede_editar_pestana(tab_id));

-- ─── RLS: buscador_tab_shares ────────────────────────────────────────────────
-- Cualquier colaborador (dueño, editor o lector) puede VER la lista completa
-- de con quién está compartida una pestaña — es informativo («compartida con
-- Ana, Pedro») y de bajo riesgo. Solo el DUEÑO puede agregar, cambiar el
-- permiso o sacar colaboradores.

DROP POLICY IF EXISTS "buscador_tab_shares_select" ON buscador_tab_shares;
CREATE POLICY "buscador_tab_shares_select"
  ON buscador_tab_shares FOR SELECT TO authenticated
  USING (gd_puede_leer_pestana(tab_id));

DROP POLICY IF EXISTS "buscador_tab_shares_insert" ON buscador_tab_shares;
CREATE POLICY "buscador_tab_shares_insert"
  ON buscador_tab_shares FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM buscador_tabs t WHERE t.id = tab_id AND t.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "buscador_tab_shares_update" ON buscador_tab_shares;
CREATE POLICY "buscador_tab_shares_update"
  ON buscador_tab_shares FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM buscador_tabs t WHERE t.id = tab_id AND t.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM buscador_tabs t WHERE t.id = tab_id AND t.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "buscador_tab_shares_delete" ON buscador_tab_shares;
CREATE POLICY "buscador_tab_shares_delete"
  ON buscador_tab_shares FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM buscador_tabs t WHERE t.id = tab_id AND t.user_id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON buscador_tab_shares TO authenticated;

-- ─── Búsqueda de gente para compartir ────────────────────────────────────────
-- `profiles` ya es legible por cualquier autenticado desde profile_cumpleanos.sql
-- (policy "profiles_select_authenticated"), así que el picker de "compartir
-- con..." no necesita SQL nuevo: alcanza con
--   SELECT id, nombre, apellido, avatar_url FROM profiles
-- filtrado en el cliente por nombre. Se deja esta nota para no duplicar la
-- policy por error si algún día se audita este archivo aisladamente.
