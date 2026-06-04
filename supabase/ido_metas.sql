-- ─────────────────────────────────────────────────────────────────────────────
-- Índice IDO — criterios estratégicos / metas internas (una fila por periodo).
-- Editables desde "Indice IDO → Carga de datos". El Resumen los usa para calcular.
-- Sólo FMIK/DMIK (umbrales) y POVA Transferido (objetivo) afectan el cálculo;
-- el resto se guarda como referencia.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ido_metas (
  periodo           text primary key,
  fmik_s1           numeric,
  fmik_s2           numeric,
  dmik_s1           numeric,
  dmik_s2           numeric,
  pova_transferido  numeric,
  pova_fin_obra     numeric,
  pova_creados      numeric,
  poda_mt           numeric,
  poda_bt           numeric,
  termografia       numeric,
  updated_at        timestamptz not null default now()
);

drop trigger if exists trg_ido_metas_updated_at on public.ido_metas;
create trigger trg_ido_metas_updated_at
  before update on public.ido_metas
  for each row execute function public.set_updated_at();

alter table public.ido_metas enable row level security;
drop policy if exists "ido_metas_all" on public.ido_metas;
create policy "ido_metas_all"
  on public.ido_metas
  for all
  using (true)
  with check (true);
