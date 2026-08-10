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
--   • seguimiento_sic_soler   → las SIC (Solicitud Interna de Compra), que están
--                               ARRIBA de la OP en la jerarquía. Se cargan desde
--                               «Carga de datos → SIC».
--
-- Las cuatro `fuente` posibles de una fila del índice:
--   'op'          → fila de compra de planillas_op (con sus movimientos y su SIC)
--   'catalogo'    → matrícula del catálogo que no aparece en ninguna OP ni movimiento
--   'transaccion' → movimientos de una (OP, artículo, línea) que NO está en la
--                   planilla OP actual (ej. OPs viejas ya fuera del export).
--                   Sin esto esos movimientos serían invisibles.
--   'sic'         → línea de SIC que todavía NO tiene OP (pedido pendiente de
--                   convertirse en orden), o cuya OP ya no está en la planilla.
--
-- ── Cómo se cruza la SIC ────────────────────────────────────────────────────
-- Una SIC puede generar VARIAS OPs: cada LÍNEA de la SIC va a una OP distinta
-- (verificado: SIC 21348 → línea 1 = OP 26846, línea 2 = OP 26845).
--
-- ⚠ La línea de la SIC NO es la misma que la línea de la OP — son numeraciones
--   independientes. El cruce va por (Número Pedido + Artículo), que verificamos
--   que es único en el export de SIC. NUNCA por línea.
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

-- Fecha del Excel → date. `planillas_op` guarda las fechas como TEXTO CRUDO y
-- conviven dos formatos según cuándo se importó la planilla:
--   • ISO            "2024-07-23"                      (import nuevo)
--   • Date.toString  "Tue Jul 23 2024 00:00:48 GMT-03" (import viejo)
--
-- Ordenar ese texto directamente da cualquier cosa: las letras van después de
-- los dígitos en ASCII (todo el formato viejo queda de un lado) y entre sí se
-- ordenan por el NOMBRE DEL DÍA — "Tue" antes que "Mon". De ahí que haga falta
-- parsear a date de verdad antes de comparar.
--
-- Devuelve NULL ante cualquier cosa que no reconozca: una fecha rota en una
-- fila no puede tumbar una reconstrucción de 10 minutos.
CREATE OR REPLACE FUNCTION gd_parse_fecha(raw text)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN NULL;
  END IF;
  IF raw ~ '^\d{4}-\d{2}-\d{2}' THEN
    RETURN substring(raw FROM 1 FOR 10)::date;
  END IF;
  IF raw ~ '^[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}' THEN
    -- Se descarta el día de la semana y se rearma "Mon DD YYYY".
    RETURN to_date(
      regexp_replace(raw, '^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4}).*$', '\1 \2 \3'),
      'Mon DD YYYY'
    );
  END IF;
  -- Red de seguridad: si alguna celda del Excel vino como TEXTO en vez de
  -- fecha, llega "23/07/2024". Se interpreta dd/mm/aaaa (formato local), no
  -- mm/dd — es el que usa el resto de la app.
  IF raw ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
    RETURN to_date(substring(raw FROM '^\d{1,2}/\d{1,2}/\d{4}'), 'DD/MM/YYYY');
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

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

  -- ── SIC (Solicitud Interna de Compra) — el nivel de ARRIBA de la OP ──
  -- Se cruza por (Número Pedido + Artículo), nunca por línea: la línea de la
  -- SIC y la de la OP son numeraciones distintas.
  numero_sic          text,
  sic_linea           text,
  sic_cantidad        numeric,
  sic_udm             text,
  sic_preparador      text,
  sic_fecha_creacion  text,

  -- ── Compra (OP → línea → envío) ──
  relacion            text,        -- OP+línea; NO es única (se repite por envío)
  numero_op           text,
  linea               text,
  envio               text,
  envios_linea        integer,     -- cuántos envíos tiene esa (OP, línea) en total,
                                   -- para mostrar «envío 1/2» y que se vea de una
                                   -- que las filas hermanas comparten el total (mov.)
  proveedor           text,
  -- Descripción de la OP (NO la de la matrícula, que va en `descripcion`).
  -- Se carga a mano en op_datos; sirve para saber de qué se trata la OP y de
  -- qué zona es. Ver supabase/op_datos.sql.
  op_descripcion      text,
  -- Zona 100% manual, de op_datos. `organizacion_envio` de la planilla se dejó
  -- de usar del todo (no era confiable) — sin cargar a mano, esto es NULL.
  zona                text,

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
  fecha_creacion      text,        -- texto crudo del Excel (se muestra tal cual)
  fecha_pactada       text,        -- texto crudo del Excel (se muestra tal cual)
  -- Las mismas dos fechas parseadas a date, para ORDENAR y FILTRAR. El texto
  -- crudo no sirve para eso: conviven dos formatos y ordenarlo alfabéticamente
  -- termina ordenando por el nombre del día (ver gd_parse_fecha).
  fecha_creacion_d    date,
  fecha_pactada_d     date,
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

-- La vista de entrada del Buscador (sin texto buscado) ordena por esta columna.
-- Sin el índice, cada apertura hace un sort completo de las 112k+ filas.
CREATE INDEX idx_busqueda_index_fecha_creacion_d
  ON busqueda_index (fecha_creacion_d DESC NULLS LAST);

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

  -- Datos manuales de la OP (descripción real + zona real). Mismo patrón que
  -- _tipo: se normaliza la clave de los dos lados y se deduplica, así da igual
  -- si en op_datos quedó guardada la OP con o sin el ".0" del Excel.
  -- Ver supabase/op_datos.sql.
  CREATE TEMP TABLE _opd ON COMMIT DROP AS
    SELECT DISTINCT ON (k) k, descripcion, zona
      FROM (SELECT gd_norm_op(numero_op) AS k, descripcion, zona FROM op_datos) x
     WHERE k IS NOT NULL
     ORDER BY k;
  CREATE INDEX ON _opd (k);

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

  -- SIC normalizada. Clave de cruce: (Número Pedido, Artículo) — verificado
  -- único en el export. `op_k` queda NULL cuando la SIC todavía no generó OP.
  --
  -- El DISTINCT ON es defensivo, por si dos líneas de SIC colapsaran a la misma
  -- (OP, artículo) y multiplicaran las filas de la OP en el join. PERO no puede
  -- deduplicar por (op_k, art_k) a secas: con op_k NULL (SIC sin OP todavía)
  -- aplastaría en una sola fila TODAS las SIC distintas que pidan ese artículo.
  -- Por eso, cuando no hay OP, la clave de dedup cae en (SIC, línea), que es
  -- única por definición.
  CREATE TEMP TABLE _sic ON COMMIT DROP AS
    SELECT DISTINCT ON (dedup_k, art_k)
           op_k, art_k, numero_sic, linea, cantidad, udm, preparador,
           fecha_creacion, descripcion
      FROM (
        SELECT gd_norm_op(numero_op)        AS op_k,
               gd_norm_articulo(articulo)   AS art_k,
               COALESCE(gd_norm_op(numero_op),
                        numero_sic || '|' || COALESCE(linea, '')) AS dedup_k,
               numero_sic,
               linea,
               cantidad,
               udm,
               preparador,
               fecha_creacion,
               descripcion
          FROM seguimiento_sic_soler
      ) s
     ORDER BY dedup_k, art_k, numero_sic;
  CREATE INDEX ON _sic (op_k, art_k);

  -- Combinaciones (OP, artículo) presentes en la planilla OP — para saber qué
  -- líneas de SIC ya están representadas por una fila de compra y cuáles no.
  CREATE TEMP TABLE _op_art ON COMMIT DROP AS
    SELECT DISTINCT gd_norm_op(numero) AS op_k, gd_norm_articulo(articulo) AS art_k
      FROM planillas_op;
  CREATE INDEX ON _op_art (op_k, art_k);

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
    tipo, mat_serv, en_catalogo,
    numero_sic, sic_linea, sic_cantidad, sic_udm, sic_preparador, sic_fecha_creacion,
    relacion, numero_op, linea, envio, envios_linea,
    proveedor, op_descripcion,
    zona, cantidad, cantidad_recibida, ctd_aceptada, pendiente, cantidad_vencida,
    cantidad_rechazada, cantidad_facturada, cantidad_cancelada,
    fecha_creacion, fecha_pactada, fecha_creacion_d, fecha_pactada_d,
    estado_autorizacion, estado_cierre,
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
    s.numero_sic,
    s.linea,
    s.cantidad,
    s.udm,
    s.preparador,
    s.fecha_creacion,
    o.relacion,
    o.numero,
    o.linea,
    o.envio,
    ec.n,
    o.proveedor,
    od.descripcion,
    NULLIF(od.zona, ''),   -- 100% manual; sin cargar, NULL
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
    gd_parse_fecha(o.fecha_creacion),
    gd_parse_fecha(o.fecha_pactada),
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
      o.relacion, o.numero, o.linea, o.envio, o.proveedor,
      -- La descripción y la zona manuales entran al texto buscable: así se
      -- puede buscar «zona sur» y traer todas las OP de esa zona.
      od.descripcion, od.zona,
      t.tipo, c.mat_serv, c.estado, o.estado_autorizacion, o.estado_cierre,
      o.fecha_creacion, o.fecha_pactada,
      x.primera_fecha, x.ultima_fecha,
      s.numero_sic, s.preparador
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
  LEFT JOIN _opd  od ON od.k = o.op_k
  LEFT JOIN _tx   x ON x.numero_op = o.op_k AND x.k = o.k AND x.linea_k = o.linea_k
  LEFT JOIN _env_count ec ON ec.numero_op = o.op_k AND ec.linea_k = o.linea_k
  LEFT JOIN _sic  s ON s.op_k = o.op_k AND s.art_k = o.k;

  -- 2) Movimientos de (OP, artículo, línea) que NO están en la planilla OP
  --    actual — típicamente OPs viejas que ya salieron del export. Sin esto
  --    esos movimientos no aparecerían en ninguna búsqueda.
  --    Anti-join contra _op_rows (indexada), NO subconsulta correlacionada.
  INSERT INTO busqueda_index (
    fuente, articulo, articulo_key, descripcion, unidad_medida, estado_matricula,
    tipo, mat_serv, en_catalogo,
    numero_sic, sic_linea, sic_cantidad, sic_udm, sic_preparador, sic_fecha_creacion,
    numero_op, linea, proveedor, op_descripcion, zona,
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
    s.numero_sic,
    s.linea,
    s.cantidad,
    s.udm,
    s.preparador,
    s.fecha_creacion,
    x.numero_op,
    NULLIF(x.linea_k, ''),        -- vuelve el centinela a NULL para mostrar
    x.proveedor,
    od.descripcion,
    NULLIF(od.zona, ''),          -- estas filas no traen zona de planilla
    x.recibido,
    x.aceptado,
    x.entregado,
    x.devoluciones,
    x.movimientos,
    x.primera_fecha,
    x.ultima_fecha,
    gd_norm_texto(concat_ws(' ',
      COALESCE(c.articulo, x.k), x.k, c.descripcion, x.numero_op, x.linea_k,
      x.proveedor, od.descripcion, od.zona, t.tipo, c.mat_serv, c.estado,
      x.primera_fecha, x.ultima_fecha,
      s.numero_sic, s.preparador
    ))
  FROM _tx x
  LEFT JOIN _cat     c  ON c.k = x.k
  LEFT JOIN _tipo    t  ON t.k = x.k
  LEFT JOIN _opd     od ON od.k = x.numero_op
  LEFT JOIN _sic     s  ON s.op_k = x.numero_op AND s.art_k = x.k
  LEFT JOIN _op_rows orw ON orw.numero_op = x.numero_op
                        AND orw.k         = x.k
                        AND orw.linea_k   = x.linea_k
  WHERE orw.numero_op IS NULL;

  -- 3) Líneas de SIC que todavía NO tienen OP (pedidos pendientes de
  --    convertirse en orden), o cuya OP ya no está en la planilla actual.
  --    Es el «pipeline»: sin esto, una SIC recién cargada sería invisible
  --    hasta que se le genere la orden.
  --    Anti-join contra _op_art (indexada), NO subconsulta correlacionada.
  INSERT INTO busqueda_index (
    fuente, articulo, articulo_key, descripcion, unidad_medida, estado_matricula,
    tipo, mat_serv, en_catalogo,
    numero_sic, sic_linea, sic_cantidad, sic_udm, sic_preparador, sic_fecha_creacion,
    numero_op, op_descripcion, zona, busqueda
  )
  SELECT
    'sic',
    COALESCE(c.articulo, s.art_k),
    s.art_k,
    COALESCE(NULLIF(c.descripcion, ''), s.descripcion),
    COALESCE(NULLIF(c.unidad_medida, ''), s.udm),
    c.estado,
    t.tipo,
    c.mat_serv,
    (c.k IS NOT NULL),
    s.numero_sic,
    s.linea,
    s.cantidad,
    s.udm,
    s.preparador,
    s.fecha_creacion,
    s.op_k,                       -- NULL si la SIC todavía no generó la OP
    od.descripcion,
    NULLIF(od.zona, ''),
    gd_norm_texto(concat_ws(' ',
      COALESCE(c.articulo, s.art_k), s.art_k,
      COALESCE(NULLIF(c.descripcion, ''), s.descripcion),
      s.numero_sic, s.linea, s.op_k, s.preparador, s.fecha_creacion,
      od.descripcion, od.zona,
      t.tipo, c.mat_serv, c.estado
    ))
  FROM _sic s
  LEFT JOIN _cat  c ON c.k = s.art_k
  LEFT JOIN _tipo t ON t.k = s.art_k
  LEFT JOIN _opd  od ON od.k = s.op_k
  LEFT JOIN _op_art oa ON oa.op_k = s.op_k AND oa.art_k = s.art_k
  WHERE oa.op_k IS NULL;

  -- 4) Matrículas del catálogo que no aparecen en ninguna OP, movimiento ni SIC.
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
     -- Sin búsqueda (pantalla de entrada al Buscador): las OP más nuevas
     -- primero. Es un CASE que solo «pesa» en este modo — con texto buscado
     -- da NULL en todas las filas (NULLS LAST no mueve nada) y el orden por
     -- relevancia de abajo queda intacto, como antes.
     --
     -- Va por `fecha_creacion_d` (date), NUNCA por `fecha_creacion` (text): el
     -- texto crudo tiene dos formatos mezclados y ordenarlo alfabéticamente
     -- termina ordenando por el nombre del día. Ver gd_parse_fecha.
     CASE WHEN gd_norm_texto(COALESCE(p_q, '')) = '' THEN fecha_creacion_d END DESC NULLS LAST,
     (articulo_key = gd_norm_articulo(p_q)) DESC,   -- matrícula exacta primero
     (numero_op    = trim(COALESCE(p_q, ''))) DESC, -- después OP exacta
     -- Orden por fuente EXPLÍCITO, no alfabético: alfabéticamente 'catalogo'
     -- va antes que 'op' y las filas sin OP (sin línea, envío, proveedor ni
     -- cantidad) quedaban arriba de todo, que es justo lo menos útil.
     CASE fuente
       WHEN 'op'          THEN 0   -- compras: la fila completa
       WHEN 'transaccion' THEN 1   -- movimientos de OPs fuera de la planilla
       ELSE 2                      -- 'catalogo': la matrícula existe y nada más
     END,
     numero_op,
     linea,
     envio
   LIMIT COALESCE(p_limite, 500);
$$;

GRANT EXECUTE ON FUNCTION gd_reconstruir_busqueda()          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION gd_buscar(text, integer)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION gd_norm_articulo(text)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION gd_norm_texto(text)                TO anon, authenticated;
