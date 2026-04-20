# Project Context - Gerencia de Distribución SaaS

## Overview
Next.js 15 + React 19 + TypeScript SaaS dashboard for transformer (transformador) distribution management. Features real-time KPI dashboards, sortable tables, and automated Excel planilla ingestion.

## Core Features - "Stock de Transformadores"
Three main sections:
1. **Carga de Datos** - Upload Excel planilla → auto-parses → fills form → save to Supabase
2. **Tabla** - Sortable table view of all registered transformers with status badges
3. **Resumen** - KPI dashboard (5 cards) + distribution charts + latest records

## Tech Stack
- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS
- **Components**: Radix UI + Lucide React
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage (for Excel files)
- **Excel Parsing**: SheetJS (`xlsx` library, v0.18.5)

## Key Components

### transformadores-carga.tsx
Main form for planilla data entry. Features:
- Drag-and-drop Excel upload
- Auto-parses `.xlsx` files via `parseExcelPlanilla()`
- 4 main tables: Terceros, Taller, Autorizados, Rel33
- Real-time computed totals (sum T+M, NOT including CT)
- Save button persists to Supabase `planillas_reserva` table

### transformadores-tabla.tsx
- Displays all transformers in sortable/searchable table
- Shows estado (status) with color badges
- Image preview lightbox on click
- Pagination

### transformadores-resumen.tsx
- 5 KPI cards: total, disponibles, en servicio, en reparación, bajas
- Distribution charts by tipo and top ubicaciones
- Latest 10 records table

## Excel Parsing (parseExcelPlanilla)
Located in `/app/api/analizar-planilla/route.ts`. Parses fixed-template Excel:
- **TERCEROS** (rows 9-25, cols A-D): KVA → {t, m, ct}
- **TALLER** (rows 9-25, cols G-J): KVA → {tipo, t, m, ct}
- **AUTORIZADOS** (col O, rows 9-25): KVA → autorizados count
- **REL33** (rows 33-39, cols A-E): KVA → {tN, mN, tR, mR}
- **OBS/PEND**: Text blocks found by keyword search

## Supabase Schema

### Table: planillas_reserva
```sql
CREATE TABLE planillas_reserva (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  fecha DATE NOT NULL,
  archivo_url TEXT,
  datos JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_planillas_fecha ON planillas_reserva(fecha);
```

### Table: transformadores (referenced in tabla/resumen views)
Stores individual transformer records with columns:
- id, fecha, estado, tipo, ubicacion, kva, imagen_url, etc.

## Important Fixes & Notes

1. **Total Calculation**: `sum = (r) => r.t + r.m` — CON TANQUE is NOT additive (subset)
2. **Excel Only**: Only `.xlsx`/`.xls` files accepted; images/PDFs rejected
3. **Sidebar Scrollbar**: Hidden with `scrollbar-none` + `scrollbarWidth: "none"`
4. **State Management**: terceros, taller, autorizados, rel33 as separate Record<number, X>
5. **Merge Functions**: `mergeMap()`, `mergeTaller()` handle string-keyed API data → number-keyed React state

## Files
- `src/app/page.tsx` - Main dashboard router
- `components/dashboard/sidebar.tsx` - Navigation (auto-expands for transformadores)
- `components/dashboard/header.tsx` - Page titles
- `app/api/analizar-planilla/route.ts` - Excel parsing logic
- `components/dashboard/sections/transformadores-*.tsx` - 3 main views

## Workflow
1. User navigates to "Stock de Transformadores" → "Carga de Datos"
2. Drags/clicks Excel file (must be our template)
3. File parses automatically → data populates form
4. User reviews/edits values in 4 tables
5. Clicks "Guardar" → inserts row into `planillas_reserva` with fecha (current date)
6. Each planilla is weekly, stored separately by date

## Environment
- `.env.local`: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
- No external API keys needed (removed Anthropic/OpenRouter, using Excel parsing)
