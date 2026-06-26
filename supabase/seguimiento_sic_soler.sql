-- ============================================================================
-- seguimiento_sic_soler — Planilla maestra de SICs del Ing. Soler
--
-- Lista de SICs (solicitudes internas de compra) del preparador Soler, subida
-- desde "Carga de datos". Es la fuente para la carga masiva de "Crear
-- seguimiento": cada línea se cruza con planillas_op (cantidades, fecha
-- pactada, proveedor, estado) y matriculas (descripción) para generar la tabla
-- `seguimiento`.
--
-- Grano: (numero_sic, linea). numero_op puede ser null hasta que la SIC genere
-- la OP. Ver lib/sicSoler.ts y CUBO_DATOS.md (planilla SIC).
-- ============================================================================

CREATE TABLE IF NOT EXISTS seguimiento_sic_soler (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_sic     text NOT NULL,
  linea          text NOT NULL DEFAULT '',   -- '' en vez de null: clave estable
  articulo       text,                        -- matrícula (tal cual del Excel)
  descripcion    text,
  cantidad       numeric,
  udm            text,
  preparador     text,
  numero_op      text,                        -- Número Pedido (la OP), puede ser null
  fecha_creacion text,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (numero_sic, linea)
);

CREATE INDEX IF NOT EXISTS idx_sic_soler_numero_op ON seguimiento_sic_soler (numero_op);
CREATE INDEX IF NOT EXISTS idx_sic_soler_articulo  ON seguimiento_sic_soler (articulo);

-- RLS permisiva, igual que el resto de las tablas que opera la app con anon key.
ALTER TABLE seguimiento_sic_soler ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "seguimiento_sic_soler_all" ON seguimiento_sic_soler;
CREATE POLICY "seguimiento_sic_soler_all" ON seguimiento_sic_soler FOR ALL USING (true) WITH CHECK (true);
