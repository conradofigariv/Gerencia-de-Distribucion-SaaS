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

## Lógica de cálculo en AdjudicacionTab

```typescript
// SIC de referencia del renglón (en ARS)
calcSicARS(r) = Σ items: precio_sic_pesos (si ARS) | precio_sic_pesos × fdSic (si USD)

// Total ofertado por oferente (en ARS, usando dólar SIC para normalizar)
calcOferta(r, ofId) = Σ items con oferta: precio_unitario (si ARS) | precio_unitario × fdSic (si USD)

// Porcentaje sobre/bajo la SIC
calcPct(ofARS, sicARS) = (ofARS / sicARS - 1) × 100

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
// size="sm" para tabla de Ofertas, size="md" para ItemModal

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
