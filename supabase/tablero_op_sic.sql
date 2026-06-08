-- ============================================================================
-- Tablero OP — tabla maestra de SIC (planilla completa).
--
-- "SIC a seguir" pasa a pegar solo NÚMEROS de SIC; los datos (artículo,
-- descripción, cantidad, UDM, Ctd Entregada, Número Pedido) se cruzan contra
-- esta planilla. Una SIC (numero) puede tener varias líneas → PK uuid.
--
-- Columnas usadas de la planilla (las demás se descartan al importar):
--   Número · Línea · Artículo · Descripción · Cantidad · UDM · Ctd Entregada · Número Pedido
-- ============================================================================

CREATE TABLE IF NOT EXISTS tablero_op_sic (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero        bigint NOT NULL,      -- Número de SIC (se repite por línea)
  linea         text,
  articulo      text,                 -- normalizado: sin sufijo .0
  descripcion   text,
  cantidad      numeric,
  udm           text,
  ctd_entregada numeric NOT NULL DEFAULT 0,
  numero_pedido bigint,               -- = Número OP (null hasta aprobarse)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tablero_op_sic_numero   ON tablero_op_sic (numero);
CREATE INDEX IF NOT EXISTS idx_tablero_op_sic_articulo ON tablero_op_sic (articulo);

-- updated_at automático (reutiliza la función ya existente).
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tablero_op_sic_updated_at ON tablero_op_sic;
CREATE TRIGGER trg_tablero_op_sic_updated_at
  BEFORE UPDATE ON tablero_op_sic
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS permisiva (igual que el resto de las tablas del módulo).
ALTER TABLE tablero_op_sic ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tablero_op_sic_all" ON tablero_op_sic;
CREATE POLICY "tablero_op_sic_all" ON tablero_op_sic FOR ALL USING (true) WITH CHECK (true);
