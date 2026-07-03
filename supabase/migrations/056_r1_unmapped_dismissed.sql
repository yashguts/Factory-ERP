-- Lets the R1 builder "cross off" unmapped BOM carry-over items per job. Purely a
-- hidden-reminder record: never touches job_bom_lines or packing_r1_lines. The
-- curated unmapped reader (getCuratedUnmappedBomItems) excludes rows present here.
-- Reversible (delete a row / restoreUnmappedItem).
create table if not exists public.packing_r1_unmapped_dismissed (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  dismissed_by text,
  created_at timestamptz not null default now(),
  unique (job_id, item_id)
);
alter table public.packing_r1_unmapped_dismissed enable row level security;
drop policy if exists "Allow all for anon" on public.packing_r1_unmapped_dismissed;
create policy "Allow all for anon" on public.packing_r1_unmapped_dismissed for all to anon using (true) with check (true);
