-- ============================================================================
-- Tablero OP — borrar lo que quedó en la base tras eliminar la sección.
--
-- La sección «Tablero OP» se eliminó (la reemplazó el Buscador). Estos objetos
-- quedaron en Supabase sin uso desde la app:
--   • tablero_op_seguimiento  (pestaña «SIC a seguir»)
--   • tablero_op_stock        (stock por organización del Tablero)
--   • tablero_op_sic          (tabla descartada; puede no existir)
--   • gd_tablero(...)         (RPC del cruce, todas sus versiones)
--
-- NO toca tablero_op_transaccion: sigue en uso (Carga de datos →
-- TRANSACCIONES, índice del Buscador, sic_precio_importe). Tampoco toca la
-- tabla `seguimiento` (Control de servicios), que es otra cosa.
--
-- Correr UNA vez en el SQL Editor de Supabase. Es idempotente y va en una
-- transacción: si algo falla, no se borra nada.
--
-- Salvaguarda: antes de borrar, revisa que ninguna OTRA función de la base
-- lea estas tablas. Si encuentra una, aborta y dice cuál. Sin CASCADE a
-- propósito: si hubiera una vista que dependa de alguna tabla, el DROP falla
-- en vez de llevársela puesta.
-- ============================================================================

BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS f
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname <> 'gd_tablero'
      AND p.prosrc ~ 'tablero_op_(seguimiento|stock|sic)\M'
  LOOP
    RAISE EXCEPTION 'La función % todavía usa una tabla del Tablero OP — no se borró nada.', r.f;
  END LOOP;
END $$;

-- gd_tablero cambió de firma con el tiempo: se borran todas las versiones.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS f
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'gd_tablero'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.f);
  END LOOP;
END $$;

-- Triggers, índices y policies de cada tabla se van con ella.
DROP TABLE IF EXISTS tablero_op_seguimiento;
DROP TABLE IF EXISTS tablero_op_stock;
DROP TABLE IF EXISTS tablero_op_sic;

COMMIT;

-- Verificación (debería devolver 0 filas):
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public'
--   AND tablename IN ('tablero_op_seguimiento', 'tablero_op_stock', 'tablero_op_sic');
