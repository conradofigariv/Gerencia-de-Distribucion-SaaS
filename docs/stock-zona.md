# Sección Stock por Zona (`components/dashboard/sections/stock-zona.tsx`)

- **Propósito:** Ver y cargar el stock de materiales (con matrícula) agrupado por zona de depósito, clasificarlos en familias y consultar su tipo (Material/Servicio).
- **UI:** sistema de diseño dark de `design-system.md` (el mismo de IDO Carga/Resumen) — `.ido-terminal`/`.ido-card`, tabla en **CSS grid** (nunca `<table>`), tabs propios con burbuja deslizante (`.ido-tabs`), dropdowns propios (`IdoSelect`/`IdoMultiSelect`) reusando `.ido-menu`. Dejó de estar unificada visualmente con Informe Técnico ("beast pure"/oklch) — decisión explícita, no accidental: dos lenguajes visuales conviven en la app hasta que se decida migrar el resto.

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
- **Filas virtualizadas** con `@tanstack/react-virtual`. El header vive FUERA del contenedor que scrollea verticalmente (`resumenScrollRef` solo envuelve las filas), así que no necesita `position:sticky` ni tokens con alpha — evita de raíz el bug de header semitransparente que sí aplica en tablas `<table>` con `<th>` sticky (visto en Matrículas → Catálogo, PR #58).
- **Densidad de fila (§4.19):** cambiar de modo (compacta/normal/cómoda) no remonta la grilla — a diferencia de `react-datasheet-grid` (IDO Carga), `useVirtualizer` sí reacciona a un `estimateSize` distinto, pero cachea el tamaño ya medido por índice: hace falta llamar a `virtualizer.measure()` en un efecto atado a `density`, si no una fila ya medida no se mueve.
- **Catálogo cacheado:** `getMatriculasInfo` se cachea en `sessionStorage` (`MATRICULAS_CACHE_KEY`) → 2ª carga instantánea; se refresca en segundo plano (no bloquea la vista de stock; hay indicador "catálogo…").
- **Ancho de columna + densidad persistidos** vía `lib/tableLayout.ts` (`ds.tableLayout.v1.<userId>.stockZonaResumen`, mismo mecanismo que IDO Carga/Resumen) — reemplazó el `localStorage` suelto (`COLWIDTHS_KEY`) que usaba antes. Ajuste de ancho al viewport (§4.17): solo Descripción absorbe sobrante (es la única columna de texto largo); el resto (Matrícula, UDM, Tipo, Total, columnas de zona) queda en su piso real. Doble clic en un borde de columna ajusta al contenido (§4.15).
- **`containerRef` (para medir el ancho disponible) va en un `<div>` que se monta SIEMPRE que `tab==="resumen"`**, no solo cuando hay datos — si el ref solo existiera dentro de la rama "hay datos", el `ResizeObserver` (que se conecta una sola vez al montar, deps `[]`) nunca vería un elemento real y el ancho quedaría en 0 para siempre (mismo tipo de bug que el offset del overlay de resize en IDO Carga: algo que solo se mide/conecta una vez y después queda mudo).
- Animación colapso/expansión de zonas: keyframes `sz-zone-in` / `sz-zone-out` en `app/globals.css`.

## Botón "Ayuda" (`StockHelpModal`)
Centro de ayuda con el **mismo concepto que el `HelpModal` de Informe Técnico** (overlay oscuro, sidebar de temas con íconos de color + subtítulo, header de tema, footer Anterior/puntos/Siguiente/Entendido), reskineado a tokens `--ido-*` en vez de `oklch()`. Temas: **Cargar datos** (guía SIGA con capturas en `public/ayuda-stock/paso1-5.png`), **Resumen de stock**. Helpers replicados: `HelpSection`, `HelpAction`, `HelpTip`.

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
