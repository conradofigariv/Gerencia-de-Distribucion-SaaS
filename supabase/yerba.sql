-- ============================================================================
-- Control de Yerba — de quién es el turno de comprar
--
-- Dos tablas: los PARTICIPANTES de la ronda (en orden) y el HISTORIAL de
-- compras. El turno no se guarda: se deriva del orden + la última compra (ver
-- abajo), así no hay un puntero que pueda quedar desincronizado del historial.
--
-- ── Participantes ───────────────────────────────────────────────────────────
-- Un participante puede ser un usuario registrado (`user_id` apunta a
-- `profiles`) o alguien cargado a mano con solo un nombre (`user_id` NULL,
-- `nombre` con el texto). Las dos formas conviven en la misma tabla, y por eso
-- `nombre` existe siempre: para los registrados se guarda una copia del nombre
-- al momento de sumarlos, que sirve de respaldo si el perfil se borra.
--
-- Es UNA lista compartida por toda la oficina, no una por usuario: es un
-- asunto de la oficina, y si cada uno tuviera la suya no habría un único turno
-- del que hablar. Por eso no hay columna de dueño ni RLS por usuario.
--
-- ── Cómo se calcula el turno ────────────────────────────────────────────────
-- Rotación en ORDEN FIJO (`orden`), no por antigüedad: el próximo es el que
-- sigue —en la lista, dando la vuelta— al que compró último. Se deriva en el
-- cliente a partir de estas dos tablas; ver `proximoTurno()` en lib/yerba.ts.
--
-- ── La regla del kilo ───────────────────────────────────────────────────────
-- Cada compra es 1 kg de UNA marca, o 1/2 kg de DOS marcas (para poder
-- comparar). Eso son 1 o 2 filas en `yerba_compra_marca` por compra, y el
-- CHECK de `kilos` deja pasar solo esos dos valores. La cantidad de marcas se
-- valida en el cliente al cargar.
-- ============================================================================

CREATE TABLE IF NOT EXISTS yerba_participantes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = participante manual (solo nombre). Si el perfil se borra, la fila
  -- queda con user_id NULL y sigue viviendo por su `nombre`: sacarla del
  -- historial de turnos por una baja de usuario sería peor que dejarla.
  user_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  nombre     text NOT NULL,
  orden      integer NOT NULL DEFAULT 0,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Un mismo usuario registrado no puede estar dos veces en la ronda. Los
-- manuales no entran en el índice (user_id NULL), así que puede haber dos
-- "Juan" a mano si de verdad son dos personas distintas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_yerba_part_user
  ON yerba_participantes (user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_yerba_part_orden ON yerba_participantes (orden);

CREATE TABLE IF NOT EXISTS yerba_compras (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Quién compró. ON DELETE CASCADE: si se saca a alguien de la ronda, sus
  -- compras se van con él — el historial existe para calcular el turno, y el
  -- de alguien que ya no participa no aporta nada.
  participante_id uuid NOT NULL REFERENCES yerba_participantes(id) ON DELETE CASCADE,
  fecha          date NOT NULL DEFAULT CURRENT_DATE,
  nota           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES auth.users
);

CREATE INDEX IF NOT EXISTS idx_yerba_compras_fecha ON yerba_compras (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_yerba_compras_part  ON yerba_compras (participante_id);

CREATE TABLE IF NOT EXISTS yerba_compra_marca (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id  uuid NOT NULL REFERENCES yerba_compras(id) ON DELETE CASCADE,
  marca      text NOT NULL,
  -- Solo 1 kg (una marca) o 0.5 kg (dos marcas). Cualquier otro valor rompe la
  -- regla de la oficina, así que no debería poder guardarse.
  kilos      numeric NOT NULL CHECK (kilos IN (0.5, 1)),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yerba_marca_compra ON yerba_compra_marca (compra_id);
-- Para el listado de marcas ya usadas (autocompletar al cargar una compra).
CREATE INDEX IF NOT EXISTS idx_yerba_marca_marca  ON yerba_compra_marca (marca);

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Mismo criterio que `op_datos` y `matricula_tipo`: dato compartido del
-- equipo, cualquier autenticado lee y escribe. No hay nada sensible acá y
-- restringir quién puede anotar una compra de yerba sería más molesto que útil.

ALTER TABLE yerba_participantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE yerba_compras       ENABLE ROW LEVEL SECURITY;
ALTER TABLE yerba_compra_marca  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "yerba_participantes_auth" ON yerba_participantes;
CREATE POLICY "yerba_participantes_auth" ON yerba_participantes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "yerba_compras_auth" ON yerba_compras;
CREATE POLICY "yerba_compras_auth" ON yerba_compras
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "yerba_compra_marca_auth" ON yerba_compra_marca;
CREATE POLICY "yerba_compra_marca_auth" ON yerba_compra_marca
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON yerba_participantes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON yerba_compras       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON yerba_compra_marca  TO authenticated;
