# Sección Informe Técnico (`components/dashboard/sections/informe-tecnico.tsx`)

## Propósito
Módulo de análisis de licitaciones públicas. Permite cargar renglones/ítems, registrar ofertas de múltiples oferentes, evaluar técnicamente cada uno y adjudicar por renglón. Integra cotización automática del dólar via BCRA.

## Lib de datos: `lib/informeTecnico.ts`
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

## Estructura del componente (informe-tecnico.tsx)

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
├── OfertasTab  →  informe-tecnico-ofertas.tsx (archivo aparte)
│   ├── Sistema de diseño IDO, pantalla «Carga de ofertas» del Design (design-system.md §4.23)
│   ├── Grilla CSS (no <table>): columna Ítem fija a la izquierda, encabezado fijo arriba,
│   │   renglones plegables fijos bajo el encabezado, fila de totales fija abajo.
│   │   Alto ajustado a la ventana (como el Buscador). Contenedor con `.ido-terminal`.
│   ├── Planilla: clic o escribir edita · Enter baja · Tab avanza · flechas · Esc cancela ·
│   │   F2/Enter edita · ⌫ borra · Ctrl+C copia · pegar TSV de Excel completa abajo/derecha ·
│   │   ⇧ clic / ⇧ flechas = rango. Formato es-AR (1.234,56) o 1234.56; texto que no se
│   │   entiende queda en rojo SIN guardar.
│   ├── Moneda POR CELDA: sufijo → chip con menú (80px) · tecla M alterna · clic derecho
│   │   (Copiar / Pegar / Cambiar moneda a USD|ARS en el rango / Borrar valor).
│   ├── Moneda por defecto por oferente (chip en su encabezado, solo celdas nuevas) →
│   │   `licitacion_oferentes.divisa_default` (supabase/informe_tecnico_divisa_default.sql).
│   │   «Cambiar todas las divisas» cambia los defaults y todas las celdas.
│   ├── Cobertura por renglón y oferente: Completo / Parcial (clic = primera pendiente) / Sin ofertar
│   ├── Totales: Σ precio × cantidad en la moneda por defecto del oferente; punto verde =
│   │   menor total entre ofertas completas; «Parcial, faltan N» / «Incluye montos en X
│   │   convertidos» / «+N % vs mejor».
│   ├── Pie: Dólar SIC de Datos generales, SOLO LECTURA (mismo que usa Adjudicación).
│   ├── Guardado automático por celda (upsertOferta / deleteOferta), ✓ verde 1.5s.
│   └── Confirmado con el usuario: SIN «No cotiza» (precio_unitario es NOT NULL; celda
│       vacía = no ofertó) y SIN las ayudas automáticas del diseño (punto verde por ítem,
│       triángulo de fuera de rango, tooltip cantidad × precio).
│
├── EvaluacionTab
│   ├── Tabla: filas=renglones, columnas=oferentes
│   ├── Tres botones por celda: ✓ Cumple (verde) | ⏳ Pendiente (amarillo) | ✗ No cumple (rojo)
│   ├── Textarea de observaciones por celda
│   ├── Lógica de estado: sin registro = sin evaluar | cumple=true = cumple | cumple=false = no cumple | cumple=null con registro = pendiente
│   └── Resumen al pie con conteos por renglón
│
└── AdjudicacionTab  →  informe-tecnico-adjudicacion.tsx (archivo aparte)
    ├── Sistema de diseño IDO, design-system.md §4.21–§4.22 (sección 10 del Design)
    ├── KPIs arriba + resumen al pie (solo tokens IDO)
    ├── Por renglón: cabecera (chip, descripción, bloque SIC que ocupa el resto y reparte
    │   SIC unitario / SIC total centrados — space-evenly)
    │   + fila de tarjetas de oferente ordenadas por PRECIO TOTAL (×cantidad)
    │   ├── Visibles: ⌊(ancho−120)/222⌋ entre 3 y 5; el resto en «N oferentes más»
    │   │   (los que no cotizaron ese renglón van SIEMPRE al resumen, no ocupan lugar)
    │   ├── Desplegada: scroll horizontal con snap, mejor oferta anclada a la izquierda
    │   ├── Arrastrar tarjetas para reordenar (se conservó a pedido del usuario)
    │   └── Botón Adjudicar en todas; la adjudicada queda «✓ Adjudicada» (clic = desadjudica)
    │       y el resto al 50%
    ├── Conmutadores ARS/USD y tarjetas/tabla en la barra SUPERIOR, al lado de «Ayuda»
    │   (AdjudicacionControls). Su estado vive en InformeTecnicoSection vía
    │   useAdjudicacionPrefs() y se pasa a la pestaña por `prefs`. La vista se persiste por
    │   usuario (lib/tableLayout.ts, id `informeAdjudicacion`, campo `view`); la divisa no.
    │   Sin «N de M visibles». En tabla se adjudica con clic derecho.
    └── El contenedor de la pestaña (en informe-tecnico.tsx) toma `.ido-terminal` + bg.base
        solo en esta pestaña.
```

## Lógica de cálculo en AdjudicacionTab

```typescript
// SIC de referencia del renglón (en ARS)
calcSicARS(r) = Σ items: precio_sic_pesos (si ARS) | precio_sic_pesos × fdSic (si USD)

// Total ofertado por oferente (en ARS, usando dólar SIC para normalizar)
calcOferta(r, ofId) = Σ items con oferta: precio_unitario (si ARS) | precio_unitario × fdSic (si USD)

// Porcentaje sobre/bajo la SIC
calcPct = (total ofertado ARS / SIC total ARS − 1) × 100   // sobre TOTALES (×cantidad)
// Ranking y «Mejor oferta» = menor total (×cantidad) con cobertura completa;
// cobertura incompleta → al final, sin número de ranking.
// Alerta de umbral: ⚠ en el chip % cuando supera licitacion.umbral_economico_pct.

// ⚠ Se usa fdSic (no fdOp) para AMBAS conversiones → comparación consistente
```

## Integración BCRA (tipo de cambio automático)

- Endpoint: `https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechaDesde=YYYY-MM-DD&fechaHasta=YYYY-MM-DD&limit=10`
- Para el Dólar OP: se consulta el **día anterior** a la Fecha de la OP
- Si el día cae en fin de semana, `lastWeekday()` retrocede al viernes
- No requiere autenticación
- Respuesta: `{ results: [{ detalle: [{ tipoCotizacion }] }] }` — se extrae `tipoCotizacion`

## Componentes reutilizables dentro del archivo

```typescript
DivisaPicker({ value, onChange, size })
// Dropdown custom (no <select> nativo) para elegir ARS/USD
// Cierra al hacer click afuera via mousedown listener
// size="md" para ItemModal (la grilla de Ofertas ya no lo usa: moneda por celda con chip)

ItemModal({ mode, renglonNumero, initialNumero, ..., onSubmit })
// Modal para crear/editar ítems
// Lookup automático de matrícula con debounce 500ms → autocompleta descripción
// DivisaPicker integrado para precio_sic_divisa
// Inputs con clase .im-input / .im-input-sm / .im-textarea (estilos definidos inline en <style>)

FormSection / FormField
// Wrappers de layout para DatosGeneralesTab
```

## Tablas Supabase del módulo

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
-- licitacion_oferentes.divisa_default text ('USD'|'ARS', default 'ARS') — moneda de las
-- celdas nuevas en Ofertas; ver supabase/informe_tecnico_divisa_default.sql

-- Evaluación y adjudicación
licitacion_evaluaciones_tecnicas(id uuid PK, oferente_id uuid FK, renglon_id uuid FK,
  cumple boolean, observaciones text, updated_at timestamptz, UNIQUE(oferente_id, renglon_id))
licitacion_adjudicaciones(id uuid PK, renglon_id uuid FK, oferente_id uuid FK,
  confirmado_por text, confirmado_at timestamptz, UNIQUE(renglon_id))

-- Catálogo de matrículas (solo lectura desde la sección)
matriculas(articulo text PK, descripcion text)
```

## Convenciones de estilo "beast pure" usadas en esta sección

- **Fondo de cards:** `oklch(0.235 0.005 270)` / paneles internos: `oklch(0.205 0.005 270)`
- **Inputs:** `oklch(0.16 0.005 270)` fondo, `oklch(1 0 0 / 0.07)` borde
- **Focus ring:** `oklch(0.55 0.15 155 / 0.7)` borde + `oklch(0.55 0.15 155 / 0.12)` sombra
- **Acento verde** (matrículas, números SIC, adjudicado): `#86efac`
- **Amarillo pendiente:** `#fcd34d`
- **Rojo no cumple:** `#fca5a5`
- **Fuente monospace:** `ui-monospace, monospace` para precios, números SIC, matrículas
- **Sin flechas en inputs numéricos:** regla global en `app/globals.css` → `input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none }`
- **Sin `<select>` nativo:** siempre usar `DivisaPicker` o dropdown custom con `position: absolute`
