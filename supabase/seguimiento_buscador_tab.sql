-- ============================================================================
-- Control de servicios — «Traer del Buscador» atómico y por pestaña.
--
-- Antes, «Traer del Buscador» (lib/buscadorTabs.ts → enviarMarcadasASeguimiento)
-- hacía desde el navegador: DELETE de TODO lo que tenía origen='buscador' y
-- después INSERT en tandas. Problemas:
--   • Si un insert fallaba a la mitad, el Resumen quedaba vacío y se perdían
--     los `nombre_corto` cargados a mano (solo estaban en memoria).
--   • Dos personas con una pestaña «Servicios» cada una se borraban lo que
--     había traído la otra.
--   • Dos sincronizaciones a la vez dejaban filas duplicadas.
--
-- Ahora:
--   • `seguimiento.buscador_tab_id` dice de qué pestaña vino cada fila.
--   • `gd_seguimiento_traer_de_pestana(tab, filas)` hace todo en UNA
--     transacción: rescata los nombres cortos, borra SOLO lo que había traído
--     esa pestaña (más las filas viejas sin pestaña, de antes de este cambio)
--     y escribe las nuevas. Si algo falla, no cambia nada.
--   • Un candado (advisory lock) hace que dos sincronizaciones simultáneas
--     corran una después de la otra.
--   • Una OP/línea/matrícula que ya trajo OTRA pestaña no se duplica, y las
--     repetidas dentro de la misma pestaña (una fila por envío) entran una vez.
--
-- Correr UNA vez en el SQL Editor de Supabase. Idempotente.
-- ============================================================================

ALTER TABLE seguimiento ADD COLUMN IF NOT EXISTS buscador_tab_id uuid;

CREATE INDEX IF NOT EXISTS idx_seguimiento_buscador_tab
  ON seguimiento (buscador_tab_id) WHERE origen = 'buscador';

CREATE OR REPLACE FUNCTION gd_seguimiento_traer_de_pestana(p_tab_id uuid, p_filas jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_nc jsonb;
  v_n  integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('gd_seguimiento_traer_de_pestana'));

  -- Nombre corto: el único campo que se carga a mano en el Resumen y no sale
  -- de la pestaña. Se rescata antes de borrar.
  SELECT COALESCE(jsonb_object_agg(k, nombre_corto), '{}'::jsonb) INTO v_nc
  FROM (
    SELECT DISTINCT ON (op, linea, matricula)
           op::text || '|' || linea::text || '|' || matricula AS k, nombre_corto
    FROM seguimiento
    WHERE origen = 'buscador'
      AND (buscador_tab_id = p_tab_id OR buscador_tab_id IS NULL)
      AND nombre_corto IS NOT NULL AND nombre_corto <> ''
  ) x;

  DELETE FROM seguimiento
  WHERE origen = 'buscador'
    AND (buscador_tab_id = p_tab_id OR buscador_tab_id IS NULL);

  INSERT INTO seguimiento (
    zona, op, op_madre, linea, matricula, descripcion_matricula,
    cantidad, cantidad_recibida, saldo_linea, fecha_pactada, proveedor,
    fecha_redeterminacion, precio_redeterminacion,
    estado, estado_plazo, estado_cantidades, revision, observacion,
    disponibilidad_meses,
    origen, nombre_corto, buscador_tab_id
  )
  SELECT DISTINCT ON (r.op, r.linea, r.matricula)
    r.zona, r.op, r.op_madre, r.linea, r.matricula, r.descripcion_matricula,
    r.cantidad, r.cantidad_recibida, r.saldo_linea, r.fecha_pactada, r.proveedor,
    r.fecha_redeterminacion, r.precio_redeterminacion,
    r.estado, r.estado_plazo, r.estado_cantidades, r.revision, r.observacion,
    r.disponibilidad_meses,
    'buscador',
    v_nc ->> (r.op::text || '|' || r.linea::text || '|' || r.matricula),
    p_tab_id
  FROM jsonb_populate_recordset(NULL::seguimiento, p_filas) r
  WHERE NOT EXISTS (
    SELECT 1 FROM seguimiento s
    WHERE s.origen = 'buscador'
      AND s.op = r.op AND s.linea = r.linea AND s.matricula = r.matricula
  );

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

GRANT EXECUTE ON FUNCTION gd_seguimiento_traer_de_pestana(uuid, jsonb) TO authenticated;
