-- ============================================================================
-- Tablero OP — fix: tablero_op_seguimiento debe permitir MÚLTIPLES líneas
-- por SIC.
--
-- La versión original definía `numero_sic bigint PRIMARY KEY`, pero una SIC
-- (solicitud interna de compra) puede traer varias líneas — distintos
-- artículos pedidos juntos (línea 1, línea 2, ...) — e incluso líneas
-- "ampliadas" cuando se vuelve a pedir/recontratar (notación 1,1 / 2,2).
-- Con `numero_sic` como PK, el upsert de la 2ª línea pisaba la 1ª en vez de
-- agregarla → se perdían líneas. La clave real es (numero_sic, linea).
--
-- Este script migra la tabla existente a un PK uuid (id) + UNIQUE
-- (numero_sic, linea), con numero_sic indexado para el cruce.
-- Idempotente: se puede correr aunque ya esté migrada.
-- ============================================================================

-- Agrega columna id uuid si falta.
ALTER TABLE tablero_op_seguimiento ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();

-- Rellena id en filas viejas que pudieran tenerlo nulo.
UPDATE tablero_op_seguimiento SET id = gen_random_uuid() WHERE id IS NULL;

-- Quita el PK viejo (sobre numero_sic) y pone el nuevo (sobre id).
ALTER TABLE tablero_op_seguimiento DROP CONSTRAINT IF EXISTS tablero_op_seguimiento_pkey;
ALTER TABLE tablero_op_seguimiento ALTER COLUMN id SET NOT NULL;
ALTER TABLE tablero_op_seguimiento ADD PRIMARY KEY (id);

-- numero_sic deja de ser único (puede repetirse por línea), pero sigue siendo obligatorio.
ALTER TABLE tablero_op_seguimiento ALTER COLUMN numero_sic SET NOT NULL;

-- Clave real de una línea de seguimiento: (numero_sic, linea). La usa el
-- upsert (onConflict) para insertar líneas nuevas y actualizar existentes
-- sin pisarse entre sí.
ALTER TABLE tablero_op_seguimiento DROP CONSTRAINT IF EXISTS tablero_op_seguimiento_sic_linea_key;
ALTER TABLE tablero_op_seguimiento ADD CONSTRAINT tablero_op_seguimiento_sic_linea_key UNIQUE (numero_sic, linea);

-- Índice para el cruce/filtro por numero_sic (ya no es PK).
CREATE INDEX IF NOT EXISTS idx_tablero_op_seguimiento_numero_sic ON tablero_op_seguimiento (numero_sic);
