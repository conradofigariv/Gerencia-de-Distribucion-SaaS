# Buscador — Búsqueda Global y Pestañas de Seguimiento

El Buscador es un sistema de dos capas:
1. **Índice maestro** (`busqueda_index`): base de solo lectura que se regenera entera en cada "Reconstruir". Contiene todas las filas de compra (OP/línea/envío) y catálogo.
2. **Pestañas de seguimiento** (`buscador_tabs`, `buscador_tab_filas`): espacio de trabajo del usuario. Se copian filas del índice acá, editables y reordenables por usuario.

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
- `proveedor`, `zona`: metadata de compra.
- `cantidad`, `cantidad_recibida`, `ctd_aceptada`, `pendiente`, `cantidad_vencida`, `cantidad_rechazada`, `cantidad_facturada`, `cantidad_cancelada`: cantidades por estado.
- `fecha_creacion`, `fecha_pactada`, `estado_autorizacion`, `estado_cierre`: fechas y estados.
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

**RLS:** Heredan el dueño de su pestaña — un usuario solo ve filas en pestañas propias.

**Operaciones (lib/buscadorTabs.ts):**
- `fetchTabFilas(tabId)`: Todas las filas de la pestaña.
- `addFilas(tabId, rows, rowKeyOf, ordenBase)`: Copiar filas del índice. Detecta duplicados por `row_key`.
- `updateFilaDatos(id, datos)`: Guardar edición de una celda (datos completo).
- `deleteFilas(ids)`: Borrar filas.
- `reorderFilas(filas[])`: Persistir reorden manual después de drag.

---

## Uso desde la UI

### Buscador (`components/dashboard/sections/buscador.tsx`)

**Modo índice:**
- Búsqueda global (vacío = primeras filas).
- Checkboxes para seleccionar filas.
- Dropdown "Agregar a pestaña" → copia las seleccionadas a la pestaña elegida.

**Modo pestaña:**
- Muestra filas copiadas + 4 columnas de seguimiento (estado, responsable, fechaRevision, nota).
- Agrupa por matrícula (collapsible) si está habilitada la opción.
- Edición inline: doble-click en una celda, Enter para guardar, Escape para cancelar.
- Drag-and-drop para reordenar (deshabilitado si está agrupado).

**Barra superior:**
- `+ Pestaña`: Crea nueva pestaña.
- Doble-click en nombre de pestaña: renombra.
- Botón `×` en pestaña: elimina.
- Toggle "Agrupar": agrupa por matrícula (desactiva reorden, activa collapsibles).
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

## Configuración de Columnas (Phase 2)

**Estado actual:** Global (`user_preferences` tabla).

**Próximo:** Per-tab — cada pestaña tiene su propio `config` (jsonb):
```json
{
  "order": ["articulo", "descripcion", "numero_op", "..."],
  "hidden": ["tx_recibido", "tx_aceptado"],
  "widths": { "articulo": 120, "numero_op": 100 }
}
```

---

## Reconstrucción del Índice

RPC `gd_reconstruir_busqueda()`:
- Borra la tabla `busqueda_index` (CASCADE — no toca pestañas, no hay FK).
- Reconstruye desde `planillas_op` + `matriculas`.
- La fila que copió a una pestaña queda "congelada" — `row_key` apunta a ella, pero si ya no existe en el índice, la pestaña la conserva (será huérfana, pero editable).
- Botón "Actualizar desde el índice" (Phase 2): refresco manual por fila — rellena de nuevo desde el índice usando `row_key`.

---

## Performance y Límites

- **URL length:** Las búsquedas por matrícula se hacen en tandas de 100 para evitar superar el límite de URL (Supabase `.in()`).
- **Index tamaño:** `busqueda_index` puede tener cientos de miles de filas. El índice se ordena por (`articulo_key`, `numero_op`, `linea`, `envio`) para scans rápidos.
- **Pestsñas:** No tienen límite de tamaño (JSONB), pero en la UI el usuario ve una por pestaña a la vez — no hay rendimiento crítico.

---

## SQL

Ver archivo completo en `supabase/buscador_tabs.sql`.
