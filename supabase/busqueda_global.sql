-- ============================================================================
-- Buscador global — Fase 1: Matrículas + Planilla OP
--
-- Índice materializado que unifica el catálogo de matrículas con la planilla
-- de OP, para poder buscar por cualquier dato (matrícula, descripción, OP,
-- proveedor, zona) y obtener TODO en una sola fila.
--
-- ── Modelo de dominio ───────────────────────────────────────────────────────
--   SIC (Solicitud Interna de Compra)
--     └── OP (Orden de Provisión; en algunas bases figura como OC/Orden de
--             Compra — es EL MISMO objeto, solo cambia el nombre)
--           └── línea  → QUÉ se compra (una matrícula distinta por línea)
--                 └── envío → EN CUÁNTAS CUOTAS lo entrega el proveedor
--                             (ej. 100 un. en 4 envíos de 25 → 4 fechas)
--
-- Nota: planillas_qw quedó FUERA DE USO — no se suma en ninguna fase.
--
-- Por eso la granularidad del índice es una fila por (OP, línea, envío), que
-- es la clave real de planillas_op. `relacion` (OP+línea) NO es única: se
-- repite en cada envío de esa línea.
--
-- ── Fuentes ─────────────────────────────────────────────────────────────────
--   • planillas_op   → los datos de compra (proveedor, cantidades, fechas, zona)
--   • matriculas     → el catálogo maestro (descripción, unidad, estado)
--   • matricula_tipo → material/servicio. Es la clasificación MANUAL que se
--                      carga desde «Stock por Zona» y es la que MANDA sobre
--                      el `mat_serv` del catálogo.
--
-- Las matrículas del catálogo que nunca se pidieron también entran al índice
-- (con la OP vacía), para poder confirmar que una matrícula existe.
--
-- ── Mantenimiento ───────────────────────────────────────────────────────────
-- planillas_op se borra y recarga entera en cada import (semanal / cada 3
-- días), así que el índice se reconstruye completo con gd_reconstruir_busqueda().
-- Es aditivo: no toca ninguna tabla existente.
-- ============================================================================

-- ─── Helpers de normalización ───────────────────────────────────────────────

-- Clave de cruce del artículo. Tanto `matriculas` como `planillas_op` guardan
-- el código con el sufijo decimal del export de Excel ("00009411.0"), mientras
-- que las tablas de tablero_op_* lo guardan ya limpio ("00009411"). Se quita
-- SOLO el sufijo .0 / .00 (nunca .1, .2 — si algún día existieran serían
-- variantes distintas y no deben colapsarse). El código original se conserva
-- aparte en la columna `articulo`.
CREATE OR REPLACE FUNCTION gd_norm_articulo(raw text)
RETURNS text AS $$
  SELECT regexp_replace(trim(COALESCE(raw, '')), '\.0+$', '');
$$ LANGUAGE sql IMMUTABLE;

-- Normaliza texto para búsqueda: minúsculas y sin acentos, para que "descripcion"
-- encuentre "DESCRIPCIÓN". Se usa translate() en vez de la extensión unaccent
-- para no depender de que esté instalada.
CREATE OR REPLACE FUNCTION gd_norm_texto(raw text)
RETURNS text AS $$
  SELECT lower(translate(
    COALESCE(raw, ''),
    'ÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÑÇáéíóúàèìòùäëïöüâêîôûñç',
    'AEIOUAEIOUAEIOUAEIOUNCaeiouaeiouaeiouaeiounc'
  ));
$$ LANGUAGE sql IMMUTABLE;

-- ─── Tabla índice ───────────────────────────────────────────────────────────

-- gd_buscar() devuelve SETOF busqueda_index, o sea que depende del TIPO de la
-- tabla: Postgres no deja recrear la tabla mientras la función exista. Por eso
-- se borra primero la función (más abajo se vuelve a crear). Sin esto, correr
-- el script una segunda vez falla con «cannot drop table busqueda_index
-- because other objects depend on it».
DROP FUNCTION IF EXISTS gd_buscar(text, integer);
DROP TABLE    IF EXISTS busqueda_index;

CREATE TABLE busqueda_index (
  id                  bigserial PRIMARY KEY,

  -- 'op'       → fila de compra (OP + línea + envío), enriquecida con el catálogo
  -- 'catalogo' → matrícula del catálogo que todavía no se pidió en ninguna OP
  fuente              text NOT NULL,

  -- ── Matrícula ──
  articulo            text,        -- código tal cual viene ("00009411.0")
  articulo_key        text,        -- normalizado para cruzar ("00009411")
  descripcion         text,        -- del catálogo; si no está, la de la OP
  unidad_medida       text,
  estado_matricula    text,        -- activo / inactivo (se muestra, no filtra)
  tipo                text,        -- material / servicio (de matricula_tipo)
  en_catalogo         boolean NOT NULL DEFAULT false,

  -- ── Compra (OP → línea → envío) ──
  numero_op           text,
  linea               text,
  envio               text,
  proveedor           text,
  cantidad            numeric,
  cantidad_recibida   numeric,
  pendiente           numeric,     -- cantidad - recibida
  fecha_creacion      text,        -- texto crudo del Excel
  fecha_pactada       text,        -- texto crudo del Excel
  zona                text,        -- organizacion_envio
  estado_autorizacion text,
  estado_cierre       text,

  -- ── Búsqueda ──
  busqueda            text NOT NULL,   -- todo lo anterior concatenado y normalizado

  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Búsqueda por subcadena en cualquier parte del texto → índice trigram.
-- pg_trgm viene disponible en Supabase; si fallara, la búsqueda igual funciona
-- (solo más lenta), así que el CREATE EXTENSION va aparte y es idempotente.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_busqueda_index_busqueda ON busqueda_index USING gin (busqueda gin_trgm_ops);

CREATE INDEX idx_busqueda_index_articulo_key ON busqueda_index (articulo_key);
CREATE INDEX idx_busqueda_index_numero_op    ON busqueda_index (numero_op);

ALTER TABLE busqueda_index ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "busqueda_index_all" ON busqueda_index;
CREATE POLICY "busqueda_index_all" ON busqueda_index FOR ALL USING (true) WITH CHECK (true);

-- Permisos explícitos: la reconstrucción inserta desde la app (rol anon /
-- authenticated), así que necesita la tabla y también la secuencia del id.
GRANT SELECT, INSERT, UPDATE, DELETE ON busqueda_index          TO anon, authenticated;
GRANT USAGE, SELECT                  ON SEQUENCE busqueda_index_id_seq TO anon, authenticated;

-- ─── Reconstrucción del índice ──────────────────────────────────────────────
-- Borra y recarga todo. Devuelve la cantidad de filas indexadas.

CREATE OR REPLACE FUNCTION gd_reconstruir_busqueda()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  total integer;
BEGIN
  -- El WHERE true es obligatorio: Supabase bloquea los DELETE sin cláusula
  -- WHERE (protección contra borrados masivos accidentales), incluso dentro
  -- de una función.
  DELETE FROM busqueda_index WHERE true;

  -- 1) Una fila por (OP, línea, envío), enriquecida con el catálogo.
  INSERT INTO busqueda_index (
    fuente, articulo, articulo_key, descripcion, unidad_medida, estado_matricula,
    tipo, en_catalogo, numero_op, linea, envio, proveedor, cantidad,
    cantidad_recibida, pendiente, fecha_creacion, fecha_pactada, zona,
    estado_autorizacion, estado_cierre, busqueda
  )
  SELECT
    'op',
    o.articulo,
    gd_norm_articulo(o.articulo),
    COALESCE(NULLIF(m.descripcion, ''), o.descripcion_articulo),
    COALESCE(NULLIF(m.unidad_medida, ''), o.udm),
    m.estado,
    mt.tipo,
    (m.articulo IS NOT NULL),
    o.numero,
    o.linea,
    o.envio,
    o.proveedor,
    o.cantidad,
    o.cantidad_recibida,
    COALESCE(o.cantidad, 0) - COALESCE(o.cantidad_recibida, 0),
    o.fecha_creacion,
    o.fecha_pactada,
    o.organizacion_envio,
    o.estado_autorizacion,
    o.estado_cierre,
    gd_norm_texto(concat_ws(' ',
      o.articulo, gd_norm_articulo(o.articulo),
      COALESCE(NULLIF(m.descripcion, ''), o.descripcion_articulo),
      o.numero, o.linea, o.envio, o.proveedor, o.organizacion_envio,
      mt.tipo, m.estado, o.estado_cierre, o.fecha_pactada
    ))
  FROM planillas_op o
  LEFT JOIN matriculas m
    ON gd_norm_articulo(m.articulo) = gd_norm_articulo(o.articulo)
  LEFT JOIN matricula_tipo mt
    ON gd_norm_articulo(mt.articulo) = gd_norm_articulo(o.articulo);

  -- 2) Matrículas del catálogo que todavía no aparecen en ninguna OP.
  INSERT INTO busqueda_index (
    fuente, articulo, articulo_key, descripcion, unidad_medida, estado_matricula,
    tipo, en_catalogo, busqueda
  )
  SELECT
    'catalogo',
    m.articulo,
    gd_norm_articulo(m.articulo),
    m.descripcion,
    m.unidad_medida,
    m.estado,
    mt.tipo,
    true,
    gd_norm_texto(concat_ws(' ',
      m.articulo, gd_norm_articulo(m.articulo), m.descripcion, mt.tipo, m.estado
    ))
  FROM matriculas m
  LEFT JOIN matricula_tipo mt
    ON gd_norm_articulo(mt.articulo) = gd_norm_articulo(m.articulo)
  WHERE NOT EXISTS (
    SELECT 1 FROM planillas_op o
     WHERE gd_norm_articulo(o.articulo) = gd_norm_articulo(m.articulo)
  );

  SELECT count(*) INTO total FROM busqueda_index;
  RETURN total;
END;
$$;

-- ─── Búsqueda ───────────────────────────────────────────────────────────────
-- Coincidencia por subcadena en cualquier campo. Ordena poniendo primero las
-- coincidencias exactas de matrícula o de OP, después el resto.

CREATE OR REPLACE FUNCTION gd_buscar(p_q text, p_limite integer DEFAULT 500)
RETURNS SETOF busqueda_index
LANGUAGE sql
STABLE
AS $$
  SELECT *
    FROM busqueda_index
   WHERE gd_norm_texto(COALESCE(p_q, '')) = ''
      OR busqueda LIKE '%' || gd_norm_texto(p_q) || '%'
   ORDER BY
     (articulo_key = gd_norm_articulo(p_q)) DESC,   -- matrícula exacta primero
     (numero_op    = trim(COALESCE(p_q, ''))) DESC, -- después OP exacta
     fuente,                                        -- 'catalogo' < 'op'
     numero_op,
     linea,
     envio
   LIMIT COALESCE(p_limite, 500);
$$;

GRANT EXECUTE ON FUNCTION gd_reconstruir_busqueda()          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION gd_buscar(text, integer)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION gd_norm_articulo(text)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION gd_norm_texto(text)                TO anon, authenticated;
