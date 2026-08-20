-- ============================================================================
-- Control de Yerba — permitir compras de 2 kg
--
-- Migración chica: solo el CHECK de yerba_compra_marca. La regla pasó de
-- "1 kg de una marca o ½ kg de dos" a "1 ó 2 kg en total, repartidos en una o
-- dos marcas": los kilos por marca son el total dividido por la cantidad de
-- marcas, nunca un valor suelto. Ver `kilosPorMarca()` en lib/yerba.ts.
--
--   1 kg · 1 marca  → 1 kg      2 kg · 1 marca  → 2 kg
--   1 kg · 2 marcas → ½ kg c/u  2 kg · 2 marcas → 1 kg c/u
--
-- El historial ya cargado con 1 ó 0.5 sigue siendo válido con esta whitelist
-- ampliada, así que no hace falta tocar filas existentes.
-- ============================================================================

ALTER TABLE yerba_compra_marca DROP CONSTRAINT IF EXISTS yerba_compra_marca_kilos_check;
ALTER TABLE yerba_compra_marca ADD CONSTRAINT yerba_compra_marca_kilos_check
  CHECK (kilos IN (0.5, 1, 2));
