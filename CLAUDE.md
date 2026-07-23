# Gerencia de Distribución SaaS - Guía de Proyecto

> **Este archivo es el índice general.** Se carga completo en cada sesión, así que se
> mantiene corto a propósito. El detalle profundo de cada sección vive en `docs/*.md`
> (ver tabla de abajo) — **leé el doc correspondiente con la tool `Read` al empezar a
> trabajar en esa sección**, no hace falta cargarlo de entrada si la tarea no lo toca.

## Flujo de Trabajo y Despliegue

- **Repositorio:** GitHub — `conradofigariv/Gerencia-de-Distribucion-SaaS`
- **Hosting:** Vercel — despliega automáticamente desde la rama `main` de GitHub.
- **Flujo:** commit → push a `origin/main` (via API si el proxy git rechaza con 403) → Vercel detecta el push y redeploya automáticamente.
- **Push bloqueado (403):** La rama `main` tiene protección en el proxy git local. Usar `mcp__github__push_files` para empujar directamente via GitHub API. Luego sincronizar local con `git fetch origin main && git reset --hard origin/main`.
- **Dev local:** `npm run dev` sirve los archivos del disco — cualquier rama puede usarse localmente.
- **Antes de mergear:** `git fetch origin main` y comparar contra el branch de trabajo — `main` puede haber avanzado con otras sesiones/PRs; rebasear sobre `origin/main` antes de abrir el PR, no asumir que el punto de partida sigue vigente.

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
- ⚠ **Headers sticky de tabla:** usar siempre `bg-panel-header` (opaco). NUNCA
  `bg-secondary` / `hsl(var(--secondary))`: `--secondary` tiene alpha (`/ 0.85`),
  queda semitransparente y el contenido de filas se transparenta al hacer scroll.

## Estructura de Archivos Clave
- `app/`: Rutas y vistas principales (App Router).
- `components/dashboard/sections/`: Secciones del dashboard (una por módulo).
- `components/dashboard/reminder-bell.tsx`: Campana global de recordatorios.
- `lib/`: Utilidades, configuraciones de API y lógica compartida.
- `lib/reminders.ts`: Helpers `markUpdated`, `fetchReminders`, `upsertConfig` para el sistema de recordatorios.
- `lib/supabaseClient.ts`: Cliente de Supabase.
- `app/globals.css`: CSS global — incluye variables de diseño y todas las animaciones del diagrama SIC.
- `docs/`: Documentación profunda por sección (ver tabla abajo) — leer bajo demanda.

---

## Mapa completo de secciones

| Section ID | Archivo | Grupo sidebar | Descripción | Doc profundo |
|---|---|---|---|---|
| `servicios-planillas` | servicios-planillas.tsx | (raíz) | Carga de planillas Excel: OP, QW, MATRICULAS | — |
| `matriculas` | matriculas.tsx | Matrículas | Catálogo de matrículas: CRUD manual, orden, export CSV | — |
| `matriculas-familias` | matriculas-familias.tsx | Matrículas | Familias como entidad: carga masiva por pegado + selección del catálogo | [`docs/matriculas-familias.md`](docs/matriculas-familias.md) |
| `servicios-resumen` | servicios-resumen.tsx | Control de servicios | Alertas de vencimiento y consumo por OP/zona | — |
| `servicios-tabla` | servicios-tabla.tsx | Control de servicios | Tabla completa de seguimiento de servicios | — |
| `servicios-carga` | servicios-carga.tsx | Control de servicios | Creación manual de filas de seguimiento | — |
| `stock-zona` | stock-zona.tsx | Control de servicios | Stock de materiales por zona (carga por texto) | [`docs/stock-zona.md`](docs/stock-zona.md) |
| `transformadores-resumen` | transformadores-resumen.tsx | Stock de Transformadores | KPIs, gráficos, alarmas de stock de transformadores | — |
| `transformadores-carga` | transformadores-carga.tsx | Stock de Transformadores | Carga de planilla de reserva de transformadores | — |
| `transformadores-tabla` | transformadores-tabla.tsx | Stock de Transformadores | Historial de planillas de reserva | — |
| `sic-diagrama` | sic-diagrama.tsx | Proceso SIC - SIGA | Diagrama de flujo neon + seguimiento de SICs | [`docs/sic-diagrama.md`](docs/sic-diagrama.md) |
| `informe-tecnico` | informe-tecnico.tsx | Licitaciones | Análisis de ofertas y adjudicación por renglón | [`docs/informe-tecnico.md`](docs/informe-tecnico.md) |
| `settings` | settings.tsx | (raíz) | Gestión de usuarios, perfiles, nivel de acceso | — |

### Tablas Supabase por sección

| Sección | Tabla(s) |
|---|---|
| servicios-planillas | `planillas_op`, `planillas_qw`, `planillas_matriculas` |
| servicios-carga | `filas_manuales` |
| servicios-tabla | `filas_servicios` |
| servicios-resumen | `filas_servicios` (lectura) |
| matriculas | `matriculas` |
| matriculas-familias | `familias`, `familia_matriculas`, `matricula_tipo`, `matriculas` (lectura del catálogo) — SQL en [`docs/matriculas-familias.md`](docs/matriculas-familias.md) |
| stock-zona | `stock_uploads`, `familias` + `familia_matriculas` + `matricula_tipo` (lectura para el filtro), `matriculas` (lectura del catálogo) — SQL en [`docs/stock-zona.md`](docs/stock-zona.md) |
| transformadores-carga | `planillas_reserva` |
| transformadores-tabla | `planillas_reserva` (lectura) |
| transformadores-resumen | `planillas_reserva`, `transformador_alarms` |
| sic-diagrama | `sic_diagrama_layout`, `sic_diagrama_active` — SQL en [`docs/sic-diagrama.md`](docs/sic-diagrama.md) |
| informe-tecnico | `licitaciones`, `licitacion_renglones`, `licitacion_items`, `licitacion_oferentes`, `licitacion_ofertas`, `licitacion_evaluaciones_tecnicas`, `licitacion_adjudicaciones`, `matriculas` — SQL en [`docs/informe-tecnico.md`](docs/informe-tecnico.md) |
| settings | `profiles` |
| recordatorios | `reminder_config` |

---

## Sistema de Recordatorios

Cada sección de carga de datos puede tener un recordatorio configurable.

- **Tabla Supabase:** `reminder_config(key, name, user_id, freq_days, time, last_updated_at)`
- **Lib:** `lib/reminders.ts` — exporta `markUpdated(key, name, userId)`, `fetchReminders(userId)`, `upsertConfig(key, name, userId, freq, time)`
- **Bell global:** `components/dashboard/reminder-bell.tsx` — lee todas las claves en `ALL_REMINDER_KEYS` y alerta si alguna está vencida. Cada notificación tiene una X para descartarla (sesión actual).
- **Claves registradas hoy:** `planillas-OP`, `planillas-QW`, `planillas-MATRICULAS`, `servicios-carga`, `transformadores-carga` (ver `ALL_REMINDER_KEYS` en `reminder-bell.tsx` para la lista completa y actualizada).

### Patrón para agregar recordatorio a una sección nueva
1. Importar `createPortal` de `react-dom`, `BellRing` de `lucide-react`, y `markUpdated`, `fetchReminders`, `upsertConfig` de `@/lib/reminders`.
2. Constantes: `REMINDER_KEY = "mi-seccion"`, `REMINDER_NAME = "Nombre legible"`.
3. Estados: `userId`, `configOpen`, `loadingConfig`, `savingConfig`, `reminderFreq`, `reminderTime`, `reminderLastUpd`.
4. Botón en la barra superior (SIN guard de `canConfig`): `<button onClick={() => setConfigOpen(true)}><BellRing/> Recordatorio</button>`
5. Llamar `markUpdated(REMINDER_KEY, REMINDER_NAME, userId)` después de un guardado exitoso.
6. Renderizar el dialog via `createPortal(dialog, document.body)` al final del return.
7. Agregar la clave a `ALL_REMINDER_KEYS` en `reminder-bell.tsx`.

(Ejemplo real ya implementado: `transformadores-carga.tsx`.)

---

## Notas Importantes de Desarrollo

### Dev server vs feature branches
- El servidor de desarrollo (`npm run dev`) sirve los archivos del disco — la rama de git activa no importa.
- Los cambios deben pushearse a `origin/main` para que Vercel los despliegue.
- Si el proxy git rechaza con 403, usar `mcp__github__push_files` (GitHub API) y luego `git fetch origin main && git reset --hard origin/main` para sincronizar local.

### Modales / Dialogs
- Usar `createPortal(dialog, document.body)` para que los modales escapen contextos de stacking.
- No envolver botones de acceso rápido (como "Recordatorio") en guards de rol (`canConfig &&`). Mostrarlos siempre; solo deshabilitar funcionalidad si el rol no tiene permiso.
