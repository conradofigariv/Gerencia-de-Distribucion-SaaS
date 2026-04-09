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
- **Convenciones de Código:** - Usar componentes funcionales y Server Components por defecto.
  - Tipado estricto en interfaces y props (evitar `any`).
  - Nombramiento: PascalCase para componentes, camelCase para funciones/variables.

## Estructura de Archivos Clave
- `src/app/`: Rutas y vistas principales del SaaS.
- `src/components/`: Componentes de UI reutilizables.
- `src/lib/`: Utilidades, configuraciones de API y lógica compartida.
