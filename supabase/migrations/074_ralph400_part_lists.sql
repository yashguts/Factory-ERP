-- RALPH 400 structure part list saved against a job (2026-09-30). The /ralph400
-- page generates the external-structure part list from 13 inputs; saving
-- stores the inputs (so the next person opening the job sees exactly what was
-- used, instead of a browser-local copy) plus a snapshot of the generated
-- lines for reference. One saved list per job; saving again replaces it.
-- Additive only: nothing else reads or writes this table yet.
create table if not exists public.ralph400_part_lists (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null unique references public.jobs(id) on delete cascade,
  inputs      jsonb not null,
  lines       jsonb not null default '[]'::jsonb,
  pieces      integer,
  saved_by    text,
  saved_at    timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

alter table public.ralph400_part_lists enable row level security;
drop policy if exists ralph400_part_lists_all on public.ralph400_part_lists;
create policy ralph400_part_lists_all on public.ralph400_part_lists
  for all to anon, authenticated using (true) with check (true);
