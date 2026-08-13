-- ============================================================================
-- Borra `filas_manuales`, el staging de la pantalla «Crear seguimiento»
-- (servicios-carga.tsx), retirada junto con «Lista de seguimiento»
-- (servicios-tabla.tsx) — ver el commit que sacó las 3 subsecciones de
-- «Control de servicios» y la dejó como un único ítem.
--
-- Ningún código del repo sigue usando esta tabla — era exclusiva de esa
-- pantalla. `seguimiento`, `seguimiento_sic_soler`, la columna `origen` y
-- `nombre_corto` NO se tocan acá: las sigue usando el Resumen de Servicios.
--
-- CASCADE se lleva también sus índices, triggers y policies de RLS, que no
-- están versionados en ningún .sql de este repo (la tabla se creó en su
-- momento directo en el SQL Editor, nunca quedó en un archivo propio).
-- ============================================================================

DROP TABLE IF EXISTS filas_manuales CASCADE;
