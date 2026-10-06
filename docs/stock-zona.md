# Sección Stock por Zona (`components/dashboard/sections/stock-zona.tsx`)

- **Propósito:** Ver y cargar el stock de materiales (con matrícula) agrupado por zona de depósito, clasificarlos en familias y consultar su tipo (Material/Servicio).
- **UI:** sistema de diseño dark de `design-system.md` (el mismo de IDO Carga/Resumen) — `.ido-terminal`/`.ido-card`, tabla en **CSS grid** (nunca `<table>`), tabs propios con burbuja deslizante (`.ido-tabs`), dropdowns propios (`IdoSelect`/`IdoMultiSelect`) reusando `.ido-menu`. `SortArrow`, `IdoCheckbox`, `TipoPill`, densidad y `monoFont` viven en `components/dashboard/ido-kit.tsx` (compartidos con Matrículas → Catálogo). Dejó de estar unificada visualmente con Informe Técnico ("beast pure"/oklch) — decisión explícita, no accidental: dos lenguajes visuales conviven en la app hasta que se decida migrar el resto.

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

## Tres pestañas (la edición de Familias se movió a Matrículas → Familias)
- **Resumen de stock:** tabla pivot virtualizada — una fila por matrícula. Columnas fijas: Matrícula, Descripción, UDM, **Tipo** (Material/Servicio), Total + columnas dinámicas por zona (colapsables con animación). Filtros: zona, familia, **Servicio/Material** y búsqueda por Nro/Nombre. Orden y redimensión por columna.
  - Descripción/UDM salen del catálogo maestro (prioridad) con respaldo en el stock.
  - **Servicios** del catálogo aparecen aunque no tengan stock (Total 0). Materiales sin stock NO se agregan (ruido). Matrículas con alguna familia asignada también se incluyen aunque no tengan stock.
  - El filtro por familia y el tipo efectivo se leen (solo lectura) desde las tablas nuevas vía `getFamilyRowsCompat()` de `lib/familias.ts`.
- **Mapa:** mapa interactivo de las zonas EPEC de Córdoba para saber dónde hay stock más cerca. Ver «Mapa de zonas» abajo.
- **Cargar datos:** textarea para pegar datos del sistema (tab-separado). Encabezado en la 1ª fila: `Artículo`, `Desc Artículo`, `UDM Primaria`, `En Mano`, `Organización`. La zona se detecta desde Organización. Flujo: pegar → previsualizar zonas → Importar → vuelve a "Resumen".

## Mapa de zonas (`stock-zona-mapa.tsx` + `lib/mapaZonas.ts`)
Portado del componente `MapaZonas` del import de Claude Design (zip «Sistema de diseño armado»). Se carga con `next/dynamic` (`ssr: false`) solo al abrir la pestaña: Leaflet toca `window` al importarse.
- **Leaflet 100% vectorial, sin tiles.** Geometría: límites IGN de los 26 departamentos de Córdoba en **`public/geo/cordoba.json`** (380 KB, se descarga una vez por sesión con `cargarGeo()`). Cada departamento trae su zona; B se arma como unión de BN + BS con borde exterior continuo y divisoria punteada.
- **Zonas = unión de departamentos, salvo A, D, E y H**, que traen polígono propio en `cordoba.json` → `zonas` (y su borde en `bordesZona`). Además hay excepciones forzadas por localidad (`ZONA_FORZADA` en `lib/mapaZonas.ts`: Villa Carlos Paz → BS aunque esté en Punilla, Río Segundo → H, Estación General Paz → A).
- **Forma de la Zona A (Capital + Gran Córdoba).** Antes A era el departamento Capital (el «cuadrado» del ejido). En el mapa de zonas de EPEC, A es más grande: suma la franja norte de Colón (Juárez Celman, Villa Los Llanos, Estación General Paz), el brazo este hasta Malvinas Argentinas, Mi Granja y Monte Cristo (Colón / Río Primero), y al sur y oeste Malagueño, Bouwer, Los Cedros y La Carbonada (Santa María) hasta el límite con Punilla. Se trazó desde una foto del mapa de EPEC: georreferenciada con 15 localidades de control (homografía, error ~1 km), se tomó el área amarilla por color, se recortó a la provincia sin B y se restó de E, H y D (sin huecos ni solapes; astillas < 0,002°² pasan a A; el bolsón de Colón que quedaba al sur del brazo este pasó a H). Precisión ±1 km: si EPEC pasa el trazado oficial, reemplazar `zonas.A` y recortar de nuevo las vecinas.
  - La zona de un punto (`zonaDe` / `ubicar`) sale de la **superficie de cada unidad** (`Unidad.areas`), no del departamento; el departamento se sigue usando solo para el nombre.
  - Los límites de departamento del fondo se dibujan una sola vez por arista (`modelo.lineasDepto`) y **no adentro de A**: el contorno de Capital y los bordes de Colón y Santa María que lo rodean parecían otra zona adentro de A.
- **Mapeo stock ↔ mapa** (`unidadDeStock`): `ZA→A`, **`ZB→BN` (B Norte, La Falda)**, **`ZI→BS` (B Sur, Villa Carlos Paz)**, `ZC…ZH→C…H`. El stock de B llega separado por subzona; el badge B suma las dos. Un código desconocido no se pinta en el mapa (sigue en la tabla).
- **Colores territoriales** como tokens `--ido-zona-a … --ido-zona-h`, `--ido-zona-bn`, `--ido-zona-bs` en `.ido-terminal` (`globals.css`). `ZonePill` de la tabla usa los mismos (antes era un hash sobre la paleta categórica), así una zona tiene el mismo color en tabla y mapa. Leaflet necesita colores resueltos para los `path` SVG: se leen con `getComputedStyle` sobre el panel, no se escriben hex en el componente.
- **Matrículas del mapa** (`mapaArticulos: string[]` en `stock-zona.tsx`): «Ver en mapa» de una fila del Resumen muestra esa sola (botón al final de la celda Descripción, visible en hover — no en Matrícula porque esa columna está en su ancho medido); «Ver en mapa» de la barra de selección lleva todas las tildadas. En el mapa, el buscador de matrículas **agrega** a la lista (vacío ofrece las fijadas, con «Agregar todas»).
  - **1 matrícula → cantidad:** relleno `0.14 + 0.32·√(q/max)`, cantidad bajo la etiqueta de zona, leyenda «Stock por zona».
  - **2+ matrículas → cobertura:** cada zona muestra `k/n` (cuántas de las n tiene con stock > 0); relleno proporcional a k/n; las zonas con todas van con borde más grueso y el `n/n` en verde (valor calculado). El resumen del panel dice en qué zonas están todas, o la cobertura máxima si ninguna las tiene.
- **Tarjeta de zona** (clic en una zona del mapa o en una fila de la leyenda): stock de la(s) matrícula(s) en esa zona, su depósito, distancia a la obra (si hay obra) y «Buscar la obra en esta zona» (lo que antes hacía el clic directo — filtrar el buscador — ahora es explícito). Se cierra con ×, Esc o clic fuera de las zonas; sigue al punto al mover el mapa (`posicionarPop` escribe la posición directo sobre el elemento — antes re-renderizaba todo el componente en cada cuadro del arrastre). La fila B de la leyenda (sin unidad propia) despliega BN / BS en vez de abrir tarjeta.
- **Depósito de cada zona** (`lib/stockDepositos.ts`, tabla `stock_zona_depositos` — **correr `supabase/stock_zona_depositos.sql`**): por defecto las distancias se miden desde la localidad de la delegación sede; desde la tarjeta de zona se puede elegir otra localidad («Cambiar depósito») o «Volver a la sede». Dato compartido por toda la oficina. Un depósito propio se dibuja como un cuadrado del color de la zona y las filas de stock dicen «desde X». Si la tabla no existe todavía, se usan las sedes y al guardar avisa qué SQL correr.
- **Filtro de zona:** se limpia solo al elegir la obra (ya no sirve una vez elegida).
- **Leyenda:** se pliega al elegir una matrícula (los números ya están sobre el mapa) y cuando la columna izquierda deja poco alto; se puede volver a abrir.
- **Intro del globo:** una vez por día (`localStorage` `mapa.intro.dia`), no en cada apertura.
- **Stock más cercano:** al elegir una localidad (buscador con tolerancia a errores, recientes en `localStorage` `mapa.recientes.v1` con clave `nombre|departamento` porque hay homónimas — las entradas viejas solo con nombre siguen andando —, atajo `/`), la tarjeta lista las zonas con stock ordenadas por distancia hasta la **delegación sede** de cada zona (`MapaModelo.sedes`). Con varias matrículas se agrupa en «Tienen las n» / «Tienen parte» (orden: cobertura y después distancia) y cada fila se despliega con la cantidad de cada matrícula. Se dibuja el recorrido hasta la primera y el mapa encuadra ambos puntos.
- **Distancias y depósitos:** las distancias por ruta guardadas valen para una obra **y** un juego de depósitos (`rutasKey = obra|depósitos`): al cambiar un depósito no se muestran las del depósito viejo mientras llegan las nuevas. Si OSRM no trae ruta para alguna zona, el orden de «Stock más cercano» usa línea recta para todas (mezclar km por ruta con km en recta favorecía a la que no tenía ruta).
- **Encuadre:** `userMovedRef` se prende con cualquier movimiento que no sea el encuadre automático (búsqueda, leyenda, ±, arrastre), así un resize no devuelve la vista a la provincia entera; «Vista completa» lo vuelve a apagar. Aparte, `interaccionRef` (arrastre o rueda del usuario): si ya movió el mapa, la llegada de las rutas (que puede cambiar la zona más conveniente) no lo re-encuadra.
- **Marcar en el mapa + zonas forzadas:** si el punto marcado está a ≤ 3 km de una localidad con zona forzada (p. ej. Villa Carlos Paz), toma esa zona, igual que al buscarla.
- **Distancia por ruta** (`lib/ruteo.ts`): OSRM público (`router.project-osrm.org`, sin clave, perfil auto). Una consulta `table` por localidad da km y minutos a las 9 sedes; otra `route` trae el trazado hacia la elegida. Cacheado en memoria por coordenadas, timeout 6 s. **Best-effort:** si falla, la tarjeta muestra «en línea recta» (haversine) y la línea pasa a recta punteada. El servidor demo de OSRM no tiene SLA ni es para uso intensivo: si se vuelve un problema, cambiar `OSRM` por una instancia propia u OpenRouteService (con clave).
- **Línea de distancia con flechas:** chevrones cada ~90 px de pantalla que apuntan desde la sede con stock HACIA la obra (`dibujarFlechas`, se recalculan en `zoomend`). La línea se guarda obra→sede (`lineaRef`) y se recorre al revés.
- **Filas de stock:** la distancia es el dato principal (a la derecha, verde en la más cercana); abajo «N <udm> en stock · tiempo en auto». Antes la cantidad iba a la derecha y «Kgs» (unidad del material) se leía como si fuera la distancia.
- **Capa «Rutas principales»** (`public/geo/rutas-cordoba.json`, 164 KB / 45 KB gzip): OpenStreetMap (ODbL — atribución obligatoria, va en el control de Leaflet), exportado con Overpass (`highway` motorway/trunk/primary) y procesado así: recorte al contorno exacto de Córdoba (punto-en-polígono sobre los departamentos, con bisección en el borde), fuera las avenidas urbanas sin `ref`, tramos de la misma ruta unidos, Douglas-Peucker a ~10 m con distancia al **segmento** (con distancia a la recta infinita se perdían los anillos cerrados — la Circunvalación entera — y tramos que vuelven sobre sí mismos). Las «primary» sin `ref` se conservan fuera de un radio de 15 km del centro de Córdoba (dentro son avenidas urbanas); si el nombre dice «Ruta 19» se toma ese número. Cobertura medida contra el export original: 96,9 % del trazado dentro de la provincia (lo que falta son esas avenidas). Trae `etiquetas` precalculadas (número normalizado: «RN 9», «RP E-53», «RN 1V09»; una cada ~45 km de trazado y nunca dos de la misma ruta a menos de 20 km). Estilo de contexto, no protagonista (`estiloRutas`): gris neutro `--ido-map-ruta`, grosor y opacidad crecen con el zoom (casi imperceptibles a escala provincial → más marcadas desde zoom 10) y bajan a la mitad cuando hay un recorrido a la obra dibujado (clase `has-recorrido` en el panel, que también atenúa los carteles). Los carteles se ven desde zoom 8 (`ZOOM_NUMERO_RUTA`) y entran al resolvedor de choques con la menor prioridad. Para regenerar: `scripts/rutas-osm.py` (la consulta de Overpass está en su encabezado). Si se quieren rutas secundarias, otra consulta con `secondary`.
- **Capas** (botón «Capas» sobre «Vista completa»): mostrar delegaciones (anillo rojo), distritos (anillo azul), rutas principales y todas las localidades (punto gris; agrupadas por cercanía con contador debajo de zoom 11 — clic en el grupo acerca). Preferencia de **este dispositivo** en `localStorage` `mapa.capas.v1`. Una localidad con anillo visible no se repite como punto. «Todas» dibuja solo lo que está en vista (+30 %) y se rehace en `moveend`; también se redibuja cuando llega Georef (antes quedaba con la lista embebida hasta mover el zoom).
- **Sin superposición de nombres** (`resolverEtiquetas`): tras cada zoom / cambio de capas / stock / obra se miden los tooltips fijos y se ocultan los que pisan algo de mayor prioridad — etiquetas de zona, cantidades y pin de la obra > delegaciones > distritos > resto de localidades. Reaparecen al acercar cuando hay lugar. Se miden todas las etiquetas en una sola pasada y recién después se ocultan (intercalar lecturas y escrituras forzaba un layout por nombre).
- **Filtro de zona** (clic en una zona o en la leyenda): se muestra como «Buscando en Zona X ×» debajo del campo de la obra, no adentro (en la tarjeta angosta tapaba el texto).
- **Nombres al acercar:** los tooltips pasan a permanentes según zoom — delegaciones desde 8, distritos desde 9,25, resto de localidades desde 10 (`ZOOM_NOMBRE_*`). Se re-vinculan solo al cruzar el umbral (Leaflet no deja cambiar `permanent` sobre un tooltip ya creado).
- **Panel izquierdo en dos tarjetas:** «Matrícula» (qué material) y «Dónde es la obra» (escribís la localidad o «Marcar en el mapa»). El buscador de localidades vive acá — ya no hay buscador centrado arriba. La tarjeta de la derecha muestra primero «Stock más cercano» y debajo los datos de la localidad.
- **Localidades:** al abrir el mapa se piden todas las de Córdoba a la API pública de Georef (`cargarLocalidadesGeoref` en `lib/mapaZonas.ts`, ~700, cacheadas 30 días en `localStorage` `mapa.localidades.georef.v1`) y se fusionan con la lista embebida de 82 (`modelo.fusionar`): las que coinciden por nombre+departamento (normalizado sin tildes) conservan el objeto propio — nombre con tildes y rol de delegación/distrito —; las nuevas pasan de «VILLA DEL ROSARIO» a «Villa del Rosario» y se ubican en su zona por punto-en-polígono. Si Georef no responde, queda la lista embebida y la tarjeta lo avisa («Lista reducida»). La zona forzada por distrito y los roles se comparan normalizados, porque Georef trae los nombres en mayúsculas y sin tildes.
- **Marcar en el mapa:** para obras en parajes que no figuran. Activa el modo (cursor de mira + aviso arriba, Esc cancela); el próximo clic dentro de Córdoba crea una «Obra (punto marcado)» con su zona y departamento (`modelo.ubicar`) y la localidad más cercana como referencia. Un clic sobre un anillo en ese modo elige esa localidad.
- **Intro globo → provincia** (d3-geo + topojson-client + `world-atlas/land-110m.json` desde npm, sin CDN): 1 s, una vez por apertura de la pestaña, salteada con `prefers-reduced-motion` o si las librerías no cargan en 2,5 s.
- **Errores de carga:** si falla la geometría **o el `import("leaflet")`** (red, deploy nuevo con chunks distintos), se muestra el estado de error con «Reintentar», no un panel vacío.
- **Accesibilidad:** filas de leyenda y filas desplegables de stock con `role="button"`, foco y Enter/Espacio (`aria-expanded` en las desplegables); los dos buscadores son `combobox` con `aria-expanded` / `aria-controls`.
- **Estilos:** prefijo `.mz-*` en `globals.css`, todos sobre tokens `--ido-*`. `.mz-map` tiene `z-index: 0` para que los paneles internos de Leaflet (hasta 1000, incluida la atribución) no queden encima de las tarjetas. Debajo de 900 px los buscadores se apilan y la tarjeta pasa a hoja inferior.

## Tipo efectivo (`tipoOf`)
`tipoOf(articulo)` = override manual (`matricula_tipo.tipo`) si existe, si no el `mat_serv` del catálogo `matriculas`.

## Rendimiento
- **Filas virtualizadas** con `@tanstack/react-virtual` (`overscan: 6` — con 14 se montaban ~28 filas fuera de pantalla, y al expandir zonas eso eran ~250 celdas extra).
- **Un solo contenedor de scroll para los dos ejes** (`resumenScrollRef`): header `position: sticky; top: 0` con fondo opaco + un wrapper interno con `width: contentW` explícito (§4.11). Con header y filas en contenedores separados el scroll horizontal se desincronizaba (columnas de zona corridas respecto del header).
- **Alto de la tabla medido, no fijo:** `maxHeight = innerHeight − top del contenedor − TABLE_BOTTOM_GAP`, recalculado con `ResizeObserver` + `resize`. Con un alto fijo la tabla quedaba más baja que la ventana en pantallas chicas y la barra de scroll horizontal (que va al pie del contenedor) quedaba fuera de vista.
- **Descripción absorbe TODO el sobrante** (sin el tope 2× de §4.17 — desvío deliberado): con la tabla colapsada el resto de las columnas es angosto, y con el tope quedaba un hueco vacío a la derecha de la tabla.
- **Animación de zonas:** las celdas de zona de cada fila (y del header) van en UN grupo `flex` y la clase `sz-zone-in/out` se aplica al grupo, no a cada celda (antes ~300 elementos animados a la vez → recálculo de estilos en cada frame). El `translateX` además no tenía efecto: estaba en un `<span>` inline.
- **Tamaño de fuente de celdas = 13px** fijado en la fila (design-system §2). Sin eso heredaban 16px y los pisos de ancho (medidos con canvas a 13px) quedaban cortos.
- **Números que no entran:** el texto va en un `<span>` con `minWidth: 0` + ellipsis. Con el ellipsis puesto en la celda flex alineada a la derecha, el número se recortaba por la IZQUIERDA sin "…" ("11.002.056,75" → ".1.002.056,75").
- **Pisos de ancho medidos con canvas** (`monoFont(px, weight)` resuelve `--font-mono`; `ctx.font` no entiende `var()`). Total se mide en negrita (600) y se re-mide cuando `document.fonts.ready` resuelve.
- **Densidad de fila (§4.19):** cambiar de modo (compacta/normal/cómoda) no remonta la grilla — a diferencia de `react-datasheet-grid` (IDO Carga), `useVirtualizer` sí reacciona a un `estimateSize` distinto, pero cachea el tamaño ya medido por índice: hace falta llamar a `virtualizer.measure()` en un efecto atado a `density`, si no una fila ya medida no se mueve.
- **Catálogo cacheado:** `getMatriculasInfo` se cachea en `sessionStorage` (`MATRICULAS_CACHE_KEY`) → 2ª carga instantánea; se refresca en segundo plano (no bloquea la vista de stock; hay indicador "catálogo…").
- **Ancho de columna + densidad persistidos** vía `lib/tableLayout.ts` (`ds.tableLayout.v1.<userId>.stockZonaResumen`, mismo mecanismo que IDO Carga/Resumen) — reemplazó el `localStorage` suelto (`COLWIDTHS_KEY`) que usaba antes. Ajuste de ancho al viewport (§4.17): solo Descripción absorbe sobrante (es la única columna de texto largo, y sin tope — ver arriba); el resto (Matrícula, UDM, Tipo, Total, columnas de zona) queda en su piso real. Doble clic en un borde de columna ajusta al contenido (§4.15).
- **`containerRef` (para medir el ancho disponible) va en un `<div>` que se monta SIEMPRE que `tab==="resumen"`**, no solo cuando hay datos — si el ref solo existiera dentro de la rama "hay datos", el `ResizeObserver` (que se conecta una sola vez al montar, deps `[]`) nunca vería un elemento real y el ancho quedaría en 0 para siempre (mismo tipo de bug que el offset del overlay de resize en IDO Carga: algo que solo se mide/conecta una vez y después queda mudo).
- Keyframes de la animación de zonas: `sz-zone-in` / `sz-zone-out` en `app/globals.css`.

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
