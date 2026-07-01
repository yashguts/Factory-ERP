-- 051 — Assembly Runs (build a sub-assembly from its child parts)
--
-- The missing arrow in the production chain:
--   raw sheet --[program run]--> loose parts in stock --[ASSEMBLY RUN]--> parent
--   sub-assembly in stock --[dispatch]--> out.
--
-- An assembly run picks a parent item + quantity; on record it CONSUMES the
-- parent's children (item_bom_lines, finish-resolved) from Main Store and
-- PRODUCES the parent into Main Store, posting inventory_transactions tagged
-- reference_type='assembly_run' (idempotent + reversible, mirroring program
-- runs). NO date cutoff here — assembly runs only ever exist from the 2026-06-30
-- cutover onward (the loose-part stocking that feeds them is what's gated).

create table if not exists assembly_runs (
  id uuid primary key default gen_random_uuid(),
  -- the parent sub-assembly produced
  item_id uuid not null references items(id) on delete restrict,
  build_date date not null,
  qty numeric not null default 1 check (qty > 0),
  note text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_assembly_runs_date on assembly_runs(build_date);
create index if not exists idx_assembly_runs_item on assembly_runs(item_id);

-- RLS: permissive anon (matches every other table pre-auth)
alter table assembly_runs enable row level security;
drop policy if exists "Allow all for anon" on assembly_runs;
create policy "Allow all for anon" on assembly_runs for all to anon using (true) with check (true);
