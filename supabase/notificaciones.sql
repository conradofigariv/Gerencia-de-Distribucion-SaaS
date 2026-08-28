-- ============================================================================
-- Sistema de notificaciones multiusuario — Parte 1: base + recordatorios
--
-- Reemplaza las cuatro islas que había (recordatorios globales en
-- `section_reminders`, alarmas de transformadores en localStorage, alertas de
-- servicios hardcodeadas en el render, y nada para stock) por UN solo motor
-- que alimenta la campana.
--
-- ── El modelo ───────────────────────────────────────────────────────────────
-- Dos tablas, las dos POR USUARIO:
--
--   notif_reglas    → qué quiere vigilar cada uno y con qué parámetros.
--   notif_descartes → qué ya descartó, y CON QUÉ ESTADO lo descartó.
--
-- ── Por qué la regla es por usuario y el dato es global ─────────────────────
-- `section_reminders.last_updated_at` (cuándo se subió la planilla por última
-- vez) es un HECHO de la oficina: si alguien sube la planilla de OP, se subió
-- para todos. Eso sigue viviendo en `section_reminders`, compartido.
--
-- Lo que pasa a ser de cada uno es el CRITERIO: cada cuántos días quiere que
-- le recuerden, a qué hora, y si le interesa esa carga o no. Antes estaba
-- todo mezclado en la misma fila y cambiar la frecuencia se la cambiaba a
-- toda la oficina.
--
-- ── El descarte por huella ──────────────────────────────────────────────────
-- `huella` es el estado que disparó la alarma cuando el usuario la descartó
-- (ej. 'stock=3'). En cada evaluación se compara la huella actual contra la
-- descartada:
--   • iguales   → sigue silenciada (no hay novedad, no molestar).
--   • distintas → reaparece (el problema cambió: empeoró, o se arregló y
--                 volvió).
-- Así "silenciar" no entierra nada: un stock que sigue bajando vuelve a
-- avisar solo, sin que nadie tenga que acordarse de revisar.
-- ============================================================================

-- ─── Reglas ─────────────────────────────────────────────────────────────────
-- `config` es jsonb porque cada tipo de alarma tiene parámetros distintos y
-- van a seguir apareciendo tipos nuevos (partes 2, 3 y 4). Una columna por
-- parámetro obligaría a un ALTER TABLE por cada tipo nuevo.
--
--   tipo = 'carga'           → { section_id, frecuencia_dias, hora }
--   tipo = 'servicios'       → (parte 2)
--   tipo = 'transformadores' → (parte 3)
--   tipo = 'stock'           → (parte 4)
CREATE TABLE IF NOT EXISTS notif_reglas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN ('carga', 'servicios', 'transformadores', 'stock')),
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  activa     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_reglas_user ON notif_reglas (user_id, tipo);

-- Una sola regla de carga por sección y usuario: dos recordatorios para la
-- misma planilla no tendría sentido (¿cuál gana?). Los otros tipos SÍ admiten
-- varias reglas (ej. tres umbrales de stock distintos), por eso el índice es
-- parcial y no una UNIQUE de tabla.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_reglas_carga_unica
  ON notif_reglas (user_id, (config->>'section_id'))
  WHERE tipo = 'carga';

ALTER TABLE notif_reglas ENABLE ROW LEVEL SECURITY;

-- RLS real, no permisiva: las reglas son personales. A diferencia del resto de
-- las tablas de la app (que usan `USING (true)` porque el dato es de la
-- oficina), acá cada usuario tiene que ver y tocar SOLO lo suyo — si no,
-- cualquiera podría cambiarle los recordatorios a otro.
DROP POLICY IF EXISTS "notif_reglas_propias" ON notif_reglas;
CREATE POLICY "notif_reglas_propias" ON notif_reglas
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── Descartes ──────────────────────────────────────────────────────────────
-- `clave` identifica la alarma (ej. 'carga:planillas-OP'); `huella` es el
-- estado con el que se descartó (ver el comentario largo de arriba).
CREATE TABLE IF NOT EXISTS notif_descartes (
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  clave          text NOT NULL,
  huella         text NOT NULL,
  descartado_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, clave)
);

ALTER TABLE notif_descartes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notif_descartes_propios" ON notif_descartes;
CREATE POLICY "notif_descartes_propios" ON notif_descartes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON notif_reglas    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON notif_descartes TO authenticated;

-- ─── section_reminders: queda, pero solo con el hecho compartido ────────────
-- No se borra ninguna columna todavía: `frequency_days` / `reminder_time` /
-- `enabled` siguen ahí para que una pestaña abierta con el código viejo no
-- reviente a mitad de deploy. Pasan a estar IGNORADAS por el código nuevo —
-- el criterio ahora sale de notif_reglas. Se pueden borrar en una limpieza
-- posterior, cuando no quede nadie con la versión vieja cargada.
--
-- Lo único que el motor nuevo lee de acá es `last_updated_at`: cuándo se
-- subió esa planilla por última vez, para toda la oficina.

-- La tabla puede no existir todavía en una base nueva.
CREATE TABLE IF NOT EXISTS section_reminders (
  section_id      text PRIMARY KEY,
  section_name    text NOT NULL,
  frequency_days  integer,
  reminder_time   text,
  last_updated_at timestamptz,
  last_updated_by uuid,
  enabled         boolean NOT NULL DEFAULT true
);

ALTER TABLE section_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "section_reminders_all" ON section_reminders;
CREATE POLICY "section_reminders_all" ON section_reminders
  FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON section_reminders TO anon, authenticated;
