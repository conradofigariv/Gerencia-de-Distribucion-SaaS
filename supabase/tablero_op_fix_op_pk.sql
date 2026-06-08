-- ============================================================================
-- Tablero OP — fix: tablero_op_op debe permitir MÚLTIPLES líneas por OP.
--
-- La versión original definía `numero bigint PRIMARY KEY`, pero una OP tiene
-- varias líneas (una por artículo) → al importar más de una línea de la misma
-- OP saltaba: duplicate key value violates unique constraint "tablero_op_op_pkey".
--
-- Este script migra la tabla existente a un PK uuid (id) con numero indexado.
-- Idempotente: se puede correr aunque ya esté migrada.
-- ============================================================================

-- Agrega columna udm si falta (el import la carga).
ALTER TABLE tablero_op_op ADD COLUMN IF NOT EXISTS udm text;

-- Agrega columna id uuid si falta.
ALTER TABLE tablero_op_op ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();

-- Rellena id en filas viejas que pudieran tenerlo nulo.
UPDATE tablero_op_op SET id = gen_random_uuid() WHERE id IS NULL;

-- Quita el PK viejo (sobre numero) y pone el nuevo (sobre id).
ALTER TABLE tablero_op_op DROP CONSTRAINT IF EXISTS tablero_op_op_pkey;
ALTER TABLE tablero_op_op ALTER COLUMN id SET NOT NULL;
ALTER TABLE tablero_op_op ADD PRIMARY KEY (id);

-- numero deja de ser único, pero sigue siendo obligatorio.
ALTER TABLE tablero_op_op ALTER COLUMN numero SET NOT NULL;

-- Índice para el cruce por numero (gd_tablero busca proveedor por OP).
CREATE INDEX IF NOT EXISTS idx_tablero_op_op_numero ON tablero_op_op (numero);

-- ── Después de correr esto, reaplicá la función gd_tablero ──────────────────
-- (volvé a ejecutar el contenido de supabase/tablero_op_funcion.sql, que ya
--  resuelve el proveedor por subquery en vez de JOIN).
