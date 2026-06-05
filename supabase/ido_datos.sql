-- ─────────────────────────────────────────────────────────────────────────────
-- Índice IDO — tabla de datos crudos cargados desde "Indice IDO → Carga de datos".
-- Una fila por (periodo, zona). Los KPIs / Resultado Técnico / POVA / Mantenimiento
-- e IDO NO se guardan acá: se calculan en el Resumen a partir de estos valores.
--
-- Alcance: se consideran Obras Vía Administrativa y Obras de mantenimiento.
-- No se tienen en cuenta las obras a cargo del cliente.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.ido_datos (
  periodo            text not null,
  zona               text not null,

  -- Técnico (valores crudos del indicador — menos es mejor)
  fmik_s1            numeric,
  fmik_s2            numeric,
  dmik_s1            numeric,
  dmik_s2            numeric,

  -- POVA / Obras (conteos)
  pova_transferido   numeric,
  pova_fin_obra      numeric,
  pova_creadas       numeric,
  pova_total         numeric,

  -- Mantenimiento (cumplimientos en puntos porcentuales 0–100)
  mant_poda_bt       numeric,
  mant_poda_mt       numeric,
  mant_termografia   numeric,

  updated_at         timestamptz not null default now(),

  primary key (periodo, zona)
);

-- Mantiene updated_at al día en cada upsert/update.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_ido_datos_updated_at on public.ido_datos;
create trigger trg_ido_datos_updated_at
  before update on public.ido_datos
  for each row execute function public.set_updated_at();

-- RLS: habilitada con una policy permisiva (igual que el resto de las tablas
-- que opera la app con la anon key). Ajustar si se requiere control por usuario.
alter table public.ido_datos enable row level security;

drop policy if exists "ido_datos_all" on public.ido_datos;
create policy "ido_datos_all"
  on public.ido_datos
  for all
  using (true)
  with check (true);
