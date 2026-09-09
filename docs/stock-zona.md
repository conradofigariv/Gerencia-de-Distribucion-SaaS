# Sección Stock por Zona (`components/dashboard/sections/stock-zona.tsx`)

- **Propósito:** Ver y cargar el stock de materiales (con matrícula) agrupado por zona de depósito, clasificarlos en familias y consultar su tipo (Material/Servicio).
- **UI "beast pure":** unificada con Informe Técnico — header con ícono verde, tabs pill con flechas `→`, contenedor `oklch(0.235 0.005 270)`, paneles internos `oklch(0.205 0.005 270)`. Dropdowns con el componente local `BeastSelect` (mismo estilo que Informe Técnico, soporta `portal` para escapar contenedores con overflow).

## Tres fuentes de datos (independientes)
| Fuente (sección) | Tabla | Aporta | Frescura |
|---|---|---|---|
| Carga de datos → MATRICULAS | `matriculas` | Lista completa de matrículas + **descripción** + UDM + **mat_serv** (Material/Servicio) | ✅ La más actualizada |
| Stock por Zona → Cargar datos | `stock_uploads` | **Cantidad** de stock por zona | Otro procedimiento (extracción SIGA) |
| Familias (Matrículas → Familias) | `familias` + `familia_matriculas` + `matricula_tipo` | **Familias** (entidad) + override manual de tipo | Manual (se editan en Matrículas, acá se leen) |

El stock y las familias son enriquecimientos sobre la lista maestra de matrículas. **El número de matrícula se muestra, busca y guarda tal cual (con el `.0` y los ceros) — NUNCA normalizar el formato visible.** El cruce entre tablas es por matrícula exacta.

## Libs
- **`lib/stockStorage.ts`** — carga de stock por zona: `parseTSV`, `getUploads`, `saveUpload`, `removeUpload`, `COL_MAP`. Tabla `stock_uploads(zona TEXT PK, file_name, uploaded_at, rows JSONB)`.
- **`lib/stockFamilies.ts`** — familias + catálogo maestro:
  - `interface FamilyRow { articulo; familias: string[]; tipo: ArticuloTipo }` — **multi-familia** (una matrícula puede tener varias). Sin subfamilia.
  - Persistencia: las familias se guardan en la columna `familia` de `stock_article_families` como **array JSON** (ej. `["Cables","Aluminio"]`). Las filas viejas de una sola familia en texto plano **se migran solas al leerlas** (`parseFamilias`). No requiere cambios de schema en Supabase.
  - `getFamilies`, `upsertFamily`, `upsertFamiliesBulk`, `deleteFamily`, `deleteFamiliesBulk`.
  - `interface MatriculaInfo { descripcion; udm; tipo }` + `getMatriculasInfo()` → Map `articulo → MatriculaInfo` leyendo `matriculas` (descripción, UDM y `mat_serv` normalizado a tipo). **Descarga paralela:** 1ª página con conteo exacto + resto con `Promise.all` (Supabase corta en ~1000 filas).

## Dos pestañas (la edición de Familias se movió a Matrículas → Familias)
- **Resumen de stock:** tabla pivot virtualizada — una fila por matrícula. Columnas fijas: Matrícula, Descripción, UDM, **Tipo** (Material/Servicio), Total + columnas dinámicas por zona (colapsables con animación). Filtros: zona, familia, **Servicio/Material** y búsqueda por Nro/Nombre. Orden y redimensión por columna.
  - Descripción/UDM salen del catálogo maestro (prioridad) con respaldo en el stock.
  - **Servicios** del catálogo aparecen aunque no tengan stock (Total 0). Materiales sin stock NO se agregan (ruido). Matrículas con alguna familia asignada también se incluyen aunque no tengan stock.
  - El filtro por familia y el tipo efectivo se leen (solo lectura) desde las tablas nuevas vía `getFamilyRowsCompat()` de `lib/familias.ts`.
- **Cargar datos:** textarea para pegar datos del sistema (tab-separado). Encabezado en la 1ª fila: `Artículo`, `Desc Artículo`, `UDM Primaria`, `En Mano`, `Organización`. La zona se detecta desde Organización. Flujo: pegar → previsualizar zonas → Importar → vuelve a "Resumen".

## Tipo efectivo (`tipoOf`)
`tipoOf(articulo)` = override manual (`matricula_tipo.tipo`) si existe, si no el `mat_serv` del catálogo `matriculas`.

## Rendimiento
- **Tablas virtualizadas** con `@tanstack/react-virtual` (técnica de filas espaciadoras + header sticky). Solo se renderizan las filas visibles → fluidez con miles de filas.
- **Header sticky opaco:** los `<th>` usan `background: oklch(0.255 0.006 270)` (opaco) — en la práctica, la clase `bg-panel-header`. ⚠ NO usar `bg-secondary` / `hsl(var(--secondary))` para el fondo del header: `--secondary` está definida en oklch **con alpha** (`oklch(0.18 0.005 260 / 0.85)`), así que queda semitransparente y el contenido de las filas se transparenta debajo al hacer scroll (bug real, visto en Matrículas → Catálogo, PR #58).
- **Catálogo cacheado:** `getMatriculasInfo` se cachea en `sessionStorage` (`MATRICULAS_CACHE_KEY`) → 2ª carga instantánea; se refresca en segundo plano (no bloquea la vista de stock; hay indicador "catálogo…").
- **Ancho de columnas persistido** en `localStorage` (`COLWIDTHS_KEY`) → se restaura al volver a abrir.
- Animación colapso/expansión de zonas: keyframes `sz-zone-in` / `sz-zone-out` en `app/globals.css`.

## Botón "Ayuda" (`StockHelpModal`)
Centro de ayuda con el **mismo diseño y concepto que el `HelpModal` de Informe Técnico** (overlay oscuro, card `oklch(0.15)`, sidebar de temas con íconos de color + subtítulo, header de tema, footer Anterior/puntos/Siguiente/Entendido). Temas: **Cargar datos** (guía SIGA con capturas en `public/ayuda-stock/paso1-5.png`), **Resumen de stock**, **Familias**. Helpers replicados: `HelpSection`, `HelpAction`, `HelpTip`.

## Eliminado / histórico
- Se eliminó el importador "Mat/Ser desde Excel" (tercera planilla con formato distinto que rompía el cruce). El tipo ahora sale del catálogo (`matriculas.mat_serv`).
- Se eliminó la **subfamilia** (el modelo pasó a multi-familia como etiquetas).

## SQL — tablas no estándar
```sql
-- Stock por Zona
CREATE TABLE stock_uploads (
  zona text PRIMARY KEY,
  file_name text,
  uploaded_at timestamptz DEFAULT now(),
  rows jsonb NOT NULL
);

-- Familias de matrículas (LEGADO — reemplazado por familias.sql, ver
-- docs/matriculas-familias.md; esta tabla queda de backup post-migración).
-- La columna `familia` guarda un array JSON de familias (ej. ["Cables","Aluminio"]);
-- `tipo` es override manual de Material/Servicio. `subfamilia` sin uso.
CREATE TABLE stock_article_families (
  articulo text PRIMARY KEY,
  familia text,        -- array JSON de familias (o texto plano legado)
  subfamilia text,     -- sin uso (histórico)
  tipo text            -- 'material' | 'servicio' | null
);
```
