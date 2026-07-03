-- A durable, point-in-time snapshot of recently-dispatched job BOM items, so the
-- future Packing List R1 dispatch flow can account for what has already gone out
-- (before R1 owns dispatch). No FKs on purpose: this copy must survive later
-- edits/deletes of the source dispatch rows. Additive + non-destructive.
-- Population is a one-time data step (dispatch_date within the captured window),
-- run out-of-band, not in this migration.
create table if not exists public.packing_r1_dispatch_carryover (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid,
  dispatch_line_id uuid,
  job_id uuid,
  job_number text,
  item_id uuid,
  category text,
  label text,
  qty numeric,
  dispatch_date date,
  phase_scope text,
  captured_window_days int,
  captured_at timestamptz not null default now()
);
alter table public.packing_r1_dispatch_carryover enable row level security;
drop policy if exists "Allow all for anon" on public.packing_r1_dispatch_carryover;
create policy "Allow all for anon" on public.packing_r1_dispatch_carryover for all to anon using (true) with check (true);
