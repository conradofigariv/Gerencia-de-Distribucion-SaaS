-- ════════════════════════════════════════════════════════════════════════════
-- Plan de Compras — plan anual de matrículas con precios y cantidades
--
-- Reemplaza el Excel «PC ANUAL GD» (pestaña Global). Dos tablas:
--   • `planes_compra`      → un plan por año, con su tipo de cambio
--   • `plan_compra_items`  → las matrículas seleccionadas para ese plan
--
-- ── Por qué el tipo de cambio vive en el plan ───────────────────────────────
-- En el Excel el TC es UNA celda suelta ($BB$22955) que multiplica el precio
-- estimado en USD de TODAS las filas. Es un dato del plan, no de cada
-- matrícula: si se corrige, se corrige para todo el plan de una. Por eso es
-- una columna de `planes_compra` y no se repite por fila.
--
-- ── Qué NO se guarda: las columnas calculadas ───────────────────────────────
-- En el Excel más de la mitad de las columnas son fórmulas. Guardarlas sería
-- guardar algo que puede quedar desfasado del dato que lo origina. Se calculan
-- en la app (ver `calcularItem` en lib/planCompras.ts), replicando el Excel:
--
--   Recorte      = cant_aprobada − gd
--   Pu Sic + 20% = ROUND(MAX(pu_sic, pu_op) × 1.2, 0)
--   Pu Est ($)   = ROUNDUP(pu_est_usd × tipo_cambio, 0)
--   Verif.Precio = Pu Est ($) / Pu Sic + 20% − 1     (0 si no hay divisor)
--   Total $      = Pu Est ($) × gd
--   % Incidencia = Total $ de la fila / Total $ del plan
--
-- ── El plan es un subconjunto elegido a mano ────────────────────────────────
-- El Excel arrastra el catálogo entero (~23.000 filas) con la mayoría en cero.
-- Acá solo entran las matrículas que el usuario pega/elige: en el archivo real
-- apenas ~1.300 tienen pedido y ~380 cantidad aprobada.
--
-- ── Datos compartidos, no personales ────────────────────────────────────────
-- El plan de compras es de la oficina, no de cada usuario: todos ven y editan
-- el mismo. Por eso RLS permisiva (`USING (true)`), igual que `familias` o
-- `yerba_*`, y no `auth.uid() = user_id` como `notif_reglas`.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Plan anual ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS planes_compra (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Un plan por año (decisión de producto). El UNIQUE lo hace cumplir en la
  -- base y no solo en la UI.
  anio         integer NOT NULL UNIQUE,
  nombre       text    NOT NULL,
  -- Tipo de cambio del plan: multiplica Pu Est (USD) para obtener Pu Est ($).
  tipo_cambio  numeric NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES profiles(id) ON DELETE SET NULL
);

-- ─── Ítems del plan ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_compra_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES planes_compra(id) ON DELETE CASCADE,

  -- Número de matrícula TAL CUAL está en `matriculas.articulo` (con el .0 y
  -- los ceros a la izquierda). El cruce con el catálogo es por igualdad
  -- exacta, igual que en `familia_matriculas`. No es una FK: el catálogo se
  -- recarga entero desde Excel y una FK volaría ítems del plan al hacerlo.
  articulo    text NOT NULL,

  -- Copia del catálogo al momento de agregar la matrícula. Se guarda (en vez
  -- de leerse siempre de `matriculas`) para que el plan quede como una foto
  -- fiel del año: si mañana cambia la descripción en el catálogo, el plan
  -- cerrado no se reescribe solo.
  descripcion text NOT NULL DEFAULT '',
  unidad      text NOT NULL DEFAULT '',

  -- Clasificación: se carga a mano, es propia de cada plan.
  mat_serv            text NOT NULL DEFAULT '',
  familia             text NOT NULL DEFAULT '',
  subfamilia          text NOT NULL DEFAULT '',
  a_cargo_de          text NOT NULL DEFAULT '',
  partida             text NOT NULL DEFAULT '',
  descripcion_partida text NOT NULL DEFAULT '',

  -- Cantidades. `gd` es la columna «GD 20XX» del Excel (lo que pide GD);
  -- `cant_aprobada` es lo finalmente aprobado. Recorte = aprobada − gd.
  gd            numeric NOT NULL DEFAULT 0,
  cant_aprobada numeric NOT NULL DEFAULT 0,

  -- Precios unitarios de referencia. `pu_est_usd` es el que manda: es el que
  -- se convierte a pesos con el TC del plan.
  pu_sic      numeric NOT NULL DEFAULT 0,
  pu_op       numeric NOT NULL DEFAULT 0,
  pu_est_usd  numeric NOT NULL DEFAULT 0,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Una matrícula no puede estar dos veces en el mismo plan: sería doble
  -- conteo en todos los totales.
  UNIQUE (plan_id, articulo)
);

CREATE INDEX IF NOT EXISTS plan_compra_items_plan_idx
  ON plan_compra_items (plan_id);

CREATE INDEX IF NOT EXISTS plan_compra_items_articulo_idx
  ON plan_compra_items (articulo);

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE planes_compra     ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_compra_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS planes_compra_all ON planes_compra;
CREATE POLICY planes_compra_all ON planes_compra
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS plan_compra_items_all ON plan_compra_items;
CREATE POLICY plan_compra_items_all ON plan_compra_items
  FOR ALL USING (true) WITH CHECK (true);
