-- ============================================================================
-- Informe Técnico — Esquema de licitaciones
-- ============================================================================

-- Licitación: encabezado
CREATE TABLE IF NOT EXISTS licitaciones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_sic         text NOT NULL,
  titulo             text NOT NULL,
  fecha_apertura     date,
  fd_sic_fecha       date,
  fd_sic_valor       numeric,
  fd_op_fecha        date,
  fd_op_valor        numeric,
  umbral_economico_pct numeric NOT NULL DEFAULT 50,
  estado             text NOT NULL DEFAULT 'borrador',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Renglones de la licitación
CREATE TABLE IF NOT EXISTS licitacion_renglones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  licitacion_id   uuid NOT NULL REFERENCES licitaciones(id) ON DELETE CASCADE,
  numero          integer NOT NULL,
  condicion_adjudicacion text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (licitacion_id, numero)
);

-- Ítems dentro de cada renglón
CREATE TABLE IF NOT EXISTS licitacion_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renglon_id          uuid NOT NULL REFERENCES licitacion_renglones(id) ON DELETE CASCADE,
  numero_item         integer NOT NULL,
  matricula           text,
  descripcion         text,
  cantidad            numeric NOT NULL DEFAULT 1,
  precio_sic_pesos    numeric,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (renglon_id, numero_item)
);

-- Oferentes participantes
CREATE TABLE IF NOT EXISTS licitacion_oferentes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  licitacion_id   uuid NOT NULL REFERENCES licitaciones(id) ON DELETE CASCADE,
  nombre          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (licitacion_id, nombre)
);

-- Ofertas: precio unitario por (oferente × ítem)
CREATE TABLE IF NOT EXISTS licitacion_ofertas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oferente_id        uuid NOT NULL REFERENCES licitacion_oferentes(id) ON DELETE CASCADE,
  item_id            uuid NOT NULL REFERENCES licitacion_items(id) ON DELETE CASCADE,
  precio_unitario    numeric NOT NULL,
  divisa             text NOT NULL DEFAULT 'USD',
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oferente_id, item_id)
);

-- Evaluación técnica: una por (oferente × renglón)
CREATE TABLE IF NOT EXISTS licitacion_evaluaciones_tecnicas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oferente_id    uuid NOT NULL REFERENCES licitacion_oferentes(id) ON DELETE CASCADE,
  renglon_id     uuid NOT NULL REFERENCES licitacion_renglones(id) ON DELETE CASCADE,
  cumple         boolean,
  observaciones  text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oferente_id, renglon_id)
);

-- Adjudicación: ganador confirmado por renglón
CREATE TABLE IF NOT EXISTS licitacion_adjudicaciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renglon_id      uuid NOT NULL UNIQUE REFERENCES licitacion_renglones(id) ON DELETE CASCADE,
  oferente_id     uuid NOT NULL REFERENCES licitacion_oferentes(id) ON DELETE CASCADE,
  confirmado_por  uuid,
  confirmado_at   timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_renglones_licitacion ON licitacion_renglones(licitacion_id);
CREATE INDEX IF NOT EXISTS idx_items_renglon       ON licitacion_items(renglon_id);
CREATE INDEX IF NOT EXISTS idx_oferentes_licitacion ON licitacion_oferentes(licitacion_id);
CREATE INDEX IF NOT EXISTS idx_ofertas_oferente    ON licitacion_ofertas(oferente_id);
CREATE INDEX IF NOT EXISTS idx_ofertas_item        ON licitacion_ofertas(item_id);
CREATE INDEX IF NOT EXISTS idx_eval_oferente       ON licitacion_evaluaciones_tecnicas(oferente_id);
CREATE INDEX IF NOT EXISTS idx_eval_renglon        ON licitacion_evaluaciones_tecnicas(renglon_id);
