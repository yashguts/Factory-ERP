-- Printed packing-list snapshots (owner, 2026-07-10). The R1 "PDF Export" tab
-- lets the dispatcher deselect sections/items and tweak quantities WITHOUT
-- touching live job data, then print. On the print confirmation the exact
-- printed list is saved here; when a dispatch is marked within 72 hours, its
-- lines are diffed against the newest snapshot and any differences are shown
-- for an explicit OK. Pure log — nothing reads it into live job/BOM data.
create table if not exists public.packing_r1_prints (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  printed_at  timestamptz not null default now(),
  printed_by  text,
  -- [{ item_id, code, name, part, qty }] — selected lines as printed
  lines       jsonb not null
);
create index if not exists packing_r1_prints_job_time
  on public.packing_r1_prints (job_id, printed_at desc);

alter table public.packing_r1_prints enable row level security;
drop policy if exists packing_r1_prints_all on public.packing_r1_prints;
create policy packing_r1_prints_all on public.packing_r1_prints
  for all to anon, authenticated using (true) with check (true);
