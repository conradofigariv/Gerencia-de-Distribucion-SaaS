# Sección Matrículas → Familias (`components/dashboard/sections/matriculas-familias.tsx`)

En el sidebar, **Matrículas** es un grupo con dos hijos: **Catálogo** (`matriculas`) y
**Familias** (`matriculas-familias`).

- **Propósito:** agrupar matrículas del catálogo en **familias** (entidad propia). Reemplaza
  la vieja pestaña Familias de Stock por Zona.
- **Modelo (entidad, no etiqueta):**
  - `familias(id uuid PK, nombre text UNIQUE, created_at)` — una familia existe por sí misma.
  - `familia_matriculas(familia_id → familias, articulo text, PK(familia_id, articulo))` —
    asignación **many-to-many** (una matrícula puede estar en varias familias).
  - `matricula_tipo(articulo PK, tipo)` — override manual de Material/Servicio, independiente
    de las familias. Migrado desde `stock_article_families.tipo`.
- **Lib `lib/familias.ts`:** `listFamilias`, `createFamilia`, `renameFamilia`, `deleteFamilia`,
  `listAsignaciones`, `assignMatriculas`, `removeMatriculas`, `bulkImport`,
  `validarContraCatalogo`, `getTipoOverrides`, `setTipoOverride`, y `getFamilyRowsCompat()`
  (devuelve el shape legado `FamilyRow` para que Stock por Zona lea sin reescribir su lógica).
  Reexporta `getMatriculasInfo` / `MatriculaInfo` / `ArticuloTipo` de `stockFamilies`.
- **UI:** panel izquierdo con la lista de familias (crear/renombrar/borrar/buscar); panel derecho
  con las matrículas de la familia elegida (virtualizado, quitar con X).
  - **Importar familia (masivo):** modal con *nombre de familia* + *pegar lista de matrículas*
    (una por línea; tolera coma/tab). **Preview** antes de confirmar: N reconocidas vs N no
    encontradas (cruce **exacto por número** contra `matriculas`; las no encontradas se omiten).
  - **Agregar matrículas (selección):** picker del catálogo completo (virtualizado, buscador,
    checkboxes) para sumar a la familia seleccionada.
- **Migración:** `supabase/familias.sql` (crea tablas) + `scripts/migrate-familias.mjs`
  (idempotente; copia `stock_article_families` → tablas nuevas). La tabla vieja queda de backup.
- **El número de matrícula se respeta tal cual** (con `.0` y ceros); nunca se normaliza.
