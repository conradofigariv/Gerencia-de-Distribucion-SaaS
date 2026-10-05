-- ============================================================================
-- Informe Técnico → Ofertas: estado «No cotiza» por celda.
--
-- Cada celda (oferente × ítem) tiene TRES estados, nunca dos a la vez:
--   • pendiente → no hay fila en licitacion_ofertas;
--   • cargado   → fila con precio_unitario y no_cotiza = false;
--   • no cotiza → fila con no_cotiza = true y precio_unitario NULL.
-- El CHECK de abajo hace imposible guardar un estado contradictorio (precio Y
-- no cotiza, o ninguno de los dos).
--
-- El chip de cobertura del renglón NO se guarda: la pantalla lo calcula
-- siempre a partir de los estados de sus celdas.
--
-- Adjudicación y Evaluación técnica ignoran las filas «no cotiza»: un renglón
-- con algún ítem no cotizado queda con cobertura parcial y no compite.
--
-- Correr UNA vez en el SQL Editor de Supabase. Idempotente. No modifica
-- ninguna oferta existente: todas tienen precio, así que quedan «cargado».
-- ============================================================================

ALTER TABLE licitacion_ofertas
  ADD COLUMN IF NOT EXISTS no_cotiza boolean NOT NULL DEFAULT false;

ALTER TABLE licitacion_ofertas
  ALTER COLUMN precio_unitario DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'licitacion_ofertas_estado_chk'
  ) THEN
    ALTER TABLE licitacion_ofertas
      ADD CONSTRAINT licitacion_ofertas_estado_chk CHECK (
        (no_cotiza AND precio_unitario IS NULL)
        OR (NOT no_cotiza AND precio_unitario IS NOT NULL)
      );
  END IF;
END $$;
