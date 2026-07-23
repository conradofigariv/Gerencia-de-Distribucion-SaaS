# Diagrama de Flujo SIC (`components/dashboard/sections/sic-diagrama.tsx`)

## Diseño Visual — CANÓNICO Y FIJO
El diseño visual proviene de un prototipo en Claude Design (archivo `Flow Nodes.html`).
**NO modificar la estética sin instrucción explícita del usuario.**

### Canvas
- Fondo: `#070912` (negro profundo)
- Grilla de puntos: `BackgroundVariant.Dots`, color `rgba(255,255,255,.05)`, gap 24px
- Nebula: dos `radial-gradient` absolutos (púrpura en esquina superior-derecha, verde en inferior-izquierda)
- Borde del contenedor: `1px solid rgba(255,255,255,.08)`

### Paleta de colores de nodos (6 colores neon canónicos)
| Tipo | Color | Uso |
|------|-------|-----|
| Preparación (hexágono) | `#2dd4bf` | teal |
| Inicio / Fin (stadium) | `#34d399` | green |
| Decisión (diamante) | `#f59e0b` | amber |
| Actividad (rectángulo) | `#60a5fa` | blue |
| Entrada / Salida (paralelogramo) | `#22d3ee` | cyan |
| Documento | `#c084fc` | violet |

Los colores extra disponibles en el selector: `#ef4444`, `#ec4899`, `#f97316`, `#6366f1`, `#64748b`, `#e2e8f0`.

### Sistema de brillo neon (CSS variables por nodo)
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

### Anatomía de cada nodo (NeonNodeBase)
1. `NodeResizer` (redimensionable, borde del color del nodo)
2. `NeonHandles` × 4 — puntos de conexión neon con ring pulsante al hover (clase `sic-handle-ring`)
3. SVG de forma con clase `sic-node-svg` + variables CSS
4. Sheen: gradiente semitransparente en la parte superior
5. Label: título con `textShadow` neon
6. Owner pill: avatar circular con iniciales + nombre del primer responsable
7. Clase `sic-node` en el wrapper → animación `sic-fadeup` + `contain: layout style`

**Sin icon badge** — los íconos pequeños de tipo de nodo fueron eliminados para mayor limpieza visual.
**Sin age display** — el indicador "Hoy"/"X días" fue eliminado.

### Aristas (NeonEdge)
- `<linearGradient>` de `sourceColor` → `targetColor` (almacenados en `edge.data`)
- Path con `strokeDasharray="6 6"` + clase `sic-edge-flow` → animación de flujo
- Círculo blanco con `<animateMotion>` siguiendo el path — **velocidad normalizada:** `dur = pathLength / 110` segundos (constante para todas las aristas)
- Path invisible de 16px de ancho (`react-flow__edge-interaction`) como área de click
- Marcador de flecha custom inline en `<defs>` (color del nodo destino)
- Al seleccionar: handle de curvatura (bezier=ámbar, step=azul)

### Highlight de nodo activo (SIC)
- Clase `sic-node-active` en el wrapper `.sic-node` cuando `d.highlighted` está seteado
- CSS: `sic-active-glow` 1.6s ease-in-out infinite — pulso de `drop-shadow` desde tenue hasta `drop-shadow(0 0 38px var(--node-c))`
- Fill del SVG forzado a `--node-fill-hover` mientras está activo

### Animaciones (definidas en `app/globals.css`)
```css
@keyframes sic-dash       /* flujo de guiones en aristas */
@keyframes sic-fadeup     /* entrada de nodos */
@keyframes sic-hpulse     /* ring de handles */
@keyframes sic-pulse      /* dot de estado */
@keyframes sic-drift      /* nebula de fondo */
@keyframes sic-active-glow /* pulso de nodo activo en SIC */
```

### Rendimiento CSS — animaciones SIC
- `.sic-node-svg` tiene `will-change: filter` → lo promueve a capa GPU, evita repintar el resto del canvas en cada frame de animación.
- `.sic-node` tiene `contain: layout style` → limita el área de repaint a cada nodo.
- `sic-active-glow` usa 2 drop-shadows (no 3) para reducir costo de compositing.
- Velocidad del punto animado en aristas = `pathLength / 110` px/s (constante para todas las aristas).

## Funcionalidad del diagrama (conservar siempre)
- **Supabase save/load:** tabla `sic_diagrama_layout(id, nodes, edges, updated_at)` con upsert en `id="main"`. El campo `highlighted` NUNCA se persiste — se inyecta transientemente en `renderedNodes` al renderizar.
- **Doble clic en nodo:** abre `NodeEditModal` — edita título, encargados, color.
- **Doble clic en arista:** abre `EdgeEditModal` — cambia tipo (bezier/step) y etiqueta.
- **Drag & drop desde sidebar:** arrastra shape → suelta en canvas → crea nodo.
- **Redimensionar:** arrastrar borde del nodo con `NodeResizer`.
- **Eliminar:** tecla `Supr` / `Backspace` con nodo/arista seleccionada.
- **Botones:** Guardar (manual, indicador de cambios no guardados) + Reset (limpia canvas).

## Seguimiento de SICs (`sic_diagrama_active`)

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

## Componentes del archivo
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

## SQL — tablas no estándar
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
```
