-- ─────────────────────────────────────────────────────────────────────────────
-- Plan de Compras — réplica del Excel PC_ANUAL_GD (pestañas Global, Prioridad
-- y Resumen). Doc completo: docs/plan-compras.md.
--
-- Cuatro tablas:
--   plan_compras           cabecera: un plan por año + los parámetros que en el
--                          Excel eran celdas sueltas (TC, el +20%, encabezados).
--   plan_compras_items     una fila por matrícula de la pestaña «Global»
--                          (22.950 en el plan 2026).
--   plan_compras_familias  la pestaña «Prioridad»: familia → prioridad.
--   plan_compras_cuentas   la tabla de cuentas contables de la pestaña «Resumen».
--
-- ⚠ En `plan_compras_items` se guarda SOLO lo que en el Excel es un dato
-- cargado (o pegado como valor). Todo lo que es fórmula (ZA, INTERIOR, TOTAL,
-- GD 2025, Recorte, Análisis, Pu Sic + 20%, Pu Est en pesos, Verif. Precio,
-- Total en pesos, % Incidencia, Total Ajustado, DIF PU%, DIF GLOBAL %, MAX) se calcula
-- en `lib/planComprasCalc.ts`. Guardarlo duplicaría la verdad y quedaría
-- desfasado apenas se cambie el tipo de cambio o una cantidad.
--
-- Idempotente: se puede correr de nuevo sin perder datos.
--
-- Cómo correrlo: Supabase → SQL Editor → snippet nuevo → pegar TODO el archivo
-- → Run (sin texto seleccionado: con una selección corre solo esa parte).
-- Solo tablas, índices y permisos: NINGUNA función ni bloque de código. Las
-- versiones anteriores tenían funciones (plpgsql) y al pegarlas en el SQL
-- Editor el cuerpo llegaba alterado («syntax error at end of input / LINE 0»,
-- «relation "v_anio" does not exist»). La activación del plan importado la
-- hace la app (lib/planCompras.ts → importarPlan).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Esqueleto viejo ─────────────────────────────────────────────────────────
-- Una versión anterior de este archivo creaba `plan_compras_items` con un
-- modelo reducido (cant_gd, pu_sic, …) que nunca llegó a tener datos. Si esa
-- tabla existe, el `create table if not exists` de abajo no la toca: los
-- `add column if not exists` la completan y se le quita `cant_gd`. La fila
-- semilla 2026 que creaba queda inactiva y se borra al final del archivo.

-- ─── Cabecera ────────────────────────────────────────────────────────────────
-- Cada importación del Excel crea una cabecera NUEVA (inactiva), le carga los
-- ítems y recién al final la activa (lo hace la app). Así, si la
-- subida se corta a mitad de camino, el plan anterior sigue intacto y lo
-- que quedó a medias se borra. Solo hay un plan ACTIVO por año (índice
-- parcial único más abajo).
create table if not exists public.plan_compras (
  id              uuid primary key default gen_random_uuid(),
  anio            integer not null,
  nombre          text,
  tipo_cambio     numeric not null default 1,      -- pesos por dólar («TC PLAN» / «TC 11/07/2025»)
  pct_mayoracion  numeric not null default 0.20,   -- el «+20%» de Pu Sic + 20%
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Columnas agregadas sobre la cabecera original (alter idempotente).
alter table public.plan_compras add column if not exists activo        boolean not null default false;
-- Encabezados tal cual vienen en el Excel, por clave de columna
-- ({"hist_1":"2023P","gd":"GD 2025","total_plan":"Total 2026 en pesos", …}). Las
-- columnas en la base tienen nombres sin año; el año vive acá.
alter table public.plan_compras add column if not exists etiquetas     jsonb not null default '{}'::jsonb;
-- Celdas sueltas al pie de «Global» (TC y PC en USD de años anteriores):
-- [{"etiqueta":"TC 11/07/2024","valor":920}, …]
alter table public.plan_compras add column if not exists pie           jsonb not null default '[]'::jsonb;
alter table public.plan_compras add column if not exists archivo       text;
alter table public.plan_compras add column if not exists importado_at  timestamptz;
alter table public.plan_compras add column if not exists importado_por uuid;

-- La cabecera original tenía `anio unique`: con versiones por importación
-- tiene que ser único solo entre los planes activos.
alter table public.plan_compras drop constraint if exists plan_compras_anio_key;
create unique index if not exists plan_compras_anio_activo_uq
  on public.plan_compras (anio) where activo;

-- ─── Ítems: la pestaña «Global» ──────────────────────────────────────────────
-- PK uuid y no (plan_id, articulo): en el Excel la matrícula 00000000 aparece
-- repetida (filas de relleno). `orden` conserva la fila del Excel.
create table if not exists public.plan_compras_items (
  id                      uuid primary key default gen_random_uuid(),
  plan_id                 uuid not null references public.plan_compras(id) on delete cascade,
  orden                   integer not null default 0,

  -- Identificación (A–D)
  articulo                text,     -- «Artículo», normalizado sin el «.0» del export
  descripcion             text,
  unidad                  text,
  mat_serv                text,     -- «M/S»: Material / Servicio

  -- Clasificación (E–H)
  familia                 text,
  familia_vieja           text,     -- «FAMILIAS VIEJAS»
  subfamilia              text,
  a_cargo_de              text,     -- GD, ALMACENES, SyRT, …

  -- Última SIC (I–J)
  ultima_sic_area         text,     -- «ULTIMA SIC»: área del solicitante
  ultima_sic_solicitante  text,     -- «ULTIMA SIC2»

  -- Histórico (K–M). MAX (N) se calcula.
  hist_1                  numeric,  -- «2023P» en el plan 2026
  hist_2                  numeric,  -- «2023C»
  hist_3                  numeric,  -- «2024P»

  -- Demanda por sector — Zona A (O–T). ZA (U) se calcula.
  d_acr                   numeric,
  d_aord                  numeric,
  d_mantenimiento         numeric,
  d_seas                  numeric,
  d_sistemas              numeric,
  d_servicios             numeric,
  -- Interior (V–AB). INTERIOR (AC) se calcula.
  d_zb                    numeric,
  d_zc                    numeric,
  d_zd                    numeric,
  d_ze                    numeric,
  d_zf                    numeric,
  d_zg                    numeric,
  d_zh                    numeric,
  -- Otros sectores (AD–AJ). TOTAL (AK) se calcula.
  d_med                   numeric,
  d_tele                  numeric,
  d_tct                   numeric,
  d_trafos                numeric,
  d_reg_ten               numeric,  -- «REG.TEN.»
  d_obras                 numeric,
  d_impacto               numeric,  -- «Impacto 2025»

  -- Depuración y aprobación (AL, AO). GD (AM) y Recorte (AN) se calculan.
  ajuste                  numeric,
  cant_aprobadas          numeric,  -- «CANT. APROBADAS»

  -- Stock y consumo (AQ–AS) — en el Excel, valores pegados de reportes.
  stock                   numeric,
  pendientes              numeric,
  consumo_promedio        numeric,

  -- Precios (AV, AW, AY, BD)
  pu_sic                  numeric,
  pu_op                   numeric,
  pu_est_usd              numeric,  -- «Pu Est (USD)»
  pu_ajustado             numeric,

  -- Partida presupuestaria (BH–BI)
  partida                 text,
  partida_descripcion     text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Si la tabla ya existía con el esqueleto viejo, le faltan columnas.
alter table public.plan_compras_items add column if not exists mat_serv               text;
alter table public.plan_compras_items add column if not exists familia                text;
alter table public.plan_compras_items add column if not exists familia_vieja          text;
alter table public.plan_compras_items add column if not exists subfamilia             text;
alter table public.plan_compras_items add column if not exists ultima_sic_area        text;
alter table public.plan_compras_items add column if not exists ultima_sic_solicitante text;
alter table public.plan_compras_items add column if not exists hist_1                 numeric;
alter table public.plan_compras_items add column if not exists hist_2                 numeric;
alter table public.plan_compras_items add column if not exists hist_3                 numeric;
alter table public.plan_compras_items add column if not exists d_acr                  numeric;
alter table public.plan_compras_items add column if not exists d_aord                 numeric;
alter table public.plan_compras_items add column if not exists d_mantenimiento        numeric;
alter table public.plan_compras_items add column if not exists d_seas                 numeric;
alter table public.plan_compras_items add column if not exists d_sistemas             numeric;
alter table public.plan_compras_items add column if not exists d_servicios            numeric;
alter table public.plan_compras_items add column if not exists d_zb                   numeric;
alter table public.plan_compras_items add column if not exists d_zc                   numeric;
alter table public.plan_compras_items add column if not exists d_zd                   numeric;
alter table public.plan_compras_items add column if not exists d_ze                   numeric;
alter table public.plan_compras_items add column if not exists d_zf                   numeric;
alter table public.plan_compras_items add column if not exists d_zg                   numeric;
alter table public.plan_compras_items add column if not exists d_zh                   numeric;
alter table public.plan_compras_items add column if not exists d_med                  numeric;
alter table public.plan_compras_items add column if not exists d_tele                 numeric;
alter table public.plan_compras_items add column if not exists d_tct                  numeric;
alter table public.plan_compras_items add column if not exists d_trafos               numeric;
alter table public.plan_compras_items add column if not exists d_reg_ten              numeric;
alter table public.plan_compras_items add column if not exists d_obras                numeric;
alter table public.plan_compras_items add column if not exists d_impacto              numeric;
alter table public.plan_compras_items add column if not exists ajuste                 numeric;
alter table public.plan_compras_items add column if not exists stock                  numeric;
alter table public.plan_compras_items add column if not exists pendientes             numeric;
alter table public.plan_compras_items add column if not exists consumo_promedio       numeric;
alter table public.plan_compras_items add column if not exists pu_ajustado            numeric;
alter table public.plan_compras_items add column if not exists partida                text;
alter table public.plan_compras_items add column if not exists partida_descripcion    text;
alter table public.plan_compras_items drop column if exists cant_gd;

create index if not exists idx_plan_compras_items_plan_orden
  on public.plan_compras_items (plan_id, orden);
create index if not exists idx_plan_compras_items_articulo
  on public.plan_compras_items (plan_id, articulo);

-- ─── Familias: la pestaña «Prioridad» ────────────────────────────────────────
-- Solo FAMILIA y PRIORIDAD son datos; el resto de las columnas de esa pestaña
-- (cantidad de matrículas, totales GD / aprobado, %) se calculan.
create table if not exists public.plan_compras_familias (
  plan_id    uuid not null references public.plan_compras(id) on delete cascade,
  familia    text not null,
  prioridad  integer,
  orden      integer not null default 0,
  primary key (plan_id, familia)
);

-- ─── Cuentas contables: la tabla de la pestaña «Resumen» ─────────────────────
-- «Partida» y «descripción de partida» se derivan de la cuenta
-- (EXTRAE(cuenta; 6; 12) en el Excel), no se guardan.
create table if not exists public.plan_compras_cuentas (
  id       uuid primary key default gen_random_uuid(),
  plan_id  uuid not null references public.plan_compras(id) on delete cascade,
  orden    integer not null default 0,
  cuenta   text not null,
  total    numeric
);
create index if not exists idx_plan_compras_cuentas_plan
  on public.plan_compras_cuentas (plan_id, orden);

-- ─── Restos de versiones anteriores de este archivo ──────────────────────────
-- Triggers de updated_at y la función de activación ya no se usan: si quedaron
-- de una corrida anterior, se sacan. `updated_at` lo completa la app.
drop trigger if exists trg_plan_compras_updated_at on public.plan_compras;
drop trigger if exists trg_plan_compras_items_updated_at on public.plan_compras_items;
drop function if exists public.plan_compras_activar(uuid);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Permisiva, igual que el resto de las tablas que la app opera con la anon
-- key: el plan de compras es un dato compartido de la oficina, no personal.
alter table public.plan_compras          enable row level security;
alter table public.plan_compras_items    enable row level security;
alter table public.plan_compras_familias enable row level security;
alter table public.plan_compras_cuentas  enable row level security;

drop policy if exists "plan_compras_all" on public.plan_compras;
create policy "plan_compras_all" on public.plan_compras
  for all using (true) with check (true);

drop policy if exists "plan_compras_items_all" on public.plan_compras_items;
create policy "plan_compras_items_all" on public.plan_compras_items
  for all using (true) with check (true);

drop policy if exists "plan_compras_familias_all" on public.plan_compras_familias;
create policy "plan_compras_familias_all" on public.plan_compras_familias
  for all using (true) with check (true);

drop policy if exists "plan_compras_cuentas_all" on public.plan_compras_cuentas;
create policy "plan_compras_cuentas_all" on public.plan_compras_cuentas
  for all using (true) with check (true);

-- ─── Limpieza del esqueleto viejo ────────────────────────────────────────────
-- La fila semilla 2026 del esqueleto viejo quedó inactiva y nunca se importó.
-- Una importación en curso no se toca: siempre tiene `importado_at`.
delete from public.plan_compras where not activo and importado_at is null;
