# Gerencia de Distribución SaaS - Guía de Proyecto

## Comandos Útiles
- **Instalar:** `npm install`
- **Desarrollo:** `npm run dev`
- **Build:** `npm run build`
- **Lint:** `npm run lint`
- **Typing:** `npx tsc --noEmit`

## Guía de Estilo y Tech Stack
- **Framework:** Next.js 15+ (App Router).
- **Lenguaje:** TypeScript.
- **Estilos:** Tailwind CSS.
- **Componentes:** Radix UI / Lucide React.
- **Convenciones de Código:**
  - Usar componentes funcionales y Server Components por defecto.
  - Tipado estricto en interfaces y props (evitar `any`).
  - Nombramiento: PascalCase para componentes, camelCase para funciones/variables.

## Estructura de Archivos Clave
- `app/`: Rutas y vistas principales (App Router).
- `components/dashboard/sections/`: Secciones del dashboard (una por módulo).
- `components/dashboard/reminder-bell.tsx`: Campana global de recordatorios.
- `lib/`: Utilidades, configuraciones de API y lógica compartida.
- `lib/reminders.ts`: Helpers `markUpdated`, `fetchReminders`, `upsertConfig` para el sistema de recordatorios.
- `lib/supabaseClient.ts`: Cliente de Supabase.
- `app/globals.css`: CSS global — incluye variables de diseño y todas las animaciones del diagrama SIC.

---

## Sistema de Recordatorios

Cada sección de carga de datos puede tener un recordatorio configurable. La arquitectura es:

- **Tabla Supabase:** `reminder_config(key, name, user_id, freq_days, time, last_updated_at)`
- **Lib:** `lib/reminders.ts` — exporta `markUpdated(key, name, userId)`, `fetchReminders(userId)`, `upsertConfig(key, name, userId, freq, time)`
- **Bell global:** `components/dashboard/reminder-bell.tsx` — lee todas las claves en `ALL_REMINDER_KEYS` y alerta si alguna está vencida.

### Claves de recordatorio registradas (`ALL_REMINDER_KEYS` en reminder-bell.tsx):
| key | label | section |
|-----|-------|---------|
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
--node-fill-hover → rgba con opacidad .12 (fill del SVG en hover)
```
Las reglas CSS en `app/globals.css` (sección `/* SIC neon node SVG styles */`) consumen estas variables:
- `.sic-node-svg` → `drop-shadow` con `--node-glow`
- `.react-flow__node:hover .sic-node-svg` → glow más intenso
- `.sic-node-svg path/polygon/rect/ellipse` → fill/stroke vía variables

#### Anatomía de cada nodo
Todos los nodos usan el componente `NeonNodeBase` que incluye:
1. `NodeResizer` (redimensionable, borde del color del nodo)
2. `NeonHandles` × 4 — puntos de conexión neon con ring pulsante al hover (clase `sic-handle-ring`)
3. SVG de forma con clase `sic-node-svg` + variables CSS
4. Sheen: gradiente semitransparente en la parte superior del nodo
5. Icon badge: cuadrado 22×22px con ícono SVG, posicionado en `top-0 left-3 -translate-y-1/2`
6. Label: título con `textShadow` neon, meta-dot con días desde creación
7. Owner pill: avatar circular con iniciales + nombre del primer responsable
8. Clase `sic-node` en el wrapper → animación `sic-fadeup` al montar

#### Aristas (NeonEdge)
- `<linearGradient>` de `sourceColor` → `targetColor` (almacenados en `edge.data`)
- Path con `strokeDasharray="6 6"` + clase `sic-edge-flow` → animación de flujo
- Círculo blanco animado con `<animateMotion>` + `<mpath>` siguiendo el path
- Marcador de flecha custom inline en `<defs>` (color del nodo destino)
- Al seleccionar: handle de curvatura (bezier=ámbar, step=azul)
- Al guardar nodo con nuevo color: `handleSaveNode` actualiza `sourceColor`/`targetColor` en todas las aristas conectadas

#### Animaciones (definidas en `app/globals.css`)
```css
@keyframes sic-dash       /* flujo de guiones en aristas */
@keyframes sic-fadeup     /* entrada de nodos */
@keyframes sic-hpulse     /* ring de handles */
@keyframes sic-pulse      /* dot de estado */
@keyframes sic-drift      /* nebula de fondo */
```

### Funcionalidad (conservar siempre)
- **Supabase save/load:** tabla `sic_diagrama_layout(id, nodes, edges, updated_at)` con upsert en `id="main"`.
- **Doble clic en nodo:** abre `NodeEditModal` — edita título, encargados, color.
- **Doble clic en arista:** abre `EdgeEditModal` — cambia tipo (bezier/step) y etiqueta.
- **Drag & drop desde sidebar:** arrastra shape → suelta en canvas → crea nodo.
- **Redimensionar:** arrastrar borde del nodo con `NodeResizer`.
- **Conectar:** arrastrar desde un handle (punto de conexión) a otro nodo.
- **Eliminar:** tecla `Supr` / `Backspace` con nodo/arista seleccionada.
- **Botones:** Guardar (manual, con indicador de cambios no guardados) + Reset (limpia canvas).

### Componentes del archivo
```
sic-diagrama.tsx
├── PasoData (interface)
├── NODE_COLORS (paleta 12 colores)
├── getGlow() / hexToRgba() / getDays() — helpers puros
├── SHAPES[] — configuración de los 6 tipos (defaultColor, defaultWidth/Height, icon JSX)
├── createNewNode() — fábrica de nodos al hacer drop
├── buildNodes() — retorna [] (diagrama libre, sin nodos precargados)
├── NeonHandles — 4 handles con sic-handle-ring
├── NeonNodeBase — base compartida para todos los nodos
├── ProcessNode / StartEndNode / DecisionNode / DocumentNode / ParallelogramNode / HexagonNode
├── NODE_TYPES (mapa tipo → componente)
├── DEFAULT_EDGES = []
├── NeonEdge — arista con gradiente, animateMotion, bend handle
├── EDGE_TYPES_MAP
├── ShapePalette — sidebar drag-and-drop
├── NodeEditModal
├── EdgeEditModal
├── SicDiagramaInner — lógica principal
├── SicErrorBoundary
└── SicDiagramaSection (export)
```

---

## Notas Importantes de Desarrollo

### Dev server vs feature branches
- El servidor de desarrollo (`npm run dev`) corre en la rama `main`.
- Los cambios en ramas de feature **no son visibles** hasta hacer cherry-pick o merge a `main`.
- Siempre hacer `git push origin main` luego del cherry-pick para que los cambios sean visibles.

### Modales / Dialogs
- Usar `createPortal(dialog, document.body)` para que los modales escapen contextos de stacking.
- No envolver botones de acceso rápido (como "Recordatorio") en guards de rol (`canConfig &&`). Mostrarlos siempre; solo deshabilitar funcionalidad si el rol no tiene permiso.

### Sección Transformadores Carga
- Archivo: `components/dashboard/sections/transformadores-carga.tsx`
- Constantes: `REMINDER_KEY = "transformadores-carga"`, `REMINDER_NAME = "Carga de datos — Transformadores"`
- Llama `markUpdated` después del guardado exitoso en `handleSave`.
- El botón "Recordatorio" está en la barra superior sin guard de rol.
- El dialog de configuración se renderiza via `createPortal`.
