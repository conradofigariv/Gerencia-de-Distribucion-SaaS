-- ============================================================================
-- ui_column_labels — Nombres de columna editables desde el sistema
--
-- Permite renombrar visualmente los headers de las tablas (ej. el Resumen de
-- Control de servicios) sin tocar la columna real del cubo. La clave `col` es
-- el nombre técnico (ej. "fecha_pactada") y NUNCA cambia; solo se guarda el
-- `label` que ve el usuario. `scope` separa cada tabla/sección.
--
-- Ver lib/columnLabels.ts
-- ============================================================================

CREATE TABLE IF NOT EXISTS ui_column_labels (
  scope      text NOT NULL,            -- ej. 'servicios-resumen'
  col        text NOT NULL,            -- clave técnica de la columna (cubo)
  label      text NOT NULL,            -- nombre visible elegido por el usuario
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, col)
);

-- updated_at automático (reutiliza set_updated_at si ya existe).
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ui_column_labels_updated_at ON ui_column_labels;
CREATE TRIGGER trg_ui_column_labels_updated_at
  BEFORE UPDATE ON ui_column_labels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS permisiva, igual que el resto de las tablas que opera la app con anon key.
ALTER TABLE ui_column_labels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ui_column_labels_all" ON ui_column_labels;
CREATE POLICY "ui_column_labels_all" ON ui_column_labels FOR ALL USING (true) WITH CHECK (true);
