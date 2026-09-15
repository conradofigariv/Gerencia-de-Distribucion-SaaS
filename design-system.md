# Sistema de diseño — Producto de datos interno (modo oscuro)

> Extraído del import de Claude Design `Sistema de diseño.dc.html` (v1).
> Este documento es una **transcripción fiel** de lo que el archivo de Design
> define explícitamente. Donde un componente no tiene todos sus estados
> (hover / disabled / error / loading, etc.) definidos en el archivo fuente,
> se listó aparte bajo **"Pendiente de definir"** en vez de completarlo por
> criterio propio.
>
> ⚠️ Este sistema de diseño usa una paleta y tipografía (Geist / Geist Mono,
> acento `#3FCF8E`) **distintas** de las que ya están en producción en esta
> app (`app/globals.css`, tokens shadcn con acento verde propio, DM Sans /
> JetBrains Mono — ver `DESIGN_PLAN.md`). Es un **material de referencia**
> para evaluar/adoptar, no un reemplazo aplicado automáticamente.

---

## 1. Paleta de colores y uso semántico

| Token | Hex / valor | Uso semántico |
|---|---|---|
| `bg.base` | `#0A0B0D` | Fondo de aplicación |
| `bg.surface` | `#111316` | Superficie (cards, paneles) |
| `bg.elevated` | `#16181B` | Elevada · inputs · menús |
| `bg.header` | `#0D0F11` | Encabezado de tabla / barras superiores |
| `border.default` | `#1E2226` | Borde estándar |
| `border.strong` | `rgba(255,255,255,.16)` | Borde fuerte (16% blanco) |
| `text.primary` | `#E4E7EB` | Texto principal |
| `text.secondary` | `#7A828B` | Texto secundario |
| `text.tertiary` | `#4A5057` | Texto terciario / deshabilitado |
| `accent.green` | `#3FCF8E` | Acento — **limitado a 4 usos por pantalla** (ver §6 "Regla del acento") |
| `error` | `#E5484D` | Error |
| `warning` | `#F5A524` | Advertencia |

Colores adicionales usados solo como identidad de categoría (zonas), no son
parte de la paleta semántica central:

| Zona | Color |
|---|---|
| Norte | `#5B8DEF` |
| Centro | `#B07BEB` |
| Sur | `#4FC3D9` |
| Litoral | `#E8A33D` |
| Cuyo | `#E8788F` |

### Regla del acento (verde `#3FCF8E`)
El verde aparece en **exactamente cuatro contextos** por pantalla, sin excepción:
1. **Valor calculado** — números derivados (ej. `1.284,00` en itálica).
2. **Elemento activo o seleccionado** — anillo interior `box-shadow: inset 0 0 0 1.5px #3FCF8E`.
3. **Foco de input** — borde `#3FCF8E` + halo `box-shadow: 0 0 0 3px rgba(63,207,142,.15)`.
4. **Botón primario** — fondo sólido `#3FCF8E`, texto `#0A0B0D`.

Fuera de esos cuatro casos, no debe usarse el verde como color decorativo.

---

## 2. Tipografía y escalas

**Familias:** `Geist` (UI) / `Geist Mono` (datos tabulares, monto, hex, fechas) — fallback `Inter, system-ui, sans-serif` / `'JetBrains Mono', monospace`.

| Tamaño · peso | Uso | Tracking / transform |
|---|---|---|
| 24 · 600 | Título de pantalla | `letter-spacing:-.01em` |
| 15 · 600 | Título de sección | — |
| 13 · 400 | Cuerpo y celdas de tabla | — |
| 12 · 600 | Botones | `letter-spacing:.06em`, uppercase |
| 11 · 500 | Etiqueta de campo | `letter-spacing:.08em`, uppercase, color `text.secondary` |
| 10 · 500 | Encabezado de tabla | `letter-spacing:.1em`, uppercase, color `text.secondary` |
| 9 · 600 | Etiqueta de grupo de columnas | `letter-spacing:.18em`, uppercase, color `accent.green` |
| mono (13) | Cifras/datos: `1.284.560,00 · −3,42 %` | `font-variant-numeric: tabular-nums` |

Notas:
- Todo número tabular usa `font-variant-numeric: tabular-nums` para alinear dígitos.
- El acento verde en etiquetas de grupo siempre va acompañado de una barra vertical de `2px × 9-10px` como marcador.

---

## 3. Espaciado y radios

**Escala de espaciado (base 4px):** `4, 8, 12, 16, 24, 32, 48` px.

**Radios (`border-radius`):**
| Valor | Uso |
|---|---|
| `8px` | Controles (botones, inputs, chips no-pill) |
| `10px` | Menús, popovers |
| `12px` | Tarjetas, contenedores de sección/tabla |
| `999px` (pill) | Chips, badges, avatar, indicador de notificación |

**Alturas de control estándar:**
| Altura | Uso |
|---|---|
| `56px` | Barra superior de pantalla |
| `52px` | Barra de tabs |
| `48px` | Toolbar de tabla |
| `40px` | Fila de tabla (grilla principal) |
| `38px` | Botones / inputs de formulario (32px dentro de toolbars) |
| `36px` | Fila de tabla en tablas secundarias (grupo colapsable / resize) |
| `32px` | Botones de toolbar, fila de acción flotante |
| `24px` | Chips / badges informativos |
| `20px` | Badges de estado (pill pequeño) |

### Movimiento — una sola curva
Toda animación usa `cubic-bezier(0.16, 1, 0.3, 1)`. Duraciones por caso de uso:

| Duración | Caso |
|---|---|
| 200ms / delay 40ms | Entrada de pantalla: bloques en cascada, fade + 6px |
| 160ms / delay 12ms | Filas en cascada, fade + 4px, tope 15 filas |
| 300ms | Conteo animado de números que cambian + pulso verde |
| 240ms | Reordenar: filas deslizan a su nueva posición |
| 180ms | Filtrar: filas ocultas se desvanecen y colapsan |
| 200ms / 120ms | Tabs: indicador desliza · fade cruzado de contenido |
| 200ms | Columnas: expanden o colapsan su ancho |
| 200ms / 1500ms | Guardar: check en el botón · punto "sin guardar" fade 150ms |
| 140ms | Menú contextual: escala `0.96 → 1` + fade |
| 220ms | Grupo de columnas: colapso/expansión, cascada de headers 20ms |
| 100ms–120ms | Micro-transiciones de hover (color/background/border) |

---

## 4. Catálogo de componentes

### 4.1 Botones (altura 38px; 32px en toolbars)
| Variante | Default | Hover |
|---|---|---|
| Primario | `background:#3FCF8E; color:#0A0B0D` | `filter:brightness(1.08)` |
| Secundario | `border:1px solid rgba(255,255,255,.16); background:transparent; color:#E4E7EB` | `background:#16181B` |
| Terciario | `background:transparent; color:#7A828B` | `color:#E4E7EB` |
| Destructivo (dentro de barra de acción flotante) | `background:transparent; color:#E5484D` | `background:rgba(229,72,77,.12)` |

Tipografía: `600 12px Geist`, `letter-spacing:.06em`, uppercase.

### 4.2 Inputs y selectores (altura 38px)
| Estado | Estilo |
|---|---|
| Reposo | `background:#16181B; border:1px solid #1E2226` |
| Foco | `border:1px solid #3FCF8E; box-shadow:0 0 0 3px rgba(63,207,142,.15)` |
| Error | `border:1px solid #E5484D` + texto de ayuda `color:#E5484D` debajo (ej. "CUIT incompleto") |

Placeholder: `color:#4A5057`.

### 4.3 Chips y badges (radio completo)
| Tipo | Estilo |
|---|---|
| Chip informativo (con ícono) | `background:#16181B; border:1px solid #1E2226; color:#E4E7EB` |
| Chip contador | `background:#16181B; border:1px solid #1E2226; color:#7A828B` (número en mono, `color:#E4E7EB`) |
| Badge de estado "Activo" | `background:rgba(63,207,142,.12); color:#3FCF8E` |
| Badge de estado "Pendiente" | `background:rgba(245,165,36,.12); color:#F5A524` |
| Badge de estado "Error" | `background:rgba(229,72,77,.12); color:#E5484D` |
| Badge contador circular (ej. notificaciones) | `background:#3FCF8E; color:#0A0B0D`, `font:600 10px` |

### 4.4 Estados de celda (tabla editable)
| Estado | Estilo |
|---|---|
| Hover | `background:#16181B; border:1px solid #1E2226` |
| Selección | `background:#111316; box-shadow:inset 0 0 0 1.5px #3FCF8E` |
| Edición | `background:#0A0B0D; box-shadow:inset 0 0 0 1.5px #3FCF8E` + cursor mono (barra vertical verde) |
| Bloqueada | `background:rgba(63,207,142,.03); border:1px solid #1E2226; color:#7A828B; cursor:default` |
| Error | `border:1px solid #E5484D` + triángulo indicador esquina superior derecha (`#E5484D`) |
| Modificada | `border:1px solid #1E2226` + triángulo indicador esquina inferior izquierda (`#3FCF8E`) |

### 4.5 Menú de clic derecho (216px de ancho)
| Estado | Estilo |
|---|---|
| Default (ítem) | `color` según ítem (`#E4E7EB` normal, `#E5484D` destructivo); ícono `color:#7A828B` (o `#E5484D` si destructivo) |
| Hover | `background:rgba(255,255,255,.06)`; el ícono pasa a tomar el `color` del ítem |
| Separador | línea de `1px` `#1E2226` con margen `4px 8px` |

Aparición: escala `0.96 → 1` + fade, 140ms, desde el punto del clic. Contenedor: `background:#16181B; border:1px solid #1E2226; border-radius:10px; box-shadow:0 16px 40px rgba(0,0,0,.6), 0 2px 8px rgba(0,0,0,.4)`.

Ítems documentados en el ejemplo: Copiar (⌘C), Pegar (⌘V), Recalcular fila (⌘R), Bloquear celda (⌘L), Exportar selección (⌘E), Eliminar fila (⌫, destructivo).

### 4.6 Barra superior de pantalla (56px)
Título (24·600) + chip de rango de fechas (hover: `border-color:rgba(255,255,255,.16)`) + acciones a la derecha: vista, notificaciones (badge contador verde), avatar+chevron. Todos los botones-ícono: `width:32px;height:32px;border-radius:8px`, hover `background:#16181B`.

### 4.7 Tabs (52px)
Indicador deslizante: `background:#16181B; border:1px solid rgba(255,255,255,.16); border-radius:8px`, anima `left`/`width` en 200ms. Tab activo: `color:#E4E7EB`; inactivo: `color:#7A828B`, hover `color:#E4E7EB`. Botón "nueva vista": borde discontinuo (`border:1px dashed #1E2226`), hover `color:#E4E7EB; border-color:rgba(255,255,255,.16)`.

### 4.8 Barra de filtros
Cada filtro es un `label` con etiqueta 11·500 uppercase + control de 38px (input o botón-select con chevron). Hover de selects: `border-color:rgba(255,255,255,.16)`. Botón "Buscar": variante primaria.

### 4.9 Línea de contexto
Texto 12px `color:#7A828B` con conteo de resultados en mono; si la lista está truncada, se muestra en `color:#F5A524` ("lista truncada a 500 filas"). Atajos de teclado a la derecha en `<kbd>` mono.

### 4.10 Toolbar de tabla (48px)
Título de tab (15·600) + indicador "cambios sin guardar" (punto `6px` verde, fade de opacidad 150ms) + contador de filas + botón Sincronizar (terciario, ícono refresh) + menú de Columnas (secundario, con badge `N/45`) + chip contador de filas + botón Guardar (primario, con cross-fade ícono disquete ↔ check al guardar, 200ms, y el label cambia a "Guardado" por 1500ms).

Menú de columnas (dropdown, 216px): igual patrón que el menú contextual (escala+fade 140ms); cada fila es un checkbox custom: `off → border:rgba(255,255,255,.16), bg:transparent`; `on → border:#3FCF8E, bg:#3FCF8E` con check `#0A0B0D`.

### 4.11 Tabla principal (CSS grid, nunca `<table>`)
- Encabezado sticky: `background:#0D0F11; border-bottom:1px solid rgba(255,255,255,.16)`.
- Columna de checkbox y de ID quedan `position:sticky;left:0/44px`.
- Encabezados ordenables: hover `color:#E4E7EB`; columna activa: flecha verde (`stroke:#3FCF8E`) con rotación 180° según dirección.
- Grupos de columnas: etiqueta 9·600 uppercase verde con marcador de barra, posicionada sobre el borde izquierdo del grupo (`border-left:1px solid rgba(255,255,255,.16)`).
- Filas: `height:40px`, hover `background:#16181B`; entrada en cascada (animation `rowIn`, delay escalonado, tope 15 filas ~12ms c/u).
- Fila seleccionada: `background:rgba(63,207,142,.04)`.
- Flash de sincronización (precio/valor actualizado): `background:rgba(63,207,142,.18)` → transición 400ms a transparente.
- Columna "Var %": color `#3FCF8E` si ≥0, `#E5484D` si negativo; flecha rota 180° si es negativo.

### 4.12 Barra de estado de tabla (32px)
`background:#111316; border-top:1px solid #1E2226`. Izquierda: valor total (mono, `#E4E7EB`) + seleccionadas. Derecha: hora de última sincronización (mono, `#7A828B`), label en `color:#4A5057`.

### 4.13 Texto de ayuda
13px, `color:#7A828B`, con palabras clave resaltadas en `color:#3FCF8E` (ej. "Pegado", "cálculo").

### 4.14 Grupo de columnas colapsable
- Control: botón circular `20px`, `border:1px solid rgba(255,255,255,.16); background:#16181B; color:#7A828B`; hover `color:#E4E7EB; border-color:#3FCF8E; background:#1E2226`. Chevron rota 180° según estado.
- Expandido: columnas por zona visibles (`88px` c/u), badge de color de identidad de zona (6px, dot), no el verde del sistema.
- Colapsado: una sola columna resumen ("N zonas") con el agregado por fila; si el dato es parcial (algún valor null), el total se muestra en `text.secondary` (`#7A828B`) en vez de `text.primary`.
- Transición: colapso 220ms de derecha a izquierda; resumen con fade 140ms; expansión en cascada 20ms entre columnas.

### 4.15 Redimensionado de columna
- Franja de agarre invisible de `8px` sobre el borde derecho de cada header (excepto checkbox e ícono).
- Hover/arrastre: línea vertical `2px` verde (`opacity` 0→1).
- Ancho mínimo: `64px` — la guía no cruza ese punto aunque el cursor siga.
- Doble clic: ajusta al contenido (`fit`) en 200ms.
- Durante el arrastre: guía de `1px` verde atraviesa toda la tabla (incluido encabezado) + etiqueta mono `11px` con el ancho actual, acompañando al cursor.

### 4.16 Selección de fila + barra de acción flotante
- Interacción: clic simple exclusivo · ⌘/Ctrl clic acumula · ⇧ clic selecciona rango · clic en vacío libera.
- Barra flotante (aparece con selección activa): centrada abajo, `background:#16181B; border:1px solid rgba(255,255,255,.16); border-radius:10px; box-shadow:0 16px 40px rgba(0,0,0,.6)`. Contiene: contador de seleccionadas, separador, botón Exportar (secundario), botón Bloquear (secundario), botón Eliminar (texto `#E5484D`, hover `background:rgba(229,72,77,.12)`), botón cerrar/liberar (ícono, hover `color:#E4E7EB`).
- Transición de aparición/desaparición: opacity + transform, 180ms.

---

## 5. Pendiente de definir

El archivo de Design fuente **no** especifica de forma explícita los siguientes
estados/valores. Se listan aquí en vez de completarlos por criterio propio —
cualquier implementación debe pedir esta definición antes de construirse:

- **Botones — estado `disabled`**: no hay ninguna variante deshabilitada
  (opacidad, cursor, color) definida para primario/secundario/terciario.
- **Botones — estado `loading`**: no existe un patrón de spinner/carga para
  botones en general. El único caso de "loading-like" documentado es el
  cross-fade disquete↔check del botón **Guardar** específico del toolbar de
  tabla (§4.10), no un patrón reusable de botón.
- **Botones — estado de `error`**: no hay variante de botón con semántica de
  error (solo el texto del botón "Eliminar" en la barra flotante usa el color
  `error`, pero no es un "estado" del componente Botón en sí).
- **Inputs — estado `hover`**: no definido (solo se documentan Reposo, Foco y
  Error).
- **Inputs — estado `disabled`**: no definido.
- **Selects/dropdowns de filtro (Cartera, Moneda, Rango)** — no se documenta
  su estado abierto/desplegado (solo el botón cerrado con hover). El único
  dropdown con estado "abierto" completamente definido es el menú de
  Columnas (§4.10).
- **Chips/badges — estados interactivos**: los chips "Ago 2026" y "1.284
  filas" no tienen hover ni estado activo definido (no está claro si son
  clickeables). Los badges de estado (Activo/Pendiente/Error) no tienen
  variantes de interacción — parecen puramente informativos, pero no se
  aclara en el archivo.
- **Selección de fila — valores concretos de `ring`/hover/checkbox**: la
  sección 05 ("Selección de fila") referencia en el HTML variables como
  `r.bg`, `r.ring`, `r.checkBorder`, `r.checkBg`, `r.checked`, `d.barOp`,
  `d.barY`, `d.count`, pero el bloque de script del archivo **no** incluye
  la función que genera `selDemos` (sí incluye `rzDemos`, `groupDemos`,
  `colors`, `menu`) — por lo tanto los valores exactos de color/sombra para
  fila seleccionada (fuera del patrón general "anillo verde" de §1) no están
  concretamente definidos en este export.
- **Estado de celda `loading`**: las 6 variantes documentadas son Hover,
  Selección, Edición, Bloqueada, Error y Modificada — no hay una variante de
  celda en estado de carga.
- **Menú contextual — estado `disabled`**: no hay ítems deshabilitados en el
  ejemplo; no se define su estilo.
- **Estados vacíos / error a nivel de pantalla o tabla** (empty state,
  error de carga de datos, skeleton/loading de tabla completa): no
  documentados en ninguna sección del archivo.
- **Modo claro / light theme**: el sistema está definido íntegramente en
  modo oscuro; no hay ninguna referencia a una paleta clara equivalente.
- **Breakpoints / comportamiento responsive**: el archivo no documenta
  breakpoints ni adaptaciones para mobile/tablet.
