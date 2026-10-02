-- ============================================================================
-- Buscador — migrar las claves (`row_key`) de las filas de SIC sin OP.
--
-- `rowKey()` (lib/busqueda.ts) era `fuente|articulo|op|linea|envio`. Las filas
-- de fuente 'sic' no tienen línea ni envío de OP, así que dos SICs distintas de
-- la misma matrícula daban la MISMA clave y el Buscador las trataba como una
-- sola (no dejaba agregar la segunda a una pestaña: «ya está»).
--
-- Ahora las filas 'sic' llevan además `|numero_sic|sic_linea`. Este script
-- reescribe las claves ya guardadas en las pestañas para que la detección de
-- duplicados siga reconociéndolas. Sin correrlo, volver a agregar una SIC que
-- ya estaba en una pestaña la duplicaría.
--
-- Correr UNA vez en el SQL Editor de Supabase. Idempotente: solo toca claves
-- 'sic' que todavía tienen el formato viejo (5 partes).
-- ============================================================================

UPDATE buscador_tab_filas
SET row_key = row_key
  || '|' || COALESCE(datos->>'numero_sic', '')
  || '|' || COALESCE(datos->>'sic_linea', '')
WHERE row_key LIKE 'sic|%'
  AND array_length(string_to_array(row_key, '|'), 1) = 5;
