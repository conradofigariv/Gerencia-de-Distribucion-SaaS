# Gerencia de Distribución SaaS - Guía de Proyecto

## Flujo de Trabajo y Despliegue

- **Repositorio:** GitHub — `conradofigariv/Gerencia-de-Distribucion-SaaS`
- **Hosting:** Vercel — despliega automáticamente desde la rama `main` de GitHub.
- **Flujo:** commit → push a `origin/main` (via API si el proxy git rechaza con 403) → Vercel detecta el push y redeploya automáticamente.
- **Push bloqueado (403):** La rama `main` tiene protección en el proxy git local. Usar `mcp__github__push_files` para empujar directamente via GitHub API. Luego sincronizar local con `git fetch origin main && git reset --hard origin/main`.
- **Dev local:** `npm run dev` sirve los archivos del disco — cualquier rama puede usarse localmente.

## Comandos Útiles
- **Instalar:** `npm install`
- **Desarrollo:** `npm run dev`
- **Build:** `npm run build`
- **Lint:** `npm run lint`
- **Typing:** `npx tsc --noEmit`

## Guía de Estilo y Tech Stack
- **Framework:** Next.js 15+ (App Router).
- **Lenguaje:** TypeScript.
- **Estilos:** Tailwind CSS v4.
- **Componentes:** **shadcn/ui** (sobre Radix) / Lucide React.
- **Convenciones de Código:**
  - Usar componentes funcionales y Server Components por defecto.
  - Tipado estricto en interfaces y props (evitar `any`).
  - Nombramiento: PascalCase para componentes, camelCase para funciones/variables.

### Sistema de diseño — REGLA OBLIGATORIA (ver `DESIGN_PLAN.md`)
La base de toda la UI es **shadcn/ui + nuestros tokens** (la app ya está sobre
shadcn: `components.json`, `cssVariables: true` → nuestros colores SON el tema).
- ✅ Componentes nuevos: `npx shadcn@latest add <comp>` (heredan el tema verde).
- ✅ Estilar SIEMPRE con tokens/utilidades (`bg-card`, `bg-panel`, `text-accent-green`).
- ❌ Prohibido `oklch()` / hex literal en componentes nuevos.
- ❌ Prohibido duplicar primitivos shadcn con componentes custom (`Select`, `Input`, `Table`).
  `BeastSelect` / `DivisaPicker` / tablas a mano son **legado** → migrar incremental.
- 🔬 Probar componentes nuevos en **`/styleguide`** (ruta interna, no enlazada).
- **Tokens "beast pure"** (superficies de Informe Técnico / Stock por Zona) ya están
  en `globals.css`: `bg-panel`, `bg-panel-2`, `bg-panel-header`, `bg-panel-input`,
  `border-hairline`, `text-accent-green` / `-amber` / `-red`, `ring-green`.

## Estructura de Archivos Clave
- `app/`: Rutas y vistas principales (App Router).
- `components/dashboard/sections/`: Secciones del dashboard (una por módulo).
- `components/dashboard/reminder-bell.tsx`: Campana global de recordatorios.
- `lib/`: Utilidades, configuraciones de API y lógica compartida.
- `lib/reminders.ts`: Helpers `markUpdated`, `fetchReminders`, `upsertConfig` para el sistema de recordatorios.
- `lib/supabaseClient.ts`: Cliente de Supabase.
- `app/globals.css`: CSS global — incluye variables de diseño y todas las animaciones del diagrama SIC.

---

## Mapa completo de secciones

### Navegación (sidebar.tsx → app/page.tsx `Section` type)

| Section ID | Archivo | Grupo sidebar | Descripción |
|---|---|---|---|
| `servicios-planillas` | servicios-planillas.tsx | (raíz) | Carga de planillas Excel: OP, QW, MATRICULAS |
| `servicios-resumen` | servicios-resumen.tsx | Control de servicios | Alertas de vencimiento y consumo por OP/zona |
| `servicios-tabla` | servicios-tabla.tsx | Control de servicios | Tabla completa de seguimiento de servicios |
| `servicios-carga` | servicios-carga.tsx | Control de servicios | Creación manual de filas de seguimiento |
| `stock-zona` | stock-zona.tsx | Control de servicios | Stock de materiales por zona (carga por texto) |
| `transformadores-resumen` | transformadores-resumen.tsx | Stock de Transformadores | KPIs, gráficos, alarmas de stock de transformadores |
| `transformadores-carga` | transformadores-carga.tsx | Stock de Transformadores | Carga de planilla de reserva de transformadores |
| `transformadores-tabla` | transformadores-tabla.tsx | Stock de Transformadores | Historial de planillas de reserva |
| `sic-diagrama` | sic-diagrama.tsx | Proceso SIC - SIGA | Diagrama de flujo neon + seguimiento de SICs |
| `informe-tecnico` | informe-tecnico.tsx | Licitaciones | Análisis de ofertas y adjudicación por renglón |
| `settings` | settings.tsx | (raíz) | Gestión de usuarios, perfiles, nivel de acceso |

### Tablas Supabase por sección

| Sección | Tabla(s) |
|---|---|
| servicios-planillas | `planillas_op`, `planillas_qw`, `planillas_matriculas` |
| servicios-carga | `filas_manuales` |
| servicios-tabla | `filas_servicios` |
| servicios-resumen | `filas_servicios` (lectura) |
| stock-zona | `stock_uploads`, `stock_article_families`, `matriculas` (lectura del catálogo) |
| transformadores-carga | `planillas_reserva` |
| transformadores-tabla | `planillas_reserva` (lectura) |
| transformadores-resumen | `planillas_reserva`, `transformador_alarms` |
| sic-diagrama | `sic_diagrama_layout`, `sic_diagrama_active` |
| informe-tecnico | `licitaciones`, `licitacion_renglones`, `licitacion_items`, `licitacion_oferentes`, `licitacion_ofertas`, `licitacion_evaluaciones_tecnicas`, `licitacion_adjudicaciones`, `matriculas` |
| settings | `profiles` |
| recordatorios | `section_reminders` (o `reminder_config`) |

### SQL necesario para tablas no estándar
```sql
-- SIC diagrama (layout manual del usuario)
CREATE TABLE sic_diagrama_layout (
  id text PRIMARY KEY,
  nodes jsonb NOT NULL,
  edges jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- SIC seguimiento (una fila por SIC importada)
CREATE TABLE sic_diagrama_active (
  sic_numero text PRIMARY KEY,
  steps jsonb NOT NULL,
  step_index integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Stock por Zona
CREATE TABLE stock_uploads (
  zona text PRIMARY KEY,
  file_name text,
  uploaded_at timestamptz DEFAULT now(),
  rows jsonb NOT NULL
);

-- Familias de matrículas (multi-familia). La columna `familia` guarda un array
-- JSON de familias (ej. ["Cables","Aluminio"]); `tipo` es override manual de
-- Material/Servicio. `subfamilia` quedó sin uso (modelo pasó a multi-familia).
CREATE TABLE stock_article_families (
  articulo text PRIMARY KEY,
  familia text,        -- array JSON de familias (o texto plano legado)
  subfamilia text,     -- sin uso (histórico)
  tipo text            -- 'material' | 'servicio' | null
);
```

---

## Sección Stock por Zona (`components/dashboard/sections/stock-zona.tsx`)

- **Propósito:** Ver y cargar el stock de materiales (con matrícula) agrupado por zona de depósito, clasificarlos en familias y consultar su tipo (Material/Servicio).
- **UI "beast pure":** unificada con Informe Técnico — header con ícono verde, tabs pill con flechas `→`, contenedor `oklch(0.235 0.005 270)`, paneles internos `oklch(0.205 0.005 270)`. Dropdowns con el componente local `BeastSelect` (mismo estilo que Informe Técnico, soporta `portal` para escapar contenedores con overflow).

### Tres fuentes de datos (independientes)
| Fuente (sección) | Tabla | Aporta | Frescura |
|---|---|---|---|
| Carga de datos → MATRICULAS | `matriculas` | Lista completa de matrículas + **descripción** + UDM + **mat_serv** (Material/Servicio) | ✅ La más actualizada |
| Stock por Zona → Cargar datos | `stock_uploads` | **Cantidad** de stock por zona | Otro procedimiento (extracción SIGA) |
| Familias (manual / Agregar familia) | `stock_article_families` | **Familias** (etiquetas) + override manual de tipo | Manual |

El stock y las familias son enriquecimientos sobre la lista maestra de matrículas. **El número de matrícula se muestra, busca y guarda tal cual (con el `.0` y los ceros) — NUNCA normalizar el formato visible.** El cruce entre tablas es por matrícula exacta.

### Libs
- **`lib/stockStorage.ts`** — carga de stock por zona: `parseTSV`, `getUploads`, `saveUpload`, `removeUpload`, `COL_MAP`. Tabla `stock_uploads(zona TEXT PK, file_name, uploaded_at, rows JSONB)`.
- **`lib/stockFamilies.ts`** — familias + catálogo maestro:
  - `interface FamilyRow { articulo; familias: string[]; tipo: ArticuloTipo }` — **multi-familia** (una matrícula puede tener varias). Sin subfamilia.
  - Persistencia: las familias se guardan en la columna `familia` de `stock_article_families` como **array JSON** (ej. `["Cables","Aluminio"]`). Las filas viejas de una sola familia en texto plano **se migran solas al leerlas** (`parseFamilias`). No requiere cambios de schema en Supabase.
  - `getFamilies`, `upsertFamily`, `upsertFamiliesBulk`, `deleteFamily`, `deleteFamiliesBulk`.
  - `interface MatriculaInfo { descripcion; udm; tipo }` + `getMatriculasInfo()` → Map `articulo → MatriculaInfo` leyendo `matriculas` (descripción, UDM y `mat_serv` normalizado a tipo). **Descarga paralela:** 1ª página con conteo exacto + resto con `Promise.all` (Supabase corta en ~1000 filas).

### Tres pestañas
- **Resumen de stock:** tabla pivot virtualizada — una fila por matrícula. Columnas fijas: Matrícula, Descripción, UDM, **Tipo** (Material/Servicio), Total + columnas dinámicas por zona (colapsables con animación). Filtros: zona, familia, **Servicio/Material** y búsqueda por Nro/Nombre. Orden y redimensión por columna.
  - Descripción/UDM salen del catálogo maestro (prioridad) con respaldo en el stock.
  - **Servicios** del catálogo aparecen aunque no tengan stock (Total 0). Materiales sin stock NO se agregan (ruido). Matrículas con alguna familia asignada también se incluyen aunque no tengan stock.
- **Cargar datos:** textarea para pegar datos del sistema (tab-separado). Encabezado en la 1ª fila: `Artículo`, `Desc Artículo`, `UDM Primaria`, `En Mano`, `Organización`. La zona se detecta desde Organización. Flujo: pegar → previsualizar zonas → Importar → vuelve a "Resumen".
- **Familias:** lista de matrículas virtualizada con casillas de selección.
  - **Botón "Agregar familia":** modal (nombre de familia + pegar lista de matrículas, una por línea/tab/coma) → asigna esa familia a todas (suma a las existentes).
  - **Por fila:** familias como **chips** (cada una con X para quitar) + input «+ familia» (Enter) para agregar. Selector de **Tipo** (override manual; si no hay, usa el del catálogo).
  - **Asignación masiva** (al tildar varias): **Agregar** (suma sin pisar), **Quitar familia**, **Aplicar tipo**, **Borrar todo**.
  - Filtros: por familia, **Sin clasificar** (sin ninguna familia), búsqueda por número/descripción.

### Tipo efectivo (`tipoOf`)
`tipoOf(articulo)` = override manual de `stock_article_families.tipo` si existe, si no el `mat_serv` del catálogo `matriculas`.

### Rendimiento
- **Tablas virtualizadas** con `@tanstack/react-virtual` (técnica de filas espaciadoras + header sticky). Solo se renderizan las filas visibles → fluidez con miles de filas.
- **Header sticky opaco:** los `<th>` usan `background: oklch(0.255 0.006 270)` (opaco). ⚠ NO usar `hsl(var(--secondary))` para el fondo: `--secondary` está definida en oklch con alpha, y `hsl(var(--secondary))` es CSS inválido → header transparente.
- **Catálogo cacheado:** `getMatriculasInfo` se cachea en `sessionStorage` (`MATRICULAS_CACHE_KEY`) → 2ª carga instantánea; se refresca en segundo plano (no bloquea la vista de stock; hay indicador "catálogo…").
- **Ancho de columnas persistido** en `localStorage` (`COLWIDTHS_KEY`) → se restaura al volver a abrir.
- Animación colapso/expansión de zonas: keyframes `sz-zone-in` / `sz-zone-out` en `app/globals.css`.

### Botón "Ayuda" (`StockHelpModal`)
Centro de ayuda con el **mismo diseño y concepto que el `HelpModal` de Informe Técnico** (overlay oscuro, card `oklch(0.15)`, sidebar de temas con íconos de color + subtítulo, header de tema, footer Anterior/puntos/Siguiente/Entendido). Temas: **Cargar datos** (guía SIGA con capturas en `public/ayuda-stock/paso1-5.png`), **Resumen de stock**, **Familias**. Helpers replicados: `HelpSection`, `HelpAction`, `HelpTip`.

### Eliminado / histórico
- Se eliminó el importador "Mat/Ser desde Excel" (tercera planilla con formato distinto que rompía el cruce). El tipo ahora sale del catálogo (`matriculas.mat_serv`).
- Se eliminó la **subfamilia** (el modelo pasó a multi-familia como etiquetas).

---

## Sistema de Recordatorios

Cada sección de carga de datos puede tener un recordatorio configurable. La arquitectura es:

- **Tabla Supabase:** `reminder_config(key, name, user_id, freq_days, time, last_updated_at)`
- **Lib:** `lib/reminders.ts` — exporta `markUpdated(key, name, userId)`, `fetchReminders(userId)`, `upsertConfig(key, name, userId, freq, time)`
- **Bell global:** `components/dashboard/reminder-bell.tsx` — lee todas las claves en `ALL_REMINDER_KEYS` y alerta si alguna está vencida. Cada notificación tiene una X para descartarla (sesión actual).

### Claves de recordatorio registradas (`ALL_REMINDER_KEYS` en reminder-bell.tsx):
| key | label | section |
|-----|-------|--------|
| `planillas-OP` | OP — Órdenes de compra | Carga de datos |
| `planillas-QW` | QW — Expedientes / SCs | Carga de datos |
| `planillas-MATRICULAS` | MATRICULAS — Catálogo de materiales | Carga de datos |
| `servicios-carga` | Crear seguimiento | Control de Servicios |
| `transformadores-carga` | Carga de datos — Transformadores | Transformadores |

### Patrón para agregar recordatorio a una sección nueva:
1. Importar `createPortal` de `react-dom`, `BellRing` de `lucide-react`, y `markUpdated`, `fetchReminders`, `upsertConfig` de `@/lib/reminders`.
2. Constantes: `REMINDER_KEY = "mi-seccion"`, `REMINDER_NAME = "Nombre legible"`.
3. Estados: `userId`, `configOpen`, `loadingConfig`, `savingConfig`, `reminderFreq`, `reminderTime`, `reminderLastUpd`.
4. Botón en la barra superior (SIN guard de `canConfig`): `<button onClick={() => setConfigOpen(true)}><BellRing/> Recordatorio</button>`
5. Llamar `markUpdated(REMINDER_KEY, REMINDER_NAME, userId)` después de un guardado exitoso.
6. Renderizar el dialog via `createPortal(dialog, document.body)` al final del return.
7. Agregar la clave a `ALL_REMINDER_KEYS` en `reminder-bell.tsx`.

---

## Diagrama de Flujo SIC (`components/dashboard/sections/sic-diagrama.tsx`)

### Diseño Visual — CANÓNICO Y FIJO
El diseño visual proviene de un prototipo en Claude Design (archivo `Flow Nodes.html`).
**NO modificar la estética sin instrucción explícita del usuario.**

#### Canvas
- Fondo: `#070912` (negro profundo)
- Grilla de puntos: `BackgroundVariant.Dots`, color `rgba(255,255,255,.05)`, gap 24px
- Nebula: dos `radial-gradient` absolutos (púrpura en esquina superior-derecha, verde en inferior-izquierda)
- Borde del contenedor: `1px solid rgba(255,255,255,.08)`

#### Paleta de colores de nodos (6 colores neon canónicos)
| Tipo | Color | Uso |
|------|-------|-----|
| Preparación (hexágono) | `#2dd4bf` | teal |
| Inicio / Fin (stadium) | `#34d399` | green |
| Decisión (diamante) | `#f59e0b` | amber |
| Actividad (rectángulo) | `#60a5fa` | blue |
| Entrada / Salida (paralelogramo) | `#22d3ee` | cyan |
| Documento | `#c084fc` | violet |

Los colores extra disponibles en el selector: `#ef4444`, `#ec4899`, `#f97316`, `#6366f1`, `#64748b`, `#e2e8f0`.

#### Sistema de brillo neon (CSS variables por nodo)
Cada nodo aplica CSS variables inline en su wrapper:
```
--node-c       → color hex del nodo
--node-glow    → rgba con opacidad .45 (calculado por getGlow())
--node-fill    → rgba con opacidad .06 (fill del SVG en reposo)
--node-fill-hover → rgba con opacidad .12 (fill del SVG en hover / activo)
```
Las reglas CSS en `app/globals.css` consumen estas variables:
- `.sic-node-svg` → `drop-shadow` con `--node-glow` + `will-change: filter` (GPU layer)
- `.react-flow__node:hover .sic-node-svg` → glow más intenso
- `.sic-node-svg path/polygon/rect/ellipse` → fill/stroke vía variables

#### Anatomía de cada nodo (NeonNodeBase)
1. `NodeResizer` (redimensionable, borde del color del nodo)
2. `NeonHandles` × 4 — puntos de conexión neon con ring pulsante al hover (clase `sic-handle-ring`)
3. SVG de forma con clase `sic-node-svg` + variables CSS
4. Sheen: gradiente semitransparente en la parte superior
5. Label: título con `textShadow` neon
6. Owner pill: avatar circular con iniciales + nombre del primer responsable
7. Clase `sic-node` en el wrapper → animación `sic-fadeup` + `contain: layout style`

**Sin icon badge** — los íconos pequeños de tipo de nodo fueron eliminados para mayor limpieza visual.
**Sin age display** — el indicador "Hoy"/"X días" fue eliminado.

#### Aristas (NeonEdge)
- `<linearGradient>` de `sourceColor` → `targetColor` (almacenados en `edge.data`)
- Path con `strokeDasharray="6 6"` + clase `sic-edge-flow` → animación de flujo
- Círculo blanco con `<animateMotion>` siguiendo el path — **velocidad normalizada:** `dur = pathLength / 110` segundos (constante para todas las aristas)
- Path invisible de 16px de ancho (`react-flow__edge-interaction`) como área de click
- Marcador de flecha custom inline en `<defs>` (color del nodo destino)
- Al seleccionar: handle de curvatura (bezier=ámbar, step=azul)

#### Highlight de nodo activo (SIC)
- Clase `sic-node-active` en el wrapper `.sic-node` cuando `d.highlighted` está seteado
- CSS: `sic-active-glow` 1.6s ease-in-out infinite — pulso de `drop-shadow` desde tenue hasta `drop-shadow(0 0 38px var(--node-c))`
- Fill del SVG forzado a `--node-fill-hover` mientras está activo

#### Animaciones (definidas en `app/globals.css`)
```css
@keyframes sic-dash       /* flujo de guiones en aristas */
@keyframes sic-fadeup     /* entrada de nodos */
@keyframes sic-hpulse     /* ring de handles */
@keyframes sic-pulse      /* dot de estado */
@keyframes sic-drift      /* nebula de fondo */
@keyframes sic-active-glow /* pulso de nodo activo en SIC */
```

### Funcionalidad del diagrama (conservar siempre)
- **Supabase save/load:** tabla `sic_diagrama_layout(id, nodes, edges, updated_at)` con upsert en `id="main"`. El campo `highlighted` NUNCA se persiste — se inyecta transientemente en `renderedNodes` al renderizar.
- **Doble clic en nodo:** abre `NodeEditModal` — edita título, encargados, color.
- **Doble clic en arista:** abre `EdgeEditModal` — cambia tipo (bezier/step) y etiqueta.
- **Drag & drop desde sidebar:** arrastra shape → suelta en canvas → crea nodo.
- **Redimensionar:** arrastrar borde del nodo con `NodeResizer`.
- **Eliminar:** tecla `Supr` / `Backspace` con nodo/arista seleccionada.
- **Botones:** Guardar (manual, indicador de cambios no guardados) + Reset (limpia canvas).

### Seguimiento de SICs (`sic_diagrama_active`)

El diagrama (canvas manual) y el seguimiento de SICs son **dos entidades separadas**. Las SICs no modifican el diagrama.

**Flujo:**
1. Botón "Importar SIC" → modal con textarea → pegar texto de SIGA → parseado → upsert en `sic_diagrama_active`
2. Dropdown en el header del diagrama → seleccionar SIC activa
3. El paso actual de la SIC busca un nodo por responsable (`findNodeForPerson`) → si hay match, ese nodo se renderiza con `sic-node-active`; si no, solo muestra info en la barra de estado
4. Botones prev/next para navegar entre pasos
5. La SIC seleccionada persiste en `localStorage` (`SIC_SELECTION_KEY = "sic-diagrama-selected"`)

**Interfaces clave:**
```typescript
interface SICRecord { sicNumero: string; steps: SICRow[]; stepIndex: number; updatedAt?: string }
interface SICRow    { person: string; sec: number; fecha: string; accion: string; nota: string }
interface SICHighlight { sicNumero: string; sec: number; fecha: string; nota: string; person: string }
```

**Formato de texto SIGA** (tab-separado):
```
Realizado Por    Sec    Fecha                Acción    Nota
Apellido, Nombre  12    15/04/2026 11:59:58  Reserva
```
Columnas (0-based): `[0]` Persona · `[2]` Sec · `[3]` Fecha · `[5]` Acción · `[6]` Nota

**Mapeo Acción → color:**
| Acción | Color |
|--------|-------|
| Ejecutar | `#60a5fa` azul |
| Aprobar | `#34d399` verde |
| Reenviar | `#f59e0b` ámbar |
| Reserva | `#2dd4bf` teal |

### Componentes del archivo
```
sic-diagrama.tsx
├── PasoData / SICHighlight / SICRow / SICRecord (interfaces)
├── NODE_COLORS (paleta 12 colores)
├── getGlow() / hexToRgba() / getDays() — helpers puros
├── getActionColor() — Acción SIGA → color neon
├── findNodeForPerson() — match exacto por responsables[]
├── SHAPES[] — 6 tipos con defaultColor/defaultWidth/Height
├── createNewNode() — fábrica al hacer drop
├── NeonHandles — 4 handles con sic-handle-ring
├── NeonNodeBase — base compartida (sin icon badge, sin age display)
├── ProcessNode / StartEndNode / DecisionNode / DocumentNode / ParallelogramNode / HexagonNode
├── NODE_TYPES
├── NeonEdge — gradiente + animateMotion + hit area + bend handle
├── EDGE_TYPES_MAP
├── ShapePalette — sidebar drag-and-drop
├── NodeEditModal / EdgeEditModal / ImportSICModal
├── SicDiagramaInner — lógica principal con sicList, renderedNodes, goToStep, deleteSIC
├── SicErrorBoundary
└── SicDiagramaSection (export)
```

---

## Sección Informe Técnico (`components/dashboard/sections/informe-tecnico.tsx`)

### Propósito
Módulo de análisis de licitaciones públicas. Permite cargar renglones/ítems, registrar ofertas de múltiples oferentes, evaluar técnicamente cada uno y adjudicar por renglón. Integra cotización automática del dólar via BCRA.

### Lib de datos: `lib/informeTecnico.ts`
Toda la lógica de Supabase está centralizada aquí. Exporta:

**Interfaces:**
```typescript
type Divisa = "USD" | "ARS"
type LicitacionEstado = "borrador" | "en_evaluacion" | "adjudicada" | "archivada"

interface Licitacion        // id, numero_sic, titulo, fd_sic_fecha, fd_sic_valor, fd_op_fecha, fd_op_valor, umbral_economico_pct, exclusividad_renglones, estado
interface Renglon           // id, licitacion_id, numero, condicion_adjudicacion
interface Item              // id, renglon_id, numero_item, matricula, descripcion, cantidad, precio_sic_pesos, precio_sic_divisa
interface RenglonConItems   // Renglon & { items: Item[] }
interface Oferente          // id, licitacion_id, nombre
interface Oferta            // id, oferente_id, item_id, precio_unitario, divisa
interface EvaluacionTecnica // id, oferente_id, renglon_id, cumple (boolean|null), observaciones
interface Adjudicacion      // id, renglon_id, oferente_id, confirmado_por, confirmado_at
```

**Funciones CRUD:**
- `listLicitaciones / createLicitacion / updateLicitacion / deleteLicitacion`
- `listRenglonesConItems / createRenglon / updateRenglon / deleteRenglon`
- `createItem / updateItem / deleteItem`
- `lookupMatricula(articulo)` → busca descripción en tabla `matriculas`
- `listOferentes / createOferente / deleteOferente`
- `listOfertas / upsertOferta / deleteOferta`
- `listEvaluaciones / upsertEvaluacion / deleteEvaluacion`
- `listAdjudicaciones / upsertAdjudicacion / deleteAdjudicacion`

### Estructura del componente (informe-tecnico.tsx)

```
InformeTecnicoSection (export)
├── Selector de licitación (dropdown + botón crear)
├── Barra de tabs con flechas: Datos generales → Renglones e Ítems → Oferentes → Ofertas → Evaluación técnica → Adjudicación
│
├── DatosGeneralesTab
│   ├── Identificación: Número SIC, Título
│   ├── Fechas y valor del dólar:
│   │   ├── Fecha SIC + Dólar SIC (manual)
│   │   └── Fecha OP (= Acta de Apertura) + Dólar OP [botón BCRA → consulta día anterior]
│   └── Configuración: Umbral económico (%)
│
├── RenglonesTab
│   ├── Lista de renglones colapsables, cada uno con sus ítems
│   ├── Drag & drop de ítems entre renglones (copia, no mueve)
│   ├── Duplicar renglón completo (icono Copy en header del card)
│   ├── Edición inline de cantidad y precio_sic_divisa por ítem
│   ├── ItemModal para crear/editar ítems (lookup automático de matrícula)
│   └── Sección "Condiciones del pliego": checkbox Exclusividad entre renglones
│
├── OferentesTab
│   └── Lista simple: agregar/eliminar oferentes por nombre
│
├── OfertasTab
│   ├── Tabla: filas=ítems (agrupados por renglón), columnas=oferentes
│   ├── Cada celda: input precio + DivisaPicker custom
│   ├── Guardado automático al salir de cada celda (onBlur → upsertOferta)
│   ├── Botones "Cambiar todas las divisas: [USD] [ARS]"
│   └── Contador de celdas completadas
│
├── EvaluacionTab
│   ├── Tabla: filas=renglones, columnas=oferentes
│   ├── Tres botones por celda: ✓ Cumple (verde) | ⏳ Pendiente (amarillo) | ✗ No cumple (rojo)
│   ├── Textarea de observaciones por celda
│   ├── Lógica de estado: sin registro = sin evaluar | cumple=true = cumple | cumple=false = no cumple | cumple=null con registro = pendiente
│   └── Resumen al pie con conteos por renglón
│
└── AdjudicacionTab
    ├── Un card por renglón con header: "RENGLÓN N  [Total SIC del Renglón: X ARS]  [Adjudicado — NOMBRE]"
    ├── Tabla comparativa por oferente:
    │   ├── Precio total ofertado = suma de precios unitarios × dólar SIC
    │   ├── % vs. SIC = (ofertaARS / sicARS - 1) × 100 (2 decimales)
    │   │   └── Coloreado por ranking: más barato=verde, siguiente=amarillo, resto=blanco, sobre umbral=rojo
    │   ├── Técnica: Cumple / Pendiente / No cumple / Sin evaluar
    │   ├── Cobertura: Completo / parcial / Sin ofertar
    │   └── Botón Adjudicar (toggle, persiste en licitacion_adjudicaciones)
    └── Resumen de adjudicación al pie
```

### Lógica de cálculo en AdjudicacionTab

```typescript
// SIC de referencia del renglón (en ARS)
calcSicARS(r) = Σ items: precio_sic_pesos (si ARS) | precio_sic_pesos × fdSic (si USD)

// Total ofertado por oferente (en ARS, usando dólar SIC para normalizar)
calcOferta(r, ofId) = Σ items con oferta: precio_unitario (si ARS) | precio_unitario × fdSic (si USD)

// Porcentaje sobre/bajo la SIC
calcPct(ofARS, sicARS) = (ofARS / sicARS - 1) × 100

// ⚠ Se usa fdSic (no fdOp) para AMBAS conversiones → comparación consistente
```

### Integración BCRA (tipo de cambio automático)

- Endpoint: `https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechaDesde=YYYY-MM-DD&fechaHasta=YYYY-MM-DD&limit=10`
- Para el Dólar OP: se consulta el **día anterior** a la Fecha de la OP
- Si el día cae en fin de semana, `lastWeekday()` retrocede al viernes
- No requiere autenticación
- Respuesta: `{ results: [{ detalle: [{ tipoCotizacion }] }] }` — se extrae `tipoCotizacion`

### Componentes reutilizables dentro del archivo

```typescript
DivisaPicker({ value, onChange, size })
// Dropdown custom (no <select> nativo) para elegir ARS/USD
// Cierra al hacer click afuera via mousedown listener
// size="sm" para tabla de Ofertas, size="md" para ItemModal

ItemModal({ mode, renglonNumero, initialNumero, ..., onSubmit })
// Modal para crear/editar ítems
// Lookup automático de matrícula con debounce 500ms → autocompleta descripción
// DivisaPicker integrado para precio_sic_divisa
// Inputs con clase .im-input / .im-input-sm / .im-textarea (estilos definidos inline en <style>)

FormSection / FormField
// Wrappers de layout para DatosGeneralesTab
```

### Tablas Supabase del módulo

```sql
-- Licitaciones (una por proceso licitatorio)
licitaciones(id uuid PK, numero_sic text, titulo text, fecha_apertura date,
  fd_sic_fecha date, fd_sic_valor numeric, fd_op_fecha date, fd_op_valor numeric,
  umbral_economico_pct numeric DEFAULT 50, exclusividad_renglones boolean DEFAULT false,
  estado text DEFAULT 'borrador', created_at timestamptz, updated_at timestamptz)

-- Renglones e ítems
licitacion_renglones(id uuid PK, licitacion_id uuid FK, numero int, condicion_adjudicacion text)
licitacion_items(id uuid PK, renglon_id uuid FK, numero_item int, matricula text,
  descripcion text, cantidad numeric DEFAULT 1, precio_sic_pesos numeric,
  precio_sic_divisa text DEFAULT 'ARS')

-- Oferentes y precios
licitacion_oferentes(id uuid PK, licitacion_id uuid FK, nombre text)
licitacion_ofertas(id uuid PK, oferente_id uuid FK, item_id uuid FK,
  precio_unitario numeric, divisa text, UNIQUE(oferente_id, item_id))

-- Evaluación y adjudicación
licitacion_evaluaciones_tecnicas(id uuid PK, oferente_id uuid FK, renglon_id uuid FK,
  cumple boolean, observaciones text, updated_at timestamptz, UNIQUE(oferente_id, renglon_id))
licitacion_adjudicaciones(id uuid PK, renglon_id uuid FK, oferente_id uuid FK,
  confirmado_por text, confirmado_at timestamptz, UNIQUE(renglon_id))

-- Catálogo de matrículas (solo lectura desde la sección)
matriculas(articulo text PK, descripcion text)
```

### Convenciones de estilo "beast pure" usadas en esta sección

- **Fondo de cards:** `oklch(0.235 0.005 270)` / paneles internos: `oklch(0.205 0.005 270)`
- **Inputs:** `oklch(0.16 0.005 270)` fondo, `oklch(1 0 0 / 0.07)` borde
- **Focus ring:** `oklch(0.55 0.15 155 / 0.7)` borde + `oklch(0.55 0.15 155 / 0.12)` sombra
- **Acento verde** (matrículas, números SIC, adjudicado): `#86efac`
- **Amarillo pendiente:** `#fcd34d`
- **Rojo no cumple:** `#fca5a5`
- **Fuente monospace:** `ui-monospace, monospace` para precios, números SIC, matrículas
- **Sin flechas en inputs numéricos:** regla global en `app/globals.css` → `input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none }`
- **Sin `<select>` nativo:** siempre usar `DivisaPicker` o dropdown custom con `position: absolute`

---

## Notas Importantes de Desarrollo

### Dev server vs feature branches
- El servidor de desarrollo (`npm run dev`) sirve los archivos del disco — la rama de git activa no importa.
- Los cambios deben pushearse a `origin/main` para que Vercel los despliegue.
- Si el proxy git rechaza con 403, usar `mcp__github__push_files` (GitHub API) y luego `git fetch origin main && git reset --hard origin/main` para sincronizar local.

### Modales / Dialogs
- Usar `createPortal(dialog, document.body)` para que los modales escapen contextos de stacking.
- No envolver botones de acceso rápido (como "Recordatorio") en guards de rol (`canConfig &&`). Mostrarlos siempre; solo deshabilitar funcionalidad si el rol no tiene permiso.

### Sección Transformadores Carga
- Archivo: `components/dashboard/sections/transformadores-carga.tsx`
- Constantes: `REMINDER_KEY = "transformadores-carga"`, `REMINDER_NAME = "Carga de datos — Transformadores"`
- Llama `markUpdated` después del guardado exitoso en `handleSave`.
- El botón "Recordatorio" está en la barra superior sin guard de rol.
- El dialog de configuración se renderiza via `createPortal`.

### Rendimiento CSS — animaciones SIC
- `.sic-node-svg` tiene `will-change: filter` → lo promueve a capa GPU, evita repintar el resto del canvas en cada frame de animación.
- `.sic-node` tiene `contain: layout style` → limita el área de repaint a cada nodo.
- `sic-active-glow` usa 2 drop-shadows (no 3) para reducir costo de compositing.
- Velocidad del punto animado en aristas = `pathLength / 110` px/s (constante para todas las aristas).
