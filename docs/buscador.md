# Buscador — Búsqueda Global y Pestañas de Seguimiento

El Buscador es un sistema de dos capas:
1. **Índice maestro** (`busqueda_index`): base de solo lectura que se regenera entera en cada "Reconstruir". Contiene todas las filas de compra (OP/línea/envío) y catálogo.
2. **Pestañas de seguimiento** (`buscador_tabs`, `buscador_tab_filas`): espacio de trabajo del usuario. Se copian filas del índice acá, editables y reordenables por usuario — y **compartibles con otros usuarios** (`buscador_tab_shares`, ver sección propia más abajo).

## Arquitectura de Datos

### `busqueda_index` (READ ONLY)
Tabla maestro regenerada en cada reconstrucción. Una fila por (OP, línea, envío) más catálogo.

**Columnas principales:**
- `id` (bigserial): ID volátil — cambia en cada reconstrucción, NO usar como clave.
- `fuente` (enum): `'op'`, `'catalogo'`, `'transaccion'`, `'sic'` — origen de la fila.
- `articulo_key` (text): código de matrícula normalizado ("00009411").
- `descripcion`, `unidad_medida`, `estado_matricula`, `tipo`, `mat_serv`, `en_catalogo`: datos de la matrícula.
- `numero_sic`, `sic_linea`, `sic_cantidad`, `sic_udm`, `sic_preparador`, `sic_fecha_creacion`: contexto SIC si aplica.
- `relacion`, `numero_op`, `linea`, `envio`, `envios_linea`: identificadores de compra.
- `proveedor`: metadata de compra.
- `op_descripcion`, `zona`: **cargados a mano** en `op_datos`, no vienen de la planilla. Ver "Datos manuales de OP" más abajo.
- `cantidad`, `cantidad_recibida`, `ctd_aceptada`, `pendiente`, `cantidad_vencida`, `cantidad_rechazada`, `cantidad_facturada`, `cantidad_cancelada`: cantidades por estado.
- `fecha_creacion`, `fecha_pactada`: texto crudo del Excel, **para mostrar**.
- `fecha_creacion_d`, `fecha_pactada_d` (date): las mismas parseadas, **para ordenar y filtrar**. Ver "Fechas" abajo.
- `estado_autorizacion`, `estado_cierre`: estados.
- `tx_recibido`, `tx_aceptado`, `tx_entregado`, `tx_devoluciones`, `tx_movimientos`: totales por línea de `tablero_op_transaccion`.
- `tx_primera_fecha`, `tx_ultima_fecha`: rango de movimientos en ISO YYYY-MM-DD.
- `updated_at` (timestamptz): última reconstrucción.

**Clave estable:** `rowKey(r) = "${r.fuente}|${r.articulo_key ?? ""}|${r.numero_op ?? ""}|${r.linea ?? ""}|${r.envio ?? ""}"`
— Usada para deduplicar al agregar filas a pestañas y para refreschs manuales.

**Consulta:**
- `buscar(q, limite)`: búsqueda full-text via RPC `gd_buscar`.
- `buscarPorMatriculas(articulos[], limite)`: query by `articulo_key` en tandas de 100 para evitar límites de URL.

---

### Pestañas de Usuario

#### `buscador_tabs`
Pestañas privadas de cada usuario — listas nombradas para seguimiento.

**Schema:**
```sql
id         uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id    uuid REFERENCES auth.users NOT NULL
nombre     text NOT NULL
orden      integer NOT NULL DEFAULT 0
color      text
config     jsonb NOT NULL DEFAULT '{}'
           -- { order: string[], hidden: string[], widths: Record<string, number> }
           -- Configuración de columnas POR PESTAÑA (no global).
created_at timestamptz NOT NULL DEFAULT now()
updated_at timestamptz NOT NULL DEFAULT now()
```

**RLS:** Solo el dueño (`auth.uid() = user_id`) puede leer/escribir sus pestañas.

**Operaciones (lib/buscadorTabs.ts):**
- `fetchTabs(userId)`: Todas las pestañas del usuario, ordenadas.
- `createTab(userId, nombre, orden)`: Nueva pestaña.
- `renameTab(id, nombre)`: Cambiar nombre.
- `updateTabConfig(id, config)`: Guardar visibilidad/orden/anchos de columnas.
- `deleteTab(id)`: Borrar pestaña (filas se borran solas via ON DELETE CASCADE).

---

#### `buscador_tab_filas`
Filas copiadas dentro de una pestaña — editable, reordenable.

**Schema:**
```sql
id         uuid PRIMARY KEY DEFAULT gen_random_uuid()
tab_id     uuid REFERENCES buscador_tabs (id) ON DELETE CASCADE NOT NULL
datos      jsonb NOT NULL DEFAULT '{}'
           -- Fila COMPLETA copiada del índice + 4 columnas de seguimiento:
           -- _nota, _estado, _responsable, _fecha_revision
row_key    text
           -- "fuente|articulo_key|numero_op|linea|envio"
           -- De dónde salió la fila en el índice. Sirve para avisar de duplicados
           -- al agregar y para refresco manual. Puede quedar huérfana.
orden      integer NOT NULL DEFAULT 0
created_at timestamptz NOT NULL DEFAULT now()
updated_at timestamptz NOT NULL DEFAULT now()
```

**Columnas de seguimiento (lib/buscadorTabs.TRACK_KEYS):**
```typescript
{
  nota:           "_nota"             // texto libre
  estado:         "_estado"           // "Pendiente" | "En curso" | "Resuelto"
  responsable:    "_responsable"      // nombre o email
  fechaRevision:  "_fecha_revision"   // ISO YYYY-MM-DD
}
```

**RLS:** Heredan el acceso de su pestaña — dueño y colaboradores compartidos ven las filas (lectura: SELECT; escritura de filas: solo dueño + colaboradores con permiso "edición"). Ver "Compartir pestañas" más abajo.

**Operaciones (lib/buscadorTabs.ts):**
- `fetchTabFilas(tabId)`: Todas las filas de la pestaña.
- `addFilas(tabId, rows, rowKeyOf, ordenBase)`: Copiar filas del índice. Detecta duplicados por `row_key`.
- `updateFilaDatos(id, datos)`: Guardar edición de una celda (datos completo).
- `deleteFilas(ids)`: Borrar filas.
- `reorderFilas(filas[])`: Persistir reorden manual después de drag.

---

## Datos manuales de OP — `op_datos`

La planilla de OPs (**«Envíos»**, una fila por OP/línea/envío) no trae ninguna
descripción de la OP en sí — la única que llega es la de la matrícula, que es
otra cosa — y su columna de zona (`organizacion_envio`) no es confiable.

`op_datos` guarda lo que el usuario carga a mano, **una fila por OP**:

```sql
numero_op (PK) · descripcion · zona · updated_at · updated_by
```

**Por qué una tabla aparte:**
- `busqueda_index` se borra y recrea entera en cada «Reconstruir» — cualquier dato manual ahí se perdería.
- Las filas de `buscador_tab_filas` son copias congeladas y privadas de una pestaña: habría que recargar el dato en cada pestaña donde aparezca esa OP, se perdería al borrarla y no lo vería nadie más.
- Es el mismo patrón que `matricula_tipo` (override manual de Material/Servicio, cargado desde Stock por Zona), que el rebuild ya joinea desde antes.

**Granularidad:** por OP. Se carga una vez y vale para todas sus líneas y envíos —
una OP de 12 líneas es 1 carga, no 12.

**Zona 100% manual.** `organizacion_envio` (columna «Organización Envío» de la
planilla) se sacó del sistema entero — no era confiable y no se usa más: no se
lee al importar, no entra al índice, y se borró de `planillas_op` (ver
`supabase/planillas_op_drop_organizacion_envio.sql`). Sin `op_datos.zona`
cargada, el campo `zona` del índice queda `NULL` — vacío, no un dato de la
planilla.

### Cómo llega a la vista — dos caminos

1. **`gd_reconstruir_busqueda()`** hace `LEFT JOIN _opd` en las tres ramas que tienen OP (`op`, `transaccion`, `sic`) y escribe los valores dentro de `busqueda_index`. Ambos campos entran además al texto buscable, así que se puede buscar «zona sur» y traer todas las OP de esa zona.
2. **Overlay en el cliente** (`aplicarOpDatos` en `lib/opDatos.ts`): entre dos reconstrucciones el índice queda viejo, y las filas de pestaña están congeladas desde el día que se copiaron. El Buscador superpone `op_datos` sobre lo que cargó (`rowsConOp`, `tabFilasConOp`), así lo último escrito se ve al instante sin reconstruir nada.

Las claves se normalizan con `gd_norm_op()` en SQL y `normOp()` en TS (mismo
`.trim().replace(/\.0+$/, "")`), así da igual con qué forma del número se haya
guardado.

### Edición

`OP_MANUAL_COLS = { op_descripcion, zona }` marca las dos columnas que NO se
guardan en la fila. En `commitEdit` hay una rama propia: van a `op_datos` vía
`upsertOpDato()` en vez de al `datos` jsonb de la fila.

- Se editan con doble-click **tanto en una pestaña como en el índice maestro** (el resto de las columnas del índice maestro sigue siendo de solo lectura). Como en el maestro no hay `filaId`, la clave de edición pasa a ser la fila visible.
- Editar una fila actualiza **todas** las filas de esa OP en pantalla al instante — es un dato de la OP, no de la fila.
- Una fila sin `numero_op` (matrícula solo de catálogo) no es editable, con el motivo en el tooltip.
- Respetan `puedoEditar`: en una pestaña compartida de solo lectura no se pueden tocar.

---

## Compartir pestañas

Una pestaña se puede compartir con usuarios puntuales del equipo (elegidos por
nombre), cada uno con un permiso propio. SQL completo en
[`supabase/buscador_tab_shares.sql`](../supabase/buscador_tab_shares.sql).

### Modelo

- **Con quién:** usuarios específicos, no "todo el equipo" — se buscan por nombre en `profiles` (ya legible por cualquier autenticado, ver `supabase/profile_cumpleanos.sql`) y se agregan de a uno.
- **Permiso por persona:**
  - `lectura`: solo ve la pestaña — filas, columnas, agrupado. No puede editar nada.
  - `edicion`: además de las filas (agregar, editar columnas de seguimiento, borrar, reordenar), puede tocar `config` (columnas/agrupado) y renombrar la pestaña. **No** puede borrarla ni gestionar quién tiene acceso — eso es exclusivo del dueño.
- **Vista única:** columnas, orden, anchos y agrupado son el MISMO `buscador_tabs.config` para todo el que abre la pestaña — no hay una vista personal por usuario. Por eso un editor reordenando columnas cambia lo que ven los demás, y por eso un lector no puede tocar esos controles (quedan bloqueados en la UI, ver `ColumnsMenu`'s prop `locked` y el toggle "Agrupar" deshabilitado).
- **Dueño:** único que puede borrar la pestaña y gestionar colaboradores (agregar, sacar, cambiar permiso). Un trigger (`gd_bloquear_cambio_dueno_pestana`) impide que un UPDATE le cambie el `user_id` a la pestaña, aunque lo intente un editor con acceso directo a la API.

### Tabla `buscador_tab_shares`

```sql
id, tab_id, user_id, permiso ('lectura'|'edicion'), created_at
UNIQUE (tab_id, user_id)
```

### RLS — funciones SECURITY DEFINER

Evitar la recursión de RLS (una policy de `buscador_tabs` que mirara
`buscador_tab_shares` dispararía la RLS de esa tabla, que podría necesitar
mirar `buscador_tabs`…) es el motivo de dos funciones `SECURITY DEFINER`:

- `gd_puede_leer_pestana(tab_id)`: dueño o cualquier colaborador (lectura o edición).
- `gd_puede_editar_pestana(tab_id)`: dueño o colaborador con permiso `edicion`.

Se usan en las policies de `buscador_tabs` (SELECT/UPDATE) y `buscador_tab_filas`
(SELECT/INSERT/UPDATE/DELETE). INSERT y DELETE de `buscador_tabs` (crear y
borrar la pestaña en sí) siguen restringidos a `auth.uid() = user_id` — nunca
pasan por estas funciones.

### Operaciones (lib/buscadorTabs.ts)

- `fetchColaboradores(tabId)`: Lista de colaboradores con nombre/avatar ya resueltos desde `profiles` (dos queries — no hay FK share→profiles para que PostgREST embeba automáticamente).
- `compartirTab(tabId, userId, permiso)`: Upsert — comparte o cambia el permiso de alguien ya compartido.
- `descompartirTab(tabId, userId)`: Saca a un colaborador.
- `fetchMisPermisos(userId)`: Mapa `tab_id → permiso` de TODO lo que otros compartieron con el usuario actual (no incluye las propias). Se trae una sola vez al entrar al Buscador.
- `fetchEquipo()`: Todo el equipo (id/email/nombre/apellido/avatar), para el picker de "compartir con…" — se filtra por nombre O email en el cliente. Pasa por `/api/team` (no por una query directa a `profiles`) porque el email vive en `auth.users`, que solo la service role puede leer; a diferencia de `/api/admin/users`, este endpoint NO exige ser administrador — cualquiera puede compartir una pestaña propia y necesita poder buscar a un colega.

### UI (`buscador.tsx`)

- Ícono `Share2` junto al nombre de la pestaña activa (solo visible para el dueño) abre `ShareDialog` — modal con la lista de colaboradores actuales (cada uno con un `<select>` lectura/edición y botón para sacarlo) y un buscador para agregar gente nueva.
- En la barra de pestañas, una compartida-conmigo muestra un ícono: `Users` (celeste) si tengo edición, `Lock` (gris) si es de solo lectura.
- Puntos gateados por `puedoEditar` (deriva de `esPropia || miPermiso === "edicion"`, fail-closed a `"lectura"` si `misPermisos` todavía no cargó):
  - Doble-click para editar una celda (tanto columnas del índice como las de seguimiento).
  - Arrastrar para reordenar filas (`puedeArrastrar`).
  - Botón de borrar fila (no se muestra si es de solo lectura).
  - Dropdown "Agregar a pestaña" del índice maestro: solo ofrece pestañas donde `permisoDe(t) === "edicion"`.
  - `ColumnsMenu` recibe `locked={isTabMode && !puedoEditar}` — con eso puesto se puede abrir el menú para VER las columnas pero no arrastrar, ocultar ni restablecer.
  - Toggle "Agrupar" y el desplegable de criterio, deshabilitados (`disabled`) si es de solo lectura.
  - `compactar` (plegar columnas redundantes al agrupar) y `colapsados` (qué grupos están cerrados) NO están gateados — son vista local efímera, nunca se persisten, así que un lector los puede tocar libremente sin afectar a nadie.
- Renombrar (`Pencil`) se ofrece a dueño Y editores; borrar pestaña (`Trash2`) y compartir (`Share2`) solo al dueño.

---

## Uso desde la UI

### Buscador (`components/dashboard/sections/buscador.tsx`)

**Modo índice:**
- Búsqueda global. Caja vacía = las OP más nuevas primero (`gd_buscar` ordena por `fecha_creacion DESC` cuando `p_q` viene vacío — ver `supabase/busqueda_global.sql`). Antes, con la caja vacía se mostraba un cartel de "escribí algo" y no se pedía nada al índice.
- Checkboxes para seleccionar filas. La selección **sobrevive a cambiar la búsqueda** (tildar a lo largo de varias búsquedas es un caso legítimo).
- Dropdown "Agregar a pestaña" → copia las seleccionadas a la pestaña elegida. ⚠ Solo copia las que están **dentro de la búsqueda actual** (`sorted.filter(...)`), así que el botón muestra `seleccionadasVisibles` y, si hay tildadas fuera, aclara «de N». El checkbox de "seleccionar todo" del header opera solo sobre lo visible por el mismo motivo, y conserva lo tildado en otras búsquedas.
- Las celdas editables muestran un **lápiz al pasar el mouse** — el doble click es el único gesto de edición y sin eso no se anuncia. Importa sobre todo en Zona y Descripción OP, que arrancan vacías.

### Menú contextual de fila (click derecho)

`RowContextMenu` + `abrirMenuFila()` en `buscador.tsx`. Se abre con click derecho
sobre cualquier celda y **sabe sobre qué columna se hizo click**, así puede
ofrecer acciones de esa celda puntual. Los items dependen del modo y del permiso:

| | Índice maestro | Dentro de una pestaña |
|---|---|---|
| Editar «columna» | solo Zona / Descripción OP | cualquier columna + las de seguimiento |
| Copiar valor | ✅ | ✅ |
| Fijar arriba / Quitar de fijadas | ✅ | — |
| Seleccionar / Quitar de la selección | ✅ | — |
| Agregar a «pestaña» | una por cada pestaña editable | — |
| Quitar de la pestaña | — | ✅ |
| Quitar el grupo entero | — | ✅ si está agrupado |

El menú se reposiciona solo si se sale de la ventana, y se cierra con Escape,
click afuera, resize o **scroll** (queda anclado a coordenadas de pantalla: sin
eso, scrollear la tabla lo dejaría apuntando a otra fila).

**El tacho de borrar fila salió de la columna de acciones** y vive solo acá: era
una acción destructiva a un click suelto, pegada al handle de arrastre.

**Modo pestaña:**
- Muestra filas copiadas + 4 columnas de seguimiento (estado, responsable, fechaRevision, nota).
- Agrupa (collapsible) por el criterio elegido: **Matrícula** (default), **SIC** u **OP** — desplegable al lado del toggle "Agrupar".
  - **Tanto el toggle "Agrupar" como el criterio son propios de CADA pestaña** — se guardan en `buscador_tabs.config` (`agrupar`, `agruparPor`), igual que el orden/visibilidad/ancho de columnas. Una pestaña puede estar agrupada por OP mientras otra no agrupa nada, y cada una lo recuerda al volver a abrirla (`buscador.tsx`: `agrupar`/`agruparPor` son valores DERIVADOS de `tabCfg`, no estado propio — ver `patchLayout`).
  - **Buscar dentro de una pestaña abre todos los grupos**, y limpiar la búsqueda vuelve a cerrarlos. Sin eso el filtro deja los resultados escondidos adentro de grupos cerrados y la búsqueda parece no encontrar nada.
  - Cambiar de criterio recalcula los grupos y los colapsa todos de nuevo (los `colapsados` guardados son claves del criterio anterior, no sirven para el nuevo). `colapsados` en sí NO se persiste — es UI efímera.
  - ⚠ El efecto que pliega los grupos lee `tabFilas` **por ref**, no por deps: `tabFilas` cambia de identidad en cada edición de celda / borrado / reordenamiento, y tenerla en las deps hacía que los grupos se cerraran de golpe cada vez que se tocaba un dato. El disparador de la recarga es `loadingTab`.
  - Helper: `groupKeyOf(data, criterio)` en `buscador.tsx` — misma clave para agrupar, contar y detectar columnas redundantes.
  - Título del encabezado de grupo por criterio: matrícula → código + descripción; SIC → "SIC {n}" + preparador; OP → "OP {n}" + proveedor.
  - **Borrar un grupo entero:** ícono de tacho en el encabezado del grupo (junto al de plegar) — borra de la pestaña TODAS las filas de ese grupo (esa OP, esa matrícula, esa SIC) en un solo paso, con confirmación previa. `GrupoItem.filaIds` junta los ids de sus filas al armar `displayItems`; `handleDeleteGrupo(filaIds, titulo)` hace un solo `deleteFilas(filaIds)` en lote (no uno por fila), optimista con rollback si falla. Gateado por `puedoEditar` — no aparece en una pestaña compartida de solo lectura.
- Edición inline: doble-click en una celda, Enter para guardar, Escape para cancelar.
- Drag-and-drop para reordenar (deshabilitado si está agrupado).

**Barra superior:**
- `+ Pestaña`: Crea nueva pestaña.
- Doble-click en nombre de pestaña: renombra.
- Botón `×` en pestaña: elimina.
- Toggle "Agrupar": agrupa por matrícula (desactiva reorden, activa collapsibles).
- Chip de estado del índice (N filas): abre un menú con las filas indexadas, la fecha de la última reconstrucción y el botón **"Reconstruir ahora"** (con confirmación). Está adentro del menú y no suelto en la barra a propósito: tarda varios minutos y, desde que cada carga masiva reconstruye sola, casi nunca hace falta a mano.
- "Restablecer": limpia orden/visibilidad/anchos de columnas → defaults.

---

### Familias → Buscador (`components/dashboard/sections/matriculas-familias.tsx`)

Botón "Al Buscador" en el panel de familia:
- Dialog para elegir pestaña destino (existente o nueva).
- Copia TODAS las líneas de compra de la familia (todas las OPs/líneas/envíos de sus matrículas).
- Detecta y reporta duplicados.
- Agrupa por matrícula en la UI de la pestaña (al abrir).

---

---

### Pestaña → Control de servicios

`servicios-resumen` puede usar una pestaña como **universo de filtrado**: muestra
solo las filas de `seguimiento` cuya `matricula` está en esa pestaña.

- Helper: `fetchTabMatriculas(tabId)` — devuelve las matrículas distintas y
  normalizadas. Selecciona solo `datos->>articulo_key` / `datos->>articulo`, no
  el `datos` entero (una pestaña grande son varios MB de jsonb).
- Punto de inserción: el `useMemo` de `baseRows` en `servicios-resumen.tsx`.
  Todos los KPIs y la tabla derivan de ahí, así que el filtro se propaga solo.
- **Reemplaza** al filtro Material/Servicio, no se suma: si además se filtrara
  por tipo, una matrícula mal clasificada en el catálogo desaparecería sin
  explicación. El filtro «Abierto» sigue aplicando aparte.
- La pestaña se usa **solo como conjunto de matrículas**, nunca como fuente de
  números. Por eso el congelamiento de las filas copiadas no afecta a este
  cruce: un código de matrícula no envejece.
- El join funciona porque `normArticulo` de `lib/busqueda.ts` y la de
  `lib/tableroOp.ts` hacen lo mismo (`.trim().replace(/\.0+$/, "")`), igual que
  `gd_norm_articulo()` en SQL.

---

## Fechas — dos formatos conviviendo

`planillas_op` guarda las fechas como **texto crudo** y hay dos formatos según
cuándo se importó la planilla:

| Formato | Origen |
|---|---|
| `2024-07-23` (ISO) | imports nuevos |
| `Tue Jul 23 2024 00:00:48 GMT-0300` | imports viejos |

**Ordenar ese texto directamente da mal.** Las letras van después de los dígitos
en ASCII, así que todo el formato viejo queda de un lado; y entre sí se ordenan
por el **nombre del día** (`Tue` antes que `Mon`). No es un orden parcialmente
correcto: es un orden por día de la semana.

Tres piezas lo resuelven:

1. **`gd_parse_fecha(text) → date`** (SQL): entiende los dos formatos, más
   `dd/mm/aaaa` como red de seguridad. Devuelve `NULL` ante cualquier cosa que
   no reconozca — una fecha rota no puede tumbar una reconstrucción de 10 min.
2. **Columnas `date` en el índice**: `fecha_creacion_d` / `fecha_pactada_d`, que
   es por donde ordena `gd_buscar` (con su propio índice; sin él, cada apertura
   del Buscador hacía un sort completo de 112k filas). El texto original se
   conserva para mostrar.
3. **`compararValores()` en el front** (`buscador.tsx`): al ordenar por una
   columna de `DATE_COLS` parsea antes de comparar, en vez de `localeCompare`
   sobre el string. Aplica igual en el índice maestro y dentro de una pestaña.

**En el origen:** `uploadOP` pasó a usar `fechaStr()` en vez de `str()`, así que
los imports nuevos ya guardan ISO y el formato viejo deja de crecer. Lo ya
cargado se sigue leyendo bien por los tres puntos de arriba.

---

## Normalización y Claves

### `normArticulo(raw: string)`
Normaliza códigos de matrícula como el SQL `gd_norm_articulo()`:
- Quita SOLO el sufijo ".0" / ".00" (Excel lo agrega).
- Respeta ".1", ".2", etc. (son variantes distintas).
- Ejemplo: `"00009411.0"` → `"00009411"`.

### `rowKey(r: BusquedaRow)`
Clave estable que sobrevive reconstrucciones:
```typescript
`${r.fuente}|${r.articulo_key ?? ""}|${r.numero_op ?? ""}|${r.linea ?? ""}|${r.envio ?? ""}`
```
Se usa para:
- Detectar duplicados al copiar a pestaña.
- Refresco manual (futura): detectar si la fila existe todavía en el índice.

---

## Configuración por pestaña — `buscador_tabs.config`

Cada pestaña tiene su propio `config` (jsonb), independiente del índice
maestro (que sigue usando `user_preferences`, global) y de las demás pestañas:

```json
{
  "order":      ["articulo", "descripcion", "numero_op", "..."],
  "hidden":     ["tx_recibido", "tx_aceptado"],
  "widths":     { "articulo": 120, "numero_op": 100 },
  "agrupar":    true,
  "agruparPor": "numero_op"
}
```

- `order` / `hidden` / `widths`: columnas de esa pestaña — ver "Modo pestaña" arriba.
- `agrupar` / `agruparPor`: vista de agrupado de esa pestaña — default `true` / `"articulo"` si no están guardados (pestaña vieja o recién creada).
- Todo se escribe con el mismo mecanismo: `patchLayout()` en `buscador.tsx` arma el objeto completo (mergeando con lo que ya había) y lo persiste con `updateTabConfig()` tras 1s de debounce, con un timer POR pestaña (`saveTabCfgTimers`, un `Record<tabId, timer>`) — así tocar la pestaña A y saltar enseguida a la B no cancela el guardado pendiente de A.
- Se lee al hacer `fetchTabs()`: cada pestaña trae su `config` completo desde la primera carga, sembrando `tabLayouts[tab.id]` — no hace falta abrir la pestaña para que esté disponible.

---

## Reconstrucción del Índice

RPC `gd_reconstruir_busqueda()`:
- Borra la tabla `busqueda_index` (CASCADE — no toca pestañas, no hay FK).
- Reconstruye desde `planillas_op` + `matriculas` + `matricula_tipo` + `tablero_op_transaccion` + `seguimiento_sic_soler`.
- Puede tardar hasta 10 minutos con el volumen real (`ALTER FUNCTION ... SET statement_timeout = '600s'` en `supabase/busqueda_global.sql`).
- La fila que copió a una pestaña queda "congelada" — `row_key` apunta a ella, pero si ya no existe en el índice, la pestaña la conserva (será huérfana, pero editable).
- Botón "Actualizar desde el índice" (Phase 2): refresco manual por fila — rellena de nuevo desde el índice usando `row_key`.

### Reconstrucción automática tras cada carga masiva

`reconstruirIndiceEnSegundoPlano(origen)` en `lib/busqueda.ts` — se cuelga del
`finally`/éxito de una carga masiva y dispara el RPC sin bloquear la pantalla
que lo llama; avisa por toast cuando termina (o si se pasó del timeout).

**Enganchada en:**
- `servicios-planillas.tsx` → `uploadOP`, `uploadSIC`, `uploadMatriculas`.
- `tablero-op-carga.tsx` → `ImportPanel.handleReplace`, solo cuando
  `table === "tablero_op_transaccion"` (la otra tabla de ese panel,
  `tablero_op_stock`, alimenta Stock por Zona, no el Buscador).

**Deliberadamente NO enganchada en ediciones sueltas** (`setTipoOverride` de
`matricula_tipo` desde Familias, ni el CRUD manual de `matriculas.tsx`): son
ediciones fila por fila, frecuentes, y esperar hasta 10 minutos de rebuild
después de tildar un checkbox sería peor que no reconstruir. Para esos casos
sigue el botón manual "Reconstruir" del Buscador.

---

## Performance y Límites

- **URL length:** Las búsquedas por matrícula se hacen en tandas de 100 para evitar superar el límite de URL (Supabase `.in()`).
- **Index tamaño:** `busqueda_index` puede tener cientos de miles de filas. El índice se ordena por (`articulo_key`, `numero_op`, `linea`, `envio`) para scans rápidos.
- **Pestsñas:** No tienen límite de tamaño (JSONB), pero en la UI el usuario ve una por pestaña a la vez — no hay rendimiento crítico.

---

## SQL

Ver archivo completo en `supabase/buscador_tabs.sql`.
