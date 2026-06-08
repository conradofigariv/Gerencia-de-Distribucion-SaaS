-- ============================================================================
-- Tablero OP — Control de Ingresos por Orden de Provisión
-- Reemplaza la planilla Excel que cruza la lista de SIC a seguir contra el
-- log de transacciones (Recibir / Aceptar / Entregar / Devoluciones) y el
-- stock por zona. La función gd_tablero() (ver tablero_op_funcion.sql) hace
-- el cruce y cálculo; estas tablas son las fuentes de datos.
--
-- Prefijo tablero_op_ para no chocar con la tabla `seguimiento` ya usada por
-- el módulo "Control de Servicios" (servicios-tabla / servicios-resumen).
-- ============================================================================

-- Seguimiento: carga manual — lista de SIC (líneas) a seguir.
-- numero_sic identifica la línea a seguir; numero_op puede ser null hasta
-- que la SIC se apruebe y se genere la Orden de Provisión.
CREATE TABLE IF NOT EXISTS tablero_op_seguimiento (
  numero_sic     bigint PRIMARY KEY,
  linea          text,
  articulo       text NOT NULL,   -- normalizado: sin sufijo .0, zero-padding original
  descripcion    text,
  cantidad       numeric,
  udm            text,
  ctd_entregada  numeric NOT NULL DEFAULT 0,
  numero_op      bigint,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- OP: maestro de líneas, importado desde la pestaña "OP's" del Excel.
-- Una OP (numero) tiene MÚLTIPLES líneas (una por artículo) → numero NO es
-- único. Se usa un uuid como PK y se indexa numero para el cruce.
CREATE TABLE IF NOT EXISTS tablero_op_op (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero       bigint NOT NULL,      -- Número Pedido (se repite por línea)
  linea        text,
  articulo     text,                 -- normalizado: sin sufijo .0
  descripcion  text,
  udm          text,
  cantidad     numeric,
  proveedor    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Transacción: log de movimientos, importado desde la pestaña "Transacciones".
-- Crece rápido (60k+ filas) — sin PK natural, se usa uuid + índices para que
-- la carga incremental y el cruce de gd_tablero() sean eficientes.
CREATE TABLE IF NOT EXISTS tablero_op_transaccion (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo           text NOT NULL,      -- Recibir, Aceptar, Entregar, Rechazar, Devolver a Proveedor, Devolver a Recepción, Corregir, ...
  importe        numeric NOT NULL DEFAULT 0,
  fecha          timestamptz NOT NULL,
  articulo       text NOT NULL,      -- normalizado: sin sufijo .0
  numero_pedido  bigint NOT NULL,    -- = Número OP
  linea          text,
  proveedor      text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Stock: saldo actual por artículo y zona, importado desde la pestaña "Stock".
CREATE TABLE IF NOT EXISTS tablero_op_stock (
  organizacion  text NOT NULL,       -- zona, ej. ZA
  articulo      text NOT NULL,       -- normalizado: sin sufijo .0
  en_mano       numeric NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacion, articulo)
);

-- ─── Índices ────────────────────────────────────────────────────────────────
-- El cruce de gd_tablero() agrupa transacciones por (numero_pedido, articulo)
-- y filtra por rango de fecha — este índice cubre ese acceso.
CREATE INDEX IF NOT EXISTS idx_tablero_op_transaccion_pedido_articulo_fecha
  ON tablero_op_transaccion (numero_pedido, articulo, fecha);
CREATE INDEX IF NOT EXISTS idx_tablero_op_transaccion_articulo
  ON tablero_op_transaccion (articulo);
CREATE INDEX IF NOT EXISTS idx_tablero_op_seguimiento_numero_op
  ON tablero_op_seguimiento (numero_op);
CREATE INDEX IF NOT EXISTS idx_tablero_op_op_articulo
  ON tablero_op_op (articulo);
CREATE INDEX IF NOT EXISTS idx_tablero_op_op_numero
  ON tablero_op_op (numero);

-- ─── updated_at automático ──────────────────────────────────────────────────
-- Reutiliza/crea la función set_updated_at (ya definida en ido_datos.sql);
-- CREATE OR REPLACE la deja idempotente si este script corre solo.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tablero_op_seguimiento_updated_at ON tablero_op_seguimiento;
CREATE TRIGGER trg_tablero_op_seguimiento_updated_at
  BEFORE UPDATE ON tablero_op_seguimiento
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_tablero_op_op_updated_at ON tablero_op_op;
CREATE TRIGGER trg_tablero_op_op_updated_at
  BEFORE UPDATE ON tablero_op_op
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_tablero_op_stock_updated_at ON tablero_op_stock;
CREATE TRIGGER trg_tablero_op_stock_updated_at
  BEFORE UPDATE ON tablero_op_stock
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Policy permisiva, igual que el resto de las tablas que opera la app con la
-- anon key (ver ido_datos.sql / stock_article_families).
ALTER TABLE tablero_op_seguimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE tablero_op_op          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tablero_op_transaccion ENABLE ROW LEVEL SECURITY;
ALTER TABLE tablero_op_stock       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tablero_op_seguimiento_all" ON tablero_op_seguimiento;
CREATE POLICY "tablero_op_seguimiento_all" ON tablero_op_seguimiento FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "tablero_op_op_all" ON tablero_op_op;
CREATE POLICY "tablero_op_op_all" ON tablero_op_op FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "tablero_op_transaccion_all" ON tablero_op_transaccion;
CREATE POLICY "tablero_op_transaccion_all" ON tablero_op_transaccion FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "tablero_op_stock_all" ON tablero_op_stock;
CREATE POLICY "tablero_op_stock_all" ON tablero_op_stock FOR ALL USING (true) WITH CHECK (true);
