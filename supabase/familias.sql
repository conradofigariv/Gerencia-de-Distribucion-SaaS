-- ════════════════════════════════════════════════════════════════════════════
-- Familias como entidad propia (sección Matrículas → Familias)
--
-- Reemplaza el modelo viejo donde la familia era una etiqueta guardada en
-- `stock_article_families.familia` (array JSON por matrícula). Ahora:
--   • `familias`            → catálogo de familias (entidad; existen solas)
--   • `familia_matriculas`  → asignación many-to-many familia ↔ matrícula
--   • `matricula_tipo`      → override manual de Material/Servicio por matrícula
--
-- La tabla vieja `stock_article_families` NO se borra: queda de backup hasta
-- verificar la migración (ver scripts/migrate-familias.mjs).
-- ════════════════════════════════════════════════════════════════════════════

-- Catálogo de familias
CREATE TABLE IF NOT EXISTS familias (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- Asignación many-to-many. `articulo` es el número de matrícula TAL CUAL
-- (con el .0 y los ceros); el cruce con `matriculas` es por igualdad exacta.
CREATE TABLE IF NOT EXISTS familia_matriculas (
  familia_id uuid NOT NULL REFERENCES familias(id) ON DELETE CASCADE,
  articulo   text NOT NULL,
  PRIMARY KEY (familia_id, articulo)
);

-- Índice para buscar rápido todas las familias de una matrícula.
CREATE INDEX IF NOT EXISTS familia_matriculas_articulo_idx
  ON familia_matriculas (articulo);

-- Override manual de tipo (Material / Servicio). Independiente de las familias.
CREATE TABLE IF NOT EXISTS matricula_tipo (
  articulo text PRIMARY KEY,
  tipo     text CHECK (tipo IN ('material', 'servicio'))
);
