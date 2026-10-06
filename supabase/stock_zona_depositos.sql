-- ============================================================================
-- Stock por Zona → Mapa: dónde está el DEPÓSITO de cada zona
--
-- El mapa mide la distancia de la obra al stock de cada zona. Por defecto usa
-- la localidad de la delegación sede (Córdoba, Villa María, Río Cuarto…). Si el
-- depósito de una zona está en otra localidad, se guarda acá y las distancias
-- (en línea recta y por ruta) pasan a medirse desde ese punto.
--
-- Una fila por unidad territorial: A, BN, BS, C…H (B va dividida porque el
-- stock llega separado: ZB = BN y ZI = BS). Sin fila = se usa la sede.
-- Volver a la sede = borrar la fila.
--
-- Dato compartido por toda la oficina (no por usuario): mismo criterio que
-- stock_uploads. `updated_by` es solo para saber quién lo cambió.
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_zona_depositos (
  unidad     text PRIMARY KEY CHECK (unidad IN ('A','BN','BS','C','D','E','F','G','H')),
  localidad  text NOT NULL,
  lat        double precision NOT NULL,
  lon        double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);

ALTER TABLE stock_zona_depositos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_zona_depositos_auth" ON stock_zona_depositos;
CREATE POLICY "stock_zona_depositos_auth" ON stock_zona_depositos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_zona_depositos TO authenticated;
