-- ============================================================================
-- tablero_op_transaccion — log de movimientos de SIGA (Recibir / Aceptar /
-- Entregar / Devoluciones / ...).
--
-- Se carga desde «Carga de datos → TRANSACCIONES» (servicios-planillas.tsx) y
-- la usan el Buscador (índice busqueda_index y detalle de entregas, ver
-- busqueda_global.sql / buscador_entregas.sql) y sic_precio_importe.sql.
--
-- Historia: nació para la sección «Tablero OP», que se eliminó (la reemplazó
-- el Buscador). La tabla conserva el prefijo tablero_op_ porque renombrarla
-- obligaría a migrar todas las funciones SQL que la leen. Las otras tablas
-- del Tablero (tablero_op_seguimiento, tablero_op_stock, tablero_op_sic) y la
-- función gd_tablero() ya no se usan desde la app; se borran con
-- tablero_op_drop_legacy.sql.
-- ============================================================================

-- Crece rápido (60k+ filas) — sin PK natural, se usa uuid + índices.
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

-- ─── Índices ────────────────────────────────────────────────────────────────
-- Los cruces agrupan transacciones por (numero_pedido, articulo) y filtran por
-- rango de fecha — este índice cubre ese acceso.
CREATE INDEX IF NOT EXISTS idx_tablero_op_transaccion_pedido_articulo_fecha
  ON tablero_op_transaccion (numero_pedido, articulo, fecha);
CREATE INDEX IF NOT EXISTS idx_tablero_op_transaccion_articulo
  ON tablero_op_transaccion (articulo);

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Policy permisiva, igual que el resto de las tablas que opera la app con la
-- anon key (ver ido_datos.sql / stock_article_families).
ALTER TABLE tablero_op_transaccion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tablero_op_transaccion_all" ON tablero_op_transaccion;
CREATE POLICY "tablero_op_transaccion_all" ON tablero_op_transaccion FOR ALL USING (true) WITH CHECK (true);
