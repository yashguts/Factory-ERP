-- Named, editable job sets (owner, 2026-07-16). The owner picks a group of
-- Job Orders in the Make MRP scope picker (e.g. the 52 "Urgent" jobs) and
-- saves it under a name. The same set is then selectable on every MRP
-- surface: Make + Trade views scope to the member jobs directly; Cabin MRP
-- resolves members to cabin jobs by matching job_number. A set stores ONLY
-- membership — all demand math stays in the existing scoped readers.
create table if not exists public.job_sets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- One set per name, case/whitespace-insensitive ("urgent" == " Urgent ").
create unique index if not exists job_sets_name_unique
  on public.job_sets (lower(trim(name)));

create table if not exists public.job_set_members (
  set_id  uuid not null references public.job_sets(id) on delete cascade,
  job_id  uuid not null references public.jobs(id) on delete cascade,
  primary key (set_id, job_id)
);
create index if not exists job_set_members_job on public.job_set_members (job_id);

alter table public.job_sets enable row level security;
drop policy if exists job_sets_all on public.job_sets;
create policy job_sets_all on public.job_sets
  for all to anon, authenticated using (true) with check (true);

alter table public.job_set_members enable row level security;
drop policy if exists job_set_members_all on public.job_set_members;
create policy job_set_members_all on public.job_set_members
  for all to anon, authenticated using (true) with check (true);
