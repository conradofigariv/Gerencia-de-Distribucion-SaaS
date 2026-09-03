-- ─────────────────────────────────────────────────────────────────────────────
-- Plan de Compras — reemplaza la pestaña «Global» del Excel PC_ANUAL_GD.
--
-- Dos tablas: la cabecera del plan (un plan por año, con los parámetros que en
-- el Excel eran celdas sueltas al pie de la hoja) y los ítems (una fila por
-- artículo, ~23.000 en el plan 2026).
--
-- ⚠ Acá se guardan SOLO los valores que se cargan a mano. Las columnas que en
-- el Excel son fórmula (Pu Sic + 20%, Pu Est ($), Verif. Precio, Total, Recorte,
-- % Incidencia) NO se persisten: se calculan en `lib/planCompras.ts` a partir
-- de estos campos más los parámetros de la cabecera. Guardarlas duplicaría la
-- verdad y quedarían desfasadas apenas se cambie el tipo de cambio.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Cabecera: un plan por año ───────────────────────────────────────────────
-- `tipo_cambio` y `pct_mayoracion` eran, en el Excel, la celda $BB$22955
-- ("TC 11/07/2025" = 1255) y el 1,2 hardcodeado dentro de la fórmula de
-- Pu Sic + 20%. Acá son datos editables del plan: cambiarlos recalcula toda
-- la grilla sin tocar una sola fila.
create table if not exists public.plan_compras (
  id              uuid primary key default gen_random_uuid(),
  anio            integer not null unique,
  nombre          text,
  tipo_cambio     numeric not null default 1,      -- $ por USD, aplicado a Pu Est (USD)
  pct_mayoracion  numeric not null default 0.20,   -- el «+20%» de Pu Sic + 20%
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─── Ítems: una fila por artículo del plan ───────────────────────────────────
-- PK uuid y no (plan_id, articulo): en el Excel el código 00000000.0 aparece
-- repetido 4 veces (filas de relleno) y la grilla tiene que poder crear una
-- fila vacía sin código, como en una planilla. `orden` conserva la posición
-- visual, que es la que espera quien viene del Excel.
create table if not exists public.plan_compras_items (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references public.plan_compras(id) on delete cascade,
  orden           integer not null default 0,

  -- Identificación (Artículo / Descripción / Unidad vienen del catálogo del
  -- sistema; se guardan igual como texto para que el plan quede autocontenido
  -- aunque el catálogo cambie después).
  articulo        text,
  descripcion     text,
  unidad          text,
  a_cargo_de      text,                            -- sector: GD, ALMACENES, SyRT, GTIC, ...

  -- Cantidades (carga manual)
  cant_gd         numeric,                         -- «GD 2025»: la cantidad que multiplica el total
  cant_aprobadas  numeric,                         -- «CANT. APROBADAS»

  -- Precios unitarios (carga manual)
  pu_sic          numeric,
  pu_op           numeric,
  pu_est_usd      numeric,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- La grilla siempre lee un plan entero ordenado; y el autocompletado busca por
-- código de artículo dentro del plan.
create index if not exists idx_plan_compras_items_plan_orden
  on public.plan_compras_items (plan_id, orden);
create index if not exists idx_plan_compras_items_articulo
  on public.plan_compras_items (plan_id, articulo);

-- ─── updated_at ──────────────────────────────────────────────────────────────
-- Reutiliza public.set_updated_at() (definida en ido_datos.sql). Se redefine
-- acá para que este archivo se pueda correr solo, en cualquier orden.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_plan_compras_updated_at on public.plan_compras;
create trigger trg_plan_compras_updated_at
  before update on public.plan_compras
  for each row execute function public.set_updated_at();

drop trigger if exists trg_plan_compras_items_updated_at on public.plan_compras_items;
create trigger trg_plan_compras_items_updated_at
  before update on public.plan_compras_items
  for each row execute function public.set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Permisiva, igual que el resto de las tablas que la app opera con la anon key:
-- el plan de compras es un dato compartido de la oficina, no personal.
alter table public.plan_compras       enable row level security;
alter table public.plan_compras_items enable row level security;

drop policy if exists "plan_compras_all" on public.plan_compras;
create policy "plan_compras_all"
  on public.plan_compras
  for all
  using (true)
  with check (true);

drop policy if exists "plan_compras_items_all" on public.plan_compras_items;
create policy "plan_compras_items_all"
  on public.plan_compras_items
  for all
  using (true)
  with check (true);

-- ─── Plan inicial ────────────────────────────────────────────────────────────
-- 2026 con el tipo de cambio del Excel (TC 11/07/2025). Idempotente.
insert into public.plan_compras (anio, nombre, tipo_cambio, pct_mayoracion)
values (2026, 'Plan de Compras Anual GD 2026', 1255, 0.20)
on conflict (anio) do nothing;
