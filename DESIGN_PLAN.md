# Plan de Diseño & Identidad Visual — Gerencia de Distribución SaaS

> Documento de referencia para mantener coherencia visual en futuras funciones y
> rediseños. **Decisión tomada:** pulir la identidad actual (dark + acento verde),
> unificando el sistema en un solo conjunto de tokens. No cambiar de stack.

---

## 0. Regla de oro (OBLIGATORIA)

**La base de TODA la UI es shadcn/ui + nuestros tokens.** La app ya está sobre
shadcn (`components.json`, `style: new-york`, `cssVariables: true`); los colores
nuestros **son** el tema de shadcn.

- ✅ Componentes nuevos: bajarlos con `npx shadcn@latest add <comp>` (heredan el tema).
- ✅ Estilar siempre con **tokens / utilidades** (`bg-card`, `bg-panel`, `text-accent-green`).
- ❌ **Prohibido** `oklch()` / hex literal en componentes (usar los tokens del §1).
- ❌ **Prohibido** crear dropdowns/inputs/tablas custom nuevos que dupliquen un
  primitivo de shadcn (`Select`, `Input`, `Table`…). Reutilizar el primitivo.
- 🔬 Todo componente nuevo se prueba primero en **`/styleguide`**.

> `BeastSelect` / `DivisaPicker` y las tablas a mano son **legado**: se migran a
> primitivos shadcn de forma incremental, no se replican en código nuevo.

---

## 1. Identidad visual (CANÓNICA)

### Principios
- **Dark-first**, fondos profundos con leve translucidez (`/ 0.85` alpha).
- **Un solo acento**: verde `oklch(0.7 0.18 145)`. Usarlo con moderación (1 acción
  primaria por pantalla, estados activos, valores destacados).
- **Tipografía**: `DM Sans` para UI, `JetBrains Mono` para números/precios/matrículas.
- **Jerarquía por espaciado y contraste**, no por bordes pesados ni sombras fuertes.
- **Radios suaves** (`--radius: 0.5rem` base).

### Paleta de tokens (definida en `app/globals.css`)
| Token | Valor | Uso |
|---|---|---|
| `--background` | `oklch(0.09 0.005 260 / 0.85)` | Fondo de la app |
| `--card` | `oklch(0.12 0.005 260 / 0.85)` | Cards / paneles |
| `--secondary` / `--muted` | `oklch(0.18 0.005 260 / 0.85)` | Inputs, fondos secundarios |
| `--border` | `oklch(0.22 0.005 260)` | Bordes |
| `--foreground` | `oklch(0.95 0 0)` | Texto principal |
| `--muted-foreground` | `oklch(0.65 0 0)` | Texto secundario |
| `--accent` / `--ring` | `oklch(0.7 0.18 145)` | Acento verde, focus |
| `--destructive` | `oklch(0.65 0.2 25)` | Errores / peligro |
| `--success` | `oklch(0.7 0.18 145)` | Éxito |
| `--warning` | `oklch(0.75 0.18 55)` | Advertencia |
| `--chart-1..5` | azul/verde/ámbar/rojo/violeta | Series de gráficos |
| `--sidebar*` | familia `oklch(0.11 ...)` | Sidebar |

### ⚠️ Deuda de diseño a resolver: dos dialectos
Hoy conviven **dos sistemas de color**:
1. **Tokens** (`bg-card`, `bg-secondary`, `text-muted-foreground`) — secciones viejas.
2. **"Beast pure" hardcodeado** (`oklch(0.235 0.005 270)`, paneles internos
   `oklch(0.205 0.005 270)`, acento `#86efac`) — Informe Técnico y Stock por Zona.

**Regla a futuro:** todo componente nuevo usa **tokens**, nunca `oklch()` literal.

**✅ Fase 0.1 hecha:** los colores "beast pure" ya existen como tokens en
`globals.css` (mismos valores, cambio invisible). Disponibles como utilidades:

| Token | Utilidad | Era |
|---|---|---|
| `--panel` | `bg-panel` | `oklch(0.235 0.005 270)` |
| `--panel-2` | `bg-panel-2` | `oklch(0.205 0.005 270)` |
| `--panel-header` | `bg-panel-header` | `oklch(0.255 0.006 270)` |
| `--panel-input` | `bg-panel-input` | `oklch(0.16 0.005 270)` |
| `--hairline` | `border-hairline` | `oklch(1 0 0 / 0.07)` |
| `--ring-green` | `ring-green` | `oklch(0.55 0.15 155 / 0.7)` |
| `--accent-green` | `text-accent-green` | `#86efac` |
| `--accent-amber` | `text-accent-amber` | `#fcd34d` |
| `--accent-red` | `text-accent-red` | `#fca5a5` |

Falta (incremental, no urgente): reemplazar los literales en las 10 secciones por
estas utilidades, sección por sección.

---

## 2. Diagnóstico del stack

| Capa | Qué hay | Estado |
|---|---|---|
| Framework | Next.js 16 + React 19 + Tailwind v4 (`@theme inline`) | ✅ |
| Tokens | Variables `oklch` en `globals.css` | ⚠️ 2 dialectos |
| Componentes | ~55 primitivos shadcn/ui + Radix + CVA | ✅ |
| Gráficos | `recharts` 2.15 en 6 archivos | ⚠️ sin tema compartido |
| Animaciones | `tailwindcss-animate` + `tw-animate-css` + 8 keyframes propios | ⚠️ `motion` instalado sin usar |
| Tablas | `<table>` a mano + `@tanstack/react-virtual` | ⚠️ duplicación |

**Disponible sin instalar nada:** `motion` (Framer Motion) y
`components/ui/chart.tsx` (wrapper shadcn de recharts) — ambos presentes y sin uso.

---

## 3. Plan por fases (orden de ejecución acordado)

### FASE 0 — Fundaciones (hacer primero)
- **0.1** Unificar tokens: migrar "beast pure" hardcodeado a variables CSS.
- **0.2** Documentar escala de espaciado y radios; usarlas siempre.
- **0.3** Crear página interna **`/styleguide`** con todos los componentes juntos
  (laboratorio para iterar visualmente).
- **0.4** Mantener este `DESIGN_PLAN.md` como fuente de verdad.

### FASE 1 — Botones
- **1.1** Unificar todo a `<Button variant=...>` (eliminar clases sueltas tipo
  `bg-accent hover:bg-accent/90`).
- **1.2** Agregar variantes `success`, `warning`, `subtle`.
- **1.3** Estados: loading con spinner, `:active` (micro-escala), focus accesible.
- **1.4** Jerarquía: 1 primario por pantalla, secundario, ghost, destructivo.

### FASE 2 — Sidebar
- **2.1** Limpiar menú: ocultar/quitar secciones demo (`Overview`, `Pipeline`,
  `Deals`, `Customers`, `Team`, `Forecasting`, `Reports`).
- **2.2** Pulir estado activo (barrita lateral + transición).
- **2.3** Tooltips cuando está colapsado.
- **2.4** Animación de grupos con altura real (hoy `max-h-52` fijo).
- **2.5** Persistir colapsado/grupos abiertos en `localStorage`.

### FASE 3 — Tablas
- **3.1** Componente `<DataTable>` reutilizable (sobre `react-virtual`).
- **3.2** Header sticky, hover de fila, densidad compacta/cómoda.
- **3.3** Estados: skeleton (loading), empty state, error.
- **3.4** Orden/redimensión de columnas unificados.

### FASE 4 — Gráficos
- **4.1** `lib/chartTheme.ts` con colores, grilla, tooltip y fuentes compartidos.
- **4.2** Wrappers: `<AreaChartCard>`, `<BarChartCard>`, etc.
- **4.3** Evaluar adoptar `components/ui/chart.tsx` (ya presente).
- **4.4** Animación de entrada de datos + skeleton de gráfico.

### FASE 5 — Animaciones
- **5.1** Adoptar Framer Motion (`motion`): transición de secciones, stagger de
  cards, modales.
- **5.2** Variantes reutilizables en `lib/motion.ts` (`fadeUp`, `stagger`, `scaleIn`).
- **5.3** Respetar `prefers-reduced-motion`.
- **5.4** Micro-interacciones: hover de cards, feedback de botones, toasts.

---

## 4. Reglas para mantener la identidad (checklist para features nuevas)

- [ ] Usar **tokens** (`bg-card`, `text-muted-foreground`…), nunca `oklch()` literal.
- [ ] Máximo **un acento verde** por vista; el resto en grises del sistema.
- [ ] Números/precios/matrículas en **monospace** (`font-mono`).
- [ ] Modales con `createPortal(dialog, document.body)`.
- [ ] Nada de `<select>` nativo: usar dropdown custom / `BeastSelect`.
- [ ] Inputs numéricos sin flechas (ya hay regla global).
- [ ] Botones de acceso rápido SIN guard de rol (mostrar siempre, deshabilitar si no hay permiso).
- [ ] Respetar `prefers-reduced-motion` en animaciones nuevas.
- [ ] Componentes nuevos primero en `/styleguide`, después en la sección real.

---

## 5. Librerías (alineadas al stack — no agregar de más)

| Para | Librería | Estado |
|---|---|---|
| Animaciones | Framer Motion (`motion`) | ✅ instalada, activar |
| Tablas headless (sort/filtro) | `@tanstack/react-table` | ❌ evaluar |
| Gráficos | shadcn `chart` sobre recharts | ✅ presente |
| Iconos | Lucide | ✅ |
| Componentes con efectos | Aceternity UI / Magic UI (copy-paste) | recurso |

> No incorporar otra librería de componentes: shadcn/ui + Radix es la base.

---

## 6. Recursos de aprendizaje

- **Refactoring UI** (libro, creadores de Tailwind) — fundamentos para devs.
- **ui.shadcn.com**, **tweakcn** (editor de temas shadcn → exporta tokens oklch).
- **Aceternity UI**, **Magic UI**, **Origin UI** — patrones copy-paste.
- **Mobbin**, **Dribbble**, **Godly.website** — inspiración.
- Estudiar **Linear / Vercel / Stripe** (espaciado generoso, 1 acento, contraste).
- **oklch.com**, **Radix Colors** — color.

### Flujo de trabajo con Claude Code para diseño
1. Iterar en `/styleguide` (comparar variantes lado a lado).
2. Usar el MCP de Figma para convertir diseños ↔ código manteniendo tokens.
3. Pedir comparaciones A/B en código, no descripciones.
4. Apoyarse en screenshots de referencia.
5. Una fase por vez, commits chicos.

---

_Última actualización del plan: la ejecución arranca por FASE 0 cuando se dé luz verde._
