# Sección Matrículas → Catálogo (`components/dashboard/sections/matriculas.tsx`)

- **Propósito:** lista maestra de matrículas (tabla `matriculas`): ver, buscar, filtrar por tipo, exportar, y alta/edición/baja de a una o en lote. La carga masiva vive en "Carga de datos → MATRICULAS".
- **UI:** sistema de diseño IDO (`design-system.md`), igual que Stock por Zona. Piezas compartidas en `components/dashboard/ido-kit.tsx` (`SortArrow`, `IdoCheckbox`, `TipoPill`, densidad, medición con canvas).

## Qué del sistema de diseño se aplicó (confirmado con el usuario)
| § | Qué |
|---|---|
| §4.7 | Filtro Todos/Material/Servicio con burbuja deslizante (`IdoSegmented`, memoizado por `layoutId`). También en el modal (Tipo Mat/Serv). |
| §4.2 | `.ido-input` (38px, foco verde + halo; 32px dentro de la toolbar). |
| §4.1 | Agregar = primario · Exportar CSV = secundario · Actualizar / Densidad / Restablecer = terciario · Eliminar = `.ido-btn-danger`. |
| §4.11 | Tabla en CSS grid, un solo contenedor de scroll con header sticky opaco, flecha de orden verde. Checkbox + Matrícula anclados a la izquierda con scroll horizontal. |
| §4.15 | Redimensionado (mín. 64px, guía de 1px + ancho) y doble clic → ajusta al contenido (mide con la fuente real de cada celda y nunca por debajo del título). |
| §4.17 | Descripción absorbe TODO el sobrante (sin tope 2× — mismo desvío deliberado que Stock por Zona). |
| §4.19 / §4.20 | Densidad (32/40/52) + ancho persistidos por usuario en `lib/tableLayout.ts` (`matriculasCatalogo`), con "Restablecer vista". La clave vieja `matriculas-colwidths` se borra al entrar. |
| §4.16 | Selección: clic exclusivo · Ctrl/⌘ acumula · ⇧ rango · checkbox · clic en vacío libera. Barra flotante con 2+ filas: Exportar (CSV de la selección) y Eliminar (en lote, con confirmación). |
| §4.3 | Badges: Tipo (`TipoPill`) y Estado — "Activo…" = badge verde; cualquier otro valor (ej. Inactivo) = chip neutro (el sistema no define badge para inactivo). |

**Excluido a propósito:** §4.4 estados de celda (no se edita en la celda), §4.5 menú contextual, §4.6 barra superior y §4.9/§4.12 conteo (ya están en el header global), §4.10 Guardar, §4.13, §4.14 (no hay grupos de columnas), §4.18 (5 columnas entran), "Bloquear" de la barra flotante (no hay celdas que bloquear), entrada de filas en cascada.

## Detalles que importan
- **La selección se recorta a lo visible** al buscar/filtrar: la barra en lote nunca exporta ni borra filas que no se ven.
- **El checkbox arranca una selección nueva** si venías de un clic simple (Ctrl/⌘ clic, en cambio, acumula sobre la fila inspeccionada).
- **⇧ clic** corta el `mousedown` para que el navegador no pinte texto seleccionado.
- **Borrado en lote:** `deleteMatriculasBulk` en `lib/matriculas.ts`, en tandas de 150 ids (el `in(...)` viaja en la URL). Si falla a mitad, se recarga la lista.
- **Densidad:** las filas animan su posición 200ms SOLO al cambiar de densidad; si la transición quedara fija, también "nadarían" al filtrar u ordenar.
- **Modales** se portalean a `<body>` con `.ido-terminal` re-aplicada (los tokens `--ido-*` solo existen debajo de esa clase).
