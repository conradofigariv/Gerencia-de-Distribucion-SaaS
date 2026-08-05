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
--   • planillas_op            → datos de compra (proveedor, cantidades, fechas, zona)
--   • matriculas              → catálogo maestro (descripción, unidad, estado)
--   • matricula_tipo          → material/servicio. Es la clasificación MANUAL que
--                               se carga desde «Stock por Zona» y es la que MANDA
--                               sobre el `mat_serv` del catálogo.
--   • tablero_op_transaccion  → los MOVIMIENTOS reales (Recibir / Aceptar /
--                               Entregar / devoluciones), agregados por
--                               (OP, artículo, línea) sobre TODO el histórico.
--
-- Las tres `fuente` posibles de una fila del índice:
--   'op'          → fila de compra de planillas_op (con sus movimientos, si los hay)
--   'catalogo'    → matrícula del catálogo que no aparece en ninguna OP ni movimiento
--   'transaccion' → movimientos de una (OP, artículo, línea) que NO está en la
--                   planilla OP actual (ej. OPs viejas ya fuera del export).
--                   Sin esto esos movimientos serían invisibles.
--
-- ⚠ Los totales de movimientos son POR LÍNEA, no por envío: las transacciones no
--   tienen dimensión de envío. Si una línea tiene varios envíos, todas sus filas
--   muestran el MISMO total de línea — sirven para leer el estado de la línea,
--   no para sumar la columna. Por eso las columnas se rotulan «(mov.)».
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

-- Número de OP. Mismo problema del ".0" del export de Excel: planillas_op.numero
-- es text ("26846" o "26846.0") y tablero_op_transaccion.numero_pedido es bigint.
-- Se normalizan los dos lados a text sin sufijo decimal para poder cruzarlos.
CREATE OR REPLACE FUNCTION gd_norm_op(raw text)
RETURNS text AS $$
  SELECT NULLIF(regexp_replace(trim(COALESCE(raw, '')), '\.0+$', ''), '');
$$ LANGUAGE sql IMMUTABLE;

-- Número de línea. Conviven tres notaciones para lo mismo:
--   • planillas_op          → "1.0" / "1.1"   (decimal del Excel)
--   • seguimiento y trans.  → "1"   / "1,1"   (coma, notación SIGA)
-- Se unifica a punto y sin ".0" final: "1,1" ≡ "1.1", "1.0" ≡ "1".
-- OJO: solo se quita el ".0"; "1.1" es una línea REAL distinta de "1"
-- (es la ampliación/recompra), no se puede colapsar.
CREATE OR REPLACE FUNCTION gd_norm_linea(raw text)
RETURNS text AS $$
  SELECT NULLIF(
    regexp_replace(replace(trim(COALESCE(raw, '')), ',', '.'), '\.0+$', ''),
  '');
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
  mat_serv            text,        -- el mat_serv del catálogo (informativo:
                                   -- el que MANDA es `tipo`)
  en_catalogo         boolean NOT NULL DEFAULT false,

  -- ── Compra (OP → línea → envío) ──
  relacion            text,        -- OP+línea; NO es única (se repite por envío)
  numero_op           text,
  linea               text,
  envio               text,
  envios_linea        integer,     -- cuántos envíos tiene esa (OP, línea) en total,
                                   -- para mostrar «envío 1/2» y que se vea de una
                                   -- que las filas hermanas comparten el total (mov.)
  proveedor           text,
  zona                text,        -- organizacion_envio

  -- ── Cantidades ──
  cantidad            numeric,
  cantidad_recibida   numeric,
  ctd_aceptada        numeric,
  pendiente           numeric,     -- cantidad - recibida
  cantidad_vencida    numeric,
  cantidad_rechazada  numeric,
  cantidad_facturada  numeric,
  cantidad_cancelada  numeric,

  -- ── Fechas y estados ──
  -- fecha_creacion es la fecha REAL de creación de la OP en SIGA. No se indexa
  -- el uploaded_at de la planilla (cuándo se subió el archivo): es igual en
  -- todas las filas porque el import reemplaza la tabla entera, y se confundía
  -- con esta fecha.
  fecha_creacion      text,        -- texto crudo del Excel
  fecha_pactada       text,        -- texto crudo del Excel
  estado_autorizacion text,
  estado_cierre       text,

  -- ── Movimientos reales (tablero_op_transaccion) ──
  -- ⚠ Totales POR LÍNEA (las transacciones no tienen envío): si la línea tiene
  --   varios envíos, todas sus filas repiten el mismo total. No sumar la columna.
  tx_recibido         numeric,
  tx_aceptado         numeric,
  tx_entregado        numeric,
  tx_devoluciones     numeric,     -- Rechazar / Devolver a Prov. / a Recep. / Corregir
  tx_movimientos      integer,     -- cantidad de movimientos registrados
  tx_primera_fecha    date,
  tx_ultima_fecha     date,

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

-- ─── Índices de apoyo en las tablas fuente ──────────────────────────────────
-- El cruce se hace sobre gd_norm_articulo(articulo), no sobre la columna cruda.
-- Sin estos índices de expresión, cada pasada tiene que recalcular la función
-- fila por fila. Son IMMUTABLE, así que se pueden indexar.

CREATE INDEX IF NOT EXISTS idx_planillas_op_articulo_norm
  ON planillas_op (gd_norm_articulo(articulo));
CREATE INDEX IF NOT EXISTS idx_matriculas_articulo_norm
  ON matriculas (gd_norm_articulo(articulo));

-- ─── Reconstrucción del índice ──────────────────────────────────────────────
-- Borra y recarga todo. Devuelve la cantidad de filas indexadas.
--
-- ⚠ PERFORMANCE — no volver a caer en esto:
-- La primera versión resolvía «matrículas que no están en ninguna OP» con un
-- NOT EXISTS correlacionado contra planillas_op. Eso escanea la planilla ENTERA
-- una vez por cada matrícula del catálogo (O(n×m)) y hace saltar el statement
-- timeout — exactamente el mismo error que ya había tenido gd_tablero.
--
-- Ahora se normalizan las claves UNA sola vez en tablas temporales indexadas y
-- todos los cruces son hash joins sobre columnas ya calculadas.

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

  -- ── Claves normalizadas, calculadas una sola vez ──────────────────────────

  -- Catálogo deduplicado por clave normalizada: si dos filas del catálogo
  -- colapsaran a la misma clave, sin el DISTINCT ON se multiplicarían las
  -- filas de OP en el join.
  CREATE TEMP TABLE _cat ON COMMIT DROP AS
    SELECT DISTINCT ON (k) k, articulo, descripcion, unidad_medida, estado, mat_serv
      FROM (
        SELECT gd_norm_articulo(articulo) AS k, articulo, descripcion,
               unidad_medida, estado, mat_serv
          FROM matriculas
      ) x
     ORDER BY k;
  CREATE INDEX ON _cat (k);

  CREATE TEMP TABLE _tipo ON COMMIT DROP AS
    SELECT DISTINCT ON (k) k, tipo
      FROM (SELECT gd_norm_articulo(articulo) AS k, tipo FROM matricula_tipo) x
     ORDER BY k;
  CREATE INDEX ON _tipo (k);

  -- Movimientos reales agregados por (OP, artículo, línea) — TODO el histórico.
  -- Las transacciones NO tienen dimensión de envío, así que el total es de la
  -- línea completa. Una sola pasada con hash agg sobre las 60k+ filas.
  CREATE TEMP TABLE _tx ON COMMIT DROP AS
    SELECT
      gd_norm_op(numero_pedido::text)         AS numero_op,
      gd_norm_articulo(articulo)              AS k,
      -- Centinela '' en vez de NULL: con NULL el `=` del join nunca matchea
      -- (NULL <> NULL) y se perderían las filas sin línea. Con '' se puede
      -- usar igualdad plana y el planner elige hash join.
      COALESCE(gd_norm_linea(linea), '')      AS linea_k,
      SUM(CASE WHEN tipo = 'Recibir'  THEN importe ELSE 0 END) AS recibido,
      SUM(CASE WHEN tipo = 'Aceptar'  THEN importe ELSE 0 END) AS aceptado,
      SUM(CASE WHEN tipo = 'Entregar' THEN importe ELSE 0 END) AS entregado,
      SUM(CASE WHEN tipo IN (
            'Rechazar', 'Devolver a Proveedor', 'Devolver a Recepción', 'Corregir'
          ) THEN importe ELSE 0 END) AS devoluciones,
      COUNT(*)::integer  AS movimientos,
      MIN(fecha)::date   AS primera_fecha,
      MAX(fecha)::date   AS ultima_fecha,
      -- Proveedor del movimiento más antiguo que lo tenga cargado.
      (array_agg(proveedor ORDER BY fecha)
         FILTER (WHERE proveedor IS NOT NULL AND proveedor <> ''))[1] AS proveedor
    FROM tablero_op_transaccion
    GROUP BY 1, 2, 3;
  CREATE INDEX ON _tx (numero_op, k, linea_k);

  -- Combinaciones (OP, artículo, línea) que SÍ están en la planilla OP, para
  -- detectar los movimientos huérfanos (OPs viejas fuera del export actual).
  CREATE TEMP TABLE _op_rows ON COMMIT DROP AS
    SELECT DISTINCT
           gd_norm_op(numero)                AS numero_op,
           gd_norm_articulo(articulo)        AS k,
           COALESCE(gd_norm_linea(linea), '') AS linea_k
      FROM planillas_op;
  CREATE INDEX ON _op_rows (numero_op, k, linea_k);

  -- Cuántos envíos tiene cada (OP, línea). Una línea se entrega en «cuotas»:
  -- 100 unidades en 4 envíos de 25 son 4 filas de planillas_op con la misma
  -- línea. Este conteo permite mostrar «envío 1/4» en la tabla.
  CREATE TEMP TABLE _env_count ON COMMIT DROP AS
    SELECT gd_norm_op(numero)                 AS numero_op,
           COALESCE(gd_norm_linea(linea), '') AS linea_k,
           COUNT(*)::integer                  AS n
      FROM planillas_op
     GROUP BY 1, 2;
  CREATE INDEX ON _env_count (numero_op, linea_k);

  -- Artículos que ya aparecen en alguna OP o en algún movimiento — el resto
  -- del catálogo entra como fila 'catalogo'.
  CREATE TEMP TABLE _op_keys ON COMMIT DROP AS
    SELECT DISTINCT gd_norm_articulo(articulo) AS k FROM planillas_op
    UNION
    SELECT DISTINCT k FROM _tx;
  CREATE INDEX ON _op_keys (k);

  -- 1) Una fila por (OP, línea, envío), enriquecida con el catálogo.
  INSERT INTO busqueda_index (
    fuente, articulo, articulo_key, descripcion, unidad_medida, estado_matricula,
    tipo, mat_serv, en_catalogo, relacion, numero_op, linea, envio, envios_linea,
    proveedor,
    zona, cantidad, cantidad_recibida, ctd_aceptada, pendiente, cantidad_vencida,
    cantidad_rechazada, cantidad_facturada, cantidad_cancelada,
    fecha_creacion, fecha_pactada, estado_autorizacion, estado_cierre,
    tx_recibido, tx_aceptado, tx_entregado, tx_devoluciones, tx_movimientos,
    tx_primera_fecha, tx_ultima_fecha,
    busqueda
  )
  SELECT
    'op',
    o.articulo,
    o.k,
    COALESCE(NULLIF(c.descripcion, ''), o.descripcion_articulo),
    COALESCE(NULLIF(c.unidad_medida, ''), o.udm),
    c.estado,
    t.tipo,
    c.mat_serv,
    (c.k IS NOT NULL),
    o.relacion,
    o.numero,
    o.linea,
    o.envio,
    ec.n,
    o.proveedor,
    o.organizacion_envio,
    o.cantidad,
    o.cantidad_recibida,
    o.ctd_aceptada,
    COALESCE(o.cantidad, 0) - COALESCE(o.cantidad_recibida, 0),
    o.cantidad_vencida,
    o.cantidad_rechazada,
    o.cantidad_facturada,
    o.cantidad_cancelada,
    o.fecha_creacion,
    o.fecha_pactada,
    o.estado_autorizacion,
    o.estado_cierre,
    x.recibido,
    x.aceptado,
    x.entregado,
    x.devoluciones,
    x.movimientos,
    x.primera_fecha,
    x.ultima_fecha,
    gd_norm_texto(concat_ws(' ',
      o.articulo, o.k,
      COALESCE(NULLIF(c.descripcion, ''), o.descripcion_articulo),
      o.relacion, o.numero, o.linea, o.envio, o.proveedor, o.organizacion_envio,
      t.tipo, c.mat_serv, c.estado, o.estado_autorizacion, o.estado_cierre,
      o.fecha_creacion, o.fecha_pactada,
      x.primera_fecha, x.ultima_fecha
    ))
  FROM (
    SELECT *,
           gd_norm_articulo(articulo)        AS k,
           gd_norm_op(numero)                AS op_k,
           COALESCE(gd_norm_linea(linea), '') AS linea_k
      FROM planillas_op
  ) o
  LEFT JOIN _cat  c ON c.k = o.k
  LEFT JOIN _tipo t ON t.k = o.k
  LEFT JOIN _tx   x ON x.numero_op = o.op_k AND x.k = o.k AND x.linea_k = o.linea_k
  LEFT JOIN _env_count ec ON ec.numero_op = o.op_k AND ec.linea_k = o.linea_k;

  -- 2) Movimientos de (OP, artículo, línea) que NO están en la planilla OP
  --    actual — típicamente OPs viejas que ya salieron del export. Sin esto
  --    esos movimientos no aparecerían en ninguna búsqueda.
  --    Anti-join contra _op_rows (indexada), NO subconsulta correlacionada.
  INSERT INTO busqueda_index (
    fuente, articulo, articulo_key, descripcion, unidad_medida, estado_matricula,
    tipo, mat_serv, en_catalogo, numero_op, linea, proveedor,
    tx_recibido, tx_aceptado, tx_entregado, tx_devoluciones, tx_movimientos,
    tx_primera_fecha, tx_ultima_fecha, busqueda
  )
  SELECT
    'transaccion',
    COALESCE(c.articulo, x.k),   -- el código crudo solo existe si está en el catálogo
    x.k,
    c.descripcion,
    c.unidad_medida,
    c.estado,
    t.tipo,
    c.mat_serv,
    (c.k IS NOT NULL),
    x.numero_op,
    NULLIF(x.linea_k, ''),        -- vuelve el centinela a NULL para mostrar
    x.proveedor,
    x.recibido,
    x.aceptado,
    x.entregado,
    x.devoluciones,
    x.movimientos,
    x.primera_fecha,
    x.ultima_fecha,
    gd_norm_texto(concat_ws(' ',
      COALESCE(c.articulo, x.k), x.k, c.descripcion, x.numero_op, x.linea_k,
      x.proveedor, t.tipo, c.mat_serv, c.estado,
      x.primera_fecha, x.ultima_fecha
    ))
  FROM _tx x
  LEFT JOIN _cat     c  ON c.k = x.k
  LEFT JOIN _tipo    t  ON t.k = x.k
  LEFT JOIN _op_rows orw ON orw.numero_op = x.numero_op
                        AND orw.k         = x.k
                        AND orw.linea_k   = x.linea_k
  WHERE orw.numero_op IS NULL;

  -- 3) Matrículas del catálogo que no aparecen en ninguna OP ni movimiento.
  --    Anti-join contra _op_keys (indexada), NO subconsulta correlacionada.
  INSERT INTO busqueda_index (
    fuente, articulo, articulo_key, descripcion, unidad_medida, estado_matricula,
    tipo, mat_serv, en_catalogo, busqueda
  )
  SELECT
    'catalogo',
    c.articulo,
    c.k,
    c.descripcion,
    c.unidad_medida,
    c.estado,
    t.tipo,
    c.mat_serv,
    true,
    gd_norm_texto(concat_ws(' ',
      c.articulo, c.k, c.descripcion, t.tipo, c.mat_serv, c.estado
    ))
  FROM _cat c
  LEFT JOIN _tipo   t  ON t.k  = c.k
  LEFT JOIN _op_keys ok ON ok.k = c.k
  WHERE ok.k IS NULL;

  SELECT count(*) INTO total FROM busqueda_index;
  RETURN total;
END;
$$;

-- Margen de tiempo para la reconstrucción: es una operación de mantenimiento
-- pesada, no una consulta de la API.
ALTER FUNCTION gd_reconstruir_busqueda() SET statement_timeout = '600s';

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
