# Handoff: Stock de Transformadores — Grilla editable + Historial de informes

## Overview
Dos vistas para el módulo "Stock de Transformadores" de la app SaaS Soft:
1. **Grilla unificada editable** (diseño 1a) — planilla de reserva de transformadores de distribución con edición directa tipo Excel, toggle de filas en 0 e importación desde Excel.
2. **Historial de informes como tabla densa** (diseño 2e) — reemplaza la lista de cards actual por una tabla ordenable, una fila por informe.

## About the Design Files
Los archivos de este paquete son **referencias de diseño en HTML** — prototipos que muestran la apariencia y comportamiento buscados, NO código de producción. La tarea es **recrear estos diseños en el entorno existente del codebase** (React, Vue, etc.) usando sus patrones y librerías. El archivo `Planilla Transformadores.dc.html` contiene ambos diseños: buscá los bloques con id `1a` (grilla) y `2e` (historial); los demás bloques (1b–1d, 2a–2d, 2f) son variantes descartadas — ignorarlas.

## Fidelity
**High-fidelity.** Colores, tipografía, espaciados y estados están definidos y deben recrearse fielmente, integrándose con el tema oscuro existente de la app.

---

## Vista 1 — Grilla unificada editable (1a)

### Purpose
Cargar y corregir semanalmente la reserva de transformadores por potencia (KVA), para una zona (ej. Villa Revol) y tipo RURAL. Reemplaza la grilla actual de steppers −/+ por inputs numéricos editables directamente.

### Layout
Card de ancho completo (~1180px de referencia), fondo `#0c0c10`, borde `1px solid rgba(255,255,255,.09)`, radius `10px`.

**Header** (padding 16px 20px, borde inferior):
- Título: "RESERVA DE TRANSFORMADORES DE DISTRIBUCIÓN" 13px/700 + "(13,2/0,4 — 33/0,4 KV)" en `rgba(255,255,255,.4)`.
- Subtítulo 10.5px `rgba(255,255,255,.45)`: "ÁREA TÉCNICA — DPTO. TRANSFORMADORES — {fecha} — {zona} · TIPO: RURAL".
- Derecha: toggle "Ocultar filas en 0 (N ocultas)" + botón "↑ Importar Excel" (verde outline: bg `rgba(74,222,128,.12)`, borde `rgba(74,222,128,.35)`, texto `#4ade80`).

**Grilla**: CSS grid `70px repeat(4,1fr) 12px repeat(4,1fr) 12px repeat(3,1fr)` — columna KVA, 4 de Terceros, separador, 4 de Taller, separador, 3 de Totales.
- Fila de grupos: "NUEVOS Y REP. POR TERCEROS" y "REPARADOS POR TALLER" (9.5px/700, letter-spacing .08em, `rgba(255,255,255,.5)`, borde inferior 2px `rgba(255,255,255,.14)`); "TOTALES" en `#4ade80` con borde `rgba(74,222,128,.4)`.
- Fila de columnas (9px/700, `rgba(255,255,255,.4)`): POT. KVA | T | M | C/TANQUE | TOTAL | T | M | C/TANQUE | TOTAL | TRAFOS | AUT. P/RETIRO | DISPONIBLES. (T = Trifásico, M = Monofásico, C/Tanque = Con Tanque.)

**Fila de datos** (altura ~40px, borde superior `rgba(255,255,255,.05)`):
- KVA: 12px/700.
- Celdas editables (T, M, C/Tanque de cada bloque): `<input>` numérico centrado, bg `rgba(255,255,255,.05)`, borde `1px solid rgba(255,255,255,.12)`, radius 6px, 12px/600, padding 6px 0. Focus: borde `#4ade80`, bg `rgba(74,222,128,.08)`.
- TOTAL de cada bloque: calculado (T+M), solo lectura, `rgba(255,255,255,.55)`; muestra "–" si es 0.
- TRAFOS: calculado (total terceros + total taller), 12.5px/800.
- AUT. P/RETIRO: `#fbbf24` si > 0, sino `rgba(255,255,255,.35)`.
- DISPONIBLES: pill (radius 6px, padding 4px 8px, 12px/800). Con stock: bg `rgba(74,222,128,.14)`, texto `#4ade80`. Sin stock: bg `rgba(255,255,255,.04)`, texto `rgba(255,255,255,.3)`, muestra "–".
- Filas con disponibles > 0 llevan bg sutil `rgba(74,222,128,.025)`.

**Footer** (padding 14px 20px, borde superior `rgba(255,255,255,.1)`):
- Izquierda: "Total: **145** · Autorizados: **7** (ámbar) · Disponibles: **138** (verde)" — 12px, labels `rgba(255,255,255,.6)`.
- Derecha: botón "Eliminar" (outline rojo: borde `rgba(239,68,68,.4)`, texto `#f87171`) + botón primario "Guardar cambios" (bg `#4ade80`, texto `#052e16`, 11.5px/700, radius 7px).

### Interactions & Behavior
- **Toggle "Ocultar filas en 0"**: oculta filas donde trafos = 0 y autorizados = 0; muestra contador "(N ocultas)". Switch de 32×18px, track verde `#4ade80` con knob `#052e16` cuando activo. Default: activado.
- **Edición**: al cambiar un input se recalculan TOTAL del bloque, TRAFOS y DISPONIBLES (disponibles = trafos − autorizados) en vivo; el footer se recalcula también.
- **Importar Excel**: abre el flujo de carga existente (dropzone .xlsx). Ideal: tras parsear, mostrar solo las celdas que difieren de la carga anterior antes de confirmar.
- **Guardar cambios**: habilitado solo si hay cambios sin guardar (dirty state).
- Potencias fijas (filas): 5, 10, 16, 25, 50, 63, 80, 100, 125, 160, 200, 250, 315, 500, 630, 800 KVA. Tipo: solo RURAL (no mostrar columna TIPO).

### State
- `rows[]`: { kva, terceros:{t,m,cTanque}, taller:{t,m,cTanque}, autorizados } — disponibles y totales son derivados.
- `hideZeros: boolean` (default true), `dirty: boolean`.

---

## Vista 2 — Historial de informes, tabla densa (2e)

### Purpose
Reemplaza la lista actual de cards (una card grande por informe) por una tabla densa ordenable: una fila por informe, columnas numéricas alineadas a la derecha para escanear.

### Layout
Card ~760px+, mismo estilo de card que la Vista 1.

**Header** (padding 14px 20px, borde inferior): título "Informes de Reservas" 13px/700 + "· N informes" en `rgba(255,255,255,.4)`; a la derecha, input de búsqueda "⌕ Buscar fecha o zona…" (bg `rgba(255,255,255,.05)`, borde `rgba(255,255,255,.12)`, radius 7px, 11px). Mantener los filtros de año/mes existentes de la página.

**Tabla**: grid `96px 1fr 76px 100px 88px 72px 70px`:
- Columnas: FECHA (ordenable, flecha ↓) | ZONA | TOTAL | DISPONIBLES | TERCEROS | TALLER | acciones.
- Headers 9px/700 letter-spacing .06em `rgba(255,255,255,.4)`; numéricas alineadas a la derecha, FECHA y ZONA a la izquierda.
- Filas: padding 11px 20px, borde superior `rgba(255,255,255,.05)`, 12px. FECHA 700; ZONA `rgba(255,255,255,.7)`; TOTAL 800; DISPONIBLES `#4ade80` 800; TERCEROS y TALLER `rgba(255,255,255,.55)`.
- Las filas de la fecha más reciente llevan bg `rgba(74,222,128,.03)`.
- Hover de fila: bg `rgba(255,255,255,.04)`; acciones (🗑 eliminar en `#f87171`, › abrir) idealmente visibles solo al hover.

### Interactions & Behavior
- Click en fila (o ›) abre el informe (la grilla de la Vista 1 en modo lectura o edición).
- Click en header FECHA invierte el orden; permitir ordenar también por TOTAL y DISPONIBLES.
- Eliminar: pedir confirmación antes de borrar el informe.
- Búsqueda filtra por fecha (texto o `2026-04-20`) y por nombre de zona en vivo.

---

## Design Tokens
Colores:
- Fondo página: `#08080b` · Card: `#0c0c10` · Bordes: `rgba(255,255,255,.05–.12)`
- Texto principal: `#e8e8ea` · Secundario: `rgba(255,255,255,.55)` · Terciario: `rgba(255,255,255,.4)`
- Acento verde (disponibles, acciones primarias): `#4ade80`; texto sobre verde: `#052e16`; fondos verdes: `rgba(74,222,128,.03–.14)`
- Ámbar (autorizados p/retiro): `#fbbf24` · Rojo (eliminar/negativo): `#f87171` / borde `rgba(239,68,68,.4)`

Tipografía: **Manrope** (Google Fonts), pesos 400–800. Escala usada: 9/9.5px headers de tabla, 10.5–11px metadatos, 11.5–12px cuerpo, 12.5–13px énfasis y títulos de card.
Radios: inputs y botones 6–7px, cards 10px, pills 6px.
Si la app ya tiene tokens propios para estos valores, usarlos.

## Assets
Ninguno externo. El ícono de eliminar y las flechas pueden ser los del set de íconos existente de la app (en el prototipo son glifos de texto).

## Files
- `Planilla Transformadores.dc.html` — prototipo con todas las variantes; implementar SOLO los bloques `id="1a"` y `id="2e"`. La lógica de datos (estructura de filas, cálculo de derivados, toggle) está en la clase `Component` al final del archivo.
