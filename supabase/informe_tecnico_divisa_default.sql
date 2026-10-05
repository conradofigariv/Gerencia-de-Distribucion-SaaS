-- ============================================================================
-- Informe Técnico → Ofertas: moneda por defecto de cada oferente.
--
-- En la grilla de ofertas cada oferente tiene un chip «USD / ARS» en su
-- encabezado: es la moneda con la que arranca una celda NUEVA de ese oferente
-- (las ya cargadas conservan la suya; la moneda es por celda, ver
-- licitacion_ofertas.divisa). También es la moneda en la que se muestra el
-- total de su oferta. «Cambiar todas las divisas» la cambia para todos.
--
-- Correr UNA vez en el SQL Editor de Supabase. Idempotente.
-- Sin este script la grilla funciona igual (todo arranca en ARS), pero el
-- chip no puede guardar el cambio y avisa que falta correrlo.
-- ============================================================================

ALTER TABLE licitacion_oferentes
  ADD COLUMN IF NOT EXISTS divisa_default text NOT NULL DEFAULT 'ARS';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'licitacion_oferentes_divisa_default_chk'
  ) THEN
    ALTER TABLE licitacion_oferentes
      ADD CONSTRAINT licitacion_oferentes_divisa_default_chk CHECK (divisa_default IN ('USD', 'ARS'));
  END IF;
END $$;
